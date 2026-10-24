-- Dedicated development only. No credentials, emails or persistent test data.
-- Apply the Day 4 migration first; every synthetic row below is rolled back.
BEGIN;

DO $collision$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    'a4100000-0000-4000-8000-000000000001', 'b4100000-0000-4000-8000-000000000002'
  )) OR EXISTS (SELECT 1 FROM public.books WHERE id IN (
    'a4200000-0000-4000-8000-000000000001', 'b4200000-0000-4000-8000-000000000002'
  )) THEN RAISE EXCEPTION 'Day 4 synthetic identity collision'; END IF;
END $collision$;

INSERT INTO auth.users (id, email) VALUES
  ('a4100000-0000-4000-8000-000000000001', 'memy-day4-a@example.invalid'),
  ('b4100000-0000-4000-8000-000000000002', 'memy-day4-b@example.invalid');
INSERT INTO public.books (id, user_id, title, language) VALUES
  ('a4200000-0000-4000-8000-000000000001', 'a4100000-0000-4000-8000-000000000001', 'Synthetic Day 4 A', 'en'),
  ('b4200000-0000-4000-8000-000000000002', 'b4100000-0000-4000-8000-000000000002', 'Synthetic Day 4 B', 'sv');
INSERT INTO public.conversation_sessions (id, project_id, language) VALUES
  ('a4300000-0000-4000-8000-000000000001', 'a4200000-0000-4000-8000-000000000001', 'en'),
  ('b4300000-0000-4000-8000-000000000002', 'b4200000-0000-4000-8000-000000000002', 'sv');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a4100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $alice$
DECLARE
  first_turn jsonb;
  second_turn jsonb;
  reviewed jsonb;
  original_fact uuid;
  original_message uuid;
BEGIN
  first_turn := public.append_conversation_turn(
    'a4300000-0000-4000-8000-000000000001', 'a4400000-0000-4000-8000-000000000001',
    'I think we moved in 1974.', 'en', NULL, 0,
    'Thank you for sharing. Was 1974 the year you moved?',
    '[{"fact_type":"event","value":"1974","evidence":"1974","year":1974,"slot":"move","uncertain":true,"clarification_question":"Was 1974 the year you moved?"}]', '[]'
  );
  IF first_turn->>'mode' <> 'mock' OR (first_turn->>'requires_clarification')::boolean IS NOT TRUE
     OR jsonb_array_length(first_turn->'memories') <> 1 THEN
    RAISE EXCEPTION 'First mock turn failed';
  END IF;
  original_fact := (first_turn->'memories'->0->>'id')::uuid;
  original_message := (first_turn->'user_message'->>'id')::uuid;
  IF public.get_conversation_turn(
    'a4300000-0000-4000-8000-000000000001', 'a4400000-0000-4000-8000-000000000001',
    'I think we moved in 1974.', 'en', NULL
  ) IS DISTINCT FROM first_turn THEN RAISE EXCEPTION 'Stored replay mismatch'; END IF;
  IF public.append_conversation_turn(
    'a4300000-0000-4000-8000-000000000001', 'a4400000-0000-4000-8000-000000000001',
    'I think we moved in 1974.', 'en', NULL, 0, 'Unused replay output', '[]', '[]'
  ) IS DISTINCT FROM first_turn THEN RAISE EXCEPTION 'Append replay mismatch'; END IF;
  IF (SELECT count(*) FROM public.conversation_message_history
      WHERE session_id='a4300000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'Replay duplicated messages';
  END IF;
  BEGIN
    PERFORM public.append_conversation_turn(
      'a4300000-0000-4000-8000-000000000001', 'a4400000-0000-4000-8000-000000000003',
      'I think we moved in 1974.', 'en', original_message,
      (first_turn->'message'->>'sequence')::bigint, 'Duplicate processing', '[]',
      jsonb_build_array(jsonb_build_object('id',original_fact,'version',1))
    );
    RAISE EXCEPTION 'A typed source was processed a second time';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  second_turn := public.append_conversation_turn(
    'a4300000-0000-4000-8000-000000000001', 'a4400000-0000-4000-8000-000000000002',
    'Actually, it was 1975.', 'en', NULL,
    (first_turn->'message'->>'sequence')::bigint,
    'You previously said 1974. Is 1975 correct?',
    jsonb_build_array(jsonb_build_object(
      'fact_type','event', 'value','1975', 'evidence','1975', 'year',1975,
      'slot','move', 'uncertain',true, 'clarification_question','Is 1975 correct?',
      'conflicts_with_fact_id',original_fact
    )), jsonb_build_array(jsonb_build_object('id',original_fact,'version',1))
  );
  reviewed := public.resolve_memory_fact(original_fact, 'confirmed', '1975', 1);
  IF reviewed->>'value' <> '1974' OR reviewed->>'corrected_value' <> '1975'
     OR (reviewed->>'version')::integer <> 2 THEN
    RAISE EXCEPTION 'Correction overwrote extraction or did not version';
  END IF;
  IF public.resolve_memory_fact(original_fact, 'confirmed', '1975', 1)
     IS DISTINCT FROM reviewed THEN RAISE EXCEPTION 'Review retry mismatch'; END IF;
  PERFORM public.resolve_memory_fact((second_turn->'memories'->0->>'id')::uuid, 'confirmed', NULL, 1);
  BEGIN
    PERFORM public.append_conversation_turn(
      'a4300000-0000-4000-8000-000000000001', 'a4400000-0000-4000-8000-000000000004',
      'A stale-context turn.', 'en', NULL,
      (second_turn->'message'->>'sequence')::bigint, 'Stale result', '[]', '[]'
    );
    RAISE EXCEPTION 'A stale fact context unexpectedly committed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  IF (SELECT count(*) FROM public.conversation_message_history
      WHERE session_id='a4300000-0000-4000-8000-000000000001') <> 4 THEN
    RAISE EXCEPTION 'A failed request left partial messages';
  END IF;
  IF (SELECT original_text FROM public.conversation_messages WHERE id=original_message)
     <> 'I think we moved in 1974.' THEN RAISE EXCEPTION 'Original source was changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.memory_clarifications
             WHERE session_id='a4300000-0000-4000-8000-000000000001' AND status='open') THEN
    RAISE EXCEPTION 'Reviewed facts retained unresolved questions';
  END IF;
  BEGIN
    UPDATE public.conversation_messages SET original_text='Overwritten' WHERE id=original_message;
    RAISE EXCEPTION 'Source update unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.resolve_memory_fact(original_fact, 'rejected', NULL, 1);
    RAISE EXCEPTION 'Stale review unexpectedly allowed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $alice$;

SELECT set_config('request.jwt.claims', '{"sub":"b4100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
DO $bob$
DECLARE turn jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.conversation_message_history WHERE session_id='a4300000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.memory_facts WHERE session_id='a4300000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.memory_clarifications WHERE session_id='a4300000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Cross-user data was exposed';
  END IF;
  BEGIN
    PERFORM public.get_conversation_turn(
      'a4300000-0000-4000-8000-000000000001','a4400000-0000-4000-8000-000000000001',
      'I think we moved in 1974.','en',NULL
    );
    RAISE EXCEPTION 'Cross-user replay unexpectedly allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  turn := public.append_conversation_turn(
    'b4300000-0000-4000-8000-000000000002','b4400000-0000-4000-8000-000000000001',
    'Jag växte upp i Göteborg.','sv',NULL,0,'Tack för att du delar det minnet.',
    '[{"fact_type":"location","value":"Göteborg","evidence":"Jag växte upp i Göteborg","slot":"grew_up_location","uncertain":false}]', '[]'
  );
  IF turn->'message'->>'language' <> 'sv' OR turn->'memories'->0->>'value' <> 'Göteborg' THEN
    RAISE EXCEPTION 'Swedish source/language was not preserved';
  END IF;
END $bob$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{}',true);
DO $anonymous$ BEGIN
  BEGIN
    PERFORM id FROM public.memory_facts;
    RAISE EXCEPTION 'Anonymous fact read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_conversation_turn(
      'a4300000-0000-4000-8000-000000000001','a4400000-0000-4000-8000-000000000001',
      'I think we moved in 1974.','en',NULL
    );
    RAISE EXCEPTION 'Anonymous replay unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS' AS day4_workflow, 'PASS' AS owner_isolation,
       'PRESERVED' AS source_text, 'ROLLED BACK' AS synthetic_data;
