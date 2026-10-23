-- Dedicated memy-ai-dev only. Execute the WHOLE script, never a selection.
-- Synthetic subjects and SQL role claims only: NOT a real Auth/JWT/mobile test.
-- No storage uploads, external-function invocation, paid providers or policy changes.
-- All fixture writes and local settings roll back. Sequence values are not transactional.
-- Inspect enabled auth.users triggers before hosted use; abort if any sends external work.
BEGIN;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '3s';

DO $collision$
DECLARE actors uuid[] := ARRAY[
  'ea140000-0000-4000-8000-000000000001'::uuid,
  'eb140000-0000-4000-8000-000000000002'::uuid];
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id=ANY(actors)
      OR email IN ('memy-day14-en@example.invalid','memy-day14-sv@example.invalid'))
     OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id=ANY(actors))
     OR EXISTS (SELECT 1 FROM public.user_settings WHERE user_id=ANY(actors))
     OR EXISTS (SELECT 1 FROM public.books WHERE id IN (
       'ea240000-0000-4000-8000-000000000001','eb240000-0000-4000-8000-000000000002')) THEN
    RAISE EXCEPTION 'Day 14 synthetic identity collision';
  END IF;
END $collision$;

DO $catalog$
DECLARE expected_tables text[] := ARRAY[
  'profiles','books','user_settings','conversation_sessions','conversation_messages',
  'audio_transcription_requests','memory_facts','memory_clarifications','memory_fact_revisions',
  'conversation_turns','story_drafts','story_generation_requests','draft_source_memories',
  'story_verification_results','story_edit_history','story_exports'];
  expected_views text[] := ARRAY['story_projects','audio_transcripts','conversation_message_history'];
  rpc_names text[] := ARRAY[
    'claim_audio_transcription','complete_audio_transcription','fail_audio_transcription',
    'get_conversation_turn','append_conversation_turn','resolve_memory_fact','load_story_context',
    'get_story_generation','save_story_generation','get_story_draft','list_story_drafts',
    'edit_story_draft','get_story_project_verification','list_story_edit_history',
    'load_story_export_context','record_story_export','get_story_export','list_story_exports',
    'continue_story_project'];
  total integer; safe integer;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE c.relrowsecurity) INTO total,safe
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(expected_tables);
  IF total<>cardinality(expected_tables) OR safe<>total THEN
    RAISE EXCEPTION 'Core table RLS catalog check failed'; END IF;
  SELECT count(*),count(*) FILTER (WHERE 'security_invoker=true'=ANY(c.reloptions)) INTO total,safe
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(expected_views);
  IF total<>cardinality(expected_views) OR safe<>total THEN
    RAISE EXCEPTION 'Public view invoker catalog check failed'; END IF;
  SELECT count(*),count(*) FILTER (WHERE p.prosecdef
      AND 'search_path=pg_catalog, public'=ANY(p.proconfig)
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')) INTO total,safe
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY(rpc_names);
  IF total<>cardinality(rpc_names) OR safe<>total THEN
    RAISE EXCEPTION 'Core RPC ownership boundary catalog check failed'; END IF;
END $catalog$;

INSERT INTO auth.users(id,email) VALUES
  ('ea140000-0000-4000-8000-000000000001','memy-day14-en@example.invalid'),
  ('eb140000-0000-4000-8000-000000000002','memy-day14-sv@example.invalid');
INSERT INTO public.books(id,user_id,title,language) VALUES
  ('ea240000-0000-4000-8000-000000000001','ea140000-0000-4000-8000-000000000001','Fictional Day 14','en'),
  ('eb240000-0000-4000-8000-000000000002','eb140000-0000-4000-8000-000000000002','Fiktiv Day 14','sv');
DO $settings$ BEGIN PERFORM set_config('memy.day14_fixtures','[]',true); END $settings$;

SET LOCAL ROLE authenticated;
DO $journey$
DECLARE scenario record; resumed jsonb; turn jsonb; reviewed jsonb; context jsonb;
  draft jsonb; edited jsonb; exported jsonb; source_text text; correction text;
  session_id uuid; source_id uuid; memory_id uuid; draft_id uuid; original_title text;
BEGIN
  FOR scenario IN SELECT * FROM (VALUES
    ('ea140000-0000-4000-8000-000000000001'::uuid,
     'ea240000-0000-4000-8000-000000000001'::uuid,'en'::text),
    ('eb140000-0000-4000-8000-000000000002'::uuid,
     'eb240000-0000-4000-8000-000000000002'::uuid,'sv'::text)
  ) AS fixtures(actor,project_id,language)
  LOOP
    PERFORM set_config('request.jwt.claim.sub',scenario.actor::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',scenario.actor,'role','authenticated')::text,true);
    source_text := CASE scenario.language WHEN 'sv' THEN 'Jag växte upp i Malmö.' ELSE 'I grew up in Malmö.' END;
    correction := 'Göteborg';
    SELECT title INTO original_title FROM public.books WHERE id=scenario.project_id;
    IF (SELECT count(*) FROM public.profiles WHERE user_id=scenario.actor)<>1
       OR (SELECT count(*) FROM public.user_settings WHERE user_id=scenario.actor)<>1 THEN
      RAISE EXCEPTION 'Synthetic signup trigger did not create owned profile/settings'; END IF;
    resumed := public.continue_story_project(scenario.project_id);
    session_id := (resumed->'session'->>'id')::uuid;
    IF public.continue_story_project(scenario.project_id)->'session'->>'id'<>session_id::text
       OR (SELECT count(*) FROM public.conversation_sessions WHERE project_id=scenario.project_id)<>1 THEN
      RAISE EXCEPTION 'Repeated Continue duplicated session'; END IF;
    turn := public.append_conversation_turn(session_id,gen_random_uuid(),source_text,
      scenario.language,NULL,0,'Fictional acknowledgement.',jsonb_build_array(jsonb_build_object(
        'fact_type','location','value','Malmö','evidence',rtrim(source_text,'.'),
        'slot','grew_up_location','uncertain',false)),'[]');
    source_id := (turn->'user_message'->>'id')::uuid;
    memory_id := (turn->'memories'->0->>'id')::uuid;
    IF turn->'memories'->0->>'status'<>'pending' THEN
      RAISE EXCEPTION 'Unreviewed memory bypassed pending state'; END IF;
    context := public.load_story_context(scenario.project_id);
    BEGIN
      PERFORM public.save_story_generation(scenario.project_id,gen_random_uuid(),scenario.language,
        'warm',true,context->>'context_token','Invented content.');
      RAISE EXCEPTION 'Pending-only memory generated a draft';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    IF EXISTS(SELECT 1 FROM public.story_drafts WHERE project_id=scenario.project_id) THEN
      RAISE EXCEPTION 'Failed generation left partial draft'; END IF;
    reviewed := public.resolve_memory_fact(memory_id,'confirmed',correction,1);
    IF reviewed->>'value'<>'Malmö' OR reviewed->>'corrected_value'<>correction
       OR reviewed->>'version'<>'2'
       OR public.resolve_memory_fact(memory_id,'confirmed',correction,1) IS DISTINCT FROM reviewed THEN
      RAISE EXCEPTION 'Correction/retry lost original extraction or duplicated review'; END IF;
    BEGIN PERFORM public.resolve_memory_fact(memory_id,'rejected',NULL,1);
      RAISE EXCEPTION 'Stale review overwrote correction';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    context := public.load_story_context(scenario.project_id);
    IF strpos(context->>'canonical_content',correction)=0
       OR strpos(context->>'canonical_content','Malmö')>0 THEN
      RAISE EXCEPTION 'Reviewed correction missing from canonical context'; END IF;
    draft := public.save_story_generation(scenario.project_id,gen_random_uuid(),scenario.language,
      'warm',true,context->>'context_token',context->>'canonical_content');
    draft_id := (draft->>'draft_id')::uuid;
    edited := public.edit_story_draft(draft_id,1,(draft->>'content') || E'\n\nFictional manual edit / fiktiv ändring.');
    BEGIN PERFORM public.edit_story_draft(draft_id,1,'Stale competing edit.');
      RAISE EXCEPTION 'Stale draft mutation succeeded';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    exported := public.record_story_export(draft_id,2,original_title,false,true,
      'memy_pdf_v1','memy-day14-fictional.pdf',11000,2);
    IF public.record_story_export(draft_id,2,original_title,false,true,
        'memy_pdf_v1','memy-day14-fictional.pdf',11000,2) IS DISTINCT FROM exported
       OR (SELECT count(*) FROM public.story_exports WHERE project_id=scenario.project_id)<>1
       OR jsonb_array_length(public.list_story_edit_history(draft_id,50,0))<>1
       OR (SELECT original_text FROM public.conversation_messages WHERE id=source_id)<>source_text
       OR public.get_story_draft(draft_id)->>'original_content'<>draft->>'content'
       OR public.get_story_draft(draft_id)->>'language'<>scenario.language
       OR (SELECT language FROM public.conversation_sessions WHERE id=session_id)<>scenario.language THEN
      RAISE EXCEPTION 'Source/history/export/language integrity failed'; END IF;
    PERFORM set_config('memy.day14_fixtures',(
      current_setting('memy.day14_fixtures')::jsonb || jsonb_build_array(jsonb_build_object(
        'actor',scenario.actor,'project_id',scenario.project_id,'language',scenario.language,
        'session_id',session_id,'source_id',source_id,'memory_id',memory_id,
        'draft_id',draft_id,'export_id',exported->>'export_id')))::text,true);
  END LOOP;
END $journey$;

DO $ownership$
DECLARE fixture jsonb; other_actor text; changed integer; relation text;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.day14_fixtures')::jsonb)
  LOOP
    other_actor := CASE fixture->>'actor' WHEN 'ea140000-0000-4000-8000-000000000001'
      THEN 'eb140000-0000-4000-8000-000000000002' ELSE 'ea140000-0000-4000-8000-000000000001' END;
    PERFORM set_config('request.jwt.claim.sub',other_actor,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_actor,'role','authenticated')::text,true);
    IF EXISTS(SELECT 1 FROM public.story_projects WHERE id=(fixture->>'project_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.profiles WHERE user_id=(fixture->>'actor')::uuid)
       OR EXISTS(SELECT 1 FROM public.user_settings WHERE user_id=(fixture->>'actor')::uuid)
       OR EXISTS(SELECT 1 FROM public.conversation_sessions WHERE id=(fixture->>'session_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.conversation_messages WHERE id=(fixture->>'source_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.audio_transcripts WHERE session_id=(fixture->>'session_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.conversation_message_history WHERE session_id=(fixture->>'session_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.memory_facts WHERE id=(fixture->>'memory_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.story_drafts WHERE id=(fixture->>'draft_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.draft_source_memories WHERE draft_id=(fixture->>'draft_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.story_edit_history WHERE draft_id=(fixture->>'draft_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.story_verification_results WHERE draft_id=(fixture->>'draft_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.story_exports WHERE id=(fixture->>'export_id')::uuid) THEN
      RAISE EXCEPTION 'Foreign fixture visible through table/view'; END IF;
    UPDATE public.books SET title='Foreign overwrite' WHERE id=(fixture->>'project_id')::uuid;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>0 THEN RAISE EXCEPTION 'Foreign project mutation succeeded'; END IF;
    UPDATE public.conversation_sessions SET status='completed',ended_at=now() WHERE id=(fixture->>'session_id')::uuid;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>0 THEN RAISE EXCEPTION 'Foreign session mutation succeeded'; END IF;
    BEGIN PERFORM public.resolve_memory_fact((fixture->>'memory_id')::uuid,'rejected',NULL,2);
      RAISE EXCEPTION 'Foreign memory mutation succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.get_story_draft((fixture->>'draft_id')::uuid);
      RAISE EXCEPTION 'Foreign draft RPC succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.edit_story_draft((fixture->>'draft_id')::uuid,2,'Foreign edit');
      RAISE EXCEPTION 'Foreign edit RPC succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.list_story_edit_history((fixture->>'draft_id')::uuid,50,0);
      RAISE EXCEPTION 'Foreign history RPC succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.get_story_export((fixture->>'export_id')::uuid);
      RAISE EXCEPTION 'Foreign export RPC succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.continue_story_project((fixture->>'project_id')::uuid);
      RAISE EXCEPTION 'Foreign continuation RPC succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.append_conversation_turn((fixture->>'session_id')::uuid,gen_random_uuid(),
      'Foreign source',fixture->>'language',NULL,0,'Foreign response','[]','[]');
      RAISE EXCEPTION 'Foreign source append succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
    FOREACH relation IN ARRAY ARRAY['conversation_turns','memory_fact_revisions','story_generation_requests']
    LOOP
      BEGIN EXECUTE format('SELECT 1 FROM public.%I LIMIT 0',relation);
        RAISE EXCEPTION 'Internal ledger exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END LOOP;
  END LOOP;
END $ownership$;

DO $missing_identity$
DECLARE relation text; visible boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  FOREACH relation IN ARRAY ARRAY['story_projects','profiles','user_settings','conversation_sessions',
    'conversation_messages','audio_transcripts','conversation_message_history','memory_facts',
    'memory_clarifications','story_drafts','draft_source_memories','story_edit_history',
    'story_verification_results','story_exports']
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I)',relation) INTO visible;
    IF visible THEN RAISE EXCEPTION 'Missing identity exposed private row'; END IF;
  END LOOP;
  BEGIN PERFORM public.continue_story_project('ea240000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Missing identity continuation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.resolve_memory_fact(gen_random_uuid(),'confirmed',NULL,1);
    RAISE EXCEPTION 'Missing identity review succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $missing_identity$;

-- Anonymous probe is permitted on profiles, but must reveal no row. Private
-- tables/views and every public SECURITY DEFINER RPC reject anonymous execution.
SET LOCAL ROLE anon;
DO $anonymous$
DECLARE relation text; rpc record; arguments_sql text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  IF EXISTS(SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'Anonymous profile leak'; END IF;
  FOREACH relation IN ARRAY ARRAY['story_projects','conversation_sessions','conversation_messages',
    'audio_transcripts','conversation_message_history','user_settings','memory_facts',
    'memory_clarifications','story_drafts','draft_source_memories','story_edit_history',
    'story_verification_results','story_exports']
  LOOP
    BEGIN EXECUTE format('SELECT 1 FROM public.%I LIMIT 0',relation);
      RAISE EXCEPTION 'Anonymous private relation grant exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  FOR rpc IN SELECT p.proname,oidvectortypes(p.proargtypes) AS arguments
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef AND p.proname IN (
      'claim_audio_transcription','complete_audio_transcription','fail_audio_transcription',
      'get_conversation_turn','append_conversation_turn','resolve_memory_fact','load_story_context',
      'get_story_generation','save_story_generation','get_story_draft','list_story_drafts',
      'edit_story_draft','get_story_project_verification','list_story_edit_history',
      'load_story_export_context','record_story_export','get_story_export','list_story_exports','continue_story_project')
  LOOP
    SELECT string_agg('NULL::' || type,',') INTO arguments_sql
      FROM unnest(string_to_array(rpc.arguments,', ')) AS types(type);
    BEGIN EXECUTE format('SELECT public.%I(%s)',rpc.proname,arguments_sql);
      RAISE EXCEPTION 'Anonymous core RPC exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $anonymous$;
RESET ROLE;

-- Recheck only fictional rows after denied actions; never return narratives.
DO $unchanged$
DECLARE fixture jsonb;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.day14_fixtures')::jsonb)
  LOOP
    IF (SELECT status FROM public.conversation_sessions WHERE id=(fixture->>'session_id')::uuid)<>'active'
       OR (SELECT status FROM public.memory_facts WHERE id=(fixture->>'memory_id')::uuid)<>'confirmed'
       OR (SELECT version FROM public.memory_facts WHERE id=(fixture->>'memory_id')::uuid)<>2
       OR (SELECT count(*) FROM public.memory_fact_revisions WHERE fact_id=(fixture->>'memory_id')::uuid)<>1
       OR (SELECT revision FROM public.story_drafts WHERE id=(fixture->>'draft_id')::uuid)<>2
       OR (SELECT count(*) FROM public.conversation_messages WHERE session_id=(fixture->>'session_id')::uuid)<>2
       OR (SELECT count(*) FROM public.story_generation_requests WHERE project_id=(fixture->>'project_id')::uuid)<>1 THEN
      RAISE EXCEPTION 'Denied action left partial mutation'; END IF;
  END LOOP;
END $unchanged$;
ROLLBACK;

SELECT 'PASS' AS day14_security, 'SQL ROLE CLAIMS ONLY' AS identity_scope,
  'PASS' AS two_way_owner_isolation, 'PASS' AS pending_correction_and_history,
  'PASS' AS failed_mutation_atomicity, 'METADATA ONLY' AS pdf_scope,
  'ROLLED BACK' AS synthetic_data;

-- Catalog metadata only: a public image bucket is evidence, NOT a privacy pass.
-- pg_proc describes DATABASE functions, not deployed Supabase Edge Functions.
SELECT count(*)::integer AS legacy_bucket_count,
  count(*) FILTER (WHERE public)::integer AS legacy_public_bucket_count,
  count(*) FILTER (WHERE id IN ('book-audio','generated-pdfs') AND NOT public)::integer AS private_audio_pdf_bucket_count
FROM storage.buckets WHERE id IN ('book-audio','book-images','generated-pdfs');

SELECT count(*)::integer AS public_database_definer_count,
  count(*) FILTER (WHERE has_function_privilege('anon',p.oid,'EXECUTE'))::integer AS anon_executable_database_definer_count,
  'NOT EDGE DEPLOYMENT EVIDENCE' AS function_scope
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef;
