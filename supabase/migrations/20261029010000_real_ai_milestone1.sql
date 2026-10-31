-- Additive real-provider persistence. The v1 simulated contract remains unchanged.
-- Apply separately after review; this file does not activate a provider or Auth setting.
BEGIN;

CREATE TABLE public.real_ai_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('transcription','conversation','generation','speech')),
  action_key uuid NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed','uncertain')),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  result jsonb,
  error_code text CHECK (error_code ~ '^[A-Z0-9_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,kind,action_key),
  CHECK (kind = 'generation' OR session_id IS NOT NULL),
  CHECK ((status = 'completed' AND result IS NOT NULL AND error_code IS NULL)
    OR (status = 'in_progress' AND result IS NULL AND error_code IS NULL)
    OR (status IN ('failed','uncertain') AND result IS NULL AND error_code IS NOT NULL))
);

CREATE TABLE public.real_transcripts (
  transcript_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.real_ai_operations(operation_id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en','sv')),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 32000),
  status text NOT NULL DEFAULT 'completed' CHECK (status = 'completed'),
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.real_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES public.real_ai_operations(operation_id) ON DELETE CASCADE,
  source_transcript_id uuid NOT NULL REFERENCES public.real_transcripts(transcript_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  language text NOT NULL CHECK (language IN ('en','sv')),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 32000),
  sequence bigint NOT NULL CHECK (sequence > 0),
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,sequence), UNIQUE(source_transcript_id,role), UNIQUE(operation_id,role)
);

CREATE TABLE public.real_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES public.real_conversation_messages(id) ON DELETE CASCADE,
  fact_type text NOT NULL CHECK (fact_type IN ('person','relationship','date','location','event','emotion')),
  value text NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 1000),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 1000),
  year integer CHECK (year BETWEEN 1 AND 2100),
  slot text CHECK (length(slot) BETWEEN 1 AND 80),
  uncertain boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  corrected_value text CHECK (length(btrim(corrected_value)) BETWEEN 1 AND 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (corrected_value IS NULL OR status = 'confirmed')
);

CREATE TABLE public.real_memory_clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  fact_id uuid NOT NULL UNIQUE REFERENCES public.real_memories(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  conflicts_with_fact_id uuid REFERENCES public.real_memories(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (conflicts_with_fact_id IS NULL OR conflicts_with_fact_id <> fact_id),
  CHECK ((status='open' AND resolved_at IS NULL AND resolution IS NULL)
    OR (status='resolved' AND resolved_at IS NOT NULL AND resolution IS NOT NULL))
);

CREATE TABLE public.real_memory_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  memory_id uuid NOT NULL REFERENCES public.real_memories(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 1),
  previous_status text NOT NULL,
  status text NOT NULL,
  previous_corrected_value text,
  corrected_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(memory_id,version)
);

CREATE TABLE public.real_story_drafts (
  draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.real_ai_operations(operation_id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en','sv')),
  style text NOT NULL DEFAULT 'warm' CHECK (style='warm'),
  version integer NOT NULL CHECK (version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review','edited')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 20000),
  original_content text NOT NULL CHECK (length(btrim(original_content)) BETWEEN 1 AND 20000),
  source_memories jsonb NOT NULL CHECK (jsonb_typeof(source_memories)='array' AND jsonb_array_length(source_memories) BETWEEN 1 AND 200),
  mode text NOT NULL DEFAULT 'real' CHECK (mode='real'),
  verification jsonb NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id,version),
  CHECK ((revision=1 AND status='needs_review' AND content=original_content)
    OR (revision>1 AND status='edited')),
  CHECK (verification->>'status' = 'needs_review'),
  CHECK (verification->>'method' IN ('model_review_v1','manual_unverified'))
);

CREATE TABLE public.real_story_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.real_story_drafts(draft_id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision>1),
  previous_content text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id,revision)
);

-- Audio is returned transiently by the backend. This relation stores no audio or URL.
CREATE TABLE public.real_speech (
  speech_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL UNIQUE REFERENCES public.real_ai_operations(operation_id) ON DELETE CASCADE,
  assistant_message_id uuid NOT NULL REFERENCES public.real_conversation_messages(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type='audio/wav'),
  audio_sha256 text NOT NULL CHECK (audio_sha256 ~ '^[0-9a-f]{64}$'),
  audio_size integer NOT NULL CHECK (audio_size BETWEEN 1 AND 8000000),
  expires_at timestamptz NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.real_story_exports (
  export_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.real_story_drafts(draft_id) ON DELETE CASCADE,
  draft_version integer NOT NULL CHECK (draft_version>0),
  draft_revision integer NOT NULL CHECK (draft_revision>0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  language text NOT NULL CHECK (language IN ('en','sv')),
  format text NOT NULL DEFAULT 'pdf' CHECK (format='pdf'),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 20000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  filename text NOT NULL CHECK (length(filename)<=100 AND filename ~ '^memy-[a-z0-9]+(-[a-z0-9]+)*\.pdf$'),
  include_title_page boolean NOT NULL,
  include_page_numbers boolean NOT NULL,
  page_count integer NOT NULL CHECK (page_count BETWEEN 1 AND 100),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 2000000),
  renderer_version text NOT NULL CHECK (renderer_version='memy_real_pdf_v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id,draft_revision,title,include_title_page,include_page_numbers,renderer_version),
  CHECK (content_sha256=encode(sha256(convert_to(content,'UTF8')),'hex'))
);

CREATE INDEX real_transcripts_session ON public.real_transcripts(session_id,created_at);
CREATE INDEX real_messages_session ON public.real_conversation_messages(session_id,sequence);
CREATE INDEX real_memories_project ON public.real_memories(project_id,status,created_at,id);

-- New relations must not inherit the legacy deployment's broad default grants.
DO $grants$
DECLARE n text;
BEGIN
  FOREACH n IN ARRAY ARRAY['real_ai_operations','real_transcripts','real_conversation_messages',
    'real_memories','real_memory_clarifications','real_memory_revisions','real_story_drafts','real_story_edits','real_speech','real_story_exports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',n);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM service_role',n);
    END IF;
    IF n <> 'real_ai_operations' THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',n);
      EXECUTE format('CREATE POLICY real_owned_select ON public.%I FOR SELECT TO authenticated USING
        (owner_id=auth.uid() AND EXISTS (SELECT 1 FROM public.books b WHERE b.id=project_id AND b.user_id=auth.uid() AND NOT b.is_deleted))',n);
    END IF;
  END LOOP;
END $grants$;

CREATE FUNCTION public.real_ai_reject_update() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Immutable real-provider source or audit record' USING ERRCODE='55000'; END $$;
CREATE TRIGGER real_transcript_immutable BEFORE UPDATE ON public.real_transcripts FOR EACH ROW EXECUTE FUNCTION public.real_ai_reject_update();
CREATE TRIGGER real_message_immutable BEFORE UPDATE ON public.real_conversation_messages FOR EACH ROW EXECUTE FUNCTION public.real_ai_reject_update();
CREATE TRIGGER real_memory_audit_immutable BEFORE UPDATE ON public.real_memory_revisions FOR EACH ROW EXECUTE FUNCTION public.real_ai_reject_update();
CREATE TRIGGER real_edit_audit_immutable BEFORE UPDATE ON public.real_story_edits FOR EACH ROW EXECUTE FUNCTION public.real_ai_reject_update();
CREATE TRIGGER real_speech_immutable BEFORE UPDATE ON public.real_speech FOR EACH ROW EXECUTE FUNCTION public.real_ai_reject_update();
CREATE TRIGGER real_export_immutable BEFORE UPDATE ON public.real_story_exports FOR EACH ROW EXECUTE FUNCTION public.real_ai_reject_update();

CREATE FUNCTION public.real_ai_guard_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME='real_memories' AND
    (to_jsonb(NEW)-ARRAY['status','corrected_value','version','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','corrected_value','version','updated_at']) THEN
    RAISE EXCEPTION 'Original fact evidence is immutable' USING ERRCODE='55000';
  ELSIF TG_TABLE_NAME='real_story_drafts' AND
    (to_jsonb(NEW)-ARRAY['content','revision','status','verification','updated_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['content','revision','status','verification','updated_at']) THEN
    RAISE EXCEPTION 'Original draft and sources are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER real_memory_source_immutable BEFORE UPDATE ON public.real_memories FOR EACH ROW EXECUTE FUNCTION public.real_ai_guard_source();
CREATE TRIGGER real_draft_source_immutable BEFORE UPDATE ON public.real_story_drafts FOR EACH ROW EXECUTE FUNCTION public.real_ai_guard_source();

-- Only trusted backend calls may create a claim. A pre-existing claim never
-- yields its nonce again, even after a crash, timeout or an uncertain outcome.
CREATE FUNCTION public.claim_real_ai_operation(p_owner_id uuid,p_project_id uuid,p_session_id uuid,
  p_kind text,p_action_key uuid,p_request_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.real_ai_operations; b public.books; s public.conversation_sessions;
BEGIN
  IF p_owner_id IS NULL OR p_project_id IS NULL OR p_action_key IS NULL OR p_kind IS NULL
    OR p_kind NOT IN ('transcription','conversation','generation','speech') OR p_request_sha256 IS NULL
    OR p_request_sha256 !~ '^[0-9a-f]{64}$' OR (p_kind<>'generation' AND p_session_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023';
  END IF;
  SELECT * INTO b FROM public.books WHERE id=p_project_id AND user_id=p_owner_id AND NOT is_deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='P0002'; END IF;
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO s FROM public.conversation_sessions WHERE id=p_session_id AND project_id=b.id FOR UPDATE;
    IF NOT FOUND OR s.language<>b.language THEN RAISE EXCEPTION 'Session unavailable' USING ERRCODE='P0002'; END IF;
  END IF;
  SELECT * INTO o FROM public.real_ai_operations WHERE owner_id=p_owner_id AND kind=p_kind AND action_key=p_action_key FOR UPDATE;
  IF FOUND THEN
    IF o.project_id<>p_project_id OR o.session_id IS DISTINCT FROM p_session_id OR o.request_sha256<>p_request_sha256 THEN
      RAISE EXCEPTION 'Action key payload mismatch' USING ERRCODE='40001';
    END IF;
    RETURN jsonb_build_object('operation_id',o.operation_id,'kind',o.kind,'status',o.status,'claimed',false,'result',o.result,'error_code',o.error_code);
  END IF;
  IF p_kind IN ('transcription','conversation') AND s.status<>'active' THEN
    RAISE EXCEPTION 'Session is completed' USING ERRCODE='40001';
  END IF;
  -- Conversation request hashes bind the immutable transcript UUID + language.
  -- Different action keys must not buy a second reply for one source after
  -- dispatch. A trusted, proven no-dispatch failure permits a new explicit
  -- action; the failed original key remains terminal. Project lock serializes.
  IF p_kind='conversation' AND EXISTS(SELECT 1 FROM public.real_ai_operations
    WHERE owner_id=p_owner_id AND project_id=p_project_id AND session_id=p_session_id
      AND kind=p_kind AND request_sha256=p_request_sha256 AND status<>'failed') THEN
    RAISE EXCEPTION 'Conversation source already claimed' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.real_ai_operations(owner_id,project_id,session_id,kind,action_key,request_sha256)
    VALUES(p_owner_id,p_project_id,p_session_id,p_kind,p_action_key,p_request_sha256) RETURNING * INTO o;
  RETURN jsonb_build_object('operation_id',o.operation_id,'kind',o.kind,'status',o.status,'claimed',true,'claim_token',o.claim_token,'result',NULL,'error_code',NULL);
END $$;

CREATE FUNCTION public.get_real_ai_operation(p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.real_ai_operations;
BEGIN
  SELECT r.* INTO o FROM public.real_ai_operations r JOIN public.books b ON b.id=r.project_id
    WHERE r.operation_id=p_operation_id AND r.owner_id=auth.uid() AND b.user_id=auth.uid() AND NOT b.is_deleted;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('operation_id',o.operation_id,'kind',o.kind,'status',o.status,
    'project_id',o.project_id,'session_id',o.session_id,'created_at',o.created_at,'updated_at',o.updated_at,
    'result',o.result,'error_code',o.error_code);
END $$;

-- Recover after an interrupted HTTP response using the client-held action key.
-- This is an authenticated read, never a new claim or provider dispatch.
CREATE FUNCTION public.get_real_ai_operation_by_key(p_kind text,p_action_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.real_ai_operations;
BEGIN
  SELECT r.* INTO o FROM public.real_ai_operations r JOIN public.books b ON b.id=r.project_id
    WHERE r.kind=p_kind AND r.action_key=p_action_key AND r.owner_id=auth.uid()
      AND b.user_id=auth.uid() AND NOT b.is_deleted;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('operation_id',o.operation_id,'kind',o.kind,'status',o.status,
    'project_id',o.project_id,'session_id',o.session_id,'created_at',o.created_at,'updated_at',o.updated_at,
    'result',o.result,'error_code',o.error_code);
END $$;

CREATE FUNCTION public.real_memory_response(p_memory_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT to_jsonb(m)-'owner_id' FROM public.real_memories m WHERE m.id=p_memory_id
$$;

CREATE FUNCTION public.real_story_context(p_project_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE b public.books; sources jsonb; excluded jsonb; blocking jsonb; token text;
BEGIN
  SELECT * INTO b FROM public.books WHERE id=p_project_id AND NOT is_deleted;
  IF NOT FOUND THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('memory_id',m.id,'memory_version',m.version,
    'source_message_id',m.source_message_id,'fact_type',m.fact_type,'value',m.value,'evidence',m.evidence,
    'corrected_value',m.corrected_value,'year',m.year,'slot',m.slot,
    'sentence',COALESCE(m.corrected_value,m.value)) ORDER BY m.created_at,m.id),'[]'::jsonb) INTO sources
    FROM public.real_memories m WHERE m.project_id=b.id AND m.status='confirmed';
  IF jsonb_array_length(sources)>200 THEN RAISE EXCEPTION 'Too many source memories' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('memory_id',m.id,'reason',m.status) ORDER BY m.created_at,m.id),'[]'::jsonb) INTO excluded
    FROM public.real_memories m WHERE m.project_id=b.id AND m.status<>'confirmed';
  SELECT COALESCE(jsonb_agg(c.id ORDER BY c.id),'[]'::jsonb) INTO blocking FROM public.real_memory_clarifications c
    WHERE c.project_id=b.id AND c.status='open';
  token := encode(sha256(convert_to(jsonb_build_object('project_id',b.id,'language',b.language,
    'source_memories',sources,'excluded_memories',excluded,'blocking_clarifications',blocking)::text,'UTF8')),'hex');
  RETURN jsonb_build_object('project_id',b.id,'language',b.language,'context_token',token,
    'confirmed_count',jsonb_array_length(sources),'source_memories',sources,'excluded_memories',excluded,
    'blocking_clarifications',blocking,'canonical_content','');
END $$;

CREATE FUNCTION public.get_real_story_context(p_project_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.books WHERE id=p_project_id AND user_id=auth.uid() AND NOT is_deleted) THEN
    RAISE EXCEPTION 'Project unavailable' USING ERRCODE='P0002';
  END IF;
  RETURN public.real_story_context(p_project_id);
END $$;

CREATE FUNCTION public.complete_real_ai_operation(p_owner_id uuid,p_operation_id uuid,p_claim_token uuid,
  p_result jsonb,p_provenance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.real_ai_operations; b public.books; s public.conversation_sessions;
  tr public.real_transcripts; um public.real_conversation_messages; am public.real_conversation_messages;
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
    SELECT * INTO tr FROM public.real_transcripts WHERE transcript_id=(p_result->>'source_transcript_id')::uuid
      AND owner_id=p_owner_id AND project_id=b.id AND session_id=s.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Transcript unavailable' USING ERRCODE='P0002'; END IF;
    IF EXISTS(SELECT 1 FROM public.real_conversation_messages WHERE source_transcript_id=tr.transcript_id) THEN
      RAISE EXCEPTION 'Transcript already processed' USING ERRCODE='40001';
    END IF;
    IF jsonb_typeof(p_result->'memories') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'memories')>8 THEN
      RAISE EXCEPTION 'Invalid memory candidates' USING ERRCODE='22023';
    END IF;
    SELECT COALESCE(max(sequence),0)+1 INTO seq FROM public.real_conversation_messages WHERE session_id=s.id;
    INSERT INTO public.real_conversation_messages(id,owner_id,project_id,session_id,operation_id,source_transcript_id,role,language,text,sequence,provenance)
      VALUES(tr.transcript_id,p_owner_id,b.id,s.id,o.operation_id,tr.transcript_id,'user',b.language,tr.text,seq,tr.provenance) RETURNING * INTO um;
    INSERT INTO public.real_conversation_messages(owner_id,project_id,session_id,operation_id,source_transcript_id,role,language,text,sequence,provenance)
      VALUES(p_owner_id,b.id,s.id,o.operation_id,tr.transcript_id,'assistant',b.language,p_result->>'assistant_text',seq+1,prov) RETURNING * INTO am;
    FOR f IN SELECT value FROM jsonb_array_elements(p_result->'memories') LOOP
      IF jsonb_typeof(f)<>'object' OR COALESCE(f->>'value','')='' OR COALESCE(f->>'evidence','')=''
        OR position(f->>'value' IN tr.text)=0 OR position(f->>'evidence' IN tr.text)=0
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

CREATE FUNCTION public.fail_real_ai_operation(p_owner_id uuid,p_operation_id uuid,p_claim_token uuid,p_error_code text,p_uncertain boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.real_ai_operations;
BEGIN
  SELECT * INTO o FROM public.real_ai_operations WHERE operation_id=p_operation_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable' USING ERRCODE='P0002'; END IF;
  IF p_claim_token IS NULL OR o.claim_token<>p_claim_token THEN RAISE EXCEPTION 'Invalid claim' USING ERRCODE='42501'; END IF;
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{1,80}$' OR p_uncertain IS NULL THEN RAISE EXCEPTION 'Invalid failure code' USING ERRCODE='22023'; END IF;
  IF o.status='in_progress' THEN
    UPDATE public.real_ai_operations SET status=CASE WHEN p_uncertain THEN 'uncertain' ELSE 'failed' END,
      error_code=p_error_code,updated_at=now() WHERE operation_id=o.operation_id RETURNING * INTO o;
  END IF;
  RETURN jsonb_build_object('operation_id',o.operation_id,'kind',o.kind,'status',o.status,'claimed',false,'result',o.result,'error_code',o.error_code);
END $$;

CREATE FUNCTION public.review_real_memory(p_memory_id uuid,p_expected_version integer,p_status text,p_corrected_value text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m public.real_memories; previous public.real_memories; pid uuid;
BEGIN
  SELECT project_id INTO pid FROM public.real_memories WHERE id=p_memory_id AND owner_id=auth.uid();
  PERFORM 1 FROM public.books WHERE id=pid AND user_id=auth.uid() AND NOT is_deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Memory unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO m FROM public.real_memories WHERE id=p_memory_id AND owner_id=auth.uid() FOR UPDATE;
  IF p_expected_version IS NULL OR p_expected_version<1 OR p_status IS NULL OR p_status NOT IN ('confirmed','rejected')
    OR (p_corrected_value IS NOT NULL AND (p_status<>'confirmed' OR length(btrim(p_corrected_value)) NOT BETWEEN 1 AND 1000)) THEN
    RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023';
  END IF;
  IF m.version<>p_expected_version THEN
    IF m.version=p_expected_version+1 AND m.status=p_status AND m.corrected_value IS NOT DISTINCT FROM p_corrected_value THEN RETURN to_jsonb(m)-'owner_id'; END IF;
    RAISE EXCEPTION 'Memory version changed' USING ERRCODE='40001';
  END IF;
  IF p_status='confirmed' AND EXISTS(SELECT 1 FROM public.real_memory_clarifications c
    JOIN public.real_memories other ON other.id=CASE WHEN c.fact_id=m.id THEN c.conflicts_with_fact_id ELSE c.fact_id END
    WHERE (c.fact_id=m.id OR c.conflicts_with_fact_id=m.id) AND other.status='confirmed') THEN
    RAISE EXCEPTION 'Resolve the conflicting confirmed memory first' USING ERRCODE='40001';
  END IF;
  IF m.status=p_status AND m.corrected_value IS NOT DISTINCT FROM p_corrected_value THEN RETURN to_jsonb(m)-'owner_id'; END IF;
  previous:=m;
  UPDATE public.real_memories SET status=p_status,corrected_value=p_corrected_value,version=version+1,updated_at=now() WHERE id=m.id RETURNING * INTO m;
  INSERT INTO public.real_memory_revisions(owner_id,project_id,session_id,memory_id,version,previous_status,status,previous_corrected_value,corrected_value)
    VALUES(m.owner_id,m.project_id,m.session_id,m.id,m.version,previous.status,m.status,previous.corrected_value,m.corrected_value);
  UPDATE public.real_memory_clarifications SET status='resolved',resolution=COALESCE(p_corrected_value,p_status),resolved_at=now()
    WHERE fact_id=m.id AND status='open';
  RETURN to_jsonb(m)-'owner_id';
END $$;

CREATE FUNCTION public.edit_real_story_draft(p_draft_id uuid,p_expected_revision integer,p_content text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.real_story_drafts; previous_content text; pid uuid;
BEGIN
  SELECT project_id INTO pid FROM public.real_story_drafts WHERE draft_id=p_draft_id AND owner_id=auth.uid();
  PERFORM 1 FROM public.books WHERE id=pid AND user_id=auth.uid() AND NOT is_deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM public.real_story_drafts WHERE draft_id=p_draft_id AND owner_id=auth.uid() FOR UPDATE;
  IF p_expected_revision IS NULL OR p_expected_revision<1 OR p_content IS NULL OR length(btrim(p_content)) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'Invalid edit' USING ERRCODE='22023';
  END IF;
  IF d.revision<>p_expected_revision THEN
    IF d.revision=p_expected_revision+1 AND d.content=p_content THEN RETURN to_jsonb(d)-ARRAY['owner_id','operation_id']; END IF;
    RAISE EXCEPTION 'Draft revision changed' USING ERRCODE='40001';
  END IF;
  IF d.content=p_content THEN RETURN to_jsonb(d)-ARRAY['owner_id','operation_id']; END IF;
  previous_content:=d.content;
  UPDATE public.real_story_drafts SET content=p_content,revision=revision+1,status='edited',updated_at=now(),
    verification=jsonb_build_object('status','needs_review','method','manual_unverified','unsupported_claims','[]'::jsonb,
      'checked_revision',revision+1,'checked_at',now(),'sources_current',false,'reason','Manual revision requires human review')
    WHERE draft_id=d.draft_id RETURNING * INTO d;
  INSERT INTO public.real_story_edits(owner_id,project_id,draft_id,revision,previous_content,content)
    VALUES(d.owner_id,d.project_id,d.draft_id,d.revision,previous_content,d.content);
  RETURN to_jsonb(d)-ARRAY['owner_id','operation_id'];
END $$;

CREATE FUNCTION public.record_real_story_export(p_draft_id uuid,p_expected_revision integer,p_project_title text,
  p_include_title_page boolean,p_include_page_numbers boolean,p_page_count integer,p_byte_size integer,
  p_filename text,p_renderer_version text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d public.real_story_drafts; b public.books; e public.real_story_exports; pid uuid;
BEGIN
  IF p_expected_revision IS NULL OR p_expected_revision<1 OR p_project_title IS NULL
    OR p_include_title_page IS NULL OR p_include_page_numbers IS NULL
    OR p_page_count IS NULL OR p_page_count NOT BETWEEN 1 AND 100
    OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 2000000
    OR p_filename IS NULL OR length(p_filename)>100 OR p_filename !~ '^memy-[a-z0-9]+(-[a-z0-9]+)*\.pdf$'
    OR p_renderer_version IS DISTINCT FROM 'memy_real_pdf_v1' THEN
    RAISE EXCEPTION 'Invalid export metadata' USING ERRCODE='22023';
  END IF;
  SELECT project_id INTO pid FROM public.real_story_drafts WHERE draft_id=p_draft_id AND owner_id=auth.uid();
  SELECT * INTO b FROM public.books WHERE id=pid AND user_id=auth.uid() AND NOT is_deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO d FROM public.real_story_drafts WHERE draft_id=p_draft_id AND owner_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='P0002'; END IF;
  IF d.revision<>p_expected_revision OR b.title IS DISTINCT FROM p_project_title THEN
    RAISE EXCEPTION 'Draft or project title changed' USING ERRCODE='40001';
  END IF;
  SELECT * INTO e FROM public.real_story_exports WHERE draft_id=d.draft_id AND draft_revision=d.revision
    AND title=b.title AND include_title_page=p_include_title_page AND include_page_numbers=p_include_page_numbers
    AND renderer_version=p_renderer_version;
  IF NOT FOUND THEN
    INSERT INTO public.real_story_exports(owner_id,project_id,draft_id,draft_version,draft_revision,title,language,content,
      content_sha256,filename,include_title_page,include_page_numbers,page_count,byte_size,renderer_version)
      VALUES(d.owner_id,d.project_id,d.draft_id,d.version,d.revision,b.title,d.language,d.content,
        encode(sha256(convert_to(d.content,'UTF8')),'hex'),p_filename,p_include_title_page,p_include_page_numbers,
        p_page_count,p_byte_size,p_renderer_version) RETURNING * INTO e;
  END IF;
  RETURN to_jsonb(e)-ARRAY['owner_id','content'];
END $$;

CREATE FUNCTION public.get_real_story_export(p_export_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.real_story_exports;
BEGIN
  SELECT r.* INTO e FROM public.real_story_exports r JOIN public.books b ON b.id=r.project_id
    WHERE r.export_id=p_export_id AND r.owner_id=auth.uid() AND b.user_id=auth.uid() AND NOT b.is_deleted;
  IF NOT FOUND THEN RAISE EXCEPTION 'Export unavailable' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('export',to_jsonb(e)-ARRAY['owner_id','content'],'content',e.content);
END $$;

-- Revoke default PUBLIC function execution; grant only the intended trust boundary.
REVOKE ALL ON FUNCTION public.real_ai_reject_update(),public.real_ai_guard_source(),
  public.real_memory_response(uuid),public.real_story_context(uuid),
  public.claim_real_ai_operation(uuid,uuid,uuid,text,uuid,text),
  public.complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb),
  public.fail_real_ai_operation(uuid,uuid,uuid,text,boolean),
  public.get_real_ai_operation(uuid),public.get_real_ai_operation_by_key(text,uuid),public.get_real_story_context(uuid),
  public.review_real_memory(uuid,integer,text,text),public.edit_real_story_draft(uuid,integer,text),
  public.record_real_story_export(uuid,integer,text,boolean,boolean,integer,integer,text,text),public.get_real_story_export(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_real_ai_operation(uuid),public.get_real_ai_operation_by_key(text,uuid),public.get_real_story_context(uuid),
  public.review_real_memory(uuid,integer,text,text),public.edit_real_story_draft(uuid,integer,text),
  public.record_real_story_export(uuid,integer,text,boolean,boolean,integer,integer,text,text),public.get_real_story_export(uuid) TO authenticated;
DO $service$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_real_ai_operation(uuid,uuid,uuid,text,uuid,text),
      public.complete_real_ai_operation(uuid,uuid,uuid,jsonb,jsonb),
      public.fail_real_ai_operation(uuid,uuid,uuid,text,boolean) TO service_role;
  END IF;
END $service$;

COMMIT;
