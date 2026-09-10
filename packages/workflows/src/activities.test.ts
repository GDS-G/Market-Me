import { describe, expect, it, vi } from "vitest";
import type { CampaignRepository } from "@market-me/database";
import { createCampaignActivities } from "./activities";

describe("persisted campaign execution authority", () => {
  it("stops an already-queued activity before the executor when persisted approval is missing", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("This campaign action has not been approved for execution."));
    const execute = vi.fn();
    const repository = { assertStepExecutionAuthorized: verify } as unknown as CampaignRepository;
    await expect(createCampaignActivities(repository, { execute }).executeStep({ instanceId: "legacy-run", stepKey: "publish", context: {} })).rejects.toThrow("has not been approved");
    expect(verify).toHaveBeenCalledWith("legacy-run", "publish");
    expect(execute).not.toHaveBeenCalled();
  });

  it("checks the exact stored target before allowing the executor", async () => {
    const events: string[] = [];
    const repository = { assertStepExecutionAuthorized: async () => { events.push("authorized"); } } as unknown as CampaignRepository;
    const activities = createCampaignActivities(repository, { execute: async () => { events.push("execute"); return { status: "succeeded", output: { externalId: "publication" } }; } });
    expect(await activities.executeStep({ instanceId: "approved-run", stepKey: "publish", context: {} })).toEqual({ status: "succeeded", output: { externalId: "publication" } });
    expect(events).toEqual(["authorized", "execute"]);
  });
});
