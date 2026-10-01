import type { SourcePreparationPlanPreview } from "@market-me/database";

export const previewWorkspaceId = "11111111-1111-4111-8111-111111111111";
export const previewSourceId = "22222222-2222-4222-8222-222222222222";
export const previewReferenceId = "33333333-3333-4333-8333-333333333333";

export const preparationPreviewFixture: SourcePreparationPlanPreview = {
  workspaceId: previewWorkspaceId,
  smartSourceId: previewSourceId,
  source: { id: previewSourceId, name: "Newsroom", version: 2, enabled: false },
  currentBindingRevision: 3,
  enabled: true,
  referenceValidation: "current",
  template: { key: "general_announcement", version: 1, name: "Launch announcement", description: "Reviewed source material" },
  brandProfile: { versionId: previewReferenceId, name: "Example brand", versionNumber: 2, current: true },
  draftVariants: [
    { position: 0, kind: "audience", label: "Community", audienceProfileVersionId: previewReferenceId, versionNumber: 3, current: true },
    { position: 1, kind: "audience", label: "Customers", audienceProfileVersionId: "55555555-5555-4555-8555-555555555555", versionNumber: 1, current: true },
  ],
  destination: { id: previewReferenceId, title: "Launch page", current: true },
  settings: { informationDepth: "contextual", promotionalStrength: "informational", timezone: "America/Chicago" },
  campaign: { objective: "awareness", autonomyMode: "draft_only", steps: [{
    id: "review_preparation", name: "Review prepared campaign", operationType: "request_approval",
    executionMethods: ["manual_handoff"], approvalRequired: true, scheduleType: "immediate",
  }] },
};
