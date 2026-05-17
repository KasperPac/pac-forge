-- ============================================================
-- 082_pac_quote_award_rpc.sql
-- Pac-Quote: project-lifecycle transitions wired to a quote revision.
--   award_quote_revision(_rev_id)         — accept a quote
--   mark_quote_revision_lost(_rev_id)     — record the loss
--   issue_quote_revision is amended to block when project is already awarded
-- ============================================================

-- ------------------------------------------------------------
-- award_quote_revision
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_quote_revision(_rev_id uuid)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rev public.quote_revisions;
  _quote public.quotes;
  _project public.projects;
  _user uuid := auth.uid();
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'must be authenticated'; END IF;

  SELECT * INTO _rev FROM public.quote_revisions WHERE id = _rev_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'revision not found'; END IF;
  IF _rev.status <> 'issued' THEN
    RAISE EXCEPTION 'can only award an issued revision (status=%)', _rev.status;
  END IF;

  SELECT * INTO _quote FROM public.quotes WHERE id = _rev.quote_id FOR UPDATE;
  SELECT * INTO _project
    FROM public.projects WHERE id = _quote.project_id FOR UPDATE;

  IF _project.stage = 'awarded' AND _project.awarded_quote_id IS DISTINCT FROM _rev_id THEN
    RAISE EXCEPTION 'project is already awarded to another revision';
  END IF;

  -- The revision stays 'issued' (REV_STATUSES does not include 'awarded'),
  -- but the quote + project reflect the win.
  UPDATE public.quotes  SET status = 'awarded' WHERE id = _quote.id;
  UPDATE public.projects
    SET stage = 'awarded', awarded_quote_id = _rev_id
    WHERE id = _project.id
    RETURNING * INTO _project;

  INSERT INTO public.issue_audit_log (
    actor_id, event_type, target_type, target_id, details_json
  ) VALUES (
    _user, 'awarded', 'quote_revision', _rev_id,
    jsonb_build_object(
      'quote_number', _quote.number,
      'rev_number',   _rev.rev_number,
      'project_id',   _project.id
    )
  );

  RETURN _project;
END $$;

REVOKE ALL ON FUNCTION public.award_quote_revision(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.award_quote_revision(uuid) TO authenticated;

-- ------------------------------------------------------------
-- mark_quote_revision_lost
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_quote_revision_lost(_rev_id uuid)
RETURNS public.quotes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rev public.quote_revisions;
  _quote public.quotes;
  _user uuid := auth.uid();
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'must be authenticated'; END IF;

  SELECT * INTO _rev FROM public.quote_revisions WHERE id = _rev_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'revision not found'; END IF;
  IF _rev.status <> 'issued' THEN
    RAISE EXCEPTION 'can only mark an issued revision lost (status=%)', _rev.status;
  END IF;

  UPDATE public.quotes SET status = 'lost'
    WHERE id = _rev.quote_id RETURNING * INTO _quote;

  INSERT INTO public.issue_audit_log (
    actor_id, event_type, target_type, target_id, details_json
  ) VALUES (
    _user, 'marked_lost', 'quote_revision', _rev_id,
    jsonb_build_object(
      'quote_number', _quote.number,
      'rev_number',   _rev.rev_number
    )
  );

  RETURN _quote;
END $$;

REVOKE ALL ON FUNCTION public.mark_quote_revision_lost(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_quote_revision_lost(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Amend issue_quote_revision so issuing a fresh rev is blocked while the
-- parent project is already awarded. We replace the function in place to
-- keep the signature stable for callers.
-- ------------------------------------------------------------
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
  _project_stage text;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'must be authenticated'; END IF;

  SELECT * INTO _rev FROM public.quote_revisions WHERE id = _rev_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'revision not found'; END IF;
  IF _rev.status <> 'draft' THEN
    RAISE EXCEPTION 'revision is not in draft status (status=%)', _rev.status;
  END IF;

  -- Block issuing on already-awarded projects so a winning quote can't be
  -- silently replaced.
  SELECT p.stage INTO _project_stage
    FROM public.projects p
    JOIN public.quotes q ON q.project_id = p.id
    WHERE q.id = _rev.quote_id;
  IF _project_stage = 'awarded' THEN
    RAISE EXCEPTION 'cannot issue new revisions on an awarded project';
  END IF;

  UPDATE public.quote_revisions
    SET status = 'superseded'
    WHERE quote_id = _rev.quote_id AND status = 'issued' AND id <> _rev_id;

  UPDATE public.quote_revisions
    SET status = 'issued',
        snapshot_json = _snapshot,
        pdf_storage_key = _storage_key,
        issued_at = now(),
        issued_by = _user
    WHERE id = _rev_id
    RETURNING * INTO _rev;

  SELECT number INTO _quote_number
    FROM public.quotes WHERE id = _rev.quote_id;

  INSERT INTO public.issue_audit_log (
    actor_id, event_type, target_type, target_id, details_json
  ) VALUES (
    _user, 'issued', 'quote_revision', _rev_id,
    jsonb_build_object(
      'quote_number', _quote_number,
      'rev_number',   _rev.rev_number,
      'total',        COALESCE((_snapshot -> 'totals' ->> 'grand_total')::numeric, 0)
    )
  );

  RETURN _rev;
END $$;
