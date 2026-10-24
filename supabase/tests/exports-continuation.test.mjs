import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Fully embedded PostgreSQL only. No hosted Supabase or storage is contacted.
const alice = "61100000-0000-4000-8000-000000000001";
const bob = "61100000-0000-4000-8000-000000000002";
const project = "61200000-0000-4000-8000-000000000001";
const bobProject = "61200000-0000-4000-8000-000000000002";
const initialSession = "61300000-0000-4000-8000-000000000001";
const initialTurnKey = "61400000-0000-4000-8000-000000000001";
const secondTurnKey = "61400000-0000-4000-8000-000000000002";
const conflictTurnKey = "61400000-0000-4000-8000-000000000003";
const firstGenerationKey = "61500000-0000-4000-8000-000000000001";
const secondGenerationKey = "61500000-0000-4000-8000-000000000002";
const conflictGenerationKey = "61500000-0000-4000-8000-000000000003";

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

async function currentSequence(db, sessionId) {
  const result = await db.query(`
    SELECT COALESCE(max(sequence), 0)::bigint AS sequence
    FROM public.conversation_messages WHERE session_id=$1
  `, [sessionId]);
  return Number(result.rows[0].sequence);
}

async function currentContext(db, projectId) {
  const result = await db.query(`
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('id', f.id::text, 'version', f.version)
      ORDER BY f.id
    ), '[]'::jsonb) AS context
    FROM public.memory_facts AS f
    WHERE f.project_id=$1 AND f.status<>'rejected'
  `, [projectId]);
  return result.rows[0].context;
}

async function appendTurn(db, {
  sessionId,
  key,
  text,
  assistantText,
  facts,
}) {
  return rpc(
    db,
    "append_conversation_turn",
    ["uuid", "uuid", "text", "text", "uuid", "bigint", "text", "jsonb", "jsonb"],
    [
      sessionId,
      key,
      text,
      "sv",
      null,
      await currentSequence(db, sessionId),
      assistantText,
      JSON.stringify(facts),
      JSON.stringify(await currentContext(db, project)),
    ],
  );
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
    INSERT INTO auth.users(id,email) VALUES
      ($1,'alice@example.test'),($2,'bob@example.test')
  `, [alice, bob]);
  return db;
}

test("Day 6 exports and continuation preserve every saved story revision", async (t) => {
  const db = await setup();
  const state = {};
  try {
    await t.test("an owned confirmed-memory story reaches a verified first draft", async () => {
      await asUser(db, alice, async () => {
        await db.query(`
          INSERT INTO public.story_projects(id,user_id,title,language)
          VALUES ($1,$2,'Mitt liv','sv')
        `, [project, alice]);
        await db.query(`
          INSERT INTO public.conversation_sessions(id,project_id,language)
          VALUES ($1,$2,'sv')
        `, [initialSession, project]);
        const turn = await appendTurn(db, {
          sessionId: initialSession,
          key: initialTurnKey,
          text: "Jag växte upp i Malmö.",
          assistantText: "Tack för att du berättar.",
          facts: [{
            fact_type: "location",
            value: "Malmö",
            evidence: "Jag växte upp i Malmö",
            slot: "grew_up_location",
            uncertain: false,
          }],
        });
        state.locationFact = turn.memories[0].id;
        await rpc(
          db,
          "resolve_memory_fact",
          ["uuid", "text", "text", "integer"],
          [state.locationFact, "confirmed", null, 1],
        );
        state.firstContext = await rpc(db, "load_story_context", ["uuid"], [project]);
        assert.equal(state.firstContext.canonical_content, "Jag växte upp i Malmö.");
        state.firstDraft = await rpc(
          db,
          "save_story_generation",
          ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
          [
            project,
            firstGenerationKey,
            "sv",
            "warm",
            true,
            state.firstContext.context_token,
            state.firstContext.canonical_content,
          ],
        );
      });
      assert.equal(state.firstDraft.version, 1);
      assert.equal(state.firstDraft.revision, 1);
      assert.equal(state.firstDraft.verification.status, "passed");
    });

    await t.test("PDF audit metadata binds the selected saved text and deduplicates", async () => {
      await asUser(db, alice, async () => {
        const context = await rpc(
          db,
          "load_story_export_context",
          ["uuid"],
          [state.firstDraft.draft_id],
        );
        assert.equal(context.project_title, "Mitt liv");
        assert.deepEqual(context.draft, state.firstDraft);
        state.firstExport = await rpc(
          db,
          "record_story_export",
          ["uuid", "integer", "text", "boolean", "boolean", "text", "text", "integer", "integer"],
          [
            state.firstDraft.draft_id,
            1,
            "Mitt liv",
            true,
            true,
            "memy_pdf_v1",
            "memy-mitt-liv.pdf",
            4096,
            2,
          ],
        );
        assert.deepEqual(Object.keys(state.firstExport).sort(), [
          "byte_size", "content_sha256", "created_at", "draft_id",
          "draft_revision", "draft_version", "export_id", "filename", "format",
          "include_page_numbers", "include_title_page", "language", "page_count",
          "project_id", "renderer_version", "title",
        ]);
        assert.equal(
          state.firstExport.content_sha256,
          createHash("sha256").update(state.firstDraft.content, "utf8").digest("hex"),
        );
        const download = await rpc(
          db,
          "get_story_export",
          ["uuid"],
          [state.firstExport.export_id],
        );
        assert.equal(download.content, state.firstDraft.content);
        assert.deepEqual(download.export, state.firstExport);

        const replay = await rpc(
          db,
          "record_story_export",
          ["uuid", "integer", "text", "boolean", "boolean", "text", "text", "integer", "integer"],
          [
            state.firstDraft.draft_id,
            1,
            "Mitt liv",
            true,
            true,
            "memy_pdf_v1",
            "memy-another-safe-name.pdf",
            8192,
            3,
          ],
        );
        assert.deepEqual(replay, state.firstExport);
      });
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM story_exports")).rows[0].count,
        1,
      );
    });

    await t.test("continuation resumes the active session without generating", async () => {
      const continuation = await asUser(db, alice, () => rpc(
        db,
        "continue_story_project",
        ["uuid"],
        [project],
      ));
      assert.equal(continuation.project_id, project);
      assert.equal(continuation.language, "sv");
      assert.equal(continuation.session.id, initialSession);
      assert.equal(continuation.session_created, false);
      assert.equal(continuation.generation_triggered, false);
      assert.deepEqual(continuation.latest_draft, state.firstDraft);
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM story_drafts WHERE project_id=$1", [project])).rows[0].count,
        1,
      );
    });

    await t.test("edits and title changes keep every exported revision downloadable", async () => {
      await asUser(db, alice, async () => {
        const secondContent = `${state.firstDraft.content}\n\nDet här är mina egna ord.`;
        state.secondRevision = await rpc(
          db,
          "edit_story_draft",
          ["uuid", "integer", "text"],
          [state.firstDraft.draft_id, 1, secondContent],
        );
        state.secondExport = await rpc(
          db,
          "record_story_export",
          ["uuid", "integer", "text", "boolean", "boolean", "text", "text", "integer", "integer"],
          [
            state.firstDraft.draft_id,
            2,
            "Mitt liv",
            true,
            false,
            "memy_pdf_v1",
            "memy-mitt-liv.pdf",
            5000,
            2,
          ],
        );
        const thirdContent = `${secondContent}\n\nJag fortsätter skriva.`;
        state.thirdRevision = await rpc(
          db,
          "edit_story_draft",
          ["uuid", "integer", "text"],
          [state.firstDraft.draft_id, 2, thirdContent],
        );

        const firstDownload = await rpc(
          db,
          "get_story_export",
          ["uuid"],
          [state.firstExport.export_id],
        );
        const secondDownload = await rpc(
          db,
          "get_story_export",
          ["uuid"],
          [state.secondExport.export_id],
        );
        assert.equal(firstDownload.content, state.firstDraft.original_content);
        assert.equal(secondDownload.content, secondContent);
        assert.equal(secondDownload.content.includes("Jag fortsätter skriva"), false);

        await db.query(
          "UPDATE public.story_projects SET title='Mitt fortsatta liv' WHERE id=$1",
          [project],
        );
        await assert.rejects(
          () => rpc(
            db,
            "record_story_export",
            ["uuid", "integer", "text", "boolean", "boolean", "text", "text", "integer", "integer"],
            [
              state.firstDraft.draft_id,
              3,
              "Mitt liv",
              true,
              true,
              "memy_pdf_v1",
              "memy-mitt-liv.pdf",
              6000,
              3,
            ],
          ),
          (error) => error.code === "55000",
        );
        const latestContext = await rpc(
          db,
          "load_story_export_context",
          ["uuid"],
          [state.firstDraft.draft_id],
        );
        assert.equal(latestContext.project_title, "Mitt fortsatta liv");
        assert.equal(latestContext.draft.revision, 3);
        state.thirdExport = await rpc(
          db,
          "record_story_export",
          ["uuid", "integer", "text", "boolean", "boolean", "text", "text", "integer", "integer"],
          [
            state.firstDraft.draft_id,
            3,
            "Mitt fortsatta liv",
            true,
            true,
            "memy_pdf_v1",
            "memy-mitt-fortsatta-liv.pdf",
            6000,
            3,
          ],
        );
        const exports = await rpc(
          db,
          "list_story_exports",
          ["uuid", "integer", "integer"],
          [project, 20, 0],
        );
        assert.equal(exports.length, 3);
        assert.equal(exports[0].export_id, state.thirdExport.export_id);
        assert.deepEqual(new Set(exports.map((entry) => entry.draft_revision)), new Set([1, 2, 3]));
        assert.equal(firstDownload.export.title, "Mitt liv");
        assert.equal(state.thirdExport.title, "Mitt fortsatta liv");
      });
    });

    await t.test("a completed session creates exactly one resumable active session", async () => {
      await asUser(db, alice, () => db.query(`
        UPDATE public.conversation_sessions
        SET status='completed', ended_at=clock_timestamp()
        WHERE id=$1
      `, [initialSession]));
      const created = await asUser(db, alice, () => rpc(
        db,
        "continue_story_project",
        ["uuid"],
        [project],
      ));
      state.continuedSession = created.session.id;
      assert.equal(created.session_created, true);
      assert.equal(created.session.status, "active");
      assert.equal(created.latest_draft.revision, 3);
      assert.equal(created.generation_triggered, false);

      const replay = await asUser(db, alice, () => rpc(
        db,
        "continue_story_project",
        ["uuid"],
        [project],
      ));
      assert.equal(replay.session_created, false);
      assert.equal(replay.session.id, state.continuedSession);
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM conversation_sessions WHERE project_id=$1", [project])).rows[0].count,
        2,
      );
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM memory_facts WHERE project_id=$1", [project])).rows[0].count,
        1,
      );
    });

    await t.test("new confirmed memories require explicit generation and create version two", async () => {
      await asUser(db, alice, async () => {
        const turn = await appendTurn(db, {
          sessionId: state.continuedSession,
          key: secondTurnKey,
          text: "Jag kände mig glad.",
          assistantText: "Tack, jag sparar det minnet.",
          facts: [{
            fact_type: "emotion",
            value: "glad",
            evidence: "Jag kände mig glad",
            uncertain: false,
          }],
        });
        state.emotionFact = turn.memories[0].id;
        await rpc(
          db,
          "resolve_memory_fact",
          ["uuid", "text", "text", "integer"],
          [state.emotionFact, "confirmed", null, 1],
        );
        assert.equal(
          (await db.query("SELECT count(*)::integer AS count FROM story_drafts WHERE project_id=$1", [project])).rows[0].count,
          1,
        );
        state.secondContext = await rpc(db, "load_story_context", ["uuid"], [project]);
        assert.equal(
          state.secondContext.canonical_content,
          "Jag växte upp i Malmö.\n\nJag kände mig glad.",
        );
        state.secondDraft = await rpc(
          db,
          "save_story_generation",
          ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
          [
            project,
            secondGenerationKey,
            "sv",
            "warm",
            true,
            state.secondContext.context_token,
            state.secondContext.canonical_content,
          ],
        );
      });
      assert.equal(state.secondDraft.version, 2);
      assert.notEqual(state.secondDraft.draft_id, state.firstDraft.draft_id);
      const oldDraft = await asUser(db, alice, () => rpc(
        db,
        "get_story_draft",
        ["uuid"],
        [state.firstDraft.draft_id],
      ));
      assert.equal(oldDraft.revision, 3);
      assert.equal(oldDraft.content, state.thirdRevision.content);
      assert.equal(oldDraft.verification.status, "needs_review");
      assert.equal(oldDraft.verification.sources_current, false);
      const oldDownload = await asUser(db, alice, () => rpc(
        db,
        "get_story_export",
        ["uuid"],
        [state.secondExport.export_id],
      ));
      assert.equal(oldDownload.content, state.secondRevision.content);
      const resumed = await asUser(db, alice, () => rpc(
        db,
        "continue_story_project",
        ["uuid"],
        [project],
      ));
      assert.equal(resumed.latest_draft.draft_id, state.secondDraft.draft_id);
      assert.equal(resumed.generation_triggered, false);
    });

    await t.test("a contradictory continued memory blocks another generation", async () => {
      await asUser(db, alice, async () => {
        const turn = await appendTurn(db, {
          sessionId: state.continuedSession,
          key: conflictTurnKey,
          text: "Jag växte egentligen upp i Uppsala.",
          assistantText: "Växte du upp i Malmö eller Uppsala?",
          facts: [{
            fact_type: "location",
            value: "Uppsala",
            evidence: "Jag växte egentligen upp i Uppsala",
            slot: "grew_up_location",
            uncertain: true,
            clarification_question: "Växte du upp i Malmö eller Uppsala?",
            conflicts_with_fact_id: state.locationFact,
          }],
        });
        assert.equal(turn.clarifications.length, 1);
        const blocked = await rpc(db, "load_story_context", ["uuid"], [project]);
        assert.equal(blocked.blocking_clarifications.length, 1);
        await assert.rejects(
          () => rpc(
            db,
            "save_story_generation",
            ["uuid", "uuid", "text", "text", "boolean", "text", "text"],
            [
              project,
              conflictGenerationKey,
              "sv",
              "warm",
              true,
              blocked.context_token,
              blocked.canonical_content,
            ],
          ),
          (error) => error.code === "55000",
        );
      });
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM story_drafts WHERE project_id=$1", [project])).rows[0].count,
        2,
      );
    });

    await t.test("export validation and stale source checks fail before audit insertion", async () => {
      const before = (await db.query(
        "SELECT count(*)::integer AS count FROM story_exports WHERE project_id=$1",
        [project],
      )).rows[0].count;
      await asUser(db, alice, async () => {
        const signature = [
          "uuid", "integer", "text", "boolean", "boolean", "text", "text", "integer", "integer",
        ];
        const valid = [
          state.secondDraft.draft_id,
          1,
          "Mitt fortsatta liv",
          true,
          true,
          "memy_pdf_v1",
          "memy-version-two.pdf",
          4000,
          2,
        ];
        await assert.rejects(
          () => rpc(db, "record_story_export", signature, [
            ...valid.slice(0, 6), "../unsafe.pdf", ...valid.slice(7),
          ]),
          (error) => error.code === "22023",
        );
        await assert.rejects(
          () => rpc(db, "record_story_export", signature, [
            ...valid.slice(0, 1), 2, ...valid.slice(2),
          ]),
          (error) => error.code === "55000",
        );
        await assert.rejects(
          () => rpc(db, "record_story_export", signature, [
            ...valid.slice(0, 2), "Old title", ...valid.slice(3),
          ]),
          (error) => error.code === "55000",
        );
        await assert.rejects(
          () => rpc(db, "list_story_exports", ["uuid", "integer", "integer"], [project, 101, 0]),
          (error) => error.code === "22023",
        );
        await assert.rejects(
          () => rpc(db, "list_story_exports", ["uuid", "integer", "integer"], [project, 20, 100001]),
          (error) => error.code === "22023",
        );
      });
      assert.equal(
        (await db.query("SELECT count(*)::integer AS count FROM story_exports WHERE project_id=$1", [project])).rows[0].count,
        before,
      );
    });

    await t.test("cross-user, anonymous and direct mutation paths remain closed", async () => {
      await asUser(db, bob, async () => {
        await db.query(`
          INSERT INTO public.story_projects(id,user_id,title,language)
          VALUES ($1,$2,'Bobs bok','sv')
        `, [bobProject, bob]);
        assert.equal((await db.query("SELECT * FROM story_exports")).rows.length, 0);
        await assert.rejects(
          () => rpc(db, "load_story_export_context", ["uuid"], [state.firstDraft.draft_id]),
          (error) => error.code === "P0002",
        );
        await assert.rejects(
          () => rpc(
            db,
            "record_story_export",
            ["uuid", "integer", "text", "boolean", "boolean", "text", "text", "integer", "integer"],
            [
              state.secondDraft.draft_id,
              1,
              "Mitt fortsatta liv",
              true,
              true,
              "memy_pdf_v1",
              "memy-forged.pdf",
              100,
              1,
            ],
          ),
          (error) => error.code === "P0002",
        );
        await assert.rejects(
          () => rpc(db, "get_story_export", ["uuid"], [state.firstExport.export_id]),
          (error) => error.code === "P0002",
        );
        await assert.rejects(
          () => rpc(db, "list_story_exports", ["uuid", "integer", "integer"], [project, 20, 0]),
          (error) => error.code === "P0002",
        );
        await assert.rejects(
          () => rpc(db, "continue_story_project", ["uuid"], [project]),
          (error) => error.code === "P0002",
        );
        await expectSqlError(
          db,
          "SELECT public.story_export_selected_content($1::uuid,1)",
          [state.firstDraft.draft_id],
          "42501",
        );
        await expectSqlError(
          db,
          "INSERT INTO public.story_exports DEFAULT VALUES",
          [],
          "42501",
        );
        await expectSqlError(
          db,
          "UPDATE public.story_exports SET filename='memy-forged.pdf' WHERE id=$1",
          [state.firstExport.export_id],
          "42501",
        );
        await expectSqlError(
          db,
          "DELETE FROM public.story_exports WHERE id=$1",
          [state.firstExport.export_id],
          "42501",
        );
      });

      await db.exec("SET ROLE anon");
      try {
        await expectSqlError(db, "SELECT * FROM public.story_exports", [], "42501");
        await expectSqlError(
          db,
          "SELECT public.load_story_export_context($1::uuid)",
          [state.firstDraft.draft_id],
          "42501",
        );
        await expectSqlError(
          db,
          `SELECT public.record_story_export(
            $1::uuid,1,'Mitt fortsatta liv',true,true,'memy_pdf_v1',
            'memy-forged.pdf',100,1
          )`,
          [state.secondDraft.draft_id],
          "42501",
        );
        await expectSqlError(
          db,
          "SELECT public.get_story_export($1::uuid)",
          [state.firstExport.export_id],
          "42501",
        );
        await expectSqlError(
          db,
          "SELECT public.list_story_exports($1::uuid,20,0)",
          [project],
          "42501",
        );
        await expectSqlError(
          db,
          "SELECT public.continue_story_project($1::uuid)",
          [project],
          "42501",
        );
      } finally {
        await db.exec("RESET ROLE");
      }

      await expectSqlError(
        db,
        "UPDATE public.story_exports SET filename='memy-overwrite.pdf' WHERE id=$1",
        [state.firstExport.export_id],
        "55000",
      );
      const columns = (await db.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='story_exports'
        ORDER BY ordinal_position
      `)).rows.map((row) => row.column_name);
      assert.equal(columns.includes("content"), false);
      assert.equal(columns.some((column) => column.includes("pdf_bytes")), false);
    });

    await t.test("project deletion cascades sessions, drafts and export audits", async () => {
      await asUser(db, alice, () => db.query(
        "DELETE FROM public.story_projects WHERE id=$1",
        [project],
      ));
      assert.equal((await db.query("SELECT * FROM story_exports WHERE project_id=$1", [project])).rows.length, 0);
      assert.equal((await db.query("SELECT * FROM story_drafts WHERE project_id=$1", [project])).rows.length, 0);
      assert.equal((await db.query("SELECT * FROM conversation_sessions WHERE project_id=$1", [project])).rows.length, 0);
    });

    await t.test("rollback-only hosted verification SQL also passes locally", async () => {
      const cloudVerification = await readFile(
        new URL("./cloud-exports-continuation.sql", import.meta.url),
        "utf8",
      );
      await db.exec(cloudVerification);
      assert.equal(
        (await db.query(`
          SELECT count(*)::integer AS count FROM auth.users
          WHERE id IN (
            'a6100000-0000-4000-8000-000000000001',
            'b6100000-0000-4000-8000-000000000002'
          )
        `)).rows[0].count,
        0,
      );
      assert.equal(
        (await db.query(`
          SELECT count(*)::integer AS count FROM public.books
          WHERE id IN (
            'a6200000-0000-4000-8000-000000000001',
            'b6200000-0000-4000-8000-000000000002'
          )
        `)).rows[0].count,
        0,
      );
    });
  } finally {
    await db.close();
  }
});
