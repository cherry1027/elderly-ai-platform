import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Actual migration/RLS/RPC execution in isolated PostgreSQL, not hosted Auth or PDF rendering.
const owner = "ea110000-0000-4000-8000-000000000001";
const project = "ea210000-0000-4000-8000-000000000001";
const fixtureSql = new URL("./cloud-day11-story-journey.sql", import.meta.url);

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

test("Day 11 reviewed story / revision export / continued memory journey", async (t) => {
  const db = await setup();
  const sql = await readFile(fixtureSql,"utf8");
  try {
    await t.test("exact rollback SQL verifies both languages, selected old revisions and explicit new generations", async () => {
      assert.match(sql,/^BEGIN;$/m);
      assert.match(sql,/^ROLLBACK;$/m);
      assert.doesNotMatch(sql,/^\s*COMMIT\s*;/m);
      const results = await db.exec(sql);
      assert.deepEqual(results.at(-1).rows,[{
        day11_bilingual_story_journey: "PASS",
        unsafe_generation: "BLOCKED",
        retry_and_stale_revision: "PASS",
        old_export_and_history: "PRESERVED",
        explicit_continue_generation: "PASS",
        two_way_owner_isolation: "PASS",
        pdf_scope: "METADATA ONLY",
        synthetic_data: "ROLLED BACK",
      }]);
    });

    await t.test("rollback removes all synthetic identities, original sources, revisions and export metadata", async () => {
      for (const relation of ["auth.users","public.profiles","public.user_settings","public.books",
        "public.conversation_sessions","public.conversation_messages","public.conversation_turns",
        "public.memory_facts","public.memory_fact_revisions","public.memory_clarifications",
        "public.story_drafts","public.draft_source_memories","public.story_generation_requests",
        "public.story_edit_history","public.story_verification_results","public.story_exports"]) {
        assert.equal((await db.query(`SELECT count(*)::integer AS count FROM ${relation}`)).rows[0].count,0,relation);
      }
    });

    await t.test("collision guard rejects an existing identity before any fixture writes", async () => {
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'existing-fictional@example.invalid')",[owner]);
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /identity collision/.test(error.message));
      await db.exec("ROLLBACK");
      assert.deepEqual((await db.query("SELECT id,email FROM auth.users")).rows,[{
        id: owner,email: "existing-fictional@example.invalid",
      }]);
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.books")).rows[0].count,0);
    });

    await t.test("collision guard also preserves an existing project without modifying its owner", async () => {
      // Use a third identity so the project guard, not the identity guard, is exercised.
      const third = "ec110000-0000-4000-8000-000000000003";
      await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'existing-project-owner@example.invalid')",[third]);
      await db.query("INSERT INTO public.books(id,user_id,title,language) VALUES ($1,$2,'Existing fictional project','en')",[project,third]);
      await db.query("DELETE FROM auth.users WHERE id=$1",[owner]);
      await assert.rejects(() => db.exec(sql),error => error.code === "P0001" && /identity collision/.test(error.message));
      await db.exec("ROLLBACK");
      assert.deepEqual((await db.query("SELECT user_id,title FROM public.books WHERE id=$1",[project])).rows,[{
        user_id: third,title: "Existing fictional project",
      }]);
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.story_drafts")).rows[0].count,0);
      assert.equal((await db.query("SELECT count(*)::integer AS count FROM public.story_exports")).rows[0].count,0);
    });
  } finally { await db.close(); }
});
