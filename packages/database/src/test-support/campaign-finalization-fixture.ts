import { randomUUID } from "node:crypto";
import { DISCORD_WEBHOOK_CAPABILITIES, SLACK_WEBHOOK_CAPABILITIES, mastodonCapabilities } from "@market-me/connectors";
import type { PromotionalStrength } from "@market-me/domain";
import { CampaignFinalizationRepository } from "../campaign-finalization-repository";
import type { CampaignFinalizationTemplateInput } from "../campaign-finalization-template";
import { CampaignPreparationRepository } from "../campaign-preparation-repository";
import type { CampaignPreparationTemplateInput } from "../campaign-preparation-template";
import { CampaignRepository } from "../campaign-repository";
import type { DatabaseClient } from "../client";
import { DraftRepository } from "../draft-repository";
import { ProfileRepository } from "../profile-repository";
import { PublishingRepository } from "../publishing-repository";
import { MarketMeRepository } from "../repositories";
import type { AudienceProfileDraftWrite, BrandProfileDraftWrite, ContentPackageWrite } from "../models";

export const finalizationFixtureAppBaseUrl = "https://market-me.example.test";
export type FinalizationFixtureProvider = "discord_webhook" | "slack_webhook" | "mastodon_account";
export interface FinalizationFixtureOptions {
  provider?: FinalizationFixtureProvider;
  linkMode?: "canonical" | "tracked";
  revise?: boolean;
  promotionalStrength?: PromotionalStrength;
}

export function finalizationBrandInput(workspaceId: string): BrandProfileDraftWrite {
  return { workspaceId, name: "Finalization fixture brand", description: "Synthetic reviewed brand", profile: {
    officialName: "Finalization Fixture", description: "Synthetic brand", products: [], services: [], valuePropositions: [],
    voice: { tones: ["clear"] }, terminology: { preferred: [], prohibited: [] }, style: {}, claims: [],
    evidenceRequirements: [], requiredDisclosures: [], attributionRules: [], competitorRules: [], channelPersonas: {},
  } };
}
export function finalizationAudienceInput(workspaceId: string, name: string): AudienceProfileDraftWrite {
  return { workspaceId, name, description: "Synthetic reviewed audience", audienceType: "community", profile: {
    purpose: "Explain the announcement", industries: [], roles: [], interests: [], locations: [], languages: ["en"],
    knowledgeLevel: "new", needs: [], motivations: [], objections: [], questions: [], preferredChannels: [], preferredFormats: [], exclusions: [],
  } };
}

/** Real local-only lineage, no test registration or provider I/O. Caller owns cleanup. */
export async function makeCampaignFinalizationFixture(sql: DatabaseClient, options: FinalizationFixtureOptions = {}) {
  const database = (await sql<{ name: string }[]>`SELECT current_database() AS name`)[0]!.name;
  if (!database.startsWith("market_me_qa_") && database !== "market_me_ci") {
    throw new Error("Finalization fixtures require an isolated market_me_qa_* or market_me_ci database.");
  }
  const appBaseUrl = finalizationFixtureAppBaseUrl;
  const core = new MarketMeRepository(sql), campaigns = new CampaignRepository(sql, { appBaseUrl });
  const publishing = new PublishingRepository(sql, { appBaseUrl }), profiles = new ProfileRepository(sql);
  const preparations = new CampaignPreparationRepository(sql), drafts = new DraftRepository(sql);
  const finalizations = new CampaignFinalizationRepository(sql, { appBaseUrl });
  const { user, workspace } = await core.bootstrapDevelopmentWorkspace({
    email: `finalization-qa-${randomUUID()}@market-me.local`, displayName: "Finalization isolated QA",
  });
  const cleanup = async () => {
    // Remove only owned synthetic receipts, then their restricted historical references.
    await sql`DELETE FROM campaign_finalization WHERE workspace_id = ${workspace.workspaceId}`;
    await sql`DELETE FROM campaign_preparation WHERE workspace_id = ${workspace.workspaceId}`;
    await sql`DELETE FROM tracked_link WHERE workspace_id = ${workspace.workspaceId}`;
    await sql`DELETE FROM organization WHERE id = ${workspace.organizationId}`;
    await sql`DELETE FROM app_user WHERE id = ${user.id}`;
  };
  try {
    const source = await core.createSmartSource({ workspaceId: workspace.workspaceId, name: "Finalization fixture source", provider: "local",
      locations: [{ providerLocationId: "fixture", displayPath: "/FinalizationQA" }], recursive: false, readinessMode: "immediate",
      stabilizationWindowSeconds: 0, allowedMimeTypes: ["text/plain"], ignorePatterns: [], contextPackIds: [], autonomyMode: "draft_only", enabled: false }, user.id);
    await core.applySourceItemChanges({ workspaceId: workspace.workspaceId, smartSourceId: source.id,
      upserts: [{ workspaceId: workspace.workspaceId, smartSourceId: source.id, providerItemId: "announcement", name: "announcement.txt",
        displayPath: "/FinalizationQA/announcement.txt", mimeType: "text/plain", isFolder: false, contentHash: "sha256:finalization-fixture" }], deletedProviderItemIds: [] });
    const sourceItem = (await core.getSourceItemByProviderId(source.id, "announcement"))!;
    const packageInput: ContentPackageWrite = { workspaceId: workspace.workspaceId, smartSourceId: source.id, rootSourceItemId: sourceItem.id,
      title: "Reviewed community announcement", status: "ready", contextPackVersionIds: [], assets: [], conflicts: [],
      evidence: [
        { id: randomUUID(), claim: "Admission is free.", provenance: "authoritative_context", sourceReferences: [`source-item:${sourceItem.id}`], confidence: 1 },
        { id: randomUUID(), claim: "The event begins at noon.", provenance: "observed", sourceReferences: [`source-item:${sourceItem.id}`], confidence: 1 },
      ] };
    const contentPackage = await core.saveContentPackage(packageInput);
    await core.approveContentPackage({ workspaceId: workspace.workspaceId, packageId: contentPackage.id, actorUserId: user.id });
    const brand = await profiles.createBrandProfile(finalizationBrandInput(workspace.workspaceId), user.id);
    const brandVersion = (await profiles.publishBrandProfile(workspace.workspaceId, brand.id, user.id))!.currentVersion!;
    const audienceA = await profiles.createAudienceProfile(finalizationAudienceInput(workspace.workspaceId, "First audience"), user.id);
    const audienceB = await profiles.createAudienceProfile(finalizationAudienceInput(workspace.workspaceId, "Second audience"), user.id);
    const audienceVersionA = (await profiles.publishAudienceProfile(workspace.workspaceId, audienceA.id, user.id))!.currentVersion!;
    const audienceVersionB = (await profiles.publishAudienceProfile(workspace.workspaceId, audienceB.id, user.id))!.currentVersion!;
    const destination = await campaigns.saveDestination({ workspaceId: workspace.workspaceId, provider: "manual",
      canonicalUrl: "https://example.test/finalization?keep=a%2Fb", knownRedirects: [], title: "Reviewed landing page", description: "Synthetic destination",
      contentType: "web_page", identifiers: {}, topics: [], audiences: [], geography: [], status: "published", tracking: {} }, user.id);
    const preparationInput: CampaignPreparationTemplateInput = { workspaceId: workspace.workspaceId, contentPackageId: contentPackage.id,
      expectedPackageVersion: contentPackage.version, brandProfileVersionId: brandVersion.id,
      audienceProfileVersionIds: [audienceVersionB.id, audienceVersionA.id], destinationId: destination.id,
      informationDepth: "contextual", promotionalStrength: options.promotionalStrength ?? "informational" };
    const receipt = (await preparations.prepare(preparationInput, randomUUID(), user.id)).preparation;
    // Select a strict subset of generated variants, not the first audience by accident.
    const selected = receipt.preparedDrafts[1]!;
    if (options.revise !== false) {
      const revised = await drafts.revise({ workspaceId: workspace.workspaceId, draftId: selected.draftId,
        leadIn: "Community update", hashtags: ["#Community"], changeNote: "Synthetic presentational review", actorUserId: user.id });
      if (!revised) throw new Error("The synthetic reviewed revision was not created.");
    }
    await drafts.submit(workspace.workspaceId, selected.draftId, user.id);
    const approval = (await drafts.listApprovals(workspace.workspaceId)).find((row) => row.contentDraftId === selected.draftId)!;
    if (!approval) throw new Error("The synthetic exact-version approval was not created.");
    await drafts.decide({ workspaceId: workspace.workspaceId, approvalId: approval.id, decision: "approved", notes: "Synthetic exact version reviewed", actorUserId: user.id });
    const approvedDraft = (await drafts.get(workspace.workspaceId, selected.draftId))!;
    const provider = options.provider ?? "discord_webhook";
    const configuration = provider === "discord_webhook" ? { webhookId: "123456789012345678", channelId: "223456789012345678", guildId: null }
      : provider === "slack_webhook" ? { teamId: "T01234567", serviceId: "B01234567", host: "hooks.slack.com" }
        : { accountId: "123456", instanceOrigin: "https://social.example.test", host: "social.example.test", username: "qa", acct: "qa", maxCharacters: 500, charactersReservedPerUrl: 23 };
    const capabilities = provider === "discord_webhook" ? DISCORD_WEBHOOK_CAPABILITIES : provider === "slack_webhook" ? SLACK_WEBHOOK_CAPABILITIES : mastodonCapabilities(500, 23);
    const connection = await publishing.saveChannelConnection({ workspaceId: workspace.workspaceId, provider, name: "Reviewed synthetic connection",
      encryptedCredentials: "synthetic-unusable-envelope-no-network", configuration, capabilities: capabilities as unknown as Record<string, unknown> }, user.id);
    await sql`UPDATE channel_connection SET capabilities_observed_at = '2026-01-01T00:00:00.123456Z'::timestamptz WHERE id = ${connection.id}`;
    const previewInput = { workspaceId: workspace.workspaceId, draftId: selected.draftId, channelConnectionId: connection.id,
      destinationId: destination.id, linkMode: options.linkMode ?? "canonical", appBaseUrl, actorUserId: user.id };
    const preview = (await drafts.createChannelPreview(previewInput))!;
    const exact = await finalizations.getPreviewSelection(workspace.workspaceId, receipt.id, preview.id, user.id);
    if (!exact) throw new Error("The synthetic reviewed preview is outside its preparation lineage.");
    const input: CampaignFinalizationTemplateInput = { workspaceId: workspace.workspaceId, preparationId: receipt.id,
      expectedPlanningVersionId: receipt.planningVersionId, draftId: selected.draftId, expectedDraftVersionId: approvedDraft.currentVersion.id,
      previewId: preview.id, expectedPreviewFingerprint: exact.token, timing: { type: "immediate" } };
    return { core, campaigns, publishing, profiles, preparations, finalizations, drafts, receipt, approvedDraft, preview, exact, input,
      key: randomUUID(), user, workspace, cleanup, appBaseUrl, source, sourceItem, packageInput, contentPackage, preparationInput,
      brand, brandVersion, audienceA, audienceB, audienceVersionA, audienceVersionB, destination, connection, approval, previewInput };
  } catch (error) { await cleanup(); throw error; }
}
export type CampaignFinalizationFixture = Awaited<ReturnType<typeof makeCampaignFinalizationFixture>>;
