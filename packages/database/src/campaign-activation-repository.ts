import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import type { WorkspaceRole } from "./models";
import { CampaignRepository } from "./campaign-repository";
import {
  CAMPAIGN_ACTIVATION_LIMITS, CampaignActivationError, campaignActivationUuid, normalizeCampaignActivationRequest,
  type CampaignActivationPreview, type CampaignActivationReceipt, type CampaignActivationStepSummary,
  type CampaignActivationClosure, type CampaignActivationOutcome,
} from "./campaign-activation-models";

type MemberRow = { role: WorkspaceRole; incarnationId: string };
type ReceiptRow = Omit<CampaignActivationReceipt, "acceptedAt"> & { acceptedAt: Date | string; createdBy: string; canonicalRequest: string };
type ClosureRow = Omit<CampaignActivationClosure, "closedAt"> & { closedAt: Date | string; createdBy: string; canonicalRequest: string };
const canWrite = (role: WorkspaceRole) => role === "owner" || role === "admin" || role === "editor";
const deny = () => new CampaignActivationError("access_denied", "Current workspace access is required; new runs require writer access.");
function receipt(row: ReceiptRow): CampaignActivationReceipt {
  return Object.freeze({ workspaceId: row.workspaceId, campaignId: row.campaignId, requestId: row.requestId,
    expectedVersionId: row.expectedVersionId, expectedActorIncarnationId: row.expectedActorIncarnationId,
    instanceId: row.instanceId, initialStatus: row.initialStatus, acceptedAt: new Date(row.acceptedAt).toISOString() });
}
function closure(row: ClosureRow): CampaignActivationClosure {
  return Object.freeze({ workspaceId: row.workspaceId, campaignId: row.campaignId, requestId: row.requestId,
    expectedVersionId: row.expectedVersionId, expectedActorIncarnationId: row.expectedActorIncarnationId,
    closedAt: new Date(row.closedAt).toISOString() });
}

/** Request boundary for all user-initiated activation. No provider I/O occurs here. */
export class CampaignActivationRepository {
  private readonly campaigns: CampaignRepository;
  constructor(private readonly sql: DatabaseClient, options: { appBaseUrl?: string } = {}) {
    this.campaigns = new CampaignRepository(sql, options);
  }

  async preview(workspaceId: string, campaignId: string, actorUserId: string): Promise<CampaignActivationPreview | undefined> {
    const workspace = campaignActivationUuid(workspaceId), campaign = campaignActivationUuid(campaignId), actor = campaignActivationUuid(actorUserId);
    return this.sql.begin(async tx => {
      const member = await this.lockMember(tx, workspace, actor);
      const row = (await tx<{
        workspaceId: string; campaignId: string; versionId: string; versionNumber: number; campaignName: string;
        autonomyMode: string; timezone: string; observedAt: Date | string; stepsJson: string;
      }[]>`SELECT c.workspace_id,c.id AS campaign_id,v.id AS version_id,v.version_number,c.name AS campaign_name,
        v.autonomy_mode,v.timezone,clock_timestamp() AS observed_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('stepKey',s.step_key,'name',s.name,'operationType',s.operation_type,
          'scheduleType',s.schedule_type,'approvalRequired',s.approval_required) ORDER BY s.sort_order,s.id)
          FROM (SELECT * FROM campaign_step WHERE campaign_version_id=v.id ORDER BY sort_order,id LIMIT ${CAMPAIGN_ACTIVATION_LIMITS.previewSteps + 1}) s),'[]'::jsonb)::text AS steps_json
        FROM campaign c JOIN campaign_version v ON v.id=c.current_version_id AND v.campaign_id=c.id AND v.status='published'
        WHERE c.workspace_id=${workspace} AND c.id=${campaign}`)[0];
      if (!row) return undefined;
      const steps = JSON.parse(row.stepsJson) as CampaignActivationStepSummary[];
      if (!steps.length || steps.length > CAMPAIGN_ACTIVATION_LIMITS.previewSteps) {
        throw new CampaignActivationError("preview_unavailable", "The published version cannot be represented by a bounded activation review.");
      }
      const common = { workspaceId: row.workspaceId, campaignId: row.campaignId, versionId: row.versionId,
        versionNumber: row.versionNumber, campaignName: row.campaignName, autonomyMode: row.autonomyMode,
        timezone: row.timezone, observedAt: new Date(row.observedAt).toISOString(), steps };
      const result: CampaignActivationPreview = canWrite(member.role)
        ? { ...common, canActivate: true, actorIncarnationId: member.incarnationId } : { ...common, canActivate: false };
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > CAMPAIGN_ACTIVATION_LIMITS.responseBytes) {
        throw new CampaignActivationError("preview_unavailable", "The published version is too large for this activation review.");
      }
      return result;
    });
  }

  async activate(input: unknown, actorUserId: string): Promise<{ receipt: CampaignActivationReceipt; replayed: boolean }> {
    const request = normalizeCampaignActivationRequest(input), actor = campaignActivationUuid(actorUserId), canonical = JSON.stringify(request);
    return this.sql.begin(async tx => {
      const member = await this.lockMember(tx, request.workspaceId, actor);
      if (!canWrite(member.role)) throw deny();
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["campaign-activation-v1", request.workspaceId, request.requestId])},0))`;
      const prior = (await tx<ReceiptRow[]>`SELECT * FROM campaign_activation_receipt
        WHERE workspace_id=${request.workspaceId} AND request_id=${request.requestId}`)[0];
      if (prior) {
        if (prior.createdBy !== actor || prior.canonicalRequest !== canonical) {
          throw new CampaignActivationError("request_conflict", "This request identifier belongs to another activation intent. Check the original result.");
        }
        return { receipt: receipt(prior), replayed: true };
      }
      const closed = (await tx<ClosureRow[]>`SELECT * FROM campaign_activation_closure WHERE workspace_id=${request.workspaceId} AND request_id=${request.requestId}`)[0];
      if (closed) {
        if (closed.createdBy !== actor || closed.canonicalRequest !== canonical) throw new CampaignActivationError("request_conflict", "This request belongs to another intent.");
        throw new CampaignActivationError("request_closed", "This original request is closed and cannot create a run. Review a new request explicitly.");
      }
      if (member.incarnationId !== request.expectedActorIncarnationId) {
        throw new CampaignActivationError("grant_changed", "Your workspace grant changed. Review the current published version again.");
      }
      const instance = await this.campaigns.activateCampaignInTransaction(tx, {
        workspaceId: request.workspaceId, campaignId: request.campaignId, actorUserId: actor, expectedVersionId: request.expectedVersionId,
      });
      if (!instance) throw new CampaignActivationError("not_found", "The reviewed published campaign was not found.");
      // Preserve exact PostgreSQL timestamp precision inside SQL; Date is display-only.
      const saved = (await tx<ReceiptRow[]>`INSERT INTO campaign_activation_receipt
        (workspace_id,request_id,campaign_id,expected_version_id,expected_actor_incarnation_id,created_by,instance_id,initial_status,accepted_at,canonical_request)
        SELECT workspace_id,${request.requestId},campaign_id,campaign_version_id,${member.incarnationId},requested_by,id,status,created_at,${canonical}
        FROM campaign_instance WHERE id=${instance.id} RETURNING *`)[0]!;
      await tx`INSERT INTO audit_event(id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES(${randomUUID()},${request.workspaceId},${actor},'campaign.activation_requested','campaign_instance',${instance.id},
          ${tx.json({ requestId: request.requestId, campaignId: request.campaignId, versionId: request.expectedVersionId,
            instanceId: instance.id, actorIncarnationId: member.incarnationId, initialStatus: instance.status })})`;
      return { receipt: receipt(saved), replayed: false };
    });
  }

  async getReceipt(workspaceId: string, campaignId: string, requestId: string, actorUserId: string): Promise<CampaignActivationReceipt | undefined> {
    const workspace = campaignActivationUuid(workspaceId), campaign = campaignActivationUuid(campaignId), key = campaignActivationUuid(requestId), actor = campaignActivationUuid(actorUserId);
    return this.sql.begin(async tx => {
      await this.lockMember(tx, workspace, actor);
      const row = (await tx<ReceiptRow[]>`SELECT * FROM campaign_activation_receipt
        WHERE workspace_id=${workspace} AND campaign_id=${campaign} AND request_id=${key} AND created_by=${actor}`)[0];
      return row ? receipt(row) : undefined;
    });
  }

  async getOutcome(workspaceId: string, campaignId: string, requestId: string, actorUserId: string): Promise<CampaignActivationOutcome | undefined> {
    const workspace = campaignActivationUuid(workspaceId), campaign = campaignActivationUuid(campaignId), key = campaignActivationUuid(requestId), actor = campaignActivationUuid(actorUserId);
    return this.sql.begin(async tx => {
      await this.lockMember(tx, workspace, actor);
      const accepted = (await tx<ReceiptRow[]>`SELECT * FROM campaign_activation_receipt
        WHERE workspace_id=${workspace} AND campaign_id=${campaign} AND request_id=${key} AND created_by=${actor}`)[0];
      if (accepted) return { kind: "accepted", receipt: receipt(accepted) };
      const closed = (await tx<ClosureRow[]>`SELECT * FROM campaign_activation_closure
        WHERE workspace_id=${workspace} AND campaign_id=${campaign} AND request_id=${key} AND created_by=${actor}`)[0];
      return closed ? { kind: "closed", receipt: closure(closed) } : undefined;
    });
  }

  /** Resolve uncertainty without starting anything: serialize against original POST.
   * If acceptance won, return history; otherwise prevent a later original admission. */
  async closeRequest(input: unknown, actorUserId: string): Promise<CampaignActivationOutcome> {
    const request = normalizeCampaignActivationRequest(input), actor = campaignActivationUuid(actorUserId), canonical = JSON.stringify(request);
    return this.sql.begin(async tx => {
      await this.lockMember(tx, request.workspaceId, actor);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["campaign-activation-v1", request.workspaceId, request.requestId])},0))`;
      const accepted = (await tx<ReceiptRow[]>`SELECT * FROM campaign_activation_receipt WHERE workspace_id=${request.workspaceId} AND request_id=${request.requestId}`)[0];
      if (accepted) {
        if (accepted.createdBy !== actor || accepted.canonicalRequest !== canonical) throw new CampaignActivationError("request_conflict", "This request belongs to another intent.");
        return { kind: "accepted", receipt: receipt(accepted) };
      }
      const prior = (await tx<ClosureRow[]>`SELECT * FROM campaign_activation_closure WHERE workspace_id=${request.workspaceId} AND request_id=${request.requestId}`)[0];
      if (prior) {
        if (prior.createdBy !== actor || prior.canonicalRequest !== canonical) throw new CampaignActivationError("request_conflict", "This request belongs to another intent.");
        return { kind: "closed", receipt: closure(prior) };
      }
      const target = await tx`SELECT c.id FROM campaign c JOIN campaign_version v ON v.campaign_id=c.id AND v.id=${request.expectedVersionId}
        WHERE c.workspace_id=${request.workspaceId} AND c.id=${request.campaignId}`;
      if (!target.length) throw new CampaignActivationError("not_found", "The original campaign/version was not found in this workspace.");
      const row = (await tx<ClosureRow[]>`INSERT INTO campaign_activation_closure
        (workspace_id,request_id,campaign_id,expected_version_id,expected_actor_incarnation_id,created_by,canonical_request)
        VALUES(${request.workspaceId},${request.requestId},${request.campaignId},${request.expectedVersionId},${request.expectedActorIncarnationId},${actor},${canonical}) RETURNING *`)[0]!;
      await tx`INSERT INTO audit_event(id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES(${randomUUID()},${request.workspaceId},${actor},'campaign.activation_closed','campaign',${request.campaignId},
          ${tx.json({ requestId: request.requestId, versionId: request.expectedVersionId })})`;
      return { kind: "closed", receipt: closure(row) };
    });
  }

  private async lockMember(tx: TransactionSql, workspace: string, actor: string): Promise<MemberRow> {
    const row = (await tx<MemberRow[]>`SELECT role,incarnation_id FROM active_workspace_membership
      WHERE workspace_id=${workspace} AND user_id=${actor} FOR SHARE`)[0];
    if (!row) throw deny();
    return row;
  }
}
