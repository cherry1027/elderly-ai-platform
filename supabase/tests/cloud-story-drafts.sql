-- Dedicated memy-ai-dev only. No passwords, emails or persistent test rows.
-- Requires the Day 5 migration. Every synthetic subject and row is rolled back.
BEGIN;

DO $collision$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    'a5100000-0000-4000-8000-000000000001', 'b5100000-0000-4000-8000-000000000002'
  )) OR EXISTS (SELECT 1 FROM public.books WHERE id IN (
    'a5200000-0000-4000-8000-000000000001', 'b5200000-0000-4000-8000-000000000002'
  )) THEN RAISE EXCEPTION 'Day 5 synthetic identity collision'; END IF;
END $collision$;

INSERT INTO auth.users(id, email) VALUES
  ('a5100000-0000-4000-8000-000000000001', 'memy-day5-a@example.invalid'),
  ('b5100000-0000-4000-8000-000000000002', 'memy-day5-b@example.invalid');
INSERT INTO public.books(id, user_id, title, language) VALUES
  ('a5200000-0000-4000-8000-000000000001', 'a5100000-0000-4000-8000-000000000001', 'Synthetic Day 5 A', 'en'),
  ('b5200000-0000-4000-8000-000000000002', 'b5100000-0000-4000-8000-000000000002', 'Synthetic Day 5 B', 'sv');
INSERT INTO public.conversation_sessions(id, project_id, language) VALUES
  ('a5300000-0000-4000-8000-000000000001', 'a5200000-0000-4000-8000-000000000001', 'en'),
  ('b5300000-0000-4000-8000-000000000002', 'b5200000-0000-4000-8000-000000000002', 'sv');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a5100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $alice$
DECLARE
  turn jsonb;
  context jsonb;
  draft jsonb;
  edited jsonb;
  latest jsonb;
  versions jsonb;
  location_id uuid;
  year_id uuid;
  draft_id uuid;
  source_id uuid;
  canonical text;
BEGIN
  IF public.get_story_project_verification('a5200000-0000-4000-8000-000000000001')
      ->'verification'->>'status' <> 'not_generated' THEN
    RAISE EXCEPTION 'Missing draft did not return explicit empty state';
  END IF;
  turn := public.append_conversation_turn(
    'a5300000-0000-4000-8000-000000000001', 'a5400000-0000-4000-8000-000000000001',
    'I grew up in Malmö. I think we moved in 1974. My mother''s name is Ada.',
    'en', NULL, 0, 'Thank you for sharing. Was 1974 the year you moved?',
    '[{"fact_type":"location","value":"Malmö","evidence":"I grew up in Malmö","slot":"grew_up_location","uncertain":false},
      {"fact_type":"event","value":"1974","evidence":"I think we moved in 1974","year":1974,"slot":"move","uncertain":true,"clarification_question":"Was 1974 the year you moved?"},
      {"fact_type":"relationship","value":"Ada","evidence":"My mother''s name is Ada","slot":"relationship:mother","uncertain":false}]',
    '[]'
  );
  SELECT id INTO location_id FROM public.memory_facts
    WHERE session_id='a5300000-0000-4000-8000-000000000001' AND slot='grew_up_location';
  SELECT id INTO year_id FROM public.memory_facts
    WHERE session_id='a5300000-0000-4000-8000-000000000001' AND slot='move';
  PERFORM public.resolve_memory_fact(location_id, 'confirmed', NULL, 1);
  PERFORM public.resolve_memory_fact((SELECT id FROM public.memory_facts
    WHERE session_id='a5300000-0000-4000-8000-000000000001' AND fact_type='relationship'), 'rejected', NULL, 1);
  source_id := (turn->'user_message'->>'id')::uuid;
  context := public.load_story_context('a5200000-0000-4000-8000-000000000001');
  canonical := context->>'canonical_content';
  IF canonical <> 'I grew up in Malmö.' OR (context->>'confirmed_count')::integer <> 1
      OR jsonb_array_length(context->'source_memories') <> 1
      OR jsonb_array_length(context->'excluded_memories') <> 2 THEN
    RAISE EXCEPTION 'Confirmed Malmö/unconfirmed year/rejected relationship isolation failed';
  END IF;
  BEGIN
    PERFORM public.save_story_generation(
      'a5200000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000099',
      'en', 'warm', true, context->>'context_token', canonical || ' I won a lottery.'
    );
    RAISE EXCEPTION 'An unsupported draft was falsely saved as verified';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.story_drafts
      WHERE project_id='a5200000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Failed verification left a partial draft';
  END IF;
  draft := public.save_story_generation(
    'a5200000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000001',
    'en', 'warm', true, context->>'context_token', canonical
  );
  draft_id := (draft->>'draft_id')::uuid;
  PERFORM set_config('memy.day5_draft_id', draft_id::text, true);
  IF draft->'verification'->>'status' <> 'passed'
      OR draft->>'content' <> canonical OR draft->>'original_content' <> canonical
      OR (draft->>'version')::integer <> 1 OR (draft->>'revision')::integer <> 1
      OR draft->'source_memories'->0->>'memory_id' <> location_id::text THEN
    RAISE EXCEPTION 'Canonical generation/provenance failed';
  END IF;
  edited := public.edit_story_draft(draft_id, 1, canonical || E'\n\nThis is my own wording.');
  IF edited->>'status' <> 'edited' OR (edited->>'revision')::integer <> 2
      OR edited->'verification'->>'status' <> 'needs_review'
      OR edited->'verification'->>'method' <> 'manual_unverified'
      OR edited->>'original_content' <> canonical THEN
    RAISE EXCEPTION 'Manual edits were not preserved/unverified';
  END IF;
  IF public.edit_story_draft(draft_id, 1, edited->>'content') IS DISTINCT FROM edited
      OR jsonb_array_length(public.list_story_edit_history(draft_id, 50, 0)) <> 1
      OR public.get_story_generation('a5200000-0000-4000-8000-000000000001',
        'a5500000-0000-4000-8000-000000000001', 'en', 'warm') IS DISTINCT FROM edited THEN
    RAISE EXCEPTION 'Retry duplicated history or lost manual edits';
  END IF;
  IF public.save_story_generation(
      'a5200000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000002',
      'en', 'warm', true, context->>'context_token', canonical) IS DISTINCT FROM edited THEN
    RAISE EXCEPTION 'Same-context generation duplicated/overwrote an edited draft';
  END IF;
  BEGIN
    PERFORM public.edit_story_draft(draft_id, 1, 'A conflicting old revision.');
    RAISE EXCEPTION 'A stale edit unexpectedly overwrote the story';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM public.resolve_memory_fact(year_id, 'confirmed', '1975', 1);
  edited := public.get_story_draft(draft_id);
  IF edited->'verification'->>'status' <> 'needs_review'
      OR (edited->'verification'->>'sources_current')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Edited story did not remain readable with stale sources';
  END IF;
  BEGIN
    PERFORM public.save_story_generation(
      'a5200000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000003',
      'en', 'warm', true, context->>'context_token', canonical
    );
    RAISE EXCEPTION 'Stale source context unexpectedly generated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  context := public.load_story_context('a5200000-0000-4000-8000-000000000001');
  IF strpos(context->>'canonical_content', '1975') = 0
      OR strpos(context->>'canonical_content', '1974') > 0 THEN
    RAISE EXCEPTION 'Effective confirmed correction was not used';
  END IF;
  latest := public.save_story_generation(
    'a5200000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000004',
    'en', 'warm', true, context->>'context_token', context->>'canonical_content'
  );
  IF (latest->>'version')::integer <> 2 OR jsonb_array_length(
      public.list_story_drafts('a5200000-0000-4000-8000-000000000001', 50, 0)) <> 2 THEN
    RAISE EXCEPTION 'Changed memories did not preserve generation versions';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version)
    ORDER BY f.id), '[]'::jsonb) INTO versions
  FROM public.memory_facts AS f
  WHERE f.project_id='a5200000-0000-4000-8000-000000000001' AND f.status<>'rejected';
  turn := public.append_conversation_turn(
    'a5300000-0000-4000-8000-000000000001', 'a5400000-0000-4000-8000-000000000002',
    'Actually, it was 1976.', 'en', NULL,
    (SELECT max(sequence) FROM public.conversation_messages
      WHERE session_id='a5300000-0000-4000-8000-000000000001'),
    'Was 1976 correct, rather than 1975?',
    jsonb_build_array(jsonb_build_object('fact_type','event','value','1976',
      'evidence','1976','year',1976,'slot','move','uncertain',true,
      'clarification_question','Was 1976 correct, rather than 1975?',
      'conflicts_with_fact_id',year_id)), versions
  );
  context := public.load_story_context('a5200000-0000-4000-8000-000000000001');
  IF jsonb_array_length(context->'blocking_clarifications') = 0 THEN
    RAISE EXCEPTION 'Conflicting dates did not block generation';
  END IF;
  BEGIN
    PERFORM public.save_story_generation(
      'a5200000-0000-4000-8000-000000000001', 'a5500000-0000-4000-8000-000000000005',
      'en', 'warm', true, context->>'context_token', context->>'canonical_content'
    );
    RAISE EXCEPTION 'Conflicting dates unexpectedly generated a verified draft';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  IF public.get_story_draft((latest->>'draft_id')::uuid)->'verification'->>'status'
      <> 'stale_sources' THEN RAISE EXCEPTION 'Original draft staleness was not exposed'; END IF;
  BEGIN
    UPDATE public.story_drafts AS d SET content='Overwritten' WHERE d.id=draft_id;
    RAISE EXCEPTION 'Direct client story mutation unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.story_verification_results AS r SET status='passed' WHERE r.draft_id=(latest->>'draft_id')::uuid;
    RAISE EXCEPTION 'Client could falsely pass a story';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT original_text FROM public.conversation_messages WHERE id=source_id)
      <> 'I grew up in Malmö. I think we moved in 1974. My mother''s name is Ada.' THEN
    RAISE EXCEPTION 'Original source text was changed';
  END IF;
END $alice$;

SELECT set_config('request.jwt.claims', '{"sub":"b5100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
DO $bob$
DECLARE turn jsonb; context jsonb; draft jsonb; other_draft uuid := current_setting('memy.day5_draft_id')::uuid;
BEGIN
  IF EXISTS(SELECT 1 FROM public.story_drafts WHERE project_id='a5200000-0000-4000-8000-000000000001')
      OR EXISTS(SELECT 1 FROM public.draft_source_memories WHERE draft_id=other_draft)
      OR EXISTS(SELECT 1 FROM public.story_edit_history WHERE draft_id=other_draft)
      OR EXISTS(SELECT 1 FROM public.story_verification_results WHERE draft_id=other_draft) THEN
    RAISE EXCEPTION 'Cross-user draft/source/history/report was exposed';
  END IF;
  BEGIN PERFORM public.load_story_context('a5200000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Cross-user context unexpectedly allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.get_story_draft(other_draft);
    RAISE EXCEPTION 'Cross-user draft read unexpectedly allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.edit_story_draft(other_draft, 2, 'Foreign edit');
    RAISE EXCEPTION 'Cross-user draft edit unexpectedly allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.list_story_drafts('a5200000-0000-4000-8000-000000000001',50,0);
    RAISE EXCEPTION 'Cross-user draft list unexpectedly allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.list_story_edit_history(other_draft,50,0);
    RAISE EXCEPTION 'Cross-user history unexpectedly allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  turn := public.append_conversation_turn(
    'b5300000-0000-4000-8000-000000000002', 'b5400000-0000-4000-8000-000000000001',
    'Jag växte upp i Malmö.', 'sv', NULL, 0, 'Tack för att du delar det minnet.',
    '[{"fact_type":"location","value":"Malmö","evidence":"Jag växte upp i Malmö","slot":"grew_up_location","uncertain":false}]', '[]'
  );
  PERFORM public.resolve_memory_fact((turn->'memories'->0->>'id')::uuid,'confirmed',NULL,1);
  context := public.load_story_context('b5200000-0000-4000-8000-000000000002');
  draft := public.save_story_generation(
    'b5200000-0000-4000-8000-000000000002', 'b5500000-0000-4000-8000-000000000001',
    'sv', 'warm', true, context->>'context_token', context->>'canonical_content'
  );
  IF draft->>'language' <> 'sv' OR draft->>'content' <> 'Jag växte upp i Malmö.'
      OR draft->'verification'->>'status' <> 'passed' THEN
    RAISE EXCEPTION 'Swedish confirmed-memory generation failed';
  END IF;
END $bob$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{}',true);
DO $anonymous$ BEGIN
  BEGIN PERFORM id FROM public.story_drafts;
    RAISE EXCEPTION 'Anonymous draft read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.load_story_context('a5200000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Anonymous story RPC unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS' AS day5_workflow, 'PASS' AS owner_isolation,
       'BLOCKED' AS unsupported_draft, 'PRESERVED' AS original_and_edits,
       'ROLLED BACK' AS synthetic_data;
