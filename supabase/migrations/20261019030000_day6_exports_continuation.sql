-- Day 6: immutable PDF export audit metadata and explicit story continuation.
-- PDF bytes remain ephemeral; only the selected saved revision and render
-- measurements are recorded here.
BEGIN;

CREATE TABLE public.story_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL,
  draft_version integer NOT NULL CHECK (draft_version > 0),
  draft_revision integer NOT NULL CHECK (draft_revision > 0),
  language text NOT NULL CHECK (language IN ('en', 'sv')),
  title_snapshot text NOT NULL CHECK (
    length(btrim(title_snapshot)) > 0 AND char_length(title_snapshot) <= 120
  ),
  format text NOT NULL DEFAULT 'pdf' CHECK (format = 'pdf'),
  include_title_page boolean NOT NULL,
  include_page_numbers boolean NOT NULL,
  renderer_version text NOT NULL DEFAULT 'memy_pdf_v1'
    CHECK (renderer_version = 'memy_pdf_v1'),
  filename text NOT NULL CHECK (
    char_length(filename) <= 100
    AND filename ~ '^memy-[a-z0-9]+(-[a-z0-9]+)*\.pdf$'
  ),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 2000000),
  page_count integer NOT NULL CHECK (page_count BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (draft_id, project_id)
    REFERENCES public.story_drafts(id, project_id) ON DELETE CASCADE,
  UNIQUE (
    draft_id, draft_revision, title_snapshot, include_title_page,
    include_page_numbers, renderer_version
  )
);

CREATE INDEX story_exports_project_created_idx
  ON public.story_exports (project_id, created_at DESC, id DESC);

CREATE FUNCTION public.reject_story_export_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Story export audit metadata is immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER story_exports_immutable
  BEFORE UPDATE ON public.story_exports
  FOR EACH ROW EXECUTE FUNCTION public.reject_story_export_update();

ALTER TABLE public.story_exports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.story_exports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.story_exports TO authenticated;

CREATE POLICY story_exports_select_owned
  ON public.story_exports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.books AS b
      WHERE b.id = story_exports.project_id
        AND b.user_id = (SELECT auth.uid())
        AND NOT b.is_deleted
    )
  );

CREATE FUNCTION public.story_export_selected_content(
  p_draft_id uuid,
  p_revision integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_draft public.story_drafts%ROWTYPE;
  v_content text;
BEGIN
  IF p_draft_id IS NULL OR p_revision IS NULL OR p_revision < 1 THEN
    RETURN NULL;
  END IF;
  SELECT d.* INTO v_draft
  FROM public.story_drafts AS d
  WHERE d.id = p_draft_id;
  IF NOT FOUND OR p_revision > v_draft.revision THEN
    RETURN NULL;
  END IF;
  IF p_revision = 1 THEN
    RETURN v_draft.original_content;
  END IF;
  SELECT h.content INTO v_content
  FROM public.story_edit_history AS h
  WHERE h.draft_id = p_draft_id AND h.revision = p_revision;
  RETURN v_content;
END;
$$;

CREATE FUNCTION public.story_export_metadata_response(p_export_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'export_id', e.id,
    'project_id', e.project_id,
    'draft_id', e.draft_id,
    'draft_version', e.draft_version,
    'draft_revision', e.draft_revision,
    'language', e.language,
    'title', e.title_snapshot,
    'format', e.format,
    'include_title_page', e.include_title_page,
    'include_page_numbers', e.include_page_numbers,
    'renderer_version', e.renderer_version,
    'filename', e.filename,
    'content_sha256', e.content_sha256,
    'byte_size', e.byte_size,
    'page_count', e.page_count,
    'created_at', e.created_at
  )
  FROM public.story_exports AS e
  WHERE e.id = p_export_id
$$;

CREATE FUNCTION public.load_story_export_context(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_title text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  SELECT b.title INTO v_project_title
  FROM public.story_drafts AS d
  JOIN public.books AS b ON b.id = d.project_id
  WHERE d.id = p_draft_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned story draft was not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'draft', public.story_draft_response(p_draft_id),
    'project_title', v_project_title
  );
END;
$$;

CREATE FUNCTION public.record_story_export(
  p_draft_id uuid,
  p_expected_revision integer,
  p_expected_title text,
  p_include_title_page boolean,
  p_include_page_numbers boolean,
  p_renderer_version text,
  p_filename text,
  p_byte_size integer,
  p_page_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_project_title text;
  v_draft public.story_drafts%ROWTYPE;
  v_export public.story_exports%ROWTYPE;
  v_content text;
  v_content_sha256 text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_draft_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 1
     OR p_expected_title IS NULL
     OR p_include_title_page IS NULL
     OR p_include_page_numbers IS NULL
     OR p_renderer_version IS NULL OR p_renderer_version <> 'memy_pdf_v1'
     OR p_filename IS NULL OR char_length(p_filename) > 100
     OR p_filename !~ '^memy-[a-z0-9]+(-[a-z0-9]+)*\.pdf$'
     OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 2000000
     OR p_page_count IS NULL OR p_page_count NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid story export metadata' USING ERRCODE = '22023';
  END IF;

  SELECT d.project_id INTO v_project_id
  FROM public.story_drafts AS d
  WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned story draft was not found' USING ERRCODE = 'P0002';
  END IF;

  -- Export recording, Day 4 review/append, Day 5 generation/edit, and Day 6
  -- continuation all serialize on the owned project row first.
  SELECT b.title INTO v_project_title
  FROM public.books AS b
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
  IF v_draft.revision <> p_expected_revision
     OR v_project_title IS DISTINCT FROM p_expected_title THEN
    RAISE EXCEPTION 'Story draft or project title changed during export'
      USING ERRCODE = '55000';
  END IF;

  v_content := public.story_export_selected_content(v_draft.id, v_draft.revision);
  IF v_content IS NULL THEN
    RAISE EXCEPTION 'Saved story revision is unavailable' USING ERRCODE = '55000';
  END IF;
  v_content_sha256 := encode(sha256(convert_to(v_content, 'UTF8')), 'hex');

  SELECT e.* INTO v_export
  FROM public.story_exports AS e
  WHERE e.draft_id = v_draft.id
    AND e.draft_revision = v_draft.revision
    AND e.title_snapshot = v_project_title
    AND e.include_title_page = p_include_title_page
    AND e.include_page_numbers = p_include_page_numbers
    AND e.renderer_version = p_renderer_version;
  IF FOUND THEN
    RETURN public.story_export_metadata_response(v_export.id);
  END IF;

  INSERT INTO public.story_exports (
    project_id, draft_id, draft_version, draft_revision, language,
    title_snapshot, format, include_title_page, include_page_numbers,
    renderer_version, filename, content_sha256, byte_size, page_count
  ) VALUES (
    v_draft.project_id, v_draft.id, v_draft.version, v_draft.revision,
    v_draft.language, v_project_title, 'pdf', p_include_title_page,
    p_include_page_numbers, p_renderer_version, p_filename, v_content_sha256,
    p_byte_size, p_page_count
  ) RETURNING * INTO v_export;
  RETURN public.story_export_metadata_response(v_export.id);
END;
$$;

CREATE FUNCTION public.get_story_export(p_export_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_export public.story_exports%ROWTYPE;
  v_content text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  SELECT e.* INTO v_export
  FROM public.story_exports AS e
  JOIN public.books AS b ON b.id = e.project_id
  WHERE e.id = p_export_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned story export was not found' USING ERRCODE = 'P0002';
  END IF;
  v_content := public.story_export_selected_content(
    v_export.draft_id, v_export.draft_revision
  );
  IF v_content IS NULL
     OR encode(sha256(convert_to(v_content, 'UTF8')), 'hex')
        <> v_export.content_sha256 THEN
    RAISE EXCEPTION 'Saved export revision failed integrity verification'
      USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'export', public.story_export_metadata_response(v_export.id),
    'content', v_content
  );
END;
$$;

CREATE FUNCTION public.list_story_exports(
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
    RAISE EXCEPTION 'Invalid story export pagination' USING ERRCODE = '22023';
  END IF;
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.books AS b
    WHERE b.id = p_project_id
      AND b.user_id = v_user_id
      AND NOT b.is_deleted
  ) THEN
    RAISE EXCEPTION 'Owned story project was not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(
    public.story_export_metadata_response(x.id)
    ORDER BY x.created_at DESC, x.id DESC
  ), '[]'::jsonb) INTO v_result
  FROM (
    SELECT e.id, e.created_at
    FROM public.story_exports AS e
    WHERE e.project_id = p_project_id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT p_limit OFFSET p_offset
  ) AS x;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.continue_story_project(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_language text;
  v_session public.conversation_sessions%ROWTYPE;
  v_session_created boolean := false;
  v_latest_draft_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Invalid story project continuation' USING ERRCODE = '22023';
  END IF;

  SELECT b.language INTO v_language
  FROM public.books AS b
  WHERE b.id = p_project_id
    AND b.user_id = v_user_id
    AND NOT b.is_deleted
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Owned story project was not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT s.* INTO v_session
  FROM public.conversation_sessions AS s
  WHERE s.project_id = p_project_id AND s.status = 'active'
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND AND v_session.language <> v_language THEN
    RAISE EXCEPTION 'Active session language does not match its story project'
      USING ERRCODE = '55000';
  ELSIF NOT FOUND THEN
    INSERT INTO public.conversation_sessions (project_id, language)
    VALUES (p_project_id, v_language)
    RETURNING * INTO v_session;
    v_session_created := true;
  END IF;

  SELECT d.id INTO v_latest_draft_id
  FROM public.story_drafts AS d
  WHERE d.project_id = p_project_id
  ORDER BY d.version DESC, d.id DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'language', v_language,
    'session', jsonb_build_object(
      'id', v_session.id,
      'project_id', v_session.project_id,
      'language', v_session.language,
      'status', v_session.status,
      'created_at', v_session.created_at,
      'updated_at', v_session.updated_at,
      'ended_at', v_session.ended_at
    ),
    'session_created', v_session_created,
    'latest_draft', CASE WHEN v_latest_draft_id IS NULL THEN NULL
      ELSE public.story_draft_response(v_latest_draft_id) END,
    'generation_triggered', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reject_story_export_update()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_export_selected_content(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.story_export_metadata_response(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.load_story_export_context(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_story_export(
  uuid, integer, text, boolean, boolean, text, text, integer, integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_story_export(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_story_exports(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.continue_story_project(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.load_story_export_context(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_story_export(
  uuid, integer, text, boolean, boolean, text, text, integer, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_story_export(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_story_exports(uuid, integer, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.continue_story_project(uuid)
  TO authenticated;

COMMENT ON TABLE public.story_exports IS
  'Immutable metadata for ephemeral PDF renders; no PDF bytes or duplicate story text are stored.';
COMMENT ON FUNCTION public.continue_story_project(uuid) IS
  'Resumes the latest active owned session or creates one; never generates a draft automatically.';

NOTIFY pgrst, 'reload schema';
COMMIT;
