-- Run only in the dedicated development project. Synthetic rows are rolled back.
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('11111111-1111-4111-8111-111111111111', 'memy-day1-alice@example.invalid', '{}'),
 ('22222222-2222-4222-8222-222222222222', 'memy-day1-bob@example.invalid', '{}');
INSERT INTO public.books (id, user_id, title) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Day 1 Alice test'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'Day 1 Bob test');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.story_projects WHERE id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')) <> 1 THEN
   RAISE EXCEPTION 'Project read ownership failed';
 END IF;
 IF (SELECT count(*) FROM public.profiles WHERE user_id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')) <> 1 THEN
   RAISE EXCEPTION 'Profile read ownership failed';
 END IF;
 INSERT INTO public.conversation_sessions (id, project_id, language)
 VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sv');
 BEGIN
   INSERT INTO public.conversation_sessions (project_id, language) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','sv');
   RAISE EXCEPTION 'Cross-user session insert unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 INSERT INTO public.conversation_messages (id, session_id, role, original_text)
 VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','user','Original: 1974.');
 INSERT INTO public.conversation_messages (session_id, role, original_text)
 VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','user','Correction: 1975.');
 BEGIN
   UPDATE public.conversation_messages SET original_text = 'Overwritten' WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
   RAISE EXCEPTION 'Original transcript update unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 IF (SELECT count(*) FROM public.conversation_messages WHERE session_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') <> 2 THEN
   RAISE EXCEPTION 'Original plus correction were not preserved';
 END IF;
END $test$;
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
DO $test$
BEGIN
 IF EXISTS (SELECT 1 FROM public.conversation_sessions WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') THEN
   RAISE EXCEPTION 'Cross-user session read unexpectedly allowed';
 END IF;
 IF EXISTS (SELECT 1 FROM public.conversation_messages WHERE session_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') THEN
   RAISE EXCEPTION 'Cross-user transcript read unexpectedly allowed';
 END IF;
 BEGIN
   INSERT INTO public.conversation_messages (session_id, role, original_text)
   VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','user','Cross-user intrusion');
   RAISE EXCEPTION 'Cross-user transcript insert unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $test$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{}', true);
DO $test$
BEGIN
 IF EXISTS (SELECT 1 FROM public.profiles) THEN
   RAISE EXCEPTION 'Anonymous profile data unexpectedly visible';
 END IF;
 BEGIN
   PERFORM 1 FROM public.conversation_sessions;
   RAISE EXCEPTION 'Anonymous sessions access unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $test$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: cloud ownership, transcript preservation and anonymous restrictions; synthetic rows rolled back' AS day1_verification;
