import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// This suite is intentionally isolated and offline. It replays migrations in
// embedded PostgreSQL and never connects to a Supabase project.
const registrationMigration = "20261019000000_registration_settings_access.sql";
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const orphanA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orphanB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const settingsColumns = [
  "email_notifications",
  "deletion_reminders",
  "newsletter",
  "inspiration_frequency",
];

async function expectSqlError(db, sql, params = [], code = "42501") {
  await assert.rejects(
    () => db.query(sql, params),
    (error) => error.code === code,
  );
}

async function applyMigration(db, migrations, file) {
  let sql = await readFile(new URL(file, migrations), "utf8");
  // Historical hosted extensions are unavailable in embedded PostgreSQL.
  // Skip only their provisioning statements, matching foundation.test.mjs.
  sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_(?:cron|net) .*;\s*$/gm, "");
  try {
    await db.exec(sql);
  } catch (error) {
    throw new Error(`Migration failed: ${file}: ${error.message}`, { cause: error });
  }
}

async function setup({ legacyBroadDefaults }) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE unprivileged NOLOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects (
      id uuid DEFAULT gen_random_uuid(),
      bucket_id text,
      name text
    );
    CREATE FUNCTION storage.foldername(name text) RETURNS text[]
      LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
    GRANT USAGE ON SCHEMA public TO unprivileged;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  `);
  if (legacyBroadDefaults) {
    await db.exec(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated;
    `);
  }

  const migrations = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrations))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const registrationIndex = files.indexOf(registrationMigration);
  assert.notEqual(
    registrationIndex,
    -1,
    `required migration is missing: ${registrationMigration}`,
  );

  for (const file of files.slice(0, registrationIndex)) {
    await applyMigration(db, migrations, file);
  }

  // These deliberately orphaned historical rows model the current development
  // data. A privilege migration must never silently delete or rewrite them.
  await db.query(`
    INSERT INTO public.user_settings (
      user_id, email_notifications, deletion_reminders, newsletter,
      inspiration_frequency
    ) VALUES
      ($1, false, true, false, 'monthly'),
      ($2, true, false, true, 'weekly')
  `, [orphanA, orphanB]);

  if (legacyBroadDefaults) {
    // Model both kinds of historic privilege drift. Table-level REVOKE alone
    // does not clear these explicit column ACL entries, including PUBLIC ones.
    await db.exec(`
      GRANT SELECT (
        user_id, email_notifications, deletion_reminders, newsletter,
        inspiration_frequency, created_at
      ) ON TABLE public.user_settings TO PUBLIC, anon, authenticated;
      GRANT UPDATE (user_id, created_at)
        ON TABLE public.user_settings TO PUBLIC, anon, authenticated;
    `);
  }

  for (const file of files.slice(registrationIndex)) {
    await applyMigration(db, migrations, file);
  }
  return db;
}

async function asAuthenticated(db, userId, operation) {
  await db.exec("SET ROLE authenticated");
  if (userId === null) {
    await db.exec("RESET request.jwt.claim.sub");
  } else {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  }
  try {
    return await operation();
  } finally {
    await db.exec("RESET ROLE");
    await db.exec("RESET request.jwt.claim.sub");
  }
}

async function verifySettingsAccess(mode) {
  const db = await setup(mode);
  try {
    const preserved = await db.query(`
      SELECT user_id, email_notifications, deletion_reminders, newsletter,
             inspiration_frequency
      FROM public.user_settings
      WHERE user_id IN ($1, $2)
      ORDER BY user_id
    `, [orphanA, orphanB]);
    assert.deepEqual(preserved.rows, [
      {
        user_id: orphanA,
        email_notifications: false,
        deletion_reminders: true,
        newsletter: false,
        inspiration_frequency: "monthly",
      },
      {
        user_id: orphanB,
        email_notifications: true,
        deletion_reminders: false,
        newsletter: true,
        inspiration_frequency: "weekly",
      },
    ]);

    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES
        ($1, 'alice@example.test', '{"display_name":"Alice"}'),
        ($2, 'bob@example.test', '{}')
    `, [alice, bob]);

    const profiles = await db.query(`
      SELECT user_id, display_name, preferred_language, onboarding_completed,
             is_demo_premium
      FROM public.profiles
      WHERE user_id IN ($1, $2)
      ORDER BY user_id
    `, [alice, bob]);
    assert.deepEqual(profiles.rows, [
      {
        user_id: alice,
        display_name: "Alice",
        preferred_language: "sv",
        onboarding_completed: false,
        is_demo_premium: false,
      },
      {
        user_id: bob,
        display_name: "bob@example.test",
        preferred_language: "sv",
        onboarding_completed: false,
        is_demo_premium: false,
      },
    ]);

    const defaults = await db.query(`
      SELECT user_id, email_notifications, deletion_reminders, newsletter,
             inspiration_frequency, created_at IS NOT NULL AS has_created_at
      FROM public.user_settings
      WHERE user_id IN ($1, $2)
      ORDER BY user_id
    `, [alice, bob]);
    assert.deepEqual(defaults.rows, [alice, bob].map((user_id) => ({
      user_id,
      email_notifications: true,
      deletion_reminders: true,
      newsletter: false,
      inspiration_frequency: "weekly",
      has_created_at: true,
    })));

    const tablePrivileges = await db.query(`
      SELECT
        has_table_privilege('authenticated', 'public.user_settings', 'SELECT') AS auth_select,
        has_table_privilege('authenticated', 'public.user_settings', 'INSERT') AS auth_insert,
        has_table_privilege('authenticated', 'public.user_settings', 'UPDATE') AS auth_table_update,
        has_table_privilege('authenticated', 'public.user_settings', 'DELETE') AS auth_delete,
        has_table_privilege('authenticated', 'public.user_settings', 'TRUNCATE') AS auth_truncate,
        has_table_privilege('anon', 'public.user_settings', 'SELECT') AS anon_select,
        has_table_privilege('anon', 'public.user_settings', 'INSERT') AS anon_insert,
        has_table_privilege('anon', 'public.user_settings', 'UPDATE') AS anon_update,
        has_table_privilege('anon', 'public.user_settings', 'DELETE') AS anon_delete,
        has_table_privilege('anon', 'public.user_settings', 'TRUNCATE') AS anon_truncate
    `);
    assert.deepEqual(tablePrivileges.rows, [{
      auth_select: false,
      auth_insert: false,
      auth_table_update: false,
      auth_delete: false,
      auth_truncate: false,
      anon_select: false,
      anon_insert: false,
      anon_update: false,
      anon_delete: false,
      anon_truncate: false,
    }]);

    for (const column of ["user_id", "created_at", ...settingsColumns]) {
      const privilege = await db.query(`
        SELECT has_column_privilege(
          'authenticated', 'public.user_settings', $1, 'SELECT'
        ) AS allowed
      `, [column]);
      assert.equal(privilege.rows[0].allowed, true, `${column} should be selectable`);

      const anonPrivilege = await db.query(`
        SELECT has_column_privilege(
          'anon', 'public.user_settings', $1, 'SELECT'
        ) AS allowed
      `, [column]);
      assert.equal(
        anonPrivilege.rows[0].allowed,
        false,
        `anon must not select ${column}`,
      );
    }
    for (const column of settingsColumns) {
      const privilege = await db.query(`
        SELECT has_column_privilege(
          'authenticated', 'public.user_settings', $1, 'UPDATE'
        ) AS allowed
      `, [column]);
      assert.equal(privilege.rows[0].allowed, true, `${column} should be updatable`);
    }
    for (const column of ["user_id", "created_at"]) {
      const privilege = await db.query(`
        SELECT has_column_privilege(
          'authenticated', 'public.user_settings', $1, 'UPDATE'
        ) AS allowed
      `, [column]);
      assert.equal(privilege.rows[0].allowed, false, `${column} must not be updatable`);
    }
    for (const column of ["user_id", "created_at", ...settingsColumns]) {
      const privilege = await db.query(`
        SELECT has_column_privilege(
          'anon', 'public.user_settings', $1, 'UPDATE'
        ) AS allowed
      `, [column]);
      assert.equal(privilege.rows[0].allowed, false, `anon must not update ${column}`);
    }

    await asAuthenticated(db, alice, async () => {
      const own = await db.query(`
        SELECT user_id, email_notifications, deletion_reminders, newsletter,
               inspiration_frequency
        FROM public.user_settings
      `);
      assert.deepEqual(own.rows, [{
        user_id: alice,
        email_notifications: true,
        deletion_reminders: true,
        newsletter: false,
        inspiration_frequency: "weekly",
      }]);

      const changed = await db.query(`
        UPDATE public.user_settings
        SET email_notifications = false,
            deletion_reminders = false,
            newsletter = true,
            inspiration_frequency = 'monthly'
        WHERE user_id = $1
        RETURNING email_notifications, deletion_reminders, newsletter,
                  inspiration_frequency
      `, [alice]);
      assert.deepEqual(changed.rows, [{
        email_notifications: false,
        deletion_reminders: false,
        newsletter: true,
        inspiration_frequency: "monthly",
      }]);

      assert.equal(
        (await db.query("SELECT * FROM public.user_settings WHERE user_id = $1", [bob])).rows.length,
        0,
      );
      assert.equal(
        (await db.query(`
          UPDATE public.user_settings SET newsletter = true
          WHERE user_id = $1 RETURNING user_id
        `, [bob])).rows.length,
        0,
      );

      await expectSqlError(
        db,
        "INSERT INTO public.user_settings (user_id) VALUES ($1)",
        ["33333333-3333-4333-8333-333333333333"],
      );
      await expectSqlError(
        db,
        "DELETE FROM public.user_settings WHERE user_id = $1",
        [alice],
      );
      await expectSqlError(db, "TRUNCATE public.user_settings");
      await expectSqlError(
        db,
        "UPDATE public.user_settings SET user_id = $1 WHERE user_id = $2",
        ["33333333-3333-4333-8333-333333333333", alice],
      );
      await expectSqlError(
        db,
        "UPDATE public.user_settings SET created_at = now() WHERE user_id = $1",
        [alice],
      );
    });

    await asAuthenticated(db, null, async () => {
      assert.equal((await db.query("SELECT * FROM public.user_settings")).rows.length, 0);
      assert.equal(
        (await db.query(`
          UPDATE public.user_settings SET newsletter = false RETURNING user_id
        `)).rows.length,
        0,
      );
    });

    await db.exec("SET ROLE anon");
    try {
      await expectSqlError(db, "SELECT * FROM public.user_settings");
      await expectSqlError(
        db,
        "UPDATE public.user_settings SET newsletter = true WHERE user_id = $1",
        [alice],
      );
      await expectSqlError(
        db,
        "INSERT INTO public.user_settings (user_id) VALUES ($1)",
        ["33333333-3333-4333-8333-333333333333"],
      );
      await expectSqlError(
        db,
        "DELETE FROM public.user_settings WHERE user_id = $1",
        [alice],
      );
      await expectSqlError(db, "TRUNCATE public.user_settings");
    } finally {
      await db.exec("RESET ROLE");
    }

    // A role with only schema usage receives PUBLIC privileges and nothing
    // else, so these failures prove the migration removed rogue PUBLIC ACLs.
    await db.exec("SET ROLE unprivileged");
    try {
      await expectSqlError(db, "SELECT * FROM public.user_settings");
      await expectSqlError(
        db,
        "UPDATE public.user_settings SET user_id = $1, created_at = now()",
        [alice],
      );
    } finally {
      await db.exec("RESET ROLE");
    }
  } finally {
    await db.close();
  }
}

test("settings access is least-privilege without inherited default grants", async () => {
  await verifySettingsAccess({ legacyBroadDefaults: false });
});

test("settings access revokes legacy broad default grants", async () => {
  await verifySettingsAccess({ legacyBroadDefaults: true });
});
