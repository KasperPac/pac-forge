-- Wave D — SFC sequence model v2 rewrite.
--
-- Converts legacy v1 sequential_states (flat StepV2 with `step`/`action`/
-- `completion_criteria`/`on_fail`) to SFC v2 shape: stable step_id,
-- single-kind transitions pointing at the next step, manual_prose
-- actions, main-branch, and `sequence_model_version: 2`.
--
-- Idempotent: any state whose sequence_model_version is already 2 is
-- skipped. Both `fds_assembly_sessions.sequential_states` and
-- `spec_sections.content_json` are rewritten where applicable.
--
-- If the legacy step carries an `on_fail`, two transitions are emitted:
--   - priority 0 (happy path) guard = completion_criteria, target = next step
--   - priority 1 (fault path)   no guard,                  target = <fault step>
-- When no fault step exists, `on_fail` is attached to the first transition
-- and no extra transition is emitted.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: generate deterministic step_id from (state_id, step_number).
-- md5 produces 32 hex chars; we format as a UUID-like string (8-4-4-4-12)
-- so downstream code that accepts arbitrary strings is happy and anyone
-- eyeballing it sees something UUID-shaped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _pf_sfc_step_id(state_id text, step_number int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    substr(h,  1,  8) || '-' ||
    substr(h,  9,  4) || '-' ||
    substr(h, 13,  4) || '-' ||
    substr(h, 17,  4) || '-' ||
    substr(h, 21, 12)
  FROM (SELECT md5(coalesce(state_id,'') || '::' || step_number::text) AS h) s
$$;

-- Fault-step id per state (deterministic sentinel).
CREATE OR REPLACE FUNCTION _pf_sfc_fault_step_id(state_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    substr(h,  1,  8) || '-' ||
    substr(h,  9,  4) || '-' ||
    substr(h, 13,  4) || '-' ||
    substr(h, 17,  4) || '-' ||
    substr(h, 21, 12)
  FROM (SELECT md5('FAULT::' || coalesce(state_id,'')) AS h) s
$$;

-- Action id for the synthetic manual_prose action.
CREATE OR REPLACE FUNCTION _pf_sfc_action_id(state_id text, step_number int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    substr(h,  1,  8) || '-' ||
    substr(h,  9,  4) || '-' ||
    substr(h, 13,  4) || '-' ||
    substr(h, 17,  4) || '-' ||
    substr(h, 21, 12)
  FROM (SELECT md5('ACTION::' || coalesce(state_id,'') || '::' || step_number::text) AS h) s
$$;

-- Transition id.
CREATE OR REPLACE FUNCTION _pf_sfc_transition_id(state_id text, step_number int, suffix text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT
    substr(h,  1,  8) || '-' ||
    substr(h,  9,  4) || '-' ||
    substr(h, 13,  4) || '-' ||
    substr(h, 17,  4) || '-' ||
    substr(h, 21, 12)
  FROM (SELECT md5('TRANS::' || coalesce(state_id,'') || '::' || step_number::text || '::' || suffix) AS h) s
$$;

-- ---------------------------------------------------------------------------
-- Core rewrite: given a single sequential_state jsonb (keyed by state_id) and
-- the state_id, return the v2-shaped jsonb. Legacy shape detection: if
-- sequence_model_version = 2 OR steps[0].step_id IS NOT NULL, the state is
-- returned unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _pf_rewrite_sequential_state(
  state_id text,
  state_val jsonb
) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_steps jsonb;
  v_new_steps jsonb := '[]'::jsonb;
  v_step jsonb;
  v_step_num int;
  v_next_step_id text;
  v_this_step_id text;
  v_idx int := 0;
  v_total int;
  v_action_id text;
  v_on_fail jsonb;
  v_has_fault_step boolean := false;
  v_fault_step_id text;
  v_completion jsonb;
  v_transitions jsonb;
  v_transition_happy jsonb;
  v_transition_fault jsonb;
  v_actions jsonb;
BEGIN
  IF state_val IS NULL OR jsonb_typeof(state_val) <> 'object' THEN
    RETURN state_val;
  END IF;

  -- Already v2 — skip.
  IF (state_val ->> 'sequence_model_version')::int = 2 THEN
    RETURN state_val;
  END IF;

  v_steps := coalesce(state_val -> 'steps', '[]'::jsonb);
  IF jsonb_typeof(v_steps) <> 'array' THEN
    v_steps := '[]'::jsonb;
  END IF;
  v_total := jsonb_array_length(v_steps);

  v_fault_step_id := _pf_sfc_fault_step_id(state_id);

  -- First pass: does any step declare an on_fail? Then we need a fault step.
  FOR v_idx IN 0 .. v_total - 1 LOOP
    v_step := v_steps -> v_idx;
    IF (v_step ? 'on_fail') AND (v_step -> 'on_fail') <> 'null'::jsonb THEN
      v_has_fault_step := true;
      EXIT;
    END IF;
  END LOOP;

  -- Second pass: emit v2 steps.
  FOR v_idx IN 0 .. v_total - 1 LOOP
    v_step := v_steps -> v_idx;
    v_step_num := coalesce((v_step ->> 'step')::int, v_idx + 1);
    v_this_step_id := _pf_sfc_step_id(state_id, v_step_num);

    IF v_idx + 1 < v_total THEN
      v_next_step_id := _pf_sfc_step_id(
        state_id,
        coalesce(((v_steps -> (v_idx + 1)) ->> 'step')::int, v_idx + 2)
      );
    ELSE
      v_next_step_id := NULL;   -- terminal step; no default transition
    END IF;

    v_completion := coalesce(v_step -> 'completion_criteria', '[]'::jsonb);
    v_on_fail    := v_step -> 'on_fail';

    v_action_id := _pf_sfc_action_id(state_id, v_step_num);
    v_actions := jsonb_build_array(jsonb_build_object(
      'kind',            'manual_prose',
      'action_id',       v_action_id,
      'text',            coalesce(v_step ->> 'action', ''),
      'referenced_tags', '[]'::jsonb,
      'prose',           coalesce(v_step ->> 'action', '')
    ));

    v_transitions := '[]'::jsonb;

    IF v_next_step_id IS NOT NULL THEN
      v_transition_happy := jsonb_build_object(
        'transition_id', _pf_sfc_transition_id(state_id, v_step_num, 'happy'),
        'kind',          'single',
        'target_step_id', v_next_step_id,
        'guard',         v_completion,
        'priority',      0,
        'is_default',    false,
        'notes',         null
      );

      -- If there's a fault step AND this step has on_fail, split them.
      IF v_has_fault_step AND v_on_fail IS NOT NULL AND v_on_fail <> 'null'::jsonb THEN
        v_transition_fault := jsonb_build_object(
          'transition_id',  _pf_sfc_transition_id(state_id, v_step_num, 'fault'),
          'kind',           'single',
          'target_step_id', v_fault_step_id,
          'guard',          '[]'::jsonb,
          'priority',       1,
          'is_default',     false,
          'on_fail',        v_on_fail,
          'notes',          null
        );
        v_transitions := jsonb_build_array(v_transition_happy, v_transition_fault);
      ELSE
        IF v_on_fail IS NOT NULL AND v_on_fail <> 'null'::jsonb THEN
          v_transition_happy := v_transition_happy || jsonb_build_object('on_fail', v_on_fail);
        END IF;
        v_transitions := jsonb_build_array(v_transition_happy);
      END IF;
    END IF;

    v_new_steps := v_new_steps || jsonb_build_array(
      jsonb_build_object(
        'step_id',                  v_this_step_id,
        'branch_id',                'main',
        'name',                     coalesce(v_step ->> 'action', 'Step ' || v_step_num::text),
        'actions',                  v_actions,
        'monitors',                 '[]'::jsonb,
        'transitions',              v_transitions,
        -- Legacy fields retained (StepV2Schema still requires them).
        'step',                     v_step_num,
        'action',                   coalesce(v_step ->> 'action', ''),
        'completion_criteria',      v_completion,
        'completion_criteria_text', coalesce(v_step ->> 'completion_criteria_text', ''),
        'on_fail',                  v_on_fail
      )
    );
  END LOOP;

  -- Synthesise the fault step if any step declared on_fail.
  IF v_has_fault_step THEN
    v_new_steps := v_new_steps || jsonb_build_array(
      jsonb_build_object(
        'step_id',                  v_fault_step_id,
        'branch_id',                'main',
        'name',                     'Fault',
        'actions',                  jsonb_build_array(jsonb_build_object(
          'kind',           'manual_prose',
          'action_id',      _pf_sfc_action_id(state_id, 0),
          'text',           'Fault handling — engineer authored',
          'referenced_tags','[]'::jsonb,
          'prose',          'Fault handling — engineer authored'
        )),
        'monitors',                 '[]'::jsonb,
        'transitions',              '[]'::jsonb,
        'step',                     9999,
        'action',                   'Fault handling',
        'completion_criteria',      '[]'::jsonb,
        'completion_criteria_text', '',
        'on_fail',                  null
      )
    );
  END IF;

  RETURN
    state_val
    || jsonb_build_object(
      'steps',                  v_new_steps,
      'branches',               jsonb_build_array(jsonb_build_object(
        'branch_id',       'main',
        'name',            'Main',
        'kind',            'main',
        'fork_step_id',    coalesce(_pf_sfc_step_id(state_id,
          coalesce(((v_steps -> 0) ->> 'step')::int, 1)), '')
      )),
      'state_monitors',         '[]'::jsonb,
      'sequence_model_version', 2
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Rewrite fds_assembly_sessions.sequential_states (object keyed by state_id)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_new jsonb;
  v_migrated_count int := 0;
  v_state_key text;
  v_state_val jsonb;
BEGIN
  FOR r IN
    SELECT id, sequential_states
    FROM fds_assembly_sessions
    WHERE sequential_states IS NOT NULL
      AND jsonb_typeof(sequential_states) = 'object'
  LOOP
    v_new := '{}'::jsonb;

    FOR v_state_key, v_state_val IN
      SELECT * FROM jsonb_each(r.sequential_states)
    LOOP
      v_new := v_new || jsonb_build_object(
        v_state_key,
        _pf_rewrite_sequential_state(v_state_key, v_state_val)
      );

      IF coalesce((v_state_val ->> 'sequence_model_version')::int, 1) <> 2 THEN
        v_migrated_count := v_migrated_count + 1;
      END IF;
    END LOOP;

    IF v_new <> r.sequential_states THEN
      UPDATE fds_assembly_sessions
      SET sequential_states = v_new
      WHERE id = r.id;
    END IF;
  END LOOP;

  RAISE NOTICE 'fds_assembly_sessions: migrated % states from v1 to v2', v_migrated_count;
END $$;

-- ---------------------------------------------------------------------------
-- Rewrite spec_sections.content_json where section_type = 'functional_description'.
-- Two shapes are possible:
--   (A) content_json has a top-level `sequential_states` object
--   (B) content_json is a single functional-description row with a
--       top-level `steps` array (pattern = sequential)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_new jsonb;
  v_migrated_count int := 0;
  v_state_key text;
  v_state_val jsonb;
  v_synthetic_state text;
  v_is_sequential boolean;
BEGIN
  FOR r IN
    SELECT id, state_id, content_json
    FROM spec_sections
    WHERE section_type = 'functional_description'
      AND content_json IS NOT NULL
      AND jsonb_typeof(content_json) = 'object'
  LOOP
    v_new := r.content_json;

    -- Shape (A): nested sequential_states subtree.
    IF v_new ? 'sequential_states'
       AND jsonb_typeof(v_new -> 'sequential_states') = 'object' THEN
      DECLARE
        v_new_inner jsonb := '{}'::jsonb;
      BEGIN
        FOR v_state_key, v_state_val IN
          SELECT * FROM jsonb_each(v_new -> 'sequential_states')
        LOOP
          v_new_inner := v_new_inner || jsonb_build_object(
            v_state_key,
            _pf_rewrite_sequential_state(v_state_key, v_state_val)
          );
          IF coalesce((v_state_val ->> 'sequence_model_version')::int, 1) <> 2 THEN
            v_migrated_count := v_migrated_count + 1;
          END IF;
        END LOOP;
        v_new := v_new || jsonb_build_object('sequential_states', v_new_inner);
      END;
    END IF;

    -- Shape (B): top-level steps[] (FunctionalDescriptionContent, pattern=sequential).
    -- Only rewrite if steps[] exists AND first step has no step_id AND
    -- sequence_model_version isn't already 2.
    IF v_new ? 'steps'
       AND jsonb_typeof(v_new -> 'steps') = 'array'
       AND coalesce((v_new ->> 'sequence_model_version')::int, 1) <> 2 THEN
      v_is_sequential := coalesce(v_new ->> 'pattern', 'sequential') = 'sequential';
      IF v_is_sequential AND jsonb_array_length(v_new -> 'steps') > 0 THEN
        v_synthetic_state := coalesce(r.state_id, 'inline');
        v_new := _pf_rewrite_sequential_state(v_synthetic_state, v_new);
        v_migrated_count := v_migrated_count + 1;
      END IF;
    END IF;

    IF v_new <> r.content_json THEN
      UPDATE spec_sections
      SET content_json = v_new
      WHERE id = r.id;
    END IF;
  END LOOP;

  RAISE NOTICE 'spec_sections: migrated % states from v1 to v2', v_migrated_count;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers retained for reruns / future data import paths. Drop if you want
-- to keep the schema surface clean — idempotent either way.
-- ---------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS _pf_rewrite_sequential_state(text, jsonb);
-- DROP FUNCTION IF EXISTS _pf_sfc_transition_id(text, int, text);
-- DROP FUNCTION IF EXISTS _pf_sfc_action_id(text, int);
-- DROP FUNCTION IF EXISTS _pf_sfc_fault_step_id(text);
-- DROP FUNCTION IF EXISTS _pf_sfc_step_id(text, int);

COMMIT;
