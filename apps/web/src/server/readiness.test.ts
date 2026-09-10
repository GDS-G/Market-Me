import { describe, expect, it, vi } from "vitest";
import { checkWebReadiness, configurationChecks, EXPECTED_DATABASE_MIGRATION, EXPECTED_DATABASE_MIGRATION_COUNT } from "./readiness";

const key = Buffer.alloc(32, 7).toString("base64");
const productionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app:secret@database.internal/market_me",
  APP_BASE_URL: "https://market-me.example.test",
  OIDC_ISSUER: "https://identity.example.test",
  OIDC_CLIENT_ID: "market-me",
  MEDIA_OBJECT_STORE: "s3",
  MEDIA_S3_BUCKET: "market-me-production",
  MEDIA_S3_REGION: "us-east-1",
  CONNECTOR_TOKEN_ENCRYPTION_KEY: key,
  MEDIA_ACCESS_SIGNING_KEY: "m".repeat(32),
} as const;

describe("web readiness", () => {
  it("accepts a complete production configuration without exposing its values", async () => {
    expect(configurationChecks(productionEnvironment)).toMatchObject({
      database_configuration: "ready",
      application_origin: "ready",
      identity_configuration: "ready",
      storage_configuration: "ready",
      secret_configuration: "ready",
    });
    const readiness = await checkWebReadiness({
      version: "1.4.0",
      environment: productionEnvironment,
      now: new Date("2026-08-12T06:00:00.000Z"),
      probeDatabase: vi.fn().mockResolvedValue({
        migrationCount: EXPECTED_DATABASE_MIGRATION_COUNT,
        latestMigration: EXPECTED_DATABASE_MIGRATION,
        ingestionWorkerFresh: true,
        workflowWorkerFresh: true,
      }),
    });
    expect(readiness).toEqual({
      service: "market-me-web",
      status: "ready",
      version: "1.4.0",
      checkedAt: "2026-08-12T06:00:00.000Z",
      checks: {
        database_configuration: "ready",
        application_origin: "ready",
        identity_configuration: "ready",
        storage_configuration: "ready",
        secret_configuration: "ready",
        database_connection: "ready",
        database_migrations: "ready",
        ingestion_worker_freshness: "ready",
        workflow_worker_freshness: "ready",
      },
    });
    expect(JSON.stringify(readiness)).not.toContain("app:secret");
    expect(JSON.stringify(readiness)).not.toContain("database.internal");
  });

  it("fails closed for unsafe production configuration without probing the database", async () => {
    const probeDatabase = vi.fn();
    const readiness = await checkWebReadiness({ version: "1.4.0", environment: { NODE_ENV: "production" }, probeDatabase });
    expect(readiness.status).toBe("not_ready");
    expect(Object.values(readiness.checks)).toEqual(Array(9).fill("not_ready"));
    expect(probeDatabase).not.toHaveBeenCalled();
  });

  it("separates connection success from migration readiness and hides probe errors", async () => {
    const stale = await checkWebReadiness({
      version: "1.4.0",
      environment: productionEnvironment,
      probeDatabase: vi.fn().mockResolvedValue({
        migrationCount: 90,
        latestMigration: "0090_workspace_invitations.sql",
        ingestionWorkerFresh: false,
        workflowWorkerFresh: false,
      }),
    });
    expect(stale.status).toBe("not_ready");
    expect(stale.checks.database_connection).toBe("ready");
    expect(stale.checks.database_migrations).toBe("not_ready");
    expect(stale.checks.ingestion_worker_freshness).toBe("not_ready");
    expect(stale.checks.workflow_worker_freshness).toBe("not_ready");

    const unavailable = await checkWebReadiness({
      version: "1.4.0",
      environment: productionEnvironment,
      probeDatabase: vi.fn().mockRejectedValue(new Error("password super-secret host database.internal")),
    });
    expect(unavailable.checks.database_connection).toBe("not_ready");
    expect(JSON.stringify(unavailable)).not.toContain("super-secret");
    expect(JSON.stringify(unavailable)).not.toContain("database.internal");
  });

  it("fails production readiness when either worker is stale and ignores worker freshness in development", async () => {
    const probeDatabase = vi.fn().mockResolvedValue({
      migrationCount: EXPECTED_DATABASE_MIGRATION_COUNT,
      latestMigration: EXPECTED_DATABASE_MIGRATION,
      ingestionWorkerFresh: true,
      workflowWorkerFresh: false,
    });
    const production = await checkWebReadiness({ version: "1.4.0", environment: productionEnvironment, probeDatabase });
    expect(production.status).toBe("not_ready");
    expect(production.checks.ingestion_worker_freshness).toBe("ready");
    expect(production.checks.workflow_worker_freshness).toBe("not_ready");

    const development = await checkWebReadiness({
      version: "1.4.0",
      environment: {
        NODE_ENV: "development",
        DATABASE_URL: productionEnvironment.DATABASE_URL,
        APP_BASE_URL: "http://localhost:3000",
        MEDIA_OBJECT_STORE: "filesystem",
      },
      probeDatabase,
    });
    expect(development.status).toBe("ready");
    expect(development.checks.ingestion_worker_freshness).toBe("ready");
    expect(development.checks.workflow_worker_freshness).toBe("ready");
  });

  it("rejects an invalid production heartbeat maximum age", async () => {
    const readiness = await checkWebReadiness({
      version: "1.4.0",
      environment: { ...productionEnvironment, SERVICE_HEARTBEAT_MAX_AGE_SECONDS: "0" },
      probeDatabase: vi.fn().mockResolvedValue({
        migrationCount: EXPECTED_DATABASE_MIGRATION_COUNT,
        latestMigration: EXPECTED_DATABASE_MIGRATION,
        ingestionWorkerFresh: true,
        workflowWorkerFresh: true,
      }),
    });
    expect(readiness.status).toBe("not_ready");
    expect(readiness.checks.ingestion_worker_freshness).toBe("not_ready");
    expect(readiness.checks.workflow_worker_freshness).toBe("not_ready");
  });

  it("rejects insecure origins, filesystem production storage, and malformed secret pairs", () => {
    expect(configurationChecks({ ...productionEnvironment, APP_BASE_URL: "http://market-me.example.test" }).application_origin).toBe("not_ready");
    expect(configurationChecks({ ...productionEnvironment, MEDIA_OBJECT_STORE: "filesystem" }).storage_configuration).toBe("not_ready");
    expect(configurationChecks({ ...productionEnvironment, CONNECTOR_TOKEN_ENCRYPTION_KEY: "short" }).secret_configuration).toBe("not_ready");
    expect(configurationChecks({ ...productionEnvironment, AI_OPERATIONAL_ALERT_ALLOWED_HOSTS: "alerts.example.test" }).secret_configuration).toBe("not_ready");
  });
});
