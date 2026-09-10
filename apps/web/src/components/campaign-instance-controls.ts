import type { StoredCampaignInstance } from "@market-me/database";

/** Presentation/API precheck only; the repository repeats these invariants when queuing. */
export function campaignInstanceControls(instance: Pick<StoredCampaignInstance, "id" | "status" | "stepRuns">) {
  const runs = instance.stepRuns.filter((run) => run.campaignInstanceId === instance.id);
  const scheduleBlocked = runs.some((run) => run.status === "schedule_blocked");
  return {
    scheduleBlocked,
    canResume: instance.status === "paused" && !scheduleBlocked,
    canPause: ["active", "scheduled"].includes(instance.status) && !scheduleBlocked,
    canCancel: !["completed", "failed", "canceled", "archived"].includes(instance.status),
    manualRuns: !scheduleBlocked && ["active", "paused"].includes(instance.status)
      ? runs.filter((run) => run.status === "manual_resolution" && run.stepKey)
      : [],
  };
}
