import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import { createExactPreviewFingerprint, ExactPreviewFingerprintValidationError } from "./exact-preview-fingerprint";
import { ExactPreviewReadError, loadExactTextPreviewInTransaction, lockExactTextPreviewInTransaction } from "./exact-preview-repository";

export class CampaignFinalizationProofError extends Error {
  constructor(readonly code: "finalized_plan_invalid" | "finalized_preview_changed", message: string) {
    super(message);
    this.name = "CampaignFinalizationProofError";
  }
}

export interface FinalizedCampaignProof {
  readonly finalizationId: string;
  readonly campaignId: string;
  readonly campaignVersionId: string;
  readonly campaignStepId: string;
  readonly stepKey: string;
  readonly previewId: string;
  readonly previewFingerprint: string;
  readonly channelConnectionId: string;
}

interface ProofRow {
  id: string;
  campaignId: string;
  planningVersionId: string;
  finalizedVersionId: string;
  contentDraftId: string;
  contentDraftVersionId: string;
  draftChannelPreviewId: string;
  previewFingerprint: string;
  canonicalPreviewSnapshot: string;
  templateVersion: number;
}

function invalid(): never {
  throw new CampaignFinalizationProofError("finalized_plan_invalid", "This campaign's protected reviewed plan is missing or changed. Do not remove its preview proof.");
}

/**
 * Protection is discovered from durable campaign provenance, never token
 * presence. Read-only callers may use DatabaseClient; lockPreview requires a
 * real caller-owned transaction. No nested begin, provider call or mutation.
 */
export async function assertFinalizedCampaignPreviewInTransaction(
  sql: DatabaseClient | TransactionSql,
  input: { workspaceId: string; campaignId: string; campaignVersionId: string; stepKey?: string },
  options: { appBaseUrl?: string; lockPreview?: boolean } = {},
): Promise<FinalizedCampaignProof | undefined> {
  if (options.lockPreview && typeof (sql as DatabaseClient).begin === "function") {
    throw new TypeError("Locked preview validation requires a caller-owned transaction.");
  }
  // Both clients expose the tagged read/json interface used below. The cast
  // does not authorize calling .begin() on a transaction or acquiring locks on
  // a standalone read client; lockPreview is explicitly guarded above.
  const reader = sql as TransactionSql;
  const receipt = (await reader<ProofRow[]>`
    SELECT id, campaign_id, planning_version_id, finalized_version_id, content_draft_id,
      content_draft_version_id, draft_channel_preview_id, preview_fingerprint,
      canonical_preview_snapshot, template_version
    FROM campaign_finalization WHERE workspace_id = ${input.workspaceId} AND campaign_id = ${input.campaignId}
  `)[0];
  if (!receipt) return undefined;
  if (receipt.templateVersion !== 1 || receipt.finalizedVersionId !== input.campaignVersionId) invalid();
  const steps = await reader<{
    id: string; stepKey: string; operationType: string; approvalRequired: boolean;
    methods: string[]; inputsJson: string; exactInputs: boolean;
  }[]>`
    SELECT step.id, step.step_key, step.operation_type, step.approval_required,
      step.execution_methods AS methods, step.inputs::text AS inputs_json,
      step.inputs = (receipt.compiled_definition->'steps'->0->'inputs') AS exact_inputs
    FROM campaign_step step JOIN campaign_finalization receipt ON receipt.finalized_version_id = step.campaign_version_id
    WHERE receipt.id = ${receipt.id} AND step.campaign_version_id = ${input.campaignVersionId}
    ORDER BY step.id
  `;
  const step = steps[0];
  if (steps.length !== 1 || !step || step.stepKey !== "publish_prepared_preview"
    || (input.stepKey !== undefined && input.stepKey !== step.stepKey)
    || step.operationType !== "publish_content" || !step.approvalRequired || !step.exactInputs
    || step.methods.length !== 1 || step.methods[0] !== "official_api") invalid();
  const values = JSON.parse(step.inputsJson) as Record<string, unknown>;
  if (values.draftChannelPreviewId !== receipt.draftChannelPreviewId
    || values.draftChannelPreviewFingerprint !== receipt.previewFingerprint
    || typeof values.channelConnectionId !== "string"
    || values.appendDestination === true || values.useTrackedLink === true) invalid();
  try {
    const expected = createExactPreviewFingerprint(JSON.parse(receipt.canonicalPreviewSnapshot));
    if (expected.token !== receipt.previewFingerprint || expected.canonicalSnapshot !== receipt.canonicalPreviewSnapshot
      || expected.snapshot.lineage.workspaceId !== input.workspaceId
      || expected.snapshot.lineage.campaignId !== input.campaignId
      || expected.snapshot.lineage.sourceCampaignVersionId !== receipt.planningVersionId
      || expected.snapshot.lineage.previewId !== receipt.draftChannelPreviewId
      || expected.snapshot.lineage.contentDraftId !== receipt.contentDraftId
      || expected.snapshot.lineage.contentDraftVersionId !== receipt.contentDraftVersionId
      || expected.snapshot.preview.channelConnectionId !== values.channelConnectionId) invalid();
    if (options.lockPreview) await lockExactTextPreviewInTransaction(reader, {
      workspaceId: input.workspaceId, previewId: receipt.draftChannelPreviewId,
    });
    const current = await loadExactTextPreviewInTransaction(reader, {
      workspaceId: input.workspaceId, previewId: receipt.draftChannelPreviewId,
    }, options);
    if (current.token !== expected.token || current.canonicalSnapshot !== expected.canonicalSnapshot) {
      throw new CampaignFinalizationProofError("finalized_preview_changed", "The finalized preview or account/link context changed. Review a new plan before executing.");
    }
  } catch (error) {
    if (error instanceof SyntaxError) invalid();
    if (error instanceof ExactPreviewReadError || error instanceof ExactPreviewFingerprintValidationError) {
      throw new CampaignFinalizationProofError("finalized_preview_changed", "The finalized preview is no longer a current eligible exact rendering. Review a new plan before executing.");
    }
    throw error;
  }
  return Object.freeze({ finalizationId: receipt.id, campaignId: input.campaignId,
    campaignVersionId: input.campaignVersionId, campaignStepId: step.id, stepKey: step.stepKey,
    previewId: receipt.draftChannelPreviewId, previewFingerprint: receipt.previewFingerprint,
    channelConnectionId: values.channelConnectionId });
}

/**
 * Compatibility fence consumed by migration 0112 for new protected dispatch
 * claims. Call only after locked current proof, identity and approval checks in
 * common admission. LOCAL expires on commit/rollback; never set it on a pool.
 * This does not defend against a privileged SQL client setting its own marker.
 */
export async function setFinalizedPublicationAdmissionInTransaction(
  transaction: TransactionSql,
  proof: FinalizedCampaignProof,
  input: { campaignInstanceId: string; campaignStepRunId: string },
): Promise<void> {
  await transaction`SELECT set_config('market_me.exact_preview_admission', ${JSON.stringify({
    finalizationId: proof.finalizationId, campaignVersionId: proof.campaignVersionId,
    campaignStepId: proof.campaignStepId, campaignInstanceId: input.campaignInstanceId,
    campaignStepRunId: input.campaignStepRunId, previewFingerprint: proof.previewFingerprint,
  })}, true)`;
}
