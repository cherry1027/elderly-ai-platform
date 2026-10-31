-- memy-ai-dev only: execute the WHOLE script. Every synthetic write rolls back.
-- SQL-role persistence/security evidence only; no Auth login/JWT, provider call,
-- quality evaluation, PDF rendering, audio blob or physical-device verification.
-- No Auth settings, grants, policies, external functions or paid services change.
BEGIN;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='3s';

DO $preflight$
DECLARE relation text; signature text; total integer;
BEGIN
  -- Only the already reviewed profile/settings signup triggers may run. Abort
  -- on any additional user trigger rather than risk irreversible external work.
  IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal AND t.tgenabled<>'D'
      AND NOT (n.nspname='public' AND p.proname IN ('handle_new_user','handle_new_user_settings'))) THEN
    RAISE EXCEPTION 'Unexpected Auth user trigger; review before running the fixture';
  END IF;
  FOREACH relation IN ARRAY ARRAY['real_ai_operations','real_transcripts','real_conversation_messages',
    'real_memories','real_memory_clarifications','real_memory_revisions','real_story_drafts',
    'real_story_edits','real_speech','real_story_exports'] LOOP
    SELECT count(*) INTO total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=relation AND c.relrowsecurity;
    IF total<>1 OR has_table_privilege('anon','public.'||relation,'SELECT') THEN
      RAISE EXCEPTION 'Real-AI RLS/anonymous privilege preflight failed'; END IF;
    IF relation='real_ai_operations' AND has_table_privilege('authenticated','public.'||relation,'SELECT') THEN
      RAISE EXCEPTION 'Private operation ledger is exposed'; END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['claim_real_ai_operation(uuid,uuid,uuid,text,uuid,text)',
    'complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb)',
    'fail_real_ai_operation(uuid,uuid,uuid,text,boolean)'] LOOP
    IF has_function_privilege('anon','public.'||signature,'EXECUTE')
      OR has_function_privilege('authenticated','public.'||signature,'EXECUTE')
      OR NOT has_function_privilege('service_role','public.'||signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Trusted completion RPC boundary preflight failed'; END IF;
  END LOOP;
END $preflight$;

DO $seed$
DECLARE fixtures jsonb:='[]'; language text; actor uuid; project uuid; session uuid; title text; source text;
BEGIN
  FOREACH language IN ARRAY ARRAY['en','sv'] LOOP
    actor:=gen_random_uuid(); project:=gen_random_uuid(); session:=gen_random_uuid();
    IF EXISTS(SELECT 1 FROM auth.users WHERE id=actor)
      OR EXISTS(SELECT 1 FROM public.profiles WHERE user_id=actor)
      OR EXISTS(SELECT 1 FROM public.user_settings WHERE user_id=actor)
      OR EXISTS(SELECT 1 FROM public.books WHERE id=project)
      OR EXISTS(SELECT 1 FROM public.conversation_sessions WHERE id=session) THEN
      RAISE EXCEPTION 'Synthetic identity collision'; END IF;
    title:=CASE language WHEN 'sv' THEN 'Syntetiskt SQL-test' ELSE 'Synthetic SQL fixture' END;
    source:=CASE language WHEN 'sv' THEN 'Jag bodde i Malmö.' ELSE 'I lived in Malmö.' END;
    INSERT INTO auth.users(id,email) VALUES(actor,'memy-real-ai-'||actor::text||'@example.invalid');
    INSERT INTO public.books(id,user_id,title,language) VALUES(project,actor,title,language);
    INSERT INTO public.conversation_sessions(id,project_id,language) VALUES(session,project,language);
    fixtures:=fixtures||jsonb_build_array(jsonb_build_object('actor',actor,'project_id',project,
      'session_id',session,'language',language,'title',title,'source',source));
  END LOOP;
  PERFORM set_config('memy.real_ai_fixtures',fixtures::text,true);
END $seed$;

SET LOCAL ROLE service_role;
DO $trusted_sources$
DECLARE fixture jsonb; fixtures jsonb:='[]'; claim jsonb; transcript jsonb; turn jsonb; key uuid;
  provenance jsonb:='{"mode":"real","provider":"openai","model":"offline-sql-fixture","version":1}';
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.real_ai_fixtures')::jsonb) LOOP
    key:=gen_random_uuid();
    claim:=public.claim_real_ai_operation((fixture->>'actor')::uuid,(fixture->>'project_id')::uuid,
      (fixture->>'session_id')::uuid,'transcription',key,encode(sha256(convert_to(fixture->>'source','UTF8')),'hex'));
    IF claim->>'claimed'<>'true' THEN RAISE EXCEPTION 'Fresh claim did not yield nonce'; END IF;
    transcript:=public.complete_real_ai_operation((fixture->>'actor')::uuid,(claim->>'operation_id')::uuid,
      (claim->>'claim_token')::uuid,jsonb_build_object('text',fixture->>'source'),provenance);
    fixture:=fixture||jsonb_build_object('transcript_id',transcript->>'transcript_id',
      'operation_id',claim->>'operation_id','action_key',key);
    claim:=public.claim_real_ai_operation((fixture->>'actor')::uuid,(fixture->>'project_id')::uuid,
      (fixture->>'session_id')::uuid,'conversation',gen_random_uuid(),
      encode(sha256(convert_to((transcript->>'transcript_id')||(fixture->>'language'),'UTF8')),'hex'));
    turn:=public.complete_real_ai_operation((fixture->>'actor')::uuid,(claim->>'operation_id')::uuid,
      (claim->>'claim_token')::uuid,jsonb_build_object('source_transcript_id',transcript->>'transcript_id',
        'assistant_text','Synthetic interviewer persistence fixture.',
        'memories',jsonb_build_array(jsonb_build_object('fact_type','location','value','Malmö',
          'evidence','Malmö','slot','home','uncertain',true,
          'clarification_question','Synthetic clarification: confirm this location.'))),provenance);
    IF turn->>'mode'<>'real' OR turn->'memories'->0->>'status'<>'pending'
      OR turn->'user_message'->>'id'<>transcript->>'transcript_id'
      OR turn->'message'->>'language'<>fixture->>'language' THEN
      RAISE EXCEPTION 'Source/turn provenance or language mismatch'; END IF;
    fixture:=fixture||jsonb_build_object('memory_id',turn->'memories'->0->>'id',
      'assistant_id',turn->'message'->>'id');
    fixtures:=fixtures||jsonb_build_array(fixture);
  END LOOP;
  PERFORM set_config('memy.real_ai_fixtures',fixtures::text,true);
END $trusted_sources$;

SET LOCAL ROLE authenticated;
DO $review$
DECLARE fixture jsonb; fixtures jsonb:='[]'; reviewed jsonb; context jsonb; operation jsonb;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.real_ai_fixtures')::jsonb) LOOP
    PERFORM set_config('request.jwt.claim.sub',fixture->>'actor',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',fixture->>'actor','role','authenticated')::text,true);
    IF (SELECT count(*) FROM public.real_transcripts WHERE project_id=(fixture->>'project_id')::uuid)<>1
      OR (SELECT count(*) FROM public.real_conversation_messages WHERE session_id=(fixture->>'session_id')::uuid)<>2 THEN
      RAISE EXCEPTION 'Owned source/turn read failed'; END IF;
    operation:=public.get_real_ai_operation_by_key('transcription',(fixture->>'action_key')::uuid);
    IF operation->>'operation_id'<>fixture->>'operation_id' OR operation ? 'claim_token'
      OR operation ? 'owner_id' OR operation->>'status'<>'completed'
      OR operation->'result'->>'text'<>fixture->>'source' THEN
      RAISE EXCEPTION 'Sanitized action-key recovery failed'; END IF;
    reviewed:=public.review_real_memory((fixture->>'memory_id')::uuid,1,'confirmed','Göteborg');
    IF reviewed->>'value'<>'Malmö' OR reviewed->>'evidence'<>'Malmö'
      OR reviewed->>'corrected_value'<>'Göteborg' OR reviewed->>'version'<>'2'
      OR public.review_real_memory((fixture->>'memory_id')::uuid,1,'confirmed','Göteborg') IS DISTINCT FROM reviewed THEN
      RAISE EXCEPTION 'Review did not preserve extraction/version/replay'; END IF;
    BEGIN
      PERFORM public.review_real_memory((fixture->>'memory_id')::uuid,1,'rejected',NULL);
      RAISE EXCEPTION 'Stale review succeeded';
    EXCEPTION WHEN serialization_failure THEN NULL; END;
    context:=public.get_real_story_context((fixture->>'project_id')::uuid);
    IF context->>'confirmed_count'<>'1' OR jsonb_array_length(context->'blocking_clarifications')<>0 THEN
      RAISE EXCEPTION 'Owned confirmed context is incoherent'; END IF;
    fixtures:=fixtures||jsonb_build_array(fixture||jsonb_build_object('context',context));
  END LOOP;
  PERFORM set_config('memy.real_ai_fixtures',fixtures::text,true);
END $review$;

SET LOCAL ROLE service_role;
DO $trusted_drafts$
DECLARE fixture jsonb; fixtures jsonb:='[]'; claim jsonb; draft jsonb; speech jsonb; content text;
  provenance jsonb:='{"mode":"real","provider":"openai","model":"offline-sql-fixture","version":1}';
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.real_ai_fixtures')::jsonb) LOOP
    content:=CASE fixture->>'language' WHEN 'sv' THEN 'Jag minns Göteborg.' ELSE 'I remember Göteborg.' END;
    claim:=public.claim_real_ai_operation((fixture->>'actor')::uuid,(fixture->>'project_id')::uuid,
      NULL,'generation',gen_random_uuid(),encode(sha256(convert_to((fixture->'context')::text,'UTF8')),'hex'));
    draft:=public.complete_real_ai_operation((fixture->>'actor')::uuid,(claim->>'operation_id')::uuid,
      (claim->>'claim_token')::uuid,jsonb_build_object('content',content,
        'source_memories',fixture->'context'->'source_memories','model_review',jsonb_build_object('unsupported_claims','[]'::jsonb)),provenance);
    IF draft->>'status'<>'needs_review' OR draft->>'mode'<>'real'
      OR draft->'verification'->>'status'<>'needs_review' OR draft->'verification'->>'method'<>'model_review_v1' THEN
      RAISE EXCEPTION 'Scripted real-provider draft was falsely auto-verified'; END IF;
    claim:=public.claim_real_ai_operation((fixture->>'actor')::uuid,(fixture->>'project_id')::uuid,
      (fixture->>'session_id')::uuid,'speech',gen_random_uuid(),repeat('a',64));
    speech:=public.complete_real_ai_operation((fixture->>'actor')::uuid,(claim->>'operation_id')::uuid,
      (claim->>'claim_token')::uuid,jsonb_build_object('assistant_message_id',fixture->>'assistant_id',
        'media_type','audio/wav','audio_sha256',repeat('b',64),'audio_size',44,'expires_at',now()+interval '5 minutes'),provenance);
    fixtures:=fixtures||jsonb_build_array(fixture||jsonb_build_object('draft_id',draft->>'draft_id',
      'original_content',content,'speech_id',speech->>'speech_id'));
  END LOOP;
  PERFORM set_config('memy.real_ai_fixtures',fixtures::text,true);
END $trusted_drafts$;

SET LOCAL ROLE authenticated;
DO $edits_exports$
DECLARE fixture jsonb; fixtures jsonb:='[]'; edited jsonb; metadata jsonb; saved jsonb;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.real_ai_fixtures')::jsonb) LOOP
    PERFORM set_config('request.jwt.claim.sub',fixture->>'actor',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',fixture->>'actor','role','authenticated')::text,true);
    edited:=public.edit_real_story_draft((fixture->>'draft_id')::uuid,1,(fixture->>'original_content')||' Synthetic manual edit.');
    IF edited->>'original_content'<>fixture->>'original_content' OR edited->>'revision'<>'2'
      OR edited->'verification'->>'method'<>'manual_unverified' OR edited->'verification'->>'status'<>'needs_review' THEN
      RAISE EXCEPTION 'Manual edit hid original or review state'; END IF;
    metadata:=public.record_real_story_export((fixture->>'draft_id')::uuid,2,fixture->>'title',false,true,
      1,1024,'memy-real-ai-fixture.pdf','memy_real_pdf_v1');
    saved:=public.get_real_story_export((metadata->>'export_id')::uuid);
    IF saved->>'content'<>edited->>'content' OR saved->'export' IS DISTINCT FROM metadata
      OR metadata->>'content_sha256'<>encode(sha256(convert_to(edited->>'content','UTF8')),'hex') THEN
      RAISE EXCEPTION 'Export snapshot/hash integrity failed'; END IF;
    PERFORM public.edit_real_story_draft((fixture->>'draft_id')::uuid,2,(fixture->>'original_content')||' Later synthetic manual edit.');
    IF public.get_real_story_export((metadata->>'export_id')::uuid) IS DISTINCT FROM saved THEN
      RAISE EXCEPTION 'Historical export changed after later revision'; END IF;
    fixtures:=fixtures||jsonb_build_array(fixture||jsonb_build_object('export_id',metadata->>'export_id'));
  END LOOP;
  PERFORM set_config('memy.real_ai_fixtures',fixtures::text,true);
END $edits_exports$;

DO $cross_owner$
DECLARE fixture jsonb; fixtures jsonb:=current_setting('memy.real_ai_fixtures')::jsonb;
  other_actor text; relation text; visible boolean;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(fixtures) LOOP
    other_actor:=CASE WHEN fixture->>'actor'=fixtures->0->>'actor' THEN fixtures->1->>'actor' ELSE fixtures->0->>'actor' END;
    PERFORM set_config('request.jwt.claim.sub',other_actor,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_actor,'role','authenticated')::text,true);
    IF EXISTS(SELECT 1 FROM public.story_projects WHERE id=(fixture->>'project_id')::uuid)
      OR EXISTS(SELECT 1 FROM public.conversation_sessions WHERE id=(fixture->>'session_id')::uuid) THEN
      RAISE EXCEPTION 'Foreign project/session exposed'; END IF;
    FOREACH relation IN ARRAY ARRAY['real_transcripts','real_conversation_messages','real_memories',
      'real_memory_clarifications','real_memory_revisions','real_story_drafts','real_story_edits','real_speech','real_story_exports'] LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE project_id=$1)',relation)
        INTO visible USING (fixture->>'project_id')::uuid;
      IF visible THEN RAISE EXCEPTION 'Foreign real-AI row exposed'; END IF;
      BEGIN EXECUTE format('UPDATE public.%I SET owner_id=owner_id',relation);
        RAISE EXCEPTION 'Direct real-AI mutation was permitted';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END LOOP;
    BEGIN PERFORM public.review_real_memory((fixture->>'memory_id')::uuid,2,'rejected',NULL);
      RAISE EXCEPTION 'Foreign memory review succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.edit_real_story_draft((fixture->>'draft_id')::uuid,3,'Foreign overwrite');
      RAISE EXCEPTION 'Foreign draft edit succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.get_real_story_context((fixture->>'project_id')::uuid);
      RAISE EXCEPTION 'Foreign context exposed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.get_real_story_export((fixture->>'export_id')::uuid);
      RAISE EXCEPTION 'Foreign export exposed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.get_real_ai_operation((fixture->>'operation_id')::uuid);
      RAISE EXCEPTION 'Foreign operation exposed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.get_real_ai_operation_by_key('transcription',(fixture->>'action_key')::uuid);
      RAISE EXCEPTION 'Foreign action-key result exposed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.complete_real_ai_operation(NULL,NULL,NULL,'{}','{}');
      RAISE EXCEPTION 'Client completion RPC exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.claim_real_ai_operation(NULL,NULL,NULL,NULL,NULL,NULL);
      RAISE EXCEPTION 'Client claim RPC exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN EXECUTE 'SELECT 1 FROM public.real_ai_operations LIMIT 0';
      RAISE EXCEPTION 'Client operation nonce ledger exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $cross_owner$;

SET LOCAL ROLE anon;
DO $anonymous$
DECLARE relation text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  FOREACH relation IN ARRAY ARRAY['real_ai_operations','real_transcripts','real_conversation_messages','real_memories',
    'real_memory_clarifications','real_memory_revisions','real_story_drafts','real_story_edits','real_speech','real_story_exports'] LOOP
    BEGIN EXECUTE format('SELECT 1 FROM public.%I LIMIT 0',relation);
      RAISE EXCEPTION 'Anonymous real-AI relation exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN PERFORM public.complete_real_ai_operation(NULL,NULL,NULL,'{}','{}');
    RAISE EXCEPTION 'Anonymous completion exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_real_ai_operation_by_key('transcription',gen_random_uuid());
    RAISE EXCEPTION 'Anonymous recovery exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;
RESET ROLE;

DO $immutability_and_final_state$
DECLARE fixture jsonb;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.real_ai_fixtures')::jsonb) LOOP
    BEGIN UPDATE public.real_transcripts SET text='Forbidden overwrite' WHERE transcript_id=(fixture->>'transcript_id')::uuid;
      RAISE EXCEPTION 'Original transcript changed'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN UPDATE public.real_conversation_messages SET text='Forbidden overwrite' WHERE id=(fixture->>'assistant_id')::uuid;
      RAISE EXCEPTION 'Original conversation changed'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN UPDATE public.real_memories SET value='Forbidden overwrite' WHERE id=(fixture->>'memory_id')::uuid;
      RAISE EXCEPTION 'Original extracted fact changed'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN UPDATE public.real_story_drafts SET original_content='Forbidden overwrite' WHERE draft_id=(fixture->>'draft_id')::uuid;
      RAISE EXCEPTION 'Original generated draft changed'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN UPDATE public.real_story_exports SET content='Forbidden overwrite' WHERE export_id=(fixture->>'export_id')::uuid;
      RAISE EXCEPTION 'Immutable export audit changed'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    IF (SELECT text FROM public.real_transcripts WHERE transcript_id=(fixture->>'transcript_id')::uuid)<>fixture->>'source'
      OR (SELECT value FROM public.real_memories WHERE id=(fixture->>'memory_id')::uuid)<>'Malmö'
      OR (SELECT corrected_value FROM public.real_memories WHERE id=(fixture->>'memory_id')::uuid)<>'Göteborg'
      OR (SELECT revision FROM public.real_story_drafts WHERE draft_id=(fixture->>'draft_id')::uuid)<>3
      OR (SELECT count(*) FROM public.real_memory_revisions WHERE project_id=(fixture->>'project_id')::uuid)<>1
      OR (SELECT count(*) FROM public.real_memory_clarifications WHERE project_id=(fixture->>'project_id')::uuid AND status='resolved')<>1
      OR (SELECT count(*) FROM public.real_story_edits WHERE project_id=(fixture->>'project_id')::uuid)<>2
      OR (SELECT count(*) FROM public.real_ai_operations WHERE project_id=(fixture->>'project_id')::uuid AND status='completed')<>4 THEN
      RAISE EXCEPTION 'Denied action left partial changes or synthetic history is inconsistent'; END IF;
  END LOOP;
END $immutability_and_final_state$;
ROLLBACK;

SELECT 'PASS' AS real_ai_security, 'SQL ROLE CLAIMS ONLY' AS identity_scope,
  'SCRIPTED SQL ONLY; NO PROVIDER CALLS' AS provider_scope,
  'PASS' AS two_way_owner_isolation, 'PASS' AS source_immutability,
  'PASS' AS memory_review_and_draft_history, 'PASS' AS action_key_recovery,
  'PASS' AS service_only_completion, 'METADATA ONLY' AS pdf_scope,
  'METADATA ONLY; NO AUDIO' AS speech_scope, 'ROLLED BACK' AS synthetic_data,
  'NOT RUN' AS real_auth_jwt_test, 'NOT RUN' AS physical_phone_test;
