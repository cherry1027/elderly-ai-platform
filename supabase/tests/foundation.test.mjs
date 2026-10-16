import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildBootstrap } from "../scripts/build-bootstrap.mjs";

// Isolated PostgreSQL engine. Never connects to a developer's Supabase project.
// auth/storage below emulate only the Supabase primitives used by migrations.
let db;
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const aliceProject = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bobProject = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const message = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function asUser(userId, operation) {
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try {
    return await operation();
  } finally {
    await db.exec("RESET ROLE");
    await db.exec("RESET request.jwt.claim.sub");
  }
}

async function expectSqlError(sql, params, code) {
  await assert.rejects(() => db.query(sql, params), (error) => error.code === code);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid(), bucket_id text, name text);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
      $$ SELECT string_to_array(name, '/') $$;
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  `);
  const migrations = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    let sql = await readFile(new URL(file, migrations), "utf8");
    // Historical hosting extensions are not available in embedded PostgreSQL.
    // Skip only their provisioning statements; execute all tables/policies/triggers.
    sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_(?:cron|net) .*;\s*$/gm, "");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration failed: ${file}: ${error.message}`, { cause: error });
    }
  }
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1, 'alice@example.test'), ($2, 'bob@example.test')", [alice, bob]);
  await db.query("INSERT INTO public.books (id, user_id, title) VALUES ($1, $2, 'Alice childhood'), ($3, $4, 'Bob travels')", [aliceProject, alice, bobProject, bob]);
});

after(async () => { if (db) await db.close(); });

test("historical migrations and new foundation apply; profiles are reused", async () => {
  const result = await db.query("SELECT preferred_language FROM profiles ORDER BY user_id");
  assert.deepEqual(result.rows, [{ preferred_language: "sv" }, { preferred_language: "sv" }]);
  const view = await db.query("SELECT reloptions FROM pg_class WHERE oid = 'public.story_projects'::regclass");
  assert.ok(view.rows[0].reloptions.includes("security_invoker=true"));
});

test("project view applies underlying books RLS to each user", async () => {
  await asUser(alice, async () => {
    const result = await db.query("SELECT id FROM story_projects");
    assert.deepEqual(result.rows, [{ id: aliceProject }]);
    await expectSqlError("INSERT INTO story_projects (user_id, title) VALUES ($1, 'Forged')", [bob], "42501");
    const changed = await db.query("UPDATE story_projects SET title = 'Stolen' WHERE id = $1 RETURNING id", [bobProject]);
    assert.equal(changed.rows.length, 0);
    await expectSqlError("UPDATE story_projects SET user_id = $1 WHERE id = $2", [bob, aliceProject], "42501");
    const removed = await db.query("DELETE FROM story_projects WHERE id = $1 RETURNING id", [bobProject]);
    assert.equal(removed.rows.length, 0);
  });
  await asUser(bob, async () => {
    assert.deepEqual((await db.query("SELECT id FROM story_projects")).rows, [{ id: bobProject }]);
  });
});

test("project view is writable and preserves existing books rows", async () => {
  await asUser(alice, async () => {
    const project = await db.query("INSERT INTO story_projects (user_id, title, language) VALUES ($1, 'Second project', 'en') RETURNING id", [alice]);
    const id = project.rows[0].id;
    assert.equal((await db.query("SELECT language FROM books WHERE id = $1", [id])).rows[0].language, "en");
    await db.query("UPDATE story_projects SET title = 'Renamed' WHERE id = $1", [id]);
    assert.equal((await db.query("SELECT title FROM books WHERE id = $1", [id])).rows[0].title, "Renamed");
    await db.query("DELETE FROM story_projects WHERE id = $1", [id]);
  });
});

test("profiles and projects reject unsupported languages", async () => {
  await asUser(alice, async () => {
    await db.query("UPDATE profiles SET preferred_language = 'en' WHERE user_id = $1", [alice]);
    await expectSqlError("UPDATE profiles SET preferred_language = 'de' WHERE user_id = $1", [alice], "23514");
    await expectSqlError("UPDATE story_projects SET language = 'de' WHERE id = $1", [aliceProject], "23514");
    assert.equal((await db.query("SELECT * FROM profiles WHERE user_id = $1", [bob])).rows.length, 0);
  });
});

test("sessions enforce project ownership for inserts and updates", async () => {
  await asUser(alice, async () => {
    await db.query("INSERT INTO conversation_sessions (id, project_id, language) VALUES ($1, $2, 'sv')", [session, aliceProject]);
    await expectSqlError("INSERT INTO conversation_sessions (project_id, language) VALUES ($1, 'sv')", [bobProject], "42501");
    await expectSqlError("UPDATE conversation_sessions SET project_id = $1 WHERE id = $2", [bobProject, session], "42501");
    await expectSqlError("INSERT INTO conversation_sessions (project_id, language) VALUES ($1, 'de')", [aliceProject], "23514");
  });
  await asUser(bob, async () => {
    assert.equal((await db.query("SELECT * FROM conversation_sessions")).rows.length, 0);
    assert.equal((await db.query("UPDATE conversation_sessions SET language = 'en' WHERE id = $1 RETURNING id", [session])).rows.length, 0);
    assert.equal((await db.query("DELETE FROM conversation_sessions WHERE id = $1 RETURNING id", [session])).rows.length, 0);
  });
});

test("original messages are append-only, ordered, and private", async () => {
  await asUser(alice, async () => {
    await db.query("INSERT INTO conversation_messages (id, session_id, role, original_text) VALUES ($1, $2, 'user', 'I think it was 1974.')", [message, session]);
    await db.query("INSERT INTO conversation_messages (session_id, role, original_text) VALUES ($1, 'user', 'Correction: it was 1975.')", [session]);
    const result = await db.query("SELECT original_text FROM conversation_messages WHERE session_id = $1 ORDER BY sequence", [session]);
    assert.deepEqual(result.rows.map((row) => row.original_text), ["I think it was 1974.", "Correction: it was 1975."]);
    await expectSqlError("UPDATE conversation_messages SET original_text = 'Rewritten' WHERE id = $1", [message], "42501");
    await expectSqlError("DELETE FROM conversation_messages WHERE id = $1", [message], "42501");
    await expectSqlError("INSERT INTO conversation_messages (session_id, role, original_text) VALUES ($1, 'user', '  ')", [session], "23514");
  });
  await asUser(bob, async () => {
    assert.equal((await db.query("SELECT * FROM conversation_messages")).rows.length, 0);
    await expectSqlError("INSERT INTO conversation_messages (session_id, role, original_text) VALUES ($1, 'user', 'Intrusion')", [session], "42501");
  });
  // Even a table owner cannot rewrite original text through UPDATE.
  await expectSqlError("UPDATE conversation_messages SET original_text = 'Rewritten' WHERE id = $1", [message], "55000");
});

test("completed sessions require end timestamps and reject new messages", async () => {
  await asUser(alice, async () => {
    await expectSqlError("UPDATE conversation_sessions SET status = 'completed' WHERE id = $1", [session], "23514");
    await db.query("UPDATE conversation_sessions SET status = 'completed', ended_at = now() WHERE id = $1", [session]);
    await expectSqlError("INSERT INTO conversation_messages (session_id, role, original_text) VALUES ($1, 'user', 'Too late')", [session], "42501");
  });
});

test("anonymous clients cannot access new relations", async () => {
  await db.exec("SET ROLE anon");
  try {
    for (const relation of ["story_projects", "conversation_sessions", "conversation_messages"]) {
      await expectSqlError(`SELECT * FROM public.${relation}`, [], "42501");
    }
  } finally { await db.exec("RESET ROLE"); }
});

test("soft-deleted projects and their sessions become inaccessible", async () => {
  await db.query("UPDATE books SET is_deleted = true WHERE id = $1", [aliceProject]);
  await asUser(alice, async () => {
    assert.equal((await db.query("SELECT * FROM story_projects WHERE id = $1", [aliceProject])).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM conversation_sessions WHERE id = $1", [session])).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM conversation_messages")).rows.length, 0);
    await expectSqlError("INSERT INTO conversation_sessions (project_id, language) VALUES ($1, 'sv')", [aliceProject], "42501");
  });
  await db.query("UPDATE books SET is_deleted = false WHERE id = $1", [aliceProject]);
});

test("deleting an owned project cascades its sessions and original messages", async () => {
  await asUser(alice, () => db.query("DELETE FROM story_projects WHERE id = $1", [aliceProject]));
  assert.equal((await db.query("SELECT * FROM conversation_sessions WHERE id = $1", [session])).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM conversation_messages WHERE session_id = $1", [session])).rows.length, 0);
  assert.equal((await db.query("SELECT * FROM books WHERE id = $1", [bobProject])).rows.length, 1);
});

test("empty-project bootstrap preserves every original migration version", async () => {
  const sql = await buildBootstrap();
  const files = (await readdir(new URL("../migrations/", import.meta.url))).filter((file) => file.endsWith(".sql"));
  for (const file of files) {
    assert.ok(sql.includes(`VALUES ('${file.slice(0, 14)}'`));
  }
  assert.equal((sql.match(/INSERT INTO supabase_migrations.schema_migrations/g) || []).length, files.length);
  assert.ok(sql.includes("Bootstrap requires an empty public schema"));
});
