import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Offline catalog and role checks only. This engine cannot establish hosted
// Storage, Auth/JWT, deployment, backup, scheduler or provider-retention state.
let db;
const alice = "ea110000-0000-4000-8000-000000000001";
const bob = "eb110000-0000-4000-8000-000000000002";
const aliceProject = "ea210000-0000-4000-8000-000000000001";
const bobProject = "eb210000-0000-4000-8000-000000000002";
const coreTables = [
  "profiles", "books", "user_settings", "conversation_sessions",
  "conversation_messages", "audio_transcription_requests", "memory_facts",
  "memory_clarifications", "memory_fact_revisions", "conversation_turns",
  "story_drafts", "story_generation_requests", "draft_source_memories",
  "story_verification_results", "story_edit_history", "story_exports",
];
const publicViews = ["story_projects", "audio_transcripts", "conversation_message_history"];
const publicRpcNames = [
  "claim_audio_transcription", "complete_audio_transcription", "fail_audio_transcription",
  "get_conversation_turn", "append_conversation_turn", "resolve_memory_fact",
  "load_story_context", "get_story_generation", "save_story_generation", "get_story_draft",
  "list_story_drafts", "edit_story_draft", "get_story_project_verification", "list_story_edit_history",
  "load_story_export_context", "record_story_export", "get_story_export", "list_story_exports",
  "continue_story_project",
].sort();

async function asRole(role, user, operation) {
  assert.ok(["anon", "authenticated"].includes(role));
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [user ? JSON.stringify({ sub: user, role }) : "{}"]);
  try { return await operation(); }
  finally {
    await db.exec("RESET ROLE");
    await db.exec("RESET request.jwt.claim.sub");
    await db.exec("RESET request.jwt.claims");
  }
}

async function expectError(sql, params, code) {
  await assert.rejects(() => db.query(sql, params), error => error.code === code);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT COALESCE(nullif(current_setting('request.jwt.claim.sub',true),'')::uuid,
        (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid)
    $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
    CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
    CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE
      AS $$ SELECT string_to_array(name,'/') $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
  `);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    const sql = (await readFile(new URL(file, migrations), "utf8"))
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_(?:cron|net) .*;\s*$/gm, "");
    await db.exec(sql);
  }
  // Reuse the already reviewed fictional bilingual story journey. ONLY inside
  // this disposable engine, retain its rows to test deletion/retention below.
  // Never emit this transformed fixture for a hosted SQL Editor.
  const fixture = await readFile(new URL("./cloud-day11-story-journey.sql", import.meta.url), "utf8");
  assert.match(fixture, /^ROLLBACK;\n\nSELECT /m);
  await db.exec(fixture.replace(/^ROLLBACK;\n[\s\S]*$/m, "COMMIT;"));
});

after(async () => { if (db) await db.close(); });

test("Day 13: all core tables retain RLS and all public read views use invoker privileges", async () => {
  const tables = await db.query(`SELECT c.relname,c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [coreTables]);
  assert.equal(tables.rows.length, coreTables.length);
  for (const row of tables.rows) assert.equal(row.relrowsecurity, true, row.relname);
  const views = await db.query(`SELECT c.relname,c.reloptions
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [publicViews]);
  assert.equal(views.rows.length, publicViews.length);
  for (const row of views.rows) assert.ok(row.reloptions.includes("security_invoker=true"), row.relname);
});

test("Day 13: 19 public definer RPCs have fixed search paths and no anonymous execution", async () => {
  const functions = await db.query(`SELECT p.proname,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname`, [publicRpcNames]);
  assert.deepEqual(functions.rows.map(row => row.proname), publicRpcNames);
  for (const row of functions.rows) {
    assert.equal(row.prosecdef, true, row.proname);
    assert.ok(row.proconfig.includes("search_path=pg_catalog, public"), row.proname);
    assert.equal(row.anon_execute, false, row.proname);
    assert.equal(row.authenticated_execute, true, row.proname);
  }
});

test("Day 13: every public definer RPC rejects missing identity before processing input", async () => {
  const functions = await db.query(`SELECT p.proname,oidvectortypes(p.proargtypes) AS arguments
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1::text[]) ORDER BY p.proname`, [publicRpcNames]);
  for (const role of ["authenticated", "anon"]) {
    await asRole(role, null, async () => {
      for (const row of functions.rows) {
        const types = row.arguments.split(", ");
        for (const type of types) assert.ok(["uuid", "text", "integer", "bigint", "boolean", "jsonb"].includes(type), type);
        const argumentsSql = types.map(type => `NULL::${type}`).join(",");
        await expectError(`SELECT public.${row.proname}(${argumentsSql})`, [], "42501");
      }
    });
  }
});

test("Day 13: missing JWT cannot read private rows; anonymous readiness probe returns no profiles", async () => {
  const readable = ["profiles", "books", "user_settings", "conversation_sessions", "conversation_messages",
    "memory_facts", "memory_clarifications", "story_drafts", "draft_source_memories",
    "story_verification_results", "story_edit_history", "story_exports", ...publicViews];
  await asRole("authenticated", null, async () => {
    for (const relation of readable) {
      assert.deepEqual((await db.query(`SELECT * FROM public.${relation}`)).rows, [], relation);
    }
  });
  await asRole("anon", null, async () => {
    assert.deepEqual((await db.query("SELECT id FROM public.profiles")).rows, []);
    for (const relation of [...publicViews, "conversation_sessions", "conversation_messages", "memory_facts", "story_drafts", "story_exports"]) {
      await expectError(`SELECT * FROM public.${relation}`, [], "42501");
    }
  });
});

test("Day 13: table/view reads isolate owners while internal ledgers and source updates remain denied", async () => {
  for (const [actor, foreignProject, foreignActor] of [[alice, bobProject, bob], [bob, aliceProject, alice]]) {
    await asRole("authenticated", actor, async () => {
      assert.equal((await db.query("SELECT * FROM public.profiles WHERE user_id=$1", [foreignActor])).rows.length, 0);
      assert.equal((await db.query("SELECT * FROM public.user_settings WHERE user_id=$1", [foreignActor])).rows.length, 0);
      for (const relation of ["story_projects", "story_drafts", "memory_facts", "story_exports"]) {
        const column = relation === "story_projects" ? "id" : "project_id";
        assert.equal((await db.query(`SELECT * FROM public.${relation} WHERE ${column}=$1`, [foreignProject])).rows.length, 0, relation);
      }
      for (const relation of ["conversation_turns", "memory_fact_revisions", "story_generation_requests"]) {
        await expectError(`SELECT * FROM public.${relation}`, [], "42501");
      }
      for (const column of ["claim_token", "completion_token", "failure_token", "content_sha256"]) {
        await expectError(`SELECT ${column} FROM public.audio_transcription_requests`, [], "42501");
      }
      await expectError("UPDATE public.conversation_messages SET original_text='Rewritten'", [], "42501");
      await expectError("UPDATE public.story_drafts SET original_content='Rewritten'", [], "42501");
      await expectError("DELETE FROM public.memory_fact_revisions", [], "42501");
    });
  }
});

test("Day 13: legacy storage and print-order deletion constraints remain explicit release gates", async () => {
  assert.deepEqual((await db.query("SELECT id,public FROM storage.buckets ORDER BY id")).rows, [
    { id: "book-audio", public: false }, { id: "book-images", public: true }, { id: "generated-pdfs", public: false },
  ]);
  // No blobs are uploaded. Local bucket metadata does not establish hosted
  // bucket configuration, URLs, signed-link expiry or erasure of stored files.
  await db.query("INSERT INTO public.print_orders(book_id,user_id,order_type) VALUES ($1,$2,'fictional')", [aliceProject, alice]);
  await expectError("DELETE FROM public.books WHERE id=$1", [aliceProject], "23503");
  await db.query("DELETE FROM public.print_orders WHERE book_id=$1", [aliceProject]);
});

test("Day 13: Auth-user deletion alone does not erase legacy project/settings or source snapshots", async () => {
  await db.query("DELETE FROM auth.users WHERE id=$1", [alice]);
  assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.profiles WHERE user_id=$1", [alice])).rows[0].count, 0);
  for (const relation of ["books", "user_settings"]) {
    assert.equal((await db.query(`SELECT count(*)::integer AS count FROM public.${relation} WHERE user_id=$1`, [alice])).rows[0].count, 1, relation);
  }
  for (const relation of ["conversation_sessions", "story_drafts", "memory_facts", "story_exports"]) {
    assert.ok((await db.query(`SELECT count(*)::integer AS count FROM public.${relation} WHERE project_id=$1`, [aliceProject])).rows[0].count > 0, relation);
  }
  assert.ok((await db.query(`SELECT count(*)::integer AS count FROM public.draft_source_memories s
    JOIN public.story_drafts d ON d.id=s.draft_id WHERE d.project_id=$1`, [aliceProject])).rows[0].count > 0);
  // These assertions document an existing erasure gap, not an acceptable
  // complete-account-deletion implementation or authorization to delete data.
});

test("Day 13: explicit parent-project erasure cascades core rows and preserves the other owner", async () => {
  const sessionIds = (await db.query("SELECT id FROM public.conversation_sessions WHERE project_id=$1", [aliceProject])).rows.map(row => row.id);
  const draftIds = (await db.query("SELECT id FROM public.story_drafts WHERE project_id=$1", [aliceProject])).rows.map(row => row.id);
  const factIds = (await db.query("SELECT id FROM public.memory_facts WHERE project_id=$1", [aliceProject])).rows.map(row => row.id);
  assert.ok(sessionIds.length > 0 && draftIds.length > 0 && factIds.length > 0);
  await db.query("DELETE FROM public.books WHERE id=$1", [aliceProject]);
  for (const relation of ["conversation_sessions", "memory_facts", "story_drafts", "story_exports"]) {
    assert.equal((await db.query(`SELECT count(*)::integer AS count FROM public.${relation} WHERE project_id=$1`, [aliceProject])).rows[0].count, 0, relation);
  }
  for (const [relation, column, ids] of [
    ["conversation_messages", "session_id", sessionIds],
    ["conversation_turns", "session_id", sessionIds],
    ["audio_transcription_requests", "session_id", sessionIds],
    ["memory_clarifications", "session_id", sessionIds],
    ["memory_fact_revisions", "fact_id", factIds],
    ["draft_source_memories", "draft_id", draftIds],
    ["story_verification_results", "draft_id", draftIds],
    ["story_edit_history", "draft_id", draftIds],
    ["story_generation_requests", "draft_id", draftIds],
  ]) {
    assert.equal((await db.query(`SELECT count(*)::integer AS count FROM public.${relation} WHERE ${column}=ANY($1::uuid[])`, [ids])).rows[0].count, 0, relation);
  }
  // Every remaining draft/session belongs to Bob; all Alice draft sources,
  // revisions, verification reports and export metadata cascaded.
  for (const relation of ["conversation_sessions", "story_drafts"]) {
    assert.deepEqual((await db.query(`SELECT DISTINCT project_id FROM public.${relation}`)).rows, [{ project_id: bobProject }]);
  }
  await asRole("authenticated", bob, async () => {
    assert.equal((await db.query("SELECT * FROM public.story_projects")).rows.length, 1);
    assert.equal((await db.query("SELECT public.list_story_drafts($1,50,0) AS drafts", [bobProject])).rows[0].drafts.length, 2);
    assert.equal((await db.query("SELECT public.list_story_exports($1,50,0) AS exports", [bobProject])).rows[0].exports.length, 2);
  });
  // User settings have their own lifecycle and are not project children.
  assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.user_settings WHERE user_id=$1", [alice])).rows[0].count, 1);
});
