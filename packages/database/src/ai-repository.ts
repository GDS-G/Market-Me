import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type {
  AiBudgetAlert,
  AiBudgetScope,
  AiBudgetStatus,
  AiSpendExceptionRequest,
  AiUsageSummary,
  AiProviderRateCardSummary,
  AiProviderAdapterRegistrySummary,
  AiProviderModelInventoryItem,
  AiProviderModelInventorySummary,
  AiWorkspaceAdapterCandidate,
  AiWorkspaceAdapterRegistration,
  AiWorkspaceAdapterRateBinding,
  AiProviderInvocationContract,
  AiWorkspaceAdapterInvocationBinding,
  AiWorkspaceAdapterHealthObservation,
  AiStoredCostQuote,
  AiCostQuote,
  AiUsageQuantityForecast,
  DraftFormat,
  AiDraftRevisionGoal,
} from "@market-me/domain";
import {
  AI_CAPABILITIES,
  AI_ASSISTANT_ACTIONS,
  AI_ASSISTANT_PROFILE_IDS,
  AI_HOSTED_PROVIDER_TYPES,
  AI_OPERATIONAL_INCIDENT_TYPES,
  AI_OPERATIONAL_ALERT_EVENT_TYPES,
  AI_DRAFT_REVISION_GOALS,
  AI_DRAFT_REVISION_CURRENT_PROMPT_VERSION,
  AI_DRAFT_REVISION_PROMPT_VERSIONS,
  AI_DRAFT_REVISION_SUGGESTION_VERSION,
  type AiAnalysisCacheKey,
  type AiAnalysisCacheSummary,
} from "@market-me/domain";
import {
  DRAFT_FORMAT_CHARACTER_LIMITS,
  isAiAssistantCompatible,
  isAiRoutingPreferenceCompatible,
  quoteAiCost,
} from "@market-me/generation";
import { AI_TEXT_CODEC_LIMITS } from "@market-me/connectors";
import type { DatabaseClient } from "./client";
import type {
  AiUsageEventWrite,
  StoredAiBudgetAlert,
  AiSpendReservationWrite,
  AiSpendSettlementWrite,
  AiSpendExceptionRequestWrite,
  StoredAiSpendReservation,
  StoredAiSpendExceptionRequest,
  StoredAiUsageEvent,
  StoredWorkspaceAiPolicy,
  WorkspaceAiPolicyWrite,
  StoredAiAssistantAssignment,
  WorkspaceAiAssistantAssignmentsWrite,
  StoredAiRoutingPreference,
  StoredAiProviderAdapter,
  StoredAiProviderConnection,
  AiProviderConnectionSecretWrite,
  AiProviderConnectionVerificationTarget,
  AiProviderConnectionVerificationWrite,
  AiProviderModelDiscoveryWrite,
  AiWorkspaceAdapterCandidateWrite,
  AiWorkspaceAdapterCandidateDecisionWrite,
  AiWorkspaceAdapterRegistrationWrite,
  AiWorkspaceAdapterRegistrationRetirementWrite,
  AiWorkspaceAdapterRateBindingWrite,
  AiWorkspaceAdapterRateBindingRetirementWrite,
  AiWorkspaceAdapterInvocationBindingWrite,
  AiWorkspaceAdapterInvocationBindingRetirementWrite,
  AiWorkspaceAdapterHealthProbeTarget,
  AiWorkspaceAdapterHealthObservationWrite,
  WorkspaceAiRoutingPreferencesWrite,
  AiAnalysisCacheWrite,
  StoredAiAnalysisCacheEntry,
  StoredAiProviderRateCard,
  AiCostQuoteWrite,
  AiQuotedSpendReservationWrite,
  StoredAiCostQuote,
  AiTextInvocationIntentWrite,
  AiTextInvocationIntentCancelWrite,
  StoredAiTextInvocationIntent,
  AiTextInvocationAttemptClaimWrite,
  AiTextInvocationAttemptOutcomeWrite,
  AiTextInvocationAttemptTarget,
  StoredAiTextInvocationAttempt,
  AiTextOutputArtifactReviewWrite,
  AiTextOutputArtifactReadTarget,
  StoredAiTextOutputArtifact,
  StoredAiTextInvocationReconciliation,
  AiTextInvocationResolutionWrite,
  StoredAiTextInvocationResolution,
  AiTextDraftProposalAttachWrite,
  AiTextDraftProposalApplyWrite,
  AiTextDraftProposalDismissWrite,
  AiTextDraftProposalReadTarget,
  StoredAiTextDraftProposal,
  AiWorkspaceExecutionControlWrite,
  AiWorkspaceProviderCircuitResetWrite,
  StoredAiWorkspaceExecutionControl,
  StoredAiWorkspaceProviderCircuit,
  AiOperationalIncidentAcknowledgeWrite,
  StoredAiOperationalIncident,
  StoredAiOperationalReadiness,
  AiOperationalIncidentResponsePolicyWrite,
  StoredAiOperationalIncidentResponsePolicy,
  AiOperationalAlertWebhookWrite,
  AiOperationalAlertWebhookVerificationTarget,
  AiOperationalAlertWebhookVerificationWrite,
  StoredAiOperationalAlertWebhook,
  StoredAiOperationalAlertDelivery,
  AiOperationalAlertDeliveryTarget,
  AiOperationalAlertDeliveryOutcomeWrite,
  AiDraftRevisionIntentWrite,
  AiDraftRevisionPromptTarget,
  PreparedAiDraftRevisionIntent,
} from "./models";

const AI_ADAPTER_HEALTH_TTL_MS = 5 * 60 * 1_000;
const AI_EXECUTION_ENABLEMENT_MAX_MINUTES = 24 * 60;
const AI_PROVIDER_CIRCUIT_FAILURE_THRESHOLD = 3;
const DEFAULT_AI_OPERATIONAL_INCIDENT_RESPONSE_POLICY = Object.freeze({
  criticalAcknowledgementMinutes: 5,
  highAcknowledgementMinutes: 30,
  criticalResolutionMinutes: 60,
  highResolutionMinutes: 240,
});

export class AiPolicyValidationError extends Error {
  constructor(
    public readonly issues: readonly { field: string; message: string }[],
  ) {
    super("AI policy validation failed.");
    this.name = "AiPolicyValidationError";
  }
}

async function createBudgetAlerts(
  transaction: TransactionSql,
  policy: StoredWorkspaceAiPolicy,
  reservation: StoredAiSpendReservation,
  totals: Awaited<ReturnType<typeof spendTotals>>,
  actorUserId: string,
  asOf: Date,
) {
  const dayKey = asOf.toISOString().slice(0, 10);
  const monthKey = asOf.toISOString().slice(0, 7);
  const candidates: {
    scope: AiBudgetScope;
    windowKey: string;
    committedCostMinor: number;
    capMinor: number;
    campaignId?: string;
  }[] = [];
  if (policy.dailyBudgetMinor !== undefined)
    candidates.push({
      scope: "daily",
      windowKey: dayKey,
      committedCostMinor:
        totals.dailySpent + totals.dailyReserved + reservation.estimatedCostMinor,
      capMinor: policy.dailyBudgetMinor,
    });
  if (policy.monthlyBudgetMinor !== undefined)
    candidates.push({
      scope: "monthly",
      windowKey: monthKey,
      committedCostMinor:
        totals.monthlySpent + totals.monthlyReserved + reservation.estimatedCostMinor,
      capMinor: policy.monthlyBudgetMinor,
    });
  if (
    reservation.campaignId &&
    policy.campaignBudgetMinor !== undefined
  )
    candidates.push({
      scope: "campaign",
      windowKey: reservation.campaignId,
      committedCostMinor:
        totals.campaignSpent +
        totals.campaignReserved +
        reservation.estimatedCostMinor,
      capMinor: policy.campaignBudgetMinor,
      campaignId: reservation.campaignId,
    });

  for (const candidate of candidates) {
    for (const thresholdPercentage of policy.alertThresholdPercentages) {
      if (
        candidate.committedCostMinor * 100 <
        candidate.capMinor * thresholdPercentage
      )
        continue;
      const rows = await transaction<StoredAiBudgetAlert[]>`
        INSERT INTO ai_budget_alert (
          id, workspace_id, campaign_id, source_reservation_id, scope,
          window_key, threshold_percentage, committed_cost_minor, cap_minor,
          currency, created_at, updated_at
        ) VALUES (
          ${randomUUID()}, ${policy.workspaceId}, ${candidate.campaignId ?? null},
          ${reservation.id}, ${candidate.scope}, ${candidate.windowKey},
          ${thresholdPercentage}, ${candidate.committedCostMinor},
          ${candidate.capMinor}, ${policy.currency}, ${asOf}, ${asOf}
        )
        ON CONFLICT (
          workspace_id, scope, window_key, threshold_percentage, cap_minor, currency
        ) DO NOTHING
        RETURNING id, workspace_id, campaign_id, source_reservation_id, scope,
          window_key, threshold_percentage, committed_cost_minor, cap_minor,
          currency, status, acknowledged_by, acknowledged_at, created_at, updated_at
      `;
      if (!rows[0]) continue;
      const alert = normalizeBudgetAlert(rows[0]);
      await auditBudgetAlert(
        transaction,
        policy.workspaceId,
        actorUserId,
        "ai.budget_alert_created",
        alert,
      );
    }
  }
}

async function auditBudgetAlert(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  eventType: string,
  alert: AiBudgetAlert,
) {
  const data = {
    scope: alert.scope,
    thresholdPercentage: alert.thresholdPercentage,
    committedCostMinor: alert.committedCostMinor,
    capMinor: alert.capMinor,
    currency: alert.currency,
    campaignId: alert.campaignId,
    status: alert.status,
  };
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      ${eventType}, 'ai_budget_alert', ${alert.id},
      ${transaction.json(data as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function selectSpendException(
  transaction: TransactionSql,
  workspaceId: string,
  requestId?: string,
  deniedReservationId?: string,
  forUpdate = false,
): Promise<StoredAiSpendExceptionRequest | undefined> {
  if (!requestId && !deniedReservationId) return undefined;
  const filter = requestId
    ? transaction`e.id = ${requestId}`
    : transaction`e.denied_reservation_id = ${deniedReservationId!}`;
  const lock = forUpdate ? transaction`FOR UPDATE OF e, r` : transaction``;
  const rows = await transaction<StoredAiSpendExceptionRequest[]>`
    SELECT e.id, e.workspace_id, e.denied_reservation_id,
      r.campaign_id, r.capability, r.feature, r.currency,
      r.estimated_cost_minor, r.exceeded_scopes, r.cap_behavior,
      e.status, e.justification, e.requested_by, e.resolved_by,
      e.decision_note, e.expires_at, e.resolved_at, e.consumed_at,
      e.created_at, e.updated_at
    FROM ai_spend_exception_request e
    JOIN ai_spend_reservation r
      ON r.id = e.denied_reservation_id AND r.workspace_id = e.workspace_id
    WHERE e.workspace_id = ${workspaceId} AND ${filter}
    ${lock}
  `;
  return rows[0];
}

async function auditSpendException(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  eventType: string,
  request: AiSpendExceptionRequest,
) {
  const data = {
    deniedReservationId: request.deniedReservationId,
    campaignId: request.campaignId,
    capability: request.capability,
    currency: request.currency,
    estimatedCostMinor: request.estimatedCostMinor,
    exceededScopes: request.exceededScopes,
    capBehavior: request.capBehavior,
    status: request.status,
    consumed: request.consumedAt !== undefined,
  };
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      ${eventType}, 'ai_spend_exception_request', ${request.id},
      ${transaction.json(data as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

export class AiRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async getPolicy(
    workspaceId: string,
  ): Promise<StoredWorkspaceAiPolicy | undefined> {
    const rows = await this.sql<StoredWorkspaceAiPolicy[]>`
      SELECT workspace_id, mode, maximum_privacy_class, failover_mode,
        cap_behavior, currency, daily_budget_minor, campaign_budget_minor,
        monthly_budget_minor, alert_threshold_percentages, created_by,
        updated_by, created_at, updated_at
      FROM workspace_ai_policy WHERE workspace_id = ${workspaceId}
    `;
    return rows[0] ? normalizePolicy(rows[0]) : undefined;
  }

  async savePolicy(
    input: WorkspaceAiPolicyWrite,
    actorUserId: string,
  ): Promise<StoredWorkspaceAiPolicy> {
    validatePolicy(input);
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      await transaction`
        INSERT INTO workspace_ai_policy (
          workspace_id, mode, maximum_privacy_class, failover_mode,
          cap_behavior, currency, daily_budget_minor, campaign_budget_minor,
          monthly_budget_minor, alert_threshold_percentages, created_by, updated_by
        ) VALUES (
          ${input.workspaceId}, ${input.mode}, ${input.maximumPrivacyClass},
          ${input.failoverMode}, ${input.capBehavior}, ${input.currency},
          ${input.dailyBudgetMinor ?? null}, ${input.campaignBudgetMinor ?? null},
          ${input.monthlyBudgetMinor ?? null},
          ${transaction.json([...input.alertThresholdPercentages] as JSONValue)},
          ${actorUserId}, ${actorUserId}
        )
        ON CONFLICT (workspace_id) DO UPDATE SET
          mode = EXCLUDED.mode,
          maximum_privacy_class = EXCLUDED.maximum_privacy_class,
          failover_mode = EXCLUDED.failover_mode,
          cap_behavior = EXCLUDED.cap_behavior,
          currency = EXCLUDED.currency,
          daily_budget_minor = EXCLUDED.daily_budget_minor,
          campaign_budget_minor = EXCLUDED.campaign_budget_minor,
          monthly_budget_minor = EXCLUDED.monthly_budget_minor,
          alert_threshold_percentages = EXCLUDED.alert_threshold_percentages,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `;
      await this.auditPolicy(transaction, input, actorUserId);
    });
    return (await this.getPolicy(input.workspaceId))!;
  }

  async getWorkspaceExecutionControl(
    workspaceId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiWorkspaceExecutionControl> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceExecutionControl(transaction, workspaceId, asOf);
    });
  }

  async saveWorkspaceExecutionControl(
    input: AiWorkspaceExecutionControlWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiWorkspaceExecutionControl> {
    validateExecutionControl(input);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const enabledUntil = input.state === "enabled"
        ? new Date(asOf.getTime() + input.enabledForMinutes! * 60_000)
        : undefined;
      await transaction`
        INSERT INTO workspace_ai_execution_control (
          workspace_id, state, reason, enabled_until, created_by, updated_by,
          created_at, updated_at
        ) VALUES (${input.workspaceId}, ${input.state}, ${input.reason},
          ${enabledUntil ?? null}, ${actorUserId}, ${actorUserId}, ${asOf}, ${asOf})
        ON CONFLICT (workspace_id) DO UPDATE SET
          state = EXCLUDED.state, reason = EXCLUDED.reason,
          enabled_until = EXCLUDED.enabled_until,
          updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
      `;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          ${input.state === "enabled" ? "ai.execution_enabled" : "ai.execution_stopped"},
          'workspace_ai_execution_control', ${input.workspaceId},
          ${transaction.json({
            state: input.state,
            reason: input.reason,
            ...(enabledUntil ? { enabledUntil: enabledUntil.toISOString() } : {}),
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return this.getWorkspaceExecutionControl(input.workspaceId, actorUserId, asOf);
  }

  async listWorkspaceProviderCircuits(
    workspaceId: string,
    actorUserId: string,
  ): Promise<StoredAiWorkspaceProviderCircuit[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceProviderCircuits(transaction, workspaceId);
    });
  }

  async resetWorkspaceProviderCircuit(
    input: AiWorkspaceProviderCircuitResetWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiWorkspaceProviderCircuit> {
    validateProviderCircuitReset(input);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{ state: string }[]>`
        SELECT state FROM workspace_ai_provider_circuit
        WHERE workspace_id = ${input.workspaceId} AND provider = ${input.provider}
        FOR UPDATE
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([{
          field: "provider",
          message: "No provider circuit has recorded an outcome for this workspace.",
        }]);
      if (rows[0].state === "closed") return;
      await transaction`
        UPDATE workspace_ai_provider_circuit SET
          state = 'closed', consecutive_unsafe_outcomes = 0,
          last_failure_code = NULL, opened_at = NULL,
          opened_by_attempt_id = NULL, reset_by = ${actorUserId},
          reset_note = ${input.resetNote}, reset_at = ${asOf}, updated_at = ${asOf}
        WHERE workspace_id = ${input.workspaceId} AND provider = ${input.provider}
      `;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.provider_circuit_reset', 'workspace_ai_provider_circuit',
          ${input.provider},
          ${transaction.json({ provider: input.provider, resetNote: input.resetNote } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    const circuit = (await this.listWorkspaceProviderCircuits(input.workspaceId, actorUserId))
      .find((item) => item.provider === input.provider);
    if (!circuit) throw new Error("Reset provider circuit projection lost its row.");
    return circuit;
  }

  async listAssistantAssignments(
    workspaceId: string,
  ): Promise<StoredAiAssistantAssignment[]> {
    const rows = await this.sql<StoredAiAssistantAssignment[]>`
      SELECT workspace_id, action, assistant_profile_id AS profile_id,
        created_by, updated_by, created_at, updated_at
      FROM workspace_ai_assistant_assignment
      WHERE workspace_id = ${workspaceId}
      ORDER BY action
    `;
    return rows.map(normalizeAssistantAssignment);
  }

  async replaceAssistantAssignments(
    input: WorkspaceAiAssistantAssignmentsWrite,
    actorUserId: string,
  ): Promise<StoredAiAssistantAssignment[]> {
    validateAssistantAssignments(input);
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      await transaction`
        DELETE FROM workspace_ai_assistant_assignment
        WHERE workspace_id = ${input.workspaceId}
      `;
      for (const assignment of input.assignments) {
        await transaction`
          INSERT INTO workspace_ai_assistant_assignment (
            workspace_id, action, assistant_profile_id, created_by, updated_by
          ) VALUES (
            ${input.workspaceId}, ${assignment.action}, ${assignment.profileId},
            ${actorUserId}, ${actorUserId}
          )
        `;
      }
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        )
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.assistant_assignments_saved', 'workspace_ai_assistant_assignments',
          ${input.workspaceId},
          ${transaction.json({ assignments: input.assignments } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return this.listAssistantAssignments(input.workspaceId);
  }

  async listRoutingPreferences(
    workspaceId: string,
  ): Promise<StoredAiRoutingPreference[]> {
    const rows = await this.sql<StoredAiRoutingPreference[]>`
      SELECT workspace_id, action, provider, model,
        created_by, updated_by, created_at, updated_at
      FROM workspace_ai_routing_preference
      WHERE workspace_id = ${workspaceId}
      ORDER BY action
    `;
    return rows.map(normalizeRoutingPreference);
  }

  async listProviderAdapters(): Promise<StoredAiProviderAdapter[]> {
    return selectProviderAdapters(this.sql);
  }

  async getProviderAdapterRegistrySummary(): Promise<AiProviderAdapterRegistrySummary> {
    const adapters = await this.listProviderAdapters();
    const verifiedTimes = adapters.map((adapter) => adapter.verifiedAt).sort();
    return {
      totalAdapterCount: adapters.length,
      approvedAdapterCount: adapters.filter((adapter) => adapter.approved).length,
      availableAdapterCount: adapters.filter((adapter) => adapter.available).length,
      paidReservationAdapterCount: adapters.filter(
        (adapter) => adapter.requiresPaidReservation,
      ).length,
      capabilityCount: new Set(adapters.flatMap((adapter) => adapter.capabilities)).size,
      ...(verifiedTimes.length > 0
        ? { latestVerifiedAt: verifiedTimes.at(-1)! }
        : {}),
    };
  }

  async listProviderConnections(
    workspaceId: string,
    actorUserId: string,
  ): Promise<StoredAiProviderConnection[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectProviderConnections(transaction, workspaceId);
    });
  }

  async saveProviderConnection(
    input: AiProviderConnectionSecretWrite,
    actorUserId: string,
  ): Promise<StoredAiProviderConnection> {
    validateProviderConnectionSecret(input);
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const existing = await transaction<{ found: boolean }[]>`
        SELECT true AS found FROM workspace_ai_provider_connection
        WHERE workspace_id = ${input.workspaceId} AND provider = ${input.provider}
      `;
      await transaction`
        INSERT INTO workspace_ai_provider_connection (
          workspace_id, provider, status, encrypted_credential,
          credential_fingerprint, encryption_key_version, created_by, updated_by
        ) VALUES (
          ${input.workspaceId}, ${input.provider}, 'unverified',
          ${input.encryptedCredential}, ${input.credentialFingerprint},
          ${input.encryptionKeyVersion}, ${actorUserId}, ${actorUserId}
        )
        ON CONFLICT (workspace_id, provider) DO UPDATE SET
          status = 'unverified',
          encrypted_credential = EXCLUDED.encrypted_credential,
          credential_fingerprint = EXCLUDED.credential_fingerprint,
          encryption_key_version = EXCLUDED.encryption_key_version,
          last_error = NULL,
          verified_at = NULL,
          revoked_at = NULL,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `;
      await transaction`
        UPDATE workspace_ai_provider_model SET
          retired_at = COALESCE(retired_at, now()), updated_at = now()
        WHERE workspace_id = ${input.workspaceId}
          AND provider = ${input.provider}
          AND retired_at IS NULL
      `;
      const retiredCandidates = await transaction<{ id: string }[]>`
        UPDATE workspace_ai_adapter_candidate SET
          status = 'retired', reviewed_by = ${actorUserId},
          review_note = 'Credential changed; candidate retired automatically.',
          reviewed_at = now(), retired_at = now(), updated_at = now()
        WHERE workspace_id = ${input.workspaceId}
          AND provider = ${input.provider}
          AND status IN ('pending', 'approved')
        RETURNING id
      `;
      if (retiredCandidates.length)
        await auditAdapterCandidatesRetired(transaction, input.workspaceId, actorUserId, input.provider, retiredCandidates.length, "credential_changed");
      await retireWorkspaceAdapterRegistrations(
        transaction,
        input.workspaceId,
        actorUserId,
        input.provider,
        "Credential changed; registration retired automatically.",
        "credential_changed",
      );
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        )
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.provider_connection_saved', 'workspace_ai_provider_connection',
          ${input.provider},
          ${transaction.json({
            provider: input.provider,
            status: "unverified",
            rotated: Boolean(existing[0]),
            credentialsIncluded: false,
            execution: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return (
      await this.listProviderConnections(input.workspaceId, actorUserId)
    ).find((connection) => connection.provider === input.provider)!;
  }

  async getProviderConnectionVerificationTarget(
    workspaceId: string,
    provider: (typeof AI_HOSTED_PROVIDER_TYPES)[number],
    actorUserId: string,
  ): Promise<AiProviderConnectionVerificationTarget> {
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const rows = await transaction<AiProviderConnectionVerificationTarget[]>`
        SELECT workspace_id, provider, status, encrypted_credential,
          credential_fingerprint, encryption_key_version
        FROM workspace_ai_provider_connection
        WHERE workspace_id = ${workspaceId} AND provider = ${provider}
          AND status <> 'revoked' AND encrypted_credential IS NOT NULL
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "provider", message: "A configured provider credential is required." },
        ]);
      return rows[0];
    });
  }

  async recordProviderConnectionVerification(
    input: AiProviderConnectionVerificationWrite,
    actorUserId: string,
  ): Promise<StoredAiProviderConnection> {
    validateProviderConnectionVerification(input);
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{ provider: string }[]>`
        UPDATE workspace_ai_provider_connection SET
          status = ${input.status},
          last_error = ${input.status === "error" ? input.lastError! : null},
          verified_at = ${input.status === "verified" ? transaction`now()` : null},
          revoked_at = NULL,
          updated_by = ${actorUserId},
          updated_at = now()
        WHERE workspace_id = ${input.workspaceId}
          AND provider = ${input.provider}
          AND credential_fingerprint = ${input.expectedCredentialFingerprint}
          AND encrypted_credential IS NOT NULL
          AND status <> 'revoked'
        RETURNING provider
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          {
            field: "provider",
            message: "The provider credential changed during verification. Verify the current key again.",
          },
        ]);
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        )
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          ${input.status === "verified"
            ? "ai.provider_connection_verified"
            : "ai.provider_connection_verification_failed"},
          'workspace_ai_provider_connection', ${input.provider},
          ${transaction.json({
            provider: input.provider,
            status: input.status,
            credentialsIncluded: false,
            providerResponseIncluded: false,
            generation: false,
            execution: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return (
      await this.listProviderConnections(input.workspaceId, actorUserId)
    ).find((connection) => connection.provider === input.provider)!;
  }

  async listProviderModelInventory(
    workspaceId: string,
    provider: (typeof AI_HOSTED_PROVIDER_TYPES)[number],
    actorUserId: string,
  ): Promise<{
    models: AiProviderModelInventoryItem[];
    summary: AiProviderModelInventorySummary;
  }> {
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const models = await selectProviderModelInventory(
        transaction,
        workspaceId,
        provider,
      );
      const discoveryTimes = models.map((model) => model.lastSeenAt).sort();
      return {
        models,
        summary: {
          totalModelCount: models.length,
          activeModelCount: models.filter((model) => !model.retiredAt).length,
          retiredModelCount: models.filter((model) => model.retiredAt).length,
          ...(discoveryTimes.length
            ? { latestDiscoveryAt: discoveryTimes.at(-1)! }
            : {}),
          adapterActivation: false,
          execution: false,
        },
      };
    });
  }

  async replaceProviderModelInventory(
    input: AiProviderModelDiscoveryWrite,
    actorUserId: string,
  ): Promise<{
    models: AiProviderModelInventoryItem[];
    summary: AiProviderModelInventorySummary;
  }> {
    validateProviderModelDiscovery(input);
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const connections = await transaction<{
        status: string;
        credentialFingerprint?: string;
      }[]>`
        SELECT status, credential_fingerprint
        FROM workspace_ai_provider_connection
        WHERE workspace_id = ${input.workspaceId} AND provider = ${input.provider}
        FOR UPDATE
      `;
      if (
        connections[0]?.status !== "verified" ||
        connections[0]?.credentialFingerprint !== input.expectedCredentialFingerprint
      )
        throw new AiPolicyValidationError([
          {
            field: "provider",
            message: "The verified provider credential changed before model discovery completed.",
          },
        ]);
      await transaction`
        UPDATE workspace_ai_provider_model SET
          retired_at = now(), updated_at = now()
        WHERE workspace_id = ${input.workspaceId}
          AND provider = ${input.provider}
          AND retired_at IS NULL
      `;
      for (const model of input.models) {
        await transaction`
          INSERT INTO workspace_ai_provider_model (
            workspace_id, provider, model_id, display_name,
            input_token_limit, output_token_limit, provider_created_at,
            credential_fingerprint
          ) VALUES (
            ${input.workspaceId}, ${input.provider}, ${model.modelId},
            ${model.displayName ?? null}, ${model.inputTokenLimit ?? null},
            ${model.outputTokenLimit ?? null},
            ${model.providerCreatedAt ?? null},
            ${input.expectedCredentialFingerprint}
          )
          ON CONFLICT (workspace_id, provider, model_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            input_token_limit = EXCLUDED.input_token_limit,
            output_token_limit = EXCLUDED.output_token_limit,
            provider_created_at = EXCLUDED.provider_created_at,
            credential_fingerprint = EXCLUDED.credential_fingerprint,
            last_seen_at = now(), retired_at = NULL, updated_at = now()
        `;
      }
      const retiredCandidates = await transaction<{ id: string }[]>`
        UPDATE workspace_ai_adapter_candidate a SET
          status = 'retired', reviewed_by = ${actorUserId},
          review_note = 'Model was absent from the refreshed provider inventory.',
          reviewed_at = now(), retired_at = now(), updated_at = now()
        FROM workspace_ai_provider_model m
        WHERE a.workspace_id = ${input.workspaceId}
          AND a.provider = ${input.provider}
          AND a.status IN ('pending', 'approved')
          AND m.workspace_id = a.workspace_id AND m.provider = a.provider
          AND m.model_id = a.model_id AND m.retired_at IS NOT NULL
        RETURNING a.id
      `;
      if (retiredCandidates.length)
        await auditAdapterCandidatesRetired(transaction, input.workspaceId, actorUserId, input.provider, retiredCandidates.length, "model_absent");
      await retireWorkspaceAdapterRegistrations(
        transaction,
        input.workspaceId,
        actorUserId,
        input.provider,
        "Model was absent from the refreshed provider inventory.",
        "model_absent",
      );
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        )
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.provider_model_inventory_replaced',
          'workspace_ai_provider_connection', ${input.provider},
          ${transaction.json({
            provider: input.provider,
            discoveredModelCount: input.models.length,
            modelIdentifiersIncluded: false,
            credentialFingerprintIncluded: false,
            providerResponseIncluded: false,
            adapterActivation: false,
            execution: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return this.listProviderModelInventory(
      input.workspaceId,
      input.provider,
      actorUserId,
    );
  }

  async listWorkspaceAdapterCandidates(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AiWorkspaceAdapterCandidate[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceAdapterCandidates(transaction, workspaceId);
    });
  }

  async submitWorkspaceAdapterCandidate(
    input: AiWorkspaceAdapterCandidateWrite,
    actorUserId: string,
  ): Promise<AiWorkspaceAdapterCandidate> {
    validateWorkspaceAdapterCandidate(input);
    const candidateId = await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const sources = await transaction<{
        inputTokenLimit?: number;
        credentialFingerprint: string;
      }[]>`
        SELECT m.input_token_limit, m.credential_fingerprint
        FROM workspace_ai_provider_model m
        JOIN workspace_ai_provider_connection c
          ON c.workspace_id = m.workspace_id AND c.provider = m.provider
        WHERE m.workspace_id = ${input.workspaceId}
          AND m.provider = ${input.provider} AND m.model_id = ${input.modelId}
          AND m.retired_at IS NULL AND c.status = 'verified'
          AND c.credential_fingerprint = m.credential_fingerprint
        FOR UPDATE OF m, c
      `;
      if (!sources[0])
        throw new AiPolicyValidationError([
          { field: "modelId", message: "Choose an active model from the currently verified provider inventory." },
        ]);
      if (sources[0].inputTokenLimit && input.contextLimit > sources[0].inputTokenLimit)
        throw new AiPolicyValidationError([
          { field: "contextLimit", message: "Context limit cannot exceed discovered provider metadata." },
        ]);
      const existing = await transaction<{ id: string; status: string }[]>`
        SELECT id, status FROM workspace_ai_adapter_candidate
        WHERE workspace_id = ${input.workspaceId} AND provider = ${input.provider}
          AND model_id = ${input.modelId}
        FOR UPDATE
      `;
      if (existing[0] && !["rejected", "retired"].includes(existing[0].status))
        throw new AiPolicyValidationError([
          { field: "modelId", message: "This model already has an active candidate review." },
        ]);
      const id = existing[0]?.id ?? randomUUID();
      await transaction`
        INSERT INTO workspace_ai_adapter_candidate (
          id, workspace_id, provider, model_id, status, display_name,
          quality, speed, cost, context_limit, evidence_reference,
          evidence_sha256, source_credential_fingerprint, submitted_by
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.provider}, ${input.modelId},
          'pending', ${input.displayName}, ${input.quality}, ${input.speed},
          ${input.cost}, ${input.contextLimit}, ${input.evidenceReference},
          ${input.evidenceSha256}, ${sources[0].credentialFingerprint}, ${actorUserId}
        )
        ON CONFLICT (workspace_id, provider, model_id) DO UPDATE SET
          status = 'pending', display_name = EXCLUDED.display_name,
          quality = EXCLUDED.quality, speed = EXCLUDED.speed, cost = EXCLUDED.cost,
          context_limit = EXCLUDED.context_limit,
          evidence_reference = EXCLUDED.evidence_reference,
          evidence_sha256 = EXCLUDED.evidence_sha256,
          source_credential_fingerprint = EXCLUDED.source_credential_fingerprint,
          submitted_by = EXCLUDED.submitted_by, submitted_at = now(),
          reviewed_by = NULL, review_note = NULL, reviewed_at = NULL,
          retired_at = NULL, updated_at = now()
      `;
      await transaction`DELETE FROM workspace_ai_adapter_candidate_capability WHERE candidate_id = ${id}`;
      for (const capability of input.capabilities)
        await transaction`
          INSERT INTO workspace_ai_adapter_candidate_capability (candidate_id, capability)
          VALUES (${id}, ${capability})
        `;
      await auditAdapterCandidate(transaction, input.workspaceId, actorUserId, id, input.provider, "submitted");
      return id;
    });
    return (await this.listWorkspaceAdapterCandidates(input.workspaceId, actorUserId))
      .find((candidate) => candidate.id === candidateId)!;
  }

  async decideWorkspaceAdapterCandidate(
    input: AiWorkspaceAdapterCandidateDecisionWrite,
    actorUserId: string,
  ): Promise<AiWorkspaceAdapterCandidate> {
    if (!input.reviewNote || input.reviewNote.trim() !== input.reviewNote || input.reviewNote.length > 1000)
      throw new AiPolicyValidationError([{ field: "reviewNote", message: "Provide a bounded trimmed review note." }]);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{
        provider: string;
        status: string;
        currentEvidence: boolean;
      }[]>`
        SELECT a.provider, a.status,
          (m.retired_at IS NULL AND c.status = 'verified' AND
           m.credential_fingerprint = a.source_credential_fingerprint AND
           c.credential_fingerprint = a.source_credential_fingerprint) AS current_evidence
        FROM workspace_ai_adapter_candidate a
        JOIN workspace_ai_provider_model m
          ON m.workspace_id = a.workspace_id AND m.provider = a.provider AND m.model_id = a.model_id
        JOIN workspace_ai_provider_connection c
          ON c.workspace_id = a.workspace_id AND c.provider = a.provider
        WHERE a.id = ${input.candidateId} AND a.workspace_id = ${input.workspaceId}
        FOR UPDATE OF a, m, c
      `;
      if (!rows[0] || rows[0].status !== "pending")
        throw new AiPolicyValidationError([{ field: "candidateId", message: "Choose a pending adapter candidate." }]);
      if (input.decision === "approved" && !rows[0].currentEvidence)
        throw new AiPolicyValidationError([{ field: "candidateId", message: "Candidate evidence is stale; rediscover and resubmit it." }]);
      await transaction`
        UPDATE workspace_ai_adapter_candidate SET
          status = ${input.decision}, reviewed_by = ${actorUserId},
          review_note = ${input.reviewNote}, reviewed_at = now(), updated_at = now()
        WHERE id = ${input.candidateId} AND workspace_id = ${input.workspaceId}
      `;
      await auditAdapterCandidate(transaction, input.workspaceId, actorUserId, input.candidateId, rows[0].provider, input.decision);
    });
    return (await this.listWorkspaceAdapterCandidates(input.workspaceId, actorUserId))
      .find((candidate) => candidate.id === input.candidateId)!;
  }

  async listWorkspaceAdapterRegistrations(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AiWorkspaceAdapterRegistration[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceAdapterRegistrations(transaction, workspaceId);
    });
  }

  async registerWorkspaceAdapter(
    input: AiWorkspaceAdapterRegistrationWrite,
    actorUserId: string,
  ): Promise<AiWorkspaceAdapterRegistration> {
    const registrationId = await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const candidates = await transaction<{
        id: string;
        provider: string;
        modelId: string;
        status: string;
        displayName: string;
        quality: string;
        speed: string;
        cost: string;
        contextLimit: number;
        sourceCredentialFingerprint: string;
        currentEvidence: boolean;
      }[]>`
        SELECT a.id, a.provider, a.model_id, a.status, a.display_name,
          a.quality, a.speed, a.cost, a.context_limit,
          a.source_credential_fingerprint,
          (m.retired_at IS NULL AND c.status = 'verified' AND
           m.credential_fingerprint = a.source_credential_fingerprint AND
           c.credential_fingerprint = a.source_credential_fingerprint) AS current_evidence
        FROM workspace_ai_adapter_candidate a
        JOIN workspace_ai_provider_model m
          ON m.workspace_id = a.workspace_id AND m.provider = a.provider AND m.model_id = a.model_id
        JOIN workspace_ai_provider_connection c
          ON c.workspace_id = a.workspace_id AND c.provider = a.provider
        WHERE a.id = ${input.candidateId} AND a.workspace_id = ${input.workspaceId}
        FOR UPDATE OF a, m, c
      `;
      if (!candidates[0] || candidates[0].status !== "approved")
        throw new AiPolicyValidationError([
          { field: "candidateId", message: "Choose an approved adapter candidate." },
        ]);
      if (!candidates[0].currentEvidence)
        throw new AiPolicyValidationError([
          { field: "candidateId", message: "Candidate evidence is stale; rediscover and resubmit it." },
        ]);
      const existing = await transaction<{ id: string; status: string }[]>`
        SELECT id, status FROM workspace_ai_adapter_registration
        WHERE candidate_id = ${input.candidateId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (existing[0]?.status === "registered")
        throw new AiPolicyValidationError([
          { field: "candidateId", message: "This candidate is already registered for deployment review." },
        ]);
      const id = existing[0]?.id ?? randomUUID();
      await transaction`
        INSERT INTO workspace_ai_adapter_registration (
          id, workspace_id, candidate_id, provider, model_id, status,
          display_name, quality, speed, cost, context_limit,
          source_credential_fingerprint, registered_by
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.candidateId},
          ${candidates[0].provider}, ${candidates[0].modelId}, 'registered',
          ${candidates[0].displayName}, ${candidates[0].quality},
          ${candidates[0].speed}, ${candidates[0].cost},
          ${candidates[0].contextLimit},
          ${candidates[0].sourceCredentialFingerprint}, ${actorUserId}
        )
        ON CONFLICT (candidate_id) DO UPDATE SET
          status = 'registered', display_name = EXCLUDED.display_name,
          quality = EXCLUDED.quality, speed = EXCLUDED.speed,
          cost = EXCLUDED.cost, context_limit = EXCLUDED.context_limit,
          source_credential_fingerprint = EXCLUDED.source_credential_fingerprint,
          registered_by = EXCLUDED.registered_by, registered_at = now(),
          retired_by = NULL, retirement_reason = NULL, retired_at = NULL,
          updated_at = now()
      `;
      await transaction`
        DELETE FROM workspace_ai_adapter_registration_capability
        WHERE registration_id = ${id}
      `;
      await transaction`
        INSERT INTO workspace_ai_adapter_registration_capability (registration_id, capability)
        SELECT ${id}, capability
        FROM workspace_ai_adapter_candidate_capability
        WHERE candidate_id = ${input.candidateId}
      `;
      await auditAdapterRegistration(
        transaction,
        input.workspaceId,
        actorUserId,
        id,
        candidates[0].provider,
        "registered",
      );
      return id;
    });
    return (await this.listWorkspaceAdapterRegistrations(input.workspaceId, actorUserId))
      .find((registration) => registration.id === registrationId)!;
  }

  async retireWorkspaceAdapterRegistration(
    input: AiWorkspaceAdapterRegistrationRetirementWrite,
    actorUserId: string,
  ): Promise<AiWorkspaceAdapterRegistration> {
    if (
      !input.retirementReason ||
      input.retirementReason.trim() !== input.retirementReason ||
      input.retirementReason.length > 500
    )
      throw new AiPolicyValidationError([
        { field: "retirementReason", message: "Provide a bounded trimmed retirement reason." },
      ]);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{ provider: string }[]>`
        UPDATE workspace_ai_adapter_registration SET
          status = 'retired', retired_by = ${actorUserId},
          retirement_reason = ${input.retirementReason},
          retired_at = now(), updated_at = now()
        WHERE id = ${input.registrationId} AND workspace_id = ${input.workspaceId}
          AND status = 'registered'
        RETURNING provider
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "registrationId", message: "Choose a registered workspace adapter." },
        ]);
      await auditAdapterRegistration(
        transaction,
        input.workspaceId,
        actorUserId,
        input.registrationId,
        rows[0].provider,
        "retired",
      );
      await retireWorkspaceAdapterRateBindings(
        transaction,
        input.workspaceId,
        actorUserId,
        rows[0].provider,
        "Workspace registration retired; pricing binding retired automatically.",
        "registration_retired",
      );
    });
    return (await this.listWorkspaceAdapterRegistrations(input.workspaceId, actorUserId))
      .find((registration) => registration.id === input.registrationId)!;
  }

  async listWorkspaceAdapterRateBindings(
    workspaceId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiWorkspaceAdapterRateBinding[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceAdapterRateBindings(transaction, workspaceId, asOf);
    });
  }

  async bindWorkspaceAdapterRateCard(
    input: AiWorkspaceAdapterRateBindingWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiWorkspaceAdapterRateBinding> {
    const bindingId = await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const registrations = await transaction<{
        provider: string;
        modelId: string;
        status: string;
        currentEvidence: boolean;
      }[]>`
        SELECT r.provider, r.model_id, r.status,
          (a.status = 'approved' AND m.retired_at IS NULL AND c.status = 'verified'
           AND r.source_credential_fingerprint = a.source_credential_fingerprint
           AND m.credential_fingerprint = a.source_credential_fingerprint
           AND c.credential_fingerprint = a.source_credential_fingerprint) AS current_evidence
        FROM workspace_ai_adapter_registration r
        JOIN workspace_ai_adapter_candidate a ON a.id = r.candidate_id
        JOIN workspace_ai_provider_model m
          ON m.workspace_id = r.workspace_id AND m.provider = r.provider AND m.model_id = r.model_id
        JOIN workspace_ai_provider_connection c
          ON c.workspace_id = r.workspace_id AND c.provider = r.provider
        WHERE r.id = ${input.registrationId} AND r.workspace_id = ${input.workspaceId}
        FOR UPDATE OF r, a, m, c
      `;
      if (!registrations[0] || registrations[0].status !== "registered")
        throw new AiPolicyValidationError([
          { field: "registrationId", message: "Choose a registered workspace adapter." },
        ]);
      if (!registrations[0].currentEvidence)
        throw new AiPolicyValidationError([
          { field: "registrationId", message: "Registration evidence is stale; refresh its candidate and registration." },
        ]);
      const rateCard = await selectProviderRateCard(transaction, input.rateCardId, asOf);
      if (!rateCard)
        throw new AiPolicyValidationError([
          { field: "rateCardId", message: "Choose an approved rate card effective now." },
        ]);
      if (
        rateCard.provider !== registrations[0].provider ||
        rateCard.modelFamily !== registrations[0].modelId
      )
        throw new AiPolicyValidationError([
          { field: "rateCardId", message: "Rate card provider and model family must exactly match the registration." },
        ]);
      const existing = await transaction<{ id: string; status: string }[]>`
        SELECT id, status FROM workspace_ai_adapter_rate_binding
        WHERE registration_id = ${input.registrationId} AND currency = ${rateCard.currency}
        FOR UPDATE
      `;
      if (existing[0]?.status === "bound")
        throw new AiPolicyValidationError([
          { field: "rateCardId", message: "This registration already has current pricing for that currency." },
        ]);
      const id = existing[0]?.id ?? randomUUID();
      await transaction`
        INSERT INTO workspace_ai_adapter_rate_binding (
          id, workspace_id, registration_id, rate_card_id, currency,
          status, rate_card_source_hash, bound_by
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.registrationId},
          ${rateCard.id}, ${rateCard.currency}, 'bound',
          ${rateCard.sourceHash}, ${actorUserId}
        )
        ON CONFLICT (registration_id, currency) DO UPDATE SET
          rate_card_id = EXCLUDED.rate_card_id, status = 'bound',
          rate_card_source_hash = EXCLUDED.rate_card_source_hash,
          bound_by = EXCLUDED.bound_by, bound_at = now(),
          retired_by = NULL, retirement_reason = NULL, retired_at = NULL,
          updated_at = now()
      `;
      await auditAdapterRateBinding(
        transaction,
        input.workspaceId,
        actorUserId,
        id,
        registrations[0].provider,
        rateCard.currency,
        "bound",
      );
      return id;
    });
    return (await this.listWorkspaceAdapterRateBindings(input.workspaceId, actorUserId, asOf))
      .find((binding) => binding.id === bindingId)!;
  }

  async retireWorkspaceAdapterRateBinding(
    input: AiWorkspaceAdapterRateBindingRetirementWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiWorkspaceAdapterRateBinding> {
    if (
      !input.retirementReason || input.retirementReason.trim() !== input.retirementReason ||
      input.retirementReason.length > 500
    )
      throw new AiPolicyValidationError([
        { field: "retirementReason", message: "Provide a bounded trimmed retirement reason." },
      ]);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{ provider: string; currency: string }[]>`
        UPDATE workspace_ai_adapter_rate_binding b SET
          status = 'retired', retired_by = ${actorUserId},
          retirement_reason = ${input.retirementReason},
          retired_at = now(), updated_at = now()
        FROM workspace_ai_adapter_registration r
        WHERE b.id = ${input.bindingId} AND b.workspace_id = ${input.workspaceId}
          AND b.status = 'bound' AND r.id = b.registration_id
        RETURNING r.provider, b.currency
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "bindingId", message: "Choose a current workspace pricing binding." },
        ]);
      await auditAdapterRateBinding(
        transaction,
        input.workspaceId,
        actorUserId,
        input.bindingId,
        rows[0].provider,
        rows[0].currency,
        "retired",
      );
      await retireWorkspaceAdapterInvocationBindingsForRates(
        transaction,
        input.workspaceId,
        actorUserId,
        rows[0].provider,
        "Pricing evidence retired; invocation configuration retired automatically.",
        "pricing_retired",
      );
    });
    return (await this.listWorkspaceAdapterRateBindings(input.workspaceId, actorUserId, asOf))
      .find((binding) => binding.id === input.bindingId)!;
  }

  async listProviderInvocationContracts(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AiProviderInvocationContract[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectProviderInvocationContracts(transaction);
    });
  }

  async listWorkspaceAdapterInvocationBindings(
    workspaceId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiWorkspaceAdapterInvocationBinding[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceAdapterInvocationBindings(transaction, workspaceId, asOf);
    });
  }

  async configureWorkspaceAdapterInvocation(
    input: AiWorkspaceAdapterInvocationBindingWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiWorkspaceAdapterInvocationBinding> {
    const bindingId = await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{
        provider: string;
        registrationStatus: string;
        rateStatus: string;
        pricingCurrent: boolean;
        contractStatus: string;
        contractSourceHash: string;
        implementationAvailable: boolean;
        codecAvailable: boolean;
        transportAvailable: boolean;
        evidenceCurrent: boolean;
      }[]>`
        SELECT r.provider, r.status AS registration_status,
          rb.status AS rate_status,
          (rb.status = 'bound' AND card.status = 'approved'
           AND rb.rate_card_source_hash = card.source_hash
           AND card.effective_from <= ${asOf}
           AND (card.effective_to IS NULL OR card.effective_to > ${asOf})) AS pricing_current,
          ic.status AS contract_status, ic.source_hash AS contract_source_hash,
          ic.implementation_available, ic.codec_available, ic.transport_available,
          (a.status = 'approved' AND m.retired_at IS NULL AND c.status = 'verified'
           AND r.source_credential_fingerprint = a.source_credential_fingerprint
           AND m.credential_fingerprint = a.source_credential_fingerprint
           AND c.credential_fingerprint = a.source_credential_fingerprint) AS evidence_current
        FROM workspace_ai_adapter_registration r
        JOIN workspace_ai_adapter_candidate a ON a.id = r.candidate_id
        JOIN workspace_ai_provider_model m
          ON m.workspace_id = r.workspace_id AND m.provider = r.provider AND m.model_id = r.model_id
        JOIN workspace_ai_provider_connection c
          ON c.workspace_id = r.workspace_id AND c.provider = r.provider
        JOIN workspace_ai_adapter_rate_binding rb
          ON rb.id = ${input.rateBindingId} AND rb.workspace_id = r.workspace_id
          AND rb.registration_id = r.id
        JOIN ai_provider_rate_card card ON card.id = rb.rate_card_id
        JOIN ai_provider_invocation_contract ic
          ON ic.id = ${input.contractId} AND ic.provider = r.provider
        WHERE r.id = ${input.registrationId} AND r.workspace_id = ${input.workspaceId}
        FOR UPDATE OF r, a, m, c, rb, card, ic
      `;
      const current = rows[0];
      if (!current || current.registrationStatus !== "registered" || !current.evidenceCurrent)
        throw new AiPolicyValidationError([
          { field: "registrationId", message: "Choose a registered adapter with current evidence." },
        ]);
      if (current.rateStatus !== "bound" || !current.pricingCurrent)
        throw new AiPolicyValidationError([
          { field: "rateBindingId", message: "Choose current source-verified pricing for this registration." },
        ]);
      if (current.contractStatus !== "approved")
        throw new AiPolicyValidationError([
          { field: "contractId", message: "Choose an approved server-owned invocation contract for this provider." },
        ]);
      if (!current.implementationAvailable)
        throw new AiPolicyValidationError([
          { field: "contractId", message: "Choose a contract with a reviewed internal implementation." },
        ]);
      if (!current.codecAvailable)
        throw new AiPolicyValidationError([
          { field: "contractId", message: "Choose a contract with a reviewed provider text codec." },
        ]);
      if (!current.transportAvailable)
        throw new AiPolicyValidationError([
          { field: "contractId", message: "Choose a contract with a reviewed fixed provider transport." },
        ]);
      const existing = await transaction<{ id: string; status: string }[]>`
        SELECT id, status FROM workspace_ai_adapter_invocation_binding
        WHERE registration_id = ${input.registrationId}
        FOR UPDATE
      `;
      if (existing[0]?.status === "configured")
        throw new AiPolicyValidationError([
          { field: "registrationId", message: "This registration already has a current invocation configuration." },
        ]);
      const id = existing[0]?.id ?? randomUUID();
      await transaction`
        INSERT INTO workspace_ai_adapter_invocation_binding (
          id, workspace_id, registration_id, rate_binding_id, contract_id,
          provider, status, contract_source_hash, configured_by
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.registrationId},
          ${input.rateBindingId}, ${input.contractId}, ${current.provider},
          'configured', ${current.contractSourceHash}, ${actorUserId}
        )
        ON CONFLICT (registration_id) DO UPDATE SET
          rate_binding_id = EXCLUDED.rate_binding_id,
          contract_id = EXCLUDED.contract_id, provider = EXCLUDED.provider,
          status = 'configured',
          contract_source_hash = EXCLUDED.contract_source_hash,
          configured_by = EXCLUDED.configured_by, configured_at = now(),
          retired_by = NULL, retirement_reason = NULL, retired_at = NULL,
          updated_at = now()
      `;
      await auditAdapterInvocationBinding(
        transaction,
        input.workspaceId,
        actorUserId,
        id,
        current.provider,
        "configured",
      );
      return id;
    });
    return (await this.listWorkspaceAdapterInvocationBindings(
      input.workspaceId,
      actorUserId,
      asOf,
    )).find((binding) => binding.id === bindingId)!;
  }

  async retireWorkspaceAdapterInvocationBinding(
    input: AiWorkspaceAdapterInvocationBindingRetirementWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiWorkspaceAdapterInvocationBinding> {
    if (
      !input.retirementReason || input.retirementReason.trim() !== input.retirementReason ||
      input.retirementReason.length > 500
    )
      throw new AiPolicyValidationError([
        { field: "retirementReason", message: "Provide a bounded trimmed retirement reason." },
      ]);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{ provider: string }[]>`
        UPDATE workspace_ai_adapter_invocation_binding SET
          status = 'retired', retired_by = ${actorUserId},
          retirement_reason = ${input.retirementReason},
          retired_at = now(), updated_at = now()
        WHERE id = ${input.bindingId} AND workspace_id = ${input.workspaceId}
          AND status = 'configured'
        RETURNING provider
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "bindingId", message: "Choose a current invocation configuration." },
        ]);
      await auditAdapterInvocationBinding(
        transaction,
        input.workspaceId,
        actorUserId,
        input.bindingId,
        rows[0].provider,
        "retired",
      );
    });
    return (await this.listWorkspaceAdapterInvocationBindings(
      input.workspaceId,
      actorUserId,
      asOf,
    )).find((binding) => binding.id === input.bindingId)!;
  }

  async getWorkspaceAdapterHealthProbeTarget(
    workspaceId: string,
    invocationBindingId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiWorkspaceAdapterHealthProbeTarget> {
    return this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, workspaceId, actorUserId);
      const rows = await transaction<AiWorkspaceAdapterHealthProbeTarget[]>`
        SELECT ib.workspace_id, ib.id AS invocation_binding_id, ib.provider,
          c.encrypted_credential, c.credential_fingerprint,
          ic.source_hash AS contract_source_hash
        FROM workspace_ai_adapter_invocation_binding ib
        JOIN workspace_ai_adapter_registration r ON r.id = ib.registration_id
        JOIN workspace_ai_adapter_candidate a ON a.id = r.candidate_id
        JOIN workspace_ai_provider_model m
          ON m.workspace_id = r.workspace_id AND m.provider = r.provider AND m.model_id = r.model_id
        JOIN workspace_ai_provider_connection c
          ON c.workspace_id = r.workspace_id AND c.provider = r.provider
        JOIN workspace_ai_adapter_rate_binding rb ON rb.id = ib.rate_binding_id
        JOIN ai_provider_rate_card card ON card.id = rb.rate_card_id
        JOIN ai_provider_invocation_contract ic ON ic.id = ib.contract_id
        WHERE ib.id = ${invocationBindingId} AND ib.workspace_id = ${workspaceId}
          AND ib.status = 'configured' AND r.status = 'registered'
          AND a.status = 'approved' AND m.retired_at IS NULL
          AND c.status = 'verified' AND c.encrypted_credential IS NOT NULL
          AND r.source_credential_fingerprint = a.source_credential_fingerprint
          AND m.credential_fingerprint = a.source_credential_fingerprint
          AND c.credential_fingerprint = a.source_credential_fingerprint
          AND rb.status = 'bound' AND card.status = 'approved'
          AND rb.rate_card_source_hash = card.source_hash
          AND card.effective_from <= ${asOf}
          AND (card.effective_to IS NULL OR card.effective_to > ${asOf})
          AND ic.status = 'approved' AND ic.codec_available = true
          AND ic.transport_available = true AND ic.implementation_available = true
          AND ib.contract_source_hash = ic.source_hash
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "bindingId", message: "Choose a current invocation configuration with verified provider evidence." },
        ]);
      return rows[0];
    });
  }

  async recordWorkspaceAdapterHealthObservation(
    input: AiWorkspaceAdapterHealthObservationWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiWorkspaceAdapterHealthObservation> {
    if (
      (input.status === "healthy" && (input.failureCode || input.safeMessage)) ||
      (input.status === "unhealthy" && (
        !input.failureCode || !input.safeMessage ||
        input.safeMessage.trim() !== input.safeMessage || input.safeMessage.length > 300
      ))
    )
      throw new AiPolicyValidationError([
        { field: "status", message: "Provide a consistent minimized health outcome." },
      ]);
    const observationId = await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{ provider: string }[]>`
        SELECT ib.provider
        FROM workspace_ai_adapter_invocation_binding ib
        JOIN workspace_ai_adapter_registration r ON r.id = ib.registration_id
        JOIN workspace_ai_adapter_candidate a ON a.id = r.candidate_id
        JOIN workspace_ai_provider_model m
          ON m.workspace_id = r.workspace_id AND m.provider = r.provider AND m.model_id = r.model_id
        JOIN workspace_ai_provider_connection c
          ON c.workspace_id = r.workspace_id AND c.provider = r.provider
        JOIN workspace_ai_adapter_rate_binding rb ON rb.id = ib.rate_binding_id
        JOIN ai_provider_rate_card card ON card.id = rb.rate_card_id
        JOIN ai_provider_invocation_contract ic ON ic.id = ib.contract_id
        WHERE ib.id = ${input.invocationBindingId}
          AND ib.workspace_id = ${input.workspaceId}
          AND ib.provider = ${input.provider}
          AND ib.status = 'configured' AND r.status = 'registered'
          AND a.status = 'approved' AND m.retired_at IS NULL
          AND c.status = 'verified' AND c.encrypted_credential IS NOT NULL
          AND c.credential_fingerprint = ${input.expectedCredentialFingerprint}
          AND r.source_credential_fingerprint = c.credential_fingerprint
          AND a.source_credential_fingerprint = c.credential_fingerprint
          AND m.credential_fingerprint = c.credential_fingerprint
          AND rb.status = 'bound' AND card.status = 'approved'
          AND rb.rate_card_source_hash = card.source_hash
          AND card.effective_from <= ${asOf}
          AND (card.effective_to IS NULL OR card.effective_to > ${asOf})
          AND ic.status = 'approved' AND ic.codec_available = true
          AND ic.transport_available = true AND ic.implementation_available = true
          AND ic.source_hash = ${input.expectedContractSourceHash}
          AND ib.contract_source_hash = ic.source_hash
        FOR UPDATE OF ib, r, a, m, c, rb, card, ic
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "bindingId", message: "Invocation configuration changed during the health probe; run it again." },
        ]);
      const id = randomUUID();
      const expiresAt = new Date(asOf.getTime() + AI_ADAPTER_HEALTH_TTL_MS);
      await transaction`
        INSERT INTO workspace_ai_adapter_health_observation (
          id, workspace_id, invocation_binding_id, provider, status,
          failure_code, safe_message, credential_fingerprint,
          contract_source_hash, checked_by, checked_at, expires_at
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.invocationBindingId},
          ${input.provider}, ${input.status}, ${input.failureCode ?? null},
          ${input.safeMessage ?? null}, ${input.expectedCredentialFingerprint},
          ${input.expectedContractSourceHash}, ${actorUserId}, ${asOf}, ${expiresAt}
        )
      `;
      await auditAdapterHealthObservation(
        transaction,
        input.workspaceId,
        actorUserId,
        id,
        input.provider,
        input.status,
      );
      return id;
    });
    const observation = (await this.listWorkspaceAdapterInvocationBindings(
      input.workspaceId,
      actorUserId,
      asOf,
    )).flatMap((binding) => binding.latestHealthObservation ?? [])
      .find((item) => item.id === observationId);
    if (!observation) throw new Error("Health observation projection lost the committed row.");
    return observation;
  }

  async listWorkspaceTextInvocationIntents(
    workspaceId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextInvocationIntent[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceTextInvocationIntents(transaction, workspaceId, asOf);
    });
  }

  async prepareWorkspaceDraftRevisionIntent(
    input: AiDraftRevisionIntentWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<PreparedAiDraftRevisionIntent> {
    validateDraftRevisionIntent(input);
    const prompt = await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      return selectDraftRevisionPrompt(
        transaction, input.workspaceId, input.contentDraftId, input.goal,
      );
    });
    const intent = await this.prepareWorkspaceTextInvocationIntent({
      workspaceId: input.workspaceId,
      invocationBindingId: input.invocationBindingId,
      reservationId: input.reservationId,
      idempotencyKey: input.idempotencyKey,
      userText: prompt.userText,
      systemText: prompt.systemText,
      maxOutputTokens: input.maxOutputTokens,
      draftRevision: {
        contentDraftId: prompt.contentDraftId,
        contentDraftVersionId: prompt.contentDraftVersionId,
        goal: prompt.goal,
        promptVersion: prompt.promptVersion,
        contextSha256: prompt.contextSha256,
      },
    }, actorUserId, asOf);
    return { intent, prompt };
  }

  async getWorkspaceDraftRevisionExecutionPrompt(
    workspaceId: string,
    intentId: string,
    actorUserId: string,
  ): Promise<AiDraftRevisionPromptTarget> {
    if (!isUuid(intentId))
      throw new AiPolicyValidationError([{
        field: "intentId", message: "Choose a Draft-bound text invocation intent.",
      }]);
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const rows = await transaction<{
        contentDraftId: string;
        contentDraftVersionId: string;
        goal: AiDraftRevisionGoal;
        promptVersion: string;
        contextSha256: string;
        userTextSha256: string;
        systemTextSha256: string;
      }[]>`
        SELECT source_content_draft_id AS content_draft_id,
          source_content_draft_version_id AS content_draft_version_id,
          draft_revision_goal AS goal, product_prompt_version AS prompt_version,
          source_context_sha256 AS context_sha256,
          user_text_sha256, system_text_sha256
        FROM workspace_ai_text_invocation_intent
        WHERE id = ${intentId} AND workspace_id = ${workspaceId}
          AND source_content_draft_id IS NOT NULL
          AND source_content_draft_version_id IS NOT NULL
          AND draft_revision_goal IS NOT NULL
          AND product_prompt_version IS NOT NULL
          AND source_context_sha256 IS NOT NULL
        FOR UPDATE
      `;
      const source = rows[0];
      if (!source)
        throw new AiPolicyValidationError([{
          field: "intentId", message: "The text invocation intent is not Draft-bound.",
        }]);
      const prompt = await selectDraftRevisionPrompt(
        transaction, workspaceId, source.contentDraftId, source.goal,
        source.contentDraftVersionId, source.promptVersion,
      );
      if (source.promptVersion !== prompt.promptVersion ||
        source.contextSha256 !== prompt.contextSha256 ||
        source.userTextSha256 !== sha256(prompt.userText) ||
        source.systemTextSha256 !== sha256(prompt.systemText))
        throw new AiPolicyValidationError([{
          field: "intentId",
          message: "The Draft-bound prompt no longer matches its immutable source evidence.",
        }]);
      return prompt;
    });
  }

  async prepareWorkspaceTextInvocationIntent(
    input: AiTextInvocationIntentWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextInvocationIntent> {
    validateTextInvocationIntent(input);
    const userTextSha256 = sha256(input.userText);
    const systemTextSha256 = input.systemText ? sha256(input.systemText) : undefined;
    const requestHash = sha256(JSON.stringify({
      workspaceId: input.workspaceId,
      invocationBindingId: input.invocationBindingId,
      reservationId: input.reservationId,
      userTextSha256,
      systemTextSha256: systemTextSha256 ?? null,
      maxOutputTokens: input.maxOutputTokens,
      draftRevision: input.draftRevision ?? null,
    }));
    const intentId = await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const existing = await transaction<{ id: string; requestHash: string }[]>`
        SELECT id, request_hash FROM workspace_ai_text_invocation_intent
        WHERE workspace_id = ${input.workspaceId}
          AND idempotency_key = ${input.idempotencyKey}
        FOR UPDATE
      `;
      if (existing[0]) {
        if (existing[0].requestHash !== requestHash)
          throw new AiPolicyValidationError([{
            field: "idempotencyKey",
            message: "Idempotency key is bound to another text invocation intent.",
          }]);
        return existing[0].id;
      }
      let verifiedDraftRevision: AiDraftRevisionPromptTarget | undefined;
      if (input.draftRevision) {
        verifiedDraftRevision = await selectDraftRevisionPrompt(
          transaction,
          input.workspaceId,
          input.draftRevision.contentDraftId,
          input.draftRevision.goal,
          input.draftRevision.contentDraftVersionId,
        );
        if (verifiedDraftRevision.promptVersion !== input.draftRevision.promptVersion ||
          verifiedDraftRevision.contextSha256 !== input.draftRevision.contextSha256 ||
          verifiedDraftRevision.userText !== input.userText ||
          verifiedDraftRevision.systemText !== input.systemText)
          throw new AiPolicyValidationError([{
            field: "contentDraftId",
            message: "The Draft revision prompt does not match the current immutable Draft evidence.",
          }]);
      }
      const targets = await transaction<{
        provider: "openai" | "anthropic" | "google_generative_ai";
        modelId: string;
        feature: string;
        currency: string;
        estimatedCostMinor: number;
        costQuoteId: string;
        contractSourceHash: string;
        credentialFingerprint: string;
        reservationExpiresAt: Date | string;
      }[]>`
        SELECT ib.provider, r.model_id, q.feature, q.currency,
          s.estimated_cost_minor, q.id AS cost_quote_id,
          ic.source_hash AS contract_source_hash,
          c.credential_fingerprint,
          s.expires_at AS reservation_expires_at
        FROM workspace_ai_adapter_invocation_binding ib
        JOIN workspace_ai_adapter_registration r ON r.id = ib.registration_id
        JOIN workspace_ai_adapter_candidate a ON a.id = r.candidate_id
        JOIN workspace_ai_provider_model m
          ON m.workspace_id = r.workspace_id AND m.provider = r.provider
          AND m.model_id = r.model_id
        JOIN workspace_ai_provider_connection c
          ON c.workspace_id = r.workspace_id AND c.provider = r.provider
        JOIN workspace_ai_adapter_rate_binding rb ON rb.id = ib.rate_binding_id
        JOIN ai_provider_rate_card card ON card.id = rb.rate_card_id
        JOIN ai_provider_invocation_contract ic ON ic.id = ib.contract_id
        JOIN ai_spend_reservation s
          ON s.id = ${input.reservationId} AND s.workspace_id = ib.workspace_id
        JOIN ai_cost_quote q
          ON q.id = s.cost_quote_id AND q.workspace_id = s.workspace_id
        JOIN LATERAL (
          SELECT o.status, o.credential_fingerprint, o.contract_source_hash,
            o.checked_at, o.expires_at
          FROM workspace_ai_adapter_health_observation o
          WHERE o.workspace_id = ib.workspace_id
            AND o.invocation_binding_id = ib.id
          ORDER BY o.checked_at DESC, o.id DESC LIMIT 1
        ) h ON true
        WHERE ib.id = ${input.invocationBindingId}
          AND ib.workspace_id = ${input.workspaceId}
          AND ib.status = 'configured' AND r.status = 'registered'
          AND a.status = 'approved' AND m.retired_at IS NULL
          AND c.status = 'verified' AND c.encrypted_credential IS NOT NULL
          AND r.source_credential_fingerprint = a.source_credential_fingerprint
          AND m.credential_fingerprint = a.source_credential_fingerprint
          AND c.credential_fingerprint = a.source_credential_fingerprint
          AND rb.status = 'bound' AND card.status = 'approved'
          AND rb.rate_card_source_hash = card.source_hash
          AND card.effective_from <= ${asOf}
          AND (card.effective_to IS NULL OR card.effective_to > ${asOf})
          AND ic.status = 'approved' AND ic.codec_available = true
          AND ic.transport_available = true AND ic.implementation_available = true
          AND ib.contract_source_hash = ic.source_hash
          AND h.status = 'healthy' AND h.checked_at >= ib.configured_at
          AND h.expires_at > ${asOf}
          AND h.credential_fingerprint = c.credential_fingerprint
          AND h.contract_source_hash = ic.source_hash
          AND s.status = 'reserved' AND s.expires_at > ${asOf}
          AND s.capability = 'generate_text'
          AND s.feature LIKE 'assistant.%'
          AND s.cost_quote_id IS NOT NULL
          AND q.capability = s.capability AND q.feature = s.feature
          AND q.currency = s.currency
          AND q.maximum_cost_minor = s.estimated_cost_minor
          AND q.rate_card_id = rb.rate_card_id
          AND q.expires_at > ${asOf}
        FOR UPDATE OF ib, r, a, m, c, rb, card, ic, s, q
      `;
      const target = targets[0];
      if (!target)
        throw new AiPolicyValidationError([{
          field: "reservationId",
          message: "Choose an active exact quote reservation for a healthy current text implementation.",
        }]);
      if (verifiedDraftRevision && target.feature !== "assistant.prepare_copy")
        throw new AiPolicyValidationError([{
          field: "reservationId",
          message: "Draft revision requests require a reserved prepare-copy quote.",
        }]);
      const id = randomUUID();
      await transaction`
        INSERT INTO workspace_ai_text_invocation_intent (
          id, workspace_id, invocation_binding_id, reservation_id,
          cost_quote_id, provider, model_id, idempotency_key,
          user_text_sha256, system_text_sha256, request_hash,
          max_output_tokens, contract_source_hash, credential_fingerprint,
          source_content_draft_id, source_content_draft_version_id,
          draft_revision_goal, product_prompt_version, source_context_sha256,
          status, prepared_by, prepared_at, expires_at, created_at, updated_at
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.invocationBindingId},
          ${input.reservationId}, ${target.costQuoteId}, ${target.provider},
          ${target.modelId}, ${input.idempotencyKey}, ${userTextSha256},
          ${systemTextSha256 ?? null}, ${requestHash}, ${input.maxOutputTokens},
          ${target.contractSourceHash}, ${target.credentialFingerprint},
          ${verifiedDraftRevision?.contentDraftId ?? null},
          ${verifiedDraftRevision?.contentDraftVersionId ?? null},
          ${verifiedDraftRevision?.goal ?? null},
          ${verifiedDraftRevision?.promptVersion ?? null},
          ${verifiedDraftRevision?.contextSha256 ?? null},
          'prepared', ${actorUserId}, ${asOf}, ${target.reservationExpiresAt},
          ${asOf}, ${asOf}
        )
      `;
      await this.auditTextInvocationIntent(
        transaction, input.workspaceId, actorUserId, id,
        "ai.text_invocation_intent_prepared", target.provider, "prepared",
        verifiedDraftRevision,
      );
      return id;
    });
    const intent = (await this.listWorkspaceTextInvocationIntents(
      input.workspaceId, actorUserId, asOf,
    )).find((item) => item.id === intentId);
    if (!intent) throw new Error("Text invocation intent projection lost the committed row.");
    return intent;
  }

  async cancelWorkspaceTextInvocationIntent(
    input: AiTextInvocationIntentCancelWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextInvocationIntent> {
    if (!isUuid(input.intentId) || !input.reason ||
      input.reason.trim() !== input.reason || input.reason.length > 500)
      throw new AiPolicyValidationError([{
        field: "reason", message: "Provide a bounded trimmed cancellation reason and valid intent ID.",
      }]);
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{
        reservationId: string;
        provider: string;
        status: string;
        contentDraftId?: string | null;
        contentDraftVersionId?: string | null;
        goal?: AiDraftRevisionGoal | null;
      }[]>`
        SELECT reservation_id, provider, status,
          source_content_draft_id AS content_draft_id,
          source_content_draft_version_id AS content_draft_version_id,
          draft_revision_goal AS goal
        FROM workspace_ai_text_invocation_intent
        WHERE id = ${input.intentId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current)
        throw new AiPolicyValidationError([{ field: "intentId", message: "Text invocation intent was not found." }]);
      if (current.status === "cancelled") return;
      await transaction`
        UPDATE workspace_ai_text_invocation_intent SET
          status = 'cancelled', cancelled_by = ${actorUserId},
          cancellation_reason = ${input.reason}, cancelled_at = ${asOf},
          updated_at = ${asOf}
        WHERE id = ${input.intentId} AND workspace_id = ${input.workspaceId}
      `;
      await transaction`
        UPDATE ai_spend_reservation SET status = 'released',
          resolved_by = ${actorUserId}, resolved_at = ${asOf}, updated_at = ${asOf}
        WHERE id = ${current.reservationId} AND workspace_id = ${input.workspaceId}
          AND status = 'reserved'
      `;
      await this.auditTextInvocationIntent(
        transaction, input.workspaceId, actorUserId, input.intentId,
        "ai.text_invocation_intent_cancelled", current.provider, "cancelled",
        current.contentDraftId && current.contentDraftVersionId && current.goal ? {
          contentDraftId: current.contentDraftId,
          contentDraftVersionId: current.contentDraftVersionId,
          goal: current.goal,
        } : undefined,
      );
    });
    const intent = (await this.listWorkspaceTextInvocationIntents(
      input.workspaceId, actorUserId, asOf,
    )).find((item) => item.id === input.intentId);
    if (!intent) throw new Error("Cancelled text invocation intent projection lost its row.");
    return intent;
  }

  async listWorkspaceTextInvocationAttempts(
    workspaceId: string,
    actorUserId: string,
  ): Promise<StoredAiTextInvocationAttempt[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceTextInvocationAttempts(transaction, workspaceId);
    });
  }

  async listWorkspaceTextOutputArtifacts(
    workspaceId: string,
    actorUserId: string,
  ): Promise<StoredAiTextOutputArtifact[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceTextOutputArtifacts(transaction, workspaceId);
    });
  }

  async listWorkspaceTextInvocationReconciliations(
    workspaceId: string,
    actorUserId: string,
  ): Promise<StoredAiTextInvocationReconciliation[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceTextInvocationReconciliations(transaction, workspaceId);
    });
  }

  async listWorkspaceTextInvocationResolutions(
    workspaceId: string,
    actorUserId: string,
  ): Promise<StoredAiTextInvocationResolution[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceTextInvocationResolutions(transaction, workspaceId);
    });
  }

  async listWorkspaceAiOperationalIncidents(
    workspaceId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiOperationalIncident[]> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceAiOperationalIncidents(transaction, workspaceId, asOf);
    });
  }

  async getWorkspaceAiOperationalIncidentResponsePolicy(
    workspaceId: string,
    actorUserId: string,
  ): Promise<StoredAiOperationalIncidentResponsePolicy> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceAiOperationalIncidentResponsePolicy(transaction, workspaceId);
    });
  }

  async saveWorkspaceAiOperationalIncidentResponsePolicy(
    input: AiOperationalIncidentResponsePolicyWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiOperationalIncidentResponsePolicy> {
    validateOperationalIncidentResponsePolicy(input);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      await transaction`
        INSERT INTO workspace_ai_operational_incident_response_policy (
          workspace_id, critical_acknowledgement_minutes,
          high_acknowledgement_minutes, critical_resolution_minutes,
          high_resolution_minutes, runbook_url, created_by, updated_by,
          created_at, updated_at
        ) VALUES (${input.workspaceId}, ${input.criticalAcknowledgementMinutes},
          ${input.highAcknowledgementMinutes}, ${input.criticalResolutionMinutes},
          ${input.highResolutionMinutes}, ${input.runbookUrl}, ${actorUserId},
          ${actorUserId}, ${asOf}, ${asOf})
        ON CONFLICT (workspace_id) DO UPDATE SET
          critical_acknowledgement_minutes = EXCLUDED.critical_acknowledgement_minutes,
          high_acknowledgement_minutes = EXCLUDED.high_acknowledgement_minutes,
          critical_resolution_minutes = EXCLUDED.critical_resolution_minutes,
          high_resolution_minutes = EXCLUDED.high_resolution_minutes,
          runbook_url = EXCLUDED.runbook_url,
          updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
      `;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.operational_incident_response_policy_saved',
          'workspace_ai_operational_incident_response_policy', ${input.workspaceId},
          ${transaction.json({
            criticalAcknowledgementMinutes: input.criticalAcknowledgementMinutes,
            highAcknowledgementMinutes: input.highAcknowledgementMinutes,
            criticalResolutionMinutes: input.criticalResolutionMinutes,
            highResolutionMinutes: input.highResolutionMinutes,
            runbookConfigured: true,
            runbookUrlIncluded: false,
            executionAuthority: false,
            externalAlertDeliveryConfigured: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return this.getWorkspaceAiOperationalIncidentResponsePolicy(
      input.workspaceId, actorUserId,
    );
  }

  async getWorkspaceAiOperationalAlertWebhook(
    workspaceId: string,
    actorUserId: string,
  ): Promise<StoredAiOperationalAlertWebhook> {
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceAiOperationalAlertWebhook(transaction, workspaceId);
    });
  }

  async saveWorkspaceAiOperationalAlertWebhook(
    input: AiOperationalAlertWebhookWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiOperationalAlertWebhook> {
    validateOperationalAlertWebhookWrite(input);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      await transaction`
        INSERT INTO workspace_ai_operational_alert_webhook (
          workspace_id, endpoint_url, encrypted_signing_secret,
          secret_fingerprint, encryption_key_version, status,
          last_tested_at, last_error, created_by, updated_by,
          created_at, updated_at
        ) VALUES (${input.workspaceId}, ${input.endpointUrl},
          ${input.encryptedSigningSecret}, ${input.secretFingerprint},
          ${input.encryptionKeyVersion}, 'unverified', NULL, NULL,
          ${actorUserId}, ${actorUserId}, ${asOf}, ${asOf})
        ON CONFLICT (workspace_id) DO UPDATE SET
          endpoint_url = EXCLUDED.endpoint_url,
          encrypted_signing_secret = EXCLUDED.encrypted_signing_secret,
          secret_fingerprint = EXCLUDED.secret_fingerprint,
          encryption_key_version = EXCLUDED.encryption_key_version,
          status = 'unverified', last_tested_at = NULL, last_error = NULL,
          updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
      `;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.operational_alert_webhook_saved',
          'workspace_ai_operational_alert_webhook', ${input.workspaceId},
          ${transaction.json({
            endpointOrigin: new URL(input.endpointUrl).origin,
            endpointPathIncluded: false,
            signingSecretIncluded: false,
            status: "unverified",
            executionAuthority: false,
            providerRequestAuthority: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return this.getWorkspaceAiOperationalAlertWebhook(input.workspaceId, actorUserId);
  }

  async getWorkspaceAiOperationalAlertWebhookVerificationTarget(
    workspaceId: string,
    actorUserId: string,
  ): Promise<AiOperationalAlertWebhookVerificationTarget | undefined> {
    return this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, workspaceId, actorUserId);
      const rows = await transaction<{
        workspaceId: string;
        endpointUrl: string;
        encryptedSigningSecret: string;
        secretFingerprint: string;
        encryptionKeyVersion: "v1";
      }[]>`
        SELECT workspace_id, endpoint_url, encrypted_signing_secret,
          secret_fingerprint, encryption_key_version
        FROM workspace_ai_operational_alert_webhook
        WHERE workspace_id = ${workspaceId}
      `;
      return rows[0];
    });
  }

  async recordWorkspaceAiOperationalAlertWebhookVerification(
    input: AiOperationalAlertWebhookVerificationWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiOperationalAlertWebhook> {
    validateOperationalAlertWebhookVerification(input);
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, input.workspaceId, actorUserId);
      const updated = await transaction<{ workspaceId: string }[]>`
        UPDATE workspace_ai_operational_alert_webhook SET
          status = ${input.status}, last_tested_at = ${asOf},
          last_error = ${input.status === "error" ? input.safeError! : null},
          updated_by = ${actorUserId}, updated_at = ${asOf}
        WHERE workspace_id = ${input.workspaceId}
          AND secret_fingerprint = ${input.expectedSecretFingerprint}
        RETURNING workspace_id
      `;
      if (!updated[0])
        throw new AiPolicyValidationError([{
          field: "webhook", message: "The webhook configuration changed before verification completed.",
        }]);
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.operational_alert_webhook_verification_recorded',
          'workspace_ai_operational_alert_webhook', ${input.workspaceId},
          ${transaction.json({
            status: input.status,
            safeError: input.status === "error" ? input.safeError : undefined,
            endpointIncluded: false,
            signingSecretIncluded: false,
            executionAuthority: false,
            providerRequestAuthority: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return this.getWorkspaceAiOperationalAlertWebhook(input.workspaceId, actorUserId);
  }

  async disableWorkspaceAiOperationalAlertWebhook(
    workspaceId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiOperationalAlertWebhook> {
    await this.sql.begin(async (transaction) => {
      await this.requireAdministrator(transaction, workspaceId, actorUserId);
      await transaction`
        UPDATE workspace_ai_operational_alert_webhook
        SET status = 'disabled', updated_by = ${actorUserId}, updated_at = ${asOf}
        WHERE workspace_id = ${workspaceId}
      `;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.operational_alert_webhook_disabled',
          'workspace_ai_operational_alert_webhook', ${workspaceId},
          ${transaction.json({ executionAuthority: false, providerRequestAuthority: false } as JSONValue)}
        FROM workspace WHERE id = ${workspaceId}
      `;
    });
    return this.getWorkspaceAiOperationalAlertWebhook(workspaceId, actorUserId);
  }

  async listWorkspaceAiOperationalAlertDeliveries(
    workspaceId: string,
    actorUserId: string,
    limit = 50,
  ): Promise<StoredAiOperationalAlertDelivery[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new AiPolicyValidationError([{ field: "limit", message: "Use a limit from 1 through 100." }]);
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceAiOperationalAlertDeliveries(transaction, workspaceId, limit);
    });
  }

  async enqueueAiOperationalAlertEvents(asOf: Date = new Date()): Promise<number> {
    return this.sql.begin(async (transaction) => {
      const configurations = await transaction<{ workspaceId: string }[]>`
        SELECT workspace_id FROM workspace_ai_operational_alert_webhook
        WHERE status = 'verified' ORDER BY workspace_id
        FOR UPDATE
      `;
      let enqueued = 0;
      for (const configuration of configurations) {
        const workspaceId = configuration.workspaceId;
        const incidents = await selectWorkspaceAiOperationalIncidents(transaction, workspaceId, asOf);
        const policy = await selectWorkspaceAiOperationalIncidentResponsePolicy(transaction, workspaceId);
        const enqueue = async (
          incident: StoredAiOperationalIncident,
          eventType: (typeof AI_OPERATIONAL_ALERT_EVENT_TYPES)[number],
          occurredAt: string,
        ) => {
          const id = randomUUID();
          const payload = operationalAlertPayload(id, eventType, incident, policy, occurredAt);
          const inserted = await transaction<{ id: string }[]>`
            INSERT INTO workspace_ai_operational_alert_delivery (
              id, workspace_id, incident_type, attempt_id, provider,
              event_type, source_observed_at, payload, status, attempt_count,
              next_attempt_at, claimed_at, delivered_at, response_status,
              last_error, created_at, updated_at
            ) VALUES (${id}, ${workspaceId}, ${incident.type}, ${incident.attemptId},
              ${incident.provider}, ${eventType}, ${new Date(incident.openedAt)},
              ${transaction.json(payload as JSONValue)}, 'pending', 0, ${asOf},
              NULL, NULL, NULL, NULL, ${asOf}, ${asOf})
            ON CONFLICT (workspace_id, incident_type, attempt_id, event_type) DO NOTHING
            RETURNING id
          `;
          enqueued += inserted.length;
        };
        for (const incident of incidents) {
          await enqueue(incident, "incident_opened", incident.openedAt);
          if (incident.acknowledged && incident.acknowledgedAt)
            await enqueue(incident, "incident_acknowledged", incident.acknowledgedAt);
          if (incident.acknowledgementOverdue)
            await enqueue(incident, "acknowledgement_overdue", incident.acknowledgementDueAt);
          if (incident.resolutionOverdue)
            await enqueue(incident, "resolution_overdue", incident.resolutionDueAt);
        }
        const activeKeys = new Set(incidents.map((incident) => `${incident.type}:${incident.attemptId}`));
        const opened = await transaction<{
          incidentType: StoredAiOperationalIncident["type"];
          attemptId: string;
          provider: StoredAiOperationalIncident["provider"];
          sourceObservedAt: Date | string;
          payload: Record<string, unknown>;
        }[]>`
          SELECT DISTINCT ON (incident_type, attempt_id)
            incident_type, attempt_id, provider, source_observed_at, payload
          FROM workspace_ai_operational_alert_delivery
          WHERE workspace_id = ${workspaceId} AND event_type = 'incident_opened'
          ORDER BY incident_type, attempt_id, created_at
        `;
        for (const prior of opened) {
          if (activeKeys.has(`${prior.incidentType}:${prior.attemptId}`)) continue;
          const id = randomUUID();
          const payload = {
            ...prior.payload,
            id,
            eventType: "incident_resolved",
            occurredAt: asOf.toISOString(),
            incident: typeof prior.payload.incident === "object" && prior.payload.incident
              ? { ...(prior.payload.incident as Record<string, unknown>), active: false }
              : { active: false },
            acknowledged: Boolean(prior.payload.acknowledged),
            executionAuthority: false,
            providerRequestAuthority: false,
          };
          const inserted = await transaction<{ id: string }[]>`
            INSERT INTO workspace_ai_operational_alert_delivery (
              id, workspace_id, incident_type, attempt_id, provider,
              event_type, source_observed_at, payload, status, attempt_count,
              next_attempt_at, claimed_at, delivered_at, response_status,
              last_error, created_at, updated_at
            ) VALUES (${id}, ${workspaceId}, ${prior.incidentType}, ${prior.attemptId},
              ${prior.provider}, 'incident_resolved', ${new Date(prior.sourceObservedAt)},
              ${transaction.json(payload as JSONValue)}, 'pending', 0, ${asOf},
              NULL, NULL, NULL, NULL, ${asOf}, ${asOf})
            ON CONFLICT (workspace_id, incident_type, attempt_id, event_type) DO NOTHING
            RETURNING id
          `;
          enqueued += inserted.length;
        }
      }
      return enqueued;
    });
  }

  async claimAiOperationalAlertDeliveries(
    limit = 25,
    asOf: Date = new Date(),
  ): Promise<AiOperationalAlertDeliveryTarget[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new AiPolicyValidationError([{ field: "limit", message: "Use a limit from 1 through 100." }]);
    return this.sql.begin(async (transaction) => {
      await transaction`
        UPDATE workspace_ai_operational_alert_delivery SET
          status = 'dead_letter', claimed_at = NULL,
          last_error = 'Webhook delivery lease expired after the final attempt.',
          updated_at = ${asOf}
        WHERE status = 'processing' AND attempt_count = 5
          AND claimed_at <= ${new Date(asOf.getTime() - 5 * 60_000)}
      `;
      const rows = await transaction<{
        id: string;
        workspaceId: string;
        endpointUrl: string;
        encryptedSigningSecret: string;
        secretFingerprint: string;
        encryptionKeyVersion: "v1";
        eventType: AiOperationalAlertDeliveryTarget["eventType"];
        payload: Record<string, unknown>;
        occurredAt: Date | string;
        attemptCount: number;
      }[]>`
        WITH candidate AS (
          SELECT delivery.id
          FROM workspace_ai_operational_alert_delivery delivery
          JOIN workspace_ai_operational_alert_webhook webhook
            ON webhook.workspace_id = delivery.workspace_id
            AND webhook.status = 'verified'
          WHERE delivery.attempt_count < 5 AND (
            (delivery.status IN ('pending', 'failed') AND delivery.next_attempt_at <= ${asOf}) OR
            (delivery.status = 'processing'
              AND delivery.claimed_at <= ${new Date(asOf.getTime() - 5 * 60_000)})
          )
          ORDER BY delivery.next_attempt_at, delivery.created_at, delivery.id
          FOR UPDATE OF delivery SKIP LOCKED LIMIT ${limit}
        ), claimed AS (
          UPDATE workspace_ai_operational_alert_delivery delivery SET
            status = 'processing', attempt_count = delivery.attempt_count + 1,
            claimed_at = ${asOf}, updated_at = ${asOf}
          FROM candidate WHERE delivery.id = candidate.id
          RETURNING delivery.*
        )
        SELECT claimed.id, claimed.workspace_id, webhook.endpoint_url,
          webhook.encrypted_signing_secret, webhook.secret_fingerprint,
          webhook.encryption_key_version, claimed.event_type, claimed.payload,
          claimed.updated_at AS occurred_at, claimed.attempt_count
        FROM claimed JOIN workspace_ai_operational_alert_webhook webhook
          ON webhook.workspace_id = claimed.workspace_id
        ORDER BY claimed.next_attempt_at, claimed.created_at, claimed.id
      `;
      return rows.map((row) => ({
        ...row,
        occurredAt: new Date(row.occurredAt).toISOString(),
        payload: row.payload,
      }));
    });
  }

  async recordAiOperationalAlertDeliveryOutcome(
    input: AiOperationalAlertDeliveryOutcomeWrite,
    asOf: Date = new Date(),
  ): Promise<void> {
    if (!Number.isInteger(input.attemptCount) || input.attemptCount < 1 || input.attemptCount > 5)
      throw new AiPolicyValidationError([{ field: "attemptCount", message: "Use the claimed attempt count." }]);
    if (input.outcome.status === "failed" &&
      (!input.outcome.safeError.trim() || input.outcome.safeError.length > 300))
      throw new AiPolicyValidationError([{ field: "safeError", message: "Use a safe error up to 300 characters." }]);
    const retry = input.outcome.status === "failed" && input.outcome.retryable && input.attemptCount < 5;
    const retryDelaySeconds = [60, 300, 900, 3600][Math.min(input.attemptCount - 1, 3)]!;
    const updated = await this.sql<[{ id: string }?]>`
      UPDATE workspace_ai_operational_alert_delivery SET
        status = ${input.outcome.status === "delivered" ? "delivered" : retry ? "failed" : "dead_letter"},
        next_attempt_at = ${retry ? new Date(asOf.getTime() + retryDelaySeconds * 1_000) : asOf},
        claimed_at = NULL,
        delivered_at = ${input.outcome.status === "delivered" ? asOf : null},
        response_status = ${input.outcome.responseStatus ?? null},
        last_error = ${input.outcome.status === "failed" ? input.outcome.safeError : null},
        updated_at = ${asOf}
      WHERE id = ${input.deliveryId} AND workspace_id = ${input.workspaceId}
        AND status = 'processing' AND attempt_count = ${input.attemptCount}
      RETURNING id
    `;
    if (!updated[0]) throw new Error("Operational alert delivery claim is no longer current.");
  }

  async getWorkspaceAiOperationalReadiness(
    workspaceId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiOperationalReadiness> {
    const [incidents, alertWebhook] = await Promise.all([
      this.listWorkspaceAiOperationalIncidents(workspaceId, actorUserId, asOf),
      this.getWorkspaceAiOperationalAlertWebhook(workspaceId, actorUserId),
    ]);
    const unacknowledgedIncidentCount = incidents.filter((incident) => !incident.acknowledged).length;
    const criticalIncidentCount = incidents.filter((incident) => incident.severity === "critical").length;
    const acknowledgementOverdueCount = incidents.filter((incident) => incident.acknowledgementOverdue).length;
    const acknowledgementLateCount = incidents.filter((incident) => incident.acknowledgementLate).length;
    const resolutionOverdueCount = incidents.filter((incident) => incident.resolutionOverdue).length;
    const oldestActiveAt = incidents.length
      ? incidents.map((incident) => incident.openedAt).sort()[0]
      : undefined;
    const nextResponseDueAt = incidents.length
      ? incidents.flatMap((incident) => [
          ...(!incident.acknowledged ? [incident.acknowledgementDueAt] : []),
          incident.resolutionDueAt,
        ]).sort()[0]
      : undefined;
    return {
      workspaceId,
      state: criticalIncidentCount > 0 || unacknowledgedIncidentCount > 0 ||
        acknowledgementLateCount > 0 || resolutionOverdueCount > 0
        ? "blocked"
        : incidents.length > 0 ? "attention" : "ready",
      activeIncidentCount: incidents.length,
      unacknowledgedIncidentCount,
      criticalIncidentCount,
      acknowledgementOverdueCount,
      acknowledgementLateCount,
      resolutionOverdueCount,
      ...(oldestActiveAt ? { oldestActiveAt } : {}),
      ...(nextResponseDueAt ? { nextResponseDueAt } : {}),
      evaluatedAt: asOf.toISOString(),
      executionShouldRemainStopped: incidents.length > 0,
      externalAlertDeliveryConfigured: alertWebhook.deliveryEnabled,
      publicExecutionRouteAvailable: false,
    };
  }

  async acknowledgeWorkspaceAiOperationalIncident(
    input: AiOperationalIncidentAcknowledgeWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiOperationalIncident> {
    validateOperationalIncidentAcknowledgement(input);
    await this.sql.begin(async (transaction) => {
      await this.requireApprover(transaction, input.workspaceId, actorUserId);
      const incidents = await selectWorkspaceAiOperationalIncidents(
        transaction, input.workspaceId, asOf,
      );
      const incident = incidents.find((item) =>
        item.type === input.type && item.attemptId === input.attemptId,
      );
      if (!incident)
        throw new AiPolicyValidationError([{
          field: "attemptId",
          message: "Choose an active AI operational incident in this workspace.",
        }]);
      if (incident.acknowledged) return;
      await transaction`
        SELECT id FROM workspace_ai_text_invocation_attempt
        WHERE id = ${incident.attemptId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (incident.reconciliationId)
        await transaction`
          SELECT id FROM workspace_ai_text_invocation_reconciliation
          WHERE id = ${incident.reconciliationId}
            AND workspace_id = ${input.workspaceId}
          FOR UPDATE
        `;
      if (incident.type === "provider_circuit_open")
        await transaction`
          SELECT provider FROM workspace_ai_provider_circuit
          WHERE workspace_id = ${input.workspaceId}
            AND provider = ${incident.provider} AND state = 'open'
          FOR UPDATE
        `;
      const stillActive = (await selectWorkspaceAiOperationalIncidents(
        transaction, input.workspaceId, asOf,
      )).some((item) => item.type === input.type && item.attemptId === input.attemptId);
      if (!stillActive)
        throw new AiPolicyValidationError([{
          field: "attemptId",
          message: "The AI operational incident was resolved before acknowledgement.",
        }]);
      const acknowledgementId = randomUUID();
      const inserted = await transaction<{ id: string }[]>`
        INSERT INTO workspace_ai_operational_incident_acknowledgement (
          id, workspace_id, incident_type, attempt_id, provider,
          reconciliation_id, source_observed_at, acknowledgement_note,
          acknowledged_by, acknowledged_at, created_at
        ) VALUES (${acknowledgementId}, ${input.workspaceId}, ${input.type},
          ${input.attemptId}, ${incident.provider},
          ${incident.reconciliationId ?? null}, ${new Date(incident.openedAt)},
          ${input.acknowledgementNote}, ${actorUserId}, ${asOf}, ${asOf})
        ON CONFLICT (workspace_id, incident_type, attempt_id) DO NOTHING
        RETURNING id
      `;
      if (!inserted[0]) return;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.operational_incident_acknowledged',
          'workspace_ai_text_invocation_attempt', ${input.attemptId},
          ${transaction.json({
            incidentType: input.type,
            severity: incident.severity,
            provider: incident.provider,
            acknowledgementNoteIncluded: true,
            incidentResolved: false,
            providerRequestRetried: false,
            executionAuthority: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    const incident = (await this.listWorkspaceAiOperationalIncidents(
      input.workspaceId, actorUserId,
    )).find((item) => item.type === input.type && item.attemptId === input.attemptId);
    if (!incident) throw new Error("Acknowledged AI operational incident lost its active projection.");
    return incident;
  }

  async resolveWorkspaceTextInvocation(
    input: AiTextInvocationResolutionWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextInvocationResolution> {
    validateTextInvocationResolution(input);
    await this.sql.begin(async (transaction) => {
      await this.requireApprover(transaction, input.workspaceId, actorUserId);
      const existing = await transaction<{ id: string }[]>`
        SELECT id FROM workspace_ai_text_invocation_resolution
        WHERE workspace_id = ${input.workspaceId} AND attempt_id = ${input.attemptId}
        FOR UPDATE
      `;
      if (existing[0]) return;
      const rows = await transaction<{
        attemptStatus: string;
        failureCode?: string | null;
        provider: string;
        modelId: string;
        reservationId: string;
        reservationStatus: "reserved" | "settled" | "released" | "expired" | "denied";
        reservationExpiresAt?: Date | string | null;
        currency: string;
        reconciliationId?: string | null;
        reconciliationStatus?: string | null;
        usageRecorded: boolean;
      }[]>`
        SELECT attempt.status AS attempt_status, attempt.failure_code,
          attempt.provider, attempt.model_id,
          reservation.id AS reservation_id,
          reservation.status AS reservation_status,
          reservation.expires_at AS reservation_expires_at,
          reservation.currency,
          reconciliation.id AS reconciliation_id,
          reconciliation.status AS reconciliation_status,
          EXISTS (
            SELECT 1 FROM ai_usage_event usage
            WHERE usage.workspace_id = attempt.workspace_id
              AND (usage.text_invocation_attempt_id = attempt.id
                OR usage.spend_reservation_id = reservation.id)
          ) AS usage_recorded
        FROM workspace_ai_text_invocation_attempt attempt
        JOIN workspace_ai_text_invocation_intent intent ON intent.id = attempt.intent_id
        JOIN ai_spend_reservation reservation ON reservation.id = intent.reservation_id
        LEFT JOIN workspace_ai_text_invocation_reconciliation reconciliation
          ON reconciliation.attempt_id = attempt.id
        WHERE attempt.workspace_id = ${input.workspaceId}
          AND attempt.id = ${input.attemptId}
        FOR UPDATE OF attempt, intent, reservation
      `;
      const current = rows[0];
      if (!current)
        throw new AiPolicyValidationError([{
          field: "attemptId",
          message: "Invocation attempt was not found.",
        }]);
      const eligible = current.attemptStatus === "ambiguous" ||
        (current.attemptStatus === "succeeded" && current.reconciliationStatus === "quarantined");
      if (!eligible || current.usageRecorded)
        throw new AiPolicyValidationError([{
          field: "attemptId",
          message: "Choose an unresolved ambiguous attempt or quarantined successful attempt with no usage event.",
        }]);
      if (current.reconciliationId) {
        await transaction`
          SELECT id FROM workspace_ai_text_invocation_reconciliation
          WHERE id = ${current.reconciliationId} AND workspace_id = ${input.workspaceId}
          FOR UPDATE
        `;
      }
      if (!["reserved", "released", "expired"].includes(current.reservationStatus))
        throw new AiPolicyValidationError([{
          field: "attemptId",
          message: "The linked reservation has already been settled or denied and cannot use operator resolution.",
        }]);
      const previousStatus = current.reservationStatus as "reserved" | "released" | "expired";
      let finalStatus: "settled" | "released" | "expired";
      if (input.disposition === "settled_provider_charge") {
        finalStatus = "settled";
        const settled = await markReservation(
          transaction, input.workspaceId, current.reservationId,
          "settled", actorUserId, asOf, input.providerChargeMinor,
        );
        await this.auditSpend(transaction, input.workspaceId, actorUserId,
          "ai.spend_settled", settled);
      } else if (current.reservationStatus === "reserved") {
        finalStatus = current.reservationExpiresAt && new Date(current.reservationExpiresAt) <= asOf
          ? "expired" : "released";
        const released = await markReservation(
          transaction, input.workspaceId, current.reservationId,
          finalStatus, actorUserId, asOf,
        );
        await this.auditSpend(transaction, input.workspaceId, actorUserId,
          finalStatus === "expired" ? "ai.spend_expired" : "ai.spend_released", released);
      } else {
        finalStatus = current.reservationStatus as "released" | "expired";
      }
      const resolutionId = randomUUID();
      await transaction`
        INSERT INTO workspace_ai_text_invocation_resolution (
          id, workspace_id, attempt_id, reservation_id, reconciliation_id,
          provider, model_id, disposition, provider_charge_minor, currency,
          evidence_reference, resolution_note, reservation_previous_status,
          reservation_final_status, resolved_by, resolved_at, created_at
        ) VALUES (${resolutionId}, ${input.workspaceId}, ${input.attemptId},
          ${current.reservationId}, ${current.reconciliationId ?? null},
          ${current.provider}, ${current.modelId}, ${input.disposition},
          ${input.providerChargeMinor ?? null}, ${current.currency},
          ${input.evidenceReference}, ${input.resolutionNote}, ${previousStatus},
          ${finalStatus}, ${actorUserId}, ${asOf}, ${asOf})
      `;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.text_invocation_resolved',
          'workspace_ai_text_invocation_resolution', ${resolutionId},
          ${transaction.json({
            attemptId: input.attemptId,
            provider: current.provider,
            disposition: input.disposition,
            providerChargeMinor: input.providerChargeMinor ?? null,
            currency: current.currency,
            reservationPreviousStatus: previousStatus,
            reservationFinalStatus: finalStatus,
            evidenceReferenceIncluded: true,
            noteIncluded: true,
            usageUnitsKnown: false,
            providerRequestRetried: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    const resolution = (await this.listWorkspaceTextInvocationResolutions(
      input.workspaceId, actorUserId,
    )).find((item) => item.attemptId === input.attemptId);
    if (!resolution) throw new Error("Text invocation resolution projection lost its row.");
    return resolution;
  }

  async getWorkspaceTextOutputArtifactReadTarget(
    workspaceId: string,
    artifactId: string,
    actorUserId: string,
  ): Promise<AiTextOutputArtifactReadTarget> {
    if (!isUuid(artifactId))
      throw new AiPolicyValidationError([{ field: "artifactId", message: "Output artifact was not found." }]);
    return this.sql.begin(async (transaction) => {
      await this.requireApprover(transaction, workspaceId, actorUserId);
      const rows = await transaction<AiTextOutputArtifactReadTarget[]>`
        SELECT id, workspace_id, status, encrypted_output, encryption_key_version
        FROM workspace_ai_text_output_artifact
        WHERE id = ${artifactId} AND workspace_id = ${workspaceId}
          AND status IN ('pending_review', 'accepted')
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([{ field: "artifactId", message: "Reviewable output artifact was not found." }]);
      return rows[0];
    });
  }

  async reviewWorkspaceTextOutputArtifact(
    input: AiTextOutputArtifactReviewWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextOutputArtifact> {
    if (!isUuid(input.artifactId) || !["accepted", "discarded"].includes(input.decision) ||
      !input.reviewNote || input.reviewNote.trim() !== input.reviewNote || input.reviewNote.length > 1_000)
      throw new AiPolicyValidationError([{
        field: "reviewNote", message: "Choose a review decision and provide a trimmed note of at most 1,000 characters.",
      }]);
    await this.sql.begin(async (transaction) => {
      await this.requireApprover(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{ status: string; provider: string }[]>`
        SELECT status, provider FROM workspace_ai_text_output_artifact
        WHERE id = ${input.artifactId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      const current = rows[0];
      if (!current)
        throw new AiPolicyValidationError([{ field: "artifactId", message: "Output artifact was not found." }]);
      if (current.status !== "pending_review") {
        if (current.status === input.decision) return;
        throw new AiPolicyValidationError([{ field: "artifactId", message: "A completed output review cannot be changed." }]);
      }
      await transaction`
        UPDATE workspace_ai_text_output_artifact SET status = ${input.decision},
          reviewed_by = ${actorUserId}, review_note = ${input.reviewNote},
          reviewed_at = ${asOf}, updated_at = ${asOf}
        WHERE id = ${input.artifactId} AND workspace_id = ${input.workspaceId}
      `;
      await this.auditTextOutputArtifact(transaction, input.workspaceId, actorUserId,
        input.artifactId, current.provider, input.decision);
    });
    const artifact = (await this.listWorkspaceTextOutputArtifacts(input.workspaceId, actorUserId))
      .find((item) => item.id === input.artifactId);
    if (!artifact) throw new Error("Reviewed output artifact projection lost its row.");
    return artifact;
  }

  async listWorkspaceTextDraftProposals(
    workspaceId: string,
    contentDraftId: string,
    actorUserId: string,
  ): Promise<StoredAiTextDraftProposal[]> {
    if (!isUuid(contentDraftId)) return [];
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      return selectWorkspaceTextDraftProposals(transaction, workspaceId, contentDraftId);
    });
  }

  async attachWorkspaceTextOutputToDraft(
    input: AiTextDraftProposalAttachWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextDraftProposal> {
    if (!isUuid(input.artifactId) || !isUuid(input.contentDraftId))
      throw new AiPolicyValidationError([{ field: "artifactId", message: "Choose an accepted output and an editable Draft." }]);
    const proposalId = await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const existing = await transaction<{ id: string; contentDraftId: string }[]>`
        SELECT id, content_draft_id FROM workspace_ai_text_draft_proposal
        WHERE artifact_id = ${input.artifactId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (existing[0]) {
        if (existing[0].contentDraftId !== input.contentDraftId)
          throw new AiPolicyValidationError([{ field: "artifactId", message: "This accepted output is already bound to another Draft." }]);
        return existing[0].id;
      }
      const rows = await transaction<{
        sourceDraftVersionId: string;
        provider: string;
      }[]>`
        SELECT draft.current_version_id AS source_draft_version_id,
          artifact.provider
        FROM workspace_ai_text_output_artifact artifact
        JOIN workspace_ai_text_invocation_attempt attempt
          ON attempt.id = artifact.attempt_id
          AND attempt.workspace_id = artifact.workspace_id
        JOIN workspace_ai_text_invocation_intent intent
          ON intent.id = attempt.intent_id
          AND intent.workspace_id = attempt.workspace_id
        JOIN content_draft draft
          ON draft.id = ${input.contentDraftId}
          AND draft.workspace_id = artifact.workspace_id
        JOIN content_draft_version version
          ON version.id = draft.current_version_id
          AND version.content_draft_id = draft.id
        WHERE artifact.id = ${input.artifactId}
          AND artifact.workspace_id = ${input.workspaceId}
          AND artifact.status = 'accepted'
          AND draft.status IN ('working', 'changes_requested')
          AND version.status IN ('working', 'changes_requested')
          AND (intent.source_content_draft_id IS NULL OR (
            intent.source_content_draft_id = draft.id
            AND intent.source_content_draft_version_id = draft.current_version_id
          ))
        FOR UPDATE OF artifact, attempt, intent, draft, version
      `;
      const current = rows[0];
      if (!current)
        throw new AiPolicyValidationError([{ field: "contentDraftId", message: "Attach only accepted output to the current editable Draft version." }]);
      const id = randomUUID();
      await transaction`
        INSERT INTO workspace_ai_text_draft_proposal (
          id, workspace_id, artifact_id, content_draft_id,
          source_draft_version_id, status, attached_by,
          attached_at, updated_at
        ) VALUES (${id}, ${input.workspaceId}, ${input.artifactId},
          ${input.contentDraftId}, ${current.sourceDraftVersionId}, 'attached',
          ${actorUserId}, ${asOf}, ${asOf})
      `;
      await this.auditTextDraftProposal(transaction, input.workspaceId, actorUserId,
        id, current.provider, "attached");
      return id;
    });
    const proposal = (await this.listWorkspaceTextDraftProposals(
      input.workspaceId, input.contentDraftId, actorUserId,
    )).find((item) => item.id === proposalId);
    if (!proposal) throw new Error("Draft proposal projection lost its row.");
    return proposal;
  }

  async getWorkspaceTextDraftProposalReadTarget(
    workspaceId: string,
    proposalId: string,
    actorUserId: string,
  ): Promise<AiTextDraftProposalReadTarget> {
    if (!isUuid(proposalId))
      throw new AiPolicyValidationError([{ field: "proposalId", message: "Draft proposal was not found." }]);
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const rows = await transaction<AiTextDraftProposalReadTarget[]>`
        SELECT proposal.id, proposal.workspace_id, proposal.content_draft_id,
          artifact.encrypted_output, artifact.encryption_key_version,
          intent.product_prompt_version,
          (intent.source_content_draft_id IS NOT NULL) AS product_bound
        FROM workspace_ai_text_draft_proposal proposal
        JOIN workspace_ai_text_output_artifact artifact
          ON artifact.id = proposal.artifact_id
          AND artifact.workspace_id = proposal.workspace_id
        JOIN workspace_ai_text_invocation_intent intent
          ON intent.id = artifact.intent_id
          AND intent.workspace_id = artifact.workspace_id
        JOIN content_draft draft ON draft.id = proposal.content_draft_id
          AND draft.workspace_id = proposal.workspace_id
        WHERE proposal.id = ${proposalId} AND proposal.workspace_id = ${workspaceId}
          AND proposal.status = 'attached' AND artifact.status = 'accepted'
          AND draft.current_version_id = proposal.source_draft_version_id
          AND draft.status IN ('working', 'changes_requested')
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([{ field: "proposalId", message: "Current editable Draft proposal was not found." }]);
      return rows[0];
    });
  }

  async applyWorkspaceTextDraftProposal(
    input: AiTextDraftProposalApplyWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextDraftProposal> {
    validateTextDraftProposalApplication(input);
    let contentDraftId = "";
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{
        status: "attached" | "applied" | "dismissed";
        provider: string;
        artifactStatus: string;
        contentDraftId: string;
        sourceDraftVersionId: string;
        currentDraftVersionId: string;
        draftStatus: string;
        versionStatus: string;
        versionNumber: number;
        headline: string;
        callToAction?: string | null;
        hashtags: string[];
        altText?: string | null;
        rationale: string;
        presentationChoices: Record<string, unknown>;
        draftFormat: DraftFormat;
      }[]>`
        SELECT proposal.status, artifact.provider,
          artifact.status AS artifact_status,
          proposal.content_draft_id, proposal.source_draft_version_id,
          draft.current_version_id AS current_draft_version_id,
          draft.status AS draft_status, version.status AS version_status,
          version.version_number, version.headline, version.call_to_action,
          version.hashtags, version.alt_text, version.rationale,
          version.presentation_choices, generation.draft_format
        FROM workspace_ai_text_draft_proposal proposal
        JOIN workspace_ai_text_output_artifact artifact
          ON artifact.id = proposal.artifact_id
          AND artifact.workspace_id = proposal.workspace_id
        JOIN content_draft draft
          ON draft.id = proposal.content_draft_id
          AND draft.workspace_id = proposal.workspace_id
        JOIN content_draft_version version
          ON version.id = proposal.source_draft_version_id
          AND version.content_draft_id = proposal.content_draft_id
        JOIN draft_generation generation ON generation.id = draft.draft_generation_id
        WHERE proposal.id = ${input.proposalId}
          AND proposal.workspace_id = ${input.workspaceId}
        FOR UPDATE OF proposal, artifact, draft, version
      `;
      const current = rows[0];
      if (!current)
        throw new AiPolicyValidationError([{ field: "proposalId", message: "Draft proposal was not found." }]);
      contentDraftId = current.contentDraftId;
      if (current.status === "applied") return;
      if (current.status !== "attached")
        throw new AiPolicyValidationError([{ field: "proposalId", message: "A dismissed Draft proposal cannot be applied." }]);
      if (current.artifactStatus !== "accepted" ||
        current.currentDraftVersionId !== current.sourceDraftVersionId ||
        !["working", "changes_requested"].includes(current.draftStatus) ||
        !["working", "changes_requested"].includes(current.versionStatus))
        throw new AiPolicyValidationError([{
          field: "proposalId",
          message: "Apply only an accepted proposal attached to the exact current editable Draft version.",
        }]);

      const factClaims = await transaction<{
        kind: "fact";
        text: string;
        evidenceItemIds: string[];
      }[]>`
        SELECT claim.kind, claim.claim_text AS text,
          array_agg(binding.evidence_item_id ORDER BY binding.evidence_item_id) AS evidence_item_ids
        FROM content_draft_claim claim
        JOIN content_draft_claim_evidence binding
          ON binding.content_draft_claim_id = claim.id
        WHERE claim.content_draft_version_id = ${current.sourceDraftVersionId}
          AND claim.kind = 'fact'
        GROUP BY claim.id
        ORDER BY min(claim.sort_order)
      `;
      if (!factClaims.length)
        throw new AiPolicyValidationError([{
          field: "proposalId",
          message: "The source Draft must contain at least one evidence-backed factual claim.",
        }]);

      const sourceLeadIn = String(current.presentationChoices.leadIn ?? "");
      const selectedFields: ("lead_in" | "call_to_action" | "hashtags" | "alt_text")[] = [];
      if (input.leadIn !== sourceLeadIn) selectedFields.push("lead_in");
      if ((input.callToAction ?? null) !== (current.callToAction ?? null)) selectedFields.push("call_to_action");
      if (!sameStrings(input.hashtags, current.hashtags)) selectedFields.push("hashtags");
      if ((input.altText ?? null) !== (current.altText ?? null)) selectedFields.push("alt_text");
      if (!selectedFields.length)
        throw new AiPolicyValidationError([{
          field: "proposalId",
          message: "Select at least one presentation change before applying this proposal.",
        }]);

      const facts = factClaims
        .map((claim) => claim.text.trim().replace(/[.!?]?$/u, "."))
        .join(" ");
      const body = `${input.leadIn ? `${input.leadIn}: ` : ""}${facts}`;
      const limit = DRAFT_FORMAT_CHARACTER_LIMITS[current.draftFormat];
      if (limit && body.length + (input.callToAction?.length ?? 0) > limit)
        throw new AiPolicyValidationError([{
          field: "leadIn",
          message: `The applied copy exceeds the ${limit}-character ${current.draftFormat} limit.`,
        }]);

      const appliedVersionId = randomUUID();
      await transaction`
        UPDATE content_draft_version SET status = 'superseded'
        WHERE id = ${current.sourceDraftVersionId}
          AND content_draft_id = ${current.contentDraftId}
      `;
      await transaction`
        INSERT INTO content_draft_version (
          id, content_draft_id, version_number, status, headline, body,
          call_to_action, hashtags, alt_text, rationale, presentation_choices,
          source_version_id, change_note, created_by
        ) VALUES (
          ${appliedVersionId}, ${current.contentDraftId},
          ${current.versionNumber + 1}, 'working', ${current.headline}, ${body},
          ${input.callToAction ?? null}, ${[...input.hashtags]},
          ${input.altText ?? null}, ${current.rationale},
          ${transaction.json({
            ...current.presentationChoices,
            leadIn: input.leadIn,
            aiTextDraftProposalId: input.proposalId,
          } as JSONValue)},
          ${current.sourceDraftVersionId}, ${input.changeNote}, ${actorUserId}
        )
      `;
      for (const [sortOrder, claim] of [
        ...factClaims,
        ...(input.callToAction ? [{
          kind: "call_to_action" as const,
          text: input.callToAction,
          evidenceItemIds: [] as string[],
        }] : []),
      ].entries()) {
        const claimId = randomUUID();
        await transaction`
          INSERT INTO content_draft_claim (
            id, content_draft_version_id, kind, claim_text, sort_order
          ) VALUES (
            ${claimId}, ${appliedVersionId}, ${claim.kind}, ${claim.text}, ${sortOrder}
          )
        `;
        for (const evidenceItemId of claim.evidenceItemIds)
          await transaction`
            INSERT INTO content_draft_claim_evidence (
              content_draft_claim_id, evidence_item_id
            ) VALUES (${claimId}, ${evidenceItemId})
          `;
      }
      await transaction`
        UPDATE content_draft
        SET current_version_id = ${appliedVersionId}, status = 'working', updated_at = ${asOf}
        WHERE id = ${current.contentDraftId} AND workspace_id = ${input.workspaceId}
      `;
      await transaction`
        UPDATE workspace_ai_text_draft_proposal
        SET status = 'applied', applied_by = ${actorUserId},
          application_note = ${input.changeNote}, applied_version_id = ${appliedVersionId},
          selected_fields = ${selectedFields}, applied_at = ${asOf}, updated_at = ${asOf}
        WHERE id = ${input.proposalId} AND workspace_id = ${input.workspaceId}
      `;
      await this.auditTextDraftProposal(
        transaction, input.workspaceId, actorUserId,
        input.proposalId, current.provider, "applied",
      );
    });
    const proposal = (await this.listWorkspaceTextDraftProposals(
      input.workspaceId, contentDraftId, actorUserId,
    )).find((item) => item.id === input.proposalId);
    if (!proposal) throw new Error("Applied Draft proposal projection lost its row.");
    return proposal;
  }

  async dismissWorkspaceTextDraftProposal(
    input: AiTextDraftProposalDismissWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextDraftProposal> {
    if (!isUuid(input.proposalId) || !input.dismissalNote ||
      input.dismissalNote.trim() !== input.dismissalNote || input.dismissalNote.length > 1_000)
      throw new AiPolicyValidationError([{ field: "dismissalNote", message: "Provide a trimmed dismissal note of at most 1,000 characters." }]);
    let contentDraftId = "";
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{ status: string; provider: string; contentDraftId: string }[]>`
        SELECT proposal.status, artifact.provider, proposal.content_draft_id
        FROM workspace_ai_text_draft_proposal proposal
        JOIN workspace_ai_text_output_artifact artifact ON artifact.id = proposal.artifact_id
        WHERE proposal.id = ${input.proposalId}
          AND proposal.workspace_id = ${input.workspaceId}
        FOR UPDATE OF proposal
      `;
      const current = rows[0];
      if (!current)
        throw new AiPolicyValidationError([{ field: "proposalId", message: "Draft proposal was not found." }]);
      contentDraftId = current.contentDraftId;
      if (current.status === "dismissed") return;
      if (current.status !== "attached")
        throw new AiPolicyValidationError([{
          field: "proposalId",
          message: "An applied Draft proposal is immutable and cannot be dismissed.",
        }]);
      await transaction`
        UPDATE workspace_ai_text_draft_proposal SET status = 'dismissed',
          dismissed_by = ${actorUserId}, dismissal_note = ${input.dismissalNote},
          dismissed_at = ${asOf}, updated_at = ${asOf}
        WHERE id = ${input.proposalId} AND workspace_id = ${input.workspaceId}
      `;
      await this.auditTextDraftProposal(transaction, input.workspaceId, actorUserId,
        input.proposalId, current.provider, "dismissed");
    });
    const proposal = (await this.listWorkspaceTextDraftProposals(
      input.workspaceId, contentDraftId, actorUserId,
    )).find((item) => item.id === input.proposalId);
    if (!proposal) throw new Error("Dismissed Draft proposal projection lost its row.");
    return proposal;
  }

  async claimWorkspaceTextInvocationAttempt(
    input: AiTextInvocationAttemptClaimWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiTextInvocationAttemptTarget> {
    validateAttemptClaim(input);
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<(AiTextInvocationAttemptTarget & {
        userTextSha256: string;
        systemTextSha256?: string | null;
      })[]>`
        SELECT i.workspace_id, i.id AS intent_id, i.provider, i.model_id,
          i.max_output_tokens, i.user_text_sha256, i.system_text_sha256,
          c.encrypted_credential, c.credential_fingerprint,
          ic.source_hash AS contract_source_hash
        FROM workspace_ai_text_invocation_intent i
        JOIN workspace_ai_adapter_invocation_binding ib ON ib.id = i.invocation_binding_id
        JOIN workspace_ai_adapter_registration r ON r.id = ib.registration_id
        JOIN workspace_ai_adapter_candidate a ON a.id = r.candidate_id
        JOIN workspace_ai_provider_model m ON m.workspace_id = r.workspace_id
          AND m.provider = r.provider AND m.model_id = r.model_id
        JOIN workspace_ai_provider_connection c ON c.workspace_id = r.workspace_id
          AND c.provider = r.provider
        JOIN workspace_ai_adapter_rate_binding rb ON rb.id = ib.rate_binding_id
        JOIN ai_provider_rate_card card ON card.id = rb.rate_card_id
        JOIN ai_provider_invocation_contract ic ON ic.id = ib.contract_id
        JOIN ai_spend_reservation s ON s.id = i.reservation_id
        JOIN ai_cost_quote q ON q.id = i.cost_quote_id
        JOIN workspace_ai_execution_control execution_control
          ON execution_control.workspace_id = i.workspace_id
        JOIN LATERAL (
          SELECT o.status, o.credential_fingerprint, o.contract_source_hash,
            o.checked_at, o.expires_at
          FROM workspace_ai_adapter_health_observation o
          WHERE o.workspace_id = ib.workspace_id AND o.invocation_binding_id = ib.id
          ORDER BY o.checked_at DESC, o.id DESC LIMIT 1
        ) h ON true
        WHERE i.id = ${input.intentId} AND i.workspace_id = ${input.workspaceId}
          AND i.status = 'prepared' AND i.expires_at > ${asOf}
          AND NOT EXISTS (SELECT 1 FROM workspace_ai_text_invocation_attempt x WHERE x.intent_id = i.id)
          AND s.status = 'reserved' AND s.expires_at > ${asOf}
          AND s.cost_quote_id = i.cost_quote_id AND s.capability = 'generate_text'
          AND s.feature LIKE 'assistant.%' AND q.capability = s.capability
          AND q.feature = s.feature AND q.currency = s.currency
          AND q.maximum_cost_minor = s.estimated_cost_minor
          AND q.rate_card_id = rb.rate_card_id AND q.expires_at > ${asOf}
          AND ib.status = 'configured' AND r.status = 'registered'
          AND a.status = 'approved' AND m.retired_at IS NULL
          AND c.status = 'verified' AND c.encrypted_credential IS NOT NULL
          AND r.source_credential_fingerprint = a.source_credential_fingerprint
          AND m.credential_fingerprint = a.source_credential_fingerprint
          AND c.credential_fingerprint = a.source_credential_fingerprint
          AND i.credential_fingerprint = c.credential_fingerprint
          AND rb.status = 'bound' AND card.status = 'approved'
          AND rb.rate_card_source_hash = card.source_hash
          AND card.effective_from <= ${asOf}
          AND (card.effective_to IS NULL OR card.effective_to > ${asOf})
          AND ic.status = 'approved' AND ic.codec_available = true
          AND ic.transport_available = true AND ic.implementation_available = true
          AND ib.contract_source_hash = ic.source_hash
          AND i.contract_source_hash = ic.source_hash
          AND h.status = 'healthy' AND h.checked_at >= ib.configured_at
          AND h.expires_at > ${asOf}
          AND h.credential_fingerprint = c.credential_fingerprint
          AND h.contract_source_hash = ic.source_hash
          AND (i.source_content_draft_id IS NULL OR (
            q.feature = 'assistant.prepare_copy'
            AND EXISTS (
              SELECT 1 FROM content_draft source_draft
              JOIN content_draft_version source_version
                ON source_version.id = source_draft.current_version_id
                AND source_version.content_draft_id = source_draft.id
              WHERE source_draft.id = i.source_content_draft_id
                AND source_draft.workspace_id = i.workspace_id
                AND source_draft.current_version_id = i.source_content_draft_version_id
                AND source_draft.status IN ('working', 'changes_requested')
                AND source_version.status IN ('working', 'changes_requested')
            )
          ))
          AND execution_control.state = 'enabled'
          AND execution_control.enabled_until > ${asOf}
          AND NOT EXISTS (
            SELECT 1 FROM workspace_ai_provider_circuit circuit
            WHERE circuit.workspace_id = i.workspace_id
              AND circuit.provider = i.provider AND circuit.state = 'open'
          )
        FOR UPDATE OF i, ib, r, a, m, c, rb, card, ic, s, q, execution_control
      `;
      const target = rows[0];
      if (!target) {
        const blocked = await transaction<{ controlAllowed: boolean; provider?: string | null; circuitOpen: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM workspace_ai_execution_control control
            WHERE control.workspace_id = i.workspace_id AND control.state = 'enabled'
              AND control.enabled_until > ${asOf}
          ) AS control_allowed, i.provider,
          EXISTS (
            SELECT 1 FROM workspace_ai_provider_circuit circuit
            WHERE circuit.workspace_id = i.workspace_id
              AND circuit.provider = i.provider AND circuit.state = 'open'
          ) AS circuit_open
          FROM workspace_ai_text_invocation_intent i
          WHERE i.id = ${input.intentId} AND i.workspace_id = ${input.workspaceId}
        `;
        if (blocked[0] && !blocked[0].controlAllowed)
          throw new AiPolicyValidationError([{
            field: "workspaceId",
            message: "AI provider execution is stopped or its time-limited enablement has expired.",
          }]);
        if (blocked[0]?.circuitOpen)
          throw new AiPolicyValidationError([{
            field: "provider",
            message: "The provider circuit is open and must be reviewed and reset by a workspace administrator.",
          }]);
        throw new AiPolicyValidationError([{ field: "intentId", message: "Choose one unclaimed, currently authorized text invocation intent." }]);
      }
      if (target.userTextSha256 !== sha256(input.userText) ||
        (target.systemTextSha256 ?? undefined) !== (input.systemText ? sha256(input.systemText) : undefined))
        throw new AiPolicyValidationError([{ field: "userText", message: "Prompt material does not match the prepared intent evidence." }]);
      const attemptId = randomUUID();
      const claimExpiresAt = new Date(asOf.getTime() + 60_000);
      await transaction`
        INSERT INTO workspace_ai_text_invocation_attempt (
          id, workspace_id, intent_id, provider, model_id, status,
          claimed_by, claimed_at, claim_expires_at, created_at, updated_at
        ) VALUES (${attemptId}, ${input.workspaceId}, ${input.intentId},
          ${target.provider}, ${target.modelId}, 'claimed', ${actorUserId},
          ${asOf}, ${claimExpiresAt}, ${asOf}, ${asOf})
      `;
      await this.auditTextInvocationAttempt(transaction, input.workspaceId,
        actorUserId, attemptId, target.provider, "claimed");
      const { userTextSha256: _user, systemTextSha256: _system, ...safeTarget } = target;
      return { ...safeTarget, attemptId };
    });
  }

  async completeWorkspaceTextInvocationAttempt(
    input: AiTextInvocationAttemptOutcomeWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextInvocationAttempt> {
    validateAttemptOutcome(input);
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<{
        status: string;
        provider: string;
        credentialFingerprint: string;
        contractSourceHash: string;
        authorizationCurrent: boolean;
        claimCurrent: boolean;
        intentId: string;
        modelId: string;
        reservationId: string;
        campaignId?: string | null;
        feature: string;
        currency: string;
        estimatedCostMinor: number;
        rateCardId: string;
        modelVersion: string;
        minorUnitExponent: number;
        effectiveFrom: Date | string;
        effectiveTo?: Date | string | null;
        sourceReference: string;
        sourceHash: string;
        verifiedAt: Date | string;
        approvedAt: Date | string;
        rateCardCreatedAt: Date | string;
        components: StoredAiProviderRateCard["components"];
      }[]>`
        SELECT a.status, a.provider, i.id AS intent_id, i.model_id,
          s.id AS reservation_id, s.campaign_id, s.feature, s.currency,
          s.estimated_cost_minor, card.id AS rate_card_id,
          card.model_version, card.minor_unit_exponent,
          card.effective_from, card.effective_to, card.source_reference,
          card.source_hash, card.verified_at, card.approved_at,
          card.created_at AS rate_card_created_at,
          pricing.components,
          i.credential_fingerprint,
          i.contract_source_hash,
          (a.claim_expires_at > ${asOf}) AS claim_current,
          (i.status = 'prepared' AND i.expires_at > ${asOf}
           AND s.status = 'reserved' AND s.expires_at > ${asOf}
           AND s.cost_quote_id = i.cost_quote_id
           AND s.capability = 'generate_text' AND s.feature LIKE 'assistant.%'
           AND q.capability = s.capability AND q.feature = s.feature
           AND q.currency = s.currency AND q.maximum_cost_minor = s.estimated_cost_minor
           AND q.rate_card_id = rb.rate_card_id AND q.expires_at > ${asOf}
           AND ib.status = 'configured' AND r.status = 'registered'
           AND candidate.status = 'approved' AND model.retired_at IS NULL
           AND c.status = 'verified' AND c.credential_fingerprint = i.credential_fingerprint
           AND r.source_credential_fingerprint = candidate.source_credential_fingerprint
           AND model.credential_fingerprint = candidate.source_credential_fingerprint
           AND c.credential_fingerprint = candidate.source_credential_fingerprint
           AND rb.status = 'bound' AND card.status = 'approved'
           AND rb.rate_card_source_hash = card.source_hash
           AND card.effective_from <= ${asOf}
           AND (card.effective_to IS NULL OR card.effective_to > ${asOf})
           AND ic.status = 'approved' AND ic.source_hash = i.contract_source_hash
           AND ic.codec_available AND ic.transport_available AND ic.implementation_available
           AND h.status = 'healthy' AND h.checked_at >= ib.configured_at
           AND h.expires_at > ${asOf}
           AND h.credential_fingerprint = c.credential_fingerprint
           AND h.contract_source_hash = ic.source_hash
           AND execution_control.state = 'enabled'
           AND execution_control.enabled_until > ${asOf}) AS authorization_current
        FROM workspace_ai_text_invocation_attempt a
        JOIN workspace_ai_text_invocation_intent i ON i.id = a.intent_id
        JOIN workspace_ai_adapter_invocation_binding ib ON ib.id = i.invocation_binding_id
        JOIN workspace_ai_adapter_registration r ON r.id = ib.registration_id
        JOIN workspace_ai_adapter_candidate candidate ON candidate.id = r.candidate_id
        JOIN workspace_ai_provider_model model ON model.workspace_id = r.workspace_id
          AND model.provider = r.provider AND model.model_id = r.model_id
        JOIN workspace_ai_provider_connection c ON c.workspace_id = i.workspace_id AND c.provider = i.provider
        JOIN workspace_ai_adapter_rate_binding rb ON rb.id = ib.rate_binding_id
        JOIN ai_provider_rate_card card ON card.id = rb.rate_card_id
        JOIN LATERAL (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'kind', component.kind, 'unit', component.unit,
            'unitQuantity', component.unit_quantity,
            'priceMicros', component.price_micros::double precision
          ) ORDER BY component.kind, component.unit), '[]'::jsonb) AS components
          FROM ai_provider_rate_component component WHERE component.rate_card_id = card.id
        ) pricing ON true
        JOIN ai_provider_invocation_contract ic ON ic.id = ib.contract_id
        JOIN ai_spend_reservation s ON s.id = i.reservation_id
        JOIN ai_cost_quote q ON q.id = i.cost_quote_id
        JOIN workspace_ai_execution_control execution_control
          ON execution_control.workspace_id = i.workspace_id
        LEFT JOIN LATERAL (
          SELECT o.status, o.credential_fingerprint, o.contract_source_hash,
            o.checked_at, o.expires_at FROM workspace_ai_adapter_health_observation o
          WHERE o.workspace_id = i.workspace_id AND o.invocation_binding_id = ib.id
          ORDER BY o.checked_at DESC, o.id DESC LIMIT 1
        ) h ON true
        WHERE a.id = ${input.attemptId} AND a.workspace_id = ${input.workspaceId}
        FOR UPDATE OF a, i, ib, r, candidate, model, c, rb, card, ic, s, q, execution_control
      `;
      const current = rows[0];
      if (!current) throw new AiPolicyValidationError([{ field: "attemptId", message: "Invocation attempt was not found." }]);
      if (current.status !== "claimed") return;
      if (current.credentialFingerprint !== input.expectedCredentialFingerprint ||
        current.contractSourceHash !== input.expectedContractSourceHash)
        throw new AiPolicyValidationError([{ field: "attemptId", message: "Attempt evidence does not match its claim." }]);
      const outcome = input.outcome.status === "succeeded" && !current.claimCurrent
        ? { status: "ambiguous" as const, failureCode: "claim_abandoned" as const,
            safeMessage: "Provider outcome arrived after the attempt reconciliation deadline and was discarded." }
        : input.outcome.status === "succeeded" && !current.authorizationCurrent
          ? { status: "ambiguous" as const, failureCode: "evidence_changed" as const,
              safeMessage: "Provider outcome was discarded because authorization evidence changed in flight." }
          : input.outcome;
      let exactCostMinor: number | undefined;
      let reconciliationReason: "missing_usage" | "unsupported_rate_card" | "cost_exceeds_authorization" | undefined;
      if (outcome.status === "succeeded") {
        if (outcome.inputTokens === undefined || outcome.outputTokens === undefined) {
          reconciliationReason = "missing_usage";
        } else if (current.components.some((component) =>
          component.kind !== "request" &&
          !((component.kind === "input" || component.kind === "output") && component.unit === "token")
        )) {
          reconciliationReason = "unsupported_rate_card";
        } else {
          const rateCard: StoredAiProviderRateCard = {
            id: current.rateCardId,
            provider: current.provider,
            modelFamily: current.modelId,
            modelVersion: current.modelVersion,
            currency: current.currency,
            minorUnitExponent: Number(current.minorUnitExponent),
            status: "approved",
            components: current.components.map((component) => ({
              ...component,
              unitQuantity: Number(component.unitQuantity),
              priceMicros: Number(component.priceMicros),
            })),
            effectiveFrom: new Date(current.effectiveFrom).toISOString(),
            ...(current.effectiveTo ? { effectiveTo: new Date(current.effectiveTo).toISOString() } : {}),
            sourceReference: current.sourceReference,
            sourceHash: current.sourceHash,
            verifiedAt: new Date(current.verifiedAt).toISOString(),
            approvedAt: new Date(current.approvedAt).toISOString(),
            createdAt: new Date(current.rateCardCreatedAt).toISOString(),
          };
          const forecasts: AiUsageQuantityForecast[] = [];
          if (rateCard.components.some((component) => component.kind === "input"))
            forecasts.push({ kind: "input", unit: "token", minimumUnits: outcome.inputTokens, maximumUnits: outcome.inputTokens });
          if (rateCard.components.some((component) => component.kind === "output"))
            forecasts.push({ kind: "output", unit: "token", minimumUnits: outcome.outputTokens, maximumUnits: outcome.outputTokens });
          try {
            exactCostMinor = quoteAiCost(rateCard, forecasts, asOf).maximumCostMinor;
            if (exactCostMinor > current.estimatedCostMinor) {
              exactCostMinor = undefined;
              reconciliationReason = "cost_exceeds_authorization";
            }
          } catch {
            reconciliationReason = "unsupported_rate_card";
          }
        }
      }
      await transaction`
        UPDATE workspace_ai_text_invocation_attempt SET
          status = ${outcome.status},
          output_sha256 = ${outcome.status === "succeeded" ? sha256(outcome.outputText) : null},
          provider_response_id_sha256 = ${outcome.status === "succeeded" && outcome.responseId ? sha256(outcome.responseId) : null},
          stop_reason = ${outcome.status === "succeeded" ? outcome.stopReason : null},
          failure_code = ${outcome.status === "succeeded" ? null : outcome.failureCode},
          safe_message = ${outcome.status === "succeeded" ? null : outcome.safeMessage},
          input_tokens = ${outcome.status === "succeeded" ? outcome.inputTokens ?? null : null},
          output_tokens = ${outcome.status === "succeeded" ? outcome.outputTokens ?? null : null},
          completed_at = ${asOf}, updated_at = ${asOf}
        WHERE id = ${input.attemptId}
      `;
      await recordProviderCircuitOutcome(
        transaction,
        input.workspaceId,
        current.provider,
        input.attemptId,
        outcome.status === "succeeded" ? "succeeded" : outcome.failureCode,
        actorUserId,
        asOf,
      );
      if (outcome.status === "failed" && outcome.failureCode === "credential_unavailable") {
        const released = await markReservation(
          transaction, input.workspaceId, current.reservationId,
          "released", actorUserId, asOf,
        );
        await this.auditSpend(transaction, input.workspaceId, actorUserId,
          "ai.spend_released", released);
      }
      if (outcome.status === "succeeded") {
        const outputArtifactId = randomUUID();
        const outputHash = sha256(outcome.outputText);
        await transaction`
          INSERT INTO workspace_ai_text_output_artifact (
            id, workspace_id, attempt_id, intent_id, provider, model_id,
            encrypted_output, encryption_key_version, output_sha256,
            character_count, status, created_by, created_at, updated_at
          ) VALUES (${outputArtifactId}, ${input.workspaceId}, ${input.attemptId},
            ${current.intentId}, ${current.provider}, ${current.modelId},
            ${outcome.encryptedOutput}, ${outcome.encryptionKeyVersion}, ${outputHash},
            ${outcome.outputText.length}, 'pending_review', ${actorUserId}, ${asOf}, ${asOf})
        `;
        await this.auditTextOutputArtifact(transaction, input.workspaceId, actorUserId,
          outputArtifactId, current.provider, "pending_review");
        const reconciliationId = randomUUID();
        let usageEventId: string | undefined;
        if (exactCostMinor !== undefined && outcome.inputTokens !== undefined && outcome.outputTokens !== undefined) {
          usageEventId = randomUUID();
          await transaction`
            INSERT INTO ai_usage_event (
              id, workspace_id, campaign_id, spend_reservation_id,
              text_invocation_attempt_id, capability, feature, provider, model,
              privacy_class, input_units, output_units, cached_input_units,
              request_count, latency_ms, estimated_cost_minor, currency,
              prompt_version, context_revision, content_hash, occurred_at
            ) VALUES (${usageEventId}, ${input.workspaceId}, ${current.campaignId ?? null},
              ${current.reservationId}, ${input.attemptId}, 'generate_text',
              ${current.feature}, ${current.provider}, ${current.modelId}, 'cloud',
              ${outcome.inputTokens}, ${outcome.outputTokens}, 0, 1,
              ${outcome.latencyMs}, ${exactCostMinor}, ${current.currency},
              'text-request-v1', ${input.attemptId}, ${outputHash}, ${asOf})
          `;
          const settled = await markReservation(transaction, input.workspaceId,
            current.reservationId, "settled", actorUserId, asOf, exactCostMinor);
          await this.auditSpend(transaction, input.workspaceId, actorUserId,
            "ai.spend_settled", settled);
        }
        await transaction`
          INSERT INTO workspace_ai_text_invocation_reconciliation (
            id, workspace_id, attempt_id, reservation_id, rate_card_id,
            status, reason, currency, actual_cost_minor, input_tokens,
            output_tokens, usage_event_id, reconciled_by, reconciled_at, created_at
          ) VALUES (${reconciliationId}, ${input.workspaceId}, ${input.attemptId},
            ${current.reservationId}, ${current.rateCardId},
            ${exactCostMinor !== undefined ? "settled" : "quarantined"},
            ${reconciliationReason ?? null}, ${current.currency},
            ${exactCostMinor ?? null}, ${outcome.inputTokens ?? null},
            ${outcome.outputTokens ?? null}, ${usageEventId ?? null},
            ${actorUserId}, ${asOf}, ${asOf})
        `;
        await this.auditTextInvocationReconciliation(transaction, input.workspaceId,
          actorUserId, reconciliationId, current.provider,
          exactCostMinor !== undefined ? "settled" : "quarantined",
          reconciliationReason);
      }
      await this.auditTextInvocationAttempt(transaction, input.workspaceId,
        actorUserId, input.attemptId, current.provider, outcome.status);
    });
    const attempt = (await this.listWorkspaceTextInvocationAttempts(input.workspaceId, actorUserId))
      .find((item) => item.id === input.attemptId);
    if (!attempt) throw new Error("Invocation attempt projection lost its row.");
    return attempt;
  }

  async reconcileAbandonedTextInvocationAttempts(
    workspaceId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiTextInvocationAttempt[]> {
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const rows = await transaction<{ id: string; provider: string }[]>`
        UPDATE workspace_ai_text_invocation_attempt SET
          status = 'ambiguous', failure_code = 'claim_abandoned',
          safe_message = 'The claimed attempt did not record a provider outcome before its reconciliation deadline.',
          completed_at = ${asOf}, updated_at = ${asOf}
        WHERE workspace_id = ${workspaceId} AND status = 'claimed'
          AND claim_expires_at <= ${asOf}
        RETURNING id, provider
      `;
      for (const row of rows)
        await recordProviderCircuitOutcome(
          transaction, workspaceId, row.provider, row.id,
          "claim_abandoned", actorUserId, asOf,
        );
      for (const row of rows)
        await this.auditTextInvocationAttempt(transaction, workspaceId,
          actorUserId, row.id, row.provider, "ambiguous");
    });
    return this.listWorkspaceTextInvocationAttempts(workspaceId, actorUserId);
  }

  async revokeProviderConnection(
    workspaceId: string,
    provider: (typeof AI_HOSTED_PROVIDER_TYPES)[number],
    actorUserId: string,
  ): Promise<StoredAiProviderConnection> {
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const existing = await transaction<{ status: string }[]>`
        SELECT status FROM workspace_ai_provider_connection
        WHERE workspace_id = ${workspaceId} AND provider = ${provider}
        FOR UPDATE
      `;
      if (!existing[0])
        throw new AiPolicyValidationError([
          { field: "provider", message: "The provider connection was not found." },
        ]);
      if (existing[0].status === "revoked") return;
      const rows = await transaction<{ provider: string }[]>`
        UPDATE workspace_ai_provider_connection SET
          status = 'revoked', encrypted_credential = NULL,
          credential_fingerprint = NULL, encryption_key_version = NULL,
          last_error = NULL, verified_at = NULL, revoked_at = now(),
          updated_by = ${actorUserId}, updated_at = now()
        WHERE workspace_id = ${workspaceId} AND provider = ${provider}
        RETURNING provider
      `;
      if (!rows[0]) throw new Error("Provider connection revocation lost its row lock.");
      await transaction`
        UPDATE workspace_ai_provider_model SET
          retired_at = COALESCE(retired_at, now()), updated_at = now()
        WHERE workspace_id = ${workspaceId}
          AND provider = ${provider}
          AND retired_at IS NULL
      `;
      const retiredCandidates = await transaction<{ id: string }[]>`
        UPDATE workspace_ai_adapter_candidate SET
          status = 'retired', reviewed_by = ${actorUserId},
          review_note = 'Credential revoked; candidate retired automatically.',
          reviewed_at = now(), retired_at = now(), updated_at = now()
        WHERE workspace_id = ${workspaceId} AND provider = ${provider}
          AND status IN ('pending', 'approved')
        RETURNING id
      `;
      if (retiredCandidates.length)
        await auditAdapterCandidatesRetired(transaction, workspaceId, actorUserId, provider, retiredCandidates.length, "credential_revoked");
      await retireWorkspaceAdapterRegistrations(
        transaction,
        workspaceId,
        actorUserId,
        provider,
        "Credential revoked; registration retired automatically.",
        "credential_revoked",
      );
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        )
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.provider_connection_revoked', 'workspace_ai_provider_connection',
          ${provider},
          ${transaction.json({
            provider,
            status: "revoked",
            credentialErased: true,
            execution: false,
          } as JSONValue)}
        FROM workspace WHERE id = ${workspaceId}
      `;
    });
    return (
      await this.listProviderConnections(workspaceId, actorUserId)
    ).find((connection) => connection.provider === provider)!;
  }

  async replaceRoutingPreferences(
    input: WorkspaceAiRoutingPreferencesWrite,
    actorUserId: string,
  ): Promise<StoredAiRoutingPreference[]> {
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      validateRoutingPreferences(
        input,
        await selectProviderAdapters(transaction),
      );
      await transaction`
        DELETE FROM workspace_ai_routing_preference
        WHERE workspace_id = ${input.workspaceId}
      `;
      for (const preference of input.preferences) {
        await transaction`
          INSERT INTO workspace_ai_routing_preference (
            workspace_id, action, provider, model, created_by, updated_by
          ) VALUES (
            ${input.workspaceId}, ${preference.action}, ${preference.provider},
            ${preference.model}, ${actorUserId}, ${actorUserId}
          )
        `;
      }
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        )
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.routing_preferences_saved', 'workspace_ai_routing_preferences',
          ${input.workspaceId},
          ${transaction.json({ preferences: input.preferences } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return this.listRoutingPreferences(input.workspaceId);
  }

  async getCachedAnalysis<TResult = unknown>(
    key: AiAnalysisCacheKey,
    asOf: Date = new Date(),
  ): Promise<StoredAiAnalysisCacheEntry<TResult> | undefined> {
    validateAnalysisCacheKey(key);
    const rows = await this.sql<StoredAiAnalysisCacheEntry<TResult>[]>`
      UPDATE ai_analysis_cache_entry
      SET hit_count = hit_count + 1, last_hit_at = ${asOf}, updated_at = ${asOf}
      WHERE workspace_id = ${key.workspaceId}
        AND capability = ${key.capability}
        AND feature = ${key.feature}
        AND content_hash = ${key.contentHash}
        AND model_family = ${key.modelFamily}
        AND prompt_version = ${key.promptVersion}
        AND context_revision = ${key.contextRevision}
        AND expires_at > ${asOf}
      RETURNING workspace_id, capability, feature, content_hash, model_family,
        prompt_version, context_revision, result, result_hash, result_bytes,
        hit_count, created_by, last_hit_at, expires_at, created_at, updated_at
    `;
    return rows[0] ? normalizeAnalysisCacheEntry(rows[0]) : undefined;
  }

  async storeCachedAnalysis<TResult = unknown>(
    input: AiAnalysisCacheWrite<TResult>,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiAnalysisCacheEntry<TResult>> {
    validateAnalysisCacheKey(input);
    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < 60 ||
      input.ttlSeconds > 2_592_000
    )
      throw new AiPolicyValidationError([
        {
          field: "ttlSeconds",
          message: "Cache lifetime must be 60 seconds through 30 days.",
        },
      ]);
    const normalizedResult = normalizeCacheJson(input.result);
    const serialized = JSON.stringify(normalizedResult);
    const resultBytes = Buffer.byteLength(serialized, "utf8");
    if (resultBytes < 1 || resultBytes > 262_144)
      throw new AiPolicyValidationError([
        {
          field: "result",
          message: "Cached analysis must be valid JSON no larger than 262,144 bytes.",
        },
      ]);
    const resultHash = createHash("sha256").update(serialized).digest("hex");
    const expiresAt = new Date(asOf.getTime() + input.ttlSeconds * 1_000);
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      await transaction`
        INSERT INTO ai_analysis_cache_entry (
          workspace_id, capability, feature, content_hash, model_family,
          prompt_version, context_revision, result, result_hash, result_bytes,
          created_by, expires_at, created_at, updated_at
        ) VALUES (
          ${input.workspaceId}, ${input.capability}, ${input.feature},
          ${input.contentHash}, ${input.modelFamily}, ${input.promptVersion},
          ${input.contextRevision}, ${transaction.json(normalizedResult)},
          ${resultHash}, ${resultBytes}, ${actorUserId}, ${expiresAt}, ${asOf}, ${asOf}
        )
        ON CONFLICT (
          workspace_id, capability, feature, content_hash, model_family,
          prompt_version, context_revision
        ) DO UPDATE SET
          result = EXCLUDED.result,
          result_hash = EXCLUDED.result_hash,
          result_bytes = EXCLUDED.result_bytes,
          hit_count = 0,
          created_by = EXCLUDED.created_by,
          last_hit_at = NULL,
          expires_at = EXCLUDED.expires_at,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
        WHERE ai_analysis_cache_entry.expires_at <= EXCLUDED.created_at
      `;
    });
    const rows = await this.sql<StoredAiAnalysisCacheEntry<TResult>[]>`
      SELECT workspace_id, capability, feature, content_hash, model_family,
        prompt_version, context_revision, result, result_hash, result_bytes,
        hit_count, created_by, last_hit_at, expires_at, created_at, updated_at
      FROM ai_analysis_cache_entry
      WHERE workspace_id = ${input.workspaceId}
        AND capability = ${input.capability}
        AND feature = ${input.feature}
        AND content_hash = ${input.contentHash}
        AND model_family = ${input.modelFamily}
        AND prompt_version = ${input.promptVersion}
        AND context_revision = ${input.contextRevision}
    `;
    return normalizeAnalysisCacheEntry(rows[0]!);
  }

  async getAnalysisCacheSummary(
    workspaceId: string,
    asOf: Date = new Date(),
  ): Promise<AiAnalysisCacheSummary> {
    const rows = await this.sql<
      {
        activeEntryCount: number;
        totalResultBytes: number;
        totalHitCount: number;
        oldestEntryAt: string | null;
        newestEntryAt: string | null;
        lastHitAt: string | null;
      }[]
    >`
      SELECT count(*)::integer AS active_entry_count,
        COALESCE(sum(result_bytes), 0)::integer AS total_result_bytes,
        COALESCE(sum(hit_count), 0)::integer AS total_hit_count,
        min(created_at) AS oldest_entry_at,
        max(created_at) AS newest_entry_at,
        max(last_hit_at) AS last_hit_at
      FROM ai_analysis_cache_entry
      WHERE workspace_id = ${workspaceId} AND expires_at > ${asOf}
    `;
    const summary = rows[0]!;
    return {
      asOf: asOf.toISOString(),
      activeEntryCount: summary.activeEntryCount,
      totalResultBytes: summary.totalResultBytes,
      totalHitCount: summary.totalHitCount,
      ...(summary.oldestEntryAt
        ? { oldestEntryAt: new Date(summary.oldestEntryAt).toISOString() }
        : {}),
      ...(summary.newestEntryAt
        ? { newestEntryAt: new Date(summary.newestEntryAt).toISOString() }
        : {}),
      ...(summary.lastHitAt
        ? { lastHitAt: new Date(summary.lastHitAt).toISOString() }
        : {}),
    };
  }

  async listEffectiveProviderRateCards(
    asOf: Date = new Date(),
    currency?: string,
  ): Promise<StoredAiProviderRateCard[]> {
    if (currency !== undefined && !/^[A-Z]{3}$/.test(currency))
      throw new AiPolicyValidationError([
        {
          field: "currency",
          message: "Currency must be a three-letter uppercase code.",
        },
      ]);
    const currencyFilter = currency
      ? this.sql`AND r.currency = ${currency}`
      : this.sql``;
    const rows = await this.sql<StoredAiProviderRateCard[]>`
      SELECT r.id, r.provider, r.model_family, r.model_version, r.currency,
        r.minor_unit_exponent,
        r.status, r.effective_from, r.effective_to, r.source_reference,
        r.source_hash, r.verified_at, r.approved_at, r.created_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'kind', c.kind,
              'unit', c.unit,
              'unitQuantity', c.unit_quantity,
              'priceMicros', c.price_micros::double precision
            ) ORDER BY c.kind, c.unit
          ) FILTER (WHERE c.rate_card_id IS NOT NULL),
          '[]'::jsonb
        ) AS components
      FROM ai_provider_rate_card r
      LEFT JOIN ai_provider_rate_component c ON c.rate_card_id = r.id
      WHERE r.status = 'approved'
        AND r.effective_from <= ${asOf}
        AND (r.effective_to IS NULL OR r.effective_to > ${asOf})
        ${currencyFilter}
      GROUP BY r.id
      ORDER BY r.provider, r.model_family, r.currency
    `;
    return rows.map(normalizeProviderRateCard);
  }

  async getProviderRateCardSummary(
    asOf: Date = new Date(),
  ): Promise<AiProviderRateCardSummary> {
    const cards = await this.listEffectiveProviderRateCards(asOf);
    const verifiedTimes = cards.map((card) => card.verifiedAt).sort();
    return {
      asOf: asOf.toISOString(),
      activeCardCount: cards.length,
      currencies: [...new Set(cards.map((card) => card.currency))].sort(),
      ...(verifiedTimes.length > 0
        ? { latestVerifiedAt: verifiedTimes.at(-1)! }
        : {}),
      monetaryEstimateAvailable: false,
    };
  }

  async createCostQuote(
    input: AiCostQuoteWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiCostQuote> {
    validateCostQuoteWrite(input);
    const forecasts = [...input.forecasts].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.unit.localeCompare(right.unit),
    );
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      if (input.campaignId) {
        const campaigns = await transaction<{ found: boolean }[]>`
          SELECT true AS found FROM campaign
          WHERE id = ${input.campaignId} AND workspace_id = ${input.workspaceId}
        `;
        if (!campaigns[0])
          throw new AiPolicyValidationError([
            { field: "campaignId", message: "Campaign must belong to this workspace." },
          ]);
      }
      const rateCard = await selectProviderRateCard(
        transaction,
        input.rateCardId,
        asOf,
      );
      if (!rateCard)
        throw new AiPolicyValidationError([
          {
            field: "rateCardId",
            message: "Choose an approved rate card effective at the quote time.",
          },
        ]);
      let quote;
      try {
        quote = quoteAiCost(rateCard, forecasts, asOf);
      } catch (error) {
        const issues =
          error && typeof error === "object" && "issues" in error &&
          Array.isArray(error.issues)
            ? error.issues.map((message) => ({ field: "forecasts", message: String(message) }))
            : [{ field: "forecasts", message: "The cost quote could not be calculated." }];
        throw new AiPolicyValidationError(issues);
      }
      const quoteHash = costQuoteHash(
        input.workspaceId,
        input.campaignId,
        input.capability,
        input.feature,
        forecasts,
        quote,
      );
      await transaction`
        INSERT INTO ai_cost_quote (
          id, workspace_id, campaign_id, rate_card_id, capability, feature,
          currency, minor_unit_exponent, forecasts, lines,
          minimum_cost_minor, maximum_cost_minor, quote_hash,
          quoted_at, expires_at, created_by, created_at
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.campaignId ?? null},
          ${input.rateCardId}, ${input.capability}, ${input.feature},
          ${quote.currency}, ${quote.minorUnitExponent},
          ${transaction.json(forecasts as unknown as JSONValue)},
          ${transaction.json(quote.lines as unknown as JSONValue)},
          ${quote.minimumCostMinor}, ${quote.maximumCostMinor}, ${quoteHash},
          ${asOf}, ${new Date(quote.expiresAt)}, ${actorUserId}, ${asOf}
        )
      `;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id,
          event_type, subject_type, subject_id, data
        )
        SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
          'ai.cost_quote_created', 'ai_cost_quote', ${id},
          ${transaction.json({
            campaignId: input.campaignId,
            capability: input.capability,
            feature: input.feature,
            currency: quote.currency,
            minimumCostMinor: quote.minimumCostMinor,
            maximumCostMinor: quote.maximumCostMinor,
            expiresAt: quote.expiresAt,
            reservationRequired: quote.reservationRequired,
          } as JSONValue)}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return (await this.getCostQuote(input.workspaceId, id, asOf))!;
  }

  async getCostQuote(
    workspaceId: string,
    quoteId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiCostQuote | undefined> {
    const rows = await this.sql<(StoredAiCostQuote & { reservationId: string | null })[]>`
      SELECT q.id, q.workspace_id, q.campaign_id, q.rate_card_id,
        q.capability, q.feature, q.currency, q.minor_unit_exponent,
        q.forecasts, q.lines, q.minimum_cost_minor, q.maximum_cost_minor,
        q.quote_hash, q.quoted_at, q.expires_at, q.created_by, q.created_at,
        r.provider, r.model_family, r.model_version,
        s.id AS reservation_id
      FROM ai_cost_quote q
      JOIN ai_provider_rate_card r ON r.id = q.rate_card_id
      LEFT JOIN ai_spend_reservation s
        ON s.workspace_id = q.workspace_id AND s.cost_quote_id = q.id
      WHERE q.workspace_id = ${workspaceId} AND q.id = ${quoteId}
    `;
    return rows[0] ? normalizeCostQuote(rows[0], asOf) : undefined;
  }

  async listCostQuotes(
    workspaceId: string,
    actorUserId: string,
    limit = 25,
    asOf: Date = new Date(),
  ): Promise<StoredAiCostQuote[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new AiPolicyValidationError([
        { field: "limit", message: "Quote history limit must be 1 through 100." },
      ]);
    return this.sql.begin(async (transaction) => {
      await this.requireMember(transaction, workspaceId, actorUserId);
      const rows = await transaction<
        (StoredAiCostQuote & { reservationId: string | null })[]
      >`
        SELECT q.id, q.workspace_id, q.campaign_id, q.rate_card_id,
          q.capability, q.feature, q.currency, q.minor_unit_exponent,
          q.forecasts, q.lines, q.minimum_cost_minor, q.maximum_cost_minor,
          q.quote_hash, q.quoted_at, q.expires_at, q.created_by, q.created_at,
          r.provider, r.model_family, r.model_version,
          s.id AS reservation_id
        FROM ai_cost_quote q
        JOIN ai_provider_rate_card r ON r.id = q.rate_card_id
        LEFT JOIN ai_spend_reservation s
          ON s.workspace_id = q.workspace_id AND s.cost_quote_id = q.id
        WHERE q.workspace_id = ${workspaceId}
        ORDER BY q.quoted_at DESC, q.id DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => normalizeCostQuote(row, asOf));
    });
  }

  async recordUsage(input: AiUsageEventWrite): Promise<StoredAiUsageEvent> {
    validateUsage(input);
    if (input.estimatedCostMinor !== 0)
      throw new AiPolicyValidationError([
        {
          field: "estimatedCostMinor",
          message: "Paid AI usage must be recorded by settling an active spend reservation.",
        },
      ]);
    const id = input.id ?? randomUUID();
    const rows = await this.sql<StoredAiUsageEvent[]>`
      INSERT INTO ai_usage_event (
        id, workspace_id, campaign_id, capability, feature, provider, model,
        privacy_class, input_units, output_units, cached_input_units,
        request_count, latency_ms, estimated_cost_minor, currency,
        prompt_version, context_revision, content_hash, occurred_at
      ) VALUES (
        ${id}, ${input.workspaceId}, ${input.campaignId ?? null},
        ${input.capability}, ${input.feature}, ${input.provider}, ${input.model},
        ${input.privacyClass}, ${input.inputUnits}, ${input.outputUnits},
        ${input.cachedInputUnits}, ${input.requestCount ?? 1}, ${input.latencyMs},
        ${input.estimatedCostMinor}, ${input.currency},
        ${input.promptVersion ?? null}, ${input.contextRevision ?? null},
        ${input.contentHash ?? null}, ${input.occurredAt ?? new Date().toISOString()}
      )
      RETURNING id, workspace_id, campaign_id, capability, feature, provider,
        model, privacy_class, input_units, output_units, cached_input_units,
        request_count, latency_ms, estimated_cost_minor, currency,
        prompt_version, context_revision, content_hash, occurred_at, created_at
    `;
    return normalizeUsage(rows[0]!);
  }

  async reserveSpend(
    input: AiSpendReservationWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiSpendReservation> {
    validateReservation(input);
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      await transaction`
        SELECT id FROM workspace WHERE id = ${input.workspaceId} FOR UPDATE
      `;
      await transaction`
        UPDATE ai_spend_reservation
        SET status = 'expired', resolved_at = ${asOf}, updated_at = ${asOf}
        WHERE workspace_id = ${input.workspaceId} AND status = 'reserved'
          AND expires_at <= ${asOf}
      `;
      const existing = await transaction<StoredAiSpendReservation[]>`
        SELECT id, workspace_id, campaign_id, spend_exception_request_id,
          cost_quote_id, capability, feature, currency,
          estimated_cost_minor, actual_cost_minor, status, exceeded_scopes,
          cap_behavior, requested_by, resolved_by, expires_at, resolved_at,
          created_at, updated_at
        FROM ai_spend_reservation
        WHERE workspace_id = ${input.workspaceId}
          AND idempotency_key = ${input.idempotencyKey}
      `;
      if (existing[0]) {
        const normalized = normalizeReservation(existing[0], asOf);
        assertSameReservation(normalized, input);
        return normalized;
      }
      const policyRows = await transaction<StoredWorkspaceAiPolicy[]>`
        SELECT workspace_id, mode, maximum_privacy_class, failover_mode,
          cap_behavior, currency, daily_budget_minor, campaign_budget_minor,
          monthly_budget_minor, alert_threshold_percentages, created_by,
          updated_by, created_at, updated_at
        FROM workspace_ai_policy WHERE workspace_id = ${input.workspaceId}
      `;
      const policy = policyRows[0]
        ? normalizePolicy(policyRows[0])
        : defaultPolicy(input.workspaceId, actorUserId);
      if (input.currency !== policy.currency)
        throw new AiPolicyValidationError([
          {
            field: "currency",
            message: "Reservation currency must match the workspace AI policy.",
          },
        ]);
      if (input.campaignId) {
        const campaigns = await transaction<{ found: boolean }[]>`
          SELECT true AS found FROM campaign
          WHERE id = ${input.campaignId} AND workspace_id = ${input.workspaceId}
        `;
        if (!campaigns[0])
          throw new AiPolicyValidationError([
            { field: "campaignId", message: "Campaign must belong to this workspace." },
          ]);
      }
      const totals = await spendTotals(
        transaction,
        input.workspaceId,
        input.campaignId,
        input.currency,
        asOf,
      );
      const exceededScopes: AiBudgetScope[] = [];
      if (
        policy.dailyBudgetMinor !== undefined &&
        totals.dailySpent + totals.dailyReserved + input.estimatedCostMinor >
          policy.dailyBudgetMinor
      )
        exceededScopes.push("daily");
      if (
        input.campaignId &&
        policy.campaignBudgetMinor !== undefined &&
        totals.campaignSpent + totals.campaignReserved + input.estimatedCostMinor >
          policy.campaignBudgetMinor
      )
        exceededScopes.push("campaign");
      if (
        policy.monthlyBudgetMinor !== undefined &&
        totals.monthlySpent + totals.monthlyReserved + input.estimatedCostMinor >
          policy.monthlyBudgetMinor
      )
        exceededScopes.push("monthly");
      const id = randomUUID();
      const denied = exceededScopes.length > 0;
      const expiresAt = denied
        ? undefined
        : new Date(asOf.getTime() + 15 * 60 * 1000);
      const rows = await transaction<StoredAiSpendReservation[]>`
        INSERT INTO ai_spend_reservation (
          id, workspace_id, campaign_id, idempotency_key, capability, feature,
          currency, estimated_cost_minor, status, exceeded_scopes, cap_behavior,
          requested_by, resolved_by, expires_at, resolved_at, created_at, updated_at
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.campaignId ?? null},
          ${input.idempotencyKey}, ${input.capability}, ${input.feature},
          ${input.currency}, ${input.estimatedCostMinor},
          ${denied ? "denied" : "reserved"}, ${exceededScopes},
          ${policy.capBehavior}, ${actorUserId},
          ${denied ? actorUserId : null}, ${expiresAt ?? null},
          ${denied ? asOf : null}, ${asOf}, ${asOf}
        )
        RETURNING id, workspace_id, campaign_id, spend_exception_request_id,
          cost_quote_id, capability, feature, currency,
          estimated_cost_minor, actual_cost_minor, status, exceeded_scopes,
          cap_behavior, requested_by, resolved_by, expires_at, resolved_at,
          created_at, updated_at
      `;
      const reservation = normalizeReservation(rows[0]!, asOf);
      await this.auditSpend(
        transaction,
        input.workspaceId,
        actorUserId,
        denied ? "ai.spend_denied" : "ai.spend_reserved",
        reservation,
      );
      if (!denied)
        await createBudgetAlerts(
          transaction,
          policy,
          reservation,
          totals,
          actorUserId,
          asOf,
        );
      return reservation;
    });
  }

  async reserveQuotedSpend(
    input: AiQuotedSpendReservationWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiSpendReservation> {
    if (!isUuid(input.quoteId) || !isUuid(input.idempotencyKey))
      throw new AiPolicyValidationError([
        { field: "quoteId", message: "Quote and idempotency IDs must be UUIDs." },
      ]);
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const quoteRows = await transaction<(StoredAiCostQuote & { reservationId: string | null })[]>`
        SELECT q.id, q.workspace_id, q.campaign_id, q.rate_card_id,
          q.capability, q.feature, q.currency, q.minor_unit_exponent,
          q.forecasts, q.lines, q.minimum_cost_minor, q.maximum_cost_minor,
          q.quote_hash, q.quoted_at, q.expires_at, q.created_by, q.created_at,
          r.provider, r.model_family, r.model_version,
          s.id AS reservation_id
        FROM ai_cost_quote q
        JOIN ai_provider_rate_card r ON r.id = q.rate_card_id
        LEFT JOIN ai_spend_reservation s
          ON s.workspace_id = q.workspace_id AND s.cost_quote_id = q.id
        WHERE q.workspace_id = ${input.workspaceId} AND q.id = ${input.quoteId}
        FOR UPDATE OF q
      `;
      if (!quoteRows[0])
        throw new AiPolicyValidationError([
          { field: "quoteId", message: "Cost quote was not found." },
        ]);
      const quote = normalizeCostQuote(quoteRows[0], asOf);
      if (quote.quoteHash !== costQuoteHash(
        quote.workspaceId,
        quote.campaignId,
        quote.capability,
        quote.feature,
        quote.forecasts,
        quote,
      ))
        throw new AiPolicyValidationError([
          { field: "quoteId", message: "Cost quote evidence failed integrity verification." },
        ]);
      if (quote.status === "expired")
        throw new AiPolicyValidationError([
          { field: "quoteId", message: "Cost quote has expired." },
        ]);
      if (quote.maximumCostMinor < 1)
        throw new AiPolicyValidationError([
          { field: "quoteId", message: "A zero-cost quote does not require a spend reservation." },
        ]);
      const reservationInput: AiSpendReservationWrite = {
        workspaceId: quote.workspaceId,
        campaignId: quote.campaignId,
        idempotencyKey: input.idempotencyKey,
        capability: quote.capability,
        feature: quote.feature,
        currency: quote.currency,
        estimatedCostMinor: quote.maximumCostMinor,
      };
      const existing = await transaction<StoredAiSpendReservation[]>`
        SELECT id, workspace_id, campaign_id, spend_exception_request_id,
          cost_quote_id, capability, feature, currency, estimated_cost_minor,
          actual_cost_minor, status, exceeded_scopes, cap_behavior,
          requested_by, resolved_by, expires_at, resolved_at, created_at, updated_at
        FROM ai_spend_reservation
        WHERE workspace_id = ${input.workspaceId}
          AND idempotency_key = ${input.idempotencyKey}
      `;
      if (existing[0]) {
        const normalized = normalizeReservation(existing[0], asOf);
        assertSameReservation(normalized, reservationInput);
        if (normalized.costQuoteId !== quote.id)
          throw new AiPolicyValidationError([
            { field: "idempotencyKey", message: "Idempotency key is bound to another cost quote." },
          ]);
        return normalized;
      }
      if (quote.reservationId)
        throw new AiPolicyValidationError([
          { field: "quoteId", message: "Cost quote has already been bound to a reservation." },
        ]);
      await transaction`
        SELECT id FROM workspace WHERE id = ${input.workspaceId} FOR UPDATE
      `;
      await transaction`
        UPDATE ai_spend_reservation
        SET status = 'expired', resolved_at = ${asOf}, updated_at = ${asOf}
        WHERE workspace_id = ${input.workspaceId} AND status = 'reserved'
          AND expires_at <= ${asOf}
      `;
      const policyRows = await transaction<StoredWorkspaceAiPolicy[]>`
        SELECT workspace_id, mode, maximum_privacy_class, failover_mode,
          cap_behavior, currency, daily_budget_minor, campaign_budget_minor,
          monthly_budget_minor, alert_threshold_percentages, created_by,
          updated_by, created_at, updated_at
        FROM workspace_ai_policy WHERE workspace_id = ${input.workspaceId}
      `;
      const policy = policyRows[0]
        ? normalizePolicy(policyRows[0])
        : defaultPolicy(input.workspaceId, actorUserId);
      if (quote.currency !== policy.currency)
        throw new AiPolicyValidationError([
          { field: "quoteId", message: "Quote currency no longer matches workspace AI policy." },
        ]);
      const totals = await spendTotals(
        transaction, quote.workspaceId, quote.campaignId, quote.currency, asOf,
      );
      const exceededScopes: AiBudgetScope[] = [];
      if (policy.dailyBudgetMinor !== undefined &&
        totals.dailySpent + totals.dailyReserved + quote.maximumCostMinor > policy.dailyBudgetMinor)
        exceededScopes.push("daily");
      if (quote.campaignId && policy.campaignBudgetMinor !== undefined &&
        totals.campaignSpent + totals.campaignReserved + quote.maximumCostMinor > policy.campaignBudgetMinor)
        exceededScopes.push("campaign");
      if (policy.monthlyBudgetMinor !== undefined &&
        totals.monthlySpent + totals.monthlyReserved + quote.maximumCostMinor > policy.monthlyBudgetMinor)
        exceededScopes.push("monthly");
      const id = randomUUID();
      const denied = exceededScopes.length > 0;
      const expiresAt = denied ? undefined : new Date(asOf.getTime() + 15 * 60 * 1000);
      const rows = await transaction<StoredAiSpendReservation[]>`
        INSERT INTO ai_spend_reservation (
          id, workspace_id, campaign_id, cost_quote_id, idempotency_key,
          capability, feature, currency, estimated_cost_minor, status,
          exceeded_scopes, cap_behavior, requested_by, resolved_by,
          expires_at, resolved_at, created_at, updated_at
        ) VALUES (
          ${id}, ${quote.workspaceId}, ${quote.campaignId ?? null}, ${quote.id},
          ${input.idempotencyKey}, ${quote.capability}, ${quote.feature},
          ${quote.currency}, ${quote.maximumCostMinor},
          ${denied ? "denied" : "reserved"}, ${exceededScopes},
          ${policy.capBehavior}, ${actorUserId}, ${denied ? actorUserId : null},
          ${expiresAt ?? null}, ${denied ? asOf : null}, ${asOf}, ${asOf}
        )
        RETURNING id, workspace_id, campaign_id, spend_exception_request_id,
          cost_quote_id, capability, feature, currency, estimated_cost_minor,
          actual_cost_minor, status, exceeded_scopes, cap_behavior,
          requested_by, resolved_by, expires_at, resolved_at, created_at, updated_at
      `;
      const reservation = normalizeReservation(rows[0]!, asOf);
      await this.auditSpend(
        transaction, quote.workspaceId, actorUserId,
        denied ? "ai.spend_denied" : "ai.spend_reserved", reservation,
      );
      if (!denied)
        await createBudgetAlerts(
          transaction, policy, reservation, totals, actorUserId, asOf,
        );
      return reservation;
    });
  }

  async settleSpend(
    input: AiSpendSettlementWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiSpendReservation> {
    if (
      !Number.isInteger(input.actualCostMinor) ||
      input.actualCostMinor < 0 ||
      input.actualCostMinor > 1_000_000_000
    )
      throw new AiPolicyValidationError([
        { field: "actualCostMinor", message: "Actual cost must be a non-negative bounded integer." },
      ]);
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const rows = await transaction<StoredAiSpendReservation[]>`
        SELECT id, workspace_id, campaign_id, spend_exception_request_id,
          cost_quote_id, capability, feature, currency,
          estimated_cost_minor, actual_cost_minor, status, exceeded_scopes,
          cap_behavior, requested_by, resolved_by, expires_at, resolved_at,
          created_at, updated_at
        FROM ai_spend_reservation
        WHERE workspace_id = ${input.workspaceId} AND id = ${input.reservationId}
        FOR UPDATE
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "reservationId", message: "Spend reservation was not found." },
        ]);
      const reservation = normalizeReservation(rows[0], new Date(0));
      if (reservation.status === "settled") return reservation;
      if (reservation.status !== "reserved")
        throw new AiPolicyValidationError([
          { field: "reservationId", message: "Only an active reservation can be settled." },
        ]);
      const textIntent = await transaction<{ found: boolean }[]>`
        SELECT true AS found FROM workspace_ai_text_invocation_intent
        WHERE workspace_id = ${input.workspaceId}
          AND reservation_id = ${input.reservationId}
        LIMIT 1
      `;
      if (textIntent[0])
        throw new AiPolicyValidationError([{
          field: "reservationId",
          message: "Text invocation reservations settle only through the attempt reconciliation boundary.",
        }]);
      if (reservation.expiresAt && new Date(reservation.expiresAt) <= asOf) {
        const expired = await markReservation(
          transaction,
          input.workspaceId,
          input.reservationId,
          "expired",
          actorUserId,
          asOf,
        );
        return expired;
      }
      if (input.actualCostMinor > reservation.estimatedCostMinor)
        throw new AiPolicyValidationError([
          {
            field: "actualCostMinor",
            message: "Actual cost cannot exceed the authorized reservation; reserve a safe upper bound.",
          },
        ]);
      const usage = {
        ...input.usage,
        workspaceId: input.workspaceId,
        campaignId: reservation.campaignId,
        capability: reservation.capability,
        feature: reservation.feature,
        estimatedCostMinor: input.actualCostMinor,
        currency: reservation.currency,
      } satisfies AiUsageEventWrite;
      validateUsage(usage);
      const usageId = randomUUID();
      await transaction`
        INSERT INTO ai_usage_event (
          id, workspace_id, campaign_id, spend_reservation_id, capability,
          feature, provider, model, privacy_class, input_units, output_units,
          cached_input_units, request_count, latency_ms, estimated_cost_minor,
          currency, prompt_version, context_revision, content_hash, occurred_at
        ) VALUES (
          ${usageId}, ${usage.workspaceId}, ${usage.campaignId ?? null},
          ${reservation.id}, ${usage.capability}, ${usage.feature},
          ${usage.provider}, ${usage.model}, ${usage.privacyClass},
          ${usage.inputUnits}, ${usage.outputUnits}, ${usage.cachedInputUnits},
          ${usage.requestCount ?? 1}, ${usage.latencyMs},
          ${usage.estimatedCostMinor}, ${usage.currency},
          ${usage.promptVersion ?? null}, ${usage.contextRevision ?? null},
          ${usage.contentHash ?? null}, ${usage.occurredAt ?? asOf.toISOString()}
        )
      `;
      const settled = await markReservation(
        transaction,
        input.workspaceId,
        input.reservationId,
        "settled",
        actorUserId,
        asOf,
        input.actualCostMinor,
      );
      await this.auditSpend(
        transaction,
        input.workspaceId,
        actorUserId,
        "ai.spend_settled",
        settled,
      );
      return settled;
    });
  }

  async releaseSpend(
    workspaceId: string,
    reservationId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiSpendReservation> {
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const rows = await transaction<StoredAiSpendReservation[]>`
        SELECT id, workspace_id, campaign_id, spend_exception_request_id,
          cost_quote_id, capability, feature, currency,
          estimated_cost_minor, actual_cost_minor, status, exceeded_scopes,
          cap_behavior, requested_by, resolved_by, expires_at, resolved_at,
          created_at, updated_at
        FROM ai_spend_reservation
        WHERE workspace_id = ${workspaceId} AND id = ${reservationId}
        FOR UPDATE
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "reservationId", message: "Spend reservation was not found." },
        ]);
      const current = normalizeReservation(rows[0], asOf);
      if (current.status !== "reserved") return current;
      const textIntent = await transaction<{ found: boolean }[]>`
        SELECT true AS found FROM workspace_ai_text_invocation_intent
        WHERE workspace_id = ${workspaceId} AND reservation_id = ${reservationId}
      `;
      if (textIntent[0])
        throw new AiPolicyValidationError([{
          field: "reservationId",
          message: "Text invocation reservations may be released only by pre-attempt cancellation, known pre-request failure, or reviewed invocation resolution.",
        }]);
      const released = await markReservation(
        transaction,
        workspaceId,
        reservationId,
        "released",
        actorUserId,
        asOf,
      );
      await this.auditSpend(
        transaction,
        workspaceId,
        actorUserId,
        "ai.spend_released",
        released,
      );
      return released;
    });
  }

  async requestSpendException(
    input: AiSpendExceptionRequestWrite,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiSpendExceptionRequest> {
    const justification = input.justification.trim();
    if (justification.length < 1 || justification.length > 1_000)
      throw new AiPolicyValidationError([
        {
          field: "justification",
          message: "Justification must contain 1 to 1,000 characters.",
        },
      ]);
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      const denied = await transaction<StoredAiSpendReservation[]>`
        SELECT id, workspace_id, campaign_id, spend_exception_request_id,
          cost_quote_id, capability, feature, currency, estimated_cost_minor, actual_cost_minor,
          status, exceeded_scopes, cap_behavior, requested_by, resolved_by,
          expires_at, resolved_at, created_at, updated_at
        FROM ai_spend_reservation
        WHERE workspace_id = ${input.workspaceId}
          AND id = ${input.deniedReservationId}
        FOR UPDATE
      `;
      const reservation = denied[0]
        ? normalizeReservation(denied[0], new Date(0))
        : undefined;
      if (
        !reservation ||
        reservation.status !== "denied" ||
        reservation.capBehavior !== "require_approval"
      )
        throw new AiPolicyValidationError([
          {
            field: "deniedReservationId",
            message:
              "Spend approval requires a denied reservation whose cap behavior is require approval.",
          },
        ]);
      const existing = await selectSpendException(
        transaction,
        input.workspaceId,
        undefined,
        input.deniedReservationId,
      );
      if (existing) return normalizeSpendException(existing, asOf);
      const id = randomUUID();
      const expiresAt = new Date(asOf.getTime() + 24 * 60 * 60 * 1_000);
      await transaction`
        INSERT INTO ai_spend_exception_request (
          id, workspace_id, denied_reservation_id, justification,
          requested_by, expires_at, created_at, updated_at
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.deniedReservationId},
          ${justification}, ${actorUserId}, ${expiresAt}, ${asOf}, ${asOf}
        )
      `;
      const created = (await selectSpendException(
        transaction,
        input.workspaceId,
        id,
      ))!;
      const request = normalizeSpendException(created, asOf);
      await auditSpendException(
        transaction,
        input.workspaceId,
        actorUserId,
        "ai.spend_exception_requested",
        request,
      );
      return request;
    });
  }

  async getSpendReservation(
    workspaceId: string,
    reservationId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiSpendReservation | undefined> {
    const rows = await this.sql<StoredAiSpendReservation[]>`
      SELECT id, workspace_id, campaign_id, spend_exception_request_id,
        cost_quote_id, capability, feature, currency, estimated_cost_minor, actual_cost_minor,
        status, exceeded_scopes, cap_behavior, requested_by, resolved_by,
        expires_at, resolved_at, created_at, updated_at
      FROM ai_spend_reservation
      WHERE workspace_id = ${workspaceId} AND id = ${reservationId}
    `;
    return rows[0] ? normalizeReservation(rows[0], asOf) : undefined;
  }

  async listSpendExceptions(
    workspaceId: string,
    currency: string,
    asOf: Date = new Date(),
  ): Promise<readonly AiSpendExceptionRequest[]> {
    const rows = await this.sql<StoredAiSpendExceptionRequest[]>`
      SELECT e.id, e.workspace_id, e.denied_reservation_id,
        r.campaign_id, r.capability, r.feature, r.currency,
        r.estimated_cost_minor, r.exceeded_scopes, r.cap_behavior,
        e.status, e.justification, e.requested_by, e.resolved_by,
        e.decision_note, e.expires_at, e.resolved_at, e.consumed_at,
        e.created_at, e.updated_at
      FROM ai_spend_exception_request e
      JOIN ai_spend_reservation r
        ON r.id = e.denied_reservation_id AND r.workspace_id = e.workspace_id
      WHERE e.workspace_id = ${workspaceId} AND r.currency = ${currency}
      ORDER BY CASE WHEN e.status = 'pending' THEN 0 ELSE 1 END,
        e.created_at DESC, e.id DESC
      LIMIT 50
    `;
    return rows.map((row) => normalizeSpendException(row, asOf));
  }

  async decideSpendException(
    workspaceId: string,
    requestId: string,
    decision: "approved" | "rejected",
    actorUserId: string,
    note?: string,
    asOf: Date = new Date(),
  ): Promise<AiSpendExceptionRequest> {
    const decisionNote = note?.trim() || undefined;
    if (decisionNote && decisionNote.length > 1_000)
      throw new AiPolicyValidationError([
        { field: "note", message: "Decision note cannot exceed 1,000 characters." },
      ]);
    return this.sql.begin(async (transaction) => {
      await this.requireApprover(transaction, workspaceId, actorUserId);
      const selected = await selectSpendException(
        transaction,
        workspaceId,
        requestId,
        undefined,
        true,
      );
      if (!selected)
        throw new AiPolicyValidationError([
          { field: "requestId", message: "Spend exception request was not found." },
        ]);
      const current = normalizeSpendException(selected, new Date(0));
      if (
        current.status === "pending" &&
        new Date(current.expiresAt) <= asOf
      ) {
        await transaction`
          UPDATE ai_spend_exception_request
          SET status = 'expired', resolved_at = ${asOf}, updated_at = ${asOf}
          WHERE workspace_id = ${workspaceId} AND id = ${requestId}
        `;
        const expired = normalizeSpendException(
          (await selectSpendException(transaction, workspaceId, requestId))!,
          asOf,
        );
        await auditSpendException(
          transaction,
          workspaceId,
          actorUserId,
          "ai.spend_exception_expired",
          expired,
        );
        return expired;
      }
      if (current.status !== "pending") {
        if (current.status === decision) return current;
        throw new AiPolicyValidationError([
          {
            field: "decision",
            message: "The spend exception already has a different terminal state.",
          },
        ]);
      }
      await transaction`
        UPDATE ai_spend_exception_request
        SET status = ${decision}, resolved_by = ${actorUserId},
          decision_note = ${decisionNote ?? null}, resolved_at = ${asOf},
          updated_at = ${asOf}
        WHERE workspace_id = ${workspaceId} AND id = ${requestId}
      `;
      const updated = normalizeSpendException(
        (await selectSpendException(transaction, workspaceId, requestId))!,
        asOf,
      );
      await auditSpendException(
        transaction,
        workspaceId,
        actorUserId,
        `ai.spend_exception_${decision}`,
        updated,
      );
      return updated;
    });
  }

  async authorizeApprovedSpend(
    workspaceId: string,
    requestId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<StoredAiSpendReservation> {
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      await transaction`SELECT id FROM workspace WHERE id = ${workspaceId} FOR UPDATE`;
      const selected = await selectSpendException(
        transaction,
        workspaceId,
        requestId,
        undefined,
        true,
      );
      if (!selected)
        throw new AiPolicyValidationError([
          { field: "requestId", message: "Spend exception request was not found." },
        ]);
      const request = normalizeSpendException(selected, new Date(0));
      if (request.consumedAt) {
        const existing = await transaction<StoredAiSpendReservation[]>`
          SELECT id, workspace_id, campaign_id, spend_exception_request_id,
            cost_quote_id, capability, feature, currency, estimated_cost_minor,
            actual_cost_minor, status, exceeded_scopes, cap_behavior,
            requested_by, resolved_by, expires_at, resolved_at, created_at, updated_at
          FROM ai_spend_reservation
          WHERE workspace_id = ${workspaceId}
            AND spend_exception_request_id = ${requestId}
        `;
        return normalizeReservation(existing[0]!, asOf);
      }
      if (
        request.status !== "approved" ||
        new Date(request.expiresAt) <= asOf
      ) {
        throw new AiPolicyValidationError([
          {
            field: "requestId",
            message: "Only an unexpired approved spend exception can be consumed.",
          },
        ]);
      }
      const policyRows = await transaction<StoredWorkspaceAiPolicy[]>`
        SELECT workspace_id, mode, maximum_privacy_class, failover_mode,
          cap_behavior, currency, daily_budget_minor, campaign_budget_minor,
          monthly_budget_minor, alert_threshold_percentages, created_by,
          updated_by, created_at, updated_at
        FROM workspace_ai_policy WHERE workspace_id = ${workspaceId}
      `;
      const policy = policyRows[0]
        ? normalizePolicy(policyRows[0])
        : defaultPolicy(workspaceId, actorUserId);
      if (policy.currency !== request.currency)
        throw new AiPolicyValidationError([
          {
            field: "requestId",
            message: "The AI policy currency changed after this exception was requested.",
          },
        ]);
      const totals = await spendTotals(
        transaction,
        workspaceId,
        request.campaignId,
        request.currency,
        asOf,
      );
      const id = randomUUID();
      const expiresAt = new Date(asOf.getTime() + 15 * 60 * 1_000);
      const rows = await transaction<StoredAiSpendReservation[]>`
        INSERT INTO ai_spend_reservation (
          id, workspace_id, campaign_id, spend_exception_request_id,
          idempotency_key, capability, feature, currency,
          estimated_cost_minor, status, exceeded_scopes, cap_behavior,
          requested_by, expires_at, created_at, updated_at
        ) VALUES (
          ${id}, ${workspaceId}, ${request.campaignId ?? null}, ${requestId},
          ${randomUUID()}, ${request.capability}, ${request.feature},
          ${request.currency}, ${request.estimatedCostMinor}, 'reserved', '{}',
          ${request.capBehavior}, ${actorUserId}, ${expiresAt}, ${asOf}, ${asOf}
        )
        RETURNING id, workspace_id, campaign_id, spend_exception_request_id,
          cost_quote_id, capability, feature, currency, estimated_cost_minor, actual_cost_minor,
          status, exceeded_scopes, cap_behavior, requested_by, resolved_by,
          expires_at, resolved_at, created_at, updated_at
      `;
      await transaction`
        UPDATE ai_spend_exception_request
        SET consumed_at = ${asOf}, updated_at = ${asOf}
        WHERE workspace_id = ${workspaceId} AND id = ${requestId}
      `;
      const reservation = normalizeReservation(rows[0]!, asOf);
      await this.auditSpend(
        transaction,
        workspaceId,
        actorUserId,
        "ai.spend_reserved",
        reservation,
      );
      await createBudgetAlerts(
        transaction,
        policy,
        reservation,
        totals,
        actorUserId,
        asOf,
      );
      const consumed = normalizeSpendException(
        (await selectSpendException(transaction, workspaceId, requestId))!,
        asOf,
      );
      await auditSpendException(
        transaction,
        workspaceId,
        actorUserId,
        "ai.spend_exception_consumed",
        consumed,
      );
      return reservation;
    });
  }

  async getBudgetStatus(
    workspaceId: string,
    currency: string,
    asOf: Date = new Date(),
  ): Promise<AiBudgetStatus> {
    const policy = await this.getPolicy(workspaceId);
    const totals = await spendTotals(
      this.sql,
      workspaceId,
      undefined,
      currency,
      asOf,
    );
    const recent = await this.sql<StoredAiSpendReservation[]>`
      SELECT id, workspace_id, campaign_id, spend_exception_request_id,
        cost_quote_id, capability, feature, currency,
        estimated_cost_minor, actual_cost_minor, status, exceeded_scopes,
        cap_behavior, requested_by, resolved_by, expires_at, resolved_at,
        created_at, updated_at
      FROM ai_spend_reservation
      WHERE workspace_id = ${workspaceId} AND currency = ${currency}
      ORDER BY created_at DESC, id DESC LIMIT 20
    `;
    const active = await this.sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM ai_spend_reservation
      WHERE workspace_id = ${workspaceId} AND currency = ${currency}
        AND status = 'reserved' AND expires_at > ${asOf}
    `;
    return {
      asOf: asOf.toISOString(),
      currency,
      daily: scopeStatus(
        "daily",
        totals.dailySpent,
        totals.dailyReserved,
        policy?.dailyBudgetMinor,
      ),
      monthly: scopeStatus(
        "monthly",
        totals.monthlySpent,
        totals.monthlyReserved,
        policy?.monthlyBudgetMinor,
      ),
      activeReservationCount: active[0]?.count ?? 0,
      recentReservations: recent.map((item) => normalizeReservation(item, asOf)),
    };
  }

  async listBudgetAlerts(
    workspaceId: string,
    currency: string,
  ): Promise<readonly AiBudgetAlert[]> {
    const rows = await this.sql<StoredAiBudgetAlert[]>`
      SELECT id, workspace_id, campaign_id, source_reservation_id, scope,
        window_key, threshold_percentage, committed_cost_minor, cap_minor,
        currency, status, acknowledged_by, acknowledged_at, created_at, updated_at
      FROM ai_budget_alert
      WHERE workspace_id = ${workspaceId} AND currency = ${currency}
      ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END,
        created_at DESC, id DESC
      LIMIT 50
    `;
    return rows.map(normalizeBudgetAlert);
  }

  async acknowledgeBudgetAlert(
    workspaceId: string,
    alertId: string,
    actorUserId: string,
    asOf: Date = new Date(),
  ): Promise<AiBudgetAlert> {
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const rows = await transaction<StoredAiBudgetAlert[]>`
        SELECT id, workspace_id, campaign_id, source_reservation_id, scope,
          window_key, threshold_percentage, committed_cost_minor, cap_minor,
          currency, status, acknowledged_by, acknowledged_at, created_at, updated_at
        FROM ai_budget_alert
        WHERE workspace_id = ${workspaceId} AND id = ${alertId}
        FOR UPDATE
      `;
      if (!rows[0])
        throw new AiPolicyValidationError([
          { field: "alertId", message: "Budget alert was not found." },
        ]);
      const current = normalizeBudgetAlert(rows[0]);
      if (current.status === "acknowledged") return current;
      const updated = await transaction<StoredAiBudgetAlert[]>`
        UPDATE ai_budget_alert
        SET status = 'acknowledged', acknowledged_by = ${actorUserId},
          acknowledged_at = ${asOf}, updated_at = ${asOf}
        WHERE workspace_id = ${workspaceId} AND id = ${alertId}
        RETURNING id, workspace_id, campaign_id, source_reservation_id, scope,
          window_key, threshold_percentage, committed_cost_minor, cap_minor,
          currency, status, acknowledged_by, acknowledged_at, created_at, updated_at
      `;
      const alert = normalizeBudgetAlert(updated[0]!);
      await auditBudgetAlert(
        transaction,
        workspaceId,
        actorUserId,
        "ai.budget_alert_acknowledged",
        alert,
      );
      return alert;
    });
  }

  async getCurrentMonthUsage(
    workspaceId: string,
    currency: string,
    asOf: Date = new Date(),
  ): Promise<AiUsageSummary> {
    const monthStart = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1),
    );
    const monthEnd = new Date(
      Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1),
    );
    const totals = await this.sql<
      {
        currentMonthCostMinor: number;
        requestCount: number;
        inputUnits: number;
        outputUnits: number;
        cachedInputUnits: number;
        averageLatencyMs?: number;
      }[]
    >`
      SELECT COALESCE(sum(estimated_cost_minor), 0)::integer AS current_month_cost_minor,
        COALESCE(sum(request_count), 0)::integer AS request_count,
        COALESCE(sum(input_units), 0)::integer AS input_units,
        COALESCE(sum(output_units), 0)::integer AS output_units,
        COALESCE(sum(cached_input_units), 0)::integer AS cached_input_units,
        round(avg(latency_ms))::integer AS average_latency_ms
      FROM (
        SELECT estimated_cost_minor, request_count, input_units, output_units,
          cached_input_units, latency_ms
        FROM ai_usage_event
        WHERE workspace_id = ${workspaceId} AND currency = ${currency}
          AND occurred_at >= ${monthStart} AND occurred_at < ${monthEnd}
        UNION ALL
        SELECT provider_charge_minor AS estimated_cost_minor, 1 AS request_count,
          0 AS input_units, 0 AS output_units, 0 AS cached_input_units,
          NULL::integer AS latency_ms
        FROM workspace_ai_text_invocation_resolution
        WHERE workspace_id = ${workspaceId} AND currency = ${currency}
          AND disposition = 'settled_provider_charge'
          AND resolved_at >= ${monthStart} AND resolved_at < ${monthEnd}
      ) usage
    `;
    const byFeature = await this.sql<
      { feature: string; costMinor: number; requestCount: number }[]
    >`
      SELECT feature, sum(estimated_cost_minor)::integer AS cost_minor,
        sum(request_count)::integer AS request_count
      FROM (
        SELECT feature, estimated_cost_minor, request_count
        FROM ai_usage_event
        WHERE workspace_id = ${workspaceId} AND currency = ${currency}
          AND occurred_at >= ${monthStart} AND occurred_at < ${monthEnd}
        UNION ALL
        SELECT reservation.feature, resolution.provider_charge_minor, 1
        FROM workspace_ai_text_invocation_resolution resolution
        JOIN ai_spend_reservation reservation
          ON reservation.id = resolution.reservation_id
        WHERE resolution.workspace_id = ${workspaceId}
          AND resolution.currency = ${currency}
          AND resolution.disposition = 'settled_provider_charge'
          AND resolution.resolved_at >= ${monthStart}
          AND resolution.resolved_at < ${monthEnd}
      ) usage
      GROUP BY feature ORDER BY cost_minor DESC, feature
    `;
    const total = totals[0]!;
    return {
      currency,
      currentMonthCostMinor: total.currentMonthCostMinor,
      requestCount: total.requestCount,
      inputUnits: total.inputUnits,
      outputUnits: total.outputUnits,
      cachedInputUnits: total.cachedInputUnits,
      ...(total.averageLatencyMs === null || total.averageLatencyMs === undefined
        ? {}
        : { averageLatencyMs: total.averageLatencyMs }),
      byFeature,
    };
  }

  private async requireWriter(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ) {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}
        AND role IN ('owner', 'admin', 'editor')
    `;
    if (!rows[0])
      throw new AiPolicyValidationError([
        {
          field: "workspaceId",
          message: "AI policy changes require workspace authoring access.",
        },
      ]);
  }

  private async requireMember(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ) {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}
    `;
    if (!rows[0])
      throw new AiPolicyValidationError([
        {
          field: "workspaceId",
          message: "AI quote history requires workspace membership.",
        },
      ]);
  }

  private async requireApprover(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ) {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}
        AND role IN ('owner', 'admin', 'approver')
    `;
    if (!rows[0])
      throw new AiPolicyValidationError([
        {
          field: "workspaceId",
          message: "AI spend exception decisions require workspace approval access.",
        },
      ]);
  }

  private async requireAdministrator(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ) {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}
        AND role IN ('owner', 'admin')
    `;
    if (!rows[0])
      throw new AiPolicyValidationError([
        { field: "workspaceId", message: "Adapter candidate decisions require workspace administration access." },
      ]);
  }

  private async auditPolicy(
    transaction: TransactionSql,
    input: WorkspaceAiPolicyWrite,
    actorUserId: string,
  ) {
    const data = {
      mode: input.mode,
      maximumPrivacyClass: input.maximumPrivacyClass,
      failoverMode: input.failoverMode,
      capBehavior: input.capBehavior,
      currency: input.currency,
      dailyBudgetMinor: input.dailyBudgetMinor,
      campaignBudgetMinor: input.campaignBudgetMinor,
      monthlyBudgetMinor: input.monthlyBudgetMinor,
      alertThresholdPercentages: input.alertThresholdPercentages,
    };
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        'ai.policy_saved', 'workspace_ai_policy', ${input.workspaceId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${input.workspaceId}
    `;
  }

  private async auditSpend(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    eventType: string,
    reservation: StoredAiSpendReservation,
  ) {
    const data = {
      capability: reservation.capability,
      currency: reservation.currency,
      estimatedCostMinor: reservation.estimatedCostMinor,
      actualCostMinor: reservation.actualCostMinor,
      campaignId: reservation.campaignId,
      exceededScopes: reservation.exceededScopes,
      capBehavior: reservation.capBehavior,
      status: reservation.status,
    };
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        ${eventType}, 'ai_spend_reservation', ${reservation.id},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditTextInvocationIntent(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    intentId: string,
    eventType: string,
    provider: string,
    status: "prepared" | "cancelled",
    draftRevision?: Pick<AiDraftRevisionPromptTarget,
      "contentDraftId" | "contentDraftVersionId" | "goal">,
  ) {
    const data = {
      provider,
      status,
      productBound: Boolean(draftRevision),
      ...(draftRevision ? {
        sourceContentDraftId: draftRevision.contentDraftId,
        sourceContentDraftVersionId: draftRevision.contentDraftVersionId,
        draftRevisionGoal: draftRevision.goal,
      } : {}),
      promptIncluded: false,
      promptHashIncluded: false,
      sourceContextHashIncluded: false,
      credentialFingerprintIncluded: false,
      providerRequest: false,
      outputStored: false,
      usageRecorded: false,
      settlement: false,
      routingAvailable: false,
      execution: false,
      draftMutationAuthority: false,
      publishingAuthority: false,
    };
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        ${eventType}, 'workspace_ai_text_invocation_intent', ${intentId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditTextInvocationAttempt(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    attemptId: string,
    provider: string,
    status: string,
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        ${`ai.text_invocation_attempt_${status}`},
        'workspace_ai_text_invocation_attempt', ${attemptId},
        ${transaction.json({
          provider, status, promptIncluded: false, outputIncluded: false,
          privateHashesIncluded: false, credentialIncluded: false,
          usageRecorded: false, settlement: false, retryAllowed: false,
          routingAvailable: false,
        } as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditTextOutputArtifact(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    artifactId: string,
    provider: string,
    status: "pending_review" | "accepted" | "discarded",
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        ${`ai.text_output_${status}`}, 'workspace_ai_text_output_artifact',
        ${artifactId}, ${transaction.json({
          provider, status, outputIncluded: false, outputHashIncluded: false,
          ciphertextIncluded: false, publishingAuthorized: false,
          execution: false,
        } as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditTextInvocationReconciliation(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    reconciliationId: string,
    provider: string,
    status: "settled" | "quarantined",
    reason?: "missing_usage" | "unsupported_rate_card" | "cost_exceeds_authorization",
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        ${`ai.text_invocation_reconciliation_${status}`},
        'workspace_ai_text_invocation_reconciliation', ${reconciliationId},
        ${transaction.json({
          provider, status, reason, usageRecorded: status === "settled",
          reservationSettled: status === "settled", outputIncluded: false,
          privateHashesIncluded: false, retryAllowed: false,
        } as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }

  private async auditTextDraftProposal(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    proposalId: string,
    provider: string,
    status: "attached" | "applied" | "dismissed",
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        ${`ai.text_draft_proposal_${status}`},
        'workspace_ai_text_draft_proposal', ${proposalId},
        ${transaction.json({
          provider, status, outputIncluded: false, ciphertextIncluded: false,
          draftContentMutated: status === "applied", publishingAuthorized: false,
          execution: false,
        } as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }
}

async function recordProviderCircuitOutcome(
  transaction: TransactionSql,
  workspaceId: string,
  provider: string,
  attemptId: string,
  outcome: "succeeded" | "credential_unavailable" | "provider_outcome_unknown" | "claim_abandoned" | "evidence_changed",
  actorUserId: string,
  asOf: Date,
) {
  if (outcome === "evidence_changed") return;
  const rows = await transaction<{
    state: "closed" | "open";
    consecutiveUnsafeOutcomes: number;
    openedAt?: Date | string | null;
    openedByAttemptId?: string | null;
  }[]>`
    SELECT state, consecutive_unsafe_outcomes, opened_at, opened_by_attempt_id
    FROM workspace_ai_provider_circuit
    WHERE workspace_id = ${workspaceId} AND provider = ${provider}
    FOR UPDATE
  `;
  const current = rows[0];
  if (outcome === "succeeded") {
    await transaction`
      INSERT INTO workspace_ai_provider_circuit (
        workspace_id, provider, state, consecutive_unsafe_outcomes,
        last_failure_code, last_outcome_at, opened_at, opened_by_attempt_id,
        reset_by, reset_note, reset_at, created_at, updated_at
      ) VALUES (${workspaceId}, ${provider}, 'closed', 0, NULL, ${asOf},
        NULL, NULL, NULL, NULL, NULL, ${asOf}, ${asOf})
      ON CONFLICT (workspace_id, provider) DO UPDATE SET
        state = 'closed', consecutive_unsafe_outcomes = 0,
        last_failure_code = NULL, last_outcome_at = EXCLUDED.last_outcome_at,
        opened_at = NULL, opened_by_attempt_id = NULL,
        reset_by = NULL, reset_note = NULL, reset_at = NULL,
        updated_at = EXCLUDED.updated_at
    `;
    return;
  }
  const consecutiveUnsafeOutcomes = (current?.consecutiveUnsafeOutcomes ?? 0) + 1;
  const opens = current?.state === "open" || outcome === "credential_unavailable" ||
    consecutiveUnsafeOutcomes >= AI_PROVIDER_CIRCUIT_FAILURE_THRESHOLD;
  const openedAt = current?.state === "open" && current.openedAt
    ? new Date(current.openedAt)
    : opens ? asOf : undefined;
  const openedByAttemptId = current?.state === "open" && current.openedByAttemptId
    ? current.openedByAttemptId
    : opens ? attemptId : undefined;
  await transaction`
    INSERT INTO workspace_ai_provider_circuit (
      workspace_id, provider, state, consecutive_unsafe_outcomes,
      last_failure_code, last_outcome_at, opened_at, opened_by_attempt_id,
      reset_by, reset_note, reset_at, created_at, updated_at
    ) VALUES (${workspaceId}, ${provider}, ${opens ? "open" : "closed"},
      ${consecutiveUnsafeOutcomes}, ${outcome}, ${asOf}, ${openedAt ?? null},
      ${openedByAttemptId ?? null}, NULL, NULL, NULL, ${asOf}, ${asOf})
    ON CONFLICT (workspace_id, provider) DO UPDATE SET
      state = EXCLUDED.state,
      consecutive_unsafe_outcomes = EXCLUDED.consecutive_unsafe_outcomes,
      last_failure_code = EXCLUDED.last_failure_code,
      last_outcome_at = EXCLUDED.last_outcome_at,
      opened_at = EXCLUDED.opened_at,
      opened_by_attempt_id = EXCLUDED.opened_by_attempt_id,
      reset_by = NULL, reset_note = NULL, reset_at = NULL,
      updated_at = EXCLUDED.updated_at
  `;
  if (opens && current?.state !== "open") {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        'ai.provider_circuit_opened', 'workspace_ai_provider_circuit', ${provider},
        ${transaction.json({
          provider,
          failureCode: outcome,
          consecutiveUnsafeOutcomes,
          threshold: AI_PROVIDER_CIRCUIT_FAILURE_THRESHOLD,
          openedByAttemptId: attemptId,
        } as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }
}

function validateExecutionControl(input: AiWorkspaceExecutionControlWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!input.reason || input.reason.trim() !== input.reason || input.reason.length < 3 || input.reason.length > 500)
    issues.push({ field: "reason", message: "Provide a trimmed reason from 3 through 500 characters." });
  if (input.state === "enabled") {
    if (!Number.isInteger(input.enabledForMinutes) || input.enabledForMinutes! < 1 ||
      input.enabledForMinutes! > AI_EXECUTION_ENABLEMENT_MAX_MINUTES)
      issues.push({
        field: "enabledForMinutes",
        message: `Enablement must last from 1 through ${AI_EXECUTION_ENABLEMENT_MAX_MINUTES} minutes.`,
      });
  } else if (input.state !== "stopped" || input.enabledForMinutes !== undefined) {
    issues.push({ field: "state", message: "Stopped execution cannot carry an enablement duration." });
  }
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateProviderCircuitReset(input: AiWorkspaceProviderCircuitResetWrite) {
  const supported = AI_HOSTED_PROVIDER_TYPES.includes(input.provider);
  if (!supported || !input.resetNote || input.resetNote.trim() !== input.resetNote ||
    input.resetNote.length < 3 || input.resetNote.length > 500)
    throw new AiPolicyValidationError([{
      field: supported ? "resetNote" : "provider",
      message: supported
        ? "Provide a trimmed reset note from 3 through 500 characters."
        : "Choose a supported hosted provider.",
    }]);
}

function validatePolicy(input: WorkspaceAiPolicyWrite) {
  const thresholds = [...input.alertThresholdPercentages];
  const issues: { field: string; message: string }[] = [];
  if (
    thresholds.length < 1 ||
    thresholds.length > 5 ||
    thresholds.some((value) => !Number.isInteger(value) || value < 1 || value > 100) ||
    new Set(thresholds).size !== thresholds.length ||
    thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1]!)
  )
    issues.push({
      field: "alertThresholdPercentages",
      message: "Use one to five unique, ascending percentages from 1 through 100.",
    });
  if (!/^[A-Z]{3}$/.test(input.currency))
    issues.push({ field: "currency", message: "Currency must be a three-letter uppercase code." });
  for (const [field, value] of [
    ["dailyBudgetMinor", input.dailyBudgetMinor],
    ["campaignBudgetMinor", input.campaignBudgetMinor],
    ["monthlyBudgetMinor", input.monthlyBudgetMinor],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 1_000_000_000))
      issues.push({ field, message: "Budget must be between 1 and 1,000,000,000 minor currency units." });
  }
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateAssistantAssignments(
  input: WorkspaceAiAssistantAssignmentsWrite,
) {
  const issues: { field: string; message: string }[] = [];
  if (input.assignments.length > AI_ASSISTANT_ACTIONS.length)
    issues.push({
      field: "assignments",
      message: "At most one assistant assignment may be stored per action.",
    });
  const seen = new Set<string>();
  for (const assignment of input.assignments) {
    if (
      !AI_ASSISTANT_ACTIONS.includes(
        assignment.action as (typeof AI_ASSISTANT_ACTIONS)[number],
      ) ||
      !AI_ASSISTANT_PROFILE_IDS.includes(
        assignment.profileId as (typeof AI_ASSISTANT_PROFILE_IDS)[number],
      )
    ) {
      issues.push({
        field: "assignments",
        message: "Assistant assignments must use closed action and profile IDs.",
      });
      continue;
    }
    if (seen.has(assignment.action))
      issues.push({
        field: "assignments",
        message: "Each action may appear only once.",
      });
    seen.add(assignment.action);
    if (!isAiAssistantCompatible(assignment.action, assignment.profileId))
      issues.push({
        field: "assignments",
        message: `${assignment.profileId} is not compatible with ${assignment.action}.`,
      });
  }
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateRoutingPreferences(
  input: WorkspaceAiRoutingPreferencesWrite,
  adapters: readonly StoredAiProviderAdapter[],
) {
  const issues: { field: string; message: string }[] = [];
  if (input.preferences.length > AI_ASSISTANT_ACTIONS.length)
    issues.push({
      field: "preferences",
      message: "At most one processing-route preference may be stored per action.",
    });
  const seen = new Set<string>();
  for (const preference of input.preferences) {
    if (
      !AI_ASSISTANT_ACTIONS.includes(
        preference.action as (typeof AI_ASSISTANT_ACTIONS)[number],
      ) ||
      !preference.provider.trim() ||
      preference.provider !== preference.provider.trim() ||
      preference.provider.length > 100 ||
      !preference.model.trim() ||
      preference.model !== preference.model.trim() ||
      preference.model.length > 100
    ) {
      issues.push({
        field: "preferences",
        message: "Route preferences require a closed action and trimmed provider/model identity through 100 characters.",
      });
      continue;
    }
    if (seen.has(preference.action))
      issues.push({
        field: "preferences",
        message: "Each action may appear only once.",
      });
    seen.add(preference.action);
    if (
      !isAiRoutingPreferenceCompatible(
        preference.action,
        preference,
        adapters,
      )
    )
      issues.push({
        field: "preferences",
        message: `${preference.provider}/${preference.model} is not an approved compatible route for ${preference.action}.`,
      });
  }
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateAnalysisCacheKey(input: AiAnalysisCacheKey) {
  const issues: { field: string; message: string }[] = [];
  if (!AI_CAPABILITIES.includes(input.capability))
    issues.push({ field: "capability", message: "Use a supported AI capability." });
  for (const [field, value, maximum] of [
    ["feature", input.feature, 100],
    ["modelFamily", input.modelFamily, 100],
    ["promptVersion", input.promptVersion, 100],
    ["contextRevision", input.contextRevision, 200],
  ] as const) {
    if (!value.trim() || value !== value.trim() || value.length > maximum)
      issues.push({
        field,
        message: `${field} must contain 1 to ${maximum} trimmed characters.`,
      });
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash))
    issues.push({
      field: "contentHash",
      message: "Content hash must be a lowercase SHA-256 digest.",
    });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateCostQuoteWrite(input: AiCostQuoteWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!AI_CAPABILITIES.includes(input.capability))
    issues.push({ field: "capability", message: "Use a supported AI capability." });
  if (!input.feature.trim() || input.feature !== input.feature.trim() || input.feature.length > 100)
    issues.push({ field: "feature", message: "Feature must contain 1 to 100 trimmed characters." });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.rateCardId))
    issues.push({ field: "rateCardId", message: "Rate card ID must be a UUID." });
  if (input.forecasts.length > 12)
    issues.push({ field: "forecasts", message: "At most twelve usage forecasts are allowed." });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function costQuoteHash(
  workspaceId: string,
  campaignId: string | undefined,
  capability: AiCostQuoteWrite["capability"],
  feature: string,
  forecasts: readonly AiUsageQuantityForecast[],
  quote: AiCostQuote,
) {
  const evidence = normalizeCacheJson({
    workspaceId,
    campaignId: campaignId ?? null,
    capability,
    feature,
    forecasts,
    quote: {
      rateCardId: quote.rateCardId,
      provider: quote.provider,
      modelFamily: quote.modelFamily,
      modelVersion: quote.modelVersion,
      currency: quote.currency,
      minorUnitExponent: quote.minorUnitExponent,
      lines: quote.lines,
      minimumCostMinor: quote.minimumCostMinor,
      maximumCostMinor: quote.maximumCostMinor,
      quotedAt: quote.quotedAt,
      expiresAt: quote.expiresAt,
      rounding: quote.rounding,
      reservationRequired: quote.reservationRequired,
      reservationAuthorized: false,
      execution: false,
    },
  });
  return createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");
}

async function selectProviderRateCard(
  sql: DatabaseClient | TransactionSql,
  rateCardId: string,
  asOf: Date,
): Promise<StoredAiProviderRateCard | undefined> {
  const rows = await sql<StoredAiProviderRateCard[]>`
    SELECT r.id, r.provider, r.model_family, r.model_version, r.currency,
      r.minor_unit_exponent, r.status, r.effective_from, r.effective_to,
      r.source_reference, r.source_hash, r.verified_at, r.approved_at,
      r.created_at,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kind', c.kind, 'unit', c.unit,
            'unitQuantity', c.unit_quantity,
            'priceMicros', c.price_micros::double precision
          ) ORDER BY c.kind, c.unit
        ) FILTER (WHERE c.rate_card_id IS NOT NULL),
        '[]'::jsonb
      ) AS components
    FROM ai_provider_rate_card r
    LEFT JOIN ai_provider_rate_component c ON c.rate_card_id = r.id
    WHERE r.id = ${rateCardId} AND r.status = 'approved'
      AND r.effective_from <= ${asOf}
      AND (r.effective_to IS NULL OR r.effective_to > ${asOf})
    GROUP BY r.id
  `;
  return rows[0] ? normalizeProviderRateCard(rows[0]) : undefined;
}

function normalizeCacheJson(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): JSONValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw invalidCacheResult();
  }
  if (typeof value !== "object") throw invalidCacheResult();
  if (seen.has(value)) throw invalidCacheResult();
  seen.add(value);
  try {
    if (Array.isArray(value))
      return value.map((item) => normalizeCacheJson(item, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw invalidCacheResult();
    const result: Record<string, JSONValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) throw invalidCacheResult();
      result[key] = normalizeCacheJson(child, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function invalidCacheResult() {
  return new AiPolicyValidationError([
    {
      field: "result",
      message: "Cached analysis must contain finite, acyclic JSON values only.",
    },
  ]);
}

function validateUsage(input: AiUsageEventWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!input.feature.trim() || input.feature.length > 100)
    issues.push({ field: "feature", message: "Feature must contain 1 to 100 characters." });
  if (!input.provider.trim() || input.provider.length > 100)
    issues.push({ field: "provider", message: "Provider must contain 1 to 100 characters." });
  if (!input.model.trim() || input.model.length > 200)
    issues.push({ field: "model", message: "Model must contain 1 to 200 characters." });
  if (!/^[A-Z]{3}$/.test(input.currency))
    issues.push({ field: "currency", message: "Currency must be a three-letter uppercase code." });
  for (const [field, value] of [
    ["inputUnits", input.inputUnits],
    ["outputUnits", input.outputUnits],
    ["cachedInputUnits", input.cachedInputUnits],
    ["latencyMs", input.latencyMs],
    ["estimatedCostMinor", input.estimatedCostMinor],
  ] as const) {
    if (!Number.isInteger(value) || value < 0)
      issues.push({ field, message: "Usage values must be non-negative integers." });
  }
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateReservation(input: AiSpendReservationWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey))
    issues.push({ field: "idempotencyKey", message: "Idempotency key must be a UUID." });
  if (!input.feature.trim() || input.feature.length > 100)
    issues.push({ field: "feature", message: "Feature must contain 1 to 100 characters." });
  if (!/^[A-Z]{3}$/.test(input.currency))
    issues.push({ field: "currency", message: "Currency must be a three-letter uppercase code." });
  if (!Number.isInteger(input.estimatedCostMinor) || input.estimatedCostMinor < 1 || input.estimatedCostMinor > 1_000_000_000)
    issues.push({ field: "estimatedCostMinor", message: "Estimated cost must be a positive bounded integer." });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateTextInvocationIntent(input: AiTextInvocationIntentWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!isUuid(input.invocationBindingId) || !isUuid(input.reservationId) ||
    !isUuid(input.idempotencyKey))
    issues.push({ field: "idempotencyKey", message: "Binding, reservation, and idempotency IDs must be UUIDs." });
  if (!input.userText || input.userText.length > AI_TEXT_CODEC_LIMITS.userTextCharacters)
    issues.push({ field: "userText", message: `User text must contain 1-${AI_TEXT_CODEC_LIMITS.userTextCharacters} characters.` });
  if (input.systemText !== undefined &&
    (!input.systemText || input.systemText.length > AI_TEXT_CODEC_LIMITS.systemTextCharacters))
    issues.push({ field: "systemText", message: `System text must contain 1-${AI_TEXT_CODEC_LIMITS.systemTextCharacters} characters when provided.` });
  if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 ||
    input.maxOutputTokens > AI_TEXT_CODEC_LIMITS.maxOutputTokens)
    issues.push({ field: "maxOutputTokens", message: `Maximum output tokens must be 1-${AI_TEXT_CODEC_LIMITS.maxOutputTokens}.` });
  if (input.draftRevision && (
    !isUuid(input.draftRevision.contentDraftId) ||
    !isUuid(input.draftRevision.contentDraftVersionId) ||
    !AI_DRAFT_REVISION_GOALS.includes(input.draftRevision.goal) ||
    !(AI_DRAFT_REVISION_PROMPT_VERSIONS as readonly string[]).includes(input.draftRevision.promptVersion) ||
    !/^[0-9a-f]{64}$/.test(input.draftRevision.contextSha256)
  )) issues.push({
    field: "contentDraftId",
    message: "Draft revision source evidence is incomplete or unsupported.",
  });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateDraftRevisionIntent(input: AiDraftRevisionIntentWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!isUuid(input.contentDraftId))
    issues.push({ field: "contentDraftId", message: "Choose an editable governed Draft." });
  if (!isUuid(input.invocationBindingId) || !isUuid(input.reservationId) ||
    !isUuid(input.idempotencyKey))
    issues.push({ field: "idempotencyKey", message: "Binding, reservation, and idempotency IDs must be UUIDs." });
  if (!AI_DRAFT_REVISION_GOALS.includes(input.goal))
    issues.push({ field: "goal", message: "Choose a supported Draft revision goal." });
  if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 ||
    input.maxOutputTokens > AI_TEXT_CODEC_LIMITS.maxOutputTokens)
    issues.push({ field: "maxOutputTokens", message: `Maximum output tokens must be 1-${AI_TEXT_CODEC_LIMITS.maxOutputTokens}.` });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateAttemptClaim(input: AiTextInvocationAttemptClaimWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!isUuid(input.intentId)) issues.push({ field: "intentId", message: "Intent ID must be a UUID." });
  if (!input.userText || input.userText.length > AI_TEXT_CODEC_LIMITS.userTextCharacters)
    issues.push({ field: "userText", message: "User text is outside the provider codec bounds." });
  if (input.systemText !== undefined &&
    (!input.systemText || input.systemText.length > AI_TEXT_CODEC_LIMITS.systemTextCharacters))
    issues.push({ field: "systemText", message: "System text is outside the provider codec bounds." });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateAttemptOutcome(input: AiTextInvocationAttemptOutcomeWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!isUuid(input.attemptId)) issues.push({ field: "attemptId", message: "Attempt ID must be a UUID." });
  if (!/^[0-9a-f]{64}$/.test(input.expectedCredentialFingerprint) ||
    !/^[0-9a-f]{64}$/.test(input.expectedContractSourceHash))
    issues.push({ field: "attemptId", message: "Expected attempt evidence must be SHA-256 values." });
  if (input.outcome.status === "succeeded") {
    if (input.outcome.outputText.length > AI_TEXT_CODEC_LIMITS.responseTextCharacters)
      issues.push({ field: "outputText", message: "Provider output is outside the reviewed text bounds." });
    if (input.outcome.responseId !== undefined &&
      (!input.outcome.responseId || input.outcome.responseId.length > 512))
      issues.push({ field: "responseId", message: "Provider response identity is outside its bound." });
    if (!input.outcome.encryptedOutput.startsWith("v1.") ||
      input.outcome.encryptedOutput.length < 10 || input.outcome.encryptedOutput.length > 800_000)
      issues.push({ field: "encryptedOutput", message: "Encrypted output envelope is outside its bound." });
    if (!Number.isSafeInteger(input.outcome.latencyMs) ||
      input.outcome.latencyMs < 0 || input.outcome.latencyMs > 86_400_000)
      issues.push({ field: "latencyMs", message: "Provider latency must be a bounded non-negative integer." });
    for (const [field, value] of [["inputTokens", input.outcome.inputTokens], ["outputTokens", input.outcome.outputTokens]] as const)
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000))
        issues.push({ field, message: "Token usage must be a bounded non-negative safe integer." });
  } else if (!input.outcome.safeMessage ||
    input.outcome.safeMessage.trim() !== input.outcome.safeMessage ||
    input.outcome.safeMessage.length > 300) {
    issues.push({ field: "safeMessage", message: "Failure message must be trimmed and contain 1-300 characters." });
  }
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateTextInvocationResolution(input: AiTextInvocationResolutionWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!isUuid(input.attemptId))
    issues.push({ field: "attemptId", message: "Attempt ID must be a UUID." });
  if (!input.evidenceReference || input.evidenceReference.trim() !== input.evidenceReference ||
    input.evidenceReference.length < 3 || input.evidenceReference.length > 1_000)
    issues.push({
      field: "evidenceReference",
      message: "Provide a trimmed provider statement, invoice, or incident reference from 3 through 1,000 characters.",
    });
  if (!input.resolutionNote || input.resolutionNote.trim() !== input.resolutionNote ||
    input.resolutionNote.length < 3 || input.resolutionNote.length > 1_000)
    issues.push({
      field: "resolutionNote",
      message: "Provide a trimmed resolution note from 3 through 1,000 characters.",
    });
  if (input.disposition === "settled_provider_charge") {
    if (!Number.isSafeInteger(input.providerChargeMinor) || input.providerChargeMinor! < 1 ||
      input.providerChargeMinor! > 1_000_000_000)
      issues.push({
        field: "providerChargeMinor",
        message: "Confirmed provider charge must be 1 through 1,000,000,000 minor currency units.",
      });
  } else if (input.disposition !== "confirmed_no_charge" || input.providerChargeMinor !== undefined) {
    issues.push({
      field: "disposition",
      message: "No-charge resolution cannot carry a provider charge.",
    });
  }
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateOperationalIncidentAcknowledgement(
  input: AiOperationalIncidentAcknowledgeWrite,
) {
  const issues: { field: string; message: string }[] = [];
  if (!AI_OPERATIONAL_INCIDENT_TYPES.includes(input.type))
    issues.push({ field: "type", message: "Choose a supported AI operational incident type." });
  if (!isUuid(input.attemptId))
    issues.push({ field: "attemptId", message: "Attempt ID must be a UUID." });
  if (!input.acknowledgementNote ||
    input.acknowledgementNote.trim() !== input.acknowledgementNote ||
    input.acknowledgementNote.length < 3 ||
    input.acknowledgementNote.length > 1_000)
    issues.push({
      field: "acknowledgementNote",
      message: "Provide a trimmed acknowledgement note from 3 through 1,000 characters.",
    });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateOperationalIncidentResponsePolicy(
  input: AiOperationalIncidentResponsePolicyWrite,
) {
  const issues: { field: string; message: string }[] = [];
  for (const [field, value, minimum, maximum] of [
    ["criticalAcknowledgementMinutes", input.criticalAcknowledgementMinutes, 1, 60],
    ["highAcknowledgementMinutes", input.highAcknowledgementMinutes, 1, 1_440],
    ["criticalResolutionMinutes", input.criticalResolutionMinutes, 5, 10_080],
    ["highResolutionMinutes", input.highResolutionMinutes, 5, 43_200],
  ] as const)
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      issues.push({
        field,
        message: `Use an integer from ${minimum} through ${maximum} minutes.`,
      });
  if (input.criticalResolutionMinutes < input.criticalAcknowledgementMinutes)
    issues.push({
      field: "criticalResolutionMinutes",
      message: "Critical resolution target cannot precede its acknowledgement target.",
    });
  if (input.highResolutionMinutes < input.highAcknowledgementMinutes)
    issues.push({
      field: "highResolutionMinutes",
      message: "High-severity resolution target cannot precede its acknowledgement target.",
    });
  let runbookValid = false;
  try {
    const url = new URL(input.runbookUrl);
    runbookValid = url.protocol === "https:" && !url.username && !url.password &&
      input.runbookUrl === input.runbookUrl.trim() && input.runbookUrl.length <= 2_000;
  } catch {
    runbookValid = false;
  }
  if (!runbookValid)
    issues.push({
      field: "runbookUrl",
      message: "Provide a credential-free HTTPS runbook URL of at most 2,000 characters.",
    });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateTextDraftProposalApplication(input: AiTextDraftProposalApplyWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!isUuid(input.proposalId))
    issues.push({ field: "proposalId", message: "Draft proposal was not found." });
  if (input.leadIn.trim() !== input.leadIn || input.leadIn.length > 500 || /[.!?]/u.test(input.leadIn))
    issues.push({
      field: "leadIn",
      message: "Use a trimmed presentation lead-in of at most 500 characters without sentence punctuation.",
    });
  if (input.callToAction !== undefined && (
    input.callToAction.length < 1 || input.callToAction.length > 1_000 ||
    input.callToAction.trim() !== input.callToAction
  ))
    issues.push({
      field: "callToAction",
      message: "Use a trimmed call to action of at most 1,000 characters, or omit it.",
    });
  if (input.hashtags.length > 20 ||
    new Set(input.hashtags.map((tag) => tag.toLocaleLowerCase())).size !== input.hashtags.length ||
    input.hashtags.some((tag) => !/^#[\p{L}\p{N}_]{1,50}$/u.test(tag)))
    issues.push({
      field: "hashtags",
      message: "Use at most 20 unique hashtags containing only letters, numbers, or underscores.",
    });
  if (input.altText !== undefined && (
    input.altText.length < 1 || input.altText.length > 2_000 ||
    input.altText.trim() !== input.altText
  ))
    issues.push({
      field: "altText",
      message: "Use trimmed alternative text of at most 2,000 characters, or omit it.",
    });
  if (input.changeNote.length < 3 || input.changeNote.length > 1_000 ||
    input.changeNote.trim() !== input.changeNote)
    issues.push({
      field: "changeNote",
      message: "Provide a trimmed change note from 3 through 1,000 characters.",
    });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function defaultPolicy(
  workspaceId: string,
  actorUserId: string,
): StoredWorkspaceAiPolicy {
  const createdAt = new Date(0).toISOString();
  return {
    workspaceId,
    mode: "recommended",
    maximumPrivacyClass: "cloud",
    failoverMode: "ask_before_switching",
    capBehavior: "require_approval",
    currency: "USD",
    alertThresholdPercentages: [50, 80, 100],
    createdBy: actorUserId,
    updatedBy: actorUserId,
    createdAt,
    updatedAt: createdAt,
  };
}

function assertSameReservation(
  existing: StoredAiSpendReservation,
  input: AiSpendReservationWrite,
) {
  if (
    existing.campaignId !== input.campaignId ||
    existing.capability !== input.capability ||
    existing.feature !== input.feature ||
    existing.currency !== input.currency ||
    existing.estimatedCostMinor !== input.estimatedCostMinor
  )
    throw new AiPolicyValidationError([
      {
        field: "idempotencyKey",
        message: "Idempotency key is already bound to different spend inputs.",
      },
    ]);
}

async function spendTotals(
  sql: DatabaseClient | TransactionSql,
  workspaceId: string,
  campaignId: string | undefined,
  currency: string,
  asOf: Date,
): Promise<{
  dailySpent: number;
  dailyReserved: number;
  monthlySpent: number;
  monthlyReserved: number;
  campaignSpent: number;
  campaignReserved: number;
}> {
  const dayStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));
  const rows = await sql<
    {
      dailySpent: number;
      dailyReserved: number;
      monthlySpent: number;
      monthlyReserved: number;
      campaignSpent: number;
      campaignReserved: number;
    }[]
  >`
    SELECT
      ((SELECT COALESCE(sum(estimated_cost_minor), 0)
          FROM ai_usage_event WHERE workspace_id = ${workspaceId}
            AND currency = ${currency} AND occurred_at >= ${dayStart}
            AND occurred_at < ${dayEnd}) +
       (SELECT COALESCE(sum(provider_charge_minor), 0)
          FROM workspace_ai_text_invocation_resolution
          WHERE workspace_id = ${workspaceId} AND currency = ${currency}
            AND disposition = 'settled_provider_charge'
            AND resolved_at >= ${dayStart} AND resolved_at < ${dayEnd}))::integer
        AS daily_spent,
      (SELECT COALESCE(sum(estimated_cost_minor), 0)::integer
        FROM ai_spend_reservation WHERE workspace_id = ${workspaceId}
          AND currency = ${currency} AND status = 'reserved'
          AND expires_at > ${asOf}) AS daily_reserved,
      ((SELECT COALESCE(sum(estimated_cost_minor), 0)
          FROM ai_usage_event WHERE workspace_id = ${workspaceId}
            AND currency = ${currency} AND occurred_at >= ${monthStart}
            AND occurred_at < ${monthEnd}) +
       (SELECT COALESCE(sum(provider_charge_minor), 0)
          FROM workspace_ai_text_invocation_resolution
          WHERE workspace_id = ${workspaceId} AND currency = ${currency}
            AND disposition = 'settled_provider_charge'
            AND resolved_at >= ${monthStart} AND resolved_at < ${monthEnd}))::integer
        AS monthly_spent,
      (SELECT COALESCE(sum(estimated_cost_minor), 0)::integer
        FROM ai_spend_reservation WHERE workspace_id = ${workspaceId}
          AND currency = ${currency} AND status = 'reserved'
          AND expires_at > ${asOf}) AS monthly_reserved,
      ((SELECT COALESCE(sum(estimated_cost_minor), 0)
          FROM ai_usage_event WHERE workspace_id = ${workspaceId}
            AND currency = ${currency} AND campaign_id = ${campaignId ?? null}) +
       (SELECT COALESCE(sum(resolution.provider_charge_minor), 0)
          FROM workspace_ai_text_invocation_resolution resolution
          JOIN ai_spend_reservation reservation
            ON reservation.id = resolution.reservation_id
          WHERE resolution.workspace_id = ${workspaceId}
            AND resolution.currency = ${currency}
            AND resolution.disposition = 'settled_provider_charge'
            AND reservation.campaign_id = ${campaignId ?? null}))::integer
        AS campaign_spent,
      (SELECT COALESCE(sum(estimated_cost_minor), 0)::integer
        FROM ai_spend_reservation WHERE workspace_id = ${workspaceId}
          AND currency = ${currency} AND campaign_id = ${campaignId ?? null}
          AND status = 'reserved' AND expires_at > ${asOf})
        AS campaign_reserved
  `;
  return rows[0]!;
}

function scopeStatus(
  scope: AiBudgetScope,
  spentMinor: number,
  reservedMinor: number,
  capMinor?: number,
) {
  return {
    scope,
    spentMinor,
    reservedMinor,
    ...(capMinor === undefined
      ? {}
      : {
          capMinor,
          availableMinor: Math.max(0, capMinor - spentMinor - reservedMinor),
        }),
  };
}

async function markReservation(
  transaction: TransactionSql,
  workspaceId: string,
  reservationId: string,
  status: "settled" | "released" | "expired",
  actorUserId: string,
  asOf: Date,
  actualCostMinor?: number,
): Promise<StoredAiSpendReservation> {
  const rows = await transaction<StoredAiSpendReservation[]>`
    UPDATE ai_spend_reservation
    SET status = ${status}, actual_cost_minor = ${actualCostMinor ?? null},
      resolved_by = ${actorUserId}, resolved_at = ${asOf}, updated_at = ${asOf}
    WHERE workspace_id = ${workspaceId} AND id = ${reservationId}
    RETURNING id, workspace_id, campaign_id, spend_exception_request_id,
      cost_quote_id, capability, feature, currency,
      estimated_cost_minor, actual_cost_minor, status, exceeded_scopes,
      cap_behavior, requested_by, resolved_by, expires_at, resolved_at,
      created_at, updated_at
  `;
  return normalizeReservation(rows[0]!, asOf);
}

function normalizeReservation(
  reservation: StoredAiSpendReservation,
  asOf: Date = new Date(),
): StoredAiSpendReservation {
  const expiresAt = reservation.expiresAt
    ? new Date(reservation.expiresAt).toISOString()
    : undefined;
  const appearsExpired =
    reservation.status === "reserved" &&
    expiresAt !== undefined &&
    new Date(expiresAt) <= asOf;
  return {
    ...reservation,
    campaignId: reservation.campaignId ?? undefined,
    spendExceptionRequestId: reservation.spendExceptionRequestId ?? undefined,
    costQuoteId: reservation.costQuoteId ?? undefined,
    actualCostMinor: reservation.actualCostMinor ?? undefined,
    status: appearsExpired ? "expired" : reservation.status,
    exceededScopes: reservation.exceededScopes ?? [],
    resolvedBy: reservation.resolvedBy ?? undefined,
    expiresAt,
    resolvedAt: appearsExpired
      ? expiresAt
      : reservation.resolvedAt
        ? new Date(reservation.resolvedAt).toISOString()
        : undefined,
    createdAt: new Date(reservation.createdAt).toISOString(),
    updatedAt: new Date(reservation.updatedAt).toISOString(),
  };
}

function normalizePolicy(policy: StoredWorkspaceAiPolicy): StoredWorkspaceAiPolicy {
  return {
    ...policy,
    dailyBudgetMinor: policy.dailyBudgetMinor ?? undefined,
    campaignBudgetMinor: policy.campaignBudgetMinor ?? undefined,
    monthlyBudgetMinor: policy.monthlyBudgetMinor ?? undefined,
    alertThresholdPercentages: policy.alertThresholdPercentages.map(Number),
    createdAt: new Date(policy.createdAt).toISOString(),
    updatedAt: new Date(policy.updatedAt).toISOString(),
  };
}

function normalizeAssistantAssignment(
  assignment: StoredAiAssistantAssignment,
): StoredAiAssistantAssignment {
  return {
    ...assignment,
    createdAt: new Date(assignment.createdAt).toISOString(),
    updatedAt: new Date(assignment.updatedAt).toISOString(),
  };
}

function normalizeRoutingPreference(
  preference: StoredAiRoutingPreference,
): StoredAiRoutingPreference {
  return {
    ...preference,
    createdAt: new Date(preference.createdAt).toISOString(),
    updatedAt: new Date(preference.updatedAt).toISOString(),
  };
}

async function selectProviderAdapters(
  client: DatabaseClient | TransactionSql,
): Promise<StoredAiProviderAdapter[]> {
  const rows = await client<StoredAiProviderAdapter[]>`
    SELECT a.provider, a.model, a.display_name, a.privacy_class,
      a.quality, a.speed, a.cost, a.context_limit,
      a.is_available AS available, a.is_approved AS approved,
      a.requires_paid_reservation, a.availability_reason,
      a.configuration_source, a.verified_at, a.created_at, a.updated_at,
      COALESCE(
        array_agg(c.capability ORDER BY c.capability)
          FILTER (WHERE c.capability IS NOT NULL),
        ARRAY[]::text[]
      ) AS capabilities
    FROM ai_provider_adapter a
    LEFT JOIN ai_provider_adapter_capability c
      ON c.provider = a.provider AND c.model = a.model
    GROUP BY a.provider, a.model
    ORDER BY a.provider, a.model
  `;
  return rows.map(({ availabilityReason, ...adapter }) => ({
    ...adapter,
    capabilities: [...adapter.capabilities],
    ...(availabilityReason
      ? { availabilityReason }
      : {}),
    verifiedAt: new Date(adapter.verifiedAt).toISOString(),
    createdAt: new Date(adapter.createdAt).toISOString(),
    updatedAt: new Date(adapter.updatedAt).toISOString(),
  }));
}

async function selectProviderConnections(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<StoredAiProviderConnection[]> {
  const rows = await client<StoredAiProviderConnection[]>`
    SELECT workspace_id, provider, status,
      (encrypted_credential IS NOT NULL) AS credential_configured,
      last_error, verified_at, revoked_at,
      created_by AS created_by_user_id, updated_by AS updated_by_user_id,
      created_at, updated_at, false AS execution
    FROM workspace_ai_provider_connection
    WHERE workspace_id = ${workspaceId}
    ORDER BY provider
  `;
  return rows.map(
    ({ lastError, verifiedAt, revokedAt, ...connection }) => ({
      ...connection,
      ...(lastError ? { lastError } : {}),
      ...(verifiedAt
        ? { verifiedAt: new Date(verifiedAt).toISOString() }
        : {}),
      ...(revokedAt
        ? { revokedAt: new Date(revokedAt).toISOString() }
        : {}),
      createdAt: new Date(connection.createdAt).toISOString(),
      updatedAt: new Date(connection.updatedAt).toISOString(),
      execution: false,
    }),
  );
}

function validateProviderConnectionSecret(
  input: AiProviderConnectionSecretWrite,
) {
  const issues: { field: string; message: string }[] = [];
  if (!AI_HOSTED_PROVIDER_TYPES.includes(input.provider))
    issues.push({ field: "provider", message: "Choose a supported hosted provider." });
  if (
    input.encryptedCredential.length < 20 ||
    input.encryptedCredential.length > 4096 ||
    !input.encryptedCredential.startsWith("v1.")
  )
    issues.push({ field: "credential", message: "Use a supported encrypted credential envelope." });
  if (!/^[0-9a-f]{64}$/.test(input.credentialFingerprint))
    issues.push({ field: "credential", message: "Credential fingerprint must be SHA-256." });
  if (input.encryptionKeyVersion !== "v1")
    issues.push({ field: "credential", message: "Use the supported credential-key version." });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateProviderConnectionVerification(
  input: AiProviderConnectionVerificationWrite,
) {
  const issues: { field: string; message: string }[] = [];
  if (!AI_HOSTED_PROVIDER_TYPES.includes(input.provider))
    issues.push({ field: "provider", message: "Choose a supported hosted provider." });
  if (!/^[0-9a-f]{64}$/.test(input.expectedCredentialFingerprint))
    issues.push({ field: "credential", message: "Credential fingerprint must be SHA-256." });
  if (input.status === "verified" && input.lastError !== undefined)
    issues.push({ field: "lastError", message: "A verified connection cannot retain an error." });
  if (
    input.status === "error" &&
    (!input.lastError ||
      input.lastError.trim() !== input.lastError ||
      input.lastError.length > 500)
  )
    issues.push({ field: "lastError", message: "A safe verification error is required." });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateProviderModelDiscovery(input: AiProviderModelDiscoveryWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!AI_HOSTED_PROVIDER_TYPES.includes(input.provider))
    issues.push({ field: "provider", message: "Choose a supported hosted provider." });
  if (!/^[0-9a-f]{64}$/.test(input.expectedCredentialFingerprint))
    issues.push({ field: "credential", message: "Credential fingerprint must be SHA-256." });
  if (input.models.length < 1 || input.models.length > 1000)
    issues.push({ field: "models", message: "Discover between one and 1,000 models." });
  const seen = new Set<string>();
  input.models.forEach((model, index) => {
    if (
      model.modelId.length < 1 ||
      model.modelId.length > 512 ||
      model.modelId.trim() !== model.modelId
    )
      issues.push({ field: `models.${index}.modelId`, message: "Use a bounded trimmed model identifier." });
    if (seen.has(model.modelId))
      issues.push({ field: `models.${index}.modelId`, message: "Model identifiers must be unique." });
    seen.add(model.modelId);
    if (
      model.displayName !== undefined &&
      (model.displayName.length < 1 ||
        model.displayName.length > 200 ||
        model.displayName.trim() !== model.displayName)
    )
      issues.push({ field: `models.${index}.displayName`, message: "Use a bounded trimmed display name." });
    for (const [field, value] of [
      ["inputTokenLimit", model.inputTokenLimit],
      ["outputTokenLimit", model.outputTokenLimit],
    ] as const)
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 100_000_000))
        issues.push({ field: `models.${index}.${field}`, message: "Token limits must be safe positive integers." });
    if (
      model.providerCreatedAt !== undefined &&
      Number.isNaN(Date.parse(model.providerCreatedAt))
    )
      issues.push({ field: `models.${index}.providerCreatedAt`, message: "Provider creation time must be ISO-compatible." });
  });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateWorkspaceAdapterCandidate(input: AiWorkspaceAdapterCandidateWrite) {
  const issues: { field: string; message: string }[] = [];
  if (!AI_HOSTED_PROVIDER_TYPES.includes(input.provider))
    issues.push({ field: "provider", message: "Choose a supported hosted provider." });
  if (input.modelId.length < 1 || input.modelId.length > 512 || input.modelId.trim() !== input.modelId)
    issues.push({ field: "modelId", message: "Choose a bounded discovered model identifier." });
  if (input.displayName.length < 1 || input.displayName.length > 160 || input.displayName.trim() !== input.displayName)
    issues.push({ field: "displayName", message: "Provide a bounded trimmed display name." });
  if (input.capabilities.length < 1 || input.capabilities.length > AI_CAPABILITIES.length || new Set(input.capabilities).size !== input.capabilities.length || input.capabilities.some((value) => !AI_CAPABILITIES.includes(value)))
    issues.push({ field: "capabilities", message: "Choose a unique nonempty set of gateway capabilities." });
  if (!Number.isInteger(input.contextLimit) || input.contextLimit < 1 || input.contextLimit > 2_000_000)
    issues.push({ field: "contextLimit", message: "Context limit must be a safe positive integer." });
  if (input.evidenceReference.length < 1 || input.evidenceReference.length > 1000 || input.evidenceReference.trim() !== input.evidenceReference)
    issues.push({ field: "evidenceReference", message: "Provide a bounded trimmed evidence reference." });
  if (!/^[0-9a-f]{64}$/.test(input.evidenceSha256))
    issues.push({ field: "evidenceSha256", message: "Evidence hash must be lowercase SHA-256." });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

async function auditAdapterCandidate(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  candidateId: string,
  provider: string,
  action: string,
) {
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      ${`ai.adapter_candidate_${action}`}, 'workspace_ai_adapter_candidate',
      ${candidateId}, ${transaction.json({
        provider,
        modelIdentifierIncluded: false,
        evidenceIncluded: false,
        credentialFingerprintIncluded: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function auditAdapterCandidatesRetired(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  provider: string,
  count: number,
  reason: "credential_changed" | "credential_revoked" | "model_absent",
) {
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      'ai.adapter_candidates_retired', 'workspace_ai_provider_connection',
      ${provider}, ${transaction.json({
        provider,
        retiredCandidateCount: count,
        reason,
        modelIdentifiersIncluded: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function auditAdapterRegistration(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  registrationId: string,
  provider: string,
  action: "registered" | "retired",
) {
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      ${`ai.adapter_registration_${action}`}, 'workspace_ai_adapter_registration',
      ${registrationId}, ${transaction.json({
        provider,
        modelIdentifierIncluded: false,
        capabilitiesIncluded: false,
        credentialFingerprintIncluded: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function retireWorkspaceAdapterRegistrations(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  provider: string,
  retirementReason: string,
  reason: "credential_changed" | "credential_revoked" | "model_absent",
) {
  const rows = await transaction<{ id: string }[]>`
    UPDATE workspace_ai_adapter_registration r SET
      status = 'retired', retired_by = ${actorUserId},
      retirement_reason = ${retirementReason},
      retired_at = now(), updated_at = now()
    WHERE r.workspace_id = ${workspaceId} AND r.provider = ${provider}
      AND r.status = 'registered'
      AND (
        ${reason} <> 'model_absent' OR EXISTS (
          SELECT 1 FROM workspace_ai_adapter_candidate a
          WHERE a.id = r.candidate_id AND a.status = 'retired'
        )
      )
    RETURNING r.id
  `;
  if (!rows.length) return;
  await retireWorkspaceAdapterRateBindings(
    transaction,
    workspaceId,
    actorUserId,
    provider,
    "Workspace registration retired; pricing binding retired automatically.",
    "registration_retired",
  );
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      'ai.adapter_registrations_retired', 'workspace_ai_provider_connection',
      ${provider}, ${transaction.json({
        provider,
        retiredRegistrationCount: rows.length,
        reason,
        modelIdentifiersIncluded: false,
        capabilitiesIncluded: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function auditAdapterRateBinding(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  bindingId: string,
  provider: string,
  currency: string,
  action: "bound" | "retired",
) {
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      ${`ai.adapter_rate_binding_${action}`}, 'workspace_ai_adapter_rate_binding',
      ${bindingId}, ${transaction.json({
        provider,
        currency,
        modelIdentifierIncluded: false,
        rateCardIdentifierIncluded: false,
        sourceEvidenceIncluded: false,
        credentialFingerprintIncluded: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function auditAdapterInvocationBinding(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  bindingId: string,
  provider: string,
  action: "configured" | "retired",
) {
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      ${`ai.adapter_invocation_binding_${action}`},
      'workspace_ai_adapter_invocation_binding', ${bindingId},
      ${transaction.json({
        provider,
        modelIdentifierIncluded: false,
        contractIdentifierIncluded: false,
        pricingIdentifierIncluded: false,
        sourceEvidenceIncluded: false,
        credentialFingerprintIncluded: false,
        implementationAvailable: true,
        healthReady: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function auditAdapterHealthObservation(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  observationId: string,
  provider: string,
  status: "healthy" | "unhealthy",
) {
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      'ai.adapter_health_observed', 'workspace_ai_adapter_health_observation',
      ${observationId}, ${transaction.json({
        provider,
        status,
        modelIdentifierIncluded: false,
        contractIdentifierIncluded: false,
        pricingIdentifierIncluded: false,
        credentialFingerprintIncluded: false,
        providerResponseIncluded: false,
        generation: false,
        implementationAvailable: true,
        healthReady: status === "healthy",
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function retireWorkspaceAdapterInvocationBindingsForRates(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  provider: string,
  retirementReason: string,
  reason: "pricing_retired" | "registration_retired",
) {
  const rows = await transaction<{ id: string }[]>`
    UPDATE workspace_ai_adapter_invocation_binding ib SET
      status = 'retired', retired_by = ${actorUserId},
      retirement_reason = ${retirementReason},
      retired_at = now(), updated_at = now()
    FROM workspace_ai_adapter_rate_binding rb,
      workspace_ai_adapter_registration r
    WHERE ib.workspace_id = ${workspaceId} AND ib.status = 'configured'
      AND rb.id = ib.rate_binding_id AND rb.status = 'retired'
      AND r.id = ib.registration_id AND r.provider = ${provider}
    RETURNING ib.id
  `;
  if (!rows.length) return;
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      'ai.adapter_invocation_bindings_retired',
      'workspace_ai_provider_connection', ${provider},
      ${transaction.json({
        provider,
        retiredInvocationBindingCount: rows.length,
        reason,
        modelIdentifiersIncluded: false,
        contractIdentifiersIncluded: false,
        pricingIdentifiersIncluded: false,
        sourceEvidenceIncluded: false,
        implementationAvailable: true,
        healthReady: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function retireWorkspaceAdapterRateBindings(
  transaction: TransactionSql,
  workspaceId: string,
  actorUserId: string,
  provider: string,
  retirementReason: string,
  reason: "registration_retired",
) {
  const rows = await transaction<{ id: string }[]>`
    UPDATE workspace_ai_adapter_rate_binding b SET
      status = 'retired', retired_by = ${actorUserId},
      retirement_reason = ${retirementReason},
      retired_at = now(), updated_at = now()
    FROM workspace_ai_adapter_registration r
    WHERE b.workspace_id = ${workspaceId} AND b.status = 'bound'
      AND r.id = b.registration_id AND r.provider = ${provider}
      AND r.status = 'retired'
    RETURNING b.id
  `;
  if (!rows.length) return;
  await retireWorkspaceAdapterInvocationBindingsForRates(
    transaction,
    workspaceId,
    actorUserId,
    provider,
    "Workspace registration retired; invocation configuration retired automatically.",
    "registration_retired",
  );
  await transaction`
    INSERT INTO audit_event (
      id, organization_id, workspace_id, actor_user_id,
      event_type, subject_type, subject_id, data
    )
    SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
      'ai.adapter_rate_bindings_retired', 'workspace_ai_provider_connection',
      ${provider}, ${transaction.json({
        provider,
        retiredBindingCount: rows.length,
        reason,
        modelIdentifiersIncluded: false,
        rateCardIdentifiersIncluded: false,
        sourceEvidenceIncluded: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      } as JSONValue)}
    FROM workspace WHERE id = ${workspaceId}
  `;
}

async function selectWorkspaceAdapterCandidates(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<AiWorkspaceAdapterCandidate[]> {
  const rows = await client<(Omit<AiWorkspaceAdapterCandidate, "capabilities"> & { capabilities: string[] })[]>`
    SELECT a.id, a.workspace_id, a.provider, a.model_id, a.status,
      a.display_name, a.privacy_class, a.quality, a.speed, a.cost,
      a.context_limit, a.requires_paid_reservation,
      a.evidence_reference, a.evidence_sha256,
      a.submitted_by AS submitted_by_user_id,
      a.reviewed_by AS reviewed_by_user_id, a.review_note,
      a.submitted_at, a.reviewed_at, a.retired_at, a.created_at, a.updated_at,
      COALESCE(array_agg(c.capability ORDER BY c.capability)
        FILTER (WHERE c.capability IS NOT NULL), ARRAY[]::text[]) AS capabilities,
      false AS routing_available, false AS adapter_activation, false AS execution
    FROM workspace_ai_adapter_candidate a
    LEFT JOIN workspace_ai_adapter_candidate_capability c ON c.candidate_id = a.id
    WHERE a.workspace_id = ${workspaceId}
    GROUP BY a.id
    ORDER BY a.updated_at DESC, a.id
  `;
  return rows.map(({ reviewedByUserId, reviewNote, reviewedAt, retiredAt, ...row }) => ({
    ...row,
    capabilities: [...row.capabilities] as AiWorkspaceAdapterCandidate["capabilities"],
    ...(reviewedByUserId ? { reviewedByUserId } : {}),
    ...(reviewNote ? { reviewNote } : {}),
    ...(reviewedAt ? { reviewedAt: new Date(reviewedAt).toISOString() } : {}),
    ...(retiredAt ? { retiredAt: new Date(retiredAt).toISOString() } : {}),
    submittedAt: new Date(row.submittedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    routingAvailable: false,
    adapterActivation: false,
    execution: false,
  }));
}

async function selectWorkspaceAdapterRegistrations(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<AiWorkspaceAdapterRegistration[]> {
  const rows = await client<(
    Omit<AiWorkspaceAdapterRegistration, "capabilities"> & { capabilities: string[] }
  )[]>`
    SELECT r.id, r.workspace_id, r.candidate_id, r.provider, r.model_id,
      r.status, r.display_name, r.privacy_class, r.quality, r.speed, r.cost,
      r.context_limit, r.requires_paid_reservation,
      r.registered_by AS registered_by_user_id,
      r.retired_by AS retired_by_user_id, r.retirement_reason,
      r.registered_at, r.retired_at, r.created_at, r.updated_at,
      COALESCE(array_agg(c.capability ORDER BY c.capability)
        FILTER (WHERE c.capability IS NOT NULL), ARRAY[]::text[]) AS capabilities,
      false AS routing_available, false AS adapter_activation, false AS execution
    FROM workspace_ai_adapter_registration r
    LEFT JOIN workspace_ai_adapter_registration_capability c
      ON c.registration_id = r.id
    WHERE r.workspace_id = ${workspaceId}
    GROUP BY r.id
    ORDER BY r.updated_at DESC, r.id
  `;
  return rows.map(({
    retiredByUserId,
    retirementReason,
    retiredAt,
    ...row
  }) => ({
    ...row,
    capabilities: [...row.capabilities] as AiWorkspaceAdapterRegistration["capabilities"],
    ...(retiredByUserId ? { retiredByUserId } : {}),
    ...(retirementReason ? { retirementReason } : {}),
    ...(retiredAt ? { retiredAt: new Date(retiredAt).toISOString() } : {}),
    registeredAt: new Date(row.registeredAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    routingAvailable: false,
    adapterActivation: false,
    execution: false,
  }));
}

async function selectWorkspaceExecutionControl(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
  asOf: Date,
): Promise<StoredAiWorkspaceExecutionControl> {
  const rows = await client<{
    workspaceId: string;
    state: "stopped" | "enabled";
    reason: string;
    enabledUntil?: Date | string | null;
    updatedByUserId: string;
    createdAt: Date | string;
    updatedAt: Date | string;
  }[]>`
    SELECT workspace_id, state, reason, enabled_until,
      updated_by AS updated_by_user_id, created_at, updated_at
    FROM workspace_ai_execution_control WHERE workspace_id = ${workspaceId}
  `;
  const row = rows[0];
  if (!row) return {
    workspaceId,
    state: "stopped",
    configured: false,
    executionAllowed: false,
  };
  return {
    workspaceId: row.workspaceId,
    state: row.state,
    reason: row.reason,
    ...(row.enabledUntil ? { enabledUntil: new Date(row.enabledUntil).toISOString() } : {}),
    updatedByUserId: row.updatedByUserId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    configured: true,
    executionAllowed: row.state === "enabled" && Boolean(row.enabledUntil) &&
      new Date(row.enabledUntil!).getTime() > asOf.getTime(),
  };
}

async function selectWorkspaceProviderCircuits(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<StoredAiWorkspaceProviderCircuit[]> {
  const rows = await client<{
    workspaceId: string;
    provider: StoredAiWorkspaceProviderCircuit["provider"];
    state: "closed" | "open";
    consecutiveUnsafeOutcomes: number;
    lastFailureCode?: StoredAiWorkspaceProviderCircuit["lastFailureCode"] | null;
    lastOutcomeAt?: Date | string | null;
    openedAt?: Date | string | null;
    openedByAttemptId?: string | null;
    resetByUserId?: string | null;
    resetNote?: string | null;
    resetAt?: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  }[]>`
    SELECT workspace_id, provider, state, consecutive_unsafe_outcomes,
      last_failure_code, last_outcome_at, opened_at, opened_by_attempt_id,
      reset_by AS reset_by_user_id, reset_note, reset_at, created_at, updated_at
    FROM workspace_ai_provider_circuit WHERE workspace_id = ${workspaceId}
    ORDER BY provider
  `;
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    provider: row.provider,
    state: row.state,
    consecutiveUnsafeOutcomes: Number(row.consecutiveUnsafeOutcomes),
    ...(row.lastFailureCode ? { lastFailureCode: row.lastFailureCode } : {}),
    ...(row.lastOutcomeAt ? { lastOutcomeAt: new Date(row.lastOutcomeAt).toISOString() } : {}),
    ...(row.openedAt ? { openedAt: new Date(row.openedAt).toISOString() } : {}),
    ...(row.openedByAttemptId ? { openedByAttemptId: row.openedByAttemptId } : {}),
    ...(row.resetByUserId ? { resetByUserId: row.resetByUserId } : {}),
    ...(row.resetNote ? { resetNote: row.resetNote } : {}),
    ...(row.resetAt ? { resetAt: new Date(row.resetAt).toISOString() } : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    executionAllowed: row.state === "closed",
  }));
}

async function selectWorkspaceTextInvocationAttempts(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<StoredAiTextInvocationAttempt[]> {
  const rows = await client<(StoredAiTextInvocationAttempt & {
    claimedAt: Date | string; claimExpiresAt: Date | string;
    completedAt?: Date | string | null; createdAt: Date | string; updatedAt: Date | string;
  })[]>`
    SELECT attempt.id, attempt.workspace_id, attempt.intent_id,
      attempt.provider, attempt.model_id, attempt.status,
      attempt.stop_reason, attempt.failure_code, attempt.safe_message,
      attempt.input_tokens, attempt.output_tokens,
      attempt.claimed_by AS claimed_by_user_id, attempt.claimed_at,
      attempt.claim_expires_at, attempt.completed_at,
      attempt.created_at, attempt.updated_at,
      (output.id IS NOT NULL) AS output_stored,
      (output.id IS NOT NULL) AS output_encrypted,
      false AS provider_response_id_stored,
      false AS usage_recorded, false AS settlement,
      false AS retry_allowed, false AS routing_available,
      (attempt.output_sha256 IS NOT NULL) AS output_hash_stored,
      (attempt.provider_response_id_sha256 IS NOT NULL) AS provider_response_id_hash_stored
    FROM workspace_ai_text_invocation_attempt attempt
    LEFT JOIN workspace_ai_text_output_artifact output
      ON output.attempt_id = attempt.id
    WHERE attempt.workspace_id = ${workspaceId}
    ORDER BY attempt.created_at DESC, attempt.id DESC
  `;
  return rows.map(({ completedAt, ...row }) => ({
    ...row,
    claimedAt: new Date(row.claimedAt).toISOString(),
    claimExpiresAt: new Date(row.claimExpiresAt).toISOString(),
    ...(completedAt ? { completedAt: new Date(completedAt).toISOString() } : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    providerRequestStatus: row.status === "succeeded" ? "sent" :
      row.status === "failed" ? "not_sent" : "unknown",
    outputStored: Boolean(row.outputStored),
    outputEncrypted: Boolean(row.outputEncrypted),
    outputHashStored: Boolean(row.outputHashStored),
    providerResponseIdStored: false,
    providerResponseIdHashStored: Boolean(row.providerResponseIdHashStored),
    usageRecorded: false,
    settlement: false,
    retryAllowed: false,
    routingAvailable: false,
    attemptComplete: row.status !== "claimed",
    providerExecutionSucceeded: row.status === "succeeded",
  }));
}

async function selectWorkspaceTextOutputArtifacts(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<StoredAiTextOutputArtifact[]> {
  const rows = await client<(StoredAiTextOutputArtifact & {
    reviewedByUserId?: string | null;
    reviewNote?: string | null;
    createdAt: Date | string;
    reviewedAt?: Date | string | null;
    updatedAt: Date | string;
  })[]>`
    SELECT artifact.id, artifact.workspace_id, artifact.attempt_id,
      artifact.intent_id, artifact.provider, artifact.model_id,
      artifact.status, artifact.character_count,
      artifact.created_by AS created_by_user_id,
      artifact.reviewed_by AS reviewed_by_user_id, artifact.review_note,
      artifact.created_at, artifact.reviewed_at, artifact.updated_at,
      intent.source_content_draft_id, intent.source_content_draft_version_id,
      intent.draft_revision_goal,
      (intent.source_content_draft_id IS NOT NULL) AS product_bound,
      true AS output_encrypted,
      false AS output_returned, false AS output_hash_returned,
      false AS publishing_authorized, false AS execution
    FROM workspace_ai_text_output_artifact artifact
    JOIN workspace_ai_text_invocation_intent intent
      ON intent.id = artifact.intent_id AND intent.workspace_id = artifact.workspace_id
    WHERE artifact.workspace_id = ${workspaceId}
    ORDER BY artifact.created_at DESC, artifact.id DESC
  `;
  return rows.map(({
    reviewedByUserId, reviewNote, reviewedAt,
    sourceContentDraftId, sourceContentDraftVersionId, draftRevisionGoal,
    ...row
  }) => ({
    ...row,
    ...(reviewedByUserId ? { reviewedByUserId } : {}),
    ...(reviewNote ? { reviewNote } : {}),
    ...(sourceContentDraftId ? { sourceContentDraftId } : {}),
    ...(sourceContentDraftVersionId ? { sourceContentDraftVersionId } : {}),
    ...(draftRevisionGoal ? { draftRevisionGoal } : {}),
    productBound: Boolean(row.productBound),
    createdAt: new Date(row.createdAt).toISOString(),
    ...(reviewedAt ? { reviewedAt: new Date(reviewedAt).toISOString() } : {}),
    updatedAt: new Date(row.updatedAt).toISOString(),
    outputEncrypted: true,
    outputReturned: false,
    outputHashReturned: false,
    publishingAuthorized: false,
    execution: false,
  }));
}

async function selectWorkspaceTextInvocationReconciliations(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<StoredAiTextInvocationReconciliation[]> {
  const rows = await client<(StoredAiTextInvocationReconciliation & {
    reason?: StoredAiTextInvocationReconciliation["reason"] | null;
    actualCostMinor?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    usageEventId?: string | null;
    reconciledAt: Date | string;
    createdAt: Date | string;
  })[]>`
    SELECT reconciliation.id, reconciliation.workspace_id,
      reconciliation.attempt_id, reconciliation.reservation_id,
      reconciliation.rate_card_id, reconciliation.status,
      reconciliation.reason, reconciliation.currency,
      reconciliation.actual_cost_minor, reconciliation.input_tokens,
      reconciliation.output_tokens, reconciliation.usage_event_id,
      reconciliation.reconciled_by AS reconciled_by_user_id,
      reconciliation.reconciled_at, reconciliation.created_at,
      (reconciliation.usage_event_id IS NOT NULL) AS usage_recorded,
      (reconciliation.status = 'settled' OR
        resolution.reservation_final_status = 'settled') AS reservation_settled,
      false AS retry_allowed
    FROM workspace_ai_text_invocation_reconciliation reconciliation
    LEFT JOIN workspace_ai_text_invocation_resolution resolution
      ON resolution.reconciliation_id = reconciliation.id
    WHERE reconciliation.workspace_id = ${workspaceId}
    ORDER BY reconciliation.created_at DESC, reconciliation.id DESC
  `;
  return rows.map(({
    reason, actualCostMinor, inputTokens, outputTokens, usageEventId, ...row
  }) => ({
    ...row,
    ...(reason ? { reason } : {}),
    ...(actualCostMinor !== null && actualCostMinor !== undefined ? { actualCostMinor: Number(actualCostMinor) } : {}),
    ...(inputTokens !== null && inputTokens !== undefined ? { inputTokens: Number(inputTokens) } : {}),
    ...(outputTokens !== null && outputTokens !== undefined ? { outputTokens: Number(outputTokens) } : {}),
    ...(usageEventId ? { usageEventId } : {}),
    reconciledAt: new Date(row.reconciledAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    usageRecorded: row.status === "settled",
    reservationSettled: Boolean(row.reservationSettled),
    retryAllowed: false,
  }));
}

async function selectWorkspaceTextInvocationResolutions(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<StoredAiTextInvocationResolution[]> {
  const rows = await client<{
    id: string;
    workspaceId: string;
    attemptId: string;
    reservationId: string;
    reconciliationId?: string | null;
    provider: StoredAiTextInvocationResolution["provider"];
    modelId: string;
    disposition: StoredAiTextInvocationResolution["disposition"];
    providerChargeMinor?: number | null;
    currency: string;
    evidenceReference: string;
    resolutionNote: string;
    reservationPreviousStatus: StoredAiTextInvocationResolution["reservationPreviousStatus"];
    reservationFinalStatus: StoredAiTextInvocationResolution["reservationFinalStatus"];
    resolvedByUserId: string;
    resolvedAt: Date | string;
    createdAt: Date | string;
  }[]>`
    SELECT id, workspace_id, attempt_id, reservation_id, reconciliation_id,
      provider, model_id, disposition, provider_charge_minor, currency,
      evidence_reference, resolution_note, reservation_previous_status,
      reservation_final_status, resolved_by AS resolved_by_user_id,
      resolved_at, created_at
    FROM workspace_ai_text_invocation_resolution
    WHERE workspace_id = ${workspaceId}
    ORDER BY resolved_at DESC, id DESC
  `;
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    attemptId: row.attemptId,
    reservationId: row.reservationId,
    ...(row.reconciliationId ? { reconciliationId: row.reconciliationId } : {}),
    provider: row.provider,
    modelId: row.modelId,
    disposition: row.disposition,
    ...(row.providerChargeMinor !== null && row.providerChargeMinor !== undefined
      ? { providerChargeMinor: Number(row.providerChargeMinor) }
      : {}),
    currency: row.currency,
    evidenceReference: row.evidenceReference,
    resolutionNote: row.resolutionNote,
    reservationPreviousStatus: row.reservationPreviousStatus,
    reservationFinalStatus: row.reservationFinalStatus,
    resolvedByUserId: row.resolvedByUserId,
    resolvedAt: new Date(row.resolvedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    usageUnitsKnown: false,
    retryAllowed: false,
    providerRequestRetried: false,
  }));
}

async function selectWorkspaceAiOperationalIncidents(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
  asOf: Date,
): Promise<StoredAiOperationalIncident[]> {
  const policy = await selectWorkspaceAiOperationalIncidentResponsePolicy(
    client, workspaceId,
  );
  const rows = await client<{
    type: StoredAiOperationalIncident["type"];
    attemptId: string;
    provider: StoredAiOperationalIncident["provider"];
    reconciliationId?: string | null;
    reason: StoredAiOperationalIncident["reason"];
    openedAt: Date | string;
    acknowledgementId?: string | null;
    acknowledgementNote?: string | null;
    acknowledgedByUserId?: string | null;
    acknowledgedAt?: Date | string | null;
  }[]>`
    WITH active_incident AS (
      SELECT 'provider_circuit_open'::text AS type,
        circuit.opened_by_attempt_id AS attempt_id,
        circuit.provider, NULL::uuid AS reconciliation_id,
        circuit.last_failure_code AS reason,
        circuit.opened_at AS opened_at
      FROM workspace_ai_provider_circuit circuit
      WHERE circuit.workspace_id = ${workspaceId} AND circuit.state = 'open'
      UNION ALL
      SELECT 'invocation_ambiguous'::text AS type,
        attempt.id AS attempt_id, attempt.provider,
        NULL::uuid AS reconciliation_id,
        CASE WHEN attempt.status = 'claimed'
          THEN 'claim_abandoned' ELSE attempt.failure_code END AS reason,
        COALESCE(attempt.completed_at, attempt.claim_expires_at) AS opened_at
      FROM workspace_ai_text_invocation_attempt attempt
      LEFT JOIN workspace_ai_text_invocation_resolution resolution
        ON resolution.attempt_id = attempt.id
      WHERE attempt.workspace_id = ${workspaceId}
        AND (attempt.status = 'ambiguous' OR
          (attempt.status = 'claimed' AND attempt.claim_expires_at <= ${asOf}))
        AND resolution.id IS NULL
      UNION ALL
      SELECT 'reconciliation_quarantined'::text AS type,
        attempt.id AS attempt_id, attempt.provider,
        reconciliation.id AS reconciliation_id,
        reconciliation.reason, reconciliation.reconciled_at AS opened_at
      FROM workspace_ai_text_invocation_reconciliation reconciliation
      JOIN workspace_ai_text_invocation_attempt attempt
        ON attempt.id = reconciliation.attempt_id
        AND attempt.workspace_id = reconciliation.workspace_id
      LEFT JOIN workspace_ai_text_invocation_resolution resolution
        ON resolution.reconciliation_id = reconciliation.id
      WHERE reconciliation.workspace_id = ${workspaceId}
        AND reconciliation.status = 'quarantined'
        AND resolution.id IS NULL
    )
    SELECT incident.type, incident.attempt_id, incident.provider,
      incident.reconciliation_id, incident.reason, incident.opened_at,
      acknowledgement.id AS acknowledgement_id,
      acknowledgement.acknowledgement_note,
      acknowledgement.acknowledged_by AS acknowledged_by_user_id,
      acknowledgement.acknowledged_at
    FROM active_incident incident
    LEFT JOIN workspace_ai_operational_incident_acknowledgement acknowledgement
      ON acknowledgement.workspace_id = ${workspaceId}
      AND acknowledgement.incident_type = incident.type
      AND acknowledgement.attempt_id = incident.attempt_id
    ORDER BY (acknowledgement.id IS NOT NULL),
      (incident.type = 'provider_circuit_open'
        AND incident.reason = 'credential_unavailable') DESC,
      incident.opened_at, incident.type, incident.attempt_id
  `;
  return rows.map((row) => {
    const severity = row.type === "provider_circuit_open" &&
      row.reason === "credential_unavailable" ? "critical" : "high";
    const openedAt = new Date(row.openedAt).toISOString();
    const acknowledgementMinutes = severity === "critical"
      ? policy.criticalAcknowledgementMinutes
      : policy.highAcknowledgementMinutes;
    const resolutionMinutes = severity === "critical"
      ? policy.criticalResolutionMinutes
      : policy.highResolutionMinutes;
    const acknowledgementDueAt = new Date(
      new Date(openedAt).getTime() + acknowledgementMinutes * 60_000,
    ).toISOString();
    const resolutionDueAt = new Date(
      new Date(openedAt).getTime() + resolutionMinutes * 60_000,
    ).toISOString();
    const acknowledged = Boolean(row.acknowledgementId);
    const acknowledgementOverdue = !acknowledged && asOf > new Date(acknowledgementDueAt);
    const acknowledgementLate = acknowledged && Boolean(row.acknowledgedAt) &&
      new Date(row.acknowledgedAt!) > new Date(acknowledgementDueAt);
    const resolutionOverdue = asOf > new Date(resolutionDueAt);
    const responseState = resolutionOverdue
      ? "resolution_overdue" as const
      : acknowledgementOverdue
        ? "acknowledgement_overdue" as const
        : acknowledgementLate
          ? "acknowledgement_late" as const
          : "within_target" as const;
    return {
      id: `${row.type}:${row.attemptId}`,
      workspaceId,
      type: row.type,
      severity,
      attemptId: row.attemptId,
      provider: row.provider,
      ...(row.reconciliationId ? { reconciliationId: row.reconciliationId } : {}),
      reason: row.reason,
      summary: operationalIncidentSummary(row.type, row.reason),
      openedAt,
      acknowledged,
      ...(row.acknowledgementId ? { acknowledgementId: row.acknowledgementId } : {}),
      ...(row.acknowledgementNote ? { acknowledgementNote: row.acknowledgementNote } : {}),
      ...(row.acknowledgedByUserId ? { acknowledgedByUserId: row.acknowledgedByUserId } : {}),
      ...(row.acknowledgedAt
        ? { acknowledgedAt: new Date(row.acknowledgedAt).toISOString() }
        : {}),
      acknowledgementDueAt,
      resolutionDueAt,
      acknowledgementOverdue,
      acknowledgementLate,
      resolutionOverdue,
      responseState,
      active: true,
      providerRequestRetried: false,
      executionAuthority: false,
    };
  });
}

async function selectWorkspaceAiOperationalIncidentResponsePolicy(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<StoredAiOperationalIncidentResponsePolicy> {
  const [rows, alertRows] = await Promise.all([client<{
    criticalAcknowledgementMinutes: number;
    highAcknowledgementMinutes: number;
    criticalResolutionMinutes: number;
    highResolutionMinutes: number;
    runbookUrl: string;
    updatedByUserId: string;
    createdAt: Date | string;
    updatedAt: Date | string;
  }[]>`
    SELECT critical_acknowledgement_minutes,
      high_acknowledgement_minutes, critical_resolution_minutes,
      high_resolution_minutes, runbook_url, updated_by AS updated_by_user_id,
      created_at, updated_at
    FROM workspace_ai_operational_incident_response_policy
    WHERE workspace_id = ${workspaceId}
  `, client<{ configured: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM workspace_ai_operational_alert_webhook
      WHERE workspace_id = ${workspaceId} AND status = 'verified'
    ) AS configured
  `]);
  const externalAlertDeliveryConfigured = Boolean(alertRows[0]?.configured);
  const row = rows[0];
  if (!row)
    return {
      workspaceId,
      ...DEFAULT_AI_OPERATIONAL_INCIDENT_RESPONSE_POLICY,
      configured: false,
      executionAuthority: false,
      externalAlertDeliveryConfigured,
    };
  return {
    workspaceId,
    criticalAcknowledgementMinutes: Number(row.criticalAcknowledgementMinutes),
    highAcknowledgementMinutes: Number(row.highAcknowledgementMinutes),
    criticalResolutionMinutes: Number(row.criticalResolutionMinutes),
    highResolutionMinutes: Number(row.highResolutionMinutes),
    runbookUrl: row.runbookUrl,
    configured: true,
    updatedByUserId: row.updatedByUserId,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    executionAuthority: false,
    externalAlertDeliveryConfigured,
  };
}

async function selectWorkspaceAiOperationalAlertWebhook(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
): Promise<StoredAiOperationalAlertWebhook> {
  const rows = await client<{
    status: StoredAiOperationalAlertWebhook["status"];
    endpointUrl: string;
    lastTestedAt?: Date | string | null;
    lastError?: string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  }[]>`
    SELECT status, endpoint_url, last_tested_at, last_error, created_at, updated_at
    FROM workspace_ai_operational_alert_webhook
    WHERE workspace_id = ${workspaceId}
  `;
  const row = rows[0];
  if (!row)
    return {
      workspaceId,
      status: "disabled",
      secretConfigured: false,
      configured: false,
      deliveryEnabled: false,
      executionAuthority: false,
      providerRequestAuthority: false,
    };
  return {
    workspaceId,
    status: row.status,
    endpointOrigin: new URL(row.endpointUrl).origin,
    secretConfigured: true,
    ...(row.lastTestedAt ? { lastTestedAt: new Date(row.lastTestedAt).toISOString() } : {}),
    ...(row.lastError ? { safeError: row.lastError } : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    configured: true,
    deliveryEnabled: row.status === "verified",
    executionAuthority: false,
    providerRequestAuthority: false,
  };
}

async function selectWorkspaceAiOperationalAlertDeliveries(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
  limit: number,
): Promise<StoredAiOperationalAlertDelivery[]> {
  const rows = await client<{
    id: string;
    incidentType: StoredAiOperationalAlertDelivery["incidentType"];
    attemptId: string;
    provider: StoredAiOperationalAlertDelivery["provider"];
    eventType: StoredAiOperationalAlertDelivery["eventType"];
    status: StoredAiOperationalAlertDelivery["status"];
    attemptCount: number;
    nextAttemptAt: Date | string;
    deliveredAt?: Date | string | null;
    responseStatus?: number | null;
    lastError?: string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  }[]>`
    SELECT id, incident_type, attempt_id, provider, event_type, status,
      attempt_count, next_attempt_at, delivered_at, response_status,
      last_error, created_at, updated_at
    FROM workspace_ai_operational_alert_delivery
    WHERE workspace_id = ${workspaceId}
    ORDER BY created_at DESC, id DESC LIMIT ${limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    workspaceId,
    incidentType: row.incidentType,
    attemptId: row.attemptId,
    provider: row.provider,
    eventType: row.eventType,
    status: row.status,
    attemptCount: Number(row.attemptCount),
    nextAttemptAt: new Date(row.nextAttemptAt).toISOString(),
    ...(row.deliveredAt ? { deliveredAt: new Date(row.deliveredAt).toISOString() } : {}),
    ...(row.responseStatus !== null && row.responseStatus !== undefined
      ? { responseStatus: Number(row.responseStatus) } : {}),
    ...(row.lastError ? { safeError: row.lastError } : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    payloadReturned: false,
    endpointReturned: false,
    signingSecretReturned: false,
    executionAuthority: false,
  }));
}

function operationalAlertPayload(
  id: string,
  eventType: (typeof AI_OPERATIONAL_ALERT_EVENT_TYPES)[number],
  incident: StoredAiOperationalIncident,
  policy: StoredAiOperationalIncidentResponsePolicy,
  occurredAt: string,
): Record<string, unknown> {
  return {
    version: "1",
    id,
    eventType,
    occurredAt,
    workspaceId: incident.workspaceId,
    incident: {
      id: incident.id,
      type: incident.type,
      severity: incident.severity,
      attemptId: incident.attemptId,
      provider: incident.provider,
      reason: incident.reason,
      summary: incident.summary,
      openedAt: incident.openedAt,
      acknowledged: incident.acknowledged,
      ...(incident.acknowledgedAt ? { acknowledgedAt: incident.acknowledgedAt } : {}),
      acknowledgementDueAt: incident.acknowledgementDueAt,
      resolutionDueAt: incident.resolutionDueAt,
      responseState: incident.responseState,
      active: true,
    },
    responsePolicy: {
      ...(policy.runbookUrl ? { runbookUrl: policy.runbookUrl } : {}),
    },
    executionAuthority: false,
    providerRequestAuthority: false,
  };
}

function validateOperationalAlertWebhookWrite(input: AiOperationalAlertWebhookWrite): void {
  const issues: { field: string; message: string }[] = [];
  try {
    const url = new URL(input.endpointUrl);
    if (url.protocol !== "https:") throw new Error();
  } catch {
    issues.push({ field: "endpointUrl", message: "Use a valid HTTPS webhook URL." });
  }
  if (input.encryptedSigningSecret.length < 20 || input.encryptedSigningSecret.length > 4096)
    issues.push({ field: "signingSecret", message: "Use a supported encrypted signing-secret envelope." });
  if (!/^[0-9a-f]{64}$/.test(input.secretFingerprint))
    issues.push({ field: "signingSecret", message: "Use a SHA-256 secret fingerprint." });
  if (input.encryptionKeyVersion !== "v1")
    issues.push({ field: "signingSecret", message: "Use the supported encryption-key version." });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function validateOperationalAlertWebhookVerification(
  input: AiOperationalAlertWebhookVerificationWrite,
): void {
  const issues: { field: string; message: string }[] = [];
  if (!/^[0-9a-f]{64}$/.test(input.expectedSecretFingerprint))
    issues.push({ field: "webhook", message: "Webhook verification evidence is invalid." });
  if (input.status === "error" && (!input.safeError?.trim() || input.safeError.length > 300))
    issues.push({ field: "webhook", message: "Use a safe verification error up to 300 characters." });
  if (input.status === "verified" && input.safeError)
    issues.push({ field: "webhook", message: "A verified webhook cannot include an error." });
  if (issues.length) throw new AiPolicyValidationError(issues);
}

function operationalIncidentSummary(
  type: StoredAiOperationalIncident["type"],
  reason: StoredAiOperationalIncident["reason"],
): string {
  if (type === "provider_circuit_open")
    return reason === "credential_unavailable"
      ? "Provider circuit opened after the server could not open its stored credential."
      : "Provider circuit is open after repeated outcomes whose provider receipt is unsafe to assume.";
  if (type === "invocation_ambiguous")
    return reason === "evidence_changed"
      ? "Provider outcome was discarded after execution authorization evidence changed in flight."
      : reason === "claim_abandoned"
        ? "A claimed provider attempt passed its reconciliation deadline without a recorded outcome."
        : "Provider receipt could not be determined, so this attempt is non-retryable until reviewed.";
  return reason === "missing_usage"
    ? "Provider output was retained, but required usage evidence was missing and billing was quarantined."
    : reason === "unsupported_rate_card"
      ? "Provider usage could not be reconciled against the approved rate-card components."
      : "Calculated provider cost exceeded the authorized reservation and billing was quarantined.";
}

async function selectWorkspaceTextDraftProposals(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
  contentDraftId: string,
): Promise<StoredAiTextDraftProposal[]> {
  const rows = await client<(StoredAiTextDraftProposal & {
    dismissedByUserId?: string | null;
    dismissalNote?: string | null;
    appliedByUserId?: string | null;
    applicationNote?: string | null;
    appliedVersionId?: string | null;
    selectedFields?: ("lead_in" | "call_to_action" | "hashtags" | "alt_text")[] | null;
    attachedAt: Date | string;
    dismissedAt?: Date | string | null;
    appliedAt?: Date | string | null;
    updatedAt: Date | string;
  })[]>`
    SELECT proposal.id, proposal.workspace_id, proposal.artifact_id,
      artifact.attempt_id, proposal.content_draft_id,
      proposal.source_draft_version_id, artifact.provider, artifact.model_id,
      artifact.character_count, proposal.status,
      proposal.attached_by AS attached_by_user_id,
      proposal.dismissed_by AS dismissed_by_user_id,
      proposal.dismissal_note, proposal.applied_by AS applied_by_user_id,
      proposal.application_note, proposal.applied_version_id,
      proposal.selected_fields, proposal.attached_at,
      proposal.dismissed_at, proposal.applied_at, proposal.updated_at,
      (proposal.status = 'attached'
        AND draft.current_version_id = proposal.source_draft_version_id
        AND draft.status IN ('working', 'changes_requested')) AS source_current,
      true AS output_encrypted, false AS output_returned,
      (proposal.status = 'applied') AS draft_content_mutated,
      false AS publishing_authorized,
      false AS execution
    FROM workspace_ai_text_draft_proposal proposal
    JOIN workspace_ai_text_output_artifact artifact
      ON artifact.id = proposal.artifact_id
      AND artifact.workspace_id = proposal.workspace_id
    JOIN content_draft draft ON draft.id = proposal.content_draft_id
      AND draft.workspace_id = proposal.workspace_id
    WHERE proposal.workspace_id = ${workspaceId}
      AND proposal.content_draft_id = ${contentDraftId}
    ORDER BY proposal.attached_at DESC, proposal.id DESC
  `;
  return rows.map(({
    dismissedByUserId, dismissalNote, dismissedAt,
    appliedByUserId, applicationNote, appliedVersionId, selectedFields, appliedAt,
    ...row
  }) => ({
    ...row,
    ...(dismissedByUserId ? { dismissedByUserId } : {}),
    ...(dismissalNote ? { dismissalNote } : {}),
    ...(appliedByUserId ? { appliedByUserId } : {}),
    ...(applicationNote ? { applicationNote } : {}),
    ...(appliedVersionId ? { appliedVersionId } : {}),
    ...(selectedFields ? { selectedFields } : {}),
    attachedAt: new Date(row.attachedAt).toISOString(),
    ...(dismissedAt ? { dismissedAt: new Date(dismissedAt).toISOString() } : {}),
    ...(appliedAt ? { appliedAt: new Date(appliedAt).toISOString() } : {}),
    updatedAt: new Date(row.updatedAt).toISOString(),
    sourceCurrent: Boolean(row.sourceCurrent),
    outputEncrypted: true,
    outputReturned: false,
    draftContentMutated: row.status === "applied",
    publishingAuthorized: false,
    execution: false,
  }));
}

async function selectWorkspaceTextInvocationIntents(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
  asOf: Date,
): Promise<StoredAiTextInvocationIntent[]> {
  const rows = await client<(StoredAiTextInvocationIntent & {
    preparedAt: Date | string;
    expiresAt: Date | string;
    cancelledAt?: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  })[]>`
    SELECT i.id, i.workspace_id, i.invocation_binding_id,
      i.reservation_id, i.cost_quote_id, i.provider, i.model_id,
      q.feature, q.currency, s.estimated_cost_minor,
      i.max_output_tokens, i.status,
      i.prepared_by AS prepared_by_user_id,
      i.cancelled_by AS cancelled_by_user_id,
      i.cancellation_reason, i.prepared_at, i.expires_at,
      i.cancelled_at, i.created_at, i.updated_at,
      i.source_content_draft_id, i.source_content_draft_version_id,
      i.draft_revision_goal, i.product_prompt_version,
      (i.source_content_draft_id IS NOT NULL) AS product_bound,
      (i.source_context_sha256 IS NOT NULL) AS source_context_hash_stored,
      (i.status = 'prepared' AND i.expires_at > ${asOf}
       AND s.status = 'reserved' AND s.expires_at > ${asOf}
       AND s.cost_quote_id = i.cost_quote_id
       AND s.capability = 'generate_text' AND s.feature LIKE 'assistant.%'
       AND q.capability = s.capability AND q.feature = s.feature
       AND q.currency = s.currency
       AND q.maximum_cost_minor = s.estimated_cost_minor
       AND q.rate_card_id = rb.rate_card_id AND q.expires_at > ${asOf}
       AND ib.status = 'configured' AND r.status = 'registered'
       AND a.status = 'approved' AND m.retired_at IS NULL
       AND c.status = 'verified' AND c.encrypted_credential IS NOT NULL
       AND r.source_credential_fingerprint = a.source_credential_fingerprint
       AND m.credential_fingerprint = a.source_credential_fingerprint
       AND c.credential_fingerprint = a.source_credential_fingerprint
       AND i.credential_fingerprint = c.credential_fingerprint
       AND rb.status = 'bound' AND card.status = 'approved'
       AND rb.rate_card_source_hash = card.source_hash
       AND card.effective_from <= ${asOf}
       AND (card.effective_to IS NULL OR card.effective_to > ${asOf})
       AND ic.status = 'approved' AND ic.codec_available = true
       AND ic.transport_available = true AND ic.implementation_available = true
       AND ib.contract_source_hash = ic.source_hash
       AND i.contract_source_hash = ic.source_hash
       AND h.status = 'healthy' AND h.checked_at >= ib.configured_at
       AND h.expires_at > ${asOf}
       AND h.credential_fingerprint = c.credential_fingerprint
       AND h.contract_source_hash = ic.source_hash
       AND (i.source_content_draft_id IS NULL OR EXISTS (
         SELECT 1 FROM content_draft source_draft
         JOIN content_draft_version source_version
           ON source_version.id = source_draft.current_version_id
           AND source_version.content_draft_id = source_draft.id
         WHERE source_draft.id = i.source_content_draft_id
           AND source_draft.workspace_id = i.workspace_id
           AND source_draft.current_version_id = i.source_content_draft_version_id
           AND source_draft.status IN ('working', 'changes_requested')
           AND source_version.status IN ('working', 'changes_requested')
       ))) AS authorization_current,
      false AS prompt_stored, false AS provider_request,
      false AS output_stored, false AS usage_recorded,
      false AS settlement, false AS routing_available, false AS execution
    FROM workspace_ai_text_invocation_intent i
    JOIN workspace_ai_adapter_invocation_binding ib
      ON ib.id = i.invocation_binding_id AND ib.workspace_id = i.workspace_id
    JOIN workspace_ai_adapter_registration r ON r.id = ib.registration_id
    JOIN workspace_ai_adapter_candidate a ON a.id = r.candidate_id
    JOIN workspace_ai_provider_model m
      ON m.workspace_id = r.workspace_id AND m.provider = r.provider
      AND m.model_id = r.model_id
    JOIN workspace_ai_provider_connection c
      ON c.workspace_id = r.workspace_id AND c.provider = r.provider
    JOIN workspace_ai_adapter_rate_binding rb ON rb.id = ib.rate_binding_id
    JOIN ai_provider_rate_card card ON card.id = rb.rate_card_id
    JOIN ai_provider_invocation_contract ic ON ic.id = ib.contract_id
    JOIN ai_spend_reservation s ON s.id = i.reservation_id
    JOIN ai_cost_quote q ON q.id = i.cost_quote_id
    LEFT JOIN LATERAL (
      SELECT o.status, o.credential_fingerprint, o.contract_source_hash,
        o.checked_at, o.expires_at
      FROM workspace_ai_adapter_health_observation o
      WHERE o.workspace_id = ib.workspace_id
        AND o.invocation_binding_id = ib.id
      ORDER BY o.checked_at DESC, o.id DESC LIMIT 1
    ) h ON true
    WHERE i.workspace_id = ${workspaceId}
    ORDER BY i.created_at DESC, i.id DESC
  `;
  return rows.map(({
    cancelledByUserId, cancellationReason, cancelledAt,
    sourceContentDraftId, sourceContentDraftVersionId, draftRevisionGoal,
    productPromptVersion, ...row
  }) => ({
    ...row,
    ...(cancelledByUserId ? { cancelledByUserId } : {}),
    ...(cancellationReason ? { cancellationReason } : {}),
    ...(cancelledAt ? { cancelledAt: new Date(cancelledAt).toISOString() } : {}),
    ...(sourceContentDraftId ? { sourceContentDraftId } : {}),
    ...(sourceContentDraftVersionId ? { sourceContentDraftVersionId } : {}),
    ...(draftRevisionGoal ? { draftRevisionGoal } : {}),
    ...(productPromptVersion ? { productPromptVersion } : {}),
    productBound: Boolean(row.productBound),
    sourceContextHashStored: Boolean(row.sourceContextHashStored),
    preparedAt: new Date(row.preparedAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    authorizationCurrent: Boolean(row.authorizationCurrent),
    promptStored: false,
    providerRequest: false,
    outputStored: false,
    usageRecorded: false,
    settlement: false,
    routingAvailable: false,
    execution: false,
  }));
}

async function selectDraftRevisionPrompt(
  client: TransactionSql,
  workspaceId: string,
  contentDraftId: string,
  goal: AiDraftRevisionGoal,
  expectedVersionId?: string,
  promptVersion: string = AI_DRAFT_REVISION_CURRENT_PROMPT_VERSION,
): Promise<AiDraftRevisionPromptTarget> {
  if (!(AI_DRAFT_REVISION_PROMPT_VERSIONS as readonly string[]).includes(promptVersion))
    throw new AiPolicyValidationError([{
      field: "promptVersion",
      message: "The Draft revision prompt version is not supported.",
    }]);
  const rows = await client<{
    contentDraftVersionId: string;
    draftStatus: string;
    versionStatus: string;
    campaignName: string;
    packageTitle: string;
    audienceName?: string | null;
    draftFormat: DraftFormat;
    headline: string;
    body: string;
    callToAction?: string | null;
    hashtags: string[];
    altText?: string | null;
    rationale: string;
    presentationChoices: Record<string, unknown>;
    evidenceSnapshot: {
      id: string;
      claim: string;
      provenance: string;
      sourceReferences: string[];
    }[];
  }[]>`
    SELECT draft.current_version_id AS content_draft_version_id,
      draft.status AS draft_status, version.status AS version_status,
      campaign.name AS campaign_name, package.title AS package_title,
      audience.name AS audience_name, generation.draft_format,
      version.headline, version.body, version.call_to_action,
      version.hashtags, version.alt_text, version.rationale,
      version.presentation_choices, generation.evidence_snapshot
    FROM content_draft draft
    JOIN content_draft_version version
      ON version.id = draft.current_version_id
      AND version.content_draft_id = draft.id
    JOIN draft_generation generation ON generation.id = draft.draft_generation_id
    JOIN campaign_version campaign_version
      ON campaign_version.id = generation.campaign_version_id
    JOIN campaign ON campaign.id = campaign_version.campaign_id
    JOIN content_package package ON package.id = generation.content_package_id
    LEFT JOIN audience_profile_version audience_version
      ON audience_version.id = draft.audience_profile_version_id
    LEFT JOIN audience_profile audience ON audience.id = audience_version.audience_profile_id
    WHERE draft.id = ${contentDraftId} AND draft.workspace_id = ${workspaceId}
      AND draft.status IN ('working', 'changes_requested')
      AND version.status IN ('working', 'changes_requested')
      ${expectedVersionId ? client`AND draft.current_version_id = ${expectedVersionId}` : client``}
    FOR UPDATE OF draft, version
  `;
  const source = rows[0];
  if (!source)
    throw new AiPolicyValidationError([{
      field: "contentDraftId",
      message: "Choose the exact current editable Draft version for AI revision.",
    }]);
  const claims = await client<{
    kind: "fact" | "call_to_action";
    text: string;
    evidenceItemIds: string[];
    sortOrder: number;
  }[]>`
    SELECT claim.kind, claim.claim_text AS text, claim.sort_order,
      COALESCE(array_agg(binding.evidence_item_id ORDER BY binding.evidence_item_id)
        FILTER (WHERE binding.evidence_item_id IS NOT NULL), '{}') AS evidence_item_ids
    FROM content_draft_claim claim
    LEFT JOIN content_draft_claim_evidence binding
      ON binding.content_draft_claim_id = claim.id
    WHERE claim.content_draft_version_id = ${source.contentDraftVersionId}
    GROUP BY claim.id ORDER BY claim.sort_order, claim.id
  `;
  if (!claims.some((claim) => claim.kind === "fact" && claim.evidenceItemIds.length))
    throw new AiPolicyValidationError([{
      field: "contentDraftId",
      message: "AI revision requires at least one evidence-backed factual Draft claim.",
    }]);
  const evidence = [...source.evidenceSnapshot]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => ({
      id: item.id,
      claim: item.claim,
      provenance: item.provenance,
      sourceReferences: [...item.sourceReferences].sort(),
    }));
  const context = {
    version: promptVersion,
    goal,
    source: {
      contentDraftId,
      contentDraftVersionId: source.contentDraftVersionId,
      campaignName: source.campaignName,
      packageTitle: source.packageTitle,
      audienceName: source.audienceName ?? null,
      draftFormat: source.draftFormat,
    },
    currentPresentation: {
      headline: source.headline,
      body: source.body,
      callToAction: source.callToAction ?? null,
      hashtags: [...source.hashtags],
      altText: source.altText ?? null,
      leadIn: String(source.presentationChoices.leadIn ?? ""),
      rationale: source.rationale,
    },
    claims: claims.map((claim) => ({
      kind: claim.kind,
      text: claim.text,
      evidenceItemIds: [...claim.evidenceItemIds],
    })),
    evidence,
  };
  const canonicalContext = JSON.stringify(context);
  const structured = promptVersion === AI_DRAFT_REVISION_CURRENT_PROMPT_VERSION;
  const systemText = structured ? [
    "You are Market Me's review-only copy assistant.",
    "Suggest presentation changes only; preserve every factual claim and its evidence meaning.",
    "Do not invent facts, change evidence, claim approval, publish, route work, or execute actions.",
    `Return only one JSON object with schemaVersion ${AI_DRAFT_REVISION_SUGGESTION_VERSION}, optional leadIn, callToAction, hashtags, and altText fields, plus a required rationale.`,
    "Do not return headline or body fields, markdown, prose outside the JSON object, null values, or unrequested keys.",
    "A leadIn must contain no sentence punctuation; hashtags must start with # and use only letters, numbers, or underscores.",
  ].join(" ") : [
    "You are Market Me's review-only copy assistant.",
    "Suggest presentation changes only; preserve every factual claim and its evidence meaning.",
    "Do not invent facts, change evidence, claim approval, publish, route work, or execute actions.",
    "Return concise human-review suggestions for headline, lead-in, call to action, hashtags, and alternative text as applicable.",
  ].join(" ");
  const userText = structured ? [
    `Revision goal: ${goal.replaceAll("_", " ")}.`,
    "Use only this immutable governed Draft context:",
    canonicalContext,
    "Omit any optional field whose safe presentation-only value cannot be supported. Use rationale to explain the suggestions without repeating or adding factual claims.",
  ].join("\n") : [
    `Revision goal: ${goal.replaceAll("_", " ")}.`,
    "Use only this immutable governed Draft context:",
    canonicalContext,
    "Explain each proposed presentation change and explicitly identify any suggestion that should be rejected because it would alter a factual claim.",
  ].join("\n");
  if (systemText.length > AI_TEXT_CODEC_LIMITS.systemTextCharacters ||
    userText.length > AI_TEXT_CODEC_LIMITS.userTextCharacters)
    throw new AiPolicyValidationError([{
      field: "contentDraftId",
      message: "The governed Draft context exceeds the provider text codec bounds.",
    }]);
  return {
    workspaceId,
    contentDraftId,
    contentDraftVersionId: source.contentDraftVersionId,
    goal,
    promptVersion,
    contextSha256: sha256(canonicalContext),
    systemText,
    userText,
  };
}

async function selectProviderInvocationContracts(
  client: DatabaseClient | TransactionSql,
): Promise<AiProviderInvocationContract[]> {
  const rows = await client<(Omit<AiProviderInvocationContract,
    "codecVersion" | "transportVersion" | "endpointPolicy" | "implementationVersion"> & {
    codecVersion?: string | null;
    transportVersion?: string | null;
    endpointPolicy?: string | null;
    implementationVersion?: string | null;
  })[]>`
    SELECT id, provider, contract_key, contract_version, status, transport,
      credential_mode, request_schema_version, response_schema_version,
      source_reference, source_hash, codec_available, codec_version,
      transport_available, transport_version, endpoint_policy,
      implementation_available, implementation_version,
      reviewed_at, created_at, updated_at,
      false AS health_ready, false AS execution
    FROM ai_provider_invocation_contract
    ORDER BY provider, contract_key, contract_version
  `;
  return rows.map(({
    codecVersion, transportVersion, endpointPolicy, implementationVersion, ...row
  }) => ({
    ...row,
    ...(codecVersion ? { codecVersion } : {}),
    ...(transportVersion ? { transportVersion } : {}),
    ...(endpointPolicy ? { endpointPolicy } : {}),
    ...(implementationVersion ? { implementationVersion } : {}),
    reviewedAt: new Date(row.reviewedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    healthReady: false,
    execution: false,
  }));
}

async function selectWorkspaceAdapterInvocationBindings(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
  asOf: Date,
): Promise<AiWorkspaceAdapterInvocationBinding[]> {
  const rows = await client<(Omit<AiWorkspaceAdapterInvocationBinding,
    "codecVersion" | "transportVersion" | "endpointPolicy" | "implementationVersion"> & {
    codecVersion?: string | null;
    transportVersion?: string | null;
    endpointPolicy?: string | null;
    implementationVersion?: string | null;
    healthObservationId?: string;
    healthStatus?: "healthy" | "unhealthy";
    healthFailureCode?: AiWorkspaceAdapterHealthObservation["failureCode"];
    healthSafeMessage?: string;
    healthCheckedByUserId?: string;
    healthCheckedAt?: Date | string;
    healthExpiresAt?: Date | string;
    healthObservationCurrent: boolean;
  })[]>`
    SELECT ib.id, ib.workspace_id, ib.registration_id, ib.rate_binding_id,
      rb.rate_card_id,
      ib.contract_id, ib.provider, r.model_id, r.display_name,
      rb.currency AS pricing_currency, ib.status,
      ic.contract_key, ic.contract_version, ic.transport,
      ic.credential_mode, ic.request_schema_version,
      ic.response_schema_version, ic.source_reference, ic.source_hash,
      ic.codec_available, ic.codec_version,
      ic.transport_available, ic.transport_version, ic.endpoint_policy,
      ic.implementation_available, ic.implementation_version,
      ib.configured_by AS configured_by_user_id,
      ib.retired_by AS retired_by_user_id, ib.retirement_reason,
      ib.configured_at, ib.retired_at, ib.created_at, ib.updated_at,
      h.id AS health_observation_id, h.status AS health_status,
      h.failure_code AS health_failure_code, h.safe_message AS health_safe_message,
      h.checked_by AS health_checked_by_user_id,
      h.checked_at AS health_checked_at, h.expires_at AS health_expires_at,
      (ib.status = 'configured' AND r.status = 'registered'
       AND a.status = 'approved' AND m.retired_at IS NULL AND c.status = 'verified'
       AND r.source_credential_fingerprint = a.source_credential_fingerprint
       AND m.credential_fingerprint = a.source_credential_fingerprint
       AND c.credential_fingerprint = a.source_credential_fingerprint
       AND rb.status = 'bound' AND card.status = 'approved'
       AND rb.rate_card_source_hash = card.source_hash
       AND card.effective_from <= ${asOf}
       AND (card.effective_to IS NULL OR card.effective_to > ${asOf})
       AND ic.status = 'approved'
       AND ib.contract_source_hash = ic.source_hash) AS configuration_current,
      (h.id IS NOT NULL AND h.checked_at >= ib.configured_at
       AND h.expires_at > ${asOf}
       AND h.credential_fingerprint = c.credential_fingerprint
       AND h.contract_source_hash = ic.source_hash) AS health_observation_current,
      (h.status = 'healthy' AND h.checked_at >= ib.configured_at
       AND h.expires_at > ${asOf}
       AND h.credential_fingerprint = c.credential_fingerprint
       AND h.contract_source_hash = ic.source_hash
       AND ib.status = 'configured' AND r.status = 'registered'
       AND a.status = 'approved' AND m.retired_at IS NULL AND c.status = 'verified'
       AND r.source_credential_fingerprint = a.source_credential_fingerprint
       AND m.credential_fingerprint = a.source_credential_fingerprint
       AND c.credential_fingerprint = a.source_credential_fingerprint
       AND rb.status = 'bound' AND card.status = 'approved'
       AND rb.rate_card_source_hash = card.source_hash
       AND card.effective_from <= ${asOf}
       AND (card.effective_to IS NULL OR card.effective_to > ${asOf})
       AND ic.status = 'approved'
       AND ib.contract_source_hash = ic.source_hash) AS provider_health_evidence_current,
      false AS health_ready,
      false AS routing_available, false AS adapter_activation, false AS execution
    FROM workspace_ai_adapter_invocation_binding ib
    JOIN workspace_ai_adapter_registration r ON r.id = ib.registration_id
    JOIN workspace_ai_adapter_candidate a ON a.id = r.candidate_id
    JOIN workspace_ai_provider_model m
      ON m.workspace_id = r.workspace_id AND m.provider = r.provider AND m.model_id = r.model_id
    JOIN workspace_ai_provider_connection c
      ON c.workspace_id = r.workspace_id AND c.provider = r.provider
    JOIN workspace_ai_adapter_rate_binding rb ON rb.id = ib.rate_binding_id
    JOIN ai_provider_rate_card card ON card.id = rb.rate_card_id
    JOIN ai_provider_invocation_contract ic ON ic.id = ib.contract_id
    LEFT JOIN LATERAL (
      SELECT o.id, o.status, o.failure_code, o.safe_message,
        o.credential_fingerprint, o.contract_source_hash,
        o.checked_by, o.checked_at, o.expires_at
      FROM workspace_ai_adapter_health_observation o
      WHERE o.workspace_id = ib.workspace_id
        AND o.invocation_binding_id = ib.id
      ORDER BY o.checked_at DESC, o.id DESC
      LIMIT 1
    ) h ON true
    WHERE ib.workspace_id = ${workspaceId}
    ORDER BY ib.updated_at DESC, ib.id
  `;
  return rows.map(({
    codecVersion,
    transportVersion,
    endpointPolicy,
    implementationVersion,
    retiredByUserId,
    retirementReason,
    retiredAt,
    healthObservationId,
    healthStatus,
    healthFailureCode,
    healthSafeMessage,
    healthCheckedByUserId,
    healthCheckedAt,
    healthExpiresAt,
    healthObservationCurrent,
    ...row
  }) => ({
    ...row,
    ...(codecVersion ? { codecVersion } : {}),
    ...(transportVersion ? { transportVersion } : {}),
    ...(endpointPolicy ? { endpointPolicy } : {}),
    ...(implementationVersion ? { implementationVersion } : {}),
    configurationCurrent: Boolean(row.configurationCurrent),
    providerHealthEvidenceCurrent: Boolean(row.providerHealthEvidenceCurrent),
    ...(healthObservationId && healthStatus && healthCheckedByUserId &&
      healthCheckedAt && healthExpiresAt
      ? {
          latestHealthObservation: {
            id: healthObservationId,
            invocationBindingId: row.id,
            provider: row.provider,
            status: healthStatus,
            ...(healthFailureCode ? { failureCode: healthFailureCode } : {}),
            ...(healthSafeMessage ? { safeMessage: healthSafeMessage } : {}),
            checkedByUserId: healthCheckedByUserId,
            checkedAt: new Date(healthCheckedAt).toISOString(),
            expiresAt: new Date(healthExpiresAt).toISOString(),
            evidenceCurrent: Boolean(healthObservationCurrent),
            providerRequest: true,
            providerResponseStored: false,
            generation: false,
            implementationAvailable: Boolean(row.implementationAvailable),
            healthReady: Boolean(
              row.implementationAvailable && row.providerHealthEvidenceCurrent
            ),
            routingAvailable: false,
            adapterActivation: false,
            execution: false,
          },
        }
      : {}),
    configuredAt: new Date(row.configuredAt).toISOString(),
    ...(retiredByUserId ? { retiredByUserId } : {}),
    ...(retirementReason ? { retirementReason } : {}),
    ...(retiredAt ? { retiredAt: new Date(retiredAt).toISOString() } : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    implementationAvailable: Boolean(row.implementationAvailable),
    healthReady: Boolean(row.implementationAvailable && row.providerHealthEvidenceCurrent),
    routingAvailable: false,
    adapterActivation: false,
    execution: false,
  }));
}

async function selectWorkspaceAdapterRateBindings(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
  asOf: Date,
): Promise<AiWorkspaceAdapterRateBinding[]> {
  const rows = await client<(AiWorkspaceAdapterRateBinding & {
    components: StoredAiProviderRateCard["components"];
  })[]>`
    SELECT b.id, b.workspace_id, b.registration_id, b.rate_card_id,
      r.provider, r.model_id, r.display_name, b.status, b.currency,
      c.minor_unit_exponent, c.model_version,
      c.effective_from, c.effective_to, c.source_reference,
      c.source_hash, c.verified_at,
      b.bound_by AS bound_by_user_id,
      b.retired_by AS retired_by_user_id, b.retirement_reason,
      b.bound_at, b.retired_at, b.created_at, b.updated_at,
      (b.status = 'bound' AND r.status = 'registered' AND c.status = 'approved'
       AND b.rate_card_source_hash = c.source_hash
       AND c.effective_from <= ${asOf}
       AND (c.effective_to IS NULL OR c.effective_to > ${asOf})) AS evidence_current,
      (b.status = 'bound' AND r.status = 'registered' AND c.status = 'approved'
       AND b.rate_card_source_hash = c.source_hash
       AND c.effective_from <= ${asOf}
       AND (c.effective_to IS NULL OR c.effective_to > ${asOf})) AS pricing_ready,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kind', p.kind, 'unit', p.unit,
            'unitQuantity', p.unit_quantity,
            'priceMicros', p.price_micros::double precision
          ) ORDER BY p.kind, p.unit
        ) FILTER (WHERE p.rate_card_id IS NOT NULL),
        '[]'::jsonb
      ) AS components,
      false AS routing_available, false AS adapter_activation, false AS execution
    FROM workspace_ai_adapter_rate_binding b
    JOIN workspace_ai_adapter_registration r ON r.id = b.registration_id
    JOIN ai_provider_rate_card c ON c.id = b.rate_card_id
    LEFT JOIN ai_provider_rate_component p ON p.rate_card_id = c.id
    WHERE b.workspace_id = ${workspaceId}
    GROUP BY b.id, r.id, c.id
    ORDER BY b.updated_at DESC, b.id
  `;
  return rows.map(({
    effectiveTo,
    retiredByUserId,
    retirementReason,
    retiredAt,
    ...row
  }) => ({
    ...row,
    minorUnitExponent: Number(row.minorUnitExponent),
    components: row.components.map((component) => ({
      ...component,
      unitQuantity: Number(component.unitQuantity),
      priceMicros: Number(component.priceMicros),
    })),
    effectiveFrom: new Date(row.effectiveFrom).toISOString(),
    ...(effectiveTo ? { effectiveTo: new Date(effectiveTo).toISOString() } : {}),
    verifiedAt: new Date(row.verifiedAt).toISOString(),
    ...(retiredByUserId ? { retiredByUserId } : {}),
    ...(retirementReason ? { retirementReason } : {}),
    ...(retiredAt ? { retiredAt: new Date(retiredAt).toISOString() } : {}),
    boundAt: new Date(row.boundAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    evidenceCurrent: Boolean(row.evidenceCurrent),
    pricingReady: Boolean(row.pricingReady),
    routingAvailable: false,
    adapterActivation: false,
    execution: false,
  }));
}

async function selectProviderModelInventory(
  client: DatabaseClient | TransactionSql,
  workspaceId: string,
  provider: (typeof AI_HOSTED_PROVIDER_TYPES)[number],
): Promise<AiProviderModelInventoryItem[]> {
  const rows = await client<AiProviderModelInventoryItem[]>`
    SELECT workspace_id, provider, model_id, display_name,
      input_token_limit, output_token_limit, provider_created_at,
      first_seen_at, last_seen_at, retired_at,
      false AS adapter_activation, false AS execution
    FROM workspace_ai_provider_model
    WHERE workspace_id = ${workspaceId} AND provider = ${provider}
    ORDER BY (retired_at IS NOT NULL), model_id
  `;
  return rows.map(
    ({ displayName, inputTokenLimit, outputTokenLimit, providerCreatedAt, retiredAt, ...model }) => ({
      ...model,
      ...(displayName ? { displayName } : {}),
      ...(inputTokenLimit ? { inputTokenLimit } : {}),
      ...(outputTokenLimit ? { outputTokenLimit } : {}),
      ...(providerCreatedAt
        ? { providerCreatedAt: new Date(providerCreatedAt).toISOString() }
        : {}),
      firstSeenAt: new Date(model.firstSeenAt).toISOString(),
      lastSeenAt: new Date(model.lastSeenAt).toISOString(),
      ...(retiredAt ? { retiredAt: new Date(retiredAt).toISOString() } : {}),
      adapterActivation: false,
      execution: false,
    }),
  );
}

function normalizeAnalysisCacheEntry<TResult>(
  entry: StoredAiAnalysisCacheEntry<TResult>,
): StoredAiAnalysisCacheEntry<TResult> {
  return {
    ...entry,
    lastHitAt: entry.lastHitAt
      ? new Date(entry.lastHitAt).toISOString()
      : undefined,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
  };
}

function normalizeProviderRateCard(
  card: StoredAiProviderRateCard,
): StoredAiProviderRateCard {
  return {
    ...card,
    components: card.components.map((component) => ({
      ...component,
      unitQuantity: Number(component.unitQuantity),
      priceMicros: Number(component.priceMicros),
    })),
    effectiveFrom: new Date(card.effectiveFrom).toISOString(),
    effectiveTo: card.effectiveTo
      ? new Date(card.effectiveTo).toISOString()
      : undefined,
    verifiedAt: new Date(card.verifiedAt).toISOString(),
    approvedAt: card.approvedAt
      ? new Date(card.approvedAt).toISOString()
      : undefined,
    createdAt: new Date(card.createdAt).toISOString(),
  };
}

function normalizeCostQuote(
  quote: StoredAiCostQuote & { reservationId?: string | null },
  asOf: Date = new Date(),
): StoredAiCostQuote {
  const reservationId = quote.reservationId ?? undefined;
  const expiresAt = new Date(quote.expiresAt).toISOString();
  return {
    ...quote,
    campaignId: quote.campaignId ?? undefined,
    forecasts: quote.forecasts.map((forecast) => ({
      ...forecast,
      minimumUnits: Number(forecast.minimumUnits),
      maximumUnits: Number(forecast.maximumUnits),
    })),
    lines: quote.lines.map((line) => ({
      ...line,
      minimumUnits: Number(line.minimumUnits),
      maximumUnits: Number(line.maximumUnits),
      minimumCostMicros: Number(line.minimumCostMicros),
      maximumCostMicros: Number(line.maximumCostMicros),
    })),
    minimumCostMinor: Number(quote.minimumCostMinor),
    maximumCostMinor: Number(quote.maximumCostMinor),
    quotedAt: new Date(quote.quotedAt).toISOString(),
    expiresAt,
    createdAt: new Date(quote.createdAt).toISOString(),
    rounding: "ceil_to_minor_unit",
    reservationRequired: Number(quote.maximumCostMinor) > 0,
    reservationAuthorized: false,
    execution: false,
    reservationId,
    status: reservationId
      ? "consumed"
      : new Date(expiresAt) <= asOf
        ? "expired"
        : "active",
  };
}

function normalizeUsage(usage: StoredAiUsageEvent): StoredAiUsageEvent {
  return {
    ...usage,
    campaignId: usage.campaignId ?? undefined,
    promptVersion: usage.promptVersion ?? undefined,
    contextRevision: usage.contextRevision ?? undefined,
    contentHash: usage.contentHash ?? undefined,
    occurredAt: new Date(usage.occurredAt).toISOString(),
    createdAt: new Date(usage.createdAt).toISOString(),
  };
}

function normalizeBudgetAlert(alert: StoredAiBudgetAlert): AiBudgetAlert {
  return {
    ...alert,
    campaignId: alert.campaignId ?? undefined,
    sourceReservationId: alert.sourceReservationId ?? undefined,
    acknowledgedBy: alert.acknowledgedBy ?? undefined,
    acknowledgedAt: alert.acknowledgedAt
      ? new Date(alert.acknowledgedAt).toISOString()
      : undefined,
    createdAt: new Date(alert.createdAt).toISOString(),
    updatedAt: new Date(alert.updatedAt).toISOString(),
  };
}

function normalizeSpendException(
  request: StoredAiSpendExceptionRequest,
  asOf: Date = new Date(),
): AiSpendExceptionRequest {
  const expiresAt = new Date(request.expiresAt).toISOString();
  const consumedAt = request.consumedAt
    ? new Date(request.consumedAt).toISOString()
    : undefined;
  const appearsExpired =
    (request.status === "pending" || request.status === "approved") &&
    !consumedAt &&
    new Date(expiresAt) <= asOf;
  return {
    ...request,
    campaignId: request.campaignId ?? undefined,
    status: appearsExpired ? "expired" : request.status,
    exceededScopes: request.exceededScopes ?? [],
    resolvedBy: request.resolvedBy ?? undefined,
    decisionNote: request.decisionNote ?? undefined,
    expiresAt,
    resolvedAt: appearsExpired
      ? expiresAt
      : request.resolvedAt
        ? new Date(request.resolvedAt).toISOString()
        : undefined,
    consumedAt,
    createdAt: new Date(request.createdAt).toISOString(),
    updatedAt: new Date(request.updatedAt).toISOString(),
  };
}
