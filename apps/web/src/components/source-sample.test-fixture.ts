import { simulateSourceSample } from "@market-me/domain";
import type { SourceSampleCapture, SourceSampleRequest } from "@market-me/database";
import type { SourceSampleView } from "./source-sample-contract";
export const sampleActorId = "9a768c34-20ba-4fde-920f-c302dd4e30d2";
export const sampleConnectionId = "0f3a009f-1158-4fa5-999e-7e14b8d8c011";
export const sampleRequest: SourceSampleRequest = { workspaceId: "f1a78566-fbf1-43b0-a638-498c7739fb09",
  smartSourceId: "437d7fb4-1317-4f0a-8a42-c293fe3f8bd3", expectedSourceVersion: 3, locationIndex: 0 };
export const sampleNow = new Date("2026-10-01T12:00:00.000Z");
export const sampleCapture: SourceSampleCapture = {
  source: { id: sampleRequest.smartSourceId, workspaceId: sampleRequest.workspaceId, version: 3, name: "Launches", provider: "local", storageConnectionId: null,
    recursive: true, readinessMode: "related_files", stabilizationWindowSeconds: 120, relatedFileMinimum: 2, allowedMimeTypes: ["text/plain", "image/*"],
    ignorePatterns: ["**/Drafts/**"], contextPackIds: [], autonomyMode: "approval_required", enabled: false },
  location: { providerLocationId: sampleActorId, displayPath: "Approved desktop folder" },
  context: { packs: [{ name: "Launch facts", versionNumber: 1 }], facts: [{ factKey: "launch_date", status: "conflicted", reason: "Sources disagree and no explicit authority rule resolves the conflict." }], unresolvedRecordedFacts: 0 },
  preparation: null, localTruncated: false, fingerprint: "internal-not-a-capability",
  localItems: [
    { key: "one", parentKey: "root", name: "launch.txt", displayPath: "/Launches/launch.txt", mimeType: "text/plain", isFolder: false, modifiedAt: "2026-10-01T10:00:00.000Z" },
    { key: "two", parentKey: "root", name: "hero.jpg", displayPath: "/Launches/hero.jpg", mimeType: "image/jpeg", isFolder: false, modifiedAt: "2026-10-01T10:00:00.000Z" },
    { key: "three", parentKey: "root", name: "clip.mp4", displayPath: "/Launches/clip.mp4", mimeType: "video/mp4", isFolder: false },
  ],
};
export const sampleView: SourceSampleView = { workspaceId: sampleRequest.workspaceId, smartSourceId: sampleRequest.smartSourceId, locationIndex: 0,
  source: { name: "Launches", version: 3, enabled: false, recursive: true }, location: sampleCapture.location.displayPath,
  coverage: { kind: "historical_local_index", partial: true, truncated: false }, context: sampleCapture.context as SourceSampleView["context"], preparation: null,
  simulation: simulateSourceSample(sampleCapture.source, sampleCapture.localItems, { now: sampleNow, partial: true }) as SourceSampleView["simulation"] };
