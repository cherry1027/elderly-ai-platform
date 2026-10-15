import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createDeletionRemindersHandler } from "./handler";

const CRON_SECRET = "synthetic-cron-secret-" + "a".repeat(64);
const SERVICE_KEY = "synthetic-service-role-key";
const USER_JWT = [
  btoa(JSON.stringify({ alg: "none" })),
  btoa(JSON.stringify({ role: "authenticated", sub: "synthetic-user" })),
  "synthetic-signature",
].join(".");
const NOW = new Date("2026-10-15T12:00:00.000Z");
const DAY = 86_400_000;
const stages = [60, 75, 90, 105, 115];

interface Row {
  id: string;
  [column: string]: unknown;
}

interface Query extends PromiseLike<{ data: Row[] | null; error: null }> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  lte(column: string, value: string): Query;
  not(column: string, operator: string, value: unknown): Query;
  update(values: Record<string, unknown>): Query;
  insert(values: Record<string, unknown>): Query;
  delete(): Query;
}

function book(id: string, age: number, extra: Record<string, unknown> = {}): Row {
  return {
    id, title: id, user_id: "synthetic-user",
    description: "Synthetic fixture", plan_type: "freemium",
    is_deleted: false, last_edited: new Date(NOW.getTime() - age * DAY).toISOString(),
    created_at: new Date(NOW.getTime() - 200 * DAY).toISOString(),
    scheduled_deletion: null, page_count: 1, image_count: 0,
    book_template: "classic", pages: [],
    ...Object.fromEntries(stages.map(days => [`inactivity_reminded_${days}d`, false])),
    ...extra,
  };
}

function harness(initialBooks: Row[] = [], initialBackups: Row[] = []) {
  const tables: Record<string, Row[]> = {
    books: structuredClone(initialBooks),
    deleted_books_backup: structuredClone(initialBackups),
  };
  const operations: { table: string; action: string; values?: Record<string, unknown> }[] = [];
  const from = vi.fn((table: string): Query => {
    let action = "select";
    let values: Record<string, unknown> = {};
    const filters: ((row: Row) => boolean)[] = [];
    const query: Query = {
      select: () => query,
      eq: (column, value) => { filters.push(row => row[column] === value); return query; },
      lte: (column, value) => {
        filters.push(row => typeof row[column] === "string" && row[column] <= value);
        return query;
      },
      not: (column, operator, value) => {
        if (operator !== "is" || value !== null) throw new Error("Unsupported mock filter");
        filters.push(row => row[column] !== null && row[column] !== undefined);
        return query;
      },
      update: next => { action = "update"; values = next; return query; },
      insert: next => { action = "insert"; values = next; return query; },
      delete: () => { action = "delete"; return query; },
      then: (fulfilled, rejected) => {
        operations.push({ table, action, values: structuredClone(values) });
        const matching = tables[table].filter(row => filters.every(filter => filter(row)));
        if (action === "update") matching.forEach(row => Object.assign(row, values));
        if (action === "delete") tables[table] = tables[table].filter(row => !matching.includes(row));
        if (action === "insert") tables[table].push({ id: "inserted-backup", ...structuredClone(values) });
        return Promise.resolve({ data: matching, error: null }).then(fulfilled, rejected);
      },
    };
    return query;
  });
  const remove = vi.fn(async (_paths: string[]) => ({ data: [], error: null }));
  const storageFrom = vi.fn((_bucket: string) => ({ remove }));
  const getUserById = vi.fn(async (_id: string) => ({
    data: { user: { email: "synthetic@example.invalid" } }, error: null,
  }));
  const client = { from, storage: { from: storageFrom }, auth: { admin: { getUserById } } };
  const createClient = vi.fn((_url: string, _key: string) => client as unknown as SupabaseClient);
  const env: Record<string, string | undefined> = {
    DELETION_REMINDERS_CRON_SECRET: CRON_SECRET,
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  };
  const getEnv = vi.fn((name: string) => env[name]);
  return {
    env, getEnv, createClient, from, remove, storageFrom, getUserById, operations, tables,
    handler: createDeletionRemindersHandler({ getEnv, createClient }),
  };
}

function request(headers: Record<string, string> = {}, method = "POST", url = "http://localhost/deletion-reminders") {
  return new Request(url, { method, headers });
}

function expectNoPrivileges(h: ReturnType<typeof harness>) {
  expect(h.createClient).not.toHaveBeenCalled();
  expect(h.from).not.toHaveBeenCalled();
  expect(h.storageFrom).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.getUserById).not.toHaveBeenCalled();
  expect(h.operations).toEqual([]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network calls are forbidden in these tests"); }));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("deletion-reminders authorization", () => {
  it.each([
    ["missing secret", {}],
    ["empty secret", { "X-Deletion-Reminders-Secret": "" }],
    ["incorrect secret", { "X-Deletion-Reminders-Secret": "incorrect" }],
    ["equal-length incorrect secret", { "X-Deletion-Reminders-Secret": CRON_SECRET.slice(0, -1) + "b" }],
    ["long incorrect secret", { "X-Deletion-Reminders-Secret": CRON_SECRET + "a" }],
    ["anon API key", { apikey: "synthetic-anon-key" }],
    ["anonymous bearer", { Authorization: "Bearer synthetic-anon-key" }],
    ["ordinary authenticated user", { Authorization: `Bearer ${USER_JWT}` }],
    ["service-role bearer", { Authorization: `Bearer ${SERVICE_KEY}` }],
    ["service-role API key", { apikey: SERVICE_KEY }],
    ["service-role key in dedicated header", { "X-Deletion-Reminders-Secret": SERVICE_KEY }],
    ["user JWT in dedicated header", { "X-Deletion-Reminders-Secret": USER_JWT }],
  ])("rejects %s before privileged client creation", async (_name, headers) => {
    const h = harness();
    const response = await h.handler(request(headers));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expectNoPrivileges(h);
    expect(h.getEnv.mock.calls).toEqual([["DELETION_REMINDERS_CRON_SECRET"]]);
  });

  it("does not accept the secret in a query parameter or request body", async () => {
    const h = harness();
    const response = await h.handler(new Request(
      "http://localhost/deletion-reminders?secret=" + CRON_SECRET,
      { method: "POST", body: JSON.stringify({ secret: CRON_SECRET }) },
    ));
    expect(response.status).toBe(401);
    expectNoPrivileges(h);
  });

  it.each([
    ["DELETION_REMINDERS_CRON_SECRET", undefined],
    ["DELETION_REMINDERS_CRON_SECRET", ""],
    ["DELETION_REMINDERS_CRON_SECRET", "   "],
    ["DELETION_REMINDERS_CRON_SECRET", "too-short"],
    ["DELETION_REMINDERS_CRON_SECRET", " " + CRON_SECRET],
    ["SUPABASE_URL", undefined],
    ["SUPABASE_URL", ""],
    ["SUPABASE_URL", "not-a-url"],
    ["SUPABASE_URL", "ftp://localhost"],
    ["SUPABASE_URL", "https://user:password@example.invalid"],
    ["SUPABASE_SERVICE_ROLE_KEY", undefined],
    ["SUPABASE_SERVICE_ROLE_KEY", ""],
    ["SUPABASE_SERVICE_ROLE_KEY", "   "],
  ])("fails closed for unusable %s (%s)", async (name, value) => {
    const h = harness();
    h.env[name] = value;
    const response = await h.handler(request({ "X-Deletion-Reminders-Secret": CRON_SECRET }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service unavailable" });
    expectNoPrivileges(h);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("fails closed if environment access throws, without logging its contents", async () => {
    const h = harness();
    h.getEnv.mockImplementation(() => { throw new Error(CRON_SECRET + SERVICE_KEY); });
    const response = await h.handler(request({ "X-Deletion-Reminders-Secret": CRON_SECRET }));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"Service unavailable"}');
    expectNoPrivileges(h);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE"])("rejects %s even with the correct secret", async method => {
    const h = harness();
    const response = await h.handler(request({ "X-Deletion-Reminders-Secret": CRON_SECRET }, method));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
    expectNoPrivileges(h);
    expect(h.getEnv).not.toHaveBeenCalled();
  });

  it("returns an inert OPTIONS response even when configuration is absent", async () => {
    const h = harness();
    delete h.env.DELETION_REMINDERS_CRON_SECRET;
    const response = await h.handler(request({}, "OPTIONS"));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectNoPrivileges(h);
    expect(h.getEnv).not.toHaveBeenCalled();
  });

  it("accepts only the dedicated secret and supports case-insensitive HTTP header names", async () => {
    const h = harness();
    const response = await h.handler(request({
      "x-deletion-reminders-secret": CRON_SECRET,
      Authorization: "Bearer irrelevant-user-token",
    }));
    expect(response.status).toBe(200);
    expect(h.createClient).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:54321", SERVICE_KEY);
    expect(await response.json()).toEqual({
      success: true,
      reminders: Object.fromEntries(stages.map(days => [`inactivity_reminded_${days}d`, 0])),
      deleted: 0, backupsPurged: 0,
    });
  });

  it("does not expose credentials when authorized client creation throws", async () => {
    const h = harness();
    h.createClient.mockImplementation(() => { throw new Error(CRON_SECRET + SERVICE_KEY); });
    const response = await h.handler(request({ "X-Deletion-Reminders-Secret": CRON_SECRET }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service unavailable" });
    expect(h.from).not.toHaveBeenCalled();
    expect(h.storageFrom).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("redacts backend exception details from responses and logs", async () => {
    const h = harness();
    h.from.mockImplementation(() => { throw new Error(CRON_SECRET + SERVICE_KEY); });
    const response = await h.handler(request({ "X-Deletion-Reminders-Secret": CRON_SECRET }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Maintenance operation failed" });
    expect(console.error).toHaveBeenCalledExactlyOnceWith("Error in deletion reminders");
  });
});

describe("existing authorized maintenance behavior", () => {
  it("preserves reminder thresholds, deletion branches, storage cleanup and backup purge", async () => {
    const media = (prefix: string) => [{
      id: prefix + "-page", audio_url: prefix + "/recording.webm",
      images: [{ id: prefix + "-image", url: "https://assets.example.invalid/book-images/" + prefix + "/photo%201.jpg" }],
    }];
    const h = harness([
      book("active", 59),
      ...stages.map(days => book("stage-" + days, days)),
      book("inactive", 120, { pages: media("inactive") }),
      book("premium", 200, { plan_type: "premium" }),
      book("already-deleted", 200, { is_deleted: true }),
      // Preserve the existing legacy branch, including its lack of a plan filter.
      book("legacy", 1, {
        plan_type: "premium", pages: media("legacy"),
        scheduled_deletion: new Date(NOW.getTime() - DAY).toISOString(),
      }),
      book("future-legacy", 1, { scheduled_deletion: new Date(NOW.getTime() + DAY).toISOString() }),
    ], [
      { id: "expired", title: "expired", user_id: "synthetic-user", restored: false, backup_expires_at: NOW.toISOString() },
      { id: "future", title: "future", user_id: "synthetic-user", restored: false, backup_expires_at: new Date(NOW.getTime() + DAY).toISOString() },
      { id: "restored", title: "restored", user_id: "synthetic-user", restored: true, backup_expires_at: NOW.toISOString() },
    ]);
    const response = await h.handler(request({ "X-Deletion-Reminders-Secret": CRON_SECRET }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      reminders: Object.fromEntries(stages.map((days, i) => [`inactivity_reminded_${days}d`, 6 - i])),
      deleted: 2, backupsPurged: 1,
    });
    expect(h.tables.books.map(row => row.id)).not.toContain("inactive");
    expect(h.tables.books.map(row => row.id)).not.toContain("legacy");
    expect(h.tables.books.map(row => row.id)).toEqual(expect.arrayContaining([
      "active", "premium", "already-deleted", "future-legacy",
    ]));
    for (const days of stages) {
      const row = h.tables.books.find(item => item.id === "stage-" + days)!;
      for (const stage of stages) expect(row[`inactivity_reminded_${stage}d`]).toBe(stage <= days);
    }
    expect(h.tables.books.find(row => row.id === "active")!.inactivity_reminded_60d).toBe(false);
    expect(h.tables.deleted_books_backup.map(row => row.id)).toEqual(["future", "restored", "inserted-backup"]);
    expect(h.tables.deleted_books_backup.at(-1)).toMatchObject({
      original_book_id: "inactive", user_id: "synthetic-user", title: "inactive",
      book_data: { title: "inactive", plan_type: "freemium", pages: media("inactive") },
    });
    expect(h.operations.filter(op => op.action === "insert")).toHaveLength(1);
    expect(h.storageFrom.mock.calls).toEqual([
      ["book-audio"], ["book-images"], ["book-audio"], ["book-images"],
    ]);
    expect(h.remove.mock.calls).toEqual([
      [["inactive/recording.webm"]], [["inactive/photo 1.jpg"]],
      [["legacy/recording.webm"]], [["legacy/photo 1.jpg"]],
    ]);
    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not repeat already-recorded reminder stages", async () => {
    const h = harness([book("already-reminded", 115, Object.fromEntries(
      stages.map(days => [`inactivity_reminded_${days}d`, true]),
    ))]);
    const response = await h.handler(request({ "X-Deletion-Reminders-Secret": CRON_SECRET }));
    expect(response.status).toBe(200);
    expect(h.operations.filter(op => op.action !== "select")).toEqual([]);
    expect(h.getUserById).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
});
