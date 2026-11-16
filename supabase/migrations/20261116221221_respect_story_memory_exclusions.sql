BEGIN;

-- Give the generator the current omissions under the same ownership and RLS
-- as memory review. Historic corrected wording comes from the reject revision.
CREATE FUNCTION memy_private.real_story_rejected_details(p_project_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(detail ORDER BY detail COLLATE "C"), '[]'::jsonb)
  FROM (
    SELECT DISTINCT rejected.detail
    FROM public.real_memories AS memory
    LEFT JOIN public.real_memory_revisions AS revision
      ON revision.memory_id = memory.id AND revision.version = memory.version
      AND revision.project_id = memory.project_id AND revision.owner_id = memory.owner_id
      AND revision.status = 'rejected'
    CROSS JOIN LATERAL (VALUES (memory.value), (revision.previous_corrected_value)) AS rejected(detail)
    WHERE memory.project_id = p_project_id AND memory.status = 'rejected' AND rejected.detail IS NOT NULL
  ) AS details;
$$;

CREATE FUNCTION public.get_real_story_generation_context(p_project_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE context jsonb;
BEGIN
  context := public.get_real_story_context(p_project_id);
  RETURN context || jsonb_build_object('rejected_details', memy_private.real_story_rejected_details(p_project_id));
END;
$$;

REVOKE ALL ON FUNCTION memy_private.real_story_rejected_details(uuid),
  public.get_real_story_generation_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION memy_private.real_story_rejected_details(uuid),
  public.get_real_story_generation_context(uuid) TO authenticated;

DO $$
BEGIN
  IF to_regrole('service_role') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION memy_private.real_story_rejected_details(uuid),
      public.get_real_story_generation_context(uuid) FROM service_role;
  END IF;
END $$;

-- Preserve the existing service-only RPC and its legacy payload contract. New
-- requests bind the full review snapshot before the draft insert, while this
-- function holds the project lock also acquired by memory review.
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
    IF (p_result ? 'context_token' OR p_result ? 'rejected_details') AND (
      p_result->'context_token' IS DISTINCT FROM ctx->'context_token'
      OR p_result->'rejected_details' IS DISTINCT FROM memy_private.real_story_rejected_details(b.id)
    ) THEN
      RAISE EXCEPTION 'Story review changed' USING ERRCODE='40001';
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

COMMIT;
