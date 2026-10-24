-- Day 4: atomic conversation turns, extracted memory candidates and review.
-- Existing conversation_messages remain the immutable source of truth.
BEGIN;

CREATE VIEW public.conversation_message_history
WITH (security_invoker = true) AS
  SELECT
    m.id,
    m.session_id,
    m.sequence,
    m.role,
    m.original_text AS text,
    s.language,
    m.created_at
  FROM public.conversation_messages AS m
  JOIN public.conversation_sessions AS s ON s.id = m.session_id;

REVOKE ALL ON public.conversation_message_history
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conversation_message_history TO authenticated;

CREATE TABLE public.memory_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  session_id uuid NOT NULL
    REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL
    REFERENCES public.conversation_messages(id) ON DELETE CASCADE,
  fact_type text NOT NULL CHECK (
    fact_type IN (
      'person', 'relationship', 'date', 'location', 'event', 'emotion'
    )
  ),
  value text NOT NULL CHECK (
    length(btrim(value)) > 0 AND char_length(value) <= 1000
  ),
  evidence text NOT NULL CHECK (
    length(btrim(evidence)) > 0 AND char_length(evidence) <= 1000
  ),
  year integer CHECK (year IS NULL OR year BETWEEN 1 AND 2100),
  slot text CHECK (
    slot IS NULL OR (length(btrim(slot)) > 0 AND char_length(slot) <= 80)
  ),
  uncertain boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  corrected_value text CHECK (
    corrected_value IS NULL
    OR (
      status = 'confirmed'
      AND length(btrim(corrected_value)) > 0
      AND char_length(corrected_value) <= 1000
    )
  ),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_facts_project_created_idx
  ON public.memory_facts (project_id, created_at);
CREATE INDEX memory_facts_session_created_idx
  ON public.memory_facts (session_id, created_at);

CREATE TABLE public.memory_clarifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id uuid NOT NULL REFERENCES public.memory_facts(id) ON DELETE CASCADE,
  session_id uuid NOT NULL
    REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  conflicts_with_fact_id uuid
    REFERENCES public.memory_facts(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (
    length(btrim(question)) > 0 AND char_length(question) <= 1000
  ),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT memory_clarification_state_valid CHECK (
    (status = 'open' AND resolution IS NULL AND resolved_at IS NULL)
    OR (
      status = 'resolved'
      AND length(btrim(resolution)) > 0
      AND resolved_at IS NOT NULL
    )
  )
);

CREATE INDEX memory_clarifications_session_created_idx
  ON public.memory_clarifications (session_id, created_at);
CREATE INDEX memory_clarifications_fact_status_idx
  ON public.memory_clarifications (fact_id, status);

CREATE TABLE public.memory_fact_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id uuid NOT NULL REFERENCES public.memory_facts(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_version integer NOT NULL CHECK (previous_version > 0),
  version integer NOT NULL CHECK (version > previous_version),
  previous_status text NOT NULL
    CHECK (previous_status IN ('pending', 'confirmed', 'rejected')),
  status text NOT NULL CHECK (status IN ('confirmed', 'rejected')),
  previous_corrected_value text,
  corrected_value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fact_id, version)
);

CREATE TABLE public.conversation_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL
    REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  user_message_id uuid NOT NULL UNIQUE
    REFERENCES public.conversation_messages(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  request_text text NOT NULL CHECK (
    length(btrim(request_text)) > 0 AND char_length(request_text) <= 32000
  ),
  request_language text NOT NULL CHECK (request_language IN ('en', 'sv')),
  source_message_id uuid
    REFERENCES public.conversation_messages(id) ON DELETE CASCADE,
  expected_sequence bigint NOT NULL CHECK (expected_sequence >= 0),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, idempotency_key)
);

-- An explicitly referenced transcript may be processed only once, even if a
-- client accidentally changes its idempotency key. user_message_id extends
-- that protection to user messages originally created by typed turns.
CREATE UNIQUE INDEX conversation_turns_source_once_idx
  ON public.conversation_turns (source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE INDEX conversation_turns_session_created_idx
  ON public.conversation_turns (session_id, created_at);

CREATE FUNCTION public.enforce_memory_fact_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
    OR NEW.fact_type IS DISTINCT FROM OLD.fact_type
    OR NEW.value IS DISTINCT FROM OLD.value
    OR NEW.evidence IS DISTINCT FROM OLD.evidence
    OR NEW.year IS DISTINCT FROM OLD.year
    OR NEW.slot IS DISTINCT FROM OLD.slot
    OR NEW.uncertain IS DISTINCT FROM OLD.uncertain
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Memory fact source and extracted value are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM public.conversation_sessions AS s
    JOIN public.conversation_messages AS m ON m.session_id = s.id
    WHERE s.id = NEW.session_id
      AND s.project_id = NEW.project_id
      AND m.id = NEW.source_message_id
      AND m.role = 'user'
  ) THEN
    RAISE EXCEPTION 'Memory fact source must be a user message in its project session'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_facts_integrity
  BEFORE INSERT OR UPDATE ON public.memory_facts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_fact_integrity();

CREATE TRIGGER memory_facts_updated_at
  BEFORE UPDATE ON public.memory_facts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.enforce_memory_clarification_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_project_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.fact_id IS DISTINCT FROM OLD.fact_id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.conflicts_with_fact_id IS DISTINCT FROM OLD.conflicts_with_fact_id
    OR NEW.question IS DISTINCT FROM OLD.question
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Memory clarification source is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT f.project_id INTO v_project_id
    FROM public.memory_facts AS f
    WHERE f.id = NEW.fact_id AND f.session_id = NEW.session_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Clarification fact must belong to its session'
        USING ERRCODE = '23503';
    END IF;

    IF NEW.conflicts_with_fact_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.memory_facts AS conflict
      WHERE conflict.id = NEW.conflicts_with_fact_id
        AND conflict.project_id = v_project_id
        AND conflict.status <> 'rejected'
    ) THEN
      RAISE EXCEPTION 'Conflicting fact must be non-rejected in the same project'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_clarifications_integrity
  BEFORE INSERT OR UPDATE ON public.memory_clarifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_memory_clarification_integrity();

CREATE FUNCTION public.reject_memory_revision_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Memory fact revisions are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER memory_fact_revisions_immutable
  BEFORE UPDATE ON public.memory_fact_revisions
  FOR EACH ROW EXECUTE FUNCTION public.reject_memory_revision_update();

ALTER TABLE public.memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_clarifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_fact_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_turns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.memory_facts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.memory_clarifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.memory_fact_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.conversation_turns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.memory_facts TO authenticated;
GRANT SELECT ON public.memory_clarifications TO authenticated;

CREATE POLICY memory_facts_select_owned
  ON public.memory_facts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversation_sessions AS s
      JOIN public.books AS b ON b.id = s.project_id
      WHERE s.id = memory_facts.session_id
        AND s.project_id = memory_facts.project_id
        AND b.user_id = (SELECT auth.uid())
        AND NOT b.is_deleted
    )
  );

CREATE POLICY memory_clarifications_select_owned
  ON public.memory_clarifications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.memory_facts AS f
      JOIN public.books AS b ON b.id = f.project_id
      WHERE f.id = memory_clarifications.fact_id
        AND f.session_id = memory_clarifications.session_id
        AND b.user_id = (SELECT auth.uid())
        AND NOT b.is_deleted
    )
  );

CREATE FUNCTION public.get_conversation_turn(
  p_session_id uuid,
  p_idempotency_key uuid,
  p_text text,
  p_language text,
  p_source_message_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_language text;
  v_turn public.conversation_turns%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL
     OR p_text IS NULL
     OR length(btrim(p_text)) = 0
     OR char_length(p_text) > (CASE
       WHEN p_source_message_id IS NULL THEN 4000 ELSE 32000
     END)
     OR p_language IS NULL
     OR p_language NOT IN ('en', 'sv') THEN
    RAISE EXCEPTION 'Invalid conversation turn request'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.language INTO v_session_language
  FROM public.conversation_sessions AS s
  JOIN public.books AS b ON b.id = s.project_id
  WHERE s.id = p_session_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned conversation session was not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_session_language <> p_language THEN
    RAISE EXCEPTION 'Conversation language must match the session language'
      USING ERRCODE = '22023';
  END IF;

  SELECT t.* INTO v_turn
  FROM public.conversation_turns AS t
  WHERE t.session_id = p_session_id
    AND t.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_turn.user_id <> v_user_id
     OR v_turn.request_text <> p_text
     OR v_turn.request_language <> p_language
     OR v_turn.source_message_id IS DISTINCT FROM p_source_message_id THEN
    RAISE EXCEPTION 'Idempotency key is bound to different request content'
      USING ERRCODE = '23505';
  END IF;

  RETURN v_turn.result;
END;
$$;

CREATE FUNCTION public.append_conversation_turn(
  p_session_id uuid,
  p_idempotency_key uuid,
  p_text text,
  p_language text,
  p_source_message_id uuid,
  p_expected_sequence bigint,
  p_assistant_text text,
  p_facts jsonb,
  p_context_versions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_session_language text;
  v_session_status text;
  v_current_sequence bigint;
  v_actual_context_versions jsonb;
  v_turn public.conversation_turns%ROWTYPE;
  v_user_message public.conversation_messages%ROWTYPE;
  v_assistant_message public.conversation_messages%ROWTYPE;
  v_candidate jsonb;
  v_fact public.memory_facts%ROWTYPE;
  v_clarification public.memory_clarifications%ROWTYPE;
  v_fact_type text;
  v_value text;
  v_evidence text;
  v_slot text;
  v_question text;
  v_year integer;
  v_uncertain boolean;
  v_conflict_id uuid;
  v_memories jsonb := '[]'::jsonb;
  v_clarifications jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL
     OR p_text IS NULL
     OR length(btrim(p_text)) = 0
     OR char_length(p_text) > (CASE
       WHEN p_source_message_id IS NULL THEN 4000 ELSE 32000
     END)
     OR p_language IS NULL
     OR p_language NOT IN ('en', 'sv')
     OR p_context_versions IS NULL
     OR jsonb_typeof(p_context_versions) <> 'array' THEN
    RAISE EXCEPTION 'Invalid conversation turn request'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve the parent without locking it, then lock the owned project before
  -- any session or fact. Every Day 4 append/review uses this lock order.
  SELECT s.project_id INTO v_project_id
  FROM public.conversation_sessions AS s
  WHERE s.id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned conversation session was not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.books AS b
  WHERE b.id = v_project_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned conversation session was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT s.language, s.status
    INTO v_session_language, v_session_status
  FROM public.conversation_sessions AS s
  WHERE s.id = p_session_id
    AND s.project_id = v_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned conversation session was not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_session_language <> p_language THEN
    RAISE EXCEPTION 'Conversation language must match the session language'
      USING ERRCODE = '22023';
  END IF;

  -- Replays succeed even after the session completed or its context advanced.
  SELECT t.* INTO v_turn
  FROM public.conversation_turns AS t
  WHERE t.session_id = p_session_id
    AND t.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_turn.user_id <> v_user_id
       OR v_turn.request_text <> p_text
       OR v_turn.request_language <> p_language
       OR v_turn.source_message_id IS DISTINCT FROM p_source_message_id THEN
      RAISE EXCEPTION 'Idempotency key is bound to different request content'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_turn.result;
  END IF;

  IF v_session_status <> 'active' THEN
    RAISE EXCEPTION 'Conversation session is not active'
      USING ERRCODE = '55000';
  END IF;
  IF p_expected_sequence IS NULL OR p_expected_sequence < 0 THEN
    RAISE EXCEPTION 'Expected sequence must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;
  IF p_assistant_text IS NULL
     OR length(btrim(p_assistant_text)) = 0
     OR char_length(p_assistant_text) > 2000 THEN
    RAISE EXCEPTION 'Assistant text must contain 1 to 2000 characters'
      USING ERRCODE = '22023';
  END IF;
  IF p_facts IS NULL
     OR jsonb_typeof(p_facts) <> 'array'
     OR jsonb_array_length(p_facts) > 8 THEN
    RAISE EXCEPTION 'Facts must be an array with at most eight candidates'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(m.sequence), 0) INTO v_current_sequence
  FROM public.conversation_messages AS m
  WHERE m.session_id = p_session_id;
  IF v_current_sequence <> p_expected_sequence THEN
    RAISE EXCEPTION 'Conversation context sequence has changed'
      USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', f.id::text, 'version', f.version)
      ORDER BY f.id
    ),
    '[]'::jsonb
  ) INTO v_actual_context_versions
  FROM public.memory_facts AS f
  WHERE f.project_id = v_project_id
    AND f.status <> 'rejected';
  IF v_actual_context_versions IS DISTINCT FROM p_context_versions THEN
    RAISE EXCEPTION 'Memory fact context has changed'
      USING ERRCODE = '55000';
  END IF;

  IF p_source_message_id IS NULL THEN
    INSERT INTO public.conversation_messages (session_id, role, original_text)
    VALUES (p_session_id, 'user', p_text)
    RETURNING * INTO v_user_message;
  ELSE
    SELECT m.* INTO v_user_message
    FROM public.conversation_messages AS m
    WHERE m.id = p_source_message_id
      AND m.session_id = p_session_id
      AND m.role = 'user';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Owned user source message was not found in the session'
        USING ERRCODE = 'P0002';
    END IF;
    IF v_user_message.original_text <> p_text THEN
      RAISE EXCEPTION 'Source text must exactly match the immutable message'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.conversation_turns AS prior
      WHERE prior.user_message_id = p_source_message_id
    ) THEN
      RAISE EXCEPTION 'Source message has already been processed'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.conversation_messages (session_id, role, original_text)
  VALUES (p_session_id, 'assistant', p_assistant_text)
  RETURNING * INTO v_assistant_message;

  FOR v_candidate IN
    SELECT candidate.value
    FROM jsonb_array_elements(p_facts) AS candidate(value)
  LOOP
    IF jsonb_typeof(v_candidate) <> 'object'
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(v_candidate) AS key(name)
         WHERE NOT key.name = ANY (ARRAY[
           'fact_type', 'value', 'evidence', 'year', 'slot', 'uncertain',
           'clarification_question', 'conflicts_with_fact_id'
         ]::text[])
       )
       OR jsonb_typeof(v_candidate->'fact_type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_candidate->'value') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_candidate->'evidence') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invalid memory fact candidate shape'
        USING ERRCODE = '22023';
    END IF;

    v_fact_type := v_candidate->>'fact_type';
    v_value := v_candidate->>'value';
    v_evidence := v_candidate->>'evidence';
    IF v_fact_type NOT IN (
      'person', 'relationship', 'date', 'location', 'event', 'emotion'
    ) OR length(btrim(v_value)) = 0
       OR char_length(v_value) > 1000
       OR length(btrim(v_evidence)) = 0
       OR char_length(v_evidence) > 1000
       OR strpos(p_text, v_value) = 0
       OR strpos(p_text, v_evidence) = 0 THEN
      RAISE EXCEPTION 'Invalid memory fact type, value or source evidence'
        USING ERRCODE = '22023';
    END IF;

    v_year := NULL;
    IF v_candidate ? 'year'
       AND jsonb_typeof(v_candidate->'year') <> 'null' THEN
      IF jsonb_typeof(v_candidate->'year') <> 'number'
         OR (v_candidate->>'year') !~ '^[0-9]{1,4}$' THEN
        RAISE EXCEPTION 'Memory fact year must be an integer from 1 to 2100'
          USING ERRCODE = '22023';
      END IF;
      v_year := (v_candidate->>'year')::integer;
      IF v_year NOT BETWEEN 1 AND 2100 THEN
        RAISE EXCEPTION 'Memory fact year must be an integer from 1 to 2100'
          USING ERRCODE = '22023';
      END IF;
      IF strpos(v_evidence, v_year::text) = 0 THEN
        RAISE EXCEPTION 'Memory fact year must appear in its evidence'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_slot := NULL;
    IF v_candidate ? 'slot'
       AND jsonb_typeof(v_candidate->'slot') <> 'null' THEN
      IF jsonb_typeof(v_candidate->'slot') <> 'string' THEN
        RAISE EXCEPTION 'Memory fact slot must be text'
          USING ERRCODE = '22023';
      END IF;
      v_slot := v_candidate->>'slot';
      IF length(btrim(v_slot)) = 0 OR char_length(v_slot) > 80 THEN
        RAISE EXCEPTION 'Memory fact slot must contain 1 to 80 characters'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_uncertain := false;
    IF v_candidate ? 'uncertain' THEN
      IF jsonb_typeof(v_candidate->'uncertain') <> 'boolean' THEN
        RAISE EXCEPTION 'Memory fact uncertainty must be boolean'
          USING ERRCODE = '22023';
      END IF;
      v_uncertain := (v_candidate->>'uncertain')::boolean;
    END IF;

    v_question := NULL;
    IF v_candidate ? 'clarification_question'
       AND jsonb_typeof(v_candidate->'clarification_question') <> 'null' THEN
      IF jsonb_typeof(v_candidate->'clarification_question') <> 'string' THEN
        RAISE EXCEPTION 'Clarification question must be text'
          USING ERRCODE = '22023';
      END IF;
      v_question := v_candidate->>'clarification_question';
      IF length(btrim(v_question)) = 0 OR char_length(v_question) > 1000 THEN
        RAISE EXCEPTION 'Clarification question must contain 1 to 1000 characters'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_conflict_id := NULL;
    IF v_candidate ? 'conflicts_with_fact_id'
       AND jsonb_typeof(v_candidate->'conflicts_with_fact_id') <> 'null' THEN
      IF jsonb_typeof(v_candidate->'conflicts_with_fact_id') <> 'string'
         OR (v_candidate->>'conflicts_with_fact_id') !~*
           '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Conflicting fact id must be a UUID'
          USING ERRCODE = '22023';
      END IF;
      v_conflict_id := (v_candidate->>'conflicts_with_fact_id')::uuid;
      IF v_question IS NULL THEN
        RAISE EXCEPTION 'A conflicting fact requires a clarification question'
          USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.memory_facts AS conflict
        WHERE conflict.id = v_conflict_id
          AND conflict.project_id = v_project_id
          AND conflict.status <> 'rejected'
      ) THEN
        RAISE EXCEPTION 'Owned non-rejected conflicting fact was not found'
          USING ERRCODE = 'P0002';
      END IF;
    END IF;

    IF v_uncertain AND v_question IS NULL THEN
      RAISE EXCEPTION 'An uncertain memory requires a clarification question'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.memory_facts (
      project_id, session_id, source_message_id, fact_type, value, evidence,
      year, slot, uncertain
    ) VALUES (
      v_project_id, p_session_id, v_user_message.id, v_fact_type, v_value,
      v_evidence, v_year, v_slot, v_uncertain
    )
    RETURNING * INTO v_fact;
    v_memories := v_memories || jsonb_build_array(to_jsonb(v_fact));

    IF v_question IS NOT NULL THEN
      INSERT INTO public.memory_clarifications (
        fact_id, session_id, conflicts_with_fact_id, question
      ) VALUES (
        v_fact.id, p_session_id, v_conflict_id, v_question
      )
      RETURNING * INTO v_clarification;
      v_clarifications := v_clarifications
        || jsonb_build_array(to_jsonb(v_clarification));
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'user_message', jsonb_build_object(
      'id', v_user_message.id,
      'session_id', v_user_message.session_id,
      'sequence', v_user_message.sequence,
      'role', v_user_message.role,
      'text', v_user_message.original_text,
      'language', v_session_language,
      'created_at', v_user_message.created_at
    ),
    'message', jsonb_build_object(
      'id', v_assistant_message.id,
      'session_id', v_assistant_message.session_id,
      'sequence', v_assistant_message.sequence,
      'role', v_assistant_message.role,
      'text', v_assistant_message.original_text,
      'language', v_session_language,
      'created_at', v_assistant_message.created_at
    ),
    'memories', v_memories,
    'clarifications', v_clarifications,
    'requires_clarification', jsonb_array_length(v_clarifications) > 0,
    'mode', 'mock'
  );

  INSERT INTO public.conversation_turns (
    user_id, session_id, user_message_id, idempotency_key, request_text,
    request_language, source_message_id, expected_sequence, result
  ) VALUES (
    v_user_id, p_session_id, v_user_message.id, p_idempotency_key, p_text,
    p_language, p_source_message_id, p_expected_sequence, v_result
  );

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.resolve_memory_fact(
  p_fact_id uuid,
  p_status text,
  p_corrected_value text,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_fact public.memory_facts%ROWTYPE;
  v_resolution text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('confirmed', 'rejected')
     OR p_expected_version IS NULL OR p_expected_version < 1
     OR (
       p_corrected_value IS NOT NULL
       AND (
         p_status <> 'confirmed'
         OR length(btrim(p_corrected_value)) = 0
         OR char_length(p_corrected_value) > 1000
       )
     ) THEN
    RAISE EXCEPTION 'Invalid memory fact resolution'
      USING ERRCODE = '22023';
  END IF;

  SELECT f.project_id INTO v_project_id
  FROM public.memory_facts AS f
  WHERE f.id = p_fact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned memory fact was not found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.books AS b
  WHERE b.id = v_project_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned memory fact was not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT f.* INTO v_fact
  FROM public.memory_facts AS f
  WHERE f.id = p_fact_id
    AND f.project_id = v_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned memory fact was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_fact.version <> p_expected_version THEN
    IF v_fact.version = p_expected_version + 1
       AND v_fact.status = p_status
       AND v_fact.corrected_value IS NOT DISTINCT FROM p_corrected_value THEN
      RETURN to_jsonb(v_fact);
    END IF;
    RAISE EXCEPTION 'Memory fact version has changed'
      USING ERRCODE = '55000';
  END IF;

  IF v_fact.status = p_status
     AND v_fact.corrected_value IS NOT DISTINCT FROM p_corrected_value THEN
    RETURN to_jsonb(v_fact);
  END IF;

  INSERT INTO public.memory_fact_revisions (
    fact_id, actor_user_id, previous_version, version, previous_status, status,
    previous_corrected_value, corrected_value
  ) VALUES (
    v_fact.id, v_user_id, v_fact.version, v_fact.version + 1,
    v_fact.status, p_status, v_fact.corrected_value, p_corrected_value
  );

  UPDATE public.memory_facts AS f
  SET status = p_status,
      corrected_value = p_corrected_value,
      version = f.version + 1
  WHERE f.id = v_fact.id
  RETURNING f.* INTO v_fact;

  v_resolution := CASE
    WHEN p_status = 'rejected' THEN 'rejected'
    WHEN p_corrected_value IS NULL THEN 'confirmed'
    ELSE 'corrected: ' || p_corrected_value
  END;
  UPDATE public.memory_clarifications AS c
  SET status = 'resolved',
      resolution = v_resolution,
      resolved_at = clock_timestamp()
  WHERE c.fact_id = v_fact.id AND c.status = 'open';

  RETURN to_jsonb(v_fact);
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_memory_fact_integrity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_memory_clarification_integrity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_memory_revision_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_conversation_turn(uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_conversation_turn(
  uuid, uuid, text, text, uuid, bigint, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_memory_fact(uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_conversation_turn(
  uuid, uuid, text, text, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_conversation_turn(
  uuid, uuid, text, text, uuid, bigint, text, jsonb, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_memory_fact(uuid, text, text, integer)
  TO authenticated;

COMMENT ON VIEW public.conversation_message_history IS
  'RLS-preserving English/Swedish conversation history over immutable source messages.';
COMMENT ON TABLE public.conversation_turns IS
  'Private atomic turn idempotency ledger; no direct client privileges.';
COMMENT ON TABLE public.memory_fact_revisions IS
  'Private append-only audit trail for memory confirmation, correction and rejection.';

NOTIFY pgrst, 'reload schema';
COMMIT;
