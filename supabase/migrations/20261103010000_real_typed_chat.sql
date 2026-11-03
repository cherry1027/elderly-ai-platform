-- Add typed originals without changing or deleting existing voice evidence.
-- No Auth/provider/settings changes. Review and apply only to the development project.
BEGIN;

CREATE TABLE public.real_text_inputs (
  input_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.real_ai_operations(operation_id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en','sv')),
  -- Match Python's Unicode whitespace test without trimming saved words.
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000 AND length(btrim(text,
    U&'\0009\000a\000b\000c\000d\001c\001d\001e\001f\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000')) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (input_id=operation_id)
);
CREATE INDEX real_text_inputs_session ON public.real_text_inputs(session_id,created_at,input_id);
ALTER TABLE public.real_text_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.real_text_inputs FROM PUBLIC,anon,authenticated;
DO $service_revoke$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    REVOKE ALL ON TABLE public.real_text_inputs FROM service_role;
  END IF;
END $service_revoke$;
GRANT SELECT ON TABLE public.real_text_inputs TO authenticated;
CREATE POLICY real_text_owned_select ON public.real_text_inputs FOR SELECT TO authenticated USING
  (owner_id=auth.uid() AND EXISTS (SELECT 1 FROM public.books b
    WHERE b.id=project_id AND b.user_id=auth.uid() AND NOT b.is_deleted));
CREATE TRIGGER real_text_input_immutable BEFORE UPDATE ON public.real_text_inputs
  FOR EACH ROW EXECUTE FUNCTION public.real_ai_reject_update();

-- These invariants also fail closed on an accidental privileged insertion.
-- Trusted completion already holds the existing project/operation/session locks.
CREATE FUNCTION public.real_text_input_guard_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.real_ai_operations o
    JOIN public.books b ON b.id=o.project_id
    JOIN public.conversation_sessions s ON s.id=o.session_id
    WHERE o.operation_id=NEW.operation_id AND o.operation_id=NEW.input_id
      AND o.owner_id=NEW.owner_id AND o.project_id=NEW.project_id AND o.session_id=NEW.session_id
      AND o.kind='conversation' AND o.status='in_progress'
      AND b.user_id=NEW.owner_id AND NOT b.is_deleted
      AND s.project_id=b.id AND s.language=b.language AND NEW.language=b.language AND s.status='active') THEN
    RAISE EXCEPTION 'Typed original scope mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.real_text_input_guard_insert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER real_text_input_scope BEFORE INSERT ON public.real_text_inputs
  FOR EACH ROW EXECUTE FUNCTION public.real_text_input_guard_insert();

ALTER TABLE public.real_conversation_messages ALTER COLUMN source_transcript_id DROP NOT NULL;
-- Keep the old table/voice JSON shape: published clients use select=* with strict
-- response schemas. Typed originals link through the EXISTING operation_id, whose
-- per-role uniqueness already guarantees one user/assistant pair per original.

CREATE FUNCTION public.real_typed_message_guard_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE original public.real_text_inputs;
BEGIN
  SELECT * INTO original FROM public.real_text_inputs WHERE operation_id=NEW.operation_id;
  IF NEW.source_transcript_id IS NOT NULL THEN
    IF FOUND THEN RAISE EXCEPTION 'Choose exactly one original source' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NOT FOUND OR (NEW.owner_id,NEW.project_id,NEW.session_id,NEW.operation_id,NEW.language)
    IS DISTINCT FROM (original.owner_id,original.project_id,original.session_id,original.operation_id,original.language)
    OR (NEW.role='user' AND (NEW.id<>original.input_id OR NEW.text<>original.text
      OR NEW.provenance IS DISTINCT FROM jsonb_build_object('mode','original','provider','user','model',NULL,'version',1)))
    OR (NEW.role='assistant' AND (NEW.provenance->>'mode' IS DISTINCT FROM 'real'
      OR NEW.provenance->>'provider' IS DISTINCT FROM 'openai'
      OR NEW.provenance->'version' IS DISTINCT FROM '1'::jsonb
      OR COALESCE(NEW.provenance->>'model','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$')) THEN
    RAISE EXCEPTION 'Typed message source mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.real_typed_message_guard_insert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER real_typed_message_scope BEFORE INSERT ON public.real_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.real_typed_message_guard_insert();

CREATE FUNCTION public.real_text_input_delete_sources() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  -- Equivalent to ON DELETE CASCADE without changing the published row shape.
  DELETE FROM public.real_conversation_messages
    WHERE operation_id=OLD.operation_id AND source_transcript_id IS NULL;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.real_text_input_delete_sources() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER real_text_input_sources_delete AFTER DELETE ON public.real_text_inputs
  FOR EACH ROW EXECUTE FUNCTION public.real_text_input_delete_sources();

-- A scoped, content-free deployment preflight: called with the user's JWT before
-- any paid dispatch. Missing migration or a foreign/inactive scope fails closed.
CREATE FUNCTION public.check_real_text_chat_scope(p_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.conversation_sessions;
BEGIN
  SELECT cs.* INTO s FROM public.conversation_sessions cs JOIN public.books b ON b.id=cs.project_id
    WHERE cs.id=p_session_id AND b.user_id=auth.uid() AND NOT b.is_deleted AND cs.language=b.language;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='P0002'; END IF;
  IF s.status<>'active' THEN RAISE EXCEPTION 'Session completed' USING ERRCODE='55000'; END IF;
  RETURN jsonb_build_object('project_id',s.project_id,'session_id',s.id,'language',s.language,'input_limit',4000);
END $$;
REVOKE ALL ON FUNCTION public.check_real_text_chat_scope(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_real_text_chat_scope(uuid) TO authenticated;

-- Hydrate a single existing message page only when it contains typed rows.
-- Voice-only reads retain their original columns and require no additional RPC.
CREATE FUNCTION public.get_real_text_chat_sources(p_session_id uuid,p_operation_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.conversation_sessions; sources jsonb; expected integer;
BEGIN
  IF p_operation_ids IS NULL OR cardinality(p_operation_ids) NOT BETWEEN 1 AND 100
    OR array_position(p_operation_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid original source page' USING ERRCODE='22023';
  END IF;
  SELECT cs.* INTO s FROM public.conversation_sessions cs JOIN public.books b ON b.id=cs.project_id
    WHERE cs.id=p_session_id AND b.user_id=auth.uid() AND NOT b.is_deleted AND cs.language=b.language;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='P0002'; END IF;
  SELECT count(DISTINCT id) INTO expected FROM unnest(p_operation_ids) AS requested(id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('input_id',i.input_id,'operation_id',i.operation_id,
    'project_id',i.project_id,'session_id',i.session_id,'language',i.language,'text',i.text)
    ORDER BY i.input_id),'[]'::jsonb) INTO sources FROM public.real_text_inputs i
    WHERE i.operation_id=ANY(p_operation_ids) AND i.owner_id=auth.uid()
      AND i.project_id=s.project_id AND i.session_id=s.id AND i.language=s.language;
  IF jsonb_array_length(sources)<>expected THEN
    RAISE EXCEPTION 'Original source unavailable' USING ERRCODE='P0002';
  END IF;
  RETURN jsonb_build_object('sources',sources);
END $$;
REVOKE ALL ON FUNCTION public.get_real_text_chat_sources(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_real_text_chat_sources(uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_real_ai_operation(p_owner_id uuid,p_operation_id uuid,p_claim_token uuid,
  p_result jsonb,p_provenance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.real_ai_operations; b public.books; s public.conversation_sessions;
  tr public.real_transcripts; ti public.real_text_inputs; um public.real_conversation_messages; am public.real_conversation_messages;
  source_id uuid; transcript_source uuid; typed_source uuid; original_text text; source_provenance jsonb;
  mem public.real_memories; d public.real_story_drafts; sp public.real_speech;
  f jsonb; review jsonb; ctx jsonb; prov jsonb; res jsonb; memories jsonb:='[]'; clarifications jsonb:='[]';
  conflict_id uuid; q text; seq bigint; draft_version integer; clarification public.real_memory_clarifications;
BEGIN
  SELECT * INTO o FROM public.real_ai_operations WHERE operation_id=p_operation_id AND owner_id=p_owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO b FROM public.books WHERE id=o.project_id AND user_id=p_owner_id AND NOT is_deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO o FROM public.real_ai_operations WHERE operation_id=p_operation_id FOR UPDATE;
  IF p_claim_token IS NULL OR o.claim_token<>p_claim_token THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='42501'; END IF;
  IF o.status='completed' THEN RETURN o.result; END IF;
  IF o.status<>'in_progress' THEN RAISE EXCEPTION 'Operation already consumed' USING ERRCODE='40001'; END IF;
  IF p_result IS NULL OR jsonb_typeof(p_result)<>'object' OR p_provenance IS NULL
    OR jsonb_typeof(p_provenance)<>'object' OR p_provenance->>'provider' IS DISTINCT FROM 'openai'
    OR p_provenance->>'mode' IS DISTINCT FROM 'real' OR p_provenance->'version' IS DISTINCT FROM '1'::jsonb
    OR COALESCE(p_provenance->>'model','') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' THEN
    RAISE EXCEPTION 'Real-provider provenance is required' USING ERRCODE='22023';
  END IF;
  -- Whitelist provenance fields; arbitrary provider payloads/secrets never persist.
  prov := jsonb_build_object('mode','real','provider','openai','model',p_provenance->>'model','version',1);
  IF o.session_id IS NOT NULL THEN
    SELECT * INTO s FROM public.conversation_sessions WHERE id=o.session_id AND project_id=b.id FOR UPDATE;
    IF NOT FOUND OR s.language<>b.language THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='P0002'; END IF;
    IF o.kind IN ('transcription','conversation') AND s.status<>'active' THEN RAISE EXCEPTION 'Session completed' USING ERRCODE='40001'; END IF;
  END IF;
  IF o.kind='transcription' THEN
    INSERT INTO public.real_transcripts(owner_id,project_id,session_id,operation_id,language,text,provenance)
      VALUES(p_owner_id,b.id,s.id,o.operation_id,b.language,p_result->>'text',prov) RETURNING * INTO tr;
    res:=to_jsonb(tr)-ARRAY['owner_id','operation_id'];
  ELSIF o.kind='conversation' THEN
    -- Exactly one original source. Typed words are never stored as a
    -- transcription or relabelled as model-authored input.
    IF (p_result ? 'input_text') = (p_result ? 'source_transcript_id') THEN
      RAISE EXCEPTION 'Choose exactly one original source' USING ERRCODE='22023';
    END IF;
    IF p_result ? 'input_text' THEN
      IF jsonb_typeof(p_result->'input_text') IS DISTINCT FROM 'string'
        OR length(p_result->>'input_text') NOT BETWEEN 1 AND 4000
        OR length(btrim(p_result->>'input_text',
          U&'\0009\000a\000b\000c\000d\001c\001d\001e\001f\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000'))=0 THEN
        RAISE EXCEPTION 'Invalid typed original' USING ERRCODE='22023';
      END IF;
      INSERT INTO public.real_text_inputs(input_id,owner_id,project_id,session_id,operation_id,language,text)
        VALUES(o.operation_id,p_owner_id,b.id,s.id,o.operation_id,b.language,p_result->>'input_text') RETURNING * INTO ti;
      source_id:=ti.input_id; typed_source:=ti.input_id; original_text:=ti.text;
      source_provenance:=jsonb_build_object('mode','original','provider','user','model',NULL,'version',1);
    ELSE
      SELECT * INTO tr FROM public.real_transcripts WHERE transcript_id=(p_result->>'source_transcript_id')::uuid
        AND owner_id=p_owner_id AND project_id=b.id AND session_id=s.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Transcript unavailable' USING ERRCODE='P0002'; END IF;
      IF EXISTS(SELECT 1 FROM public.real_conversation_messages WHERE source_transcript_id=tr.transcript_id) THEN
        RAISE EXCEPTION 'Transcript already processed' USING ERRCODE='40001';
      END IF;
      source_id:=tr.transcript_id; transcript_source:=tr.transcript_id; original_text:=tr.text;
      source_provenance:=tr.provenance;
    END IF;
    IF jsonb_typeof(p_result->'memories') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'memories')>8 THEN
      RAISE EXCEPTION 'Invalid memory candidates' USING ERRCODE='22023';
    END IF;
    SELECT COALESCE(max(sequence),0)+1 INTO seq FROM public.real_conversation_messages WHERE session_id=s.id;
    INSERT INTO public.real_conversation_messages(id,owner_id,project_id,session_id,operation_id,source_transcript_id,role,language,text,sequence,provenance)
      VALUES(source_id,p_owner_id,b.id,s.id,o.operation_id,transcript_source,'user',b.language,original_text,seq,source_provenance) RETURNING * INTO um;
    INSERT INTO public.real_conversation_messages(owner_id,project_id,session_id,operation_id,source_transcript_id,role,language,text,sequence,provenance)
      VALUES(p_owner_id,b.id,s.id,o.operation_id,transcript_source,'assistant',b.language,p_result->>'assistant_text',seq+1,prov) RETURNING * INTO am;
    FOR f IN SELECT value FROM jsonb_array_elements(p_result->'memories') LOOP
      IF jsonb_typeof(f)<>'object' OR COALESCE(f->>'value','')='' OR COALESCE(f->>'evidence','')=''
        OR position(f->>'value' IN original_text)=0 OR position(f->>'evidence' IN original_text)=0
        OR (NULLIF(f->>'year','') IS NOT NULL AND position(f->>'year' IN f->>'evidence')=0) THEN
        RAISE EXCEPTION 'Candidate lacks exact original evidence' USING ERRCODE='22023';
      END IF;
      conflict_id:=NULLIF(f->>'conflicts_with_fact_id','')::uuid;
      IF conflict_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.real_memories WHERE id=conflict_id AND project_id=b.id AND owner_id=p_owner_id) THEN
        RAISE EXCEPTION 'Conflicting memory unavailable' USING ERRCODE='P0002';
      END IF;
      q:=NULLIF(btrim(f->>'clarification_question'),'');
      IF (conflict_id IS NOT NULL OR COALESCE((f->>'uncertain')::boolean,false)) AND q IS NULL THEN
        RAISE EXCEPTION 'Uncertain memory requires clarification' USING ERRCODE='22023';
      END IF;
      INSERT INTO public.real_memories(owner_id,project_id,session_id,source_message_id,fact_type,value,evidence,year,slot,uncertain)
        VALUES(p_owner_id,b.id,s.id,um.id,f->>'fact_type',f->>'value',f->>'evidence',NULLIF(f->>'year','')::integer,
          NULLIF(f->>'slot',''),COALESCE((f->>'uncertain')::boolean,false)) RETURNING * INTO mem;
      memories:=memories || jsonb_build_array(to_jsonb(mem)-'owner_id');
      IF q IS NOT NULL THEN
        INSERT INTO public.real_memory_clarifications(owner_id,project_id,fact_id,session_id,conflicts_with_fact_id,question)
          VALUES(p_owner_id,b.id,mem.id,s.id,conflict_id,q) RETURNING * INTO clarification;
        clarifications:=clarifications || jsonb_build_array(to_jsonb(clarification)-ARRAY['owner_id','project_id']);
      END IF;
    END LOOP;
    res:=jsonb_build_object('user_message',to_jsonb(um)-ARRAY['owner_id','operation_id'],
      'message',to_jsonb(am)-ARRAY['owner_id','operation_id'],'memories',memories,
      'clarifications',clarifications,'requires_clarification',jsonb_array_length(clarifications)>0,'mode','real');
    IF typed_source IS NOT NULL THEN
      res:=jsonb_set(res,'{user_message}',res->'user_message'||jsonb_build_object('source_text_input_id',typed_source));
      res:=jsonb_set(res,'{message}',res->'message'||jsonb_build_object('source_text_input_id',typed_source));
    END IF;
  ELSIF o.kind='generation' THEN
    ctx:=public.real_story_context(b.id);
    IF jsonb_array_length(ctx->'source_memories')=0 OR jsonb_array_length(ctx->'blocking_clarifications')>0 THEN
      RAISE EXCEPTION 'Confirmed resolved source memories are required' USING ERRCODE='40001';
    END IF;
    IF p_result->'source_memories' IS DISTINCT FROM ctx->'source_memories' THEN
      RAISE EXCEPTION 'Source context changed' USING ERRCODE='40001';
    END IF;
    IF jsonb_typeof(p_result->'model_review') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Model review is required' USING ERRCODE='22023'; END IF;
    review:=jsonb_build_object('status','needs_review','method','model_review_v1','unsupported_claims',
      COALESCE(p_result->'model_review'->'unsupported_claims','[]'::jsonb),'checked_revision',1,
      'checked_at',now(),'sources_current',true,'reason','Model review is advisory; human review required');
    IF jsonb_typeof(review->'unsupported_claims')<>'array' OR jsonb_array_length(review->'unsupported_claims')>20 THEN
      RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(review->'unsupported_claims') claim
      WHERE jsonb_typeof(claim)<>'string' OR length(btrim(claim#>>'{}')) NOT BETWEEN 1 AND 1000) THEN
      RAISE EXCEPTION 'Invalid review claim' USING ERRCODE='22023';
    END IF;
    SELECT COALESCE(max(version),0)+1 INTO draft_version FROM public.real_story_drafts WHERE project_id=b.id;
    INSERT INTO public.real_story_drafts(owner_id,project_id,operation_id,language,version,content,original_content,source_memories,verification,provenance)
      VALUES(p_owner_id,b.id,o.operation_id,b.language,draft_version,p_result->>'content',p_result->>'content',ctx->'source_memories',review,prov) RETURNING * INTO d;
    res:=to_jsonb(d)-ARRAY['owner_id','operation_id'];
  ELSE
    SELECT * INTO am FROM public.real_conversation_messages WHERE id=(p_result->>'assistant_message_id')::uuid
      AND project_id=b.id AND session_id=s.id AND owner_id=p_owner_id AND role='assistant';
    IF NOT FOUND THEN RAISE EXCEPTION 'Assistant message unavailable' USING ERRCODE='P0002'; END IF;
    IF (p_result->>'expires_at')::timestamptz <= now() OR (p_result->>'expires_at')::timestamptz>now()+interval '1 hour' THEN
      RAISE EXCEPTION 'Invalid transient audio expiry' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.real_speech(owner_id,project_id,session_id,operation_id,assistant_message_id,media_type,audio_sha256,audio_size,expires_at,provenance)
      VALUES(p_owner_id,b.id,s.id,o.operation_id,am.id,p_result->>'media_type',p_result->>'audio_sha256',
        (p_result->>'audio_size')::integer,(p_result->>'expires_at')::timestamptz,prov) RETURNING * INTO sp;
    res:=to_jsonb(sp)-ARRAY['owner_id','operation_id'];
  END IF;
  UPDATE public.real_ai_operations SET status='completed',result=res,updated_at=now() WHERE operation_id=o.operation_id;
  RETURN res;
END $$;

-- CREATE OR REPLACE preserves the original RPC identity and ACL. Reassert the
-- intended boundary so default PUBLIC execution can never become a writer path.
REVOKE ALL ON FUNCTION public.complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
DO $trusted_completion$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb) TO service_role;
  END IF;
END $trusted_completion$;
COMMIT;
