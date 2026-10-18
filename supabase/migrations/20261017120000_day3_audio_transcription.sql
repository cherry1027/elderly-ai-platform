-- Day 3: durable, user-scoped transcription idempotency without raw-audio storage.
BEGIN;

CREATE TABLE public.audio_transcription_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  language text NOT NULL CHECK (language IN ('en', 'sv')),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'failed', 'completed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  claim_token uuid,
  completion_token uuid,
  failure_token uuid,
  lease_expires_at timestamptz,
  failure_code text CHECK (
    failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  message_id uuid UNIQUE
    REFERENCES public.conversation_messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT audio_transcription_requests_idempotency_key
    UNIQUE (user_id, session_id, idempotency_key),
  CONSTRAINT audio_transcription_request_state_valid CHECK (
    (
      status = 'processing'
      AND claim_token IS NOT NULL
      AND completion_token IS NULL
      AND failure_token IS NULL
      AND lease_expires_at IS NOT NULL
      AND failure_code IS NULL
      AND message_id IS NULL
      AND completed_at IS NULL
    ) OR (
      status = 'failed'
      AND claim_token IS NULL
      AND completion_token IS NULL
      AND failure_token IS NOT NULL
      AND lease_expires_at IS NULL
      AND failure_code IS NOT NULL
      AND message_id IS NULL
      AND completed_at IS NULL
    ) OR (
      status = 'completed'
      AND claim_token IS NULL
      AND completion_token IS NOT NULL
      AND failure_token IS NULL
      AND lease_expires_at IS NULL
      AND failure_code IS NULL
      AND message_id IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX audio_transcription_requests_session_created_idx
  ON public.audio_transcription_requests (session_id, created_at);

CREATE TRIGGER audio_transcription_requests_updated_at
  BEFORE UPDATE ON public.audio_transcription_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.audio_transcription_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audio_transcription_requests FROM PUBLIC, anon, authenticated;
-- The invoker-security read view needs only these non-secret base columns.
GRANT SELECT (user_id, session_id, language, status, message_id)
  ON public.audio_transcription_requests TO authenticated;

CREATE POLICY transcription_requests_select_owned
  ON public.audio_transcription_requests
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.conversation_sessions AS s
      JOIN public.books AS b ON b.id = s.project_id
      WHERE s.id = session_id
        AND b.user_id = (SELECT auth.uid())
        AND NOT b.is_deleted
    )
  );

-- Session identity is transcript provenance and cannot change after creation.
CREATE FUNCTION public.reject_conversation_session_identity_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.language IS DISTINCT FROM OLD.language THEN
    RAISE EXCEPTION 'Conversation session project and language are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_sessions_identity_immutable
  BEFORE UPDATE ON public.conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.reject_conversation_session_identity_update();

REVOKE ALL ON FUNCTION public.reject_conversation_session_identity_update()
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.claim_audio_transcription(
  p_project_id uuid,
  p_session_id uuid,
  p_idempotency_key uuid,
  p_content_sha256 text,
  p_language text
)
RETURNS TABLE (
  outcome text,
  request_id uuid,
  claim_token uuid,
  status text,
  transcript_id uuid,
  session_id uuid,
  language text,
  text text,
  created_at timestamptz,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_language text;
  v_session_status text;
  v_request public.audio_transcription_requests%ROWTYPE;
  v_claim_token uuid;
  v_original_text text;
  v_message_created_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_content_sha256 IS NULL OR p_content_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A lowercase SHA-256 content hash is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_language IS NULL OR p_language NOT IN ('en', 'sv') THEN
    RAISE EXCEPTION 'Unsupported transcription language' USING ERRCODE = '22023';
  END IF;

  -- Lock provenance during this short transaction. Provider I/O happens later.
  SELECT s.language, s.status
    INTO v_session_language, v_session_status
  FROM public.conversation_sessions AS s
  JOIN public.books AS b ON b.id = s.project_id
  WHERE s.id = p_session_id
    AND s.project_id = p_project_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted
  FOR SHARE OF s, b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned conversation session was not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_session_language <> p_language THEN
    RAISE EXCEPTION 'Transcription language must match the session language'
      USING ERRCODE = '22023';
  END IF;

  LOOP
    SELECT r.* INTO v_request
    FROM public.audio_transcription_requests AS r
    WHERE r.user_id = v_user_id
      AND r.session_id = p_session_id
      AND r.idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF FOUND THEN
      IF v_request.content_sha256 <> p_content_sha256
         OR v_request.language <> p_language THEN
        RAISE EXCEPTION 'Idempotency key is bound to different request content'
          USING ERRCODE = '23505';
      END IF;

      IF v_request.status = 'completed' THEN
        SELECT m.original_text, m.created_at
          INTO v_original_text, v_message_created_at
        FROM public.conversation_messages AS m
        WHERE m.id = v_request.message_id
          AND m.session_id = p_session_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Completed transcript message is missing'
            USING ERRCODE = '23503';
        END IF;
        RETURN QUERY SELECT
          'completed'::text, v_request.id, NULL::uuid, v_request.status,
          v_request.message_id, v_request.session_id, v_request.language,
          v_original_text, v_message_created_at, v_request.attempt_count;
        RETURN;
      END IF;

      IF v_request.status = 'processing'
         AND v_request.lease_expires_at > clock_timestamp() THEN
        RETURN QUERY SELECT
          'in_progress'::text, v_request.id, NULL::uuid, v_request.status,
          NULL::uuid, v_request.session_id, v_request.language,
          NULL::text, NULL::timestamptz, v_request.attempt_count;
        RETURN;
      END IF;

      IF v_session_status <> 'active' THEN
        RAISE EXCEPTION 'Conversation session is not active'
          USING ERRCODE = '55000';
      END IF;

      v_claim_token := gen_random_uuid();
      UPDATE public.audio_transcription_requests AS r
      SET status = 'processing',
          attempt_count = r.attempt_count + 1,
          claim_token = v_claim_token,
          completion_token = NULL,
          failure_token = NULL,
          lease_expires_at = clock_timestamp() + interval '120 seconds',
          failure_code = NULL,
          message_id = NULL,
          completed_at = NULL
      WHERE r.id = v_request.id
      RETURNING r.* INTO v_request;

      RETURN QUERY SELECT
        'claimed'::text, v_request.id, v_request.claim_token, v_request.status,
        NULL::uuid, v_request.session_id, v_request.language,
        NULL::text, NULL::timestamptz, v_request.attempt_count;
      RETURN;
    END IF;

    IF v_session_status <> 'active' THEN
      RAISE EXCEPTION 'Conversation session is not active'
        USING ERRCODE = '55000';
    END IF;

    v_claim_token := gen_random_uuid();
    INSERT INTO public.audio_transcription_requests (
      user_id, session_id, idempotency_key, content_sha256, language,
      claim_token, lease_expires_at
    ) VALUES (
      v_user_id, p_session_id, p_idempotency_key, p_content_sha256, p_language,
      v_claim_token, clock_timestamp() + interval '120 seconds'
    )
    ON CONFLICT ON CONSTRAINT audio_transcription_requests_idempotency_key
      DO NOTHING
    RETURNING * INTO v_request;

    IF FOUND THEN
      RETURN QUERY SELECT
        'claimed'::text, v_request.id, v_request.claim_token, v_request.status,
        NULL::uuid, v_request.session_id, v_request.language,
        NULL::text, NULL::timestamptz, v_request.attempt_count;
      RETURN;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.complete_audio_transcription(
  p_request_id uuid,
  p_claim_token uuid,
  p_original_text text
)
RETURNS TABLE (
  transcript_id uuid,
  session_id uuid,
  language text,
  text text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_session_status text;
  v_request public.audio_transcription_requests%ROWTYPE;
  v_message public.conversation_messages%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_original_text IS NULL OR length(btrim(p_original_text)) = 0 THEN
    RAISE EXCEPTION 'Transcript text must not be empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(p_original_text) > 32000 THEN
    RAISE EXCEPTION 'Transcript text exceeds 32000 characters'
      USING ERRCODE = '22001';
  END IF;

  SELECT r.session_id INTO v_session_id
  FROM public.audio_transcription_requests AS r
  WHERE r.id = p_request_id AND r.user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned transcription request was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT s.status INTO v_session_status
  FROM public.conversation_sessions AS s
  JOIN public.books AS b ON b.id = s.project_id
  WHERE s.id = v_session_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted
  FOR SHARE OF s, b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned conversation session was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT r.* INTO v_request
  FROM public.audio_transcription_requests AS r
  WHERE r.id = p_request_id
    AND r.user_id = v_user_id
    AND r.session_id = v_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned transcription request was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status = 'completed' THEN
    IF v_request.completion_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'Transcription claim token is stale'
        USING ERRCODE = '55000';
    END IF;
    SELECT m.* INTO v_message
    FROM public.conversation_messages AS m
    WHERE m.id = v_request.message_id
      AND m.session_id = v_request.session_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Completed transcript message is missing'
        USING ERRCODE = '23503';
    END IF;
    IF v_message.original_text <> p_original_text THEN
      RAISE EXCEPTION 'Completed claim is bound to different transcript text'
        USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT
      v_message.id, v_message.session_id, v_request.language,
      v_message.original_text, 'completed'::text, v_message.created_at;
    RETURN;
  END IF;

  IF v_request.status <> 'processing'
     OR v_request.claim_token IS DISTINCT FROM p_claim_token
     OR v_request.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Transcription claim token is stale'
      USING ERRCODE = '55000';
  END IF;
  IF v_session_status <> 'active' THEN
    RAISE EXCEPTION 'Conversation session is not active'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.conversation_messages (session_id, role, original_text)
  VALUES (v_request.session_id, 'user', p_original_text)
  RETURNING * INTO v_message;

  UPDATE public.audio_transcription_requests AS r
  SET status = 'completed',
      claim_token = NULL,
      completion_token = p_claim_token,
      failure_token = NULL,
      lease_expires_at = NULL,
      failure_code = NULL,
      message_id = v_message.id,
      completed_at = clock_timestamp()
  WHERE r.id = v_request.id;

  RETURN QUERY SELECT
    v_message.id, v_message.session_id, v_request.language,
    v_message.original_text, 'completed'::text, v_message.created_at;
END;
$$;

CREATE FUNCTION public.fail_audio_transcription(
  p_request_id uuid,
  p_claim_token uuid,
  p_failure_code text
)
RETURNS TABLE (request_id uuid, status text, attempt_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_request public.audio_transcription_requests%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_failure_code IS NULL
     OR p_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'A stable failure code is required' USING ERRCODE = '22023';
  END IF;

  SELECT r.session_id INTO v_session_id
  FROM public.audio_transcription_requests AS r
  WHERE r.id = p_request_id AND r.user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned transcription request was not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.conversation_sessions AS s
  JOIN public.books AS b ON b.id = s.project_id
  WHERE s.id = v_session_id AND b.user_id = v_user_id
  FOR SHARE OF s, b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned conversation session was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT r.* INTO v_request
  FROM public.audio_transcription_requests AS r
  WHERE r.id = p_request_id
    AND r.user_id = v_user_id
    AND r.session_id = v_session_id
  FOR UPDATE;

  IF v_request.status = 'failed' THEN
    IF v_request.failure_token IS DISTINCT FROM p_claim_token
       OR v_request.failure_code <> p_failure_code THEN
      RAISE EXCEPTION 'Transcription claim token is stale'
        USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.attempt_count;
    RETURN;
  END IF;

  IF v_request.status = 'completed' THEN
    IF v_request.completion_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'Transcription claim token is stale'
        USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.attempt_count;
    RETURN;
  END IF;

  IF v_request.status <> 'processing'
     OR v_request.claim_token IS DISTINCT FROM p_claim_token
     OR v_request.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Transcription claim token is stale'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.audio_transcription_requests AS r
  SET status = 'failed',
      claim_token = NULL,
      completion_token = NULL,
      failure_token = p_claim_token,
      lease_expires_at = NULL,
      failure_code = p_failure_code,
      message_id = NULL,
      completed_at = NULL
  WHERE r.id = v_request.id
  RETURNING r.* INTO v_request;

  RETURN QUERY SELECT v_request.id, v_request.status, v_request.attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_audio_transcription(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_audio_transcription(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_audio_transcription(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audio_transcription(uuid, uuid, uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_audio_transcription(uuid, uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_audio_transcription(uuid, uuid, text)
  TO authenticated;

CREATE VIEW public.audio_transcripts WITH (security_invoker = true) AS
  SELECT
    m.id AS transcript_id,
    r.session_id,
    r.language,
    m.original_text AS text,
    'completed'::text AS status,
    m.created_at
  FROM public.audio_transcription_requests AS r
  JOIN public.conversation_messages AS m ON m.id = r.message_id
  WHERE r.status = 'completed';

REVOKE ALL ON public.audio_transcripts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audio_transcripts TO authenticated;

COMMENT ON TABLE public.audio_transcription_requests IS
  'Idempotency ledger and short claim lease for transient audio transcription; stores no raw audio.';
COMMENT ON VIEW public.audio_transcripts IS
  'RLS-preserving completed audio transcripts; excludes typed messages and corrections.';

COMMIT;
