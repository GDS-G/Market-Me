import type { PreparationFormInput } from "./campaign-preparation-request";
import type { PreparationPreview } from "./campaign-preparation-preview-contract";
import { reviewTestApproval, reviewTestScope, reviewTestUuid } from "./content-package-review.test-fixture";

export const previewTestInput: PreparationFormInput = {
  workspaceId: reviewTestScope.workspaceId, contentPackageId: reviewTestScope.packageId, expectedPackageVersion: 2,
  templateKey: "general_announcement", templateVersion: 1, name: "General announcement", description: "",
  audienceProfileVersionIds: [], informationDepth: "contextual", promotionalStrength: "informational", timezone: "UTC",
};
export const previewTestFingerprint = reviewTestApproval.reviewFingerprint;
export function previewTestData(): PreparationPreview {
  const evidenceId = reviewTestUuid(6);
  return {
    schemaVersion: 1, workspaceId: previewTestInput.workspaceId, configuration: structuredClone(previewTestInput),
    contentPackage: { id: previewTestInput.contentPackageId, title: "Captured café 🚀", version: 2, approvalId: reviewTestApproval.id, reviewFingerprint: previewTestFingerprint },
    campaign: { objective: "awareness", autonomyMode: "draft_only", steps: [{ id: "review_preparation", name: "Review prepared campaign", operationType: "request_approval", executionMethods: ["manual_handoff"], approvalRequired: true, scheduleType: "immediate" }] },
    generator: { provider: "market-me", model: "grounded-template", version: "1.1.0", promptVersion: "grounded-draft-v2" },
    variants: [{ position: 0, audience: { kind: "general", name: "General" }, draft: { headline: "Captured café 🚀", body: "Admission is free.", hashtags: [], rationale: "Grounded in approved evidence.", claims: [{ kind: "fact", text: "Admission is free.", evidenceItemIds: [evidenceId] }] } }],
    evidence: [{ id: evidenceId, claim: "Admission is free.", provenance: "authoritative_context", sourceReferences: ["source:original"] }],
    effects: { persisted: false, providerRequest: false, budgetReservation: false, approved: false, activated: false },
  };
}
