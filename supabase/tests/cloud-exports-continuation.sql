-- Dedicated development only. Synthetic subjects, no passwords/emails or PDFs.
-- This checks SQL metadata/continuation, not PDF rendering or a real Auth login.
BEGIN;
DO $collision$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    'a6100000-0000-4000-8000-000000000001', 'b6100000-0000-4000-8000-000000000002'
  )) OR EXISTS(SELECT 1 FROM public.books WHERE id IN (
    'a6200000-0000-4000-8000-000000000001','b6200000-0000-4000-8000-000000000002'
  )) THEN RAISE EXCEPTION 'Day 6 synthetic identity collision'; END IF;
END $collision$;
INSERT INTO auth.users(id,email) VALUES
 ('a6100000-0000-4000-8000-000000000001','memy-day6-a@example.invalid'),
 ('b6100000-0000-4000-8000-000000000002','memy-day6-b@example.invalid');
INSERT INTO public.books(id,user_id,title,language) VALUES
 ('a6200000-0000-4000-8000-000000000001','a6100000-0000-4000-8000-000000000001','Synthetic Day 6 English','en'),
 ('b6200000-0000-4000-8000-000000000002','b6100000-0000-4000-8000-000000000002','Syntetiska minnen från Malmö','sv');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $alice$
DECLARE
  resumed jsonb; turn jsonb; context jsonb; draft jsonb; edited jsonb;
  export_context jsonb; exported jsonb; latest jsonb; versions jsonb;
  session_id uuid; next_session_id uuid; draft_id uuid; year_id uuid;
  export_id uuid; first_source uuid; original_edit text;
BEGIN
  resumed := public.continue_story_project('a6200000-0000-4000-8000-000000000001');
  session_id := (resumed->'session'->>'id')::uuid;
  IF (resumed->>'session_created')::boolean IS NOT TRUE OR resumed->'latest_draft'<>'null'::jsonb
      OR (resumed->>'generation_triggered')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Empty project continuation was not explicit/non-generating'; END IF;
  resumed := public.continue_story_project('a6200000-0000-4000-8000-000000000001');
  IF (resumed->>'session_created')::boolean IS NOT FALSE
      OR resumed->'session'->>'id'<>session_id::text THEN
    RAISE EXCEPTION 'Continuation duplicated an active session'; END IF;
  turn := public.append_conversation_turn(session_id,
    'a6400000-0000-4000-8000-000000000001','I grew up in Malmö. I moved in 1974.','en',NULL,0,
    'Thank you for sharing these memories.',
    '[{"fact_type":"location","value":"Malmö","evidence":"I grew up in Malmö","slot":"grew_up_location","uncertain":false},
      {"fact_type":"event","value":"1974","evidence":"I moved in 1974","year":1974,"slot":"move","uncertain":false}]','[]');
  first_source := (turn->'user_message'->>'id')::uuid;
  FOR draft_id IN SELECT f.id FROM public.memory_facts f
    WHERE f.project_id='a6200000-0000-4000-8000-000000000001'
  LOOP PERFORM public.resolve_memory_fact(draft_id,'confirmed',NULL,1); END LOOP;
  SELECT f.id INTO year_id FROM public.memory_facts f
    WHERE f.project_id='a6200000-0000-4000-8000-000000000001' AND f.slot='move';
  context := public.load_story_context('a6200000-0000-4000-8000-000000000001');
  draft := public.save_story_generation('a6200000-0000-4000-8000-000000000001',
    'a6500000-0000-4000-8000-000000000001','en','warm',true,
    context->>'context_token',context->>'canonical_content');
  draft_id := (draft->>'draft_id')::uuid;
  original_edit := (draft->>'content') || E'\n\nThis is my own wording.';
  edited := public.edit_story_draft(draft_id,1,original_edit);
  export_context := public.load_story_export_context(draft_id);
  IF export_context->'draft'->>'content'<>original_edit
      OR export_context->'draft'->>'revision'<>'2' THEN
    RAISE EXCEPTION 'Export did not select the latest saved manual revision'; END IF;
  exported := public.record_story_export(draft_id,2,'Synthetic Day 6 English',true,true,
    'memy_pdf_v1','memy-synthetic-day-6-english-v1-r2.pdf',12345,2);
  export_id := (exported->>'export_id')::uuid;
  PERFORM set_config('memy.day6_export_id',export_id::text,true);
  PERFORM set_config('memy.day6_draft_id',draft_id::text,true);
  IF exported->>'content_sha256'<>encode(sha256(convert_to(original_edit,'UTF8')),'hex')
      OR exported->>'draft_revision'<>'2' THEN
    RAISE EXCEPTION 'Export audit was not bound to the saved revision'; END IF;
  IF public.record_story_export(draft_id,2,'Synthetic Day 6 English',true,true,
      'memy_pdf_v1','memy-synthetic-day-6-english-v1-r2.pdf',12345,2) IS DISTINCT FROM exported
      OR jsonb_array_length(public.list_story_exports('a6200000-0000-4000-8000-000000000001',50,0))<>1 THEN
    RAISE EXCEPTION 'Repeated export duplicated immutable audit metadata'; END IF;
  PERFORM public.edit_story_draft(draft_id,2,(draft->>'content') || E'\n\nMy newer wording.');
  IF public.get_story_export(export_id)->>'content'<>original_edit
      OR public.get_story_export(export_id)->>'content'<>original_edit THEN
    RAISE EXCEPTION 'Repeated download lost the selected historical revision'; END IF;
  BEGIN
    PERFORM public.record_story_export(draft_id,2,'Synthetic Day 6 English',true,true,
      'memy_pdf_v1','memy-synthetic-day-6-english-v1-r2.pdf',12345,2);
    RAISE EXCEPTION 'A stale revision was recorded as a fresh export';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  UPDATE public.conversation_sessions AS s SET status='completed',ended_at=now() WHERE s.id=session_id;
  resumed := public.continue_story_project('a6200000-0000-4000-8000-000000000001');
  next_session_id := (resumed->'session'->>'id')::uuid;
  IF next_session_id=session_id OR (resumed->>'session_created')::boolean IS NOT TRUE
      OR resumed->'latest_draft'->>'revision'<>'3'
      OR (resumed->>'generation_triggered')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'Continue overwrote a draft or reopened a completed session'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version) ORDER BY f.id)
    INTO versions FROM public.memory_facts f
    WHERE f.project_id='a6200000-0000-4000-8000-000000000001' AND f.status<>'rejected';
  turn := public.append_conversation_turn(next_session_id,
    'a6400000-0000-4000-8000-000000000002','My name is Ada.','en',NULL,0,
    'Thank you, Ada.',
    '[{"fact_type":"person","value":"Ada","evidence":"My name is Ada","slot":"person:self_name","uncertain":false}]',versions);
  PERFORM public.resolve_memory_fact((turn->'memories'->0->>'id')::uuid,'confirmed',NULL,1);
  context := public.load_story_context('a6200000-0000-4000-8000-000000000001');
  latest := public.save_story_generation('a6200000-0000-4000-8000-000000000001',
    'a6500000-0000-4000-8000-000000000002','en','warm',true,
    context->>'context_token',context->>'canonical_content');
  IF latest->>'version'<>'2' OR strpos(latest->>'content','My name is Ada.')=0
      OR public.get_story_draft(draft_id)->>'revision'<>'3'
      OR public.get_story_export(export_id)->>'content'<>original_edit THEN
    RAISE EXCEPTION 'New generation failed to preserve earlier drafts, edits or exports'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version) ORDER BY f.id)
    INTO versions FROM public.memory_facts f
    WHERE f.project_id='a6200000-0000-4000-8000-000000000001' AND f.status<>'rejected';
  turn := public.append_conversation_turn(next_session_id,
    'a6400000-0000-4000-8000-000000000003','Actually, it was 1975.','en',NULL,
    (turn->'message'->>'sequence')::bigint,'Was it 1975 rather than 1974?',
    jsonb_build_array(jsonb_build_object('fact_type','event','value','1975','evidence','1975',
      'year',1975,'slot','move','uncertain',true,'clarification_question','Was it 1975 rather than 1974?',
      'conflicts_with_fact_id',year_id)),versions);
  context := public.load_story_context('a6200000-0000-4000-8000-000000000001');
  IF jsonb_array_length(context->'blocking_clarifications')=0 THEN
    RAISE EXCEPTION 'Contradictory continuation was not sent for clarification'; END IF;
  BEGIN
    PERFORM public.save_story_generation('a6200000-0000-4000-8000-000000000001',
      'a6500000-0000-4000-8000-000000000003','en','warm',true,
      context->>'context_token',context->>'canonical_content');
    RAISE EXCEPTION 'Contradictory continuation became a verified draft';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  IF (SELECT m.original_text FROM public.conversation_messages m WHERE m.id=first_source)
      <> 'I grew up in Malmö. I moved in 1974.' THEN
    RAISE EXCEPTION 'Continuation altered original transcripts'; END IF;
  BEGIN UPDATE public.story_exports e SET filename='memy-changed.pdf' WHERE e.id=export_id;
    RAISE EXCEPTION 'Direct audit mutation unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $alice$;

SELECT set_config('request.jwt.claims','{"sub":"b6100000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $bob$
DECLARE resumed jsonb; turn jsonb; context jsonb; draft jsonb; exported jsonb;
BEGIN
  IF EXISTS(SELECT 1 FROM public.story_exports WHERE project_id='a6200000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Cross-user export metadata was exposed'; END IF;
  BEGIN PERFORM public.get_story_export(current_setting('memy.day6_export_id')::uuid);
    RAISE EXCEPTION 'Cross-user historical export was exposed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.load_story_export_context(current_setting('memy.day6_draft_id')::uuid);
    RAISE EXCEPTION 'Cross-user draft export context was exposed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.continue_story_project('a6200000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Cross-user continuation unexpectedly allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN PERFORM public.list_story_exports('a6200000-0000-4000-8000-000000000001',50,0);
    RAISE EXCEPTION 'Cross-user export list unexpectedly allowed';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  resumed := public.continue_story_project('b6200000-0000-4000-8000-000000000002');
  turn := public.append_conversation_turn((resumed->'session'->>'id')::uuid,
    'b6400000-0000-4000-8000-000000000001','Jag växte upp i Malmö.','sv',NULL,0,
    'Tack för att du delar det minnet.',
    '[{"fact_type":"location","value":"Malmö","evidence":"Jag växte upp i Malmö","slot":"grew_up_location","uncertain":false}]','[]');
  PERFORM public.resolve_memory_fact((turn->'memories'->0->>'id')::uuid,'confirmed',NULL,1);
  context := public.load_story_context('b6200000-0000-4000-8000-000000000002');
  draft := public.save_story_generation('b6200000-0000-4000-8000-000000000002',
    'b6500000-0000-4000-8000-000000000001','sv','warm',true,
    context->>'context_token',context->>'canonical_content');
  exported := public.record_story_export((draft->>'draft_id')::uuid,1,'Syntetiska minnen från Malmö',
    true,true,'memy_pdf_v1','memy-syntetiska-minnen-fran-malmo-v1-r1.pdf',12345,2);
  IF exported->>'language'<>'sv' OR public.get_story_export((exported->>'export_id')::uuid)->>'content'
      <> 'Jag växte upp i Malmö.' THEN RAISE EXCEPTION 'Swedish export metadata lost original text'; END IF;
END $bob$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{}',true);
DO $anonymous$ BEGIN
  BEGIN PERFORM id FROM public.story_exports; RAISE EXCEPTION 'Anonymous export read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.continue_story_project('a6200000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Anonymous continuation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS' AS day6_metadata_workflow,'PASS' AS continuation,
  'PRESERVED' AS historical_revision,'PASS' AS owner_isolation,'ROLLED BACK' AS synthetic_data;
