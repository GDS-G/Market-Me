import type { SourceSetupInput } from "@market-me/domain";
export const setupUserId = "44444444-4444-4444-8444-444444444444";
export const setupInput: SourceSetupInput = {
  workspaceId: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222",
  provider: "google_drive", storageConnectionId: "33333333-3333-4333-8333-333333333333", name: "Newsroom",
  location: { providerLocationId: "news-folder", displayPath: "My Drive / Newsroom" }, recursive: true,
  readinessMode: "immediate", stabilizationWindowSeconds: 120, fileTypes: ["images", "documents"], ignoredFolders: ["Drafts"],
  contextPacks: [], autonomyMode: "approval_required",
};
export const setupReceipt = { workspaceId: setupInput.workspaceId, requestId: setupInput.requestId,
  smartSourceId: "55555555-5555-4555-8555-555555555555", name: setupInput.name, createdAt: "2026-10-01T12:00:00.000Z", initialState: "paused" as const };
