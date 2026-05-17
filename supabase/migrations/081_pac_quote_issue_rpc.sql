-- ============================================================
-- 081_pac_quote_issue_rpc.sql
-- Pac-Quote: the atomic "Issue" operation.
--   issue_quote_revision(_rev_id uuid, _snapshot jsonb, _storage_key text)
--   - Locks the rev row, requires draft status
--   - Marks any prior issued rev on the same quote as superseded
--   - Flips this rev to 'issued' and persists snapshot_json + pdf_storage_key
--   - Sets issued_at + issued_by from auth.uid()
--   - Inserts an issue_audit_log row in the same transaction
--   Returns the updated quote_revisions row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.issue_quote_revision(
  _rev_id uuid,
  _snapshot jsonb,
  _storage_key text
) RETURNS public.quote_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rev public.quote_revisions;
  _user uuid := auth.uid();
  _quote_number text;
BEGIN
  IF _user IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  -- Lock the target row.
  SELECT * INTO _rev
    FROM public.quote_revisions
    WHERE id = _rev_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision not found';
  END IF;
  IF _rev.status <> 'draft' THEN
    RAISE EXCEPTION 'revision is not in draft status (status=%)', _rev.status;
  END IF;

  -- Supersede any prior issued rev on the same quote. We do this before
  -- the flip so a unique-issued-per-quote invariant never breaks during
  -- the transaction (none currently enforced, but cheaper this way).
  UPDATE public.quote_revisions
    SET status = 'superseded'
    WHERE quote_id = _rev.quote_id
      AND status = 'issued'
      AND id <> _rev_id;

  -- Flip this rev. issued_at uses now() so it sorts strictly after the
  -- supersede above.
  UPDATE public.quote_revisions
    SET status = 'issued',
        snapshot_json = _snapshot,
        pdf_storage_key = _storage_key,
        issued_at = now(),
        issued_by = _user
    WHERE id = _rev_id
    RETURNING * INTO _rev;

  SELECT number INTO _quote_number
    FROM public.quotes
    WHERE id = _rev.quote_id;

  -- Defensibility trail. Total comes from the snapshot's grand_total
  -- so the audit row matches what was rendered in the PDF.
  INSERT INTO public.issue_audit_log (
    actor_id, event_type, target_type, target_id, details_json
  )
  VALUES (
    _user,
    'issued',
    'quote_revision',
    _rev_id,
    jsonb_build_object(
      'quote_number', _quote_number,
      'rev_number',   _rev.rev_number,
      'total',        COALESCE((_snapshot -> 'totals' ->> 'grand_total')::numeric, 0)
    )
  );

  RETURN _rev;
END $$;

REVOKE ALL ON FUNCTION public.issue_quote_revision(uuid, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.issue_quote_revision(uuid, jsonb, text) TO authenticated;
