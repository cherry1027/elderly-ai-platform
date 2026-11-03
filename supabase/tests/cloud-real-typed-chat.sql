-- REVIEW BEFORE USE: memy-ai-dev (edbkuunyeyxnyenmmqud) ONLY.
-- Execute the WHOLE script after the additive migration is approved/applied.
-- Every fixture write rolls back. No provider/Auth API, email, grant, policy,
-- configuration change or existing-record modification occurs in this script.
-- SQL role assertions are not actual JWT login, provider or phone acceptance.
BEGIN;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='3s';

DO $preflight$
DECLARE signature text; privilege text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.real_text_inputs'::regclass AND relrowsecurity)
    OR NOT has_table_privilege('authenticated','public.real_text_inputs','SELECT')
    OR has_table_privilege('anon','public.real_text_inputs','SELECT') THEN
    RAISE EXCEPTION 'Typed source ownership boundary is unavailable';
  END IF;
  FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
    IF has_table_privilege('authenticated','public.real_text_inputs',privilege)
      OR has_table_privilege('anon','public.real_text_inputs',privilege)
      OR has_table_privilege('service_role','public.real_text_inputs',privilege) THEN
      RAISE EXCEPTION 'Direct typed-source writes must remain revoked';
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['check_real_text_chat_scope(uuid)','get_real_text_chat_sources(uuid,uuid[])'] LOOP
    IF NOT has_function_privilege('authenticated','public.'||signature,'EXECUTE')
      OR has_function_privilege('anon','public.'||signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Owned typed-chat read boundary is unavailable';
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['claim_real_ai_operation(uuid,uuid,uuid,text,uuid,text)',
    'complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb)','fail_real_ai_operation(uuid,uuid,uuid,text,boolean)'] LOOP
    IF has_function_privilege('authenticated','public.'||signature,'EXECUTE')
      OR has_function_privilege('anon','public.'||signature,'EXECUTE')
      OR NOT has_function_privilege('service_role','public.'||signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Trusted completion boundary changed';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='real_conversation_messages' AND column_name='source_text_input_id') THEN
    RAISE EXCEPTION 'Published voice message columns must remain unchanged';
  END IF;
  -- Never run synthetic Auth inserts through an unexpected external-work trigger.
  IF EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal AND t.tgenabled<>'D'
      AND NOT (n.nspname='public' AND p.proname IN ('handle_new_user','handle_new_user_settings'))) THEN
    RAISE EXCEPTION 'Unexpected Auth trigger; independently review before running';
  END IF;
END $preflight$;

DO $fixtures$
DECLARE fixtures jsonb:='[]'; language text; actor uuid; project uuid; session uuid; source text;
BEGIN
  FOREACH language IN ARRAY ARRAY['en','sv'] LOOP
    actor:=gen_random_uuid(); project:=gen_random_uuid(); session:=gen_random_uuid();
    IF EXISTS(SELECT 1 FROM auth.users WHERE id=actor) OR EXISTS(SELECT 1 FROM public.books WHERE id=project)
      OR EXISTS(SELECT 1 FROM public.conversation_sessions WHERE id=session) THEN
      RAISE EXCEPTION 'Synthetic identity collision';
    END IF;
    INSERT INTO auth.users(id,email) VALUES(actor,'memy-typed-sql-'||actor::text||'@example.invalid');
    INSERT INTO public.books(id,user_id,title,language) VALUES(project,actor,'Synthetic typed SQL fixture',language);
    INSERT INTO public.conversation_sessions(id,project_id,language) VALUES(session,project,language);
    source:=CASE language WHEN 'sv' THEN E'  Jag bodde i Malmö.\nÅsa var min vän.  '
      ELSE E'  I lived in Malmö.\nÅsa was my friend.  ' END;
    fixtures:=fixtures||jsonb_build_array(jsonb_build_object('actor',actor,'project_id',project,
      'session_id',session,'language',language,'source',source));
  END LOOP;
  PERFORM set_config('memy.typed_chat_fixtures',fixtures::text,true);
END $fixtures$;

SET LOCAL ROLE service_role;
DO $complete$
DECLARE fixture jsonb; fixtures jsonb:='[]'; operation jsonb; turn jsonb; replay jsonb;
  key uuid; request_hash text;
  provenance jsonb:='{"mode":"real","provider":"openai","model":"offline-sql-fixture","version":1}';
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.typed_chat_fixtures')::jsonb) LOOP
    key:=gen_random_uuid(); request_hash:=encode(sha256(convert_to(key::text||(fixture->>'source'),'UTF8')),'hex');
    operation:=public.claim_real_ai_operation((fixture->>'actor')::uuid,(fixture->>'project_id')::uuid,
      (fixture->>'session_id')::uuid,'conversation',key,request_hash);
    IF operation->>'claimed'<>'true' THEN RAISE EXCEPTION 'Fresh typed claim failed'; END IF;
    -- This failure must roll back raw originals/messages/memories atomically.
    BEGIN
      PERFORM public.complete_real_ai_operation((fixture->>'actor')::uuid,(operation->>'operation_id')::uuid,
        (operation->>'claim_token')::uuid,jsonb_build_object('input_text',fixture->>'source',
          'assistant_text','Synthetic interviewer question.',
          'memories',jsonb_build_array(jsonb_build_object('fact_type','location','value','Invented','evidence','Invented'))),provenance);
      RAISE EXCEPTION 'Invented evidence was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    turn:=public.complete_real_ai_operation((fixture->>'actor')::uuid,(operation->>'operation_id')::uuid,
      (operation->>'claim_token')::uuid,jsonb_build_object('input_text',fixture->>'source',
        'assistant_text','Synthetic interviewer question.',
        'memories',jsonb_build_array(jsonb_build_object('fact_type','location','value','Malmö','evidence','Malmö'))),provenance);
    IF turn->'user_message'->>'text' IS DISTINCT FROM fixture->>'source'
      OR turn->'user_message'->>'id'<>operation->>'operation_id'
      OR turn->'user_message'->>'source_text_input_id'<>operation->>'operation_id'
      OR turn->'user_message'->'source_transcript_id'<>'null'::jsonb
      OR turn->'user_message'->'provenance'<> '{"mode":"original","provider":"user","model":null,"version":1}'::jsonb
      OR turn->'message'->'provenance'<>provenance
      OR turn->'message'->>'language'<>fixture->>'language'
      OR turn->'memories'->0->>'status'<>'pending' THEN
      RAISE EXCEPTION 'Typed source/sequence/language/provenance is incoherent';
    END IF;
    replay:=public.complete_real_ai_operation((fixture->>'actor')::uuid,(operation->>'operation_id')::uuid,
      (operation->>'claim_token')::uuid,jsonb_build_object('input_text','Must not replace original'),provenance);
    IF replay IS DISTINCT FROM turn THEN RAISE EXCEPTION 'Typed completion replay changed'; END IF;
    fixture:=fixture||jsonb_build_object('operation_id',operation->>'operation_id','action_key',key);
    -- The same words are allowed as a later explicit action, not as a retry.
    key:=gen_random_uuid();
    operation:=public.claim_real_ai_operation((fixture->>'actor')::uuid,(fixture->>'project_id')::uuid,
      (fixture->>'session_id')::uuid,'conversation',key,
      encode(sha256(convert_to(key::text||(fixture->>'source'),'UTF8')),'hex'));
    turn:=public.complete_real_ai_operation((fixture->>'actor')::uuid,(operation->>'operation_id')::uuid,
      (operation->>'claim_token')::uuid,jsonb_build_object('input_text',fixture->>'source',
        'assistant_text','Second synthetic question.','memories','[]'::jsonb),provenance);
    IF turn->'user_message'->>'sequence'<>'3' OR turn->'message'->>'sequence'<>'4' THEN
      RAISE EXCEPTION 'Repeated words did not retain one ordered session';
    END IF;
    fixtures:=fixtures||jsonb_build_array(fixture);
  END LOOP;
  PERFORM set_config('memy.typed_chat_fixtures',fixtures::text,true);
END $complete$;

SET LOCAL ROLE authenticated;
DO $owned_reads$
DECLARE fixtures jsonb:=current_setting('memy.typed_chat_fixtures')::jsonb;
  fixture jsonb; foreign_fixture jsonb; scoped jsonb; originals jsonb; recovered jsonb;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(fixtures) LOOP
    PERFORM set_config('request.jwt.claim.sub',fixture->>'actor',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',fixture->>'actor','role','authenticated')::text,true);
    scoped:=public.check_real_text_chat_scope((fixture->>'session_id')::uuid);
    IF scoped IS DISTINCT FROM jsonb_build_object('project_id',fixture->>'project_id',
      'session_id',fixture->>'session_id','language',fixture->>'language','input_limit',4000) THEN
      RAISE EXCEPTION 'Owned content-free preflight mismatch';
    END IF;
    originals:=public.get_real_text_chat_sources((fixture->>'session_id')::uuid,
      ARRAY[(fixture->>'operation_id')::uuid]);
    IF jsonb_array_length(originals->'sources')<>1
      OR originals->'sources'->0->>'text' IS DISTINCT FROM fixture->>'source'
      OR (SELECT count(*) FROM public.real_text_inputs WHERE project_id=(fixture->>'project_id')::uuid)<>2
      OR (SELECT count(*) FROM public.real_conversation_messages WHERE session_id=(fixture->>'session_id')::uuid)<>4
      OR EXISTS(SELECT 1 FROM public.real_transcripts WHERE project_id=(fixture->>'project_id')::uuid) THEN
      RAISE EXCEPTION 'Typed originals were duplicated, normalized or disguised as transcripts';
    END IF;
    recovered:=public.get_real_ai_operation_by_key('conversation',(fixture->>'action_key')::uuid);
    IF recovered->>'operation_id'<>fixture->>'operation_id' OR recovered ? 'claim_token'
      OR recovered->'result'->'user_message'->>'text' IS DISTINCT FROM fixture->>'source' THEN
      RAISE EXCEPTION 'Owned recovery contract mismatch';
    END IF;
    SELECT value INTO foreign_fixture FROM jsonb_array_elements(fixtures) WHERE value->>'actor'<>fixture->>'actor';
    IF EXISTS(SELECT 1 FROM public.real_text_inputs WHERE owner_id=(foreign_fixture->>'actor')::uuid)
      OR EXISTS(SELECT 1 FROM public.real_conversation_messages WHERE project_id=(foreign_fixture->>'project_id')::uuid) THEN
      RAISE EXCEPTION 'Cross-user source/message read leaked';
    END IF;
    BEGIN
      PERFORM public.check_real_text_chat_scope((foreign_fixture->>'session_id')::uuid);
      RAISE EXCEPTION 'Cross-user session preflight succeeded';
    EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN
      PERFORM public.get_real_text_chat_sources((fixture->>'session_id')::uuid,
        ARRAY[(foreign_fixture->>'operation_id')::uuid]);
      RAISE EXCEPTION 'Cross-user original hydration succeeded';
    EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN
      UPDATE public.real_text_inputs SET text='Forbidden' WHERE input_id=(fixture->>'operation_id')::uuid;
      RAISE EXCEPTION 'Authenticated typed source update succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $owned_reads$;
RESET ROLE;

DO $immutable$
DECLARE fixture jsonb;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.typed_chat_fixtures')::jsonb) LOOP
    BEGIN
      UPDATE public.real_text_inputs SET text='Forbidden' WHERE input_id=(fixture->>'operation_id')::uuid;
      RAISE EXCEPTION 'Typed original mutability guard failed';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  END LOOP;
END $immutable$;

SELECT 'PASS: rollback-only bilingual typed-source ownership, exact wording, atomicity and replay checks' AS sanitized_result,
  'SQL roles only; no provider, Auth API/JWT login, billing or phone verification' AS evidence_boundary;
ROLLBACK;
