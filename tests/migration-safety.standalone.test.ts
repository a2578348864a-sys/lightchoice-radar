// Failure cases for online migrations: table scans under strong locks, unsafe retries, and hidden SQL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { migrationPlan } from "../scripts/migration-safety.ts";

test("online migrations reject writes, blocking indexes and table rewrites before execution", () => {
  for (const statement of [
    "UPDATE articles SET selected = true;",
    "WITH batch AS (SELECT id FROM articles LIMIT 100) UPDATE articles SET selected = true;",
    "DELETE FROM articles WHERE id = 'one';",
    "TRUNCATE articles;",
    "CREATE INDEX articles_idx ON articles (id);",
    "CREATE UNIQUE INDEX articles_idx ON articles (id);",
    "ALTER TABLE articles ADD COLUMN flag text CHECK (flag IN ('a', 'b'));",
    "ALTER TABLE articles ADD COLUMN receipt bigint REFERENCES receipts(id);",
    "ALTER TABLE articles ADD COLUMN flag text NOT NULL;",
    "ALTER TABLE articles ADD COLUMN flag double precision DEFAULT random();",
    "ALTER TABLE articles ADD COLUMN id bigserial;",
    "ALTER TABLE articles ADD COLUMN created_at timestamptz DEFAULT clock_timestamp();",
    "ALTER TABLE articles ALTER COLUMN id TYPE bigint;",
    "ALTER TABLE articles ADD CONSTRAINT key UNIQUE (id);",
    "ALTER TABLE articles ADD CONSTRAINT positive CHECK (id > 0);",
    "ALTER TABLE articles ADD COLUMN flag text, ADD CONSTRAINT positive CHECK (id > 0);",
    "CREATE TABLE clone AS SELECT * FROM articles;",
    "DO $$ BEGIN UPDATE articles SET selected = true; END $$;",
    "SELECT pg_sleep(60);",
    "SET lock_timeout = 0;",
    "BEGIN; ALTER TABLE articles ADD COLUMN flag text; COMMIT;",
  ]) assert.throws(() => migrationPlan(statement), statement);
});

test("online migrations permit metadata changes and split constraint validation", () => {
  for (const statement of [
    "CREATE TABLE example (id bigint PRIMARY KEY, body text NOT NULL);",
    "ALTER TABLE articles ADD COLUMN flag text;",
    "ALTER TABLE articles ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT false;",
    "ALTER TABLE articles ADD COLUMN flag text DEFAULT 'pending' NOT NULL;",
    "ALTER TABLE articles ADD COLUMN tags text[] DEFAULT '{}'::text[];",
    "ALTER TABLE articles ADD CONSTRAINT positive CHECK (id > 0) NOT VALID;",
    "ALTER TABLE articles ADD CONSTRAINT owner FOREIGN KEY (source_id) REFERENCES sources(id) NOT VALID;",
    "ALTER TABLE articles ALTER COLUMN flag SET DEFAULT 'pending';",
    "ALTER TABLE articles ALTER COLUMN flag DROP DEFAULT;",
  ]) assert.equal(migrationPlan(statement).kind, "transaction", statement);
  assert.equal(migrationPlan("ALTER TABLE articles VALIDATE CONSTRAINT positive;").kind, "validation");
  assert.throws(() => migrationPlan("ALTER TABLE articles ADD COLUMN flag text; ALTER TABLE articles VALIDATE CONSTRAINT positive;"));
});

test("online vacuum tuning accepts only bounded insert and dead-tuple scale factors", () => {
  const statement = "ALTER TABLE analytics_events SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02);";
  assert.equal(migrationPlan(statement).kind, "transaction");
  for (const refused of [
    "ALTER TABLE analytics_events SET (autovacuum_enabled = false);",
    "ALTER TABLE analytics_events SET (autovacuum_vacuum_insert_scale_factor = 0);",
    "ALTER TABLE analytics_events SET (autovacuum_vacuum_scale_factor = 1.01);",
  ]) assert.throws(() => migrationPlan(refused), refused);
});

// Dropping a table nothing uses: a dependent object must stop it (no CASCADE), and one statement may not
// lock several tables at once.
test("a table nothing uses can be dropped alone, never with its dependents", () => {
  assert.equal(migrationPlan("DROP TABLE IF EXISTS retired_example;").kind, "transaction");
  assert.equal(migrationPlan("-- retired\nDROP TABLE IF EXISTS public.retired_example;").kind, "transaction");
  for (const statement of [
    "DROP TABLE IF EXISTS retired_example CASCADE;",
    "DROP TABLE retired_example;",
    "DROP TABLE IF EXISTS retired_example, articles;",
    "DROP TABLE IF EXISTS retired_example; DROP TABLE IF EXISTS articles;",
    "DROP INDEX articles_idx;",
  ]) assert.throws(() => migrationPlan(statement), statement);
});

// Dropping a column or a constraint nothing uses: it must not take dependent objects along (CASCADE),
// bundle several drops or another action into one statement, or fail where it is already gone.
test("a column or a constraint nothing uses can be dropped alone, never with its dependents", () => {
  for (const statement of [
    "ALTER TABLE articles DROP COLUMN IF EXISTS flag;",
    "ALTER TABLE public.articles DROP COLUMN IF EXISTS flag;",
    "ALTER TABLE articles DROP CONSTRAINT IF EXISTS positive;",
  ]) assert.equal(migrationPlan(statement).kind, "transaction", statement);
  for (const statement of [
    "ALTER TABLE articles DROP COLUMN flag;",
    "ALTER TABLE articles DROP flag;",
    "ALTER TABLE articles DROP COLUMN IF EXISTS flag CASCADE;",
    "ALTER TABLE articles DROP COLUMN IF EXISTS flag RESTRICT;",
    "ALTER TABLE articles DROP COLUMN IF EXISTS flag, DROP COLUMN IF EXISTS note;",
    "ALTER TABLE articles DROP COLUMN IF EXISTS flag, ADD COLUMN note text;",
    "ALTER TABLE articles DROP COLUMN IF EXISTS flag; ALTER TABLE articles DROP COLUMN IF EXISTS note;",
    "ALTER TABLE articles DROP CONSTRAINT positive;",
    "ALTER TABLE articles DROP CONSTRAINT IF EXISTS positive CASCADE;",
  ]) assert.throws(() => migrationPlan(statement), statement);
});

test("concurrent indexes have one retriable statement per file, outside a transaction", () => {
  const plan = migrationPlan("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS article_idx ON public.articles (id) WHERE id IS NOT NULL;");
  assert.deepEqual(plan, { kind: "index", index: "article_idx", table: "public.articles" });
  assert.throws(() => migrationPlan("CREATE INDEX CONCURRENTLY article_idx ON articles (id);"));
  assert.throws(() => migrationPlan("CREATE INDEX CONCURRENTLY IF NOT EXISTS article_idx ON articles (id); ALTER TABLE articles ADD COLUMN flag text;"));
});

test("comments and string literals cannot disguise dangerous statements or split safe defaults", () => {
  assert.equal(migrationPlan("/* outer /* nested */ comment */ ALTER TABLE articles ADD COLUMN note text DEFAULT 'CHECK; -- it''s text'; -- UPDATE articles\n").kind, "transaction");
  assert.throws(() => migrationPlan("CREATE /* misleading */ INDEX article_idx ON articles (id);"));
  assert.throws(() => migrationPlan("ALTER TABLE articles ADD COLUMN note text DEFAULT 'safe'; UPDATE articles SET note = 'all';"));
  assert.throws(() => migrationPlan("ALTER TABLE articles ADD COLUMN note text /* unfinished"));
});

test("online DDL cannot accumulate strong table locks across several otherwise safe statements", () => {
  assert.throws(() => migrationPlan("ALTER TABLE articles ADD COLUMN flag text; ALTER TABLE publications ADD COLUMN flag text;"), /one statement/);
  assert.throws(() => migrationPlan("CREATE TABLE example (id int); ALTER TABLE articles ADD COLUMN flag text;"), /one statement/);
});

test("statistics maintenance names one table and its columns without skipping work or evaluating expressions", () => {
  assert.equal(migrationPlan("CREATE STATISTICS article_release_stats (mcv) ON visibility, selected, seat, visible_after FROM publications;").kind, "statistics");
  assert.equal(migrationPlan("ANALYZE public.publications (visibility, selected, seat, visible_after);").kind, "statistics");
  assert.equal(migrationPlan('CREATE STATISTICS "public"."release_stats" (MCV) ON "selected", "visible_after" FROM public.publications;').kind, "statistics");
  assert.equal(migrationPlan('ANALYZE "public"."publications" ("selected");').kind, "statistics");
  for (const statement of [
    "CREATE STATISTICS IF NOT EXISTS article_release_stats (mcv) ON selected, visible_after FROM publications;",
    "CREATE STATISTICS article_release_stats ON selected, visible_after FROM publications;",
    "CREATE STATISTICS article_release_stats (mcv) ON selected, (random()) FROM publications;",
    "CREATE STATISTICS article_release_stats (dependencies) ON selected, visible_after FROM publications;",
    "CREATE STATISTICS article_release_stats (mcv, ndistinct) ON selected, visible_after FROM publications;",
    "CREATE STATISTICS article_release_stats (mcv) ON selected FROM publications;",
    "CREATE STATISTICS article_release_stats (mcv) ON selected, lower(title) FROM publications;",
    "CREATE STATISTICS article_release_stats (mcv) ON selected, (visible_after IS NOT NULL) FROM publications;",
    "CREATE STATISTICS article_release_stats (mcv) ON selected, visible_after FROM publications, articles;",
    "CREATE STATISTICS article_release_stats (mcv) ON selected, visible_after FROM publications; ANALYZE publications (selected, visible_after);",
    "ANALYZE;",
    "ANALYZE publications;",
    "ANALYZE VERBOSE publications (selected);",
    "ANALYZE publications(selected), articles(id);",
    "ANALYZE (SKIP_LOCKED) publications(selected);",
    "ANALYZE (SKIP_LOCKED true) publications(selected);",
    "ANALYZE publications (lower(title));",
    "ANALYZE publications(selected); UPDATE publications SET selected = false;",
    "ANALYZE publications (selected); SET statement_timeout = 0;",
    "VACUUM ANALYZE publications (selected);",
  ]) assert.throws(() => migrationPlan(statement), statement);
});

// `-- atomic` exists for exactly one reviewed migration. These cases keep it from becoming a general
// "run any SQL" switch: the declaration must be the first line, and the body must be the 0090 pair.
const ATOMIC_0090 = `-- atomic
-- Keep the source excerpt attached to each exact material version for history and provenance.
ALTER TABLE article_revisions ADD COLUMN excerpt text;

-- Recover the current version only when its stored content hash proves it is the same snapshot.
UPDATE article_revisions r SET excerpt = a.excerpt
FROM articles a
WHERE r.article_id = a.id AND r.revision = a.revision
  AND r.content_hash = a.content_hash AND r.excerpt IS NULL AND a.excerpt IS NOT NULL;
`;

test("the reviewed atomic migration (0090) is accepted as one transaction", () => {
  assert.deepEqual(migrationPlan(ATOMIC_0090), { kind: "transaction" });
});

test("the shipped 0090 file is exactly the reviewed migration", () => {
  const file = readFileSync(new URL("../database/migrations/0090_article_revision_excerpt.sql", import.meta.url), "utf8");
  assert.deepEqual(migrationPlan(file), { kind: "transaction" });
  assert.equal(file.split(/\r?\n/)[0], "-- atomic", "the declaration stays on the first line, alone");
});

test("an atomic declaration only works on the first line", () => {
  // Same two statements, declaration moved down: the normal one-statement rule applies and refuses it.
  const moved = ATOMIC_0090.replace("-- atomic\n", "");
  assert.throws(() => migrationPlan(`-- note first\n${moved}`), /one statement per online migration/);
  // The words between statements are not a declaration either: two statements stay refused.
  assert.throws(
    () => migrationPlan(`ALTER TABLE article_revisions ADD COLUMN note text;\n-- atomic\nUPDATE articles SET selected = true;`),
    /one statement per online migration/,
  );
});

// The declaration is a line, not a pattern: only horizontal whitespace may sit between the marker
// and its word, so a newline can never be part of the declaration.
test("the atomic declaration tolerates only horizontal whitespace on the very first line", () => {
  const body = ATOMIC_0090.replace("-- atomic\n", "");
  // Line endings the repository may carry: LF and CRLF both declare the same first line.
  assert.deepEqual(migrationPlan(`-- atomic\n${body}`), { kind: "transaction" });
  assert.deepEqual(migrationPlan(`-- atomic\r\n${body.replace(/\n/g, "\r\n")}`), { kind: "transaction" });
  assert.deepEqual(migrationPlan(`--   atomic \t\n${body}`), { kind: "transaction" }, "extra spaces and trailing tabs stay one declaration");
  // Anything that puts the word on another line, or before it another line, is not a declaration:
  // the whole file then has two statements and the ordinary one-statement rule refuses it.
  for (const broken of [
    `\n-- atomic\n${body}`,
    ` \n-- atomic\n${body}`,
    `\t\r\n-- atomic\n${body}`,
    `--\natomic\n${body}`,
    `--\r\natomic\n${body}`,
    `-- note\n-- atomic\n${body}`,
    `--atomic\n${body}`,
  ]) {
    assert.throws(() => migrationPlan(broken), /one statement per online migration/, JSON.stringify(broken.slice(0, 24)));
  }
});

test("the atomic word inside the file never declares an atomic migration", () => {
  // A comment between the statements is just a comment: the file is still two statements.
  assert.throws(() => migrationPlan(`ALTER TABLE article_revisions ADD COLUMN excerpt text;\n-- atomic\n${ATOMIC_0090.replace("-- atomic\n", "")}`), /one statement per online migration/);
  // A trailing word on the first line is not the declaration either.
  assert.throws(() => migrationPlan(`-- atomic!\n${ATOMIC_0090.replace("-- atomic\n", "")}`), /one statement per online migration/);
  // Nor does a blank first line let a later declaration in.
  assert.throws(() => migrationPlan(`\r\n${ATOMIC_0090}`), /one statement per online migration/);
});

test("an atomic migration refuses anything but the reviewed 0090 statements", () => {
  const withHeader = (body: string) => `-- atomic\n${body}`;
  const cases: Array<[string, RegExp]> = [
    ["UPDATE articles SET selected = true;", /limited to the reviewed 0090 statements/],
    ["DELETE FROM articles WHERE id = 'one';", /limited to the reviewed 0090 statements/],
    ["TRUNCATE articles;", /limited to the reviewed 0090 statements/],
    ["SELECT count(*) FROM articles;", /limited to the reviewed 0090 statements/],
    ["ALTER TABLE article_revisions ADD COLUMN excerpt text; DELETE FROM articles;", /limited to the reviewed 0090 statements/],
    ["ALTER TABLE article_revisions ADD COLUMN excerpt text;", /limited to the reviewed 0090 statements/],
    // A third statement, even a harmless one, is not the reviewed pair.
    [`${ATOMIC_0090.replace("-- atomic\n", "")}ALTER TABLE articles ADD COLUMN note text;`, /limited to the reviewed 0090 statements/],
    // The right statements with a different target column are a different migration.
    [ATOMIC_0090.replace("ADD COLUMN excerpt text", "ADD COLUMN body text"), /limited to the reviewed 0090 statements/],
    // The backfill must keep its guards; dropping the hash check would rewrite unrelated revisions.
    [ATOMIC_0090.replace("AND r.content_hash = a.content_hash ", ""), /limited to the reviewed 0090 statements/],
  ];
  for (const [body, expected] of cases) {
    assert.throws(() => migrationPlan(body.startsWith("-- atomic") ? body : withHeader(body)), expected, body.slice(0, 60));
  }
  // Function bodies stay refused before the atomic check ever runs.
  assert.throws(() => migrationPlan(withHeader("DO $$ BEGIN DELETE FROM articles; END $$;")), /SQL bodies are not online migrations/);
});
