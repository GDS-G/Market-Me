import type { GeneratedDraft } from "@market-me/generation";
import type { NormalizedCampaignPreparationInput } from "./campaign-preparation-template";

export const CAMPAIGN_PREPARATION_PREVIEW_LIMITS = Object.freeze({ requestBytes: 32_768, responseBytes: 1_048_576 });

/** Unsaved, point-in-time observation. No ID here is a new persistent resource or authority token. */
export interface CampaignPreparationPreview {
  schemaVersion: 1;
  workspaceId: string;
  configuration: NormalizedCampaignPreparationInput;
  contentPackage: { id: string; title: string; version: number; approvalId: string; reviewFingerprint: string };
  brand?: { versionId: string; name: string; versionNumber: number };
  destination?: { id: string; title: string };
  campaign: { objective: "awareness"; autonomyMode: "draft_only"; steps: readonly {
    id: string; name: string; operationType: "request_approval"; executionMethods: readonly ["manual_handoff"]; approvalRequired: true; scheduleType: "immediate";
  }[] };
  generator: { provider: string; model: string; version: string; promptVersion: string };
  variants: readonly { position: number; audience: { kind: "general"; name: "General" } | { kind: "audience"; versionId: string; name: string; versionNumber: number };
    draft: Omit<GeneratedDraft, "presentationChoices"> }[];
  evidence: readonly { id: string; claim: string; provenance: string; sourceReferences: readonly string[] }[];
  effects: { persisted: false; providerRequest: false; budgetReservation: false; approved: false; activated: false };
}
