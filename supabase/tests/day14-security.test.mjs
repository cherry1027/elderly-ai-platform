import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Execute the exact hosted candidate in disposable PostgreSQL. This does not
// verify hosted Auth/JWT, Edge deployment, Storage blobs/URLs, or an iPhone.
const fixtureUrl = new URL("./cloud-day14-security.sql", import.meta.url);
const owner = "ea140000-0000-4000-8000-000000000001";
const project = "ea240000-0000-4000-8000-000000000001";

async function setup() {
  const db = new PGlite();
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
    CREATE FUNCTION storage.foldername(name text) RETURNS text[]
      LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name,'/') $$;
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
  `);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    const sql = (await readFile(new URL(file,migrations),"utf8"))
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_(?:cron|net) .*;\s*$/gm,"");
    try { await db.exec(sql); }
    catch (error) { throw new Error(`Migration failed: ${file}`, { cause: error }); }
  }
  return db;
}

test("Day 14 fresh security / bilingual correction / revision boundary", async (t) => {
  const db = await setup();
  const sql = await readFile(fixtureUrl,"utf8");
  try {
    await t.test("exact rollback-only fixture verifies both owners and emits sanitized statuses/catalog counts", async () => {
      assert.match(sql,/^BEGIN;$/m);
      assert.match(sql,/^ROLLBACK;$/m);
      assert.doesNotMatch(sql,/^\s*COMMIT\s*;/m);
      assert.doesNotMatch(sql,/\b(?:net\.http_|http_post|http_get|cron\.schedule)\b/i);
      const results = await db.exec(sql);
      assert.deepEqual(results.at(-3).rows,[{
        day14_security: "PASS",identity_scope: "SQL ROLE CLAIMS ONLY",
        two_way_owner_isolation: "PASS",pending_correction_and_history: "PASS",
        failed_mutation_atomicity: "PASS",pdf_scope: "METADATA ONLY",synthetic_data: "ROLLED BACK",
      }]);
      assert.deepEqual(results.at(-2).rows,[{
        legacy_bucket_count: 3,legacy_public_bucket_count: 1,private_audio_pdf_bucket_count: 2,
      }]);
      const catalog = results.at(-1).rows[0];
      assert.equal(catalog.function_scope,"NOT EDGE DEPLOYMENT EVIDENCE");
      assert.ok(catalog.public_database_definer_count >= 19);
      // A legacy catalog finding is deliberately not converted into a blanket
      // security pass: root records the current hosted counts separately.
      assert.ok(catalog.anon_executable_database_definer_count >= 0);
    });

    await t.test("rollback leaves no synthetic rows or claim settings behind", async () => {
      for (const relation of ["auth.users","public.profiles","public.user_settings","public.books",
        "public.conversation_sessions","public.conversation_messages","public.conversation_turns",
        "public.memory_facts","public.memory_fact_revisions","public.memory_clarifications",
        "public.story_drafts","public.draft_source_memories","public.story_generation_requests",
        "public.story_edit_history","public.story_verification_results","public.story_exports"]) {
        assert.equal((await db.query(`SELECT count(*)::integer AS count FROM ${relation}`)).rows[0].count,0,relation);
      }
      assert.equal((await db.query("SELECT current_user AS role")).rows[0].role,"postgres");
      assert.equal((await db.query("SELECT nullif(current_setting('request.jwt.claim.sub',true),'') AS claim")).rows[0].claim,null);
    });

    await t.test("existing identity collision aborts before modifying data", async () => {
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'existing-day14@example.invalid')",[owner]);
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /identity collision/.test(error.message));
      await db.exec("ROLLBACK");
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM auth.users WHERE id=$1",[owner])).rows[0].count,1);
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.books")).rows[0].count,0);
      await db.query("DELETE FROM public.user_settings WHERE user_id=$1",[owner]);
      await db.query("DELETE FROM auth.users WHERE id=$1",[owner]);
    });

    await t.test("existing project collision preserves its unrelated owner", async () => {
      const third = "ec140000-0000-4000-8000-000000000003";
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'existing-day14-owner@example.invalid')",[third]);
      await db.query("INSERT INTO public.books(id,user_id,title,language) VALUES ($1,$2,'Existing fictional project','en')",[project,third]);
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /identity collision/.test(error.message));
      await db.exec("ROLLBACK");
      assert.deepEqual((await db.query("SELECT user_id,title FROM public.books WHERE id=$1",[project])).rows,[{
        user_id: third,title: "Existing fictional project",
      }]);
      await db.query("DELETE FROM public.books WHERE id=$1",[project]);
    });

    await t.test("orphan settings collision cannot be overwritten by signup trigger", async () => {
      await db.query("INSERT INTO public.user_settings(user_id,newsletter) VALUES ($1,true)",[owner]);
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /identity collision/.test(error.message));
      await db.exec("ROLLBACK");
      assert.deepEqual((await db.query("SELECT user_id,newsletter FROM public.user_settings WHERE user_id=$1",[owner])).rows,[{
        user_id: owner,newsletter: true,
      }]);
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM auth.users WHERE id=$1",[owner])).rows[0].count,0);
      await db.query("DELETE FROM public.user_settings WHERE user_id=$1",[owner]);
    });

    await t.test("catalog drift fails before fixture writes instead of producing a false security pass", async () => {
      await db.exec("ALTER TABLE public.memory_facts DISABLE ROW LEVEL SECURITY");
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /RLS catalog check failed/.test(error.message));
      await db.exec("ROLLBACK");
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM auth.users WHERE id=$1",[owner])).rows[0].count,0);
      await db.exec("ALTER TABLE public.memory_facts ENABLE ROW LEVEL SECURITY");
    });

    await t.test("unexpected anonymous core-RPC privilege is detected without invoking the function", async () => {
      await db.exec("GRANT EXECUTE ON FUNCTION public.continue_story_project(uuid) TO anon");
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /RPC ownership boundary catalog check failed/.test(error.message));
      await db.exec("ROLLBACK");
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM auth.users WHERE id=$1",[owner])).rows[0].count,0);
      await db.exec("REVOKE EXECUTE ON FUNCTION public.continue_story_project(uuid) FROM anon");
    });
  } finally { await db.close(); }
});

test("Day 14 read-only hosted alternative never requires fixture writes", async (t) => {
  const db = await setup();
  const sql = await readFile(new URL("./cloud-day14-readonly-security.sql",import.meta.url),"utf8");
  // Local setup only: populate a fictional row so read isolation is not tested
  // solely against empty tables. This setup is NOT part of the hosted batch.
  const actor = "ee140000-0000-4000-8000-000000000001";
  const ownedProject = "ee240000-0000-4000-8000-000000000001";
  await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'readonly-fixture@example.invalid')",[actor]);
  await db.query("INSERT INTO public.books(id,user_id,title,language) VALUES ($1,$2,'Existing fictional story','en')",[ownedProject,actor]);
  const snapshot = async () => (await db.query(`SELECT jsonb_build_object(
    'users',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM auth.users t),
    'profiles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.profiles t),
    'settings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id) FROM public.user_settings t),
    'books',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.books t)) AS data`)).rows[0].data;
  try {
    await t.test("exact READ ONLY batch checks catalog/claims without changing existing data", async () => {
      assert.match(sql,/^BEGIN READ ONLY;$/m);
      assert.match(sql,/^ROLLBACK;\s*$/m);
      const executable = sql.replace(/--[^\n]*/g,"");
      assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|COMMIT)\b/i);
      assert.doesNotMatch(executable,/\b(?:net\.http_|http_post|http_get|cron\.schedule)\b/i);
      const before = await snapshot();
      const results = await db.exec(sql);
      const report = results.find(result => result.rows?.[0]?.day14_readonly_security)?.rows[0];
      assert.equal(report.day14_readonly_security,"PASS");
      assert.equal(report.identity_scope,"SQL_ROLE_NOT_JWT");
      assert.equal(report.own_write_test,"NOT_RUN");
      assert.equal(report.two_real_users_test,"NOT_RUN");
      assert.equal(report.physical_iphone_test,"NOT_RUN");
      assert.equal(report.data_scope,"READ_ONLY_NO_FIXTURE_WRITES");
      assert.equal(report.rls_tables_checked,16);
      assert.equal(report.invoker_views_checked,3);
      assert.equal(report.guarded_core_rpcs_checked,19);
      assert.equal(report.existing_row_counts.projects,1);
      assert.equal(report.existing_row_counts.sessions,0);
      assert.deepEqual(report.bucket_metadata,{
        legacy_bucket_count:3,legacy_public_bucket_count:1,private_audio_pdf_bucket_count:2,
      });
      assert.equal(report.database_function_catalog.scope,"NOT_EDGE_DEPLOYMENT_EVIDENCE");
      assert.deepEqual(await snapshot(),before);
      assert.equal((await db.query("SELECT current_user AS role")).rows[0].role,"postgres");
    });

    await t.test("permissive ownership policy is detected without mutating a row", async () => {
      const before = await snapshot();
      await db.exec("CREATE POLICY day14_local_leak ON public.books FOR SELECT TO authenticated USING (true)");
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /exposed private row/.test(error.message));
      await db.exec("ROLLBACK");
      assert.deepEqual(await snapshot(),before);
      await db.exec("DROP POLICY day14_local_leak ON public.books");
    });

    await t.test("anonymous RPC grant drift is rejected before testing any identity", async () => {
      const before = await snapshot();
      await db.exec("GRANT EXECUTE ON FUNCTION public.continue_story_project(uuid) TO anon");
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /RPC grant catalog check failed/.test(error.message));
      await db.exec("ROLLBACK");
      assert.deepEqual(await snapshot(),before);
      await db.exec("REVOKE EXECUTE ON FUNCTION public.continue_story_project(uuid) FROM anon");
    });

    await t.test("nonexistent actor collision safely aborts instead of impersonating an existing owner", async () => {
      const absent = "fa140000-0000-4000-8000-000000000001";
      await db.query("INSERT INTO public.user_settings(user_id) VALUES ($1)",[absent]);
      const before = await snapshot();
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /SQL actor collision/.test(error.message));
      await db.exec("ROLLBACK");
      assert.deepEqual(await snapshot(),before);
    });
  } finally { await db.close(); }
});
