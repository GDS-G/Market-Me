import type { DatabaseClient } from "./client";

export const SERVICE_NAMES = ["ingestion_worker", "workflow_worker"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface ServiceHeartbeat {
  service: ServiceName;
  instanceId: string;
  version: string;
}

export interface ServiceFreshness {
  ingestionWorker: boolean;
  workflowWorker: boolean;
}

export class OperationsRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async recordServiceHeartbeat(heartbeat: ServiceHeartbeat): Promise<void> {
    await this.sql`
      INSERT INTO service_heartbeat (service, instance_id, version, started_at, last_seen_at, stopped_at)
      VALUES (${heartbeat.service}, ${heartbeat.instanceId}, ${heartbeat.version}, now(), now(), NULL)
      ON CONFLICT (service, instance_id) DO UPDATE SET
        version = EXCLUDED.version,
        last_seen_at = now(),
        stopped_at = NULL
    `;
  }

  async stopServiceHeartbeat(service: ServiceName, instanceId: string): Promise<void> {
    await this.sql`
      UPDATE service_heartbeat
      SET last_seen_at = now(), stopped_at = now()
      WHERE service = ${service} AND instance_id = ${instanceId}
    `;
  }

  async getServiceFreshness(maxAgeSeconds: number): Promise<ServiceFreshness> {
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 15 || maxAgeSeconds > 600) {
      throw new Error("Worker heartbeat maximum age must be an integer from 15 through 600 seconds");
    }
    const rows = await this.sql<ServiceFreshness[]>`
      SELECT
        COALESCE(bool_or(last_seen_at >= now() - make_interval(secs => ${maxAgeSeconds}))
          FILTER (WHERE service = 'ingestion_worker' AND stopped_at IS NULL), false) AS ingestion_worker,
        COALESCE(bool_or(last_seen_at >= now() - make_interval(secs => ${maxAgeSeconds}))
          FILTER (WHERE service = 'workflow_worker' AND stopped_at IS NULL), false) AS workflow_worker
      FROM service_heartbeat
    `;
    return rows[0] ?? { ingestionWorker: false, workflowWorker: false };
  }
}

export interface ServiceHeartbeatLeaseOptions extends ServiceHeartbeat {
  intervalSeconds: number;
  onError?: (error: unknown) => void;
}

export class ServiceHeartbeatLease {
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;
  private active = false;

  constructor(
    private readonly repository: OperationsRepository,
    private readonly options: ServiceHeartbeatLeaseOptions,
  ) {
    if (!Number.isInteger(options.intervalSeconds) || options.intervalSeconds < 5 || options.intervalSeconds > 60) {
      throw new Error("SERVICE_HEARTBEAT_INTERVAL_SECONDS must be an integer from 5 through 60");
    }
  }

  async start(): Promise<void> {
    if (this.active) throw new Error("Service heartbeat lease is already active");
    this.active = true;
    try {
      await this.pulse();
    } catch (error) {
      this.active = false;
      throw error;
    }
    this.timer = setInterval(() => void this.pulse().catch(() => undefined), this.options.intervalSeconds * 1000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    try {
      await this.inFlight;
    } catch {
      // Attempt the explicit stop even when the last pulse failed.
    }
    await this.repository.stopServiceHeartbeat(this.options.service, this.options.instanceId);
  }

  private async pulse(): Promise<void> {
    if (!this.active || this.inFlight) return;
    const write = this.repository.recordServiceHeartbeat(this.options);
    this.inFlight = write;
    try {
      await write;
    } catch (error) {
      this.options.onError?.(error);
      throw error;
    } finally {
      this.inFlight = undefined;
    }
  }
}
