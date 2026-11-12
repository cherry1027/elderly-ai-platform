CREATE SCHEMA IF NOT EXISTS memy_private;
REVOKE ALL ON SCHEMA memy_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA memy_private TO authenticated;

-- Track the explicit selection independently of AI-generated fact categories.
CREATE TABLE memy_private.user_selected_story_memories (
  memory_id uuid PRIMARY KEY REFERENCES public.real_memories(id) ON DELETE CASCADE
);
ALTER TABLE memy_private.user_selected_story_memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE memy_private.user_selected_story_memories FROM PUBLIC, anon, authenticated;

CREATE FUNCTION memy_private.save_real_memory_from_message(
  p_session_id uuid, p_source_message_id uuid, p_excerpt text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  requester uuid := auth.uid();
  source public.real_conversation_messages;
  saved public.real_memories;
BEGIN
  IF requester IS NULL THEN
    RAISE EXCEPTION 'Sign-in required' USING ERRCODE = '42501';
  END IF;

  -- The project lock serializes this save with memory review, project removal
  -- and draft context updates. Only the current owner can acquire the lock.
  PERFORM 1
    FROM public.conversation_sessions AS session
    JOIN public.books AS book ON book.id = session.project_id
    WHERE session.id = p_session_id AND book.user_id = requester AND NOT book.is_deleted
    FOR UPDATE OF book;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source unavailable' USING ERRCODE = 'P0002';
  END IF;

  SELECT message.* INTO source
    FROM public.real_conversation_messages AS message
    JOIN public.conversation_sessions AS session
      ON session.id = message.session_id AND session.project_id = message.project_id
    WHERE message.id = p_source_message_id AND message.session_id = p_session_id
      AND message.owner_id = requester AND message.role = 'user';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source unavailable' USING ERRCODE = 'P0002';
  END IF;

  IF p_excerpt IS NULL OR char_length(p_excerpt) NOT BETWEEN 1 AND 1000
    OR length(btrim(p_excerpt,
      U&'\0009\000a\000b\000c\000d\001c\001d\001e\001f\0020\0085\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000')) = 0
    OR strpos(source.text, p_excerpt) = 0 THEN
    RAISE EXCEPTION 'Invalid source excerpt' USING ERRCODE = '22023';
  END IF;

  SELECT memory.* INTO saved
    FROM public.real_memories AS memory
    JOIN memy_private.user_selected_story_memories AS selection ON selection.memory_id = memory.id
    WHERE memory.owner_id = requester AND memory.project_id = source.project_id
      AND memory.session_id = p_session_id AND memory.source_message_id = source.id
      AND memory.evidence = p_excerpt;

  IF FOUND THEN
    IF saved.status <> 'confirmed' OR saved.corrected_value IS NOT NULL OR saved.value <> p_excerpt THEN
      RAISE EXCEPTION 'The saved memory has changed' USING ERRCODE = '40001';
    END IF;
  ELSE
    INSERT INTO public.real_memories (
      owner_id, project_id, session_id, source_message_id, fact_type, value, evidence, status
    ) VALUES (
      requester, source.project_id, p_session_id, source.id, 'event', p_excerpt, p_excerpt, 'confirmed'
    ) RETURNING * INTO saved;
    INSERT INTO memy_private.user_selected_story_memories (memory_id) VALUES (saved.id);
  END IF;

  RETURN (to_jsonb(saved) - 'owner_id') || jsonb_build_object('clarification_question', NULL);
END;
$$;

CREATE FUNCTION public.save_real_memory_from_message(
  p_session_id uuid, p_source_message_id uuid, p_excerpt text
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT memy_private.save_real_memory_from_message(p_session_id, p_source_message_id, p_excerpt);
$$;

REVOKE ALL ON FUNCTION memy_private.save_real_memory_from_message(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_real_memory_from_message(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION memy_private.save_real_memory_from_message(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_real_memory_from_message(uuid, uuid, text) TO authenticated;

DO $$
BEGIN
  IF to_regrole('service_role') IS NOT NULL THEN
    REVOKE ALL ON TABLE memy_private.user_selected_story_memories FROM service_role;
    REVOKE ALL ON FUNCTION memy_private.save_real_memory_from_message(uuid, uuid, text) FROM service_role;
    REVOKE ALL ON FUNCTION public.save_real_memory_from_message(uuid, uuid, text) FROM service_role;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
