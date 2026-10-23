-- Dedicated memy-ai-dev only. Run the complete script, never selected statements.
-- Fictional subjects + role claims, not real Auth login/JWT verification. All writes roll back.
-- PDF metadata/revision integrity only: this does NOT render PDF bytes or test a phone.
-- Stale competing actions are sequential optimistic-lock checks, not a real race benchmark.
BEGIN;

DO $collision$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id IN (
    'ea110000-0000-4000-8000-000000000001','eb110000-0000-4000-8000-000000000002'
  )) OR EXISTS (SELECT 1 FROM public.books WHERE id IN (
    'ea210000-0000-4000-8000-000000000001','eb210000-0000-4000-8000-000000000002'
  )) THEN RAISE EXCEPTION 'Day 11 synthetic identity collision'; END IF;
END $collision$;

INSERT INTO auth.users(id,email) VALUES
  ('ea110000-0000-4000-8000-000000000001','memy-day11-en@example.invalid'),
  ('eb110000-0000-4000-8000-000000000002','memy-day11-sv@example.invalid');
INSERT INTO public.books(id,user_id,title,language) VALUES
  ('ea210000-0000-4000-8000-000000000001','ea110000-0000-4000-8000-000000000001','Fictional Malmö – åäö','en'),
  ('eb210000-0000-4000-8000-000000000002','eb110000-0000-4000-8000-000000000002','Fiktiva Malmö – åäö','sv');
SELECT set_config('memy.day11_fixtures','[]',true);

SET LOCAL ROLE authenticated;
DO $journey$
DECLARE
  scenario record;
  resumed jsonb; turn jsonb; context jsonb; original_context jsonb; versions jsonb;
  draft jsonb; edited jsonb; newer jsonb; history jsonb; export_one jsonb; export_two jsonb;
  session_one uuid; session_two uuid; source_one uuid; source_two uuid;
  location_id uuid; rejected_id uuid; unsupported_id uuid; move_id uuid;
  draft_one uuid; draft_two uuid; key_one uuid; key_two uuid;
  location_text text; name_text text; occupation_text text; source_text text; move_text text;
  canonical text; edit_two text; edit_three text; original_title text; renamed_title text;
BEGIN
  FOR scenario IN SELECT * FROM (VALUES
    ('ea110000-0000-4000-8000-000000000001'::uuid,
     'ea210000-0000-4000-8000-000000000001'::uuid,'en'::text),
    ('eb110000-0000-4000-8000-000000000002'::uuid,
     'eb210000-0000-4000-8000-000000000002'::uuid,'sv'::text)
  ) AS fixtures(actor,project_id,language)
  LOOP
    PERFORM set_config('request.jwt.claim.sub',scenario.actor::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object(
      'sub',scenario.actor,'role','authenticated')::text,true);
    SELECT title INTO original_title FROM public.books WHERE id=scenario.project_id;
    renamed_title := original_title || ' / revised title';
    location_text := CASE scenario.language WHEN 'sv' THEN 'Jag växte upp i Malmö'
      ELSE 'I grew up in Malmö' END;
    name_text := CASE scenario.language WHEN 'sv' THEN 'Jag heter Ada' ELSE 'My name is Ada' END;
    occupation_text := CASE scenario.language WHEN 'sv' THEN 'Jag arbetade som lärare' ELSE 'I worked as a teacher' END;
    source_text := location_text || '. ' || name_text || '. ' || occupation_text || '.';
    canonical := location_text || '.';
    edit_two := canonical || E'\n\n' || CASE scenario.language WHEN 'sv'
      THEN 'Mina egna ord: åäö ÅÄÖ – ett fiktivt minne.'
      ELSE 'My own words: åäö ÅÄÖ – a fictional memory.' END;
    edit_three := edit_two || E'\n\n' || CASE scenario.language WHEN 'sv'
      THEN 'En senare manuell ändring.' ELSE 'A later manual edit.' END;
    move_text := CASE scenario.language WHEN 'sv' THEN 'Jag flyttade 1974.' ELSE 'I moved in 1974.' END;
    resumed := public.continue_story_project(scenario.project_id);
    session_one := (resumed->'session'->>'id')::uuid;
    turn := public.append_conversation_turn(session_one,gen_random_uuid(),source_text,
      scenario.language,NULL,0,'Fictional acknowledgement / Fiktiv bekräftelse.',
      jsonb_build_array(
        jsonb_build_object('fact_type','location','value','Malmö','evidence',location_text,
          'slot','grew_up_location','uncertain',false),
        jsonb_build_object('fact_type','person','value','Ada','evidence',name_text,
          'slot','person:self_name','uncertain',false),
        jsonb_build_object('fact_type','event','value',CASE scenario.language WHEN 'sv'
          THEN 'lärare' ELSE 'teacher' END,'evidence',occupation_text,'slot','occupation','uncertain',false)), '[]');
    source_one := (turn->'user_message'->>'id')::uuid;
    location_id := (turn->'memories'->0->>'id')::uuid;
    rejected_id := (turn->'memories'->1->>'id')::uuid;
    unsupported_id := (turn->'memories'->2->>'id')::uuid;

    PERFORM public.resolve_memory_fact(rejected_id,'rejected',NULL,1);
    context := public.load_story_context(scenario.project_id);
    BEGIN PERFORM public.save_story_generation(scenario.project_id,gen_random_uuid(),
      scenario.language,'warm',true,context->>'context_token','Invented biography.');
      RAISE EXCEPTION 'Rejected/pending-only context generated a story';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    PERFORM public.resolve_memory_fact(unsupported_id,'confirmed',NULL,1);
    context := public.load_story_context(scenario.project_id);
    BEGIN PERFORM public.save_story_generation(scenario.project_id,gen_random_uuid(),
      scenario.language,'warm',true,context->>'context_token','Invented biography.');
      RAISE EXCEPTION 'Unsupported-only confirmed context generated narrative';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    IF EXISTS(SELECT 1 FROM public.story_drafts WHERE project_id=scenario.project_id) THEN
      RAISE EXCEPTION 'Blocked generation left partial persistence'; END IF;
    PERFORM public.resolve_memory_fact(location_id,'confirmed',NULL,1);
    original_context := public.load_story_context(scenario.project_id);
    IF original_context->>'canonical_content'<>canonical
       OR jsonb_array_length(original_context->'source_memories')<>1
       OR jsonb_array_length(original_context->'excluded_memories')<>2 THEN
      RAISE EXCEPTION 'Rejected/unsupported memories entered canonical content'; END IF;
    BEGIN PERFORM public.save_story_generation(scenario.project_id,gen_random_uuid(),
      scenario.language,'warm',false,original_context->>'context_token',canonical);
      RAISE EXCEPTION 'Generation bypassed explicit confirmation';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    BEGIN PERFORM public.save_story_generation(scenario.project_id,gen_random_uuid(),
      scenario.language,'warm',true,original_context->>'context_token',canonical || ' I won a lottery.');
      RAISE EXCEPTION 'Ungrounded addition was falsely verified';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

    key_one := gen_random_uuid(); key_two := gen_random_uuid();
    draft := public.save_story_generation(scenario.project_id,key_one,scenario.language,
      'warm',true,original_context->>'context_token',canonical);
    draft_one := (draft->>'draft_id')::uuid;
    IF draft->>'mode'<>'mock' OR draft->>'language'<>scenario.language
       OR draft->>'version'<>'1' OR draft->>'revision'<>'1'
       OR draft->'verification'->>'status'<>'passed'
       OR draft->>'original_content'<>canonical
       OR draft->'source_memories'->0->>'source_message_id'<>source_one::text THEN
      RAISE EXCEPTION 'Initial generated draft lost provenance or language'; END IF;
    export_one := public.record_story_export(draft_one,1,original_title,true,true,
      'memy_pdf_v1','memy-day11-r1.pdf',11001,2);
    edited := public.edit_story_draft(draft_one,1,edit_two);
    IF edited->'verification'->>'status'<>'needs_review'
       OR edited->'verification'->>'method'<>'manual_unverified'
       OR edited->'verification'->>'sources_current' IS DISTINCT FROM 'true'
       OR public.edit_story_draft(draft_one,1,edit_two) IS DISTINCT FROM edited
       OR public.edit_story_draft(draft_one,2,edit_two) IS DISTINCT FROM edited THEN
      RAISE EXCEPTION 'Manual edit/retry changed review state or revision'; END IF;
    BEGIN PERFORM public.edit_story_draft(draft_one,1,'A competing stale edit.');
      RAISE EXCEPTION 'Stale editor overwrote the saved edit';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    export_two := public.record_story_export(draft_one,2,original_title,false,true,
      'memy_pdf_v1','memy-day11-r2.pdf',11002,3);
    IF public.record_story_export(draft_one,2,original_title,false,true,
        'memy_pdf_v1','memy-day11-r2.pdf',11002,3) IS DISTINCT FROM export_two THEN
      RAISE EXCEPTION 'Export retry duplicated metadata'; END IF;
    edited := public.edit_story_draft(draft_one,2,edit_three);
    IF public.save_story_generation(scenario.project_id,key_one,scenario.language,'warm',true,
        original_context->>'context_token',canonical) IS DISTINCT FROM edited
       OR public.save_story_generation(scenario.project_id,key_two,scenario.language,'warm',true,
        original_context->>'context_token',canonical) IS DISTINCT FROM edited
       OR public.get_story_generation(scenario.project_id,key_one,scenario.language,'warm') IS DISTINCT FROM edited THEN
      RAISE EXCEPTION 'Generation retry replaced edits or duplicated same-context draft'; END IF;
    BEGIN PERFORM public.save_story_generation(scenario.project_id,key_one,scenario.language,'warm',true,
      original_context->>'context_token',canonical || ' Changed request.');
      RAISE EXCEPTION 'Bound generation key accepted changed content';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    history := public.list_story_edit_history(draft_one,50,0);
    IF jsonb_array_length(history)<>2
       OR history->0->>'revision'<>'3' OR history->1->>'revision'<>'2'
       OR history->0->>'previous_content'<>edit_two OR history->0->>'content'<>edit_three
       OR history->1->>'previous_content'<>canonical OR history->1->>'content'<>edit_two
       OR (SELECT count(*) FROM public.story_verification_results WHERE draft_id=draft_one)<>3 THEN
      RAISE EXCEPTION 'Retry/stale actions corrupted revision audit or generation bindings'; END IF;

    UPDATE public.books SET title=renamed_title WHERE id=scenario.project_id;
    BEGIN PERFORM public.record_story_export(draft_one,3,original_title,true,true,
      'memy_pdf_v1','memy-day11-stale-title.pdf',11003,2);
      RAISE EXCEPTION 'Export accepted a stale project title';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN PERFORM public.record_story_export(draft_one,2,renamed_title,false,true,
      'memy_pdf_v1','memy-day11-stale-revision.pdf',11003,2);
      RAISE EXCEPTION 'Export accepted a stale story revision';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    IF public.get_story_export((export_one->>'export_id')::uuid)->>'content'<>canonical
       OR public.get_story_export((export_two->>'export_id')::uuid)->>'content'<>edit_two
       OR public.get_story_export((export_two->>'export_id')::uuid)->'export'->>'title'<>original_title
       OR export_two->>'content_sha256'<>encode(sha256(convert_to(edit_two,'UTF8')),'hex')
       OR export_one->>'language'<>scenario.language OR export_two->>'language'<>scenario.language
       OR jsonb_array_length(public.list_story_exports(scenario.project_id,50,0))<>2 THEN
      RAISE EXCEPTION 'Old Unicode export did not retain selected content/hash/title'; END IF;

    resumed := public.continue_story_project(scenario.project_id);
    IF resumed->'session'->>'id'<>session_one::text OR resumed->>'session_created'<>'false'
       OR resumed->>'generation_triggered'<>'false'
       OR resumed->'latest_draft'->>'content'<>edit_three THEN
      RAISE EXCEPTION 'Continue active session lost edits or regenerated a draft'; END IF;
    UPDATE public.conversation_sessions SET status='completed',ended_at=now() WHERE id=session_one;
    resumed := public.continue_story_project(scenario.project_id);
    session_two := (resumed->'session'->>'id')::uuid;
    IF session_two=session_one OR resumed->>'session_created'<>'true'
       OR resumed->>'generation_triggered'<>'false'
       OR resumed->'latest_draft'->>'draft_id'<>draft_one::text
       OR resumed->'latest_draft'->>'content'<>edit_three
       OR public.continue_story_project(scenario.project_id)->'session'->>'id'<>session_two::text THEN
      RAISE EXCEPTION 'Continue after completion duplicated or overwrote saved state'; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version)
      ORDER BY f.id),'[]'::jsonb) INTO versions FROM public.memory_facts f
      WHERE f.project_id=scenario.project_id AND f.status<>'rejected';
    turn := public.append_conversation_turn(session_two,gen_random_uuid(),move_text,
      scenario.language,NULL,0,'Fictional acknowledgement / Fiktiv bekräftelse.',
      jsonb_build_array(jsonb_build_object('fact_type','event','value','1974','evidence',move_text,
        'year',1974,'slot','move','uncertain',false)),versions);
    source_two := (turn->'user_message'->>'id')::uuid;
    move_id := (turn->'memories'->0->>'id')::uuid;
    PERFORM public.resolve_memory_fact(move_id,'confirmed',NULL,1);
    edited := public.get_story_draft(draft_one);
    IF (SELECT count(*) FROM public.story_drafts WHERE project_id=scenario.project_id)<>1
       OR edited->>'content'<>edit_three
       OR edited->'verification'->>'status' IS DISTINCT FROM 'needs_review'
       OR edited->'verification'->>'method' IS DISTINCT FROM 'manual_unverified'
       OR edited->'verification'->>'sources_current' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'Adding/reviewing new memory implicitly regenerated old draft'; END IF;
    BEGIN PERFORM public.save_story_generation(scenario.project_id,gen_random_uuid(),scenario.language,
      'warm',true,original_context->>'context_token',canonical);
      RAISE EXCEPTION 'Stale pre-continuation context generated';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    context := public.load_story_context(scenario.project_id);
    newer := public.save_story_generation(scenario.project_id,gen_random_uuid(),scenario.language,
      'warm',true,context->>'context_token',context->>'canonical_content');
    draft_two := (newer->>'draft_id')::uuid;
    IF draft_two=draft_one OR newer->>'version'<>'2' OR newer->>'revision'<>'1'
       OR newer->'verification'->>'status'<>'passed'
       OR newer->'verification'->>'sources_current' IS DISTINCT FROM 'true'
       OR newer->>'language'<>scenario.language
       OR jsonb_array_length(newer->'source_memories')<>2
       OR strpos(newer->>'content','1974')=0 OR strpos(newer->>'content','Malmö')=0
       OR strpos(newer->>'content','Ada')>0
       OR public.get_story_draft(draft_one)->>'original_content'<>canonical
       OR public.get_story_draft(draft_one)->>'content'<>edit_three
       OR public.get_story_export((export_two->>'export_id')::uuid)->>'content'<>edit_two
       OR jsonb_array_length(public.list_story_edit_history(draft_one,50,0))<>2
       OR jsonb_array_length(public.list_story_drafts(scenario.project_id,50,0))<>2 THEN
      RAISE EXCEPTION 'Explicit v2 generation erased v1/edit/export or lost confirmed sources'; END IF;
    draft := public.save_story_generation(scenario.project_id,key_one,scenario.language,'warm',true,
      original_context->>'context_token',canonical);
    resumed := public.continue_story_project(scenario.project_id);
    IF draft->>'draft_id'<>draft_one::text OR draft->>'content'<>edit_three
       OR resumed->'latest_draft'->>'draft_id'<>draft_two::text
       OR resumed->>'generation_triggered'<>'false'
       OR (SELECT original_text FROM public.conversation_messages WHERE id=source_one)<>source_text
       OR (SELECT original_text FROM public.conversation_messages WHERE id=source_two)<>move_text
       OR (SELECT count(*) FROM public.conversation_message_history WHERE session_id=session_one)<>2
       OR (SELECT status FROM public.conversation_sessions WHERE id=session_one)<>'completed' THEN
      RAISE EXCEPTION 'Late retry or Continue damaged source/session/version history'; END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',f.id::text,'version',f.version)
      ORDER BY f.id),'[]'::jsonb) INTO versions FROM public.memory_facts f
      WHERE f.project_id=scenario.project_id AND f.status<>'rejected';
    turn := public.append_conversation_turn(session_two,gen_random_uuid(),
      CASE scenario.language WHEN 'sv' THEN 'Kanske var det 1975.' ELSE 'Maybe it was 1975.' END,
      scenario.language,NULL,(turn->'message'->>'sequence')::bigint,'1974 or 1975?',
      jsonb_build_array(jsonb_build_object('fact_type','event','value','1975','evidence','1975',
        'year',1975,'slot','move','uncertain',true,'clarification_question','1974 or 1975?',
        'conflicts_with_fact_id',move_id)),versions);
    context := public.load_story_context(scenario.project_id);
    IF jsonb_array_length(context->'blocking_clarifications')=0 THEN
      RAISE EXCEPTION 'Conflicting new fact was not flagged'; END IF;
    BEGIN PERFORM public.save_story_generation(scenario.project_id,gen_random_uuid(),scenario.language,
      'warm',true,context->>'context_token',context->>'canonical_content');
      RAISE EXCEPTION 'Unresolved resumed-session conflict generated v3';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    IF (SELECT count(*) FROM public.story_drafts WHERE project_id=scenario.project_id)<>2
       OR public.get_story_draft(draft_two)->'verification'->>'status' IS DISTINCT FROM 'stale_sources'
       OR public.get_story_draft(draft_two)->'verification'->>'sources_current' IS DISTINCT FROM 'false' THEN
      RAISE EXCEPTION 'Blocked conflicting generation left partial v3'; END IF;
    PERFORM set_config('memy.day11_fixtures',(
      current_setting('memy.day11_fixtures')::jsonb || jsonb_build_array(jsonb_build_object(
        'actor',scenario.actor,'project_id',scenario.project_id,'language',scenario.language,
        'draft_one',draft_one,'draft_two',draft_two,'export_one',export_one->>'export_id',
        'source_one',source_one,'key_one',key_one,'context_token',original_context->>'context_token',
        'canonical',canonical)))::text,true);
  END LOOP;
END $journey$;

DO $ownership$
DECLARE fixture jsonb; other_actor text;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.day11_fixtures')::jsonb)
  LOOP
    other_actor := CASE fixture->>'actor' WHEN 'ea110000-0000-4000-8000-000000000001'
      THEN 'eb110000-0000-4000-8000-000000000002' ELSE 'ea110000-0000-4000-8000-000000000001' END;
    PERFORM set_config('request.jwt.claim.sub',other_actor,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_actor,'role','authenticated')::text,true);
    IF EXISTS(SELECT 1 FROM public.story_projects WHERE id=(fixture->>'project_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.story_drafts WHERE project_id=(fixture->>'project_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.draft_source_memories WHERE draft_id=(fixture->>'draft_one')::uuid)
       OR EXISTS(SELECT 1 FROM public.story_edit_history WHERE draft_id=(fixture->>'draft_one')::uuid)
       OR EXISTS(SELECT 1 FROM public.story_verification_results WHERE draft_id=(fixture->>'draft_one')::uuid)
       OR EXISTS(SELECT 1 FROM public.story_exports WHERE project_id=(fixture->>'project_id')::uuid)
       OR EXISTS(SELECT 1 FROM public.memory_facts WHERE project_id=(fixture->>'project_id')::uuid) THEN
      RAISE EXCEPTION 'Foreign story/source/history/export rows visible'; END IF;
    BEGIN PERFORM 1 FROM public.story_generation_requests;
      RAISE EXCEPTION 'Internal generation binding table exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.get_story_draft((fixture->>'draft_one')::uuid);
      RAISE EXCEPTION 'Foreign draft read allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.edit_story_draft((fixture->>'draft_one')::uuid,3,'Foreign overwrite.');
      RAISE EXCEPTION 'Foreign draft edit allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.list_story_drafts((fixture->>'project_id')::uuid,50,0);
      RAISE EXCEPTION 'Foreign draft list allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.list_story_edit_history((fixture->>'draft_one')::uuid,50,0);
      RAISE EXCEPTION 'Foreign edit history allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.get_story_project_verification((fixture->>'project_id')::uuid);
      RAISE EXCEPTION 'Foreign verification allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.get_story_export((fixture->>'export_one')::uuid);
      RAISE EXCEPTION 'Foreign old export allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.load_story_export_context((fixture->>'draft_two')::uuid);
      RAISE EXCEPTION 'Foreign export context allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.record_story_export((fixture->>'draft_one')::uuid,3,'Foreign',true,true,
      'memy_pdf_v1','memy-foreign.pdf',100,1);
      RAISE EXCEPTION 'Foreign export write allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.list_story_exports((fixture->>'project_id')::uuid,50,0);
      RAISE EXCEPTION 'Foreign export list allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.continue_story_project((fixture->>'project_id')::uuid);
      RAISE EXCEPTION 'Foreign continuation allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
    BEGIN PERFORM public.save_story_generation((fixture->>'project_id')::uuid,(fixture->>'key_one')::uuid,
      fixture->>'language','warm',true,fixture->>'context_token',fixture->>'canonical');
      RAISE EXCEPTION 'Foreign generation replay allowed'; EXCEPTION WHEN no_data_found THEN NULL; END;
  END LOOP;
END $ownership$;

RESET ROLE;
DO $audit$
DECLARE fixture jsonb;
BEGIN
  FOR fixture IN SELECT value FROM jsonb_array_elements(current_setting('memy.day11_fixtures')::jsonb)
  LOOP
    IF (SELECT count(*) FROM public.story_generation_requests
        WHERE project_id=(fixture->>'project_id')::uuid)<>3 THEN
      RAISE EXCEPTION 'Retries/blocked generations changed the expected three request bindings'; END IF;
    BEGIN UPDATE public.conversation_messages SET original_text='Overwritten' WHERE id=(fixture->>'source_one')::uuid;
      RAISE EXCEPTION 'Immutable original source changed';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN UPDATE public.story_drafts SET original_content='Overwritten' WHERE id=(fixture->>'draft_one')::uuid;
      RAISE EXCEPTION 'Immutable original generated draft changed';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN UPDATE public.story_edit_history SET content='Overwritten' WHERE draft_id=(fixture->>'draft_one')::uuid;
      RAISE EXCEPTION 'Immutable manual-edit audit changed';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
    BEGIN UPDATE public.story_exports SET content_sha256=repeat('0',64) WHERE id=(fixture->>'export_one')::uuid;
      RAISE EXCEPTION 'Immutable export audit changed';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  END LOOP;
END $audit$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
DO $anonymous$ BEGIN
  BEGIN PERFORM public.list_story_drafts('ea210000-0000-4000-8000-000000000001',50,0);
    RAISE EXCEPTION 'Anonymous draft list allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.list_story_exports('ea210000-0000-4000-8000-000000000001',50,0);
    RAISE EXCEPTION 'Anonymous export list allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.continue_story_project('ea210000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Anonymous continuation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;
RESET ROLE;
ROLLBACK;

SELECT 'PASS' AS day11_bilingual_story_journey, 'BLOCKED' AS unsafe_generation,
       'PASS' AS retry_and_stale_revision, 'PRESERVED' AS old_export_and_history,
       'PASS' AS explicit_continue_generation, 'PASS' AS two_way_owner_isolation,
       'METADATA ONLY' AS pdf_scope, 'ROLLED BACK' AS synthetic_data;
