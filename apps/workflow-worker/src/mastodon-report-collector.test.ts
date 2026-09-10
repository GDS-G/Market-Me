import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptToken } from "@market-me/connectors";
import { MastodonReportCollectionClaimLostError } from "@market-me/database";
import { MastodonReportCollector } from "./mastodon-report-collector";

const key = randomBytes(32).toString("base64");
const token = "mastodon-collector-token-abcdefghijklmnopqrstuvwxyz";
const target = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  publicationActionId: "22222222-2222-4222-8222-222222222222",
  providerStatusId: "status-collector-1",
  providerAccountId: "account-1",
  providerStatusUrl: "https://social.example.test/@marketme/status-collector-1",
  instanceOrigin: "https://social.example.test",
  encryptedCredentials: encryptToken(token, key),
  actorUserId: "33333333-3333-4333-8333-333333333333",
  attemptCount: 1,
};

afterEach(() => vi.unstubAllGlobals());

function stubReportFetch() {
  const fetch = vi.fn(async () => new Response(JSON.stringify({
    id: target.providerStatusId,
    created_at: "2026-08-12T10:00:00Z",
    url: target.providerStatusUrl,
    replies_count: 6,
    reblogs_count: 14,
    favourites_count: 32,
    content: "Discarded provider content",
    account: { id: target.providerAccountId, acct: "marketme", display_name: "Discarded" },
  }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function createCollector(repository: object) {
  return new MastodonReportCollector(repository as never, key, ["social.example.test"], {
    batchSize: 10, refreshSeconds: 900, maxAgeSeconds: 604800,
  });
}

describe("MastodonReportCollector", () => {
  it("collects one bounded aggregate status report and reschedules without actor data", async () => {
    stubReportFetch();
    const record = vi.fn(async () => ({ created: true, snapshot: {} }));
    const complete = vi.fn(async () => true);
    const reconcile = vi.fn(async () => ({ active: 1, resolved: 0 }));
    const collector = createCollector({
      reconcileMastodonStatusReportCollectionAlerts: reconcile,
      claimMastodonStatusReportCollections: vi.fn(async () => [target]),
      recordMastodonStatusReportSnapshot: record,
      completeMastodonStatusReportCollection: complete,
    });

    await expect(collector.runOnce()).resolves.toEqual({
      claimed: 1, succeeded: 1, failed: 0, superseded: 0,
      alertsActive: 1, alertsResolved: 0, alertReconciliationFailed: false,
    });
    expect(reconcile).toHaveBeenCalledWith(604800);
    expect(record).toHaveBeenCalledWith(
      target.workspaceId,
      target.publicationActionId,
      expect.objectContaining({
        statusId: target.providerStatusId, accountId: target.providerAccountId,
        repliesCount: 6, reblogsCount: 14, favouritesCount: 32,
      }),
      target.actorUserId,
      target.attemptCount,
    );
    expect(complete).toHaveBeenCalledWith(target.publicationActionId, { delaySeconds: 900 }, target.attemptCount);
    expect(JSON.stringify(record.mock.calls)).not.toContain("Discarded provider content");
    expect(JSON.stringify(record.mock.calls)).not.toContain("display_name");
  });

  it("records only a closed credential failure and applies bounded backoff", async () => {
    const complete = vi.fn(async () => true);
    const collector = createCollector({
      reconcileMastodonStatusReportCollectionAlerts: vi.fn(async () => ({ active: 0, resolved: 1 })),
      claimMastodonStatusReportCollections: vi.fn(async () => [{ ...target, encryptedCredentials: "invalid" }]),
      recordMastodonStatusReportSnapshot: vi.fn(),
      completeMastodonStatusReportCollection: complete,
    });

    await expect(collector.runOnce()).resolves.toEqual({
      claimed: 1, succeeded: 0, failed: 1, superseded: 0,
      alertsActive: 0, alertsResolved: 1, alertReconciliationFailed: false,
    });
    expect(complete).toHaveBeenCalledWith(target.publicationActionId, {
      delaySeconds: 3600,
      errorCode: "credential_unavailable",
    }, target.attemptCount);
  });

  it("reconciles alerts on an idle pass without accessing the provider", async () => {
    const fetch = stubReportFetch();
    const reconcile = vi.fn(async () => ({ active: 2, resolved: 3 }));
    const collector = createCollector({
      reconcileMastodonStatusReportCollectionAlerts: reconcile,
      claimMastodonStatusReportCollections: vi.fn(async () => []),
      recordMastodonStatusReportSnapshot: vi.fn(),
      completeMastodonStatusReportCollection: vi.fn(),
    });

    await expect(collector.runOnce()).resolves.toEqual({
      claimed: 0, succeeded: 0, failed: 0, superseded: 0,
      alertsActive: 2, alertsResolved: 3, alertReconciliationFailed: false,
    });
    expect(reconcile).toHaveBeenCalledWith(604800);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("continues provider collection after an alert failure and exposes only a closed signal", async () => {
    const fetch = stubReportFetch();
    const collector = createCollector({
      reconcileMastodonStatusReportCollectionAlerts: vi.fn(async () => { throw new Error(`secret ${token}`); }),
      claimMastodonStatusReportCollections: vi.fn(async () => [target]),
      recordMastodonStatusReportSnapshot: vi.fn(async () => ({ created: true, snapshot: {} })),
      completeMastodonStatusReportCollection: vi.fn(async () => true),
    });

    const result = await collector.runOnce();
    expect(result).toEqual({
      claimed: 1, succeeded: 1, failed: 0, superseded: 0,
      alertsActive: 0, alertsResolved: 0, alertReconciliationFailed: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain(target.providerStatusId);
  });

  it("does not complete a claim after snapshot persistence reports that it was superseded", async () => {
    stubReportFetch();
    const complete = vi.fn(async () => true);
    const collector = createCollector({
      reconcileMastodonStatusReportCollectionAlerts: vi.fn(async () => ({ active: 0, resolved: 0 })),
      claimMastodonStatusReportCollections: vi.fn(async () => [target]),
      recordMastodonStatusReportSnapshot: vi.fn(async () => { throw new MastodonReportCollectionClaimLostError(); }),
      completeMastodonStatusReportCollection: complete,
    });

    await expect(collector.runOnce()).resolves.toMatchObject({ claimed: 1, succeeded: 0, failed: 0, superseded: 1 });
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([false, true])("does not retry a superseded completion (provider failure: %s)", async (providerFailure) => {
    stubReportFetch();
    const complete = vi.fn(async () => false);
    const collector = createCollector({
      reconcileMastodonStatusReportCollectionAlerts: vi.fn(async () => ({ active: 0, resolved: 0 })),
      claimMastodonStatusReportCollections: vi.fn(async () => [providerFailure ? { ...target, encryptedCredentials: "invalid" } : target]),
      recordMastodonStatusReportSnapshot: vi.fn(async () => ({ created: true, snapshot: {} })),
      completeMastodonStatusReportCollection: complete,
    });

    await expect(collector.runOnce()).resolves.toMatchObject({ claimed: 1, succeeded: 0, failed: 0, superseded: 1 });
    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(target.publicationActionId,
      providerFailure ? { delaySeconds: 3600, errorCode: "credential_unavailable" } : { delaySeconds: 900 },
      target.attemptCount,
    );
  });

  it("does not issue a second completion when the completion database call fails", async () => {
    stubReportFetch();
    const complete = vi.fn(async () => { throw new Error("database unavailable"); });
    const collector = createCollector({
      reconcileMastodonStatusReportCollectionAlerts: vi.fn(async () => ({ active: 0, resolved: 0 })),
      claimMastodonStatusReportCollections: vi.fn(async () => [target]),
      recordMastodonStatusReportSnapshot: vi.fn(async () => ({ created: true, snapshot: {} })),
      completeMastodonStatusReportCollection: complete,
    });

    await expect(collector.runOnce()).rejects.toThrow("database unavailable");
    expect(complete).toHaveBeenCalledOnce();
  });
});
