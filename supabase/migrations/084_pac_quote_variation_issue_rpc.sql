-- ============================================================
-- 084_pac_quote_variation_issue_rpc.sql
-- Pac-Quote v2: atomic issue RPC for variations.
--   Locks the draft, validates project stage, flips status,
--   writes snapshot + PDF key, and appends an audit row —
--   all in one transaction with SECURITY DEFINER.
-- ============================================================

CREATE OR REPLACE FUNCTION public.issue_variation(
  _variation_id uuid,
  _snapshot     jsonb,
  _storage_key  text
) RETURNS public.variations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _var           public.variations;
  _user          uuid := auth.uid();
  _project_stage text;
BEGIN
  IF _user IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  SELECT * INTO _var
    FROM public.variations
   WHERE id = _variation_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'variation not found';
  END IF;

  IF _var.status <> 'draft' THEN
    RAISE EXCEPTION 'variation is not in draft (status=%)', _var.status;
  END IF;

  SELECT stage INTO _project_stage
    FROM public.projects
   WHERE id = _var.project_id;

  IF _project_stage NOT IN ('awarded', 'in_progress') THEN
    RAISE EXCEPTION 'variations require an awarded or in-progress project';
  END IF;

  UPDATE public.variations
     SET status          = 'issued',
         snapshot_json   = _snapshot,
         pdf_storage_key = _storage_key,
         issued_at       = now(),
         issued_by       = _user
   WHERE id = _variation_id
   RETURNING * INTO _var;

  INSERT INTO public.issue_audit_log (
    actor_id, event_type, target_type, target_id, details_json
  ) VALUES (
    _user,
    'issued',
    'variation',
    _variation_id,
    jsonb_build_object(
      'variation_number', _var.variation_number,
      'project_id',       _var.project_id,
      'total',            COALESCE((_snapshot -> 'totals' ->> 'grand_total')::numeric, 0)
    )
  );

  RETURN _var;
END $$;

REVOKE ALL   ON FUNCTION public.issue_variation(uuid, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.issue_variation(uuid, jsonb, text) TO authenticated;
