"use client";

import { useState, useSyncExternalStore } from "react";
import type {
  AiMode,
  AiModeIndicators,
  AiUsageSummary,
  AiBudgetStatus,
  AiBudgetAlert,
  AiSpendExceptionRequest,
  AiCapResponsePlan,
} from "@market-me/domain";
import { AI_MODES, AI_BUDGET_HISTORY_MISMATCH, formatAiBudgetMoney } from "@market-me/domain";
import type { WorkspaceAiPolicyWrite } from "@market-me/database";
import { aiPolicyChoiceLabel } from "./ai-policy-presentation";
import { AiPolicySaveRecovery, useAiPolicySaveRecovery } from "./ai-policy-save-recovery";
import { BudgetActionRecovery, useBudgetActionRecovery } from "./ai-budget-action-recovery";
import styles from "./ai-policy-save.module.css";
import unitStyles from "./ai-money-units.module.css";

const modeDescriptions: Readonly<Record<AiMode, string>> = {
  recommended: "Balances quality, speed, privacy, and cost for each task.",
  lower_cost: "Favors economical processing and cached analysis.",
  highest_quality: "Prioritizes complex analysis and important writing.",
  faster: "Favors low-latency processing and shorter paths.",
  private_local: "Keeps eligible processing on the device or private infrastructure.",
  custom: "Uses advanced routing choices configured for this workspace.",
};

export type AiPolicyFormProps = {
  userId: string;
  workspaceId: string;
  policyRevision: number;
  policy: WorkspaceAiPolicyWrite;
  usage: AiUsageSummary;
  budgetStatus: AiBudgetStatus;
  budgetAlerts: readonly AiBudgetAlert[];
  spendExceptions: readonly AiSpendExceptionRequest[];
  capResponses: readonly AiCapResponsePlan[];
  canRequestSpendException: boolean;
  canApproveSpendException: boolean;
  canEditPolicy: boolean;
  hasSavedPolicy: boolean;
  modeIndicators: Readonly<Record<AiMode, AiModeIndicators>>;
};
const subscribe = () => () => {}, browser = () => true, server = () => false;
export function AiPolicyForm(props: AiPolicyFormProps) {
  const ready = useSyncExternalStore(subscribe, browser, server);
  // Static preview never reads browser recovery storage. Remount once hydrated or scope changes.
  return <AiPolicyPanel key={JSON.stringify([props.userId, props.workspaceId, props.canEditPolicy, props.canRequestSpendException, props.canApproveSpendException, props.policyRevision, ready])} {...props} recoveryReady={ready} />;
}
export function AiPolicyPanel({
  userId,
  workspaceId,
  policyRevision,
  recoveryReady,
  policy,
  usage,
  budgetStatus,
  budgetAlerts,
  spendExceptions,
  capResponses,
  canRequestSpendException,
  canApproveSpendException,
  canEditPolicy,
  hasSavedPolicy,
  modeIndicators,
}: AiPolicyFormProps & { recoveryReady: boolean }) {
  const [exceptionJustification, setExceptionJustification] = useState("");
  const [selectedDeniedReservationId, setSelectedDeniedReservationId] = useState("");
  const unitsVerified = usage.unitIntegrity?.status === "compatible" && budgetStatus.unitIntegrity?.status === "compatible"
    && usage.unitIntegrity.ledgerExponent === 2 && budgetStatus.unitIntegrity.ledgerExponent === 2
    && usage.unitIntegrity.incompatibleReservationCount === 0 && budgetStatus.unitIntegrity.incompatibleReservationCount === 0
    && usage.currency === budgetStatus.currency;
  const money = (value: number, currency: string) => unitsVerified && currency === budgetStatus.currency ? formatAiBudgetMoney(value, currency) : "Unverified amount";
  const budgetRecovery = useBudgetActionRecovery({ userId, workspaceId, recoveryReady, canAcknowledge: canEditPolicy, canRequest: canRequestSpendException, canDecide: canApproveSpendException });
  const pendingAlertId = budgetRecovery.pending && budgetRecovery.attempt?.action.kind === "acknowledge_alert" ? budgetRecovery.attempt.action.targetId : undefined;
  const pendingSpendExceptionAction = budgetRecovery.pending && budgetRecovery.attempt?.action.kind === "request_exception" ? "request" : undefined;
  const recovery = useAiPolicySaveRecovery({ userId, workspaceId, policyRevision, policy, canEditPolicy, recoveryReady });
  const { values, setValues, pending, frozen } = recovery;
  const selectedIndicators = modeIndicators[values.mode];
  const monthlyBudgetMinor = budgetStatus.monthly.capMinor;
  const budgetPercent = monthlyBudgetMinor && unitsVerified
    ? Math.min(100, Math.round(((budgetStatus.monthly.spentMinor + budgetStatus.monthly.reservedMinor) / monthlyBudgetMinor) * 100))
    : undefined;
  const eligibleDeniedReservations = budgetStatus.recentReservations.filter(
    (reservation) =>
      reservation.status === "denied" &&
      reservation.capBehavior === "require_approval" &&
      !spendExceptions.some(
        (request) => request.deniedReservationId === reservation.id,
      ),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await recovery.run();
  }

  async function acknowledgeAlert(alertId: string) {
    await budgetRecovery.run({ kind: "acknowledge_alert", workspaceId, targetId: alertId });
  }

  async function requestSpendException(event: React.FormEvent) {
    event.preventDefault();
    if (!unitsVerified) return;
    const deniedReservationId =
      selectedDeniedReservationId || eligibleDeniedReservations[0]?.id;
    if (!deniedReservationId || !eligibleDeniedReservations.some(reservation => reservation.id === deniedReservationId)) return;
    await budgetRecovery.run({ kind: "request_exception", workspaceId, targetId: deniedReservationId, justification: exceptionJustification });
  }

  async function decideSpendException(
    requestId: string,
    decision: "approved" | "rejected",
  ) {
    if (decision === "approved" && !unitsVerified) return;
    await budgetRecovery.run({ kind: "decide_exception", workspaceId, targetId: requestId, decision });
  }

  return (
    <>
      <section className="resource-panel ai-mode-panel" id="ai-policy">
        <div className="resource-panel-head">
          <div>
            <p className="eyebrow">Outcome-first controls</p>
            <h2>AI mode</h2>
            <p>Choose the result you value. Model names stay in advanced details.</p>
          </div>
        </div>
        <div className="ai-mode-grid">
          {AI_MODES.map((mode) => {
            const indicators = modeIndicators[mode];
            return (
              <button
                className={`ai-mode-card ${values.mode === mode ? "selected" : ""}`}
                key={mode}
                disabled={frozen}
                aria-pressed={values.mode === mode}
                onClick={() => setValues((current) => ({ ...current, mode }))}
                type="button"
              >
                <strong>{label(mode)}</strong>
                <p>{modeDescriptions[mode]}</p>
                <small>
                  {label(indicators.quality)} quality · {label(indicators.speed)} ·{" "}
                  {label(indicators.privacy)} · {label(indicators.estimatedCost)} cost
                </small>
              </button>
            );
          })}
        </div>
        <p className="ai-selection-summary">
          {recovery.attempt ? "Retained request preference — see original result below" : aiPolicyChoiceLabel(values, policy, hasSavedPolicy)}: <strong>{label(values.mode)}</strong> · {label(selectedIndicators.quality)} quality ·{" "}
          {label(selectedIndicators.speed)} speed · {label(selectedIndicators.estimatedCost)} estimated cost
        </p>
        <p>These indicators describe a preference, not measured quality, verified model availability or a price quote. Choosing a mode does not run AI or authorize spending.</p>
        {!canEditPolicy && <p>An owner, admin or editor can change the policy. Your current access is read-only for these settings.</p>}
      </section>

      {canEditPolicy ? <form className="resource-panel ai-policy-form" onSubmit={submit}>
        <fieldset className={styles.fields} disabled={frozen} aria-label="AI policy settings">
        <div className="resource-panel-head">
          <div>
            <p className="eyebrow">Hard routing boundaries</p>
            <h2>Privacy, failover, and spend</h2>
            <p>Privacy is a hard filter. Failover never expands it silently.</p>
            <p>Loaded policy revision: {policyRevision}. Saving requires that revision to still be current. An unsaved policy uses revision zero.</p>
            {!recoveryReady && <p role="status">Loading saved policy requests…</p>}
          </div>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Maximum data exposure</span>
            <select value={values.maximumPrivacyClass} onChange={(event) => setValues((current) => ({ ...current, maximumPrivacyClass: event.target.value as typeof current.maximumPrivacyClass }))}>
              <option value="cloud">Cloud allowed</option>
              <option value="private_cloud">Private cloud or local only</option>
              <option value="local">Local only</option>
            </select>
          </label>
          <label className="field">
            <span>Provider failover</span>
            <select value={values.failoverMode} onChange={(event) => setValues((current) => ({ ...current, failoverMode: event.target.value as typeof current.failoverMode }))}>
              <option value="automatic_approved">Automatic approved backup</option>
              <option value="ask_before_switching">Ask before switching</option>
              <option value="no_external_fallback">No external fallback</option>
            </select>
          </label>
          <label className="field">
            <span>When a cap is reached</span>
            <select value={values.capBehavior} onChange={(event) => setValues((current) => ({ ...current, capBehavior: event.target.value as typeof current.capBehavior }))}>
              <option value="pause_ai_work">Pause AI work</option>
              <option value="lower_cost_fallback">Use lower-cost processing</option>
              <option value="limited_drafts">Create limited-analysis drafts</option>
              <option value="require_approval">Require spend approval</option>
            </select>
          </label>
          <label className="field">
            <span>Currency</span>
            <input maxLength={3} minLength={3} required value={values.currency} onChange={(event) => setValues((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} />
          </label>
          <Money label="Daily cap" value={values.dailyBudget} onChange={(dailyBudget) => setValues((current) => ({ ...current, dailyBudget }))} />
          <Money label="Campaign cap" value={values.campaignBudget} onChange={(campaignBudget) => setValues((current) => ({ ...current, campaignBudget }))} />
          <Money label="Monthly cap" value={values.monthlyBudget} onChange={(monthlyBudget) => setValues((current) => ({ ...current, monthlyBudget }))} />
          <label className="field">
            <span>Alert percentages</span>
            <input required value={values.alerts} onChange={(event) => setValues((current) => ({ ...current, alerts: event.target.value }))} placeholder="50, 80, 100" />
          </label>
        </div>
        <button className="button-primary" disabled={frozen} type="submit">
          {pending ? "Saving…" : "Save AI policy"}
        </button>
        </fieldset>
      </form> : <section className="resource-panel ai-policy-form" aria-label="Saved privacy and budget policy">
        <h2>Privacy and budget boundaries</h2>
        <p>{hasSavedPolicy ? "Saved workspace settings" : "Unsaved application defaults"}. Inspect these values without changing policy or granting execution.</p>
        <dl className="ai-policy-readonly">
          <dt>Maximum data exposure</dt><dd>{label(policy.maximumPrivacyClass)}</dd>
          <dt>Provider backup</dt><dd>{label(policy.failoverMode)}</dd>
          <dt>When a cap is reached</dt><dd>{label(policy.capBehavior)}</dd>
          <dt>Currency</dt><dd>{policy.currency}</dd>
          <dt>Daily cap</dt><dd>{policy.dailyBudgetMinor === undefined ? "No cap configured" : money(policy.dailyBudgetMinor, policy.currency)}</dd>
          <dt>Campaign cap</dt><dd>{policy.campaignBudgetMinor === undefined ? "No cap configured" : money(policy.campaignBudgetMinor, policy.currency)}</dd>
          <dt>Monthly cap</dt><dd>{policy.monthlyBudgetMinor === undefined ? "No cap configured" : money(policy.monthlyBudgetMinor, policy.currency)}</dd>
          <dt>Alert thresholds</dt><dd>{policy.alertThresholdPercentages.map(value => `${value}%`).join(", ")}</dd>
        </dl>
      </section>}
      {canEditPolicy && recoveryReady && <AiPolicySaveRecovery recovery={recovery} />}
      <p className={unitStyles.notice}>Budget amounts use two decimal places in the existing ledger. Quotes with a different money scale remain inspectable but cannot authorize spending; stored history is never converted automatically.</p>
      {!unitsVerified && <p role="alert" className={unitStyles.warning}>{budgetStatus.unitIntegrity?.status === "incompatible_history" || usage.unitIntegrity?.status === "incompatible_history"
        ? AI_BUDGET_HISTORY_MISMATCH : "Money-unit verification is unavailable. Monetary totals and new spend approvals are unavailable until verification succeeds."}</p>}

      <section className="resource-panel ai-usage-panel">
        <div className="resource-panel-head">
          <div>
            <p className="eyebrow">Current month</p>
            <h2>AI usage</h2>
            <p>Primary totals are shown as money; request and unit details remain advanced.</p>
          </div>
          <strong className="ai-spend">{money(usage.currentMonthCostMinor, usage.currency)}</strong>
        </div>
        {monthlyBudgetMinor && unitsVerified ? (
          <div className="ai-budget-progress">
            <div><span>Recorded spend plus active holds against the loaded monthly cap</span><strong>{budgetPercent}% of {money(monthlyBudgetMinor, budgetStatus.currency)}</strong></div>
            <div className="usage-track"><span style={{ width: `${budgetPercent}%` }} /></div>
          </div>
        ) : (
          <p>{monthlyBudgetMinor ? "Budget progress is unavailable until money units are verified." : "No monthly cap is configured."}</p>
        )}
        <details className="ai-advanced-usage">
          <summary>Advanced usage details</summary>
          <div className="metric-grid ai-usage-metrics">
            <UsageMetric label="Requests" value={usage.requestCount.toLocaleString()} />
            <UsageMetric label="Input units" value={usage.inputUnits.toLocaleString()} />
            <UsageMetric label="Cached input" value={usage.cachedInputUnits.toLocaleString()} />
            <UsageMetric label="Output units" value={usage.outputUnits.toLocaleString()} />
            <UsageMetric label="Average latency" value={usage.averageLatencyMs === undefined ? "—" : `${usage.averageLatencyMs} ms`} />
          </div>
          {usage.byFeature.length > 0 && (
            <div className="ai-feature-list">
              {usage.byFeature.map((item) => (
                <div key={item.feature}><span>{label(item.feature)}</span><strong>{money(item.costMinor, usage.currency)} · {item.requestCount} request{item.requestCount === 1 ? "" : "s"}</strong></div>
              ))}
            </div>
          )}
        </details>
      </section>

      <section className="resource-panel ai-budget-status-panel">
        <div className="resource-panel-head">
          <div>
            <p className="eyebrow">Transactional preflight</p>
            <h2>Budget authorization</h2>
            <p>Paid adapters must reserve a bounded estimate before execution, then settle actual cost or release the hold.</p>
          </div>
          <span className="status-pill status-green">Enforced in persistence</span>
        </div>
        <div className="ai-budget-scope-grid">
          <BudgetScope title="Today" status={budgetStatus.daily} currency={budgetStatus.currency} money={money} />
          <BudgetScope title="This month" status={budgetStatus.monthly} currency={budgetStatus.currency} money={money} />
          <article className="metric-card">
            <div><p>Active reservations</p><strong>{budgetStatus.activeReservationCount}</strong><small>15-minute authorization leases</small></div>
          </article>
        </div>
        <div className="ai-reservation-list">
          <h3>Recent authorization decisions</h3>
          {budgetStatus.recentReservations.length === 0 ? (
            <p>No paid AI spend has been reserved.</p>
          ) : budgetStatus.recentReservations.slice(0, 8).map((reservation) => {
            const capResponse = capResponses.find(
              (plan) => plan.deniedReservationId === reservation.id,
            );
            return (
              <article key={reservation.id}>
                <div>
                  <strong>{label(reservation.capability)}</strong>
                  <p>{label(reservation.feature)} · {money(reservation.estimatedCostMinor, reservation.currency)} estimated</p>
                  {capResponse && <small className="ai-cap-response-summary">{unitsVerified ? `Next: ${capResponseLabel(capResponse)} · ${capResponse.reasons[0]}` : "Money-unit verification is required before requesting or approving new spending. Inspection and rejection remain available."}</small>}
                </div>
                <span className={`status-pill ${reservation.status === "reserved" || reservation.status === "settled" ? "status-green" : reservation.status === "denied" ? "status-red" : "status-neutral"}`}>{label(reservation.status)}</span>
              </article>
            );
          })}
        </div>
      </section>

      <section className={`resource-panel ai-budget-alert-panel ${styles.budgetPanel}`}>
        <div className="resource-panel-head">
          <div>
            <p className="eyebrow">Configured threshold notices</p>
            <h2>Budget alerts</h2>
            <p>Accepted reservations create one durable notice when committed spend reaches a selected percentage.</p>
          </div>
          <span className={`status-pill ${budgetAlerts.some((alert) => alert.status === "open") ? "status-amber" : "status-green"}`}>
            {budgetAlerts.filter((alert) => alert.status === "open").length} open
          </span>
        </div>
        <div className="ai-budget-alert-list">
          {budgetAlerts.length === 0 ? (
            <p>No configured threshold has been reached.</p>
          ) : (
            budgetAlerts.slice(0, 12).map((alert) => (
              <article key={alert.id}>
                <div>
                  <strong>{alert.thresholdPercentage}% {budgetScopeLabel(alert.scope)}</strong>
                  <p>{money(alert.committedCostMinor, alert.currency)} committed of {money(alert.capMinor, alert.currency)} · {alertWindowLabel(alert)}</p>
                </div>
                {alert.status === "open" && canEditPolicy ? (
                  <button className="button-secondary" disabled={budgetRecovery.frozen} onClick={() => acknowledgeAlert(alert.id)} type="button">
                    {pendingAlertId === alert.id ? "Acknowledging…" : "Acknowledge"}
                  </button>
                ) : (
                  <span className="status-pill status-neutral">{alert.status === "open" ? "Open — a writer can acknowledge" : "Acknowledged"}</span>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      <BudgetActionRecovery recovery={budgetRecovery} />

      <section className={`resource-panel ai-spend-exception-panel ${styles.budgetPanel}`}>
        <div className="resource-panel-head">
          <div>
            <p className="eyebrow">One-time cap override</p>
            <h2>Spend exception approvals</h2>
            <p>Requests reuse an exact denied estimate. Only a server-side caller can consume an approved exception into one 15-minute reservation.</p>
          </div>
          <span className={`status-pill ${spendExceptions.some((request) => request.status === "pending") ? "status-amber" : "status-neutral"}`}>
            {spendExceptions.filter((request) => request.status === "pending").length} pending
          </span>
        </div>
        {canRequestSpendException && eligibleDeniedReservations.length > 0 && (
          <form className="ai-spend-exception-form" onSubmit={requestSpendException}>
            <label className="field">
              <span>Denied estimate</span>
              <select disabled={budgetRecovery.frozen} value={selectedDeniedReservationId || eligibleDeniedReservations[0]?.id} onChange={(event) => setSelectedDeniedReservationId(event.target.value)}>
                {eligibleDeniedReservations.map((reservation) => (
                  <option key={reservation.id} value={reservation.id}>{label(reservation.capability)} · {money(reservation.estimatedCostMinor, reservation.currency)} · {reservation.exceededScopes.map(label).join(", ")}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Business justification</span>
              <textarea disabled={budgetRecovery.frozen} maxLength={1000} required value={budgetRecovery.attempt?.action.kind === "request_exception" ? budgetRecovery.attempt.action.justification : exceptionJustification} onChange={(event) => setExceptionJustification(event.target.value)} placeholder="Explain why this one estimate should exceed the configured cap." />
            </label>
            <button className="button-secondary" disabled={budgetRecovery.frozen || !unitsVerified || !exceptionJustification.trim()} type="submit">
              {pendingSpendExceptionAction === "request" ? "Requesting…" : "Request approval"}
            </button>
          </form>
        )}
        <div className="ai-spend-exception-list">
          {spendExceptions.length === 0 ? (
            <p>No spend exception has been requested.</p>
          ) : spendExceptions.slice(0, 20).map((request) => (
            <article key={request.id}>
              <div>
                <strong>{label(request.capability)} · {money(request.estimatedCostMinor, request.currency)}</strong>
                <p>{request.exceededScopes.map(label).join(", ")} cap · expires {new Date(request.expiresAt).toLocaleString()}</p>
                <blockquote>{request.justification}</blockquote>
              </div>
              <div className="ai-spend-exception-actions">
                <span className={`status-pill ${request.status === "approved" ? "status-green" : request.status === "rejected" || request.status === "expired" ? "status-red" : "status-amber"}`}>{request.consumedAt ? "Consumed" : label(request.status)}</span>
                {request.status === "pending" && canApproveSpendException && (
                  <>
                    <button className="button-primary" disabled={budgetRecovery.frozen || !unitsVerified} onClick={() => decideSpendException(request.id, "approved")} type="button">Approve</button>
                    <button className="button-secondary" disabled={budgetRecovery.frozen} onClick={() => decideSpendException(request.id, "rejected")} type="button">Reject</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function Money({ label: text, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{text} (optional)</span><input min="0.01" step="0.01" type="number" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
function UsageMetric({ label: text, value }: { label: string; value: string }) {
  return <article className="metric-card"><div><p>{text}</p><strong>{value}</strong></div></article>;
}
function BudgetScope({ title, status, currency, money }: { title: string; status: AiBudgetStatus["daily"]; currency: string; money: typeof formatAiBudgetMoney }) {
  const committed = status.spentMinor + status.reservedMinor;
  return <article className="metric-card"><div><p>{title}</p><strong>{money(committed, currency)}</strong><small>{money(status.spentMinor, currency)} settled · {money(status.reservedMinor, currency)} reserved{status.capMinor === undefined ? " · no cap" : ` · ${money(status.availableMinor ?? 0, currency)} available`}</small></div></article>;
}
function label(value: string): string { return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()); }
function budgetScopeLabel(scope: AiBudgetAlert["scope"]): string { return scope === "campaign" ? "Campaign budget" : `${scope} budget`; }
function alertWindowLabel(alert: AiBudgetAlert): string { return alert.scope === "campaign" ? "Campaign lifetime" : alert.scope === "daily" ? alert.windowKey : `${alert.windowKey} UTC`; }
function capResponseLabel(plan: AiCapResponsePlan): string { return plan.status === "unavailable" ? "Manual alternative required" : label(plan.action); }
