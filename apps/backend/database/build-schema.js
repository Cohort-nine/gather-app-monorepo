// ---------------------------------------------------------------------------
// Regenerate database/schema.sql from the Prisma migration history.
//
// WHY THIS EXISTS
// The project can create its database two ways: `prisma migrate deploy`, or
// plain `psql -f database/schema.sql`. Both have to produce the same database.
// They didn't — schema.sql was being maintained by hand and silently drifted
// from the migrations: same 21 table names, different columns in 10 of them,
// and no password_hash at all, so auth couldn't work on the raw-SQL path.
//
// The fix is to stop hand-maintaining it. The migrations are the source of
// truth — they are what actually built the database the Express/Prisma code
// runs against — so schema.sql is derived from them instead.
//
// USAGE
//   npm run sql:build     rewrite database/schema.sql
//   npm run sql:check     exit non-zero if schema.sql is out of date
//
// Run sql:build after every `prisma migrate dev`, and commit both files
// together. sql:check is the safety net if you forget.
// ---------------------------------------------------------------------------

import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const MIGRATIONS = path.join(BACKEND, "prisma", "migrations");
const OUTPUT = path.join(HERE, "schema.sql");

/**
 * Migration directories are named <timestamp>_<label>, so lexical order is
 * chronological order. Reading the directory rather than hardcoding names
 * means this keeps working when you add migration number three.
 */
async function readMigrations() {
  const entries = await readdir(MIGRATIONS, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (dirs.length === 0) {
    throw new Error(`No migrations found in ${MIGRATIONS}`);
  }

  return Promise.all(
    dirs.map(async (name) => ({
      name,
      sql: await readFile(path.join(MIGRATIONS, name, "migration.sql"), "utf8")
    }))
  );
}

/**
 * Prisma annotates every statement with a comment describing what kind of
 * statement follows. Useful in a migration diff, pure noise in a schema file.
 */
function stripPrismaComments(sql) {
  return sql
    .replace(/^-- (CreateTable|CreateEnum|CreateIndex|AddForeignKey|AlterTable|DropIndex)\r?\n/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Pull `ALTER TABLE "x" ADD COLUMN ...` statements out of later migrations so
 * they can be folded into the original CREATE TABLE.
 *
 * schema.sql should read as the CURRENT state of the database, not a replay of
 * how it got there — someone reading `CREATE TABLE users` should see every
 * column, not discover four hundred lines later that two more were bolted on.
 *
 * Only pure ADD COLUMN statements are folded. Anything else (DROP COLUMN,
 * ALTER COLUMN, renames) is left alone and appended verbatim, because
 * rewriting those correctly means replaying them in order — which is what the
 * migrations already do. Better a slightly uglier file than a wrong one.
 */
function extractAddColumns(sql) {
  const columnsByTable = new Map();

  const remaining = sql.replace(
    /ALTER TABLE "(\w+)"\s+((?:ADD COLUMN\s+"[^"]+"[^,;]*,?\s*)+);/g,
    (statement, table, body) => {
      const columns = [...body.matchAll(/ADD COLUMN\s+("[^"]+"[^,;]*?)\s*(?=,\s*ADD COLUMN|$)/g)].map(
        (m) => m[1].trim()
      );

      // Bail out and keep the original statement if the parse looks wrong.
      if (columns.length === 0) return statement;

      if (!columnsByTable.has(table)) columnsByTable.set(table, []);
      columnsByTable.get(table).push(...columns);
      return "";
    }
  );

  return { columnsByTable, remaining: remaining.trim() };
}

/**
 * Insert the folded columns just before the table's trailing CONSTRAINT line
 * (or before the closing paren if there isn't one), matching Prisma's own
 * formatting so the result looks hand-written rather than stitched together.
 */
function foldColumnsIntoCreateTable(sql, columnsByTable) {
  let result = sql;

  for (const [table, columns] of columnsByTable) {
    const createTable = new RegExp(`(CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);)`, "m");
    const match = result.match(createTable);

    if (!match) {
      throw new Error(
        `Cannot fold columns into "${table}": no CREATE TABLE found. ` +
          `Add the migration manually or extend this script.`
      );
    }

    const block = match[1];
    const addition = columns.map((c) => `    ${c},`).join("\n");

    // Prisma puts a blank line before the trailing CONSTRAINT ... PRIMARY KEY.
    const constraintLine = block.match(/\n\n {4}CONSTRAINT [^\n]*\n\);$/);

    const updated = constraintLine
      ? block.replace(constraintLine[0], `\n${addition}${constraintLine[0]}`)
      : block.replace(/\n\);$/, `\n${addition}\n);`);

    result = result.replace(block, updated);
  }

  return result;
}

function buildHeader(migrationNames) {
  const sources = migrationNames.map((n) => `--            prisma/migrations/${n}/migration.sql`);
  sources[0] = sources[0].replace("--           ", "--   Source: ");

  return `-- ============================================================================
-- GATHER — PostgreSQL schema
--
-- GENERATED FILE. Do not hand-edit — run \`npm run sql:build\` instead.
${sources.join("\n")}
--
-- This file exists so the database can be created with plain SQL instead of
-- Prisma. It is generated from the migrations rather than maintained by hand,
-- because a hand-kept copy silently drifted from the Prisma schema once
-- already — same 21 table names, different columns in 10 of them.
--
-- Two rules the whole schema leans on:
--   - Scores are DERIVED, never authored. The ledgers (rsvp_status_events,
--     attendance, host_ratings) are the source of truth; attendee_reliability
--     and host_reputation are caches you can rebuild from scratch at any time.
--   - Every state change that could affect a score is timestamped relative to
--     event start, so "cancelled with notice" vs "ghosted" is answerable from
--     data rather than guessed at.
--
-- Usage:
--   npm run sql:schema        # then: npm run sql:seed
--
-- Requires PostgreSQL 14+.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONS
-- citext — case-insensitive handles, emails, and tags, so "Maya" and "maya"
--          collide on the UNIQUE index instead of both being accepted.
--
-- pgcrypto is deliberately NOT required. gen_random_uuid() has been built into
-- core PostgreSQL since 13, and \`CREATE EXTENSION pgcrypto\` hard-fails on
-- managed providers that don't allowlist it — so asking for it buys nothing
-- and can break a deploy.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "citext";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

`;
}

async function build() {
  const migrations = await readMigrations();
  const [first, ...rest] = migrations;

  // The initial migration already declares citext; the generated header takes
  // that over so extension setup lives in exactly one place.
  let body = stripPrismaComments(first.sql);
  const citext = 'CREATE EXTENSION IF NOT EXISTS "citext";';
  if (body.includes(citext)) {
    body = body.slice(body.indexOf(citext) + citext.length).replace(/^\s*\n/, "");
  }

  const folded = new Map();
  const leftovers = [];

  for (const migration of rest) {
    const { columnsByTable, remaining } = extractAddColumns(stripPrismaComments(migration.sql));

    for (const [table, columns] of columnsByTable) {
      if (!folded.has(table)) folded.set(table, []);
      folded.get(table).push(...columns);
    }

    if (remaining) leftovers.push({ name: migration.name, sql: remaining });
  }

  body = foldColumnsIntoCreateTable(body, folded);

  // Anything that couldn't be folded is replayed in order at the end, clearly
  // labelled, so nothing is ever silently dropped.
  if (leftovers.length > 0) {
    body +=
      "\n\n-- ----------------------------------------------------------------------------\n" +
      "-- LATER MIGRATIONS\n" +
      "-- Statements that can't be folded into a CREATE TABLE, replayed in order.\n" +
      "-- ----------------------------------------------------------------------------\n\n" +
      leftovers.map((m) => `-- ${m.name}\n${m.sql}`).join("\n\n") +
      "\n";
  }

  return buildHeader(migrations.map((m) => m.name)) + body;
}

async function main() {
  const schema = await build();
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    const current = await readFile(OUTPUT, "utf8").catch(() => null);

    if (current === schema) {
      console.log("schema.sql is up to date with the migrations.");
      return;
    }

    console.error(
      "schema.sql is OUT OF DATE with prisma/migrations.\n" +
        "Run `npm run sql:build` and commit the result."
    );
    process.exitCode = 1;
    return;
  }

  await writeFile(OUTPUT, schema);
  console.log(`Wrote ${path.relative(BACKEND, OUTPUT)} (${schema.split("\n").length} lines)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
