import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { ProfileRepository } from "./profile-repository";
import { CampaignRepository } from "./campaign-repository";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("profile repositories", () => {
  afterAll(async () => sql?.end());

  it("publishes immutable profiles, pins exact versions, and enforces communication ceilings", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const profiles = new ProfileRepository(sql);
    const campaigns = new CampaignRepository(sql);
    const suffix = randomUUID();
    const first = await core.bootstrapDevelopmentWorkspace({ email: `profile-${suffix}@market-me.local`, displayName: "Profile Integration Test" });
    const second = await core.bootstrapDevelopmentWorkspace({ email: `profile-other-${suffix}@market-me.local`, displayName: "Other Workspace" });
    try {
      const brand = await profiles.createBrandProfile({
        workspaceId: first.workspace.workspaceId, name: "Regulated Brand", description: "Reviewed brand rules",
        profile: { officialName: "Regulated Brand", description: "Evidence-first communication", products: ["Service"], services: [], valuePropositions: ["Clear evidence"], voice: { tones: ["clear"] }, terminology: { preferred: ["member"], prohibited: ["guaranteed"] }, style: {}, claims: ["Evidence-backed"], evidenceRequirements: ["Cite source"], requiredDisclosures: ["Terms apply"], attributionRules: [], competitorRules: [], channelPersonas: {} },
        informationDepthDefault: "contextual", informationDepthCeiling: "detailed", promotionalStrengthDefault: "subtle", promotionalStrengthCeiling: "standard",
      }, first.user.id);
      const publishedBrand = await profiles.publishBrandProfile(first.workspace.workspaceId, brand.id, first.user.id);
      expect(publishedBrand?.currentVersion).toEqual(expect.objectContaining({ versionNumber: 1, status: "published" }));

      const audience = await profiles.createAudienceProfile({
        workspaceId: first.workspace.workspaceId, name: "New members", description: "People evaluating membership", audienceType: "community",
        profile: { purpose: "Explain membership", industries: [], roles: [], interests: ["community"], locations: [], languages: ["en"], knowledgeLevel: "new", needs: ["clear next step"], motivations: ["belonging"], objections: ["time"], questions: ["What is included?"], preferredChannels: ["email"], preferredFormats: ["short guide"], relationshipStage: "consideration", familiarity: "low", exclusions: ["Do not infer sensitive traits"] },
        informationDepthDefault: "teaser", informationDepthCeiling: "contextual", promotionalStrengthDefault: "subtle", promotionalStrengthCeiling: "light",
      }, first.user.id);
      const publishedAudience = await profiles.publishAudienceProfile(first.workspace.workspaceId, audience.id, first.user.id);

      const baseCampaign = {
        workspaceId: first.workspace.workspaceId, name: "Profile-bound campaign", description: "Exact profile bindings", objective: "awareness" as const,
        contentPackageIds: [], brandProfileVersionId: publishedBrand!.currentVersion!.id, audienceProfileVersionIds: [publishedAudience!.currentVersion!.id],
        informationDepth: "contextual" as const, promotionalStrength: "light" as const, autonomyMode: "approval_required" as const, timezone: "UTC", context: {},
        steps: [{ id: "review", name: "Review", operationType: "manual_handoff" as const, desiredCapability: "manual.handoff", dependsOn: [], inputs: {}, outputs: {}, executionMethods: ["manual_handoff"] as const, approvalRequired: true }],
      };
      await expect(campaigns.createCampaign({ ...baseCampaign, promotionalStrength: "strong" }, first.user.id)).rejects.toMatchObject({ name: "CampaignValidationError" });
      const campaign = await campaigns.createCampaign(baseCampaign, first.user.id);
      expect(campaign.draftVersion).toEqual(expect.objectContaining({ brandProfileVersionId: publishedBrand!.currentVersion!.id, audienceProfileVersionIds: [publishedAudience!.currentVersion!.id] }));
      await campaigns.publishCampaign(first.workspace.workspaceId, campaign.id);

      const revisedBrand = await profiles.saveBrandProfileDraft(brand.id, { workspaceId: first.workspace.workspaceId, name: "Regulated Brand", description: "Updated draft", profile: { ...publishedBrand!.currentVersion!.profile, description: "New unpublished wording" }, informationDepthCeiling: "detailed", promotionalStrengthCeiling: "standard" }, first.user.id);
      expect(revisedBrand?.currentVersion?.id).toBe(publishedBrand!.currentVersion!.id);
      expect(revisedBrand?.draftVersion).toEqual(expect.objectContaining({ versionNumber: 2, status: "draft" }));
      await profiles.publishBrandProfile(first.workspace.workspaceId, brand.id, first.user.id);
      expect((await campaigns.getCampaign(first.workspace.workspaceId, campaign.id))?.currentVersion?.brandProfileVersionId).toBe(publishedBrand!.currentVersion!.id);

      const foreign = await profiles.createAudienceProfile({ workspaceId: second.workspace.workspaceId, name: "Foreign", description: "Other workspace", audienceType: "consumer", profile: { purpose: "Other", industries: [], roles: [], interests: [], locations: [], languages: [], needs: [], motivations: [], objections: [], questions: [], preferredChannels: [], preferredFormats: [], exclusions: [] } }, second.user.id);
      const foreignPublished = await profiles.publishAudienceProfile(second.workspace.workspaceId, foreign.id, second.user.id);
      await expect(campaigns.createCampaign({ ...baseCampaign, name: "Invalid cross workspace", audienceProfileVersionIds: [foreignPublished!.currentVersion!.id] }, first.user.id)).rejects.toThrow("must be published and belong to this workspace");

      const events = await sql<{ eventType: string }[]>`SELECT event_type FROM audit_event WHERE workspace_id = ${first.workspace.workspaceId} AND subject_id IN (${brand.id}, ${audience.id})`;
      expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["brand_profile.created", "brand_profile.published", "audience_profile.created", "audience_profile.published"]));
    } finally {
      await sql`DELETE FROM organization WHERE id IN (SELECT organization_id FROM workspace WHERE id IN (${first.workspace.workspaceId}, ${second.workspace.workspaceId}))`;
    }
  });
});
