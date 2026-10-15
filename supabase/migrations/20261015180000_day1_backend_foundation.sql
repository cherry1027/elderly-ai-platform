-- Day 1: additive foundation over the existing profiles/books implementation.
-- Requires PostgreSQL 15+ (security_invoker views). No existing rows are deleted.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'sv'
  CHECK (preferred_language IN ('en', 'sv'));

ALTER TABLE public.books
  ADD COLUMN language text NOT NULL DEFAULT 'sv'
  CHECK (language IN ('en', 'sv'));

-- One source of truth: a story project is the existing book, not a duplicate row.
-- Invoker privileges preserve the caller's existing books RLS policies.
CREATE VIEW public.story_projects WITH (security_invoker = true) AS
  SELECT id, user_id, title, description, language, status, created_at, updated_at
  FROM public.books
  WHERE NOT is_deleted
  WITH CASCADED CHECK OPTION;

REVOKE ALL ON public.story_projects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_projects TO authenticated;

CREATE TABLE public.conversation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  language text NOT NULL CHECK (language IN ('en', 'sv')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT session_completion_valid CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'completed' AND ended_at IS NOT NULL AND ended_at >= created_at)
  )
);

CREATE INDEX conversation_sessions_project_created_idx
  ON public.conversation_sessions (project_id, created_at);

ALTER TABLE public.conversation_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_sessions TO authenticated;

CREATE POLICY sessions_select_owned ON public.conversation_sessions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.books b
      WHERE b.id = project_id AND b.user_id = (SELECT auth.uid()) AND NOT b.is_deleted)
  );
CREATE POLICY sessions_insert_owned ON public.conversation_sessions
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.books b
      WHERE b.id = project_id AND b.user_id = (SELECT auth.uid()) AND NOT b.is_deleted)
  );
CREATE POLICY sessions_update_owned ON public.conversation_sessions
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.books b
      WHERE b.id = project_id AND b.user_id = (SELECT auth.uid()) AND NOT b.is_deleted)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.books b
      WHERE b.id = project_id AND b.user_id = (SELECT auth.uid()) AND NOT b.is_deleted)
  );
CREATE POLICY sessions_delete_owned ON public.conversation_sessions
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.books b
      WHERE b.id = project_id AND b.user_id = (SELECT auth.uid()) AND NOT b.is_deleted)
  );

CREATE TRIGGER conversation_sessions_updated_at
  BEFORE UPDATE ON public.conversation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Store source text separately from pages.content (generated/edited stories).
-- Corrections must be new messages; no UPDATE privilege or policy is granted.
CREATE TABLE public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.conversation_sessions(id) ON DELETE CASCADE,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  original_text text NOT NULL CHECK (length(btrim(original_text)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, sequence)
);

ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.conversation_messages TO authenticated;
REVOKE ALL ON SEQUENCE public.conversation_messages_sequence_seq FROM PUBLIC, anon;
GRANT USAGE ON SEQUENCE public.conversation_messages_sequence_seq TO authenticated;

CREATE POLICY messages_select_owned ON public.conversation_messages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.conversation_sessions s
      WHERE s.id = session_id)
  );
CREATE POLICY messages_insert_owned ON public.conversation_messages
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.conversation_sessions s
      WHERE s.id = session_id AND s.status = 'active')
  );

CREATE FUNCTION public.reject_original_message_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Original conversation messages are immutable; append a correction instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER conversation_messages_immutable
  BEFORE UPDATE ON public.conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.reject_original_message_update();

COMMENT ON VIEW public.story_projects IS
  'RLS-preserving alias of books for the autobiography pilot; one row per project.';
COMMENT ON TABLE public.conversation_messages IS
  'Append-only source text, separate from generated stories and future confirmed memories. Parent deletion cascades for erasure.';

COMMIT;
