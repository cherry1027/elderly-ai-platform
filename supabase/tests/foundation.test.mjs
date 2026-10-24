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
const day3Project = "a5000000-0000-4000-8000-000000000005";
const day3OtherProject = "a6000000-0000-4000-8000-000000000006";
const day3Session = "c5000000-0000-4000-8000-000000000005";
const day3Key = "e5000000-0000-4000-8000-000000000005";
const day3Hash = "a".repeat(64);
let day3Request;
let day3Claim;

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
    await expectSqlError("UPDATE conversation_sessions SET project_id = $1 WHERE id = $2", [bobProject, session], "55000");
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

test("one owner can create multiple active story projects", async () => {
  const firstProject = "a1000000-0000-4000-8000-000000000001";
  const secondProject = "a2000000-0000-4000-8000-000000000002";

  await asUser(alice, async () => {
    await db.query(`
      INSERT INTO story_projects (id, user_id, title, language)
      VALUES ($1, $2, 'Family memories', 'sv'), ($3, $2, 'My travels', 'en')
    `, [firstProject, alice, secondProject]);

    const projects = await db.query(`
      SELECT id, status FROM story_projects
      WHERE id IN ($1, $2)
      ORDER BY id
    `, [firstProject, secondProject]);
    assert.deepEqual(projects.rows, [
      { id: firstProject, status: "draft" },
      { id: secondProject, status: "draft" },
    ]);

    await db.query("DELETE FROM story_projects WHERE id IN ($1, $2)", [firstProject, secondProject]);
  });
});

test("generated edits stay separate from session-scoped original transcripts", async () => {
  const sourceProject = "a3000000-0000-4000-8000-000000000003";
  const otherProject = "a4000000-0000-4000-8000-000000000004";
  const sourceSession = "c3000000-0000-4000-8000-000000000003";
  const otherSession = "c4000000-0000-4000-8000-000000000004";
  const sourceMessage = "d3000000-0000-4000-8000-000000000003";
  const otherMessage = "d4000000-0000-4000-8000-000000000004";

  await asUser(alice, async () => {
    await db.query(`
      INSERT INTO story_projects (id, user_id, title, language)
      VALUES ($1, $2, 'Childhood source', 'sv'), ($3, $2, 'Travel source', 'en')
    `, [sourceProject, alice, otherProject]);
    await db.query(`
      INSERT INTO conversation_sessions (id, project_id, language)
      VALUES ($1, $2, 'sv'), ($3, $4, 'en')
    `, [sourceSession, sourceProject, otherSession, otherProject]);
    await db.query(`
      INSERT INTO conversation_messages (id, session_id, role, original_text)
      VALUES ($1, $2, 'user', 'Original childhood account.'),
             ($3, $4, 'user', 'Original travel account.')
    `, [sourceMessage, sourceSession, otherMessage, otherSession]);
    await db.query(`
      INSERT INTO conversation_messages (session_id, role, original_text)
      VALUES ($1, 'user', 'Correction to the childhood account.')
    `, [sourceSession]);

    await db.query(`
      INSERT INTO pages (book_id, page_number, content)
      VALUES ($1, 1, 'First generated draft')
    `, [sourceProject]);
    const story = await db.query(`
      INSERT INTO stories (user_id, title, content)
      VALUES ($1, 'Generated story', 'First generated story')
      RETURNING id
    `, [alice]);
    await db.query("UPDATE pages SET content = 'Edited generated page' WHERE book_id = $1", [sourceProject]);
    await db.query("UPDATE stories SET content = 'Edited generated story' WHERE id = $1", [story.rows[0].id]);

    assert.equal(
      (await db.query("SELECT content FROM pages WHERE book_id = $1", [sourceProject])).rows[0].content,
      "Edited generated page",
    );
    assert.equal(
      (await db.query("SELECT content FROM stories WHERE id = $1", [story.rows[0].id])).rows[0].content,
      "Edited generated story",
    );
    assert.deepEqual(
      (await db.query(`
        SELECT original_text FROM conversation_messages
        WHERE session_id = $1 ORDER BY sequence
      `, [sourceSession])).rows,
      [
        { original_text: "Original childhood account." },
        { original_text: "Correction to the childhood account." },
      ],
    );
    assert.deepEqual(
      (await db.query("SELECT id, original_text FROM conversation_messages WHERE session_id = $1", [otherSession])).rows,
      [{ id: otherMessage, original_text: "Original travel account." }],
    );

    await db.query("DELETE FROM stories WHERE id = $1", [story.rows[0].id]);
    await db.query("DELETE FROM story_projects WHERE id IN ($1, $2)", [sourceProject, otherProject]);
  });
});

test("transcription persistence protects session provenance and direct mutations", async () => {
  await asUser(alice, async () => {
    await db.query(`
      INSERT INTO story_projects (id, user_id, title, language)
      VALUES ($1, $2, 'Audio memories', 'sv'), ($3, $2, 'Other project', 'sv')
    `, [day3Project, alice, day3OtherProject]);
    await db.query(`
      INSERT INTO conversation_sessions (id, project_id, language)
      VALUES ($1, $2, 'sv')
    `, [day3Session, day3Project]);

    await expectSqlError(
      "UPDATE conversation_sessions SET language = 'en' WHERE id = $1",
      [day3Session], "55000",
    );
    await expectSqlError(
      "UPDATE conversation_sessions SET project_id = $1 WHERE id = $2",
      [day3OtherProject, day3Session], "55000",
    );
    await expectSqlError(`
      INSERT INTO audio_transcription_requests (
        user_id, session_id, idempotency_key, content_sha256, language,
        claim_token, lease_expires_at
      ) VALUES ($1, $2, $3, $4, 'sv', gen_random_uuid(), now() + interval '2 minutes')
    `, [alice, day3Session, day3Key, day3Hash], "42501");
    await expectSqlError(
      "SELECT claim_token FROM audio_transcription_requests WHERE session_id = $1",
      [day3Session], "42501",
    );
  });

  await db.exec("SET ROLE anon");
  try {
    await expectSqlError("SELECT * FROM audio_transcripts", [], "42501");
    await expectSqlError(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, day3Key, day3Hash], "42501",
    );
  } finally {
    await db.exec("RESET ROLE");
  }
});

test("transcription claim binds owner, session, hash, language, and lease", async () => {
  await asUser(bob, async () => {
    await expectSqlError(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, day3Key, day3Hash], "P0002",
    );
  });

  await asUser(alice, async () => {
    await expectSqlError(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3OtherProject, day3Session, day3Key, day3Hash], "P0002",
    );
    await expectSqlError(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'en')",
      [day3Project, day3Session, day3Key, day3Hash], "22023",
    );
    await expectSqlError(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, 'not-a-hash', 'sv')",
      [day3Project, day3Session, day3Key], "22023",
    );

    const claimed = (await db.query(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, day3Key, day3Hash],
    )).rows[0];
    assert.equal(claimed.outcome, "claimed");
    assert.equal(claimed.status, "processing");
    assert.equal(claimed.session_id, day3Session);
    assert.equal(claimed.language, "sv");
    assert.equal(claimed.attempt_count, 1);
    assert.ok(claimed.request_id && claimed.claim_token);
    day3Request = claimed.request_id;
    day3Claim = claimed.claim_token;

    const duplicate = (await db.query(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, day3Key, day3Hash],
    )).rows[0];
    assert.equal(duplicate.outcome, "in_progress");
    assert.equal(duplicate.request_id, day3Request);
    assert.equal(duplicate.claim_token, null);
    assert.equal(duplicate.attempt_count, 1);

    await expectSqlError(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, day3Key, "b".repeat(64)], "23505",
    );
    await expectSqlError(
      "UPDATE audio_transcription_requests SET status = 'failed' WHERE session_id = $1",
      [day3Session], "42501",
    );
  });

  const lease = (await db.query(`
    SELECT extract(epoch FROM (lease_expires_at - created_at)) AS seconds
    FROM audio_transcription_requests WHERE id = $1
  `, [day3Request])).rows[0].seconds;
  assert.ok(lease >= 119 && lease <= 121);
});

test("completion and failure RPCs reject cross-user and anonymous callers", async () => {
  await asUser(bob, async () => {
    await expectSqlError(
      "SELECT * FROM complete_audio_transcription($1, $2, 'Forged transcript')",
      [day3Request, day3Claim], "P0002",
    );
    await expectSqlError(
      "SELECT * FROM fail_audio_transcription($1, $2, 'PROVIDER_UNAVAILABLE')",
      [day3Request, day3Claim], "P0002",
    );
  });

  await db.exec("SET ROLE anon");
  try {
    await expectSqlError(
      "SELECT * FROM complete_audio_transcription($1, $2, 'Anonymous transcript')",
      [day3Request, day3Claim], "42501",
    );
    await expectSqlError(
      "SELECT * FROM fail_audio_transcription($1, $2, 'PROVIDER_UNAVAILABLE')",
      [day3Request, day3Claim], "42501",
    );
  } finally {
    await db.exec("RESET ROLE");
  }
});

test("completion appends exactly one immutable audio transcript", async () => {
  const transcriptText = "Jag föddes i Malmö.";

  await asUser(alice, async () => {
    await db.query(`
      INSERT INTO conversation_messages (session_id, role, original_text)
      VALUES ($1, 'user', 'Typed correction, not audio.')
    `, [day3Session]);

    await expectSqlError(
      "SELECT * FROM complete_audio_transcription($1, $2, $3)",
      [day3Request, day3Claim, "x".repeat(32001)], "22001",
    );

    const completed = (await db.query(
      "SELECT * FROM complete_audio_transcription($1, $2, $3)",
      [day3Request, day3Claim, transcriptText],
    )).rows[0];
    assert.deepEqual(Object.keys(completed).sort(), [
      "created_at", "language", "session_id", "status", "text", "transcript_id",
    ]);
    assert.equal(completed.session_id, day3Session);
    assert.equal(completed.language, "sv");
    assert.equal(completed.text, transcriptText);
    assert.equal(completed.status, "completed");

    const replay = (await db.query(
      "SELECT * FROM complete_audio_transcription($1, $2, $3)",
      [day3Request, day3Claim, transcriptText],
    )).rows[0];
    assert.equal(replay.transcript_id, completed.transcript_id);
    await expectSqlError(
      "SELECT * FROM complete_audio_transcription($1, gen_random_uuid(), $2)",
      [day3Request, transcriptText], "55000",
    );
    await expectSqlError(
      "SELECT * FROM complete_audio_transcription($1, $2, 'Rewritten')",
      [day3Request, day3Claim], "23505",
    );

    const claimedAgain = (await db.query(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, day3Key, day3Hash],
    )).rows[0];
    assert.equal(claimedAgain.outcome, "completed");
    assert.equal(claimedAgain.transcript_id, completed.transcript_id);
    assert.equal(claimedAgain.text, transcriptText);

    const transcripts = (await db.query(`
      SELECT transcript_id, session_id, language, text, status, created_at
      FROM audio_transcripts WHERE session_id = $1
    `, [day3Session])).rows;
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].transcript_id, completed.transcript_id);
    assert.equal(transcripts[0].text, transcriptText);
    await expectSqlError(
      "UPDATE conversation_messages SET original_text = 'Overwritten' WHERE id = $1",
      [completed.transcript_id], "42501",
    );
    await expectSqlError(
      "DELETE FROM conversation_messages WHERE id = $1",
      [completed.transcript_id], "42501",
    );
  });

  await asUser(bob, async () => {
    assert.equal((await db.query("SELECT * FROM audio_transcripts")).rows.length, 0);
  });
});

test("failed and stale transcription claims retry without duplicate messages", async () => {
  const failedKey = "e6000000-0000-4000-8000-000000000006";
  const staleKey = "e7000000-0000-4000-8000-000000000007";
  let failedRequest;
  let failedClaim;
  let messageCount;

  await asUser(alice, async () => {
    messageCount = (await db.query(
      "SELECT count(*)::int AS count FROM conversation_messages WHERE session_id = $1",
      [day3Session],
    )).rows[0].count;
    const claimed = (await db.query(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, failedKey, "c".repeat(64)],
    )).rows[0];
    failedRequest = claimed.request_id;
    failedClaim = claimed.claim_token;

    const failed = (await db.query(
      "SELECT * FROM fail_audio_transcription($1, $2, 'PROVIDER_UNAVAILABLE')",
      [failedRequest, failedClaim],
    )).rows[0];
    assert.equal(failed.status, "failed");
    assert.equal((await db.query(
      "SELECT count(*)::int AS count FROM conversation_messages WHERE session_id = $1",
      [day3Session],
    )).rows[0].count, messageCount);
    assert.equal((await db.query(
      "SELECT count(*)::int AS count FROM audio_transcripts WHERE session_id = $1",
      [day3Session],
    )).rows[0].count, 1);

    const failedReplay = (await db.query(
      "SELECT * FROM fail_audio_transcription($1, $2, 'PROVIDER_UNAVAILABLE')",
      [failedRequest, failedClaim],
    )).rows[0];
    assert.equal(failedReplay.status, "failed");

    const retried = (await db.query(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, failedKey, "c".repeat(64)],
    )).rows[0];
    assert.equal(retried.outcome, "claimed");
    assert.equal(retried.attempt_count, 2);
    assert.notEqual(retried.claim_token, failedClaim);
    await expectSqlError(
      "SELECT * FROM complete_audio_transcription($1, $2, 'Stale result')",
      [failedRequest, failedClaim], "55000",
    );
    await db.query(
      "SELECT * FROM complete_audio_transcription($1, $2, 'Successful retry')",
      [failedRequest, retried.claim_token],
    );

    const stale = (await db.query(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, staleKey, "d".repeat(64)],
    )).rows[0];
    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE audio_transcription_requests SET lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [stale.request_id],
    );
    await db.exec("SET ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [alice]);
    await expectSqlError(
      "SELECT * FROM complete_audio_transcription($1, $2, 'Late stale result')",
      [stale.request_id, stale.claim_token], "55000",
    );
    await expectSqlError(
      "SELECT * FROM fail_audio_transcription($1, $2, 'PROVIDER_UNAVAILABLE')",
      [stale.request_id, stale.claim_token], "55000",
    );
    const reclaimed = (await db.query(
      "SELECT * FROM claim_audio_transcription($1, $2, $3, $4, 'sv')",
      [day3Project, day3Session, staleKey, "d".repeat(64)],
    )).rows[0];
    assert.equal(reclaimed.attempt_count, 2);
    assert.notEqual(reclaimed.claim_token, stale.claim_token);
    await expectSqlError(
      "SELECT * FROM complete_audio_transcription($1, $2, 'Late stale result')",
      [stale.request_id, stale.claim_token], "55000",
    );
    await db.query(
      "SELECT * FROM fail_audio_transcription($1, $2, 'PROVIDER_UNAVAILABLE')",
      [stale.request_id, reclaimed.claim_token],
    );
  });
});

test("completed sessions reject new audio claims and project deletion erases ledger", async () => {
  await asUser(alice, async () => {
    await db.query(`
      UPDATE conversation_sessions
      SET status = 'completed', ended_at = now()
      WHERE id = $1
    `, [day3Session]);
    await expectSqlError(
      "SELECT * FROM claim_audio_transcription($1, $2, gen_random_uuid(), $3, 'sv')",
      [day3Project, day3Session, "e".repeat(64)], "55000",
    );
    await db.query("DELETE FROM story_projects WHERE id IN ($1, $2)", [day3Project, day3OtherProject]);
  });

  assert.equal((await db.query(
    "SELECT count(*)::int AS count FROM audio_transcription_requests WHERE session_id = $1",
    [day3Session],
  )).rows[0].count, 0);
  assert.equal((await db.query(
    "SELECT count(*)::int AS count FROM conversation_messages WHERE session_id = $1",
    [day3Session],
  )).rows[0].count, 0);
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
