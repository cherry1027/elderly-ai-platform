import { readFile, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

// A deterministic SQL Editor fallback for a confirmed EMPTY development project.
// Applies the repository's exact migrations and records their original versions.
// Normal ongoing development should use the Supabase CLI migration workflow.
export async function buildBootstrap() {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{14}_.+\.sql$/.test(name)).sort();
  const parts = [
    "BEGIN;",
    `DO $guard$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') THEN
        RAISE EXCEPTION 'Bootstrap requires an empty public schema';
      END IF;
    END $guard$;`,
    "CREATE SCHEMA IF NOT EXISTS supabase_migrations;",
    "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);",
    "REVOKE ALL ON SCHEMA supabase_migrations FROM PUBLIC, anon, authenticated;",
  ];
  for (const file of files) {
    const [, version, name] = /^(\d{14})_(.+)\.sql$/.exec(file);
    const original = await readFile(new URL(file, directory), "utf8");
    // One outer transaction; preserve each original migration in its history entry.
    const sql = original.replace(/^\s*(?:BEGIN|COMMIT);\s*$/gmi, "");
    parts.push(`-- ${file}\n${sql}`);
    // Like migration repair, record the exact applied version/name; source SQL
    // remains in Git rather than being duplicated in a dashboard query.
    parts.push(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${name}');`);
  }
  parts.push("NOTIFY pgrst, 'reload schema';", "COMMIT;", "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;");
  return parts.join("\n\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sql = await buildBootstrap();
  process.stdout.write(process.argv.includes("--gzip-base64") ? gzipSync(sql).toString("base64") : sql);
}
