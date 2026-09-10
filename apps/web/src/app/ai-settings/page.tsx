import { getActiveWorkspace } from "@/server/active-workspace";
import { redirect } from "next/navigation";
import { Cpu, ShieldCheck } from "lucide-react";
import { AI_ASSISTANT_ACTIONS, AI_CAPABILITIES, AI_HOSTED_PROVIDER_TYPES, type AiCostQuoteLedgerItem, type AiStoredCostQuote } from "@market-me/domain";
import { AI_ASSISTANT_PROFILES, planAiAssistantCost, planAiAssistantWork, planAiCapResponse, quoteAiCost, routeAiTask, selectAiAssistant } from "@market-me/generation";
import { AiPolicyForm } from "@/components/ai-policy-form";
import { AiAssistantAssignments } from "@/components/ai-assistant-assignments";
import { AiQuoteLedger } from "@/components/ai-quote-ledger";
import { AiRoutingPreferences } from "@/components/ai-routing-preferences";
import { AiProviderConnections } from "@/components/ai-provider-connections";
import { AiAdapterCandidates } from "@/components/ai-adapter-candidates";
import { AiAdapterRegistrations } from "@/components/ai-adapter-registrations";
import { AiAdapterRateBindings } from "@/components/ai-adapter-rate-bindings";
import { AiAdapterInvocationBindings } from "@/components/ai-adapter-invocation-bindings";
import { AiTextInvocationIntents } from "@/components/ai-text-invocation-intents";
import { AiExecutionControl } from "@/components/ai-execution-control";
import { AiOperationalIncidents } from "@/components/ai-operational-incidents";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { defaultWorkspaceAiPolicy } from "@/server/ai-schema";
import { getAiRepository, getDraftRepository } from "@/server/database";
import { getServerConfiguration } from "@/server/config";
import { AI_MODE_INDICATORS } from "@market-me/generation";

export default async function AiSettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const workspace = await getActiveWorkspace(user.id);
  if (!workspace) redirect("/login");
  const canEdit = ["owner", "admin", "editor"].includes(workspace.role);
  const canApprove = ["owner", "admin", "approver"].includes(workspace.role);
  const canManageExecution = ["owner", "admin"].includes(workspace.role);
  const serverConfiguration = getServerConfiguration();
  const repository = getAiRepository();
  const policy =
    (await repository.getPolicy(workspace.workspaceId)) ??
    defaultWorkspaceAiPolicy(workspace.workspaceId);
  const pricingAsOf = new Date();
  const [usage, budgetStatus, budgetAlerts, spendExceptions, assistantAssignments, routingPreferences, providerConnections, providerAdapters, adapterRegistry, analysisCache, rateCards, effectiveRateCards, costQuotes] = await Promise.all([
    repository.getCurrentMonthUsage(workspace.workspaceId, policy.currency),
    repository.getBudgetStatus(workspace.workspaceId, policy.currency),
    repository.listBudgetAlerts(workspace.workspaceId, policy.currency),
    repository.listSpendExceptions(workspace.workspaceId, policy.currency),
    repository.listAssistantAssignments(workspace.workspaceId),
    repository.listRoutingPreferences(workspace.workspaceId),
    repository.listProviderConnections(workspace.workspaceId, user.id),
    repository.listProviderAdapters(),
    repository.getProviderAdapterRegistrySummary(),
    repository.getAnalysisCacheSummary(workspace.workspaceId),
    repository.getProviderRateCardSummary(pricingAsOf),
    repository.listEffectiveProviderRateCards(pricingAsOf, policy.currency),
    repository.listCostQuotes(workspace.workspaceId, user.id, 20, pricingAsOf),
  ]);
  const referenceRateCard = effectiveRateCards.find(
    (card) =>
      card.provider === "market-me" &&
      card.modelFamily === "grounded-template" &&
      card.components.every((component) => component.kind === "request"),
  );
  const providerModelInventories = canEdit
    ? await Promise.all(
        AI_HOSTED_PROVIDER_TYPES.map(async (provider) => ({
          provider,
          ...(await repository.listProviderModelInventory(
            workspace.workspaceId,
            provider,
            user.id,
          )),
        })),
      )
    : [];
  const [executionControl, providerCircuits, operationalIncidentPolicy, operationalIncidents, operationalReadiness, adapterCandidates, adapterRegistrations, adapterRateBindings, invocationContracts, adapterInvocationBindings, textInvocationIntents, textInvocationAttempts, textOutputArtifacts, textInvocationReconciliations, textInvocationResolutions, operationalAlertWebhook, operationalAlertDeliveries] = await Promise.all([
    repository.getWorkspaceExecutionControl(workspace.workspaceId, user.id),
    repository.listWorkspaceProviderCircuits(workspace.workspaceId, user.id),
    repository.getWorkspaceAiOperationalIncidentResponsePolicy(workspace.workspaceId, user.id),
    repository.listWorkspaceAiOperationalIncidents(workspace.workspaceId, user.id, pricingAsOf),
    repository.getWorkspaceAiOperationalReadiness(workspace.workspaceId, user.id, pricingAsOf),
    repository.listWorkspaceAdapterCandidates(workspace.workspaceId, user.id),
    repository.listWorkspaceAdapterRegistrations(workspace.workspaceId, user.id),
    repository.listWorkspaceAdapterRateBindings(workspace.workspaceId, user.id, pricingAsOf),
    repository.listProviderInvocationContracts(workspace.workspaceId, user.id),
    repository.listWorkspaceAdapterInvocationBindings(workspace.workspaceId, user.id, pricingAsOf),
    repository.listWorkspaceTextInvocationIntents(workspace.workspaceId, user.id, pricingAsOf),
    repository.listWorkspaceTextInvocationAttempts(workspace.workspaceId, user.id),
    repository.listWorkspaceTextOutputArtifacts(workspace.workspaceId, user.id),
    repository.listWorkspaceTextInvocationReconciliations(workspace.workspaceId, user.id),
    repository.listWorkspaceTextInvocationResolutions(workspace.workspaceId, user.id),
    repository.getWorkspaceAiOperationalAlertWebhook(workspace.workspaceId, user.id),
    repository.listWorkspaceAiOperationalAlertDeliveries(workspace.workspaceId, user.id, 20),
  ]);
  const editableDrafts = (await getDraftRepository().list(workspace.workspaceId))
    .filter((draft) => ["working", "changes_requested"].includes(draft.status));
  const textDraftProposals = (await Promise.all(editableDrafts.map((draft) =>
    repository.listWorkspaceTextDraftProposals(workspace.workspaceId, draft.id, user.id),
  ))).flat();
  const referenceQuote = referenceRateCard
    ? quoteAiCost(referenceRateCard, [], pricingAsOf)
    : undefined;
  const capabilities = AI_CAPABILITIES.map((capability) => ({
    capability,
    decision: routeAiTask(
      {
        capability,
        mode: policy.mode,
        maximumPrivacyClass: policy.maximumPrivacyClass,
      },
      providerAdapters,
    ),
  }));
  const capResponses = budgetStatus.recentReservations
    .filter((reservation) => reservation.status === "denied")
    .map((reservation) =>
      planAiCapResponse(
        {
          reservation,
          maximumPrivacyClass: policy.maximumPrivacyClass,
        },
        providerAdapters.filter((adapter) => !adapter.requiresPaidReservation),
      ),
    );
  const assistantByAction = new Map(
    assistantAssignments.map((assignment) => [
      assignment.action,
      assignment.profileId,
    ]),
  );
  const routeByAction = new Map(
    routingPreferences.map((preference) => [
      preference.action,
      { provider: preference.provider, model: preference.model },
    ]),
  );
  const assistantSelections = AI_ASSISTANT_ACTIONS.map((action) =>
    selectAiAssistant(action, assistantByAction.get(action)),
  );
  const automaticAssistantSelections = AI_ASSISTANT_ACTIONS.map((action) =>
    selectAiAssistant(action),
  );
  const assistantWorkPlans = AI_ASSISTANT_ACTIONS.map((action) =>
    planAiAssistantWork(
      {
        action,
        profileId: assistantByAction.get(action),
        mode: policy.mode,
        maximumPrivacyClass: policy.maximumPrivacyClass,
        ...(routeByAction.get(action)
          ? { routingPreference: routeByAction.get(action)! }
          : {}),
      },
      providerAdapters,
    ),
  );
  const assistantCostPreviews = AI_ASSISTANT_ACTIONS.map((action) =>
    planAiAssistantCost(
      {
        action,
        ...(assistantByAction.get(action)
          ? { profileId: assistantByAction.get(action)! }
          : {}),
        mode: policy.mode,
        maximumPrivacyClass: policy.maximumPrivacyClass,
        ...(routeByAction.get(action)
          ? { routingPreference: routeByAction.get(action)! }
          : {}),
        rateCards: effectiveRateCards,
        quotedAt: pricingAsOf,
      },
      providerAdapters,
    ),
  );

  return (
    <WorkspaceShell activePath="/ai-settings" workspaceName={workspace.workspaceName} userName={user.displayName}>
      <div className="resource-page">
        <header className="resource-header">
          <div>
            <p className="eyebrow">Provider-neutral model gateway</p>
            <h1>AI &amp; cost controls</h1>
            <p>Choose an outcome, enforce privacy and spend boundaries, and inspect technical usage only when needed.</p>
          </div>
          <ShieldCheck size={26} aria-hidden="true" />
        </header>
        <AiExecutionControl
          workspaceId={workspace.workspaceId}
          control={executionControl}
          circuits={providerCircuits}
          deploymentExecutionEnabled={serverConfiguration.aiProviderExecutionEnabled}
          canManage={canManageExecution}
        />
        <AiOperationalIncidents
          workspaceId={workspace.workspaceId}
          incidents={operationalIncidents}
          readiness={operationalReadiness}
          policy={operationalIncidentPolicy}
          canAcknowledge={canApprove}
          canManagePolicy={canManageExecution}
          webhook={operationalAlertWebhook}
          deliveries={operationalAlertDeliveries}
          canManageAlert={canManageExecution}
          alertDeploymentConfigured={
            Buffer.from(serverConfiguration.aiOperationalAlertEncryptionKey ?? "", "base64").length === 32 &&
            serverConfiguration.aiOperationalAlertAllowedHosts.length > 0
          }
        />
        <AiPolicyForm workspaceId={workspace.workspaceId} policy={policy} usage={usage} budgetStatus={budgetStatus} budgetAlerts={budgetAlerts} spendExceptions={spendExceptions} capResponses={capResponses} canRequestSpendException={["owner", "admin", "editor"].includes(workspace.role)} canApproveSpendException={["owner", "admin", "approver"].includes(workspace.role)} modeIndicators={AI_MODE_INDICATORS} />
        <AiAssistantAssignments
          workspaceId={workspace.workspaceId}
          profiles={AI_ASSISTANT_PROFILES}
          selections={assistantSelections}
          automaticSelections={automaticAssistantSelections}
          workPlans={assistantWorkPlans}
          costPreviews={assistantCostPreviews}
          canEdit={["owner", "admin", "editor"].includes(workspace.role)}
        />
        <AiRoutingPreferences
          workspaceId={workspace.workspaceId}
          preferences={routingPreferences}
          selections={assistantSelections}
          adapters={providerAdapters}
          canEdit={["owner", "admin", "editor"].includes(workspace.role)}
        />
        <AiProviderConnections
          workspaceId={workspace.workspaceId}
          connections={providerConnections}
          canEdit={canEdit}
          vaultConfigured={Buffer.from(serverConfiguration.aiProviderCredentialEncryptionKey ?? "", "base64").length === 32}
          modelInventories={providerModelInventories}
        />
        <AiAdapterCandidates
          workspaceId={workspace.workspaceId}
          inventories={providerModelInventories}
          candidates={adapterCandidates}
          canSubmit={canEdit}
          canDecide={["owner", "admin"].includes(workspace.role)}
        />
        <AiAdapterRegistrations
          workspaceId={workspace.workspaceId}
          candidates={adapterCandidates}
          registrations={adapterRegistrations}
          canManage={["owner", "admin"].includes(workspace.role)}
        />
        <AiAdapterRateBindings
          workspaceId={workspace.workspaceId}
          registrations={adapterRegistrations}
          bindings={adapterRateBindings}
          rateCards={effectiveRateCards}
          canManage={["owner", "admin"].includes(workspace.role)}
        />
        <AiAdapterInvocationBindings
          workspaceId={workspace.workspaceId}
          rateBindings={adapterRateBindings}
          contracts={invocationContracts}
          bindings={adapterInvocationBindings}
          canManage={["owner", "admin"].includes(workspace.role)}
        />
        <AiTextInvocationIntents
          workspaceId={workspace.workspaceId}
          bindings={adapterInvocationBindings}
          reservations={budgetStatus.recentReservations}
          intents={textInvocationIntents}
          attempts={textInvocationAttempts}
          outputArtifacts={textOutputArtifacts}
          reconciliations={textInvocationReconciliations}
          resolutions={textInvocationResolutions}
          draftTargets={editableDrafts.map((draft) => ({ id: draft.id, label: `${draft.currentVersion.headline} — ${draft.campaignName}` }))}
          draftProposals={textDraftProposals}
          canEdit={canEdit}
          canApprove={canApprove}
          executionAvailable={
            serverConfiguration.aiProviderExecutionEnabled &&
            Buffer.from(serverConfiguration.aiProviderCredentialEncryptionKey ?? "", "base64").length === 32 &&
            executionControl.executionAllowed
          }
        />
        <section className="resource-panel ai-adapter-registry-panel">
          <div className="resource-panel-head">
            <div>
              <p className="eyebrow">Deployment-owned routing inventory</p>
              <h2>Provider adapter registry</h2>
              <p>Server-governed identities and capabilities drive routing. Registry records contain no provider credentials and do not authorize execution.</p>
            </div>
            <span className="status-pill status-green">Server governed</span>
          </div>
          <div className="metric-grid ai-cache-metrics">
            <article className="metric-card"><div><p>Registered</p><strong>{adapterRegistry.totalAdapterCount.toLocaleString()}</strong><small>Exact provider/model identities</small></div></article>
            <article className="metric-card"><div><p>Approved</p><strong>{adapterRegistry.approvedAdapterCount.toLocaleString()}</strong><small>Governance state, not execution authority</small></div></article>
            <article className="metric-card"><div><p>Available</p><strong>{adapterRegistry.availableAdapterCount.toLocaleString()}</strong><small>Deployment-observed readiness</small></div></article>
            <article className="metric-card"><div><p>Capabilities</p><strong>{adapterRegistry.capabilityCount.toLocaleString()}</strong><small>Closed gateway capabilities</small></div></article>
          </div>
          <div className="ai-capability-list">
            {providerAdapters.map((adapter) => (
              <article key={`${adapter.provider}/${adapter.model}`}>
                <div><strong>{adapter.displayName}</strong><p>{adapter.provider}/{adapter.model} · {adapter.capabilities.map(label).join(", ")} · {adapter.requiresPaidReservation ? "paid reservation required" : "no paid reservation"}</p></div>
                <span className={`status-pill ${adapter.approved && adapter.available ? "status-green" : "status-amber"}`}>{adapter.approved && adapter.available ? "Approved · Available" : adapter.available ? "Not approved" : "Unavailable"}</span>
              </article>
            ))}
          </div>
          <p className="ai-selection-summary">Registry verification is metadata evidence only. Credentials, provider health checks, invocation, usage settlement, and administrator mutation remain separate future boundaries.</p>
        </section>
        <section className="resource-panel ai-rate-card-panel">
          <div className="resource-panel-head">
            <div>
              <p className="eyebrow">Verified pricing inputs</p>
              <h2>Provider rate cards</h2>
              <p>Server-owned, source-hashed price versions are selected by provider, model family, currency, and half-open effective window.</p>
            </div>
            <span className="status-pill status-green">Action quote profiles ready</span>
          </div>
          <div className="metric-grid ai-cache-metrics">
            <article className="metric-card"><div><p>Effective cards</p><strong>{rateCards.activeCardCount.toLocaleString()}</strong><small>Approved at this request time</small></div></article>
            <article className="metric-card"><div><p>Currencies</p><strong>{rateCards.currencies.length ? rateCards.currencies.join(", ") : "None"}</strong><small>Exact three-letter codes</small></div></article>
            <article className="metric-card"><div><p>Reference provider charge</p><strong>{referenceQuote ? formatQuote(referenceQuote.minimumCostMinor, referenceQuote.maximumCostMinor, referenceQuote.currency, referenceQuote.minorUnitExponent) : "Unavailable"}</strong><small>{referenceQuote ? "Quote only; no reservation or execution" : "No exact request-only card"}</small></div></article>
            <article className="metric-card"><div><p>Action quote coverage</p><strong>{assistantCostPreviews.filter((preview) => preview.status === "quoted").length} of {assistantCostPreviews.length}</strong><small>Server-owned metering profiles</small></div></article>
          </div>
          <p className="ai-selection-summary">Each ready action is matched to a closed server-owned metering profile and its policy-eligible effective rate card. A strict action quote request can persist that exact envelope; previewing or creating it never calls a provider, reserves spend, or authorizes execution.</p>
        </section>
        <AiQuoteLedger
          workspaceId={workspace.workspaceId}
          quotes={costQuotes.map(presentQuote)}
          canEdit={["owner", "admin", "editor"].includes(workspace.role)}
        />
        <section className="resource-panel ai-cache-panel">
          <div className="resource-panel-head">
            <div>
              <p className="eyebrow">Reusable analysis</p>
              <h2>Analysis cache</h2>
              <p>Exact content, model-family, prompt-version, and context-revision matches may reuse a server-held result. Payloads are never returned to this page.</p>
            </div>
            <span className="status-pill status-green">Server-only payloads</span>
          </div>
          <div className="metric-grid ai-cache-metrics">
            <article className="metric-card"><div><p>Active entries</p><strong>{analysisCache.activeEntryCount.toLocaleString()}</strong><small>Unexpired exact-key results</small></div></article>
            <article className="metric-card"><div><p>Cache hits</p><strong>{analysisCache.totalHitCount.toLocaleString()}</strong><small>Successful internal reuse</small></div></article>
            <article className="metric-card"><div><p>Stored result size</p><strong>{formatBytes(analysisCache.totalResultBytes)}</strong><small>Metadata total only</small></div></article>
          </div>
          <p className="ai-selection-summary">Cache keys include workspace, capability, feature, SHA-256 content identity, model family, prompt version, and context revision. A near match is a miss.</p>
        </section>
        <section className="resource-panel ai-capability-panel">
          <div className="resource-panel-head">
            <div><p className="eyebrow">Routing readiness</p><h2>Capabilities</h2><p>The grounded local adapter is active. Unsupported work fails closed until an approved adapter is configured.</p></div>
            <Cpu size={21} aria-hidden="true" />
          </div>
          <div className="ai-capability-list">
            {capabilities.map(({ capability, decision }) => (
              <article key={capability}>
                <div><strong>{label(capability)}</strong><p>{decision.reasons[0]}</p></div>
                <span className={`status-pill ${decision.status === "selected" ? "status-green" : "status-amber"}`}>{decision.status === "selected" ? decision.adapter?.displayName : "Not configured"}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}

function label(value: string) { return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()); }

function presentQuote(quote: AiStoredCostQuote): AiCostQuoteLedgerItem {
  return {
    id: quote.id,
    ...(quote.campaignId ? { campaignId: quote.campaignId } : {}),
    capability: quote.capability,
    feature: quote.feature,
    currency: quote.currency,
    minorUnitExponent: quote.minorUnitExponent,
    minimumCostMinor: quote.minimumCostMinor,
    maximumCostMinor: quote.maximumCostMinor,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt,
    status: quote.status,
    ...(quote.reservationId ? { reservationId: quote.reservationId } : {}),
    reservationRequired: quote.reservationRequired,
    reservationAuthorized: false,
    execution: false,
  };
}

function formatBytes(value: number) {
  if (value < 1_024) return `${value} B`;
  return `${(value / 1_024).toFixed(1)} KiB`;
}

function formatQuote(
  minimumMinor: number,
  maximumMinor: number,
  currency: string,
  exponent: number,
) {
  const divisor = 10 ** exponent;
  const format = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  const minimum = format.format(minimumMinor / divisor);
  const maximum = format.format(maximumMinor / divisor);
  return minimum === maximum ? minimum : `${minimum}–${maximum}`;
}
