import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Fully embedded PostgreSQL: no network or hosted Supabase access.
const alice = "31100000-0000-4000-8000-000000000001";
const bob = "31100000-0000-4000-8000-000000000002";
const svProject = "31200000-0000-4000-8000-000000000001";
const enProject = "31200000-0000-4000-8000-000000000002";
const emptyProject = "31200000-0000-4000-8000-000000000003";
const bobProject = "31200000-0000-4000-8000-000000000004";
const svSession = "31300000-0000-4000-8000-000000000001";
const enSession = "31300000-0000-4000-8000-000000000002";
const svMessage = "31400000-0000-4000-8000-000000000001";
const enMessage = "31400000-0000-4000-8000-000000000002";
const svLocation = "31500000-0000-4000-8000-000000000001";
const svPendingYear = "31500000-0000-4000-8000-000000000002";
const svRejectedRelationship = "31500000-0000-4000-8000-000000000003";
const svUnsupported = "31500000-0000-4000-8000-000000000004";
const svEmotion = "31500000-0000-4000-8000-000000000005";
const enLocation = "31500000-0000-4000-8000-000000000006";
const enBirthYear = "31500000-0000-4000-8000-000000000007";
const enPaddedCorrection = "31500000-0000-4000-8000-000000000009";
const svKey = "31600000-0000-4000-8000-000000000001";
const svDedupeKey = "31600000-0000-4000-8000-000000000002";
const enKey = "31600000-0000-4000-8000-000000000003";
const enSecondKey = "31600000-0000-4000-8000-000000000004";
const conflictingYear = "31500000-0000-4000-8000-000000000008";
const conflictQuestion = "31700000-0000-4000-8000-000000000001";

async function expectSqlError(db, sql, params, code) {
  await assert.rejects(
    () => db.query(sql, params),
    (error) => error.code === code,
  );
}

async function asUser(db, userId, operation) {
  await db.exec("SET ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try {
    return await operation();
  } finally {
    await db.exec("RESET ROLE");
    await db.exec("RESET request.jwt.claim.sub");
  }
}

async function rpc(db, name, signature, params) {
  const placeholders = signature.map((type, index) => `$${index + 1}::${type}`).join(", ");
  const result = await db.query(`SELECT public.${name}(${placeholders}) AS result`, params);
  return result.rows[0].result;
}

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
      )
    $$;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects (
      id uuid DEFAULT gen_random_uuid(), bucket_id text, name text
    );
    CREATE FUNCTION storage.foldername(name text) RETURNS text[]
      LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated;
  `);
  const migrations = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrations))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    let sql = await readFile(new URL(file, migrations), "utf8");
    sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_(?:cron|net) .*;\s*$/gm, "");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration failed: ${file}: ${error.message}`, { cause: error });
    }
  }

  await db.query(`
    INSERT INTO auth.users (id, email) VALUES
      ($1, 'alice@example.test'), ($2, 'bob@example.test')
  `, [alice, bob]);
  await db.query(`
    INSERT INTO public.books (id, user_id, title, language) VALUES
      ($1, $2, 'Svenska minnen', 'sv'),
      ($3, $2, 'English memories', 'en'),
      ($4, $2, 'Empty memories', 'sv'),
      ($5, $6, 'Bob memories', 'sv')
  `, [svProject, alice, enProject, emptyProject, bobProject, bob]);
  await db.query(`
    INSERT INTO public.conversation_sessions (id, project_id, language) VALUES
      ($1, $2, 'sv'), ($3, $4, 'en')
  `, [svSession, svProject, enSession, enProject]);
  await db.query(`
    INSERT INTO public.conversation_messages (id, session_id, role, original_text)
    VALUES
      ($1, $2, 'user', 'Malmö 1974 Anna won the race glad 1975.'),
      ($3, $4, 'user', 'London born in 1945.')
  `, [svMessage, svSession, enMessage, enSession]);
  await db.query(`
    INSERT INTO public.memory_facts (
      id, project_id, session_id, source_message_id, fact_type, value,
      evidence, year, slot, uncertain, status
    ) VALUES
      ($1,$2,$3,$4,'location','Malmö','Malmö',NULL,'grew_up_location',false,'confirmed'),
      ($5,$2,$3,$4,'date','1974','1974',1974,'date',true,'pending'),
      ($6,$2,$3,$4,'relationship','Anna','Anna',NULL,'mother',false,'rejected'),
      ($7,$2,$3,$4,'event','won the race','won the race',NULL,'achievement',false,'confirmed'),
      ($8,$2,$3,$4,'emotion','glad','glad',NULL,NULL,false,'confirmed'),
      ($9,$10,$11,$12,'location','London','London',NULL,'grew_up_location',false,'confirmed'),
      ($13,$10,$11,$12,'date','1945','born in 1945',1945,'date',false,'confirmed')
  `, [
    svLocation, svProject, svSession, svMessage,
    svPendingYear, svRejectedRelationship, svUnsupported, svEmotion,
    enLocation, enProject, enSession, enMessage, enBirthYear,
  ]);
  return db;
}

test("Day 5 grounded drafts are versioned, private and auditable", async (t) => {
  const db = await setup();
  const state = {};
  try {
    await t.test("confirmed context produces a deterministic Swedish draft", async () => {
      state.svContext = await asUser(db, alice, () => rpc(
        db,
        "load_story_context",
        ["uuid"],
        [svProject],
      ));
      assert.match(state.svContext.context_token, /^[0-9a-f]{64}$/);
      assert.equal(state.svContext.confirmed_count, 3);
      assert.equal(state.svContext.source_memories.length, 2);
      assert.equal(
        state.svContext.canonical_content,
        "Jag växte upp i Malmö.\n\nJag kände mig glad.",
      );
      assert.deepEqual(
        state.svContext.excluded_memories.map(({ memory_id, reason }) => ({ memory_id, reason })),
        [
          { memory_id: svPendingYear, reason: "pending" },
          { memory_id: svRejectedRelationship, reason: "rejected" },
          { memory_id: svUnsupported, reason: "unsupported" },
        ],
      );
      state.svDraft = await asUser(db, alice, () => rpc(
        db,
        "save_story_generation",
        ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
        [
          svProject,
          svKey,
          "sv",
          "warm",
          true,
          state.svContext.context_token,
          state.svContext.canonical_content,
        ],
      ));
      assert.equal(state.svDraft.status, "ready_for_review");
      assert.equal(state.svDraft.version, 1);
      assert.equal(state.svDraft.revision, 1);
      assert.equal(state.svDraft.original_content, state.svContext.canonical_content);
      assert.equal(state.svDraft.verification.status, "passed");
      assert.equal(state.svDraft.verification.method, "deterministic_mock_v1");
      assert.equal(state.svDraft.verification.sources_current, true);
      assert.deepEqual(
        await asUser(db, alice, () => rpc(
          db,
          "get_story_draft",
          ["uuid"],
          [state.svDraft.draft_id],
        )),
        state.svDraft,
      );
    });

    await t.test("missing memories and unsupported generated content cannot pass", async () => {
      const empty = await asUser(db, alice, () => rpc(
        db,
        "load_story_context",
        ["uuid"],
        [emptyProject],
      ));
      assert.equal(empty.confirmed_count, 0);
      assert.equal(empty.canonical_content, "");
      await asUser(db, alice, async () => {
        await assert.rejects(
          () => rpc(
            db,
            "save_story_generation",
            ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
            [
              emptyProject,
              "31600000-0000-4000-8000-000000000010",
              "sv",
              "warm",
              true,
              empty.context_token,
              "Jag vann på lotteri.",
            ],
          ),
          (error) => error.code === "55000",
        );
        await assert.rejects(
          () => rpc(
            db,
            "save_story_generation",
            ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
            [
              svProject,
              "31600000-0000-4000-8000-000000000011",
              "sv",
              "warm",
              true,
              state.svContext.context_token,
              `${state.svContext.canonical_content}\n\nJag vann på lotteri.`,
            ],
          ),
          (error) => error.code === "22023",
        );
        await assert.rejects(
          () => rpc(
            db,
            "save_story_generation",
            ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
            [
              svProject,
              "31600000-0000-4000-8000-000000000012",
              null,
              "warm",
              true,
              state.svContext.context_token,
              state.svContext.canonical_content,
            ],
          ),
          (error) => error.code === "22023",
        );
      });
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM story_drafts WHERE project_id=$1", [emptyProject])).rows[0].count,
        0,
      );
    });

    await t.test("generation keys replay safely and different keys deduplicate", async () => {
      const replay = await asUser(db, alice, () => rpc(
        db,
        "save_story_generation",
        ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
        [
          svProject,
          svKey,
          "sv",
          "warm",
          false,
          state.svContext.context_token,
          state.svContext.canonical_content,
        ],
      ));
      assert.deepEqual(replay, state.svDraft);
      await asUser(db, alice, async () => {
        await assert.rejects(
          () => rpc(
            db,
            "save_story_generation",
            ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
            [
              svProject,
              svKey,
              "sv",
              "warm",
              true,
              state.svContext.context_token,
              `${state.svContext.canonical_content} changed`,
            ],
          ),
          (error) => error.code === "23505",
        );
        await assert.rejects(
          () => rpc(
            db,
            "get_story_generation",
            ["uuid", "uuid", "text", "text"],
            [svProject, svKey, "en", "warm"],
          ),
          (error) => error.code === "23505",
        );
      });
      const deduplicated = await asUser(db, alice, () => rpc(
        db,
        "save_story_generation",
        ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
        [
          svProject,
          svDedupeKey,
          "sv",
          "warm",
          true,
          state.svContext.context_token,
          state.svContext.canonical_content,
        ],
      ));
      assert.equal(deduplicated.draft_id, state.svDraft.draft_id);
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM story_drafts WHERE project_id=$1", [svProject])).rows[0].count,
        1,
      );
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM story_generation_requests WHERE project_id=$1", [svProject])).rows[0].count,
        2,
      );
    });

    await t.test("English context generates an English verified draft", async () => {
      state.enContext = await asUser(db, alice, () => rpc(
        db,
        "load_story_context",
        ["uuid"],
        [enProject],
      ));
      assert.equal(
        state.enContext.canonical_content,
        "I grew up in London.\n\nI was born in 1945.",
      );
      state.enDraft = await asUser(db, alice, () => rpc(
        db,
        "save_story_generation",
        ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
        [
          enProject,
          enKey,
          "en",
          "warm",
          true,
          state.enContext.context_token,
          state.enContext.canonical_content,
        ],
      ));
      assert.equal(state.enDraft.language, "en");
      assert.equal(state.enDraft.verification.status, "passed");
      assert.equal(state.enDraft.source_memories.length, 2);
    });

    await t.test("manual edits append history and can never auto-pass verification", async () => {
      const editedContent = `${state.svDraft.content}\n\nJag vann på lotteri.`;
      state.edited = await asUser(db, alice, () => rpc(
        db,
        "edit_story_draft",
        ["uuid", "integer", "text"],
        [state.svDraft.draft_id, 1, editedContent],
      ));
      assert.equal(state.edited.status, "edited");
      assert.equal(state.edited.revision, 2);
      assert.equal(state.edited.content, editedContent);
      assert.equal(state.edited.original_content, state.svDraft.original_content);
      assert.equal(state.edited.verification.status, "needs_review");
      assert.equal(state.edited.verification.method, "manual_unverified");
      assert.equal(state.edited.verification.sources_current, true);

      const retry = await asUser(db, alice, () => rpc(
        db,
        "edit_story_draft",
        ["uuid", "integer", "text"],
        [state.svDraft.draft_id, 1, editedContent],
      ));
      assert.deepEqual(retry, state.edited);
      await asUser(db, alice, async () => {
        await assert.rejects(
          () => rpc(
            db,
            "edit_story_draft",
            ["uuid", "integer", "text"],
            [state.svDraft.draft_id, 1, `${editedContent} stale`],
          ),
          (error) => error.code === "55000",
        );
        await expectSqlError(
          db,
          "INSERT INTO story_verification_results (draft_id,revision,status,method) VALUES ($1,2,'passed','deterministic_mock_v1')",
          [state.svDraft.draft_id],
          "42501",
        );
      });
      const history = await asUser(db, alice, () => rpc(
        db,
        "list_story_edit_history",
        ["uuid", "integer", "integer"],
        [state.svDraft.draft_id, 20, 0],
      ));
      assert.equal(history.length, 1);
      assert.equal(history[0].revision, 2);
      assert.equal(history[0].previous_content, state.svDraft.content);
      assert.equal(history[0].content, editedContent);
      await asUser(db, alice, async () => {
        await assert.rejects(
          () => rpc(
            db,
            "list_story_edit_history",
            ["uuid", "integer", "integer"],
            [state.svDraft.draft_id, 20, 100001],
          ),
          (error) => error.code === "22023",
        );
      });

      const currentReplay = await asUser(db, alice, () => rpc(
        db,
        "get_story_generation",
        ["uuid", "uuid", "text", "text"],
        [svProject, svKey, "sv", "warm"],
      ));
      assert.equal(currentReplay.revision, 2);
      assert.equal(currentReplay.content, editedContent);
      assert.equal(currentReplay.verification.status, "needs_review");
    });

    await t.test("cross-user, anonymous and direct-write access is denied", async () => {
      await asUser(db, bob, async () => {
        assert.equal((await db.query("SELECT * FROM story_drafts")).rows.length, 0);
        assert.equal((await db.query("SELECT * FROM draft_source_memories")).rows.length, 0);
        await assert.rejects(
          () => rpc(db, "load_story_context", ["uuid"], [svProject]),
          (error) => error.code === "P0002",
        );
        await assert.rejects(
          () => rpc(db, "get_story_draft", ["uuid"], [state.svDraft.draft_id]),
          (error) => error.code === "P0002",
        );
        await assert.rejects(
          () => rpc(
            db,
            "edit_story_draft",
            ["uuid", "integer", "text"],
            [state.svDraft.draft_id, 2, "Forged"],
          ),
          (error) => error.code === "P0002",
        );
      });
      await db.exec("SET ROLE anon");
      try {
        await expectSqlError(
          db,
          "SELECT load_story_context($1::uuid)",
          [svProject],
          "42501",
        );
      } finally {
        await db.exec("RESET ROLE");
      }
      await expectSqlError(
        db,
        "UPDATE story_drafts SET original_content='overwritten' WHERE id=$1",
        [state.svDraft.draft_id],
        "55000",
      );
    });

    await t.test("new conflicts make sources stale and block a fresh generation", async () => {
      await db.query(`
        INSERT INTO public.memory_facts (
          id, project_id, session_id, source_message_id, fact_type, value,
          evidence, year, slot, uncertain, status
        ) VALUES ($1,$2,$3,$4,'date','1975','1975',1975,'date',true,'confirmed')
      `, [conflictingYear, svProject, svSession, svMessage]);
      await db.query(`
        INSERT INTO public.memory_clarifications (
          id, fact_id, session_id, conflicts_with_fact_id, question
        ) VALUES ($1,$2,$3,$4,'Was it 1974 or 1975?')
      `, [conflictQuestion, conflictingYear, svSession, svPendingYear]);
      const changed = await asUser(db, alice, () => rpc(
        db,
        "load_story_context",
        ["uuid"],
        [svProject],
      ));
      assert.deepEqual(changed.blocking_clarifications, [conflictQuestion]);
      assert.notEqual(changed.context_token, state.svContext.context_token);
      const verification = await asUser(db, alice, () => rpc(
        db,
        "get_story_project_verification",
        ["uuid"],
        [svProject],
      ));
      assert.equal(verification.verification.status, "needs_review");
      assert.equal(verification.verification.method, "manual_unverified");
      assert.equal(verification.verification.sources_current, false);
      await asUser(db, alice, async () => {
        await assert.rejects(
          () => rpc(
            db,
            "save_story_generation",
            ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
            [
              svProject,
              "31600000-0000-4000-8000-000000000013",
              "sv",
              "warm",
              true,
              changed.context_token,
              changed.canonical_content,
            ],
          ),
          (error) => error.code === "55000",
        );
      });
    });

    await t.test("a full date correction supersedes the extracted birth year", async () => {
      await asUser(db, alice, () => rpc(
        db,
        "resolve_memory_fact",
        ["uuid", "text", "text", "integer"],
        [enBirthYear, "confirmed", "1975-06-05", 1],
      ));
      await db.query(`
        INSERT INTO public.memory_facts (
          id, project_id, session_id, source_message_id, fact_type, value,
          evidence, slot, uncertain, status, corrected_value
        ) VALUES ($1,$2,$3,$4,'location','London','London',
          'grew_up_location',false,'confirmed',' Paris ')
      `, [enPaddedCorrection, enProject, enSession, enMessage]);

      const corrected = await asUser(db, alice, () => rpc(
        db,
        "load_story_context",
        ["uuid"],
        [enProject],
      ));
      assert.equal(
        corrected.canonical_content,
        "I grew up in London.\n\nI remember the date 1975-06-05.",
      );
      assert.equal(corrected.canonical_content.includes("1945"), false);
      assert.deepEqual(
        corrected.excluded_memories.find(({ memory_id }) => memory_id === enPaddedCorrection),
        { memory_id: enPaddedCorrection, reason: "unsupported" },
      );
    });

    await t.test("a nonblocking context change creates a new English version", async () => {
      await asUser(db, alice, () => rpc(
        db,
        "resolve_memory_fact",
        ["uuid", "text", "text", "integer"],
        [enLocation, "rejected", null, 1],
      ));
      const oldDraft = await asUser(db, alice, () => rpc(
        db,
        "get_story_draft",
        ["uuid"],
        [state.enDraft.draft_id],
      ));
      assert.equal(oldDraft.verification.status, "stale_sources");
      assert.equal(oldDraft.verification.sources_current, false);
      const current = await asUser(db, alice, () => rpc(
        db,
        "load_story_context",
        ["uuid"],
        [enProject],
      ));
      assert.equal(current.canonical_content, "I remember the date 1975-06-05.");
      const second = await asUser(db, alice, () => rpc(
        db,
        "save_story_generation",
        ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
        [
          enProject,
          enSecondKey,
          "en",
          "warm",
          true,
          current.context_token,
          current.canonical_content,
        ],
      ));
      assert.equal(second.version, 2);
      assert.notEqual(second.draft_id, state.enDraft.draft_id);
      assert.equal(second.verification.status, "passed");
      const drafts = await asUser(db, alice, () => rpc(
        db,
        "list_story_drafts",
        ["uuid", "integer", "integer"],
        [enProject, 20, 0],
      ));
      assert.deepEqual(drafts.map((draft) => draft.version), [2, 1]);
      await asUser(db, alice, async () => {
        await assert.rejects(
          () => rpc(
            db,
            "list_story_drafts",
            ["uuid", "integer", "integer"],
            [enProject, 20, 100001],
          ),
          (error) => error.code === "22023",
        );
      });
    });

    await t.test("source erasure preserves the draft snapshot and edit audit", async () => {
      const sourceIds = state.edited.source_memories.map((source) => source.memory_id);
      await asUser(db, alice, () => db.query(
        "DELETE FROM conversation_sessions WHERE id=$1",
        [svSession],
      ));
      const preserved = await asUser(db, alice, () => rpc(
        db,
        "get_story_draft",
        ["uuid"],
        [state.svDraft.draft_id],
      ));
      assert.deepEqual(preserved.source_memories.map((source) => source.memory_id), sourceIds);
      assert.equal(preserved.original_content, state.svDraft.original_content);
      assert.equal(preserved.content, state.edited.content);
      assert.equal(preserved.verification.status, "needs_review");
      assert.equal(preserved.verification.sources_current, false);
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM draft_source_memories WHERE draft_id=$1 AND memory_id IS NULL", [state.svDraft.draft_id])).rows[0].count,
        2,
      );
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM story_edit_history WHERE draft_id=$1", [state.svDraft.draft_id])).rows[0].count,
        1,
      );

      await asUser(db, alice, () => db.query(
        "DELETE FROM story_projects WHERE id=$1",
        [svProject],
      ));
      assert.equal((await db.query("SELECT * FROM story_drafts WHERE id=$1", [state.svDraft.draft_id])).rows.length, 0);
      assert.equal((await db.query("SELECT * FROM story_edit_history WHERE draft_id=$1", [state.svDraft.draft_id])).rows.length, 0);
    });

    await t.test("rollback-only hosted verification SQL also passes locally", async () => {
      const cloudVerification = await readFile(
        new URL("./cloud-story-drafts.sql", import.meta.url),
        "utf8",
      );
      await db.exec(cloudVerification);

      assert.equal(
        (await db.query(`
          SELECT count(*)::integer AS count
          FROM auth.users
          WHERE id IN (
            'a5100000-0000-4000-8000-000000000001',
            'b5100000-0000-4000-8000-000000000002'
          )
        `)).rows[0].count,
        0,
      );
      assert.equal(
        (await db.query(`
          SELECT count(*)::integer AS count
          FROM public.books
          WHERE id IN (
            'a5200000-0000-4000-8000-000000000001',
            'b5200000-0000-4000-8000-000000000002'
          )
        `)).rows[0].count,
        0,
      );
    });
  } finally {
    await db.close();
  }
});
