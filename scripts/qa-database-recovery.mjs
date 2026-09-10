import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const container = process.env.QA_POSTGRES_CONTAINER ?? "market-me-postgres-1";
const sourceDatabase = process.env.QA_DATABASE_SOURCE ?? "market_me";
const databaseUser = process.env.QA_DATABASE_USER ?? "market_me";
const acknowledgedQuiesced = process.env.QA_DATABASE_RECOVERY_ACKNOWLEDGE_QUIESCED === "true";
const suffix = randomBytes(6).toString("hex");
const restoreDatabase = `market_me_restore_qa_${suffix}`;
const dumpPath = `/tmp/market-me-recovery-${suffix}.dump`;

for (const [name, value] of [["QA_POSTGRES_CONTAINER", container], ["QA_DATABASE_SOURCE", sourceDatabase], ["QA_DATABASE_USER", databaseUser]]) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/u.test(value)) throw new Error(`${name} contains unsupported characters`);
}
if (["postgres", "template0", "template1"].includes(sourceDatabase)) throw new Error("QA_DATABASE_SOURCE must be an application database");
if (!acknowledgedQuiesced) {
  throw new Error("Set QA_DATABASE_RECOVERY_ACKNOWLEDGE_QUIESCED=true only after stopping application writers");
}

const startedAt = Date.now();
let createdRestoreDatabase = false;
try {
  await docker(["inspect", "--format", "{{.State.Running}}", container]);
  const sourceTablesBefore = await tableCounts(sourceDatabase);
  assert.ok(sourceTablesBefore.size > 0, "Source database did not contain public tables");
  const sourceMigrations = await migrationEvidence(sourceDatabase);

  await docker(["exec", container, "pg_dump", "--username", databaseUser, "--dbname", sourceDatabase,
    "--format", "custom", "--compress", "6", "--no-owner", "--no-privileges", "--file", dumpPath]);
  const listing = await docker(["exec", container, "pg_restore", "--list", dumpPath]);
  assert.match(listing, /TABLE DATA public/u, "Logical backup did not contain table data entries");

  const sourceTablesAfter = await tableCounts(sourceDatabase);
  assert.deepEqual(sourceTablesAfter, sourceTablesBefore, "Source rows changed during backup; repeat with writers stopped");

  await docker(["exec", container, "createdb", "--username", databaseUser, "--template", "template0", restoreDatabase]);
  createdRestoreDatabase = true;
  await docker(["exec", container, "pg_restore", "--username", databaseUser, "--dbname", restoreDatabase,
    "--exit-on-error", "--no-owner", "--no-privileges", dumpPath]);

  const restoredTables = await tableCounts(restoreDatabase);
  assert.deepEqual(restoredTables, sourceTablesBefore, "Restored table inventory or row counts did not match the backup source");
  assert.equal(await migrationEvidence(restoreDatabase), sourceMigrations, "Restored migration evidence did not match the source");
  assert.equal(await scalar(restoreDatabase,
    "SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated"), "0",
  "Restored database contained unvalidated public constraints");

  const durationMs = Date.now() - startedAt;
  console.log(JSON.stringify({
    event: "qa.database_recovery.accepted",
    sourceDatabase,
    restoredDatabase: restoreDatabase,
    publicTableCount: sourceTablesBefore.size,
    migrationCount: sourceMigrations.split("\n").filter(Boolean).length,
    durationMs,
    checks: ["consistent-logical-backup", "archive-listing", "clean-restore", "all-table-row-counts", "migration-checksums", "validated-constraints"],
    qualification: "local QA evidence only; not a production RPO or RTO",
  }));
} finally {
  if (createdRestoreDatabase) {
    await docker(["exec", container, "dropdb", "--username", databaseUser, "--if-exists", "--force", restoreDatabase]).catch(() => undefined);
  }
  await docker(["exec", container, "rm", "-f", "--", dumpPath]).catch(() => undefined);
}

async function tableCounts(database) {
  const tableOutput = await psql(database,
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const tables = tableOutput.split("\n").map((value) => value.trim()).filter(Boolean);
  for (const table of tables) if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(table)) throw new Error("Database contained an unsupported table identifier");
  const counts = new Map();
  for (const table of tables) counts.set(table, await scalar(database, `SELECT count(*) FROM public."${table}"`));
  return counts;
}

async function migrationEvidence(database) {
  return psql(database, "SELECT version || E'\\t' || coalesce(checksum, '') FROM schema_migration ORDER BY version");
}

async function scalar(database, sql) {
  return (await psql(database, sql)).trim();
}

async function psql(database, sql) {
  return docker(["exec", container, "psql", "--username", databaseUser, "--dbname", database,
    "--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", sql]);
}

async function docker(args) {
  const { stdout } = await execute("docker", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return stdout.trim();
}
