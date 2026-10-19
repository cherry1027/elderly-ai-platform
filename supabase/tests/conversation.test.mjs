import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Isolated PostgreSQL only: this suite never connects to a Supabase project.
const alice = "14100000-0000-4000-8000-000000000001";
const bob = "14100000-0000-4000-8000-000000000002";
const aliceProject = "14200000-0000-4000-8000-000000000001";
const aliceEnglishProject = "14200000-0000-4000-8000-000000000002";
const bobProject = "14200000-0000-4000-8000-000000000003";
const aliceSession = "14300000-0000-4000-8000-000000000001";
const aliceOtherSession = "14300000-0000-4000-8000-000000000002";
const aliceEnglishSession = "14300000-0000-4000-8000-000000000003";
const bobSession = "14300000-0000-4000-8000-000000000004";
const aliceSource = "14400000-0000-4000-8000-000000000001";
const aliceAssistant = "14400000-0000-4000-8000-000000000002";
const otherSource = "14400000-0000-4000-8000-000000000003";
const orphanSource = "14400000-0000-4000-8000-000000000004";
const typedKey = "14500000-0000-4000-8000-000000000001";
const englishKey = "14500000-0000-4000-8000-000000000002";
const sourceKey = "14500000-0000-4000-8000-000000000003";
const bobKey = "14500000-0000-4000-8000-000000000004";

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

async function currentSequence(db, sessionId) {
  const result = await db.query(`
    SELECT COALESCE(max(sequence), 0)::bigint AS sequence
    FROM public.conversation_messages WHERE session_id = $1
  `, [sessionId]);
  return Number(result.rows[0].sequence);
}

async function currentContext(db, sessionId) {
  const result = await db.query(`
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object('id', f.id::text, 'version', f.version)
        ORDER BY f.id
      ) FILTER (WHERE f.id IS NOT NULL),
      '[]'::jsonb
    ) AS context
    FROM public.conversation_sessions AS s
    LEFT JOIN public.memory_facts AS f
      ON f.project_id = s.project_id AND f.status <> 'rejected'
    WHERE s.id = $1
  `, [sessionId]);
  return result.rows[0].context;
}

async function appendTurn(db, {
  sessionId,
  key,
  text,
  language,
  sourceMessageId = null,
  expectedSequence,
  assistantText = "Thank you for sharing.",
  facts = [],
  contextVersions,
}) {
  const context = contextVersions ?? await currentContext(db, sessionId);
  const result = await db.query(`
    SELECT public.append_conversation_turn(
      $1::uuid, $2::uuid, $3::text, $4::text, $5::uuid,
      $6::bigint, $7::text, $8::jsonb, $9::jsonb
    ) AS result
  `, [
    sessionId,
    key,
    text,
    language,
    sourceMessageId,
    expectedSequence,
    assistantText,
    JSON.stringify(facts),
    JSON.stringify(context),
  ]);
  return result.rows[0].result;
}

async function getTurn(db, { sessionId, key, text, language, sourceMessageId = null }) {
  const result = await db.query(`
    SELECT public.get_conversation_turn(
      $1::uuid, $2::uuid, $3::text, $4::text, $5::uuid
    ) AS result
  `, [sessionId, key, text, language, sourceMessageId]);
  return result.rows[0].result;
}

async function resolveFact(db, factId, status, correctedValue, expectedVersion) {
  const result = await db.query(`
    SELECT public.resolve_memory_fact(
      $1::uuid, $2::text, $3::text, $4::integer
    ) AS result
  `, [factId, status, correctedValue, expectedVersion]);
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
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb DEFAULT '{}'
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
      ($1, $2, 'Alice Swedish', 'sv'),
      ($3, $2, 'Alice English', 'en'),
      ($4, $5, 'Bob Swedish', 'sv')
  `, [aliceProject, alice, aliceEnglishProject, bobProject, bob]);
  await db.query(`
    INSERT INTO public.conversation_sessions (id, project_id, language) VALUES
      ($1, $2, 'sv'), ($3, $2, 'sv'), ($4, $5, 'en'), ($6, $7, 'sv')
  `, [
    aliceSession,
    aliceProject,
    aliceOtherSession,
    aliceEnglishSession,
    aliceEnglishProject,
    bobSession,
    bobProject,
  ]);
  await db.query(`
    INSERT INTO public.conversation_messages (id, session_id, role, original_text)
    VALUES
      ($1, $2, 'user', 'Jag föddes i Malmö.'),
      ($3, $2, 'assistant', 'Tack för att du berättar.'),
      ($4, $5, 'user', 'Jag arbetade i Uppsala.'),
      ($6, $5, 'user', 'Detta original ska lämnas orört.')
  `, [
    aliceSource,
    aliceSession,
    aliceAssistant,
    otherSource,
    aliceOtherSession,
    orphanSource,
  ]);
  return db;
}

test("Day 4 conversation persistence is atomic, private and replay-safe", async (t) => {
  const db = await setup();
  const state = {};
  try {
    await t.test("history is invoker-secured and direct ledgers stay private", async () => {
      const view = await db.query(`
        SELECT reloptions FROM pg_class
        WHERE oid = 'public.conversation_message_history'::regclass
      `);
      assert.ok(view.rows[0].reloptions.includes("security_invoker=true"));

      await asUser(db, bob, async () => {
        assert.equal((await db.query("SELECT * FROM conversation_message_history")).rows.length, 0);
        assert.equal((await db.query("SELECT * FROM memory_facts")).rows.length, 0);
        assert.equal((await db.query("SELECT * FROM memory_clarifications")).rows.length, 0);
        await expectSqlError(
          db,
          "INSERT INTO conversation_turns (user_id, session_id, idempotency_key, request_text, request_language, expected_sequence, result) VALUES ($1,$2,$3,'x','sv',0,'{}')",
          [bob, bobSession, bobKey],
          "42501",
        );
      });

      await db.exec("SET ROLE anon");
      try {
        await expectSqlError(db, "SELECT * FROM conversation_message_history", [], "42501");
        await expectSqlError(
          db,
          "SELECT get_conversation_turn($1::uuid,$2::uuid,'x','sv',NULL::uuid)",
          [aliceSession, typedKey],
          "42501",
        );
        await expectSqlError(
          db,
          "SELECT append_conversation_turn($1::uuid,$2::uuid,'x','sv',NULL::uuid,0,'x','[]'::jsonb,'[]'::jsonb)",
          [aliceSession, typedKey],
          "42501",
        );
        await expectSqlError(
          db,
          "SELECT resolve_memory_fact($1::uuid,'confirmed',NULL::text,1)",
          [aliceSource],
          "42501",
        );
      } finally {
        await db.exec("RESET ROLE");
      }
    });

    await t.test("typed Swedish turn returns exact resources and replays once", async () => {
      const text = "I was born in Malmö in 1974 and felt glad.";
      const facts = [
        {
          fact_type: "location",
          value: "Malmö",
          evidence: "born in Malmö",
          slot: "birthplace",
          uncertain: false,
        },
        {
          fact_type: "date",
          value: "1974",
          evidence: "in 1974",
          year: 1974,
          slot: "birth_year",
          uncertain: true,
          clarification_question: "Was 1974 the correct year?",
        },
        {
          fact_type: "emotion",
          value: "glad",
          evidence: "felt glad",
          uncertain: false,
        },
      ];
      state.typed = await asUser(db, alice, () => appendTurn(db, {
        sessionId: aliceSession,
        key: typedKey,
        text,
        language: "sv",
        expectedSequence: 2,
        assistantText: "Thank you. Was 1974 the correct year?",
        facts,
      }));
      assert.deepEqual(Object.keys(state.typed).sort(), [
        "clarifications",
        "memories",
        "message",
        "mode",
        "requires_clarification",
        "user_message",
      ]);
      assert.equal(state.typed.mode, "mock");
      assert.equal(state.typed.user_message.language, "sv");
      assert.equal(state.typed.memories.length, 3);
      assert.equal(state.typed.clarifications.length, 1);
      assert.equal(state.typed.requires_clarification, true);
      [state.locationFact, state.dateFact, state.emotionFact] = state.typed.memories;

      const replay = await asUser(db, alice, () => appendTurn(db, {
        sessionId: aliceSession,
        key: typedKey,
        text,
        language: "sv",
        expectedSequence: 0,
        assistantText: "Ignored replay output",
        facts: [],
        contextVersions: [],
      }));
      assert.deepEqual(replay, state.typed);
      assert.deepEqual(
        await asUser(db, alice, () => getTurn(db, {
          sessionId: aliceSession,
          key: typedKey,
          text,
          language: "sv",
        })),
        state.typed,
      );
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM conversation_messages WHERE session_id=$1", [aliceSession])).rows[0].count,
        4,
      );
    });

    await t.test("bound keys, context sequence and fact grounding fail atomically", async () => {
      const before = (await db.query(
        "SELECT count(*)::integer AS count FROM conversation_messages WHERE session_id=$1",
        [aliceSession],
      )).rows[0].count;
      await asUser(db, alice, async () => {
        await expectSqlError(
          db,
          "SELECT get_conversation_turn($1::uuid,$2::uuid,'different','sv',NULL::uuid)",
          [aliceSession, typedKey],
          "23505",
        );
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000010",
            text: "A fresh memory.",
            language: "sv",
            expectedSequence: 2,
          }),
          (error) => error.code === "55000",
        );
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000011",
            text: "I lived in Malmö in 1974.",
            language: "sv",
            expectedSequence: state.typed.message.sequence,
            facts: [{
              fact_type: "location",
              value: "Oslo",
              evidence: "Malmö",
              uncertain: false,
            }],
          }),
          (error) => error.code === "22023",
        );
        await assert.rejects(
          () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000012",
            text: "It was 1974.",
            language: "sv",
            expectedSequence: state.typed.message.sequence,
            facts: [{
              fact_type: "date",
              value: "1974",
              evidence: "It was",
              year: 1974,
              uncertain: true,
            }],
          }),
          (error) => error.code === "22023",
        );
      });
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM conversation_messages WHERE session_id=$1", [aliceSession])).rows[0].count,
        before,
      );
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM conversation_turns WHERE session_id=$1", [aliceSession])).rows[0].count,
        1,
      );
    });

    await t.test("English, referenced-source and two-user ownership paths are isolated", async () => {
      const english = await asUser(db, alice, () => appendTurn(db, {
        sessionId: aliceEnglishSession,
        key: englishKey,
        text: "I remember the red house.",
        language: "en",
        expectedSequence: 0,
        assistantText: "Thank you for sharing that memory.",
      }));
      assert.equal(english.message.language, "en");

      const sourceCount = (await db.query(
        "SELECT count(*)::integer AS count FROM conversation_messages WHERE session_id=$1",
        [aliceOtherSession],
      )).rows[0].count;
      state.contextBeforeSourceTurn = await asUser(
        db,
        alice,
        () => currentContext(db, aliceSession),
      );
      state.sourceTurn = await asUser(db, alice, async () => appendTurn(db, {
        sessionId: aliceOtherSession,
        key: sourceKey,
        text: "Jag arbetade i Uppsala.",
        language: "sv",
        sourceMessageId: otherSource,
        expectedSequence: await currentSequence(db, aliceOtherSession),
        assistantText: "Tack för att du delar det minnet.",
        facts: [{
          fact_type: "location",
          value: "Uppsala",
          evidence: "arbetade i Uppsala",
          slot: "work_location",
          uncertain: false,
        }],
      }));
      assert.equal(state.sourceTurn.user_message.id, otherSource);
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM conversation_messages WHERE session_id=$1", [aliceOtherSession])).rows[0].count,
        sourceCount + 1,
      );

      await asUser(db, alice, async () => {
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000018",
            text: "A concurrent project memory.",
            language: "sv",
            expectedSequence: await currentSequence(db, aliceSession),
            contextVersions: state.contextBeforeSourceTurn,
          }),
          (error) => error.code === "55000",
        );
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000019",
            text: "I was born in Malmö in 1974 and felt glad.",
            language: "sv",
            sourceMessageId: state.typed.user_message.id,
            expectedSequence: await currentSequence(db, aliceSession),
          }),
          (error) => error.code === "23505",
        );
      });

      await asUser(db, alice, async () => {
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000013",
            text: "Jag arbetade i Uppsala.",
            language: "sv",
            sourceMessageId: otherSource,
            expectedSequence: await currentSequence(db, aliceSession),
          }),
          (error) => error.code === "P0002",
        );
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceOtherSession,
            key: "14500000-0000-4000-8000-000000000014",
            text: "Jag arbetade i Uppsala.",
            language: "sv",
            sourceMessageId: otherSource,
            expectedSequence: await currentSequence(db, aliceOtherSession),
          }),
          (error) => error.code === "23505",
        );
      });

      const bobTurn = await asUser(db, bob, () => appendTurn(db, {
        sessionId: bobSession,
        key: bobKey,
        text: "Bob bodde i Lund.",
        language: "sv",
        expectedSequence: 0,
        facts: [{
          fact_type: "location",
          value: "Lund",
          evidence: "bodde i Lund",
          uncertain: false,
        }],
      }));
      state.bobFact = bobTurn.memories[0];
      await asUser(db, bob, async () => {
        assert.equal((await db.query("SELECT * FROM memory_facts WHERE project_id=$1", [aliceProject])).rows.length, 0);
        await assert.rejects(
          () => getTurn(db, {
            sessionId: aliceSession,
            key: typedKey,
            text: "I was born in Malmö in 1974 and felt glad.",
            language: "sv",
          }),
          (error) => error.code === "P0002",
        );
        await assert.rejects(
          () => resolveFact(db, state.locationFact.id, "confirmed", null, 1),
          (error) => error.code === "P0002",
        );
      });

      const beforeForeign = await currentSequence(db, aliceSession);
      await asUser(db, alice, async () => {
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000015",
            text: "I also remember Lund.",
            language: "sv",
            expectedSequence: beforeForeign,
            facts: [{
              fact_type: "location",
              value: "Lund",
              evidence: "remember Lund",
              uncertain: true,
              clarification_question: "Was this the same Lund memory?",
              conflicts_with_fact_id: state.bobFact.id,
            }],
          }),
          (error) => error.code === "P0002",
        );
      });
      assert.equal(await currentSequence(db, aliceSession), beforeForeign);
    });

    await t.test("fact review is versioned without overwriting extracted evidence", async () => {
      const original = await db.query("SELECT * FROM memory_facts WHERE id=$1", [state.dateFact.id]);
      const contextBeforeReview = await asUser(db, alice, () => currentContext(db, aliceSession));
      const confirmed = await asUser(db, alice, () => resolveFact(
        db,
        state.locationFact.id,
        "confirmed",
        null,
        1,
      ));
      assert.equal(confirmed.version, 2);
      await asUser(db, alice, async () => {
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000020",
            text: "A stale memory context.",
            language: "sv",
            expectedSequence: await currentSequence(db, aliceSession),
            contextVersions: contextBeforeReview,
          }),
          (error) => error.code === "55000",
        );
      });
      const corrected = await asUser(db, alice, () => resolveFact(
        db,
        state.dateFact.id,
        "confirmed",
        "1975",
        1,
      ));
      assert.equal(corrected.value, "1974");
      assert.equal(corrected.corrected_value, "1975");
      assert.equal(corrected.version, 2);
      assert.deepEqual(
        await asUser(db, alice, () => resolveFact(
          db,
          state.dateFact.id,
          "confirmed",
          "1975",
          1,
        )),
        corrected,
      );
      const after = await db.query("SELECT * FROM memory_facts WHERE id=$1", [state.dateFact.id]);
      for (const key of ["project_id", "session_id", "source_message_id", "fact_type", "value", "evidence", "year", "slot", "uncertain", "created_at"]) {
        assert.deepEqual(after.rows[0][key], original.rows[0][key]);
      }
      const clarification = await db.query(
        "SELECT status, resolution FROM memory_clarifications WHERE fact_id=$1",
        [state.dateFact.id],
      );
      assert.deepEqual(clarification.rows, [{ status: "resolved", resolution: "corrected: 1975" }]);
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM memory_fact_revisions WHERE fact_id=$1", [state.dateFact.id])).rows[0].count,
        1,
      );
      await asUser(db, alice, async () => {
        await expectSqlError(db, "SELECT * FROM memory_fact_revisions", [], "42501");
        await assert.rejects(
          () => resolveFact(db, state.locationFact.id, "rejected", null, 1),
          (error) => error.code === "55000",
        );
      });
    });

    await t.test("completed sessions replay and review but reject new turns", async () => {
      await asUser(db, alice, () => db.query(`
        UPDATE conversation_sessions
        SET status='completed', ended_at=now() WHERE id=$1
      `, [aliceSession]));
      const replay = await asUser(db, alice, () => appendTurn(db, {
        sessionId: aliceSession,
        key: typedKey,
        text: "I was born in Malmö in 1974 and felt glad.",
        language: "sv",
        expectedSequence: 0,
      }));
      assert.deepEqual(replay, state.typed);
      const rejected = await asUser(db, alice, () => resolveFact(
        db,
        state.emotionFact.id,
        "rejected",
        null,
        1,
      ));
      assert.equal(rejected.status, "rejected");
      await asUser(db, alice, async () => {
        await assert.rejects(
          async () => appendTurn(db, {
            sessionId: aliceSession,
            key: "14500000-0000-4000-8000-000000000016",
            text: "One more memory.",
            language: "sv",
            expectedSequence: await currentSequence(db, aliceSession),
          }),
          (error) => error.code === "55000",
        );
        assert.equal((await db.query("SELECT * FROM memory_facts WHERE session_id=$1", [aliceSession])).rows.length, 3);
      });
    });

    await t.test("cross-session conflict erasure cascades only its clarification", async () => {
      const conflictTurn = await asUser(db, alice, async () => appendTurn(db, {
        sessionId: aliceOtherSession,
        key: "14500000-0000-4000-8000-000000000017",
        text: "Malmö was also important to me.",
        language: "sv",
        expectedSequence: await currentSequence(db, aliceOtherSession),
        facts: [{
          fact_type: "location",
          value: "Malmö",
          evidence: "Malmö",
          uncertain: true,
          clarification_question: "Is this the same Malmö memory?",
          conflicts_with_fact_id: state.locationFact.id,
        }],
      }));
      const survivingFact = conflictTurn.memories[0].id;
      const cascadingClarification = conflictTurn.clarifications[0].id;
      await asUser(db, alice, () => db.query(
        "DELETE FROM conversation_sessions WHERE id=$1",
        [aliceSession],
      ));
      assert.equal((await db.query("SELECT * FROM memory_facts WHERE id=$1", [survivingFact])).rows.length, 1);
      assert.equal((await db.query("SELECT * FROM memory_clarifications WHERE id=$1", [cascadingClarification])).rows.length, 0);
      assert.equal((await db.query("SELECT original_text FROM conversation_messages WHERE id=$1", [orphanSource])).rows[0].original_text, "Detta original ska lämnas orört.");
      assert.equal((await db.query("SELECT * FROM memory_facts WHERE id=$1", [state.bobFact.id])).rows.length, 1);
    });

    await t.test("rollback-only hosted verification SQL also passes locally", async () => {
      const cloudSql = await readFile(new URL("./cloud-conversation.sql", import.meta.url), "utf8");
      await db.exec(cloudSql);
      for (const [relation, id] of [
        ["auth.users", "a4100000-0000-4000-8000-000000000001"],
        ["public.books", "a4200000-0000-4000-8000-000000000001"],
        ["public.conversation_sessions", "a4300000-0000-4000-8000-000000000001"],
      ]) {
        assert.equal((await db.query(`SELECT count(*)::integer AS count FROM ${relation} WHERE id=$1`, [id])).rows[0].count, 0);
      }
    });
  } finally {
    await db.close();
  }
});
