-- Dedicated memy-ai-dev only. Execute the complete batch with stop-on-error.
-- No users, fixtures, policies, settings, objects or stored data are changed.
-- Claims below are transaction-local SQL impersonation, NOT authenticated JWTs.
-- No existing row IDs, story text, tokens, function bodies or keys are returned.
-- This cannot verify owner-write paths, two real users, blobs, Edge deployment,
-- model quality, or a physical iPhone. A zero-data result has limited assurance.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '3s';

DO $preflight$
DECLARE nonexistent_actor uuid := 'fa140000-0000-4000-8000-000000000001';
  expected_tables text[] := ARRAY[
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
  IF current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION 'Read-only transaction is required'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=nonexistent_actor)
     OR EXISTS(SELECT 1 FROM public.books WHERE id=nonexistent_actor OR user_id=nonexistent_actor)
     OR EXISTS(SELECT 1 FROM public.profiles WHERE user_id=nonexistent_actor)
     OR EXISTS(SELECT 1 FROM public.user_settings WHERE user_id=nonexistent_actor) THEN
    RAISE EXCEPTION 'Nonexistent SQL actor collision'; END IF;
  SELECT count(*),count(*) FILTER (WHERE c.relrowsecurity) INTO total,safe
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(expected_tables);
  IF total<>16 OR safe<>16 THEN RAISE EXCEPTION 'Core table RLS catalog check failed'; END IF;
  SELECT count(*),count(*) FILTER (WHERE 'security_invoker=true'=ANY(c.reloptions)) INTO total,safe
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(expected_views);
  IF total<>3 OR safe<>3 THEN RAISE EXCEPTION 'Public view invoker catalog check failed'; END IF;
  SELECT count(*),count(*) FILTER (WHERE p.prosecdef
      AND 'search_path=pg_catalog, public'=ANY(p.proconfig)
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')) INTO total,safe
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY(rpc_names);
  IF total<>19 OR safe<>19 THEN RAISE EXCEPTION 'Core RPC grant catalog check failed'; END IF;
END $preflight$;

SET LOCAL ROLE anon;
DO $anonymous$
DECLARE relation text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  IF EXISTS(SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'Anonymous profile leak'; END IF;
  FOREACH relation IN ARRAY ARRAY['story_projects','audio_transcripts','conversation_message_history',
    'conversation_sessions','conversation_messages','user_settings','memory_facts','memory_clarifications',
    'story_drafts','draft_source_memories','story_verification_results','story_edit_history','story_exports']
  LOOP
    BEGIN EXECUTE format('SELECT 1 FROM public.%I LIMIT 0',relation);
      RAISE EXCEPTION 'Anonymous private relation grant exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  BEGIN PERFORM public.continue_story_project('fa140000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Anonymous continuation RPC exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;

SET LOCAL ROLE authenticated;
DO $read_boundaries$
DECLARE actor text; relation text; visible boolean; rpc record; arguments_sql text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['','fa140000-0000-4000-8000-000000000001']
  LOOP
    PERFORM set_config('request.jwt.claim.sub',actor,true);
    PERFORM set_config('request.jwt.claims',CASE WHEN actor='' THEN '{}'
      ELSE jsonb_build_object('sub',actor,'role','authenticated')::text END,true);
    FOREACH relation IN ARRAY ARRAY['profiles','story_projects','user_settings','conversation_sessions',
      'conversation_messages','audio_transcripts','conversation_message_history','memory_facts',
      'memory_clarifications','story_drafts','draft_source_memories','story_verification_results',
      'story_edit_history','story_exports']
    LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I)',relation) INTO visible;
      IF visible THEN RAISE EXCEPTION 'Missing/nonexistent SQL identity exposed private row'; END IF;
    END LOOP;
    FOREACH relation IN ARRAY ARRAY['conversation_turns','memory_fact_revisions','story_generation_requests']
    LOOP
      BEGIN EXECUTE format('SELECT 1 FROM public.%I LIMIT 0',relation);
        RAISE EXCEPTION 'Internal ledger exposed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END LOOP;
  END LOOP;
  -- Only absent-identity RPC guards are exercised. Every argument is NULL,
  -- so these calls must terminate before object lookup or any write attempt.
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  FOR rpc IN SELECT p.proname,oidvectortypes(p.proargtypes) AS arguments
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'claim_audio_transcription','complete_audio_transcription','fail_audio_transcription',
      'get_conversation_turn','append_conversation_turn','resolve_memory_fact','load_story_context',
      'get_story_generation','save_story_generation','get_story_draft','list_story_drafts',
      'edit_story_draft','get_story_project_verification','list_story_edit_history',
      'load_story_export_context','record_story_export','get_story_export','list_story_exports','continue_story_project')
  LOOP
    SELECT string_agg('NULL::' || type,',') INTO arguments_sql
      FROM unnest(string_to_array(rpc.arguments,', ')) AS types(type);
    BEGIN EXECUTE format('SELECT public.%I(%s)',rpc.proname,arguments_sql);
      RAISE EXCEPTION 'Missing-identity core RPC guard failed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $read_boundaries$;
RESET ROLE;

-- Aggregate counts show whether read isolation had any existing rows to hide.
-- They are not a complete data inventory and do not assert owner-write safety.
SELECT 'PASS' AS day14_readonly_security,
  'SQL_ROLE_NOT_JWT' AS identity_scope, 'NOT_RUN' AS own_write_test,
  'NOT_RUN' AS two_real_users_test, 'NOT_RUN' AS physical_iphone_test,
  'READ_ONLY_NO_FIXTURE_WRITES' AS data_scope,
  16 AS rls_tables_checked, 3 AS invoker_views_checked, 19 AS guarded_core_rpcs_checked,
  jsonb_build_object(
    'projects',(SELECT count(*) FROM public.books),
    'sessions',(SELECT count(*) FROM public.conversation_sessions),
    'source_messages',(SELECT count(*) FROM public.conversation_messages),
    'memories',(SELECT count(*) FROM public.memory_facts),
    'drafts',(SELECT count(*) FROM public.story_drafts),
    'edit_history',(SELECT count(*) FROM public.story_edit_history),
    'exports',(SELECT count(*) FROM public.story_exports)) AS existing_row_counts,
  (SELECT jsonb_build_object('legacy_bucket_count',count(*),
    'legacy_public_bucket_count',count(*) FILTER (WHERE public),
    'private_audio_pdf_bucket_count',count(*) FILTER (WHERE id IN ('book-audio','generated-pdfs') AND NOT public))
    FROM storage.buckets WHERE id IN ('book-audio','book-images','generated-pdfs')) AS bucket_metadata,
  (SELECT jsonb_build_object('public_database_definer_count',count(*),
    'anon_executable_database_definer_count',count(*) FILTER (WHERE has_function_privilege('anon',p.oid,'EXECUTE')),
    'scope','NOT_EDGE_DEPLOYMENT_EVIDENCE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef) AS database_function_catalog;
ROLLBACK;
