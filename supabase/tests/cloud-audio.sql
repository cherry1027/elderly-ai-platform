-- Run manually only in the dedicated development project after the Day 3 migration.
-- This script creates transaction-scoped synthetic rows and always rolls them back.
-- It creates no login credentials, stores no raw audio and must not be run in production.
BEGIN;

-- These exact synthetic UUIDs use d3a*/d3b* prefixes and are deliberately
-- distinct from the known e9f03575* test-user prefix. Refuse to reuse any row.
DO $collision_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      'd3a10000-0000-4000-8000-000000000001',
      'd3b20000-0000-4000-8000-000000000002'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.books
    WHERE id IN (
      'd3a30000-0000-4000-8000-000000000003',
      'd3b40000-0000-4000-8000-000000000004'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.conversation_sessions
    WHERE id IN (
      'd3a50000-0000-4000-8000-000000000005',
      'd3b60000-0000-4000-8000-000000000006'
    )
  ) THEN
    RAISE EXCEPTION 'Day 3 synthetic UUID collision; no verification rows were created';
  END IF;
END $collision_guard$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (
    'd3a10000-0000-4000-8000-000000000001',
    'memy-day3-alice@example.invalid',
    '{}'
  ),
  (
    'd3b20000-0000-4000-8000-000000000002',
    'memy-day3-bob@example.invalid',
    '{}'
  );

INSERT INTO public.books (id, user_id, title, language) VALUES
  (
    'd3a30000-0000-4000-8000-000000000003',
    'd3a10000-0000-4000-8000-000000000001',
    'Day 3 Alice audio test',
    'sv'
  ),
  (
    'd3b40000-0000-4000-8000-000000000004',
    'd3b20000-0000-4000-8000-000000000002',
    'Day 3 Bob audio test',
    'sv'
  );

INSERT INTO public.conversation_sessions (id, project_id, language) VALUES
  (
    'd3a50000-0000-4000-8000-000000000005',
    'd3a30000-0000-4000-8000-000000000003',
    'sv'
  ),
  (
    'd3b60000-0000-4000-8000-000000000006',
    'd3b40000-0000-4000-8000-000000000004',
    'sv'
  );

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"d3a10000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $alice_tests$
DECLARE
  v_claim record;
  v_duplicate record;
  v_complete record;
  v_replay record;
  v_failed_claim record;
  v_failed record;
  v_failed_replay record;
  v_retry record;
  v_retry_complete record;
  v_transcript_id uuid;
  v_count integer;
BEGIN
  SELECT * INTO STRICT v_claim
  FROM public.claim_audio_transcription(
    'd3a30000-0000-4000-8000-000000000003',
    'd3a50000-0000-4000-8000-000000000005',
    'd3a70000-0000-4000-8000-000000000007',
    repeat('a', 64),
    'sv'
  );
  IF v_claim.outcome <> 'claimed'
     OR v_claim.status <> 'processing'
     OR v_claim.claim_token IS NULL
     OR v_claim.attempt_count <> 1 THEN
    RAISE EXCEPTION 'Initial transcription claim contract failed';
  END IF;

  SELECT * INTO STRICT v_duplicate
  FROM public.claim_audio_transcription(
    'd3a30000-0000-4000-8000-000000000003',
    'd3a50000-0000-4000-8000-000000000005',
    'd3a70000-0000-4000-8000-000000000007',
    repeat('a', 64),
    'sv'
  );
  IF v_duplicate.outcome <> 'in_progress'
     OR v_duplicate.request_id <> v_claim.request_id
     OR v_duplicate.claim_token IS NOT NULL
     OR v_duplicate.attempt_count <> 1 THEN
    RAISE EXCEPTION 'Duplicate in-progress claim contract failed';
  END IF;

  BEGIN
    PERFORM 1
    FROM public.claim_audio_transcription(
      'd3a30000-0000-4000-8000-000000000003',
      'd3a50000-0000-4000-8000-000000000005',
      'd3a70000-0000-4000-8000-000000000007',
      repeat('b', 64),
      'sv'
    );
    RAISE EXCEPTION 'Idempotency-key content mismatch unexpectedly allowed';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    PERFORM 1
    FROM public.claim_audio_transcription(
      'd3a30000-0000-4000-8000-000000000003',
      'd3a50000-0000-4000-8000-000000000005',
      'd3a90000-0000-4000-8000-000000000009',
      repeat('c', 64),
      'en'
    );
    RAISE EXCEPTION 'Session-language mismatch unexpectedly allowed';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  SELECT * INTO STRICT v_complete
  FROM public.complete_audio_transcription(
    v_claim.request_id,
    v_claim.claim_token,
    'Jag minns min första skoldag.'
  );
  v_transcript_id := v_complete.transcript_id;
  IF v_complete.session_id <> 'd3a50000-0000-4000-8000-000000000005'
     OR v_complete.language <> 'sv'
     OR v_complete.text <> 'Jag minns min första skoldag.'
     OR v_complete.status <> 'completed' THEN
    RAISE EXCEPTION 'Completion response contract failed';
  END IF;

  SELECT * INTO STRICT v_replay
  FROM public.complete_audio_transcription(
    v_claim.request_id,
    v_claim.claim_token,
    'Jag minns min första skoldag.'
  );
  IF v_replay.transcript_id <> v_transcript_id THEN
    RAISE EXCEPTION 'Completed replay created a different transcript';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audio_transcripts
  WHERE session_id = 'd3a50000-0000-4000-8000-000000000005';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Completed replay did not preserve one audio transcript';
  END IF;

  INSERT INTO public.conversation_messages (session_id, role, original_text)
  VALUES (
    'd3a50000-0000-4000-8000-000000000005',
    'user',
    'Correction appended separately from audio.'
  );
  SELECT count(*) INTO v_count
  FROM public.audio_transcripts
  WHERE session_id = 'd3a50000-0000-4000-8000-000000000005';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Audio view included a non-audio correction';
  END IF;

  BEGIN
    UPDATE public.conversation_messages
    SET original_text = 'Overwritten'
    WHERE id = v_transcript_id;
    RAISE EXCEPTION 'Original transcript overwrite unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE public.conversation_sessions
    SET language = 'en'
    WHERE id = 'd3a50000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'Session language change unexpectedly allowed';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    PERFORM claim_token
    FROM public.audio_transcription_requests
    WHERE id = v_claim.request_id;
    RAISE EXCEPTION 'Private claim token unexpectedly selectable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT * INTO STRICT v_failed_claim
  FROM public.claim_audio_transcription(
    'd3a30000-0000-4000-8000-000000000003',
    'd3a50000-0000-4000-8000-000000000005',
    'd3a80000-0000-4000-8000-000000000008',
    repeat('d', 64),
    'sv'
  );
  SELECT * INTO STRICT v_failed
  FROM public.fail_audio_transcription(
    v_failed_claim.request_id,
    v_failed_claim.claim_token,
    'PROVIDER_UNAVAILABLE'
  );
  IF v_failed.status <> 'failed' OR v_failed.attempt_count <> 1 THEN
    RAISE EXCEPTION 'Failure recording contract failed';
  END IF;

  SELECT * INTO STRICT v_failed_replay
  FROM public.fail_audio_transcription(
    v_failed_claim.request_id,
    v_failed_claim.claim_token,
    'PROVIDER_UNAVAILABLE'
  );
  IF v_failed_replay.status <> 'failed' OR v_failed_replay.attempt_count <> 1 THEN
    RAISE EXCEPTION 'Failure replay contract failed';
  END IF;

  SELECT * INTO STRICT v_retry
  FROM public.claim_audio_transcription(
    'd3a30000-0000-4000-8000-000000000003',
    'd3a50000-0000-4000-8000-000000000005',
    'd3a80000-0000-4000-8000-000000000008',
    repeat('d', 64),
    'sv'
  );
  IF v_retry.outcome <> 'claimed'
     OR v_retry.attempt_count <> 2
     OR v_retry.claim_token = v_failed_claim.claim_token THEN
    RAISE EXCEPTION 'Failed-request retry contract failed';
  END IF;

  SELECT * INTO STRICT v_retry_complete
  FROM public.complete_audio_transcription(
    v_retry.request_id,
    v_retry.claim_token,
    'Ett andra ljudminne efter ett nytt försök.'
  );
  IF v_retry_complete.status <> 'completed' THEN
    RAISE EXCEPTION 'Retried request did not complete';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audio_transcripts
  WHERE session_id = 'd3a50000-0000-4000-8000-000000000005';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Audio-only completed transcript view count failed';
  END IF;
END $alice_tests$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"d3b20000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

DO $bob_tests$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.audio_transcripts
    WHERE session_id = 'd3a50000-0000-4000-8000-000000000005'
  ) THEN
    RAISE EXCEPTION 'Cross-user audio transcript read unexpectedly allowed';
  END IF;

  BEGIN
    PERFORM 1
    FROM public.claim_audio_transcription(
      'd3a30000-0000-4000-8000-000000000003',
      'd3a50000-0000-4000-8000-000000000005',
      'd3b70000-0000-4000-8000-000000000007',
      repeat('e', 64),
      'sv'
    );
    RAISE EXCEPTION 'Cross-user transcription claim unexpectedly allowed';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;
END $bob_tests$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{}', true);

DO $anonymous_tests$
BEGIN
  BEGIN
    PERFORM 1 FROM public.audio_transcripts;
    RAISE EXCEPTION 'Anonymous audio transcript read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    PERFORM 1
    FROM public.claim_audio_transcription(
      'd3a30000-0000-4000-8000-000000000003',
      'd3a50000-0000-4000-8000-000000000005',
      'd3aa0000-0000-4000-8000-00000000000a',
      repeat('f', 64),
      'sv'
    );
    RAISE EXCEPTION 'Anonymous transcription RPC unexpectedly executable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $anonymous_tests$;

RESET ROLE;
ROLLBACK;

SELECT
  'PASS: Day 3 audio RPC, retry, replay, immutability and RLS checks; synthetic rows rolled back'
  AS day3_audio_verification;
