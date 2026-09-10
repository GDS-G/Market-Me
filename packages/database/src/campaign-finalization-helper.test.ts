import { describe, expect, it, vi } from "vitest";
import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import type { CampaignDraftWrite, StoredCampaign } from "./models";
import { CampaignRepository } from "./campaign-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const campaignId = "22222222-2222-4222-8222-222222222222";
const planningId = "33333333-3333-4333-8333-333333333333";
const preparationId = "44444444-4444-4444-8444-444444444444";
const actorId = "55555555-5555-4555-8555-555555555555";
const definition: CampaignDraftWrite = {
  workspaceId, name: "Prepared Campaign", description: "Original planning context", objective: "awareness",
  contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "light",
  autonomyMode: "approval_required", timezone: "UTC", context: {},
  steps: [{ id: "publish_prepared_preview", name: "Publish reviewed preview", operationType: "publish_content",
    desiredCapability: "publish_content", dependsOn: [], inputs: {}, executionMethods: ["official_api"],
    approvalRequired: true, scheduleType: "immediate" }],
};

interface FixtureOptions {
  campaign?: { id: string; currentVersionId: string | null; status: string } | null;
  preparation?: { planningVersionId: string } | null;
  planning?: { id: string } | null;
  finalized?: boolean;
  draft?: boolean;
  failInsert?: Error;
}
function fixture(options: FixtureOptions = {}) {
  const statements: { sql: string; values: unknown[] }[] = [];
  const tagged = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    statements.push({ sql, values });
    if (sql.startsWith("SELECT id, current_version_id")) {
      const row = options.campaign === undefined ? { id: campaignId, currentVersionId: planningId, status: "draft" } : options.campaign;
      return row ? [row] : [];
    }
    if (sql.startsWith("SELECT planning_version_id")) {
      const row = options.preparation === undefined ? { planningVersionId: planningId } : options.preparation;
      return row ? [row] : [];
    }
    if (sql.includes("autonomy_mode = 'draft_only'")) {
      const row = options.planning === undefined ? { id: planningId } : options.planning;
      return row ? [row] : [];
    }
    if (sql.startsWith("SELECT id FROM campaign_finalization")) return options.finalized ? [{ id: preparationId }] : [];
    if (sql.startsWith("SELECT id FROM campaign_version") && sql.includes("status = 'draft'")) return options.draft ? [{ id: preparationId }] : [];
    if (sql.includes("AS next")) return [{ next: 2 }];
    if (sql.includes("AS count FROM content_package")) return [{ count: 0 }];
    if (sql.startsWith("INSERT INTO campaign_version") && options.failInsert) throw options.failInsert;
    return [];
  });
  const transaction = Object.assign(tagged, { json: (value: unknown) => value }) as unknown as TransactionSql;
  const outsideRead = vi.fn(() => { throw new Error("Unexpected out-of-transaction read"); });
  const begin = vi.fn(async (run: (tx: TransactionSql) => Promise<unknown>) => run(transaction));
  const client = Object.assign(outsideRead, { begin }) as unknown as DatabaseClient;
  const repository = new CampaignRepository(client);
  const insert = (overrides: Partial<CampaignDraftWrite> = {}) => repository.insertPreparedExecutableDraftInTransaction(transaction,
    { workspaceId, campaignId, preparationId, expectedPlanningVersionId: planningId, definition: { ...definition, ...overrides } }, actorId);
  return { repository, transaction, statements, outsideRead, begin, insert };
}

describe("transaction-scoped prepared executable draft helper", () => {
  it("inserts a distinct next draft with no nested transaction, root mutation, activation, or post-commit read", async () => {
    const f = fixture();
    const result = await f.insert();
    expect(result.versionNumber).toBe(2);
    expect(result.campaignVersionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.campaignVersionId).not.toBe(planningId);
    expect(f.begin).not.toHaveBeenCalled(); expect(f.outsideRead).not.toHaveBeenCalled();
    expect(f.statements[0]!.sql).toContain("FROM campaign WHERE");
    expect(f.statements[0]!.sql).toContain("FOR UPDATE");
    expect(f.statements[1]!.sql).toContain("FROM campaign_preparation");
    const mutations = f.statements.filter((entry) => /^(INSERT|UPDATE|DELETE)/.test(entry.sql));
    expect(mutations.map((entry) => entry.sql.split(" ").slice(0, 3).join(" "))).toEqual([
      "INSERT INTO campaign_version", "UPDATE campaign_version SET", "INSERT INTO campaign_step",
    ]);
    expect(mutations[0]!.values).toContain(result.campaignVersionId);
    expect(mutations[0]!.values).toContain(2);
    expect(mutations[2]!.values).toContainEqual({}); // Optional outputs normalize safely.
    expect(f.statements.some((entry) => /campaign_instance|campaign_workflow_command|publication_action|INSERT INTO campaign_finalization/.test(entry.sql))).toBe(false);
  });

  it.each<FixtureOptions>([
    { campaign: null }, { campaign: { id: campaignId, currentVersionId: planningId, status: "archived" } },
    { campaign: { id: campaignId, currentVersionId: null, status: "draft" } },
    { campaign: { id: campaignId, currentVersionId: actorId, status: "draft" } },
    { preparation: null }, { preparation: { planningVersionId: actorId } }, { planning: null },
  ])("fails closed without writes for stale or missing planning lineage %#", async (options) => {
    const f = fixture(options);
    await expect(f.insert()).rejects.toMatchObject({ issues: [{ code: "planning_version_conflict" }] });
    expect(f.statements.some((entry) => /^(INSERT|UPDATE|DELETE)/.test(entry.sql))).toBe(false);
  });

  it("rejects a definition from another workspace", async () => {
    await expect(fixture().insert({ workspaceId: actorId })).rejects.toMatchObject({ issues: [{ code: "planning_version_conflict" }] });
  });

  it.each([
    [{ finalized: true }, "campaign_already_finalized"],
    [{ draft: true }, "editable_draft_exists"],
  ] as const)("never overwrites an existing finalization or editable draft %#", async (options, code) => {
    const f = fixture(options);
    await expect(f.insert()).rejects.toMatchObject({ issues: [{ code }] });
    expect(f.statements.some((entry) => /^(INSERT|UPDATE|DELETE)/.test(entry.sql))).toBe(false);
  });

  it("keeps graph and executable policy validation before writes", async () => {
    const invalidGraph = fixture();
    await expect(invalidGraph.insert({ steps: [{ ...definition.steps[0]!, dependsOn: ["missing"] }] })).rejects.toThrow();
    expect(invalidGraph.statements.some((entry) => entry.sql.startsWith("INSERT"))).toBe(false);
    const invalidPolicy = fixture();
    await expect(invalidPolicy.insert({ autonomyMode: "draft_only" })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "autonomy_execution_disabled" })] });
    expect(invalidPolicy.statements.some((entry) => entry.sql.startsWith("INSERT"))).toBe(false);
  });

  it("retains workspace reference validation and propagates transaction failures", async () => {
    const invalidReference = fixture();
    // validateReferences uses its tagged SQL list helper only for nonempty IDs;
    // a foreign Destination exercises the same transaction without fabricating it.
    await expect(invalidReference.insert({ destinationId: actorId })).rejects.toThrow("Campaign destination does not belong to this workspace");
    expect(invalidReference.statements.some((entry) => entry.sql.startsWith("INSERT"))).toBe(false);
    const failure = new Error("Synthetic transaction insertion failure");
    const failedWrite = fixture({ failInsert: failure });
    await expect(failedWrite.insert()).rejects.toBe(failure);
    expect(failedWrite.outsideRead).not.toHaveBeenCalled();
  });

  it("blocks the advanced save before reference checks or mutation once provenance exists", async () => {
    const f = fixture({ finalized: true });
    await expect(f.repository.saveCampaignDraft(campaignId, definition, actorId)).rejects.toMatchObject({ issues: [{ code: "campaign_finalization_protected" }] });
    expect(f.statements).toHaveLength(2);
    expect(f.statements.some((entry) => /^(INSERT|UPDATE|DELETE)/.test(entry.sql))).toBe(false);
    expect(f.outsideRead).not.toHaveBeenCalled();
  });
});

describe("exact-version publish and activation controls", () => {
  function harness(options: { current?: string | null; draft?: string; published?: boolean; missing?: boolean; noPublishedActivation?: boolean } = {}) {
    const statements: string[] = [];
    const tagged = vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?").replace(/\s+/g, " ").trim(); statements.push(sql);
      if (options.missing) return [];
      if (sql.startsWith("SELECT c.id, c.current_version_id")) return [{ id: campaignId, currentVersionId: options.current ?? planningId }];
      if (sql.startsWith("SELECT id FROM campaign_version") && sql.includes("status = 'draft'")) return options.draft ? [{ id: options.draft }] : [];
      if (sql.startsWith("SELECT id FROM campaign_version") && sql.includes("status = 'published'")) return options.published === false ? [] : [{ id: planningId }];
      if (sql.startsWith("SELECT cv.id AS version_id")) return options.noPublishedActivation ? [] : [{ versionId: options.current ?? planningId }];
      if (sql.startsWith("SELECT id FROM campaign WHERE")) return [{ id: campaignId }];
      throw new Error(`Unexpected query in exact-version boundary test: ${sql}`);
    });
    const tx = tagged as unknown as TransactionSql;
    const client = Object.assign(vi.fn(), { begin: async (run: (transaction: TransactionSql) => Promise<unknown>) => run(tx) }) as unknown as DatabaseClient;
    const repo = new CampaignRepository(client);
    const stored = { id: campaignId, workspaceId } as StoredCampaign;
    const read = vi.spyOn(repo, "getCampaign").mockResolvedValue(stored);
    const publish = vi.spyOn(repo, "publishExactCampaignDraftInTransaction").mockResolvedValue(true);
    return { repo, read, publish, tx, stored, statements };
  }

  it("publishes only the requested existing draft identity", async () => {
    const h = harness({ draft: preparationId });
    expect(await h.repo.publishCampaign(workspaceId, campaignId, { expectedVersionId: preparationId })).toBe(h.stored);
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(h.tx, workspaceId, campaignId, preparationId);
  });

  it("returns an exact already-published repeat without another write", async () => {
    const h = harness();
    expect(await h.repo.publishCampaign(workspaceId, campaignId, { expectedVersionId: planningId })).toBe(h.stored);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.statements.every((sql) => sql.startsWith("SELECT"))).toBe(true);
  });

  it.each([
    { draft: preparationId }, { current: actorId }, { published: false },
  ])("rejects a stale publish pin or competing draft %#", async (options) => {
    const h = harness(options);
    await expect(h.repo.publishCampaign(workspaceId, campaignId, { expectedVersionId: planningId })).rejects.toMatchObject({ issues: [{ code: "campaign_version_changed" }] });
    expect(h.publish).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled();
  });

  it("retains legacy publish behavior when no expected pin is supplied", async () => {
    const h = harness({ draft: preparationId });
    expect(await h.repo.publishCampaign(workspaceId, campaignId)).toBe(h.stored);
    expect(h.publish).toHaveBeenCalledExactlyOnceWith(h.tx, workspaceId, campaignId, preparationId);
  });

  it.each([{ current: actorId }, { noPublishedActivation: true }])("rejects activation pin mismatch before proof or any instance/outbox write %#", async (options) => {
    const h = harness(options);
    await expect(h.repo.activateCampaign({ workspaceId, campaignId, actorUserId: actorId, expectedVersionId: planningId })).rejects.toMatchObject({ issues: [{ code: "campaign_version_changed" }] });
    expect(h.statements.every((sql) => sql.startsWith("SELECT"))).toBe(true);
  });

  it("returns unavailable for missing Campaigns without confusing them with changed versions", async () => {
    const h = harness({ missing: true });
    expect(await h.repo.publishCampaign(workspaceId, campaignId, { expectedVersionId: planningId })).toBeUndefined();
    expect(await h.repo.activateCampaign({ workspaceId, campaignId, actorUserId: actorId, expectedVersionId: planningId })).toBeUndefined();
    expect(h.publish).not.toHaveBeenCalled();
  });
});
