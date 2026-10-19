-- Run manually only in the dedicated development project after the settings
-- access migration. All synthetic rows are transaction-scoped and rolled back.
-- No passwords, login credentials or real-user rows are created or changed.
BEGIN;

DO $collision_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id IN (
      'd3c10000-0000-4000-8000-000000000001',
      'd3d20000-0000-4000-8000-000000000002'
    )
       OR email IN (
         'memy-settings-alice@example.invalid',
         'memy-settings-bob@example.invalid'
       )
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id IN (
      'd3c10000-0000-4000-8000-000000000001',
      'd3d20000-0000-4000-8000-000000000002'
    )
  ) OR EXISTS (
    SELECT 1
    FROM public.user_settings
    WHERE user_id IN (
      'd3c10000-0000-4000-8000-000000000001',
      'd3d20000-0000-4000-8000-000000000002'
    )
  ) THEN
    RAISE EXCEPTION 'Settings verification synthetic identity collision';
  END IF;
END $collision_guard$;

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (
    'd3c10000-0000-4000-8000-000000000001',
    'memy-settings-alice@example.invalid',
    '{"display_name":"Settings Alice"}'
  ),
  (
    'd3d20000-0000-4000-8000-000000000002',
    'memy-settings-bob@example.invalid',
    '{"display_name":"Settings Bob"}'
  );

DO $trigger_tests$
BEGIN
  IF (
    SELECT count(*)
    FROM public.profiles
    WHERE user_id IN (
      'd3c10000-0000-4000-8000-000000000001',
      'd3d20000-0000-4000-8000-000000000002'
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'Registration profile trigger did not create both profiles';
  END IF;

  IF (
    SELECT count(*)
    FROM public.user_settings
    WHERE user_id IN (
      'd3c10000-0000-4000-8000-000000000001',
      'd3d20000-0000-4000-8000-000000000002'
    )
  ) <> 2 THEN
    RAISE EXCEPTION 'Registration settings trigger did not create both rows';
  END IF;
END $trigger_tests$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"d3c10000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

DO $alice_tests$
DECLARE
  v_count integer;
  v_created_at timestamptz;
BEGIN
  SELECT count(*), min(created_at)
    INTO v_count, v_created_at
  FROM public.user_settings
  WHERE user_id = 'd3c10000-0000-4000-8000-000000000001';
  IF v_count <> 1 OR v_created_at IS NULL THEN
    RAISE EXCEPTION 'Owner settings read failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_settings
    WHERE user_id = 'd3d20000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Foreign settings read unexpectedly returned a row';
  END IF;

  UPDATE public.user_settings
  SET email_notifications = false,
      deletion_reminders = false,
      newsletter = true,
      inspiration_frequency = 'monthly'
  WHERE user_id = 'd3c10000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM public.user_settings
    WHERE user_id = 'd3c10000-0000-4000-8000-000000000001'
      AND NOT email_notifications
      AND NOT deletion_reminders
      AND newsletter
      AND inspiration_frequency = 'monthly'
      AND created_at = v_created_at
  ) THEN
    RAISE EXCEPTION 'Owner preference update failed';
  END IF;

  UPDATE public.user_settings
  SET newsletter = true
  WHERE user_id = 'd3d20000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Foreign settings update unexpectedly changed a row';
  END IF;

  BEGIN
    INSERT INTO public.user_settings (user_id)
    VALUES ('d3e30000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'Authenticated settings insert unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM public.user_settings
    WHERE user_id = 'd3c10000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Authenticated settings delete unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE public.user_settings
    SET user_id = 'd3d20000-0000-4000-8000-000000000002'
    WHERE user_id = 'd3c10000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Settings ownership retarget unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE public.user_settings
    SET created_at = now()
    WHERE user_id = 'd3c10000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Settings creation timestamp update unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    TRUNCATE TABLE public.user_settings;
    RAISE EXCEPTION 'Authenticated settings truncate unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $alice_tests$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"d3d20000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

DO $bob_tests$
DECLARE
  v_count integer;
BEGIN
  IF (
    SELECT count(*)
    FROM public.user_settings
    WHERE user_id = 'd3d20000-0000-4000-8000-000000000002'
  ) <> 1 THEN
    RAISE EXCEPTION 'Second owner settings read failed';
  END IF;

  UPDATE public.user_settings
  SET inspiration_frequency = 'daily'
  WHERE user_id = 'd3d20000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Second owner preference update failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_settings
    WHERE user_id = 'd3c10000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Second owner could read the first owner settings';
  END IF;
END $bob_tests$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{}', true);

DO $anonymous_tests$
BEGIN
  BEGIN
    PERFORM email_notifications FROM public.user_settings;
    RAISE EXCEPTION 'Anonymous settings read unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    UPDATE public.user_settings SET newsletter = true;
    RAISE EXCEPTION 'Anonymous settings update unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $anonymous_tests$;

RESET ROLE;
ROLLBACK;

SELECT
  'PASS: registration settings trigger, least-privilege grants and owner RLS; synthetic rows rolled back'
  AS registration_settings_verification;
