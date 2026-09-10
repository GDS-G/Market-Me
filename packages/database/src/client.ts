import postgres from "postgres";

export type DatabaseClient = ReturnType<typeof postgres>;

export interface DatabaseOptions {
  max?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
}

export function createDatabaseClient(
  databaseUrl: string,
  options: DatabaseOptions = {},
): DatabaseClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return postgres(databaseUrl, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    transform: postgres.camel,
  });
}
