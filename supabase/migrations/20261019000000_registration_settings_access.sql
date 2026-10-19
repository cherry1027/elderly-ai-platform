-- Restore least-privilege settings access for authenticated registrations.
-- Settings rows continue to be created only by the existing auth.users trigger.
BEGIN;

DO $preflight$
DECLARE
  v_actual_columns text[];
  v_actual_policies text[];
  v_rls_enabled boolean;
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
    RAISE EXCEPTION 'Expected public.user_settings to exist';
  END IF;

  SELECT array_agg(c.column_name ORDER BY c.column_name)
    INTO v_actual_columns
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'user_settings';

  IF v_actual_columns IS DISTINCT FROM ARRAY[
    'created_at',
    'deletion_reminders',
    'email_notifications',
    'inspiration_frequency',
    'newsletter',
    'user_id'
  ]::text[] THEN
    RAISE EXCEPTION 'Unexpected user_settings columns: %', v_actual_columns;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('user_id', 'uuid'),
        ('email_notifications', 'boolean'),
        ('deletion_reminders', 'boolean'),
        ('newsletter', 'boolean'),
        ('inspiration_frequency', 'text'),
        ('created_at', 'timestamp with time zone')
    ) AS expected(column_name, data_type)
    LEFT JOIN information_schema.columns AS actual
      ON actual.table_schema = 'public'
     AND actual.table_name = 'user_settings'
     AND actual.column_name = expected.column_name
    WHERE actual.column_name IS NULL
       OR actual.data_type <> expected.data_type
       OR actual.is_nullable <> 'NO'
  ) THEN
    RAISE EXCEPTION 'Unexpected user_settings column type or nullability';
  END IF;

  SELECT c.relrowsecurity
    INTO v_rls_enabled
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'user_settings';
  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Row Level Security must already be enabled on user_settings';
  END IF;

  SELECT array_agg(p.policyname || ':' || p.cmd ORDER BY p.policyname)
    INTO v_actual_policies
  FROM pg_policies AS p
  WHERE p.schemaname = 'public' AND p.tablename = 'user_settings';

  IF v_actual_policies IS DISTINCT FROM ARRAY[
    'Users can create their own settings:INSERT',
    'Users can update their own settings:UPDATE',
    'Users can view their own settings:SELECT'
  ]::text[] THEN
    RAISE EXCEPTION 'Unexpected user_settings policies: %', v_actual_policies;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_class AS c ON c.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    JOIN pg_namespace AS pn ON pn.oid = p.pronamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created_settings'
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O', 'A')
      AND pn.nspname = 'public'
      AND p.proname = 'handle_new_user_settings'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Expected enabled SECURITY DEFINER settings registration trigger';
  END IF;
END $preflight$;

DROP POLICY "Users can view their own settings" ON public.user_settings;
DROP POLICY "Users can create their own settings" ON public.user_settings;
DROP POLICY "Users can update their own settings" ON public.user_settings;

REVOKE ALL PRIVILEGES ON TABLE public.user_settings FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.user_settings FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.user_settings FROM authenticated;

-- Table-level REVOKE does not clear any earlier column-level grants.
REVOKE ALL PRIVILEGES (
  user_id,
  email_notifications,
  deletion_reminders,
  newsletter,
  inspiration_frequency,
  created_at
) ON TABLE public.user_settings FROM PUBLIC, anon, authenticated;

-- Explicit current columns keep SELECT * and user_id filters working without
-- automatically exposing any future columns.
GRANT SELECT (
  user_id,
  email_notifications,
  deletion_reminders,
  newsletter,
  inspiration_frequency,
  created_at
) ON TABLE public.user_settings TO authenticated;

GRANT UPDATE (
  email_notifications,
  deletion_reminders,
  newsletter,
  inspiration_frequency
) ON TABLE public.user_settings TO authenticated;

CREATE POLICY user_settings_select_owned
  ON public.user_settings
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY user_settings_update_owned
  ON public.user_settings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
