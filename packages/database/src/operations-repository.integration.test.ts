import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { OperationsRepository } from "./operations-repository";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("operations repository", () => {
  afterAll(async () => sql?.end());

  it("reports only active and fresh worker instances", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new OperationsRepository(sql);
    const ingestionInstanceId = randomUUID();
    const workflowInstanceId = randomUUID();
    try {
      await repository.recordServiceHeartbeat({
        service: "ingestion_worker",
        instanceId: ingestionInstanceId,
        version: "1.4.0-test",
      });
      await repository.recordServiceHeartbeat({
        service: "workflow_worker",
        instanceId: workflowInstanceId,
        version: "1.4.0-test",
      });
      await expect(repository.getServiceFreshness(120)).resolves.toEqual({
        ingestionWorker: true,
        workflowWorker: true,
      });

      await repository.stopServiceHeartbeat("ingestion_worker", ingestionInstanceId);
      await expect(repository.getServiceFreshness(120)).resolves.toEqual({
        ingestionWorker: false,
        workflowWorker: true,
      });
      await expect(repository.getServiceFreshness(14)).rejects.toThrow("15 through 600");
    } finally {
      await sql`DELETE FROM service_heartbeat WHERE instance_id IN (${ingestionInstanceId}, ${workflowInstanceId})`;
    }
  });
});
