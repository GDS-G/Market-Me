import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptToken } from "@market-me/connectors";
import { MailchimpReportCollector } from "./report-collector";

const key = randomBytes(32).toString("base64");
const target = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  publicationActionId: "22222222-2222-4222-8222-222222222222",
  providerCampaignId: "campaign_1",
  audienceId: "audience_1",
  encryptedCredentials: encryptToken(`${"a".repeat(32)}-us21`, key),
  actorUserId: "33333333-3333-4333-8333-333333333333",
  attemptCount: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe("MailchimpReportCollector", () => {
  it("collects one bounded aggregate report and reschedules without recipient data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "campaign_1", list_id: "audience_1", emails_sent: 250,
      send_time: "2026-08-12T06:00:00Z",
      opens: { opens_total: 180, unique_opens: 120 },
      clicks: { clicks_total: 70, unique_clicks: 45 },
      unsubscribed: 3, bounces: { hard_bounces: 4, soft_bounces: 5 }, abuse_reports: 1,
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const record = vi.fn(async () => ({ created: true, publicationReconciled: false, snapshot: {} }));
    const complete = vi.fn(async () => undefined);
    const collector = new MailchimpReportCollector({
      claimMailchimpReportCollections: vi.fn(async () => [target]),
      recordMailchimpCampaignReportSnapshot: record,
      completeMailchimpReportCollection: complete,
    } as never, key, { batchSize: 10, refreshSeconds: 900, maxAgeSeconds: 604800 });

    await expect(collector.runOnce()).resolves.toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(record).toHaveBeenCalledWith(
      target.workspaceId,
      target.publicationActionId,
      expect.objectContaining({ campaignId: "campaign_1", audienceId: "audience_1", uniqueOpens: 120, uniqueClicks: 45 }),
      target.actorUserId,
    );
    expect(complete).toHaveBeenCalledWith(target.publicationActionId, { delaySeconds: 900 });
    expect(JSON.stringify(record.mock.calls)).not.toContain("email_address");
  });

  it("records only a closed credential failure and applies bounded backoff", async () => {
    const complete = vi.fn(async () => undefined);
    const collector = new MailchimpReportCollector({
      claimMailchimpReportCollections: vi.fn(async () => [{ ...target, encryptedCredentials: "invalid" }]),
      recordMailchimpCampaignReportSnapshot: vi.fn(),
      completeMailchimpReportCollection: complete,
    } as never, key, { batchSize: 10, refreshSeconds: 900, maxAgeSeconds: 604800 });

    await expect(collector.runOnce()).resolves.toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(complete).toHaveBeenCalledWith(target.publicationActionId, {
      delaySeconds: 3600,
      errorCode: "credential_unavailable",
    });
  });
});
