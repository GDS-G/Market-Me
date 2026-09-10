import { createDatabaseClient } from "../client";
import { runMigrations } from "../migrations";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env or set the variable.");
}

const sql = createDatabaseClient(databaseUrl, { max: 1 });
try {
  const result = await runMigrations(sql);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
