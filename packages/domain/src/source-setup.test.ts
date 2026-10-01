import { describe, expect, it } from "vitest";
import { compileSourceSetup, normalizeSourceSetup, SourceSetupInputError, type SourceSetupInput } from "./source-setup";

const input: SourceSetupInput = { workspaceId: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222",
  name: " Newsroom ", provider: "google_drive", storageConnectionId: "33333333-3333-4333-8333-333333333333",
  location: { providerLocationId: "folder-1", displayPath: "/Marketing/News" }, recursive: true,
  readinessMode: "immediate", stabilizationWindowSeconds: 120, fileTypes: ["documents", "images"], ignoredFolders: ["Drafts", "Archive"],
  contextPacks: [], autonomyMode: "approval_required" };

describe("guided source setup compiler", () => {
  it("canonicalizes unordered choices and Unicode without adding authority", () => {
    const result = normalizeSourceSetup({ ...input, name: " Cafe\u0301 " });
    expect(result.name).toBe("Café"); expect(result.fileTypes).toEqual(["images", "documents"]);
    expect(result.ignoredFolders).toEqual(["Archive", "Drafts"]);
    expect(normalizeSourceSetup(result)).toEqual(result);
    const compiled = compileSourceSetup(result);
    expect(compiled.enabled).toBe(false); expect(compiled.autonomyMode).toBe("approval_required");
    expect(compiled.allowedMimeTypes).toContain("application/pdf"); expect(compiled.allowedMimeTypes).toContain("image/*");
    expect(compiled.ignorePatterns).toEqual(["~$*", "**/Archive/**", "**/Drafts/**"]);
    expect(compiled).not.toHaveProperty("requestId"); expect(compiled).not.toHaveProperty("instructions");
  });
  it("pins the selected context version for admission but keeps existing root-based source semantics", () => {
    const contextPacks = [{ id: input.requestId, expectedVersionId: input.workspaceId }, { id: input.workspaceId, expectedVersionId: input.requestId }];
    expect(normalizeSourceSetup({ ...input, contextPacks }).contextPacks).toEqual([...contextPacks].reverse());
    expect(compileSourceSetup({ ...input, contextPacks }).contextPackIds).toEqual([input.workspaceId, input.requestId]);
  });
  it("fixes local labels and accepts only the paired-worker identity, not an arbitrary filesystem path", () => {
    const local = { ...input, provider: "local" as const, storageConnectionId: undefined, location: { providerLocationId: input.requestId, displayPath: "C:\\private" } };
    expect(normalizeSourceSetup(local).location.displayPath).toBe("Approved companion folder");
    expect(() => normalizeSourceSetup({ ...local, location: { ...local.location, providerLocationId: "C:\\private" } })).toThrow(SourceSetupInputError);
  });
  it("supports bounded related-file and ready-marker rules while omitting inactive settings", () => {
    expect(compileSourceSetup({ ...input, readinessMode: "related_files", relatedFileMinimum: 3 }).relatedFileMinimum).toBe(3);
    expect(compileSourceSetup({ ...input, readinessMode: "ready_marker", readyMarker: " APPROVED " }).readyMarker).toBe("APPROVED");
    expect(normalizeSourceSetup({ ...input, readyMarker: "unused", relatedFileMinimum: 8 })).not.toHaveProperty("readyMarker");
    expect(normalizeSourceSetup({ ...input, readyMarker: "unused", relatedFileMinimum: 8 })).not.toHaveProperty("relatedFileMinimum");
  });
  it.each([
    { enabled: true }, { writerUserId: input.requestId }, { instructions: "send everything" }, { name: "x" },
    { name: "a\nb" }, { requestId: "bad" }, { workspaceId: "bad" }, { storageConnectionId: undefined }, { recursive: "true" },
    { readinessMode: "ai_recommended" }, { readinessMode: "related_files", relatedFileMinimum: 0 },
    { readinessMode: "related_files", relatedFileMinimum: 101 }, { readinessMode: "ready_marker", readyMarker: " " },
    { stabilizationWindowSeconds: -1 }, { stabilizationWindowSeconds: 86401 }, { stabilizationWindowSeconds: 2.5 },
    { fileTypes: [] }, { fileTypes: ["images", "images"] }, { fileTypes: ["executables"] },
    { ignoredFolders: ["../../private"] }, { contextPacks: [{ id: input.workspaceId, expectedVersionId: "bad" }] },
    { contextPacks: [{ id: input.workspaceId, expectedVersionId: input.requestId }, { id: input.workspaceId, expectedVersionId: input.requestId }] },
    { autonomyMode: "fully_autonomous" }, { provider: "local" },
    { location: { providerLocationId: "https://example.test", displayPath: "folder" } },
    { location: { providerLocationId: "folder-1", displayPath: "folder", authority: true } },
    { provider: "sharepoint", location: { providerLocationId: "folder-1", displayPath: "Library" } },
  ])("rejects unsupported, malformed or authority-bearing settings %j", (patch) => {
    expect(() => normalizeSourceSetup({ ...input, ...patch })).toThrow(SourceSetupInputError);
  });
  it("accepts explicitly selected cloud roots and SharePoint library-qualified folders", () => {
    expect(normalizeSourceSetup({ ...input, location: { providerLocationId: "root", displayPath: "My Drive" } }).location.providerLocationId).toBe("root");
    expect(normalizeSourceSetup({ ...input, provider: "sharepoint", location: { providerLocationId: "b!drive:item", displayPath: "Library" } }).location.providerLocationId).toBe("b!drive:item");
  });
});
