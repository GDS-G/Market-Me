import { randomUUID } from "node:crypto";
import { createDatabaseClient } from "../packages/database/src/client";
import { MarketMeRepository } from "../packages/database/src/repositories";
import { CampaignRepository } from "../packages/database/src/campaign-repository";

// Browser acceptance fixtures only. Never aim this helper at an application database.
async function main(): Promise<void> {
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^\/market_me_qa_[a-z0-9_]+$/.test(new URL(databaseUrl).pathname))
  throw new Error("Use an isolated market_me_qa_* database for browser fixtures");
const sql = createDatabaseClient(databaseUrl);
const core = new MarketMeRepository(sql);
const campaigns = new CampaignRepository(sql);
try {
  if (process.argv.includes("--no-memberships")) {
    const [fixtureUser] = await sql<{ id: string }[]>`SELECT id FROM app_user WHERE normalized_email = 'developer@market-me.local'`;
    if (!fixtureUser) throw new Error("Seed the synthetic developer before testing revoked access");
    // This synthetic user's only memberships belong to this disposable QA database.
    await sql`DELETE FROM workspace_membership WHERE user_id = ${fixtureUser.id}`;
    console.log(JSON.stringify({ noMemberships: true, userId: fixtureUser.id }));
  } else {
    const existing = await sql`SELECT id FROM app_user WHERE normalized_email = 'developer@market-me.local'`;
    if (existing.length) throw new Error("Use a fresh QA database; do not duplicate an existing fixture");
    const first = await core.bootstrapDevelopmentWorkspace({ email: "developer@market-me.local", displayName: "Market Me QA Developer" });
    const second = await core.bootstrapDevelopmentWorkspace({ email: "qa-secondary@market-me.local", displayName: "Secondary QA Owner" });
    await sql`UPDATE workspace SET name = 'QA Alpha' WHERE id = ${first.workspace.workspaceId}`;
    await sql`UPDATE workspace SET name = 'QA Beta' WHERE id = ${second.workspace.workspaceId}`;
    await sql`INSERT INTO organization_membership (organization_id, user_id, role)
      VALUES (${second.workspace.organizationId}, ${first.user.id}, 'member') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO workspace_membership (workspace_id, user_id, role)
      VALUES (${second.workspace.workspaceId}, ${first.user.id}, 'editor') ON CONFLICT DO NOTHING`;
    const source = await core.createSmartSource({
      workspaceId: first.workspace.workspaceId, name: "Alpha source", provider: "local",
      locations: [{ providerLocationId: "qa", displayPath: "C:\\MarketMeQA" }], recursive: true,
      readinessMode: "immediate", stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"],
      ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: true,
    }, first.user.id);
    const campaign = await campaigns.createCampaign({
      workspaceId: first.workspace.workspaceId, name: "Alpha review launch", description: "Disposable browser fixture",
      objective: "awareness", contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual",
      promotionalStrength: "light", autonomyMode: "campaign_approval", timezone: "America/Chicago", context: {},
      steps: [{ id: "review", name: "Review launch plan", operationType: "manual_handoff", desiredCapability: "manual.handoff",
        dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff"], approvalRequired: false,
        scheduleType: "exact_time", scheduledAt: "2026-09-15T15:30:42.125Z", condition: {}, maxAttempts: 1, timeoutSeconds: 60, optional: false }],
    }, first.user.id);
    await campaigns.publishCampaign(first.workspace.workspaceId, campaign.id);
    const instance = await campaigns.activateCampaign({ workspaceId: first.workspace.workspaceId, campaignId: campaign.id, actorUserId: first.user.id });
    await campaigns.ensureStepApproval({ instanceId: instance!.id, stepKey: "__campaign__", snapshot: {
      name: "Approve Alpha review launch", approvalScope: "campaign", campaignVersionId: instance!.campaignVersionId,
      steps: (await campaigns.getWorkflowDefinition(instance!.id))!.steps,
    } });
    await campaigns.createCampaign({
      workspaceId: second.workspace.workspaceId, name: "Beta conditional plan", description: "Saved, not executable",
      objective: "awareness", contentPackageIds: [], audienceProfileVersionIds: [], informationDepth: "contextual",
      promotionalStrength: "light", autonomyMode: "draft_only", timezone: "UTC", context: {},
      steps: [{ id: "followup", name: "Review follow-up", operationType: "manual_handoff", desiredCapability: "manual.handoff",
        dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff"], approvalRequired: true,
        scheduleType: "conditional", condition: { afterSeconds: 3600, marker: randomUUID() }, maxAttempts: 1, timeoutSeconds: 60, optional: true }],
    }, first.user.id);
    console.log(JSON.stringify({ alpha: first.workspace.workspaceId, beta: second.workspace.workspaceId, sourceId: source.id, campaignId: campaign.id, instanceId: instance!.id }));
  }
} finally {
  await sql.end();
}
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
