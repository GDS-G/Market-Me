import { createDatabaseClient, OperationsRepository } from "@market-me/database";
import { objectStoreConfigurationFromEnvironment } from "@market-me/media";

export const EXPECTED_DATABASE_MIGRATION = "0108_mastodon_collection_alerts.sql";
export const EXPECTED_DATABASE_MIGRATION_COUNT = 108;

export const READINESS_CHECK_NAMES = [
  "database_configuration",
  "application_origin",
  "identity_configuration",
  "storage_configuration",
  "secret_configuration",
  "database_connection",
  "database_migrations",
  "ingestion_worker_freshness",
  "workflow_worker_freshness",
] as const;

export type ReadinessCheckName = (typeof READINESS_CHECK_NAMES)[number];
export type ReadinessCheckState = "ready" | "not_ready";

export interface WebReadiness {
  service: "market-me-web";
  status: "ready" | "not_ready";
  version: string;
  checkedAt: string;
  checks: Record<ReadinessCheckName, ReadinessCheckState>;
}

export interface DatabaseReadinessEvidence {
  migrationCount: number;
  latestMigration?: string;
  ingestionWorkerFresh: boolean;
  workflowWorkerFresh: boolean;
}

export async function checkWebReadiness(options: {
  version: string;
  environment?: Readonly<Record<string, string | undefined>>;
  probeDatabase?: (databaseUrl: string, workerHeartbeatMaxAgeSeconds: number) => Promise<DatabaseReadinessEvidence>;
  now?: Date;
}): Promise<WebReadiness> {
  const environment = options.environment ?? process.env;
  const checks = configurationChecks(environment);
  checks.database_connection = "not_ready";
  checks.database_migrations = "not_ready";
  const workersRequired = environment.NODE_ENV === "production";
  checks.ingestion_worker_freshness = workersRequired ? "not_ready" : "ready";
  checks.workflow_worker_freshness = workersRequired ? "not_ready" : "ready";
  const workerHeartbeatMaxAgeSeconds = parseWorkerHeartbeatMaxAge(environment.SERVICE_HEARTBEAT_MAX_AGE_SECONDS);
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (checks.database_configuration === "ready" && databaseUrl) {
    try {
      const evidence = await (options.probeDatabase ?? probeDatabase)(databaseUrl, workerHeartbeatMaxAgeSeconds ?? 120);
      checks.database_connection = "ready";
      if (evidence.migrationCount === EXPECTED_DATABASE_MIGRATION_COUNT
        && evidence.latestMigration === EXPECTED_DATABASE_MIGRATION) {
        checks.database_migrations = "ready";
      }
      if (workersRequired && workerHeartbeatMaxAgeSeconds) {
        checks.ingestion_worker_freshness = evidence.ingestionWorkerFresh ? "ready" : "not_ready";
        checks.workflow_worker_freshness = evidence.workflowWorkerFresh ? "ready" : "not_ready";
      }
    } catch {
      // Public readiness output intentionally collapses database errors to a closed state.
    }
  }
  const status = Object.values(checks).every((value) => value === "ready") ? "ready" : "not_ready";
  return {
    service: "market-me-web",
    status,
    version: options.version,
    checkedAt: (options.now ?? new Date()).toISOString(),
    checks,
  };
}

export function configurationChecks(
  environment: Readonly<Record<string, string | undefined>>,
): Record<ReadinessCheckName, ReadinessCheckState> {
  const production = environment.NODE_ENV === "production";
  const checks = Object.fromEntries(READINESS_CHECK_NAMES.map((name) => [name, "not_ready"])) as Record<ReadinessCheckName, ReadinessCheckState>;
  checks.database_configuration = validDatabaseUrl(environment.DATABASE_URL) ? "ready" : "not_ready";
  checks.application_origin = validOrigin(environment.APP_BASE_URL, production) ? "ready" : "not_ready";
  checks.identity_configuration = !production || validProductionIdentity(environment) ? "ready" : "not_ready";
  try {
    objectStoreConfigurationFromEnvironment(environment);
    checks.storage_configuration = "ready";
  } catch {
    checks.storage_configuration = "not_ready";
  }
  checks.secret_configuration = !production || validProductionSecrets(environment) ? "ready" : "not_ready";
  return checks;
}

async function probeDatabase(databaseUrl: string, workerHeartbeatMaxAgeSeconds: number): Promise<DatabaseReadinessEvidence> {
  const sql = createDatabaseClient(databaseUrl, { max: 1, idleTimeoutSeconds: 1, connectTimeoutSeconds: 5 });
  try {
    await sql`SELECT 1`;
    const rows = await sql<Array<{ migrationCount: number; latestMigration: string | null }>>`
      SELECT count(*)::int AS migration_count, max(version) AS latest_migration FROM schema_migration
    `;
    const migrationCount = rows[0]?.migrationCount ?? 0;
    const latestMigration = rows[0]?.latestMigration ?? undefined;
    if (migrationCount !== EXPECTED_DATABASE_MIGRATION_COUNT || latestMigration !== EXPECTED_DATABASE_MIGRATION) {
      return { migrationCount, latestMigration, ingestionWorkerFresh: false, workflowWorkerFresh: false };
    }
    const freshness = await new OperationsRepository(sql).getServiceFreshness(workerHeartbeatMaxAgeSeconds);
    return {
      migrationCount,
      latestMigration,
      ingestionWorkerFresh: freshness.ingestionWorker,
      workflowWorkerFresh: freshness.workflowWorker,
    };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function parseWorkerHeartbeatMaxAge(value: string | undefined): number | undefined {
  const seconds = Number(value ?? "120");
  return Number.isInteger(seconds) && seconds >= 15 && seconds <= 600 ? seconds : undefined;
}

function validDatabaseUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validOrigin(value: string | undefined, production: boolean): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return false;
    return production ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validProductionIdentity(environment: Readonly<Record<string, string | undefined>>): boolean {
  const issuer = environment.OIDC_ISSUER?.trim();
  if (!issuer || !environment.OIDC_CLIENT_ID?.trim()) return false;
  try {
    const url = new URL(issuer);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validProductionSecrets(environment: Readonly<Record<string, string | undefined>>): boolean {
  if (!base64Bytes(environment.CONNECTOR_TOKEN_ENCRYPTION_KEY, 32)) return false;
  if ((environment.MEDIA_ACCESS_SIGNING_KEY?.length ?? 0) < 32) return false;
  if (environment.AI_PROVIDER_EXECUTION_ENABLED?.trim().toLowerCase() === "true"
    && !base64Bytes(environment.AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY, 32)) return false;
  const alertKey = environment.AI_OPERATIONAL_ALERT_ENCRYPTION_KEY;
  const alertHosts = environment.AI_OPERATIONAL_ALERT_ALLOWED_HOSTS?.trim();
  if (Boolean(alertKey) !== Boolean(alertHosts) || (alertKey && !base64Bytes(alertKey, 32))) return false;
  const webhookOrigin = environment.PUBLIC_WEBHOOK_BASE_URL;
  if (webhookOrigin && !validOrigin(webhookOrigin, true)) return false;
  return true;
}

function base64Bytes(value: string | undefined, expectedBytes: number): boolean {
  if (!value?.trim() || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(value.trim())) return false;
  try {
    return Buffer.from(value.trim(), "base64").byteLength === expectedBytes;
  } catch {
    return false;
  }
}
