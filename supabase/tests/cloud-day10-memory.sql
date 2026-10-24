-- Dedicated memy-ai-dev only; verify the Dashboard project before execution.
-- Full script only: synthetic subjects; no password setup, email dispatch or provider calls.
-- Sequential optimistic-update checks are NOT a multi-connection race benchmark.
BEGIN;

DO $collision$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    'da100000-0000-4000-8000-000000000001', 'db100000-0000-4000-8000-000000000002'
  )) OR EXISTS (SELECT 1 FROM public.books WHERE id IN (
    'da200000-0000-4000-8000-000000000001', 'db200000-0000-4000-8000-000000000002'
  )) THEN RAISE EXCEPTION 'Day 10 synthetic identity collision'; END IF;
END $collision$;

INSERT INTO auth.users(id,email) VALUES
  ('da100000-0000-4000-8000-000000000001','memy-day10-a@example.invalid'),
  ('db100000-0000-4000-8000-000000000002','memy-day10-b@example.invalid');
INSERT INTO public.books(id,user_id,title,language) VALUES
  ('da200000-0000-4000-8000-000000000001','da100000-0000-4000-8000-000000000001','Fictional Day 10 English','en'),
  ('db200000-0000-4000-8000-000000000002','db100000-0000-4000-8000-000000000002','Fiktivt Day 10 Swedish','sv');
SELECT set_config('memy.day10_sources','[]',true);

SET LOCAL ROLE authenticated;
DO $workflow$
DECLARE
  scenario record;
  resumed jsonb; turn jsonb; correction_turn jsonb; reviewed jsonb;
  context jsonb; draft jsonb; versions jsonb; stale_versions jsonb;
  initial_session uuid; active_session uuid; move_id uuid; name_id uuid;
  redundant_id uuid; pending_id uuid; source_id uuid; correction_source_id uuid;
  source_text text; correction_text text; move_evidence text; name_evidence text;
  pending_text text; expected_story text; switched_text text;
  first_review jsonb; history_sequences jsonb;
BEGIN
  FOR scenario IN SELECT * FROM (VALUES
    ('da100000-0000-4000-8000-000000000001'::uuid,
     'da200000-0000-4000-8000-000000000001'::uuid,
     'db100000-0000-4000-8000-000000000002'::uuid,'en'::text),
    ('db100000-0000-4000-8000-000000000002'::uuid,
     'db200000-0000-4000-8000-000000000002'::uuid,
     'da100000-0000-4000-8000-000000000001'::uuid,'sv'::text)
  ) AS fixtures(actor,project_id,other_actor,language)
  LOOP
    PERFORM set_config('request.jwt.claim.sub',scenario.actor::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object(
      'sub',scenario.actor,'role','authenticated')::text,true);
    move_evidence := CASE scenario.language WHEN 'sv'
      THEN 'Jag tror att vi flyttade 1974' ELSE 'I think we moved in 1974' END;
    name_evidence := CASE scenario.language WHEN 'sv'
      THEN 'Jag heter Ada' ELSE 'My name is Ada' END;
    source_text := 'Fictional Day 10 / Fiktivt Day 10.' || E'\n' ||
      move_evidence || '. ' || name_evidence || '.';
    correction_text := CASE scenario.language WHEN 'sv'
      THEN 'Egentligen var det 1975.' ELSE 'Actually, it was 1975.' END;
    expected_story := CASE scenario.language WHEN 'sv'
      THEN 'Jag flyttade år 1975.' ELSE 'I moved in 1975.' END;
    pending_text := CASE scenario.language WHEN 'sv'
      THEN 'Jag kände mig glad.' ELSE 'I felt happy.' END;

    resumed := public.continue_story_project(scenario.project_id);
    initial_session := (resumed->'session'->>'id')::uuid;
    IF resumed->>'session_created'<>'true'
       OR resumed->>'generation_triggered'<>'false'
       OR resumed->'latest_draft'<>'null'::jsonb THEN
      RAISE EXCEPTION 'Empty continuation did not create only a session'; END IF;
    turn := public.append_conversation_turn(initial_session,gen_random_uuid(),
      source_text,scenario.language,NULL,0,
      CASE scenario.language WHEN 'sv' THEN 'Var det 1974?' ELSE 'Was it 1974?' END,
      jsonb_build_array(
        jsonb_build_object('fact_type','event','value','1974','evidence',move_evidence,
          'year',1974,'slot','move','uncertain',true,'clarification_question',
          CASE scenario.language WHEN 'sv' THEN 'Var det 1974?' ELSE 'Was it 1974?' END),
        jsonb_build_object('fact_type','person','value','Ada','evidence',name_evidence,
          'slot','person:self_name','uncertain',false)), '[]');
    source_id := (turn->'user_message'->>'id')::uuid;
    history_sequences := jsonb_build_array(turn->'user_message'->'sequence',turn->'message'->'sequence');
    move_id := (turn->'memories'->0->>'id')::uuid;
    name_id := (turn->'memories'->1->>'id')::uuid;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version)
      ORDER BY f.id),'[]'::jsonb) INTO versions FROM public.memory_facts f
      WHERE f.project_id=scenario.project_id AND f.status<>'rejected';
    correction_turn := public.append_conversation_turn(initial_session,gen_random_uuid(),
      correction_text,scenario.language,NULL,(turn->'message'->>'sequence')::bigint,
      CASE scenario.language WHEN 'sv' THEN 'Ska jag använda 1975?' ELSE 'Should I use 1975?' END,
      jsonb_build_array(jsonb_build_object('fact_type','event','value','1975',
        'evidence',correction_text,'year',1975,'slot','move','uncertain',true,
        'clarification_question',CASE scenario.language WHEN 'sv'
          THEN 'Ska jag använda 1975?' ELSE 'Should I use 1975?' END,
        'conflicts_with_fact_id',move_id)),versions);
    redundant_id := (correction_turn->'memories'->0->>'id')::uuid;
    correction_source_id := (correction_turn->'user_message'->>'id')::uuid;
    history_sequences := history_sequences || jsonb_build_array(
      correction_turn->'user_message'->'sequence',correction_turn->'message'->'sequence');
    context := public.load_story_context(scenario.project_id);
    IF context->>'confirmed_count'<>'0'
       OR jsonb_array_length(context->'blocking_clarifications')<>1 THEN
      RAISE EXCEPTION 'Unreviewed conflicting dates were not isolated'; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version)
      ORDER BY f.id),'[]'::jsonb) INTO stale_versions FROM public.memory_facts f
      WHERE f.project_id=scenario.project_id AND f.status<>'rejected';

    first_review := public.resolve_memory_fact(move_id,'confirmed','1975',1);
    IF first_review->>'version'<>'2' OR first_review->>'value'<>'1974'
       OR first_review->>'year'<>'1974' OR first_review->>'corrected_value'<>'1975'
       OR first_review->>'source_message_id'<>source_id::text THEN
      RAISE EXCEPTION 'Correction changed original extraction or provenance'; END IF;
    IF public.resolve_memory_fact(move_id,'confirmed','1975',1) IS DISTINCT FROM first_review
       OR public.resolve_memory_fact(move_id,'confirmed','1975',2) IS DISTINCT FROM first_review THEN
      RAISE EXCEPTION 'Duplicate/no-op confirmation changed the result'; END IF;
    -- Two logical actions sharing expected version 1: the first won above.
    -- This is deliberately sequential; PGlite is not a multi-session race test.
    BEGIN PERFORM public.resolve_memory_fact(move_id,'rejected',NULL,1);
      RAISE EXCEPTION 'Opposing stale review overwrote the winning correction';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN PERFORM public.resolve_memory_fact(move_id,'confirmed','1976',1);
      RAISE EXCEPTION 'Different stale correction unexpectedly succeeded';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    reviewed := public.resolve_memory_fact(redundant_id,'rejected',NULL,1);
    IF public.resolve_memory_fact(redundant_id,'rejected',NULL,1) IS DISTINCT FROM reviewed THEN
      RAISE EXCEPTION 'Duplicate rejection changed the result'; END IF;
    PERFORM public.resolve_memory_fact(name_id,'rejected',NULL,1);
    context := public.load_story_context(scenario.project_id);
    IF context->>'canonical_content'<>expected_story
       OR jsonb_array_length(context->'source_memories')<>1
       OR context->'source_memories'->0->>'memory_id'<>move_id::text
       OR jsonb_array_length(context->'blocking_clarifications')<>0
       OR jsonb_array_length(context->'excluded_memories')<>2 THEN
      RAISE EXCEPTION 'Corrected/rejected review did not produce a safe story context'; END IF;

    resumed := public.continue_story_project(scenario.project_id);
    IF resumed->'session'->>'id'<>initial_session::text
       OR resumed->>'session_created'<>'false'
       OR resumed->>'generation_triggered'<>'false' THEN
      RAISE EXCEPTION 'Continuation did not reuse the active session'; END IF;
    UPDATE public.conversation_sessions SET status='completed',ended_at=now()
      WHERE id=initial_session;
    resumed := public.continue_story_project(scenario.project_id);
    active_session := (resumed->'session'->>'id')::uuid;
    IF active_session=initial_session OR resumed->>'session_created'<>'true'
       OR resumed->>'generation_triggered'<>'false'
       OR (SELECT status FROM public.conversation_sessions WHERE id=initial_session)<>'completed'
       OR (SELECT count(*) FROM public.story_drafts WHERE project_id=scenario.project_id)<>0 THEN
      RAISE EXCEPTION 'Resume reopened an old session or silently generated a draft'; END IF;
    resumed := public.continue_story_project(scenario.project_id);
    IF resumed->'session'->>'id'<>active_session::text
       OR resumed->>'session_created'<>'false' THEN
      RAISE EXCEPTION 'Repeated Continue duplicated the new active session'; END IF;
    context := public.load_story_context(scenario.project_id);
    IF context->>'canonical_content'<>expected_story THEN
      RAISE EXCEPTION 'New session lost the earlier reviewed project memory'; END IF;
    BEGIN
      PERFORM public.append_conversation_turn(active_session,gen_random_uuid(),
        'Computed before the earlier session was reviewed.',scenario.language,NULL,0,
        'Stale context must never commit.','[]',stale_versions);
      RAISE EXCEPTION 'Cross-session stale memory vector unexpectedly committed';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    IF EXISTS(SELECT 1 FROM public.conversation_messages WHERE session_id=active_session) THEN
      RAISE EXCEPTION 'Rejected context append left a partial original'; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version)
      ORDER BY f.id),'[]'::jsonb) INTO versions FROM public.memory_facts f
      WHERE f.project_id=scenario.project_id AND f.status<>'rejected';
    turn := public.append_conversation_turn(active_session,gen_random_uuid(),
      pending_text,scenario.language,NULL,0,
      CASE scenario.language WHEN 'sv' THEN 'Tack för minnet.' ELSE 'Thank you for the memory.' END,
      jsonb_build_array(jsonb_build_object('fact_type','emotion','value',
        CASE scenario.language WHEN 'sv' THEN 'glad' ELSE 'happy' END,
        'evidence',rtrim(pending_text,'.'),'slot','emotion','uncertain',false)),versions);
    pending_id := (turn->'memories'->0->>'id')::uuid;
    context := public.load_story_context(scenario.project_id);
    IF context->>'canonical_content'<>expected_story
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(context->'excluded_memories') e
         WHERE e->>'memory_id'=pending_id::text AND e->>'reason'='pending') THEN
      RAISE EXCEPTION 'Pending resumed-session memory entered generated content'; END IF;

    switched_text := CASE scenario.language WHEN 'en'
      THEN 'Jag berättar lite på svenska.' ELSE 'I briefly speak English.' END;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version)
      ORDER BY f.id),'[]'::jsonb) INTO versions FROM public.memory_facts f
      WHERE f.project_id=scenario.project_id AND f.status<>'rejected';
    turn := public.append_conversation_turn(active_session,gen_random_uuid(),
      switched_text,scenario.language,NULL,(turn->'message'->>'sequence')::bigint,
      CASE scenario.language WHEN 'sv' THEN 'Jag lyssnar.' ELSE 'I am listening.' END,
      '[]',versions);
    IF turn->'message'->>'language'<>scenario.language
       OR (SELECT language FROM public.books WHERE id=scenario.project_id)<>scenario.language
       OR (SELECT language FROM public.conversation_sessions WHERE id=active_session)<>scenario.language THEN
      RAISE EXCEPTION 'Code-switched source changed the persisted language'; END IF;
    IF EXISTS(SELECT 1 FROM public.story_drafts WHERE project_id=scenario.project_id) THEN
      RAISE EXCEPTION 'New conversation text silently regenerated a draft'; END IF;
    context := public.load_story_context(scenario.project_id);
    draft := public.save_story_generation(scenario.project_id,gen_random_uuid(),
      scenario.language,'warm',true,context->>'context_token',context->>'canonical_content');
    IF draft->>'content'<>expected_story OR draft->>'language'<>scenario.language
       OR draft->'verification'->>'status'<>'passed'
       OR jsonb_array_length(draft->'source_memories')<>1 THEN
      RAISE EXCEPTION 'Generated story included unconfirmed/rejected/old values'; END IF;
    resumed := public.continue_story_project(scenario.project_id);
    IF resumed->>'generation_triggered'<>'false'
       OR resumed->'latest_draft'->>'draft_id'<>draft->>'draft_id'
       OR (SELECT count(*) FROM public.story_drafts WHERE project_id=scenario.project_id)<>1 THEN
      RAISE EXCEPTION 'Continue after generation replaced the saved autobiography'; END IF;

    IF (SELECT original_text FROM public.conversation_messages WHERE id=source_id)<>source_text
       OR (SELECT original_text FROM public.conversation_messages WHERE id=correction_source_id)<>correction_text
       OR (SELECT count(*) FROM public.conversation_message_history WHERE session_id=initial_session)<>4
       OR (SELECT jsonb_agg(sequence ORDER BY sequence) FROM public.conversation_message_history
           WHERE session_id=initial_session) IS DISTINCT FROM history_sequences
       OR (SELECT corrected_value FROM public.memory_facts WHERE id=move_id)<>'1975' THEN
      RAISE EXCEPTION 'Review/resumption overwrote or reordered immutable history'; END IF;
    PERFORM set_config('memy.day10_sources',(
      current_setting('memy.day10_sources')::jsonb ||
      jsonb_build_array(source_id,correction_source_id))::text,true);

    PERFORM set_config('request.jwt.claim.sub',scenario.other_actor::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object(
      'sub',scenario.other_actor,'role','authenticated')::text,true);
    IF EXISTS(SELECT 1 FROM public.memory_facts WHERE project_id=scenario.project_id)
       OR EXISTS(SELECT 1 FROM public.conversation_message_history
         WHERE session_id IN (initial_session,active_session))
       OR EXISTS(SELECT 1 FROM public.memory_clarifications WHERE session_id=initial_session) THEN
      RAISE EXCEPTION 'Another user could read private memory/history'; END IF;
    BEGIN PERFORM public.load_story_context(scenario.project_id);
      RAISE EXCEPTION 'Foreign confirmed story context was exposed';
    EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.resolve_memory_fact(move_id,'rejected',NULL,2);
      RAISE EXCEPTION 'Foreign review was permitted';
    EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.append_conversation_turn(active_session,gen_random_uuid(),
      'Foreign text',scenario.language,NULL,4,'Foreign reply','[]','[]');
      RAISE EXCEPTION 'Foreign conversation append was permitted';
    EXCEPTION WHEN no_data_found THEN NULL; END;
  END LOOP;
END $workflow$;

RESET ROLE;
DO $audit$
DECLARE fixture_fact record; original_id text;
BEGIN
  FOR fixture_fact IN SELECT f.id FROM public.memory_facts f
    WHERE f.project_id IN ('da200000-0000-4000-8000-000000000001',
                          'db200000-0000-4000-8000-000000000002')
      AND f.status IN ('confirmed','rejected')
  LOOP
    IF (SELECT count(*) FROM public.memory_fact_revisions WHERE fact_id=fixture_fact.id)<>1 THEN
      RAISE EXCEPTION 'Duplicate or failed review added an audit revision'; END IF;
  END LOOP;
  FOR original_id IN SELECT jsonb_array_elements_text(current_setting('memy.day10_sources')::jsonb)
  LOOP
    BEGIN UPDATE public.conversation_messages SET original_text='Overwritten' WHERE id=original_id::uuid;
      RAISE EXCEPTION 'Original transcript mutation unexpectedly succeeded';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  END LOOP;
END $audit$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
DO $anonymous$ BEGIN
  BEGIN PERFORM 1 FROM public.memory_facts;
    RAISE EXCEPTION 'Anonymous memory read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.load_story_context('da200000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Anonymous story context unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;
RESET ROLE;
ROLLBACK;

SELECT 'PASS' AS day10_memory_workflow, 'PASS' AS review_retry_audit,
       'BLOCKED' AS stale_context, 'PASS' AS owner_isolation,
       'PRESERVED' AS source_and_history, 'PASS' AS language_contract,
       'ROLLED BACK' AS synthetic_data;
