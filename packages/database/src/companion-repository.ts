import { randomBytes, randomUUID } from "node:crypto";
import { hashCompanionSecret, type CompanionAction, type CompanionActionMode, type CompanionJobStatus, type CompanionPlatform, type CompanionWorkerStatus } from "@market-me/companion-protocol";
import type { JSONValue } from "postgres";
import type { DatabaseClient } from "./client";

export interface StoredCompanionWorker {
  id: string;
  workspaceId: string;
  name: string;
  platform: CompanionPlatform;
  architecture: "x86_64" | "aarch64";
  appVersion: string;
  status: CompanionWorkerStatus;
  healthState: "healthy" | "working" | "needs_attention" | "disconnected";
  effectiveHealthState: "healthy" | "working" | "needs_attention" | "disconnected";
  tokenPrefix: string;
  capabilities: Record<string, boolean>;
  healthDetails: Record<string, unknown>;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}

export interface StoredCompanionJob {
  id: string;
  workspaceId: string;
  workerId: string;
  campaignInstanceId?: string;
  campaignStepRunId?: string;
  action: CompanionAction;
  actionMode: CompanionActionMode;
  targetUrl: string;
  expectedOrigin: string;
  allowedDomains: string[];
  instructions: string;
  status: CompanionJobStatus;
  idempotencyKey: string;
  leaseExpiresAt?: string;
  attemptCount: number;
  result: Record<string, unknown>;
  lastError?: string;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface LocalSourceAssignment {
  id: string;
  workspaceId: string;
  name: string;
  recursive: boolean;
  allowedMimeTypes: string[];
  ignorePatterns: string[];
}

export class CompanionRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async createPairingCode(input: { workspaceId: string; codeHash: string; expiresAt: Date; createdBy: string }): Promise<string> {
    const id = randomUUID();
    await this.sql`
      INSERT INTO companion_pairing_code (id, workspace_id, code_hash, expires_at, created_by)
      VALUES (${id}, ${input.workspaceId}, ${input.codeHash}, ${input.expiresAt}, ${input.createdBy})
    `;
    return id;
  }

  async pairWorker(input: {
    codeHash: string;
    name: string;
    platform: CompanionPlatform;
    architecture: "x86_64" | "aarch64";
    appVersion: string;
    tokenPrefix: string;
    tokenHash: string;
  }): Promise<StoredCompanionWorker | undefined> {
    const rows = await this.sql<StoredCompanionWorker[]>`
      WITH pairing AS (
        UPDATE companion_pairing_code
        SET used_at = now()
        WHERE code_hash = ${input.codeHash} AND used_at IS NULL AND expires_at > now()
        RETURNING workspace_id
      )
      INSERT INTO browser_worker (id, workspace_id, name, platform, architecture, app_version, token_prefix, token_hash)
      SELECT ${randomUUID()}, workspace_id, ${input.name}, ${input.platform}, ${input.architecture}, ${input.appVersion}, ${input.tokenPrefix}, ${input.tokenHash}
      FROM pairing
      RETURNING id, workspace_id, name, platform, architecture, app_version, status, health_state,
        health_state AS effective_health_state, token_prefix, capabilities, health_details, last_seen_at,
        created_at, updated_at, revoked_at
    `;
    return rows[0];
  }

  async authenticateWorker(secret: string): Promise<StoredCompanionWorker | undefined> {
    return (await this.sql<StoredCompanionWorker[]>`
      SELECT id, workspace_id, name, platform, architecture, app_version, status, health_state,
        CASE WHEN last_seen_at IS NULL OR last_seen_at < now() - interval '90 seconds' THEN 'disconnected' ELSE health_state END AS effective_health_state,
        token_prefix, capabilities, health_details, last_seen_at, created_at, updated_at, revoked_at
      FROM browser_worker WHERE token_hash = ${hashCompanionSecret(secret)}
    `)[0];
  }

  async listWorkers(workspaceId: string): Promise<StoredCompanionWorker[]> {
    return this.sql<StoredCompanionWorker[]>`
      SELECT id, workspace_id, name, platform, architecture, app_version, status, health_state,
        CASE WHEN last_seen_at IS NULL OR last_seen_at < now() - interval '90 seconds' THEN 'disconnected' ELSE health_state END AS effective_health_state,
        token_prefix, capabilities, health_details, last_seen_at, created_at, updated_at, revoked_at
      FROM browser_worker WHERE workspace_id = ${workspaceId} ORDER BY updated_at DESC
    `;
  }

  async listLocalSourceAssignments(workerId: string): Promise<LocalSourceAssignment[]> {
    return this.sql<LocalSourceAssignment[]>`
      SELECT DISTINCT source.id, source.workspace_id, source.name, source.recursive,
        source.allowed_mime_types, source.ignore_patterns
      FROM browser_worker worker
      JOIN smart_source source ON source.workspace_id = worker.workspace_id
      JOIN smart_source_location location ON location.smart_source_id = source.id
      WHERE worker.id = ${workerId} AND worker.status = 'active'
        AND worker.last_seen_at >= now() - interval '90 seconds'
        AND worker.health_state IN ('healthy', 'working')
        AND worker.capabilities->>'localFolderIngestion' = 'true'
        AND source.provider = 'local' AND source.enabled = true
        AND location.provider_location_id = worker.id::text
      ORDER BY source.name
    `;
  }

  async heartbeat(input: {
    workerId: string;
    appVersion: string;
    platform: CompanionPlatform;
    architecture: "x86_64" | "aarch64";
    healthState: "healthy" | "working" | "needs_attention";
    capabilities: Record<string, boolean>;
    details: Record<string, unknown>;
  }): Promise<StoredCompanionWorker | undefined> {
    return (await this.sql<StoredCompanionWorker[]>`
      UPDATE browser_worker SET app_version = ${input.appVersion}, platform = ${input.platform}, architecture = ${input.architecture},
        health_state = ${input.healthState}, capabilities = ${this.sql.json(input.capabilities as JSONValue)},
        health_details = ${this.sql.json(input.details as JSONValue)}, last_seen_at = now(), updated_at = now()
      WHERE id = ${input.workerId} AND status <> 'revoked'
      RETURNING id, workspace_id, name, platform, architecture, app_version, status, health_state,
        health_state AS effective_health_state, token_prefix, capabilities, health_details, last_seen_at,
        created_at, updated_at, revoked_at
    `)[0];
  }

  async setWorkerStatus(workspaceId: string, workerId: string, status: CompanionWorkerStatus): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      WITH changed AS (
        UPDATE browser_worker SET status = ${status}, revoked_at = CASE WHEN ${status} = 'revoked' THEN now() ELSE NULL END, updated_at = now()
        WHERE workspace_id = ${workspaceId} AND id = ${workerId} AND status <> 'revoked'
        RETURNING id
      ), canceled AS (
        UPDATE browser_job SET status = 'canceled', completed_at = now(), updated_at = now(), last_error = 'Worker revoked'
        WHERE worker_id IN (SELECT id FROM changed) AND ${status} = 'revoked' AND status IN ('queued', 'claimed')
      )
      SELECT id FROM changed
    `;
    return Boolean(rows[0]);
  }

  async createJob(input: {
    workspaceId: string;
    workerId: string;
    action: CompanionAction;
    actionMode: CompanionActionMode;
    targetUrl: string;
    expectedOrigin: string;
    allowedDomains: string[];
    instructions: string;
    idempotencyKey: string;
    createdBy: string;
    campaignInstanceId?: string;
    campaignStepRunId?: string;
  }): Promise<StoredCompanionJob> {
    if (Boolean(input.campaignInstanceId) !== Boolean(input.campaignStepRunId)) throw new Error("Campaign instance and step run must be provided together");
    if (input.campaignInstanceId && input.campaignStepRunId) {
      const binding = await this.sql<{ id: string }[]>`
        SELECT r.id FROM campaign_step_run r
        JOIN campaign_instance i ON i.id = r.campaign_instance_id
        WHERE i.id = ${input.campaignInstanceId} AND r.id = ${input.campaignStepRunId}
          AND i.workspace_id = ${input.workspaceId}
      `;
      if (!binding[0]) throw new Error("Campaign step does not belong to the companion job workspace");
    }
    await this.sql`
      INSERT INTO browser_job (id, workspace_id, worker_id, campaign_instance_id, campaign_step_run_id,
        action, action_mode, target_url, expected_origin, allowed_domains, instructions, idempotency_key, created_by)
      VALUES (${randomUUID()}, ${input.workspaceId}, ${input.workerId},
        ${input.campaignInstanceId ?? null}, ${input.campaignStepRunId ?? null}, ${input.action}, ${input.actionMode},
        ${input.targetUrl}, ${input.expectedOrigin}, ${this.sql.json(input.allowedDomains as JSONValue)}, ${input.instructions},
        ${input.idempotencyKey}, ${input.createdBy})
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
    const job = (await this.sql<StoredCompanionJob[]>`
      SELECT id, workspace_id, worker_id, campaign_instance_id, campaign_step_run_id,
        action, action_mode, target_url, expected_origin, allowed_domains,
        instructions, status, idempotency_key, lease_expires_at, attempt_count, result, last_error,
        created_by, created_at, started_at, completed_at, updated_at
      FROM browser_job WHERE workspace_id = ${input.workspaceId} AND idempotency_key = ${input.idempotencyKey}
    `)[0];
    if (!job) throw new Error("The idempotency key is already used outside this workspace");
    return job;
  }

  async listJobs(workspaceId: string, limit = 50): Promise<StoredCompanionJob[]> {
    return this.sql<StoredCompanionJob[]>`
      SELECT id, workspace_id, worker_id, campaign_instance_id, campaign_step_run_id,
        action, action_mode, target_url, expected_origin, allowed_domains,
        instructions, status, idempotency_key, lease_expires_at, attempt_count, result, last_error,
        created_by, created_at, started_at, completed_at, updated_at
      FROM browser_job WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `;
  }

  async claimNextJob(workerId: string, leaseSeconds = 300): Promise<{ job: StoredCompanionJob; claimToken: string } | undefined> {
    const claimToken = `mm_claim_${randomBytes(32).toString("base64url")}`;
    const rows = await this.sql<StoredCompanionJob[]>`
      WITH candidate AS (
        SELECT job.id
        FROM browser_job job
        JOIN browser_worker worker ON worker.id = job.worker_id
        WHERE job.worker_id = ${workerId} AND worker.status = 'active'
          AND (job.status = 'queued' OR (job.status = 'claimed' AND job.lease_expires_at < now()))
        ORDER BY job.created_at
        FOR UPDATE OF job SKIP LOCKED
        LIMIT 1
      )
      UPDATE browser_job job SET status = 'claimed', claim_token_hash = ${hashCompanionSecret(claimToken)},
        lease_expires_at = now() + (${leaseSeconds} * interval '1 second'), attempt_count = attempt_count + 1,
        started_at = COALESCE(started_at, now()), updated_at = now()
      FROM candidate WHERE job.id = candidate.id
      RETURNING job.id, job.workspace_id, job.worker_id, job.campaign_instance_id, job.campaign_step_run_id,
        job.action, job.action_mode, job.target_url,
        job.expected_origin, job.allowed_domains, job.instructions, job.status, job.idempotency_key,
        job.lease_expires_at, job.attempt_count, job.result, job.last_error, job.created_by, job.created_at,
        job.started_at, job.completed_at, job.updated_at
    `;
    return rows[0] ? { job: rows[0], claimToken } : undefined;
  }

  async completeJob(input: {
    workerId: string;
    jobId: string;
    claimToken: string;
    status: "succeeded" | "failed";
    result: Record<string, unknown>;
    error?: string;
  }): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      WITH completed AS (
        UPDATE browser_job SET status = ${input.status}, result = ${this.sql.json(input.result as JSONValue)},
          last_error = ${input.error ?? null}, completed_at = now(), lease_expires_at = null,
          claim_token_hash = null, updated_at = now()
        WHERE id = ${input.jobId} AND worker_id = ${input.workerId} AND status = 'claimed'
          AND lease_expires_at > now() AND claim_token_hash = ${hashCompanionSecret(input.claimToken)}
        RETURNING id, workspace_id, campaign_instance_id, campaign_step_run_id, created_by, result
      ), command AS (
        INSERT INTO campaign_workflow_command (
          id, workspace_id, campaign_instance_id, command_type, idempotency_key, payload, actor_user_id
        )
        SELECT ${randomUUID()}, completed.workspace_id, completed.campaign_instance_id,
          'manual_step_completed', 'companion-job:' || completed.id || ':completed',
          jsonb_build_object('stepKey', step.step_key, 'output', completed.result || jsonb_build_object('companionJobId', completed.id)),
          completed.created_by
        FROM completed
        JOIN campaign_step_run run ON run.id = completed.campaign_step_run_id
        JOIN campaign_step step ON step.id = run.campaign_step_id
        WHERE ${input.status} = 'succeeded' AND completed.campaign_instance_id IS NOT NULL
        ON CONFLICT (idempotency_key) DO NOTHING
      )
      SELECT id FROM completed
    `;
    return Boolean(rows[0]);
  }
}
