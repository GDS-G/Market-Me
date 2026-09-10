import { validateCampaignExecution, type CampaignStep } from "@market-me/domain";
import type { CampaignRepository, CampaignWorkflowDefinition, StoredCampaign, StoredCampaignInstance } from "@market-me/database";

const OPEN_RUN_STATUSES = new Set(["awaiting_approval", "scheduled", "active", "paused"]);
const FINISHED_STEP_STATUSES = new Set(["succeeded", "partially_succeeded", "permanently_failed", "canceled", "rolled_back"]);

/** Counts describe saved state only; an enabled source is not necessarily healthy. */
export function summarizeWorkspace(input: {
  sources: readonly { enabled: boolean }[];
  packages: readonly { status: string }[];
  instances: readonly { status: string }[];
  campaignApprovals: readonly { status: string }[];
  draftApprovals: readonly { status: string }[];
}) {
  return {
    enabledSources: input.sources.filter((source) => source.enabled).length,
    packagesNeedingReview: input.packages.filter((item) => item.status === "needs_review").length,
    openRuns: input.instances.filter((instance) => OPEN_RUN_STATUSES.has(instance.status)).length,
    pendingApprovals: [...input.campaignApprovals, ...input.draftApprovals].filter((approval) => approval.status === "pending").length,
  };
}

/** UTC is explicit for general timestamps; campaign entries use their versioned timezone. */
export function formatDashboardTime(value: string, timezone = "UTC", precision: "minute" | "millisecond" = "minute"): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  try {
    const options: Intl.DateTimeFormatOptions = precision === "millisecond"
      ? { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, timeZone: timezone }
      : { dateStyle: "medium", timeStyle: "short", timeZone: timezone };
    return new Intl.DateTimeFormat("en-US", options).format(date) + ` (${timezone})`;
  } catch {
    return formatDashboardTime(value, "UTC", precision);
  }
}

export interface CampaignAgendaEntry {
  id: string;
  campaignId: string;
  campaignVersionId: string;
  campaignName: string;
  stepName: string;
  href: string;
  origin: "run" | "draft" | "published_plan";
  status: string;
  runStatus?: string;
  scheduledAt?: string;
  preferredWindowStart?: string;
  preferredWindowEnd?: string;
  dependencyDelaySeconds?: number;
  timezone: string;
  timing: string;
  warnings: readonly string[];
  finished: boolean;
}

function stepTiming(step: CampaignStep): Pick<CampaignAgendaEntry, "scheduledAt" | "preferredWindowStart" | "preferredWindowEnd" | "timing"> {
  const schedule = step.scheduleType ?? "immediate";
  if (schedule === "exact_time") {
    return step.scheduledAt && Number.isFinite(Date.parse(step.scheduledAt))
      ? { scheduledAt: new Date(step.scheduledAt).toISOString(), timing: "Exact-time target" }
      : { timing: "Exact time missing or invalid" };
  }
  if (schedule === "preferred_window") {
    const start = Date.parse(step.preferredWindowStart ?? "");
    const end = Date.parse(step.preferredWindowEnd ?? "");
    return Number.isFinite(start) && Number.isFinite(end) && start < end
      ? { preferredWindowStart: new Date(start).toISOString(), preferredWindowEnd: new Date(end).toISOString(), timing: "Preferred request-start window" }
      : { timing: "Preferred window missing or invalid — cannot activate" };
  }
  if (schedule === "dependency" || (schedule === "immediate" && step.dependsOn.length)) return { timing: "After dependencies; no fixed time" };
  if (step.operationType === "wait") return { timing: "Relative wait; no fixed time" };
  if (schedule === "immediate") return { timing: "When eligible; no fixed time" };
  return { timing: `${schedule.replaceAll("_", " ")} — scheduling not implemented` };
}

function campaignAgendaWarnings(autonomyMode: string, steps: readonly CampaignStep[]): { stepId?: string; message: string }[] {
  const warnings: { stepId?: string; message: string }[] = [...validateCampaignExecution(autonomyMode, steps, { allowBoundedScheduling: true })];
  for (const step of steps) {
    if (step.scheduleType === "preferred_window" && (step.operationType !== "publish_content"
      || step.executionMethods.length !== 1 || step.executionMethods[0] !== "official_api")) warnings.push({
      stepId: step.id, message: "This window cannot activate with its current operation or fallback methods; supported text publication requires only official API execution.",
    });
  }
  if (steps.some((step) => step.scheduleType === "preferred_window" || (step.dependencyDelaySeconds ?? 0) > 0)
    && steps.some((step) => step.executionMethods.includes("user_assisted"))) warnings.push({
    message: "Campaigns combining bounded scheduling with companion execution remain saved-only.",
  });
  return warnings;
}

/** Build a read-only view. Never substitute today's campaign version for a historical run. */
export function buildCampaignAgenda(
  workspaceId: string,
  campaigns: readonly StoredCampaign[],
  instances: readonly StoredCampaignInstance[],
  definitions: readonly CampaignWorkflowDefinition[],
): CampaignAgendaEntry[] {
  const scopedCampaigns = campaigns.filter((campaign) => campaign.workspaceId === workspaceId);
  const scopedInstances = instances.filter((instance) => instance.workspaceId === workspaceId);
  const names = new Map(scopedCampaigns.map((campaign) => [campaign.id, campaign.name]));
  const definitionsByInstance = new Map(definitions.filter((definition) => definition.workspaceId === workspaceId).map((definition) => [definition.instanceId, definition]));
  const entries: CampaignAgendaEntry[] = [];

  for (const instance of scopedInstances) {
    const definition = definitionsByInstance.get(instance.id);
    const base = {
      campaignId: instance.campaignId,
      campaignVersionId: instance.campaignVersionId,
      campaignName: names.get(instance.campaignId) ?? "Campaign run",
      href: `/campaign-instances/${instance.id}`,
      origin: "run" as const,
      runStatus: instance.status,
    };
    if (!definition || definition.campaignVersionId !== instance.campaignVersionId || definition.campaignId !== instance.campaignId) {
      entries.push({ ...base, id: instance.id, stepName: "Run schedule unavailable", status: instance.status, timezone: "UTC", timing: "No verified schedule snapshot", warnings: ["Open the run to inspect its recorded state."], finished: !OPEN_RUN_STATUSES.has(instance.status) });
      continue;
    }
    const issues = campaignAgendaWarnings(definition.autonomyMode, definition.steps);
    for (const step of definition.steps) {
      const run = instance.stepRuns.find((candidate) => candidate.campaignInstanceId === instance.id && candidate.stepKey === step.id);
      entries.push({
        ...base,
        id: `${instance.id}:${step.id}`,
        stepName: step.name,
        status: run?.status ?? "planned",
        timezone: definition.timezone,
        dependencyDelaySeconds: step.dependencyDelaySeconds ?? 0,
        ...stepTiming(step),
        warnings: [
          ...issues.filter((issue) => !issue.stepId || issue.stepId === step.id).map((issue) => issue.message),
          ...(run?.status === "schedule_blocked" ? ["Schedule blocked: the permitted request-start window was missed. Cancel this run and review a revised plan; do not resume or mark it manually complete."] : []),
        ],
        finished: !OPEN_RUN_STATUSES.has(instance.status) || FINISHED_STEP_STATUSES.has(run?.status ?? "planned"),
      });
    }
  }

  for (const campaign of scopedCampaigns) {
    if (campaign.status === "archived") continue;
    // Preserve both the current published plan and newer draft. A version represented by a run
    // is not also labeled unactivated, and historical superseded definitions remain run-only.
    const versions = [campaign.draftVersion, campaign.currentVersion].filter(
      (version, index, candidates) => version
        && candidates.findIndex((candidate) => candidate?.id === version.id) === index
        && !scopedInstances.some((instance) => instance.campaignVersionId === version.id),
    );
    for (const version of versions) {
      if (!version) continue;
      const issues = campaignAgendaWarnings(version.autonomyMode, version.steps);
      for (const step of version.steps) entries.push({
        id: `${version.id}:${step.id}`,
        campaignId: campaign.id,
        campaignVersionId: version.id,
        campaignName: campaign.name,
        stepName: step.name,
        href: `/campaigns/${campaign.id}/edit`,
        origin: version.status === "draft" ? "draft" : "published_plan",
        status: "Not activated",
        timezone: version.timezone,
        dependencyDelaySeconds: step.dependencyDelaySeconds ?? 0,
        ...stepTiming(step),
        warnings: issues.filter((issue) => !issue.stepId || issue.stepId === step.id).map((issue) => issue.message),
        finished: false,
      });
    }
  }
  return entries.sort((a, b) => {
    const aTime = a.scheduledAt ?? a.preferredWindowStart;
    const bTime = b.scheduledAt ?? b.preferredWindowStart;
    if (aTime && bTime) return aTime.localeCompare(bTime) || a.id.localeCompare(b.id);
    if (aTime) return -1;
    if (bTime) return 1;
    return a.campaignName.localeCompare(b.campaignName) || a.id.localeCompare(b.id);
  });
}

/** Instance IDs come exclusively from the authorized workspace query; bound concurrent snapshot reads. */
export async function loadCampaignAgenda(workspaceId: string, repository: Pick<CampaignRepository, "listCampaigns" | "listCampaignInstances" | "getWorkflowDefinition">) {
  const [campaigns, instances] = await Promise.all([repository.listCampaigns(workspaceId), repository.listCampaignInstances(workspaceId)]);
  const definitions: CampaignWorkflowDefinition[] = [];
  const scopedInstances = instances.filter((instance) => instance.workspaceId === workspaceId);
  for (let offset = 0; offset < scopedInstances.length; offset += 10) {
    const batch = await Promise.all(scopedInstances.slice(offset, offset + 10).map((instance) => repository.getWorkflowDefinition(instance.id)));
    definitions.push(...batch.filter((definition): definition is CampaignWorkflowDefinition => Boolean(definition)));
  }
  return { campaigns: campaigns.filter((campaign) => campaign.workspaceId === workspaceId), entries: buildCampaignAgenda(workspaceId, campaigns, scopedInstances, definitions) };
}
