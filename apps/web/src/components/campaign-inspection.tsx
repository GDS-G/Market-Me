import type { CampaignStep, CampaignVersion } from "@market-me/domain";
import type { StoredCampaign } from "@market-me/database";
import styles from "./campaign-inspection.module.css";

export const CAMPAIGN_INSPECTION_LIMITS = Object.freeze({ steps: 100, dependencies: 20, goals: 20 });
export const CAMPAIGN_PLAN_SECTIONS = Object.freeze([
  { key: "currentVersion", status: "published", title: "Published plan", note: "This observed version is separate from unsaved edits and any draft below. Activation still needs a fresh review and current eligibility checks." },
  { key: "draftVersion", status: "draft", title: "Unpublished draft", note: "This saved draft has not been published. It cannot change the governing version of an existing run." },
] as const);

const words = (value: string) => value.replaceAll("_", " ");
const autonomousLabels: Readonly<Record<CampaignVersion["autonomyMode"], string>> = Object.freeze({
  draft_only: "Draft only — cannot activate",
  approval_required: "Review every action",
  campaign_approval: "Campaign approval required",
  fully_autonomous: "Autonomous where current policy permits",
  approve_uncertain: "Review uncertain actions — review currently retained",
  approve_first_occurrence: "Review first occurrence — review currently retained",
  confidence_based: "Confidence based — review currently retained",
  custom: "Custom — explicit step gates still apply",
});

/** Saved timing, not an eligibility promise or a request-start reservation. */
export function campaignInspectionTiming(step: CampaignStep): string {
  switch (step.scheduleType ?? "immediate") {
    case "immediate": return "When activated and eligible; not a promise of immediate execution.";
    case "dependency": return "After required predecessors satisfy their recorded completion requirements.";
    case "exact_time": return step.scheduledAt ? `Not before ${step.scheduledAt}; later execution is possible.` : "Exact time is incomplete; review the saved plan.";
    case "preferred_window": return step.preferredWindowStart && step.preferredWindowEnd
      ? `Request-start window: ${step.preferredWindowStart} inclusive to ${step.preferredWindowEnd} exclusive. Only supported bounded routes can execute.`
      : "Request-start window is incomplete; review the saved plan.";
    default: return `${words(step.scheduleType ?? "unknown")} — saved plan only; execution is not supported by this schedule mode.`;
  }
}

function VersionSummary({ version }: { version: CampaignVersion }) {
  const limits = CAMPAIGN_INSPECTION_LIMITS;
  return <>
    <dl className={styles.facts}>
      <div><dt>Version</dt><dd>{version.versionNumber} · {version.id}</dd></div>
      <div><dt>Objective</dt><dd>{words(version.objective)}</dd></div>
      <div><dt>Approval mode</dt><dd>{autonomousLabels[version.autonomyMode]}</dd></div>
      <div><dt>Timezone</dt><dd>{version.timezone}</dd></div>
      <div><dt>Copy controls</dt><dd>{words(version.informationDepth)} detail · {words(version.promotionalStrength)} promotion</dd></div>
      <div><dt>Bound references</dt><dd>{version.contentPackageIds.length} Content Packages · {version.audienceProfileVersionIds.length} audience versions · {version.brandProfileVersionId ? "Brand Profile version selected" : "No Brand Profile version"} · {version.destinationId ? "Destination selected" : "No Destination"}</dd></div>
    </dl>
    <h3>Planned steps ({version.steps.length})</h3>
    <p>Execution preferences and explicit approval flags are saved settings, not verified connection availability or permission to run. Other policy and approval gates still apply.</p>
    {version.steps.length === 0 ? <p>No workflow steps are saved.</p> : <ol className={styles.steps}>
      {version.steps.slice(0, limits.steps).map((step, index) => <li key={`${index}:${step.id}`}>
        <h4>{step.name}</h4>
        <dl className={styles.facts}>
          <div><dt>Operation</dt><dd>{words(step.operationType ?? "manual_handoff")}</dd></div>
          <div><dt>Timing</dt><dd>{campaignInspectionTiming(step)}</dd></div>
          <div><dt>Dependencies</dt><dd>{step.dependsOn.length ? step.dependsOn.slice(0, limits.dependencies).join(", ") : "None"}{step.dependsOn.length > limits.dependencies ? ` · showing ${limits.dependencies} of ${step.dependsOn.length}` : ""}</dd></div>
          <div><dt>Completion delay</dt><dd>{step.dependencyDelaySeconds ?? 0} seconds after required predecessors; not from saving this page.</dd></div>
          <div><dt>Execution preferences</dt><dd>{step.executionMethods.length ? step.executionMethods.map(words).join(", ") : "None saved"}</dd></div>
          <div><dt>Explicit step approval</dt><dd>{step.approvalRequired ? "Required" : "Not explicitly selected; campaign and policy gates may still require it"}</dd></div>
          <div><dt>Failure controls</dt><dd>{step.maxAttempts ?? 3} maximum attempts · {step.timeoutSeconds ?? 300} second timeout · {step.optional ? "Optional step" : "Required step"}</dd></div>
        </dl>
        <p className={styles.identity}>Step key: {step.id} · capability: {step.desiredCapability}</p>
      </li>)}
    </ol>}
    {version.steps.length > limits.steps && <p role="status">Showing the first {limits.steps} of {version.steps.length} steps. This summary is incomplete; it is not an activation review.</p>}
    <h3>Recorded success criteria ({version.successCriteria.length})</h3>
    {version.successCriteria.length === 0 ? <p>No success criteria are saved.</p> : <>
      <ul>{version.successCriteria.slice(0, limits.goals).map((goal, index) => <li key={`${index}:${goal.id}`}>
        {words(goal.eventType)}: {goal.metric === "value" ? `${String(goal.targetValue)} ${goal.currency} recorded value` : `${String(goal.targetCount)} recorded events`}
      </li>)}</ul>
      {version.successCriteria.length > limits.goals && <p>Showing {limits.goals} of {version.successCriteria.length} criteria.</p>}
      <p>When all criteria are met: {version.successAction === "pause" ? "pause before future workflow steps" : "notify workflow only"}. Saved targets are not measured results or attribution.</p>
    </>}
  </>;
}

/** Server-only presentation: deliberately omits context, inputs, outputs and conditions. */
export function CampaignInspection({ campaign }: { campaign: StoredCampaign }) {
  return <div className={styles.inspection}>
    <p>Read-only plan summary. Opening this page does not save, publish, approve, activate or send anything. It omits advanced input/output/context details and is not a complete eligibility check.</p>
    {CAMPAIGN_PLAN_SECTIONS.map(section => {
      const version = campaign[section.key];
      return <section className={styles.card} key={section.key}>
        <h2>{section.title}</h2><p>{section.note}</p>
        {!version ? <p>{section.key === "currentVersion" ? "No published plan yet." : "No separate unpublished draft."}</p>
          : version.campaignId !== campaign.id || version.status !== section.status
            ? <p role="status">The observed version is unavailable or changed. Reload before relying on this summary.</p>
            : <VersionSummary version={version} />}
      </section>;
    })}
  </div>;
}
