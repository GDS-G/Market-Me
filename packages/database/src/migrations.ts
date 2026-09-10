import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseClient } from "./client";

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export interface MigrationResult {
  applied: readonly string[];
  skipped: readonly string[];
}

export async function runMigrations(sql: DatabaseClient): Promise<MigrationResult> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version text PRIMARY KEY,
      checksum text,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const source = await readFile(resolve(migrationDirectory, file), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const existing = await sql<{ checksum: string | null }[]>`
      SELECT checksum FROM schema_migration WHERE version = ${file}
    `;

    if (existing.length > 0) {
      if (existing[0].checksum && existing[0].checksum !== checksum) {
        throw new Error(`Applied migration ${file} has changed`);
      }
      skipped.push(file);
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction.unsafe(source);
      await transaction`
        INSERT INTO schema_migration (version, checksum)
        VALUES (${file}, ${checksum})
      `;
    });
    applied.push(file);
  }

  return { applied, skipped };
}
