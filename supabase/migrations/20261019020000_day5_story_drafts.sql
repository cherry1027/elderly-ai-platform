-- Day 5: deterministic, grounded autobiography drafts and audited manual edits.
-- This is additive and deliberately does not reuse or alter the legacy stories table.
BEGIN;

CREATE TABLE public.story_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en', 'sv')),
  style text NOT NULL DEFAULT 'warm' CHECK (style = 'warm'),
  status text NOT NULL DEFAULT 'ready_for_review'
    CHECK (status IN ('ready_for_review', 'edited')),
  version integer NOT NULL CHECK (version > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  content text NOT NULL CHECK (
    length(btrim(content)) > 0 AND char_length(content) <= 20000
  ),
  original_content text NOT NULL CHECK (
    length(btrim(original_content)) > 0
    AND char_length(original_content) <= 20000
  ),
  context_token text NOT NULL CHECK (context_token ~ '^[0-9a-f]{64}$'),
  mode text NOT NULL DEFAULT 'mock' CHECK (mode = 'mock'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version),
  UNIQUE (project_id, context_token, language, style),
  UNIQUE (id, project_id)
);

CREATE INDEX story_drafts_project_created_idx
  ON public.story_drafts (project_id, version DESC);

CREATE TABLE public.story_generation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'sv')),
  style text NOT NULL CHECK (style = 'warm'),
  context_token text NOT NULL CHECK (context_token ~ '^[0-9a-f]{64}$'),
  request_content text NOT NULL CHECK (
    length(btrim(request_content)) > 0
    AND char_length(request_content) <= 20000
  ),
  draft_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, idempotency_key),
  FOREIGN KEY (draft_id, project_id)
    REFERENCES public.story_drafts(id, project_id) ON DELETE CASCADE
);

CREATE TABLE public.draft_source_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.story_drafts(id) ON DELETE CASCADE,
  memory_id uuid REFERENCES public.memory_facts(id) ON DELETE SET NULL,
  original_memory_id uuid NOT NULL,
  memory_version integer NOT NULL CHECK (memory_version > 0),
  source_message_id uuid NOT NULL,
  fact_type text NOT NULL CHECK (
    fact_type IN ('person', 'relationship', 'date', 'location', 'event', 'emotion')
  ),
  value text NOT NULL,
  evidence text NOT NULL,
  corrected_value text,
  year integer,
  slot text,
  source_order integer NOT NULL CHECK (source_order > 0),
  sentence text NOT NULL CHECK (length(btrim(sentence)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, original_memory_id),
  UNIQUE (draft_id, source_order)
);

CREATE INDEX draft_source_memories_draft_idx
  ON public.draft_source_memories (draft_id, created_at, id);

CREATE TABLE public.story_verification_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.story_drafts(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('passed', 'needs_review')),
  unsupported_claims jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(unsupported_claims) = 'array'),
  method text NOT NULL
    CHECK (method IN ('deterministic_mock_v1', 'manual_unverified')),
  reason text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, revision)
);

CREATE TABLE public.story_edit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.story_drafts(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 1),
  previous_content text NOT NULL CHECK (
    length(btrim(previous_content)) > 0
    AND char_length(previous_content) <= 20000
  ),
  content text NOT NULL CHECK (
    length(btrim(content)) > 0 AND char_length(content) <= 20000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, revision)
);

CREATE FUNCTION public.enforce_story_draft_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.language IS DISTINCT FROM OLD.language
     OR NEW.style IS DISTINCT FROM OLD.style
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.original_content IS DISTINCT FROM OLD.original_content
     OR NEW.context_token IS DISTINCT FROM OLD.context_token
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Generated story provenance and original content are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1
     OR NEW.status <> 'edited'
     OR NEW.content IS NOT DISTINCT FROM OLD.content THEN
    RAISE EXCEPTION 'Story edits must append exactly one changed revision'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER story_drafts_integrity
  BEFORE UPDATE ON public.story_drafts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_story_draft_integrity();

CREATE TRIGGER story_drafts_updated_at
  BEFORE UPDATE ON public.story_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.enforce_draft_source_memory_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
     OR NEW.original_memory_id IS DISTINCT FROM OLD.original_memory_id
     OR NEW.memory_version IS DISTINCT FROM OLD.memory_version
     OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
     OR NEW.fact_type IS DISTINCT FROM OLD.fact_type
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.evidence IS DISTINCT FROM OLD.evidence
     OR NEW.corrected_value IS DISTINCT FROM OLD.corrected_value
     OR NEW.year IS DISTINCT FROM OLD.year
     OR NEW.slot IS DISTINCT FROM OLD.slot
     OR NEW.source_order IS DISTINCT FROM OLD.source_order
     OR NEW.sentence IS DISTINCT FROM OLD.sentence
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (
       NEW.memory_id IS DISTINCT FROM OLD.memory_id
       AND NOT (OLD.memory_id IS NOT NULL AND NEW.memory_id IS NULL)
     ) THEN
    RAISE EXCEPTION 'Draft source snapshots are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER draft_source_memories_immutable
  BEFORE UPDATE ON public.draft_source_memories
  FOR EACH ROW EXECUTE FUNCTION public.enforce_draft_source_memory_immutable();

CREATE FUNCTION public.reject_story_audit_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Story verification and edit history are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER story_verification_results_immutable
  BEFORE UPDATE ON public.story_verification_results
  FOR EACH ROW EXECUTE FUNCTION public.reject_story_audit_update();
CREATE TRIGGER story_edit_history_immutable
  BEFORE UPDATE ON public.story_edit_history
  FOR EACH ROW EXECUTE FUNCTION public.reject_story_audit_update();

ALTER TABLE public.story_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_generation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_source_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_verification_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_edit_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.story_drafts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.story_generation_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.draft_source_memories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.story_verification_results FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.story_edit_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.story_drafts TO authenticated;
GRANT SELECT ON public.draft_source_memories TO authenticated;
GRANT SELECT ON public.story_verification_results TO authenticated;
GRANT SELECT ON public.story_edit_history TO authenticated;

CREATE POLICY story_drafts_select_owned
  ON public.story_drafts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.books AS b
      WHERE b.id = story_drafts.project_id
        AND b.user_id = (SELECT auth.uid())
        AND NOT b.is_deleted
    )
  );

CREATE POLICY draft_source_memories_select_owned
  ON public.draft_source_memories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.story_drafts AS d
      JOIN public.books AS b ON b.id = d.project_id
      WHERE d.id = draft_source_memories.draft_id
        AND b.user_id = (SELECT auth.uid())
        AND NOT b.is_deleted
    )
  );

CREATE POLICY story_verification_results_select_owned
  ON public.story_verification_results FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.story_drafts AS d
      JOIN public.books AS b ON b.id = d.project_id
      WHERE d.id = story_verification_results.draft_id
        AND b.user_id = (SELECT auth.uid())
        AND NOT b.is_deleted
    )
  );

CREATE POLICY story_edit_history_select_owned
  ON public.story_edit_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.story_drafts AS d
      JOIN public.books AS b ON b.id = d.project_id
      WHERE d.id = story_edit_history.draft_id
        AND b.user_id = (SELECT auth.uid())
        AND NOT b.is_deleted
    )
  );

CREATE FUNCTION public.story_safe_proper_name(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_value IS NOT NULL
    AND char_length(btrim(p_value)) BETWEEN 1 AND 120
    AND cardinality(regexp_split_to_array(btrim(p_value), '\s+')) <= 4
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(regexp_split_to_array(btrim(p_value), '\s+')) AS part(word)
      WHERE part.word !~
        '^[A-ZÅÄÖ][a-zà-öø-ÿåäö]*([-’''][A-ZÅÄÖ][a-zà-öø-ÿåäö]+)*$'
    )
$$;

CREATE FUNCTION public.story_valid_explicit_date(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_match text[];
  v_day integer;
  v_month_name text;
  v_month integer;
  v_year integer;
BEGIN
  IF p_value IS NULL THEN
    RETURN false;
  END IF;
  IF p_value ~ '^[0-9]{4}$' THEN
    RETURN p_value::integer BETWEEN 1 AND 2100;
  END IF;
  IF p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v_match := regexp_match(
      lower(p_value),
      '^([0-9]{1,2}) (january|januari|february|februari|march|mars|april|may|maj|june|juni|july|juli|august|augusti|september|oktober|october|november|december) ([0-9]{4})$'
    );
    IF v_match IS NULL THEN
      v_match := regexp_match(
        lower(p_value),
        '^(january|february|march|april|may|june|july|august|september|october|november|december) ([0-9]{1,2}), ([0-9]{4})$'
      );
      IF v_match IS NULL THEN
        RETURN false;
      END IF;
      v_month_name := v_match[1];
      v_day := v_match[2]::integer;
      v_year := v_match[3]::integer;
    ELSE
      v_day := v_match[1]::integer;
      v_month_name := v_match[2];
      v_year := v_match[3]::integer;
    END IF;
    v_month := CASE v_month_name
      WHEN 'january' THEN 1 WHEN 'januari' THEN 1
      WHEN 'february' THEN 2 WHEN 'februari' THEN 2
      WHEN 'march' THEN 3 WHEN 'mars' THEN 3
      WHEN 'april' THEN 4
      WHEN 'may' THEN 5 WHEN 'maj' THEN 5
      WHEN 'june' THEN 6 WHEN 'juni' THEN 6
      WHEN 'july' THEN 7 WHEN 'juli' THEN 7
      WHEN 'august' THEN 8 WHEN 'augusti' THEN 8
      WHEN 'september' THEN 9
      WHEN 'october' THEN 10 WHEN 'oktober' THEN 10
      WHEN 'november' THEN 11 WHEN 'december' THEN 12
    END;
    IF v_year NOT BETWEEN 1 AND 2100 THEN
      RETURN false;
    END IF;
    BEGIN
      PERFORM make_date(v_year, v_month, v_day);
      RETURN true;
    EXCEPTION WHEN datetime_field_overflow THEN
      RETURN false;
    END;
  END IF;
  BEGIN
    RETURN to_char(p_value::date, 'YYYY-MM-DD') = p_value;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RETURN false;
  END;
END;
$$;

CREATE FUNCTION public.story_memory_sentence(p_memory_id uuid, p_language text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_fact public.memory_facts%ROWTYPE;
  v_value text;
  v_year integer;
  v_slot text;
  v_role text;
  v_corrected text;
BEGIN
  IF p_language NOT IN ('en', 'sv') THEN
    RETURN NULL;
  END IF;
  SELECT f.* INTO v_fact FROM public.memory_facts AS f WHERE f.id = p_memory_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Older direct RPC callers could persist a correction with surrounding
  -- whitespace. Keep that non-canonical value out of generated prose rather
  -- than silently changing its reviewed meaning at story-generation time.
  IF v_fact.corrected_value IS NOT NULL
     AND v_fact.corrected_value <> btrim(v_fact.corrected_value) THEN
    RETURN NULL;
  END IF;

  v_value := btrim(v_fact.value);
  v_year := v_fact.year;
  v_slot := lower(COALESCE(v_fact.slot, ''));
  v_corrected := NULLIF(btrim(v_fact.corrected_value), '');
  IF v_corrected IS NOT NULL THEN
    IF v_corrected ~ '^[0-9]{4}$'
       AND v_corrected::integer BETWEEN 1 AND 2100
       AND (v_fact.fact_type = 'date' OR v_slot = 'move') THEN
      v_year := v_corrected::integer;
      IF v_fact.fact_type = 'date' AND v_slot = 'date' THEN
        v_value := v_corrected;
      END IF;
    ELSIF v_fact.fact_type = 'emotion' AND (
      (p_language = 'en' AND lower(v_corrected) ~
        '^(a little |slightly |very |quite |really )?(nervous|happy|sad|afraid|scared|excited|lonely|calm|proud|worried)$')
      OR (p_language = 'sv' AND lower(v_corrected) ~
        '^(lite |något |mycket |väldigt |ganska |verkligen )?(nervös|glad|ledsen|rädd|orolig|ensam|lugn|stolt|upprymd)$')
    ) THEN
      v_value := v_corrected;
    ELSIF public.story_safe_proper_name(v_corrected)
          AND v_fact.fact_type IN ('person', 'relationship', 'location', 'event') THEN
      v_value := v_corrected;
    ELSIF v_fact.fact_type = 'date'
          AND public.story_valid_explicit_date(v_corrected) THEN
      v_value := v_corrected;
      -- A full corrected date supersedes an older extracted year. Leaving the
      -- old year populated would make the birth-year branch assert stale data.
      v_year := NULL;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  IF v_slot = 'grew_up_location'
     AND v_fact.fact_type IN ('location', 'event')
     AND public.story_safe_proper_name(v_value) THEN
    RETURN CASE p_language
      WHEN 'sv' THEN 'Jag växte upp i ' || v_value || '.'
      ELSE 'I grew up in ' || v_value || '.'
    END;
  END IF;

  IF v_slot = 'move' AND v_fact.fact_type IN ('location', 'event') THEN
    IF public.story_safe_proper_name(v_value) AND v_year BETWEEN 1 AND 2100 THEN
      RETURN CASE p_language
        WHEN 'sv' THEN 'Jag flyttade till ' || v_value || ' år ' || v_year || '.'
        ELSE 'I moved to ' || v_value || ' in ' || v_year || '.'
      END;
    ELSIF public.story_safe_proper_name(v_value) THEN
      RETURN CASE p_language
        WHEN 'sv' THEN 'Jag flyttade till ' || v_value || '.'
        ELSE 'I moved to ' || v_value || '.'
      END;
    ELSIF v_year BETWEEN 1 AND 2100 THEN
      RETURN CASE p_language
        WHEN 'sv' THEN 'Jag flyttade år ' || v_year || '.'
        ELSE 'I moved in ' || v_year || '.'
      END;
    END IF;
  END IF;

  IF v_fact.fact_type = 'person'
     AND v_slot = 'person:self_name'
     AND public.story_safe_proper_name(v_value) THEN
    RETURN CASE p_language
      WHEN 'sv' THEN 'Jag heter ' || v_value || '.'
      ELSE 'My name is ' || v_value || '.'
    END;
  END IF;

  IF v_fact.fact_type = 'relationship'
     AND public.story_safe_proper_name(v_value) THEN
    v_role := replace(v_slot, 'relationship:', '');
    IF v_role IN ('mother', 'mamma', 'mor') THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min mamma heter ' || v_value || '.'
        ELSE 'My mother''s name is ' || v_value || '.' END;
    ELSIF v_role IN ('father', 'pappa', 'far') THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min pappa heter ' || v_value || '.'
        ELSE 'My father''s name is ' || v_value || '.' END;
    ELSIF v_role IN ('sister', 'syster') THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min syster heter ' || v_value || '.'
        ELSE 'My sister''s name is ' || v_value || '.' END;
    ELSIF v_role IN ('brother', 'bror') THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min bror heter ' || v_value || '.'
        ELSE 'My brother''s name is ' || v_value || '.' END;
    ELSIF v_role IN ('daughter', 'dotter') THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min dotter heter ' || v_value || '.'
        ELSE 'My daughter''s name is ' || v_value || '.' END;
    ELSIF v_role = 'son' THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min son heter ' || v_value || '.'
        ELSE 'My son''s name is ' || v_value || '.' END;
    ELSIF v_role IN ('wife', 'fru') THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min fru heter ' || v_value || '.'
        ELSE 'My wife''s name is ' || v_value || '.' END;
    ELSIF v_role IN ('husband', 'make', 'man') THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min make heter ' || v_value || '.'
        ELSE 'My husband''s name is ' || v_value || '.' END;
    ELSIF v_role = 'partner' THEN
      RETURN CASE p_language WHEN 'sv' THEN 'Min partner heter ' || v_value || '.'
        ELSE 'My partner''s name is ' || v_value || '.' END;
    ELSIF v_role = 'grandmother' AND p_language = 'en' THEN
      RETURN 'My grandmother''s name is ' || v_value || '.';
    ELSIF v_role = 'grandfather' AND p_language = 'en' THEN
      RETURN 'My grandfather''s name is ' || v_value || '.';
    ELSIF v_role IN ('mormor', 'farmor') THEN
      RETURN CASE p_language
        WHEN 'sv' THEN 'Min ' || v_role || ' heter ' || v_value || '.'
        ELSE 'My grandmother''s name is ' || v_value || '.'
      END;
    ELSIF v_role IN ('morfar', 'farfar') THEN
      RETURN CASE p_language
        WHEN 'sv' THEN 'Min ' || v_role || ' heter ' || v_value || '.'
        ELSE 'My grandfather''s name is ' || v_value || '.'
      END;
    END IF;
  END IF;

  IF v_fact.fact_type = 'emotion' THEN
    IF p_language = 'en' AND lower(v_value) ~
      '^(a little |slightly |very |quite |really )?(nervous|happy|sad|afraid|scared|excited|lonely|calm|proud|worried)$' THEN
      RETURN 'I felt ' || lower(v_value) || '.';
    ELSIF p_language = 'sv' AND lower(v_value) ~
      '^(lite |något |mycket |väldigt |ganska |verkligen )?(nervös|glad|ledsen|rädd|orolig|ensam|lugn|stolt|upprymd)$' THEN
      RETURN 'Jag kände mig ' || lower(v_value) || '.';
    END IF;
  END IF;

  IF v_fact.fact_type = 'date' THEN
    IF v_slot = 'date'
       AND v_year BETWEEN 1 AND 2100
       AND (
         lower(btrim(v_fact.evidence)) LIKE 'born%'
         OR lower(btrim(v_fact.evidence)) LIKE 'i was born%'
         OR lower(btrim(v_fact.evidence)) LIKE 'föddes%'
         OR lower(btrim(v_fact.evidence)) LIKE 'jag föddes%'
       ) THEN
      RETURN CASE p_language
        WHEN 'sv' THEN 'Jag föddes år ' || v_year || '.'
        ELSE 'I was born in ' || v_year || '.'
      END;
    END IF;
    IF public.story_valid_explicit_date(v_value) THEN
      RETURN CASE p_language
        WHEN 'sv' THEN 'Jag minns datumet ' || v_value || '.'
        ELSE 'I remember the date ' || v_value || '.'
      END;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION public.story_current_context_token(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_language text;
  v_payload jsonb;
BEGIN
  SELECT b.language INTO v_language FROM public.books AS b WHERE b.id = p_project_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_payload := jsonb_build_object(
    'language', v_language,
    'facts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'version', f.version, 'status', f.status,
        'corrected_value', f.corrected_value, 'fact_type', f.fact_type,
        'value', f.value, 'evidence', f.evidence, 'year', f.year,
        'slot', f.slot, 'uncertain', f.uncertain,
        'source_message_id', f.source_message_id
      ) ORDER BY f.id)
      FROM public.memory_facts AS f WHERE f.project_id = p_project_id
    ), '[]'::jsonb),
    'clarifications', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'fact_id', c.fact_id,
        'conflicts_with_fact_id', c.conflicts_with_fact_id,
        'status', c.status, 'resolution', c.resolution,
        'resolved_at', c.resolved_at
      ) ORDER BY c.id)
      FROM public.memory_clarifications AS c
      JOIN public.memory_facts AS f ON f.id = c.fact_id
      WHERE f.project_id = p_project_id
    ), '[]'::jsonb)
  );
  RETURN encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
END;
$$;

CREATE FUNCTION public.build_story_context(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_language text;
  v_fact_count integer;
  v_clarification_count integer;
  v_token text;
  v_sources jsonb;
  v_excluded jsonb;
  v_blocking jsonb;
  v_content text;
BEGIN
  SELECT b.language INTO v_language FROM public.books AS b WHERE b.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Story project was not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT count(*)::integer INTO v_fact_count
  FROM public.memory_facts AS f WHERE f.project_id = p_project_id;
  IF v_fact_count > 200 THEN
    RAISE EXCEPTION 'Story context exceeds 200 memory facts'
      USING ERRCODE = '54000';
  END IF;
  SELECT count(*)::integer INTO v_clarification_count
  FROM public.memory_clarifications AS c
  JOIN public.memory_facts AS f ON f.id = c.fact_id
  WHERE f.project_id = p_project_id;
  IF v_clarification_count > 200 THEN
    RAISE EXCEPTION 'Story context exceeds 200 memory clarifications'
      USING ERRCODE = '54000';
  END IF;
  v_token := public.story_current_context_token(p_project_id);

  SELECT COALESCE(jsonb_agg(c.id ORDER BY c.created_at, c.id), '[]'::jsonb)
    INTO v_blocking
  FROM public.memory_clarifications AS c
  JOIN public.memory_facts AS f ON f.id = c.fact_id
  JOIN public.memory_facts AS conflict ON conflict.id = c.conflicts_with_fact_id
  WHERE f.project_id = p_project_id
    AND conflict.project_id = p_project_id
    AND f.status <> 'rejected'
    AND conflict.status <> 'rejected'
    AND (
      c.status = 'open'
      OR (
        c.status = 'resolved'
        AND f.status = 'confirmed'
        AND conflict.status = 'confirmed'
        AND public.story_memory_sentence(f.id, v_language)
          IS DISTINCT FROM public.story_memory_sentence(conflict.id, v_language)
      )
    );

  WITH candidates AS (
    SELECT f.*, public.story_memory_sentence(f.id, v_language) AS sentence,
      EXISTS (
        SELECT 1
        FROM public.conversation_messages AS m
        JOIN public.conversation_sessions AS s ON s.id = m.session_id
        WHERE m.id = f.source_message_id
          AND m.session_id = f.session_id
          AND s.project_id = f.project_id
          AND m.role = 'user'
          AND strpos(m.original_text, f.value) > 0
          AND strpos(m.original_text, f.evidence) > 0
      ) AS source_valid,
      EXISTS (
        SELECT 1 FROM public.memory_clarifications AS c
        WHERE c.fact_id = f.id AND c.status = 'open'
      ) AS has_open_question
    FROM public.memory_facts AS f
    WHERE f.project_id = p_project_id
  ), eligible AS (
    SELECT * FROM candidates
    WHERE status = 'confirmed'
      AND source_valid
      AND NOT has_open_question
      AND sentence IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'memory_id', e.id,
      'memory_version', e.version,
      'source_message_id', e.source_message_id,
      'fact_type', e.fact_type,
      'value', e.value,
      'evidence', e.evidence,
      'corrected_value', e.corrected_value,
      'year', e.year,
      'slot', e.slot,
      'sentence', e.sentence
    ) ORDER BY e.created_at, e.id), '[]'::jsonb)
    INTO v_sources
  FROM eligible AS e;

  WITH candidates AS (
    SELECT f.*, public.story_memory_sentence(f.id, v_language) AS sentence,
      EXISTS (
        SELECT 1
        FROM public.conversation_messages AS m
        JOIN public.conversation_sessions AS s ON s.id = m.session_id
        WHERE m.id = f.source_message_id
          AND m.session_id = f.session_id
          AND s.project_id = f.project_id
          AND m.role = 'user'
          AND strpos(m.original_text, f.value) > 0
          AND strpos(m.original_text, f.evidence) > 0
      ) AS source_valid,
      EXISTS (
        SELECT 1 FROM public.memory_clarifications AS c
        WHERE c.fact_id = f.id AND c.status = 'open'
      ) AS has_open_question
    FROM public.memory_facts AS f
    WHERE f.project_id = p_project_id
  ), excluded AS (
    SELECT c.id AS memory_id, CASE
      WHEN c.status = 'pending' THEN 'pending'
      WHEN c.status = 'rejected' THEN 'rejected'
      WHEN c.has_open_question THEN 'unresolved'
      ELSE 'unsupported'
    END AS reason, c.created_at
    FROM candidates AS c
    WHERE c.status <> 'confirmed'
       OR NOT c.source_valid
       OR c.has_open_question
       OR c.sentence IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'memory_id', e.memory_id, 'reason', e.reason
    ) ORDER BY e.created_at, e.memory_id), '[]'::jsonb)
    INTO v_excluded
  FROM excluded AS e;

  WITH eligible AS (
    SELECT f.id, f.created_at, public.story_memory_sentence(f.id, v_language) AS sentence
    FROM public.memory_facts AS f
    WHERE f.project_id = p_project_id
      AND f.status = 'confirmed'
      AND public.story_memory_sentence(f.id, v_language) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.memory_clarifications AS c
        WHERE c.fact_id = f.id AND c.status = 'open'
      )
      AND EXISTS (
        SELECT 1
        FROM public.conversation_messages AS m
        JOIN public.conversation_sessions AS s ON s.id = m.session_id
        WHERE m.id = f.source_message_id
          AND m.session_id = f.session_id
          AND s.project_id = f.project_id
          AND m.role = 'user'
          AND strpos(m.original_text, f.value) > 0
          AND strpos(m.original_text, f.evidence) > 0
      )
  ), first_sentence AS (
    SELECT DISTINCT ON (sentence) sentence, created_at, id
    FROM eligible ORDER BY sentence, created_at, id
  )
  SELECT COALESCE(string_agg(sentence, E'\n\n' ORDER BY created_at, id), '')
    INTO v_content
  FROM first_sentence;
  IF char_length(v_content) > 20000 THEN
    RAISE EXCEPTION 'Canonical story content exceeds 20000 characters'
      USING ERRCODE = '54000';
  END IF;

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'language', v_language,
    'context_token', v_token,
    'confirmed_count', (
      SELECT count(*)::integer FROM public.memory_facts AS f
      WHERE f.project_id = p_project_id AND f.status = 'confirmed'
    ),
    'source_memories', v_sources,
    'excluded_memories', v_excluded,
    'blocking_clarifications', v_blocking,
    'canonical_content', v_content
  );
END;
$$;

CREATE FUNCTION public.story_draft_sources(p_draft_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'memory_id', s.original_memory_id,
    'memory_version', s.memory_version,
    'source_message_id', s.source_message_id,
    'fact_type', s.fact_type,
    'value', s.value,
    'evidence', s.evidence,
    'corrected_value', s.corrected_value,
    'year', s.year,
    'slot', s.slot,
    'sentence', s.sentence
  ) ORDER BY s.source_order), '[]'::jsonb)
  FROM public.draft_source_memories AS s
  WHERE s.draft_id = p_draft_id
$$;

CREATE FUNCTION public.story_draft_verification_report(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_draft public.story_drafts%ROWTYPE;
  v_result public.story_verification_results%ROWTYPE;
  v_current_token text;
  v_sources_current boolean;
BEGIN
  SELECT d.* INTO v_draft FROM public.story_drafts AS d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'not_generated', 'unsupported_claims', '[]'::jsonb,
      'method', 'none', 'checked_revision', NULL, 'checked_at', NULL,
      'sources_current', false, 'reason', 'No story has been generated'
    );
  END IF;
  SELECT r.* INTO v_result
  FROM public.story_verification_results AS r
  WHERE r.draft_id = p_draft_id AND r.revision = v_draft.revision;
  v_current_token := public.story_current_context_token(v_draft.project_id);
  v_sources_current := v_current_token IS NOT DISTINCT FROM v_draft.context_token;

  IF NOT v_sources_current AND v_result.method = 'manual_unverified' THEN
    RETURN jsonb_build_object(
      'status', 'needs_review',
      'unsupported_claims', v_result.unsupported_claims,
      'method', 'manual_unverified',
      'checked_revision', v_result.revision,
      'checked_at', v_result.checked_at,
      'sources_current', false,
      'reason', 'Manual edits require review and source memories changed'
    );
  ELSIF NOT v_sources_current THEN
    RETURN jsonb_build_object(
      'status', 'stale_sources',
      'unsupported_claims', COALESCE(v_result.unsupported_claims, '[]'::jsonb),
      'method', COALESCE(v_result.method, 'none'),
      'checked_revision', v_result.revision,
      'checked_at', v_result.checked_at,
      'sources_current', false,
      'reason', 'Source memories changed after this draft was generated'
    );
  END IF;
  IF v_result.id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'needs_review', 'unsupported_claims', '[]'::jsonb,
      'method', 'none', 'checked_revision', NULL, 'checked_at', NULL,
      'sources_current', true, 'reason', 'No verification result exists'
    );
  END IF;
  RETURN jsonb_build_object(
    'status', v_result.status,
    'unsupported_claims', v_result.unsupported_claims,
    'method', v_result.method,
    'checked_revision', v_result.revision,
    'checked_at', v_result.checked_at,
    'sources_current', true,
    'reason', v_result.reason
  );
END;
$$;

CREATE FUNCTION public.story_draft_response(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_draft public.story_drafts%ROWTYPE;
BEGIN
  SELECT d.* INTO v_draft FROM public.story_drafts AS d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'draft_id', v_draft.id,
    'project_id', v_draft.project_id,
    'status', v_draft.status,
    'language', v_draft.language,
    'style', v_draft.style,
    'version', v_draft.version,
    'revision', v_draft.revision,
    'content', v_draft.content,
    'original_content', v_draft.original_content,
    'mode', v_draft.mode,
    'source_memories', public.story_draft_sources(v_draft.id),
    'verification', public.story_draft_verification_report(v_draft.id),
    'created_at', v_draft.created_at,
    'updated_at', v_draft.updated_at
  );
END;
$$;

CREATE FUNCTION public.load_story_context(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.books AS b
    WHERE b.id = p_project_id
      AND b.user_id = v_user_id
      AND NOT b.is_deleted
  ) THEN
    RAISE EXCEPTION 'Owned story project was not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.build_story_context(p_project_id);
END;
$$;

CREATE FUNCTION public.get_story_generation(
  p_project_id uuid,
  p_idempotency_key uuid,
  p_language text,
  p_style text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_request public.story_generation_requests%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR p_idempotency_key IS NULL
     OR p_language IS NULL OR p_language NOT IN ('en', 'sv')
     OR p_style IS NULL OR p_style <> 'warm' THEN
    RAISE EXCEPTION 'Invalid story generation lookup' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.books AS b
    WHERE b.id = p_project_id
      AND b.user_id = v_user_id
      AND NOT b.is_deleted
  ) THEN
    RAISE EXCEPTION 'Owned story project was not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT r.* INTO v_request
  FROM public.story_generation_requests AS r
  WHERE r.project_id = p_project_id AND r.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_request.user_id <> v_user_id
     OR v_request.language IS DISTINCT FROM p_language
     OR v_request.style IS DISTINCT FROM p_style THEN
    RAISE EXCEPTION 'Idempotency key is bound to another generation request'
      USING ERRCODE = '23505';
  END IF;
  RETURN public.story_draft_response(v_request.draft_id);
END;
$$;

CREATE FUNCTION public.save_story_generation(
  p_project_id uuid,
  p_idempotency_key uuid,
  p_language text,
  p_style text,
  p_confirm_generation boolean,
  p_context_token text,
  p_content text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_language text;
  v_request public.story_generation_requests%ROWTYPE;
  v_draft public.story_drafts%ROWTYPE;
  v_context jsonb;
  v_source jsonb;
  v_source_order bigint;
  v_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Invalid story generation request' USING ERRCODE = '22023';
  END IF;

  -- Day 4 append/review and Day 5 generation share this project-first lock.
  SELECT b.language INTO v_project_language
  FROM public.books AS b
  WHERE b.id = p_project_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned story project was not found' USING ERRCODE = 'P0002';
  END IF;

  -- A bound replay returns the current draft representation before any context
  -- or confirmation gate, so a network retry survives later edits or reviews.
  SELECT r.* INTO v_request
  FROM public.story_generation_requests AS r
  WHERE r.project_id = p_project_id AND r.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_request.user_id <> v_user_id
       OR v_request.language IS DISTINCT FROM p_language
       OR v_request.style IS DISTINCT FROM p_style
       OR v_request.context_token IS DISTINCT FROM p_context_token
       OR v_request.request_content IS DISTINCT FROM p_content THEN
      RAISE EXCEPTION 'Idempotency key is bound to another generation request'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.story_draft_response(v_request.draft_id);
  END IF;

  IF p_confirm_generation IS NOT TRUE
     OR p_language IS NULL
     OR p_language NOT IN ('en', 'sv')
     OR p_language <> v_project_language
     OR p_style IS NULL
     OR p_style <> 'warm'
     OR p_context_token IS NULL
     OR p_context_token !~ '^[0-9a-f]{64}$'
     OR p_content IS NULL
     OR length(btrim(p_content)) = 0
     OR char_length(p_content) > 20000 THEN
    RAISE EXCEPTION 'Invalid story generation request' USING ERRCODE = '22023';
  END IF;

  v_context := public.build_story_context(p_project_id);
  IF v_context->>'context_token' <> p_context_token THEN
    RAISE EXCEPTION 'Story memory context has changed' USING ERRCODE = '55000';
  END IF;
  IF jsonb_array_length(v_context->'blocking_clarifications') > 0 THEN
    RAISE EXCEPTION 'Story generation is blocked by conflicting memories'
      USING ERRCODE = '55000';
  END IF;
  IF (v_context->>'confirmed_count')::integer = 0 THEN
    RAISE EXCEPTION 'No confirmed memories are available'
      USING ERRCODE = '55000';
  END IF;
  IF jsonb_array_length(v_context->'source_memories') = 0
     OR length(v_context->>'canonical_content') = 0 THEN
    RAISE EXCEPTION 'No supported confirmed memories are available'
      USING ERRCODE = '55000';
  END IF;
  IF p_content <> v_context->>'canonical_content' THEN
    RAISE EXCEPTION 'Story content is not the canonical grounded draft'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.story_drafts AS d
  WHERE d.project_id = p_project_id
    AND d.context_token = p_context_token
    AND d.language = p_language
    AND d.style = p_style;
  IF NOT FOUND THEN
    SELECT COALESCE(max(d.version), 0) + 1 INTO v_version
    FROM public.story_drafts AS d WHERE d.project_id = p_project_id;
    INSERT INTO public.story_drafts (
      project_id, language, style, status, version, revision, content,
      original_content, context_token, mode
    ) VALUES (
      p_project_id, p_language, p_style, 'ready_for_review', v_version, 1,
      p_content, p_content, p_context_token, 'mock'
    ) RETURNING * INTO v_draft;

    FOR v_source, v_source_order IN
      SELECT value, ordinality
      FROM jsonb_array_elements(v_context->'source_memories') WITH ORDINALITY
    LOOP
      INSERT INTO public.draft_source_memories (
        draft_id, memory_id, original_memory_id, memory_version,
        source_message_id, fact_type, value, evidence, corrected_value, year,
        slot, source_order, sentence
      ) VALUES (
        v_draft.id,
        (v_source->>'memory_id')::uuid,
        (v_source->>'memory_id')::uuid,
        (v_source->>'memory_version')::integer,
        (v_source->>'source_message_id')::uuid,
        v_source->>'fact_type',
        v_source->>'value',
        v_source->>'evidence',
        v_source->>'corrected_value',
        CASE WHEN jsonb_typeof(v_source->'year') = 'number'
          THEN (v_source->>'year')::integer ELSE NULL END,
        v_source->>'slot',
        v_source_order::integer,
        v_source->>'sentence'
      );
    END LOOP;

    INSERT INTO public.story_verification_results (
      draft_id, revision, status, unsupported_claims, method, reason
    ) VALUES (
      v_draft.id, 1, 'passed', '[]'::jsonb, 'deterministic_mock_v1', NULL
    );
  END IF;

  INSERT INTO public.story_generation_requests (
    user_id, project_id, idempotency_key, language, style, context_token,
    request_content, draft_id
  ) VALUES (
    v_user_id, p_project_id, p_idempotency_key, p_language, p_style,
    p_context_token, p_content, v_draft.id
  );
  RETURN public.story_draft_response(v_draft.id);
END;
$$;

CREATE FUNCTION public.get_story_draft(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_draft_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.story_drafts AS d
    JOIN public.books AS b ON b.id = d.project_id
    WHERE d.id = p_draft_id
      AND b.user_id = v_user_id
      AND NOT b.is_deleted
  ) THEN
    RAISE EXCEPTION 'Owned story draft was not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.story_draft_response(p_draft_id);
END;
$$;

CREATE FUNCTION public.list_story_drafts(
  p_project_id uuid,
  p_limit integer,
  p_offset integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'Invalid story draft pagination' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.books AS b
    WHERE b.id = p_project_id
      AND b.user_id = v_user_id
      AND NOT b.is_deleted
  ) THEN
    RAISE EXCEPTION 'Owned story project was not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(public.story_draft_response(x.id)
    ORDER BY x.version DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT d.id, d.version FROM public.story_drafts AS d
    WHERE d.project_id = p_project_id
    ORDER BY d.version DESC LIMIT p_limit OFFSET p_offset
  ) AS x;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.edit_story_draft(
  p_draft_id uuid,
  p_expected_revision integer,
  p_content text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_draft public.story_drafts%ROWTYPE;
  v_previous_content text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_draft_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_content IS NULL OR length(btrim(p_content)) = 0
     OR char_length(p_content) > 20000 THEN
    RAISE EXCEPTION 'Invalid story edit request' USING ERRCODE = '22023';
  END IF;

  SELECT d.project_id INTO v_project_id
  FROM public.story_drafts AS d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned story draft was not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.books AS b
  WHERE b.id = v_project_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned story draft was not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT d.* INTO v_draft
  FROM public.story_drafts AS d
  WHERE d.id = p_draft_id AND d.project_id = v_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned story draft was not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_draft.revision = p_expected_revision + 1
     AND v_draft.content = p_content THEN
    RETURN public.story_draft_response(v_draft.id);
  END IF;
  IF v_draft.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Story draft revision has changed' USING ERRCODE = '55000';
  END IF;
  IF v_draft.content = p_content THEN
    RETURN public.story_draft_response(v_draft.id);
  END IF;

  v_previous_content := v_draft.content;
  UPDATE public.story_drafts AS d
  SET content = p_content,
      status = 'edited',
      revision = d.revision + 1
  WHERE d.id = v_draft.id
  RETURNING d.* INTO v_draft;

  INSERT INTO public.story_edit_history (
    draft_id, revision, previous_content, content
  ) VALUES (
    v_draft.id, v_draft.revision, v_previous_content, v_draft.content
  );
  INSERT INTO public.story_verification_results (
    draft_id, revision, status, unsupported_claims, method, reason
  ) VALUES (
    v_draft.id, v_draft.revision, 'needs_review', '[]'::jsonb,
    'manual_unverified', 'Manual edits require review'
  );
  RETURN public.story_draft_response(v_draft.id);
END;
$$;

CREATE FUNCTION public.get_story_project_verification(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_draft public.story_drafts%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.books AS b
    WHERE b.id = p_project_id
      AND b.user_id = v_user_id
      AND NOT b.is_deleted
  ) THEN
    RAISE EXCEPTION 'Owned story project was not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT d.* INTO v_draft
  FROM public.story_drafts AS d
  WHERE d.project_id = p_project_id
  ORDER BY d.version DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'project_id', p_project_id,
      'draft_id', NULL,
      'version', NULL,
      'revision', NULL,
      'verification', jsonb_build_object(
        'status', 'not_generated', 'unsupported_claims', '[]'::jsonb,
        'method', 'none', 'checked_revision', NULL, 'checked_at', NULL,
        'sources_current', false, 'reason', 'No story has been generated'
      )
    );
  END IF;
  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'draft_id', v_draft.id,
    'version', v_draft.version,
    'revision', v_draft.revision,
    'verification', public.story_draft_verification_report(v_draft.id)
  );
END;
$$;

CREATE FUNCTION public.list_story_edit_history(
  p_draft_id uuid,
  p_limit integer,
  p_offset integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'Invalid story edit history pagination' USING ERRCODE = '22023';
  END IF;
  IF p_draft_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.story_drafts AS d
    JOIN public.books AS b ON b.id = d.project_id
    WHERE d.id = p_draft_id
      AND b.user_id = v_user_id
      AND NOT b.is_deleted
  ) THEN
    RAISE EXCEPTION 'Owned story draft was not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', h.id,
      'draft_id', h.draft_id,
      'revision', h.revision,
      'previous_content', h.previous_content,
      'content', h.content,
      'created_at', h.created_at
    ) ORDER BY h.revision DESC), '[]'::jsonb)
    INTO v_result
  FROM (
    SELECT e.* FROM public.story_edit_history AS e
    WHERE e.draft_id = p_draft_id
    ORDER BY e.revision DESC LIMIT p_limit OFFSET p_offset
  ) AS h;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_story_draft_integrity()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_draft_source_memory_immutable()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_story_audit_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_safe_proper_name(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_valid_explicit_date(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_memory_sentence(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_current_context_token(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_story_context(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_draft_sources(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_draft_verification_report(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_draft_response(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.load_story_context(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_story_generation(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_story_generation(
  uuid, uuid, text, text, boolean, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_story_draft(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_story_drafts(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.edit_story_draft(uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_story_project_verification(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_story_edit_history(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.load_story_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_generation(uuid, uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_story_generation(
  uuid, uuid, text, text, boolean, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_story_drafts(uuid, integer, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_story_draft(uuid, integer, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_project_verification(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_story_edit_history(uuid, integer, integer)
  TO authenticated;

COMMENT ON TABLE public.story_drafts IS
  'Versioned deterministic autobiography drafts; original_content is immutable.';
COMMENT ON TABLE public.draft_source_memories IS
  'Immutable evidence snapshots retained when source memories are erased.';
COMMENT ON TABLE public.story_verification_results IS
  'Append-only per-revision verification; manual edits are never auto-passed.';

NOTIFY pgrst, 'reload schema';
COMMIT;
