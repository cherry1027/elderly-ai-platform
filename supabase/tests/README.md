# Isolated PostgreSQL schema tests

From the repository root (Node.js 24 verified):

```sh
npm --prefix supabase/tests ci --ignore-scripts
npm --prefix supabase/tests test
```

The test runner uses PGlite, an in-memory PostgreSQL engine, and never opens a
network connection to Supabase. It creates minimal Supabase `auth.users`,
`auth.uid()`, roles and storage primitives, replays all repository migrations in
order, then tests privileges, RLS, language constraints, view writes and cascades.
Only historical `pg_cron` and `pg_net` extension provisioning is skipped because
those hosting extensions are unavailable in this engine. Application tables,
policies, triggers and the new migration execute as written.

These checks validate PostgreSQL behavior with two separate users and an anonymous
role. They do not validate hosted Auth, PostgREST configuration, Storage, scheduler
extensions or the deployment state of any cloud project. Repeat the ownership
checks with two real test accounts after deployment to the intended development
project. No production user data is used in these tests.

`cloud-ownership.sql` checks ownership against the actual hosted development
database using synthetic users and the authenticated/anonymous PostgreSQL roles.
It runs inside a transaction and rolls back all synthetic rows. It does not
exercise an actual email login or token issuance. Never run it in production.

For a confirmed empty development database only,
`node supabase/scripts/build-bootstrap.mjs` emits a transactional SQL Editor
bootstrap from the repository migrations, including their version history. It
rejects nonempty public schemas. Existing databases should use normal migrations.
