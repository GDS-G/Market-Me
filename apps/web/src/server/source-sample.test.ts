import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourceSampleError } from "@market-me/database";
import type { StorageConnector, NormalizedStorageEntry } from "@market-me/connectors";
import { sampleActorId, sampleCapture, sampleConnectionId, sampleNow, sampleRequest } from "../components/source-sample.test-fixture";
import { runSourceSample } from "./source-sample";

const capture = vi.fn(), assertUnchanged = vi.fn(), credentials = vi.fn(), listFolderPage = vi.fn(), ingestion = vi.fn();
const dependencies = { repository: { capture, assertUnchanged }, ingestion, now: () => sampleNow };
const remote = () => ({ ...structuredClone(sampleCapture), source: { ...sampleCapture.source, provider: "google_drive" as const, storageConnectionId: sampleConnectionId },
  location: { providerLocationId: "saved-folder", displayPath: "My Drive / Launches" } });
const entries: NormalizedStorageEntry[] = [{ provider: "google_drive", providerItemId: "file", name: "Launch.txt", mimeType: "text/plain", isFolder: false,
  modifiedAt: "2026-10-01T10:00:00.000Z", webUrl: "private-provider-url" }];
beforeEach(() => {
  vi.clearAllMocks(); capture.mockResolvedValue(structuredClone(sampleCapture)); assertUnchanged.mockResolvedValue(undefined);
  ingestion.mockReturnValue({ getConnectionAccessToken: credentials });
  credentials.mockResolvedValue({ connection: { id: sampleConnectionId, workspaceId: sampleRequest.workspaceId, provider: "google_drive" },
    connector: { listFolderPage } as unknown as StorageConnector, accessToken: "private-token" });
  listFolderPage.mockResolvedValue({ entries, incompleteSearch: false });
});
describe("bounded source-sample orchestration", () => {
  it("uses only the historical local index and checks freshness without constructing ingestion", async () => {
    const value = await runSourceSample(sampleRequest, sampleActorId, dependencies);
    expect(value.coverage).toEqual({ kind: "historical_local_index", partial: true, truncated: false });
    expect(value.simulation.counts).toMatchObject({ inspected: 3, ignored: 1, readyForAnalysis: 2 });
    expect(value.source.enabled).toBe(false); expect(ingestion).not.toHaveBeenCalled();
    expect(assertUnchanged).toHaveBeenCalledExactlyOnceWith(sampleRequest, sampleActorId, sampleCapture.fingerprint);
    for (const privateField of ["fingerprint", "internal-not-a-capability", "providerLocationId", "storageConnectionId", "parentKey"]) expect(JSON.stringify(value)).not.toContain(privateField);
  });
  it("fetches one exact saved cloud page, including ignored entries, without following tokens or downloading content", async () => {
    capture.mockResolvedValue(remote()); listFolderPage.mockResolvedValue({ entries: [...entries, { ...entries[0], providerItemId: "video", mimeType: "video/mp4" }], nextPageToken: "private-next", incompleteSearch: false });
    const value = await runSourceSample(sampleRequest, sampleActorId, dependencies);
    expect(listFolderPage).toHaveBeenCalledExactlyOnceWith({ accessToken: "private-token", providerLocationId: "saved-folder" });
    expect(value.coverage).toEqual({ kind: "cloud_folder_page", partial: true, truncated: true });
    expect(value.simulation.items.map((item) => item.outcome)).toEqual(["unknown", "ignored"]);
    expect(assertUnchanged).toHaveBeenCalledTimes(2);
    for (const privateValue of ["private-token", "private-next", "private-provider-url", "saved-folder"]) expect(JSON.stringify(value)).not.toContain(privateValue);
  });
  it.each([false, true])("preserves provider incomplete-search=%s even without continuation", async (incompleteSearch) => {
    capture.mockResolvedValue(remote()); listFolderPage.mockResolvedValue({ entries, incompleteSearch });
    expect((await runSourceSample(sampleRequest, sampleActorId, dependencies)).coverage).toEqual({ kind: "cloud_folder_page", partial: incompleteSearch, truncated: false });
  });
  it("caps excessive provider entries and labels the cutoff", async () => {
    capture.mockResolvedValue(remote()); listFolderPage.mockResolvedValue({ entries: Array.from({ length: 201 }, (_, index) => ({ ...entries[0], providerItemId: String(index) })) });
    const value = await runSourceSample(sampleRequest, sampleActorId, dependencies);
    expect(value.simulation.items).toHaveLength(200); expect(value.coverage).toMatchObject({ partial: true, truncated: true });
  });
  it("does not access credentials when capture denies membership", async () => {
    capture.mockRejectedValue(new SourceSampleError("access_denied", "No writer"));
    await expect(runSourceSample(sampleRequest, sampleActorId, dependencies)).rejects.toMatchObject({ code: "access_denied" });
    expect(ingestion).not.toHaveBeenCalled();
  });
  it("does not read the folder after scope changes during credential refresh", async () => {
    capture.mockResolvedValue(remote()); assertUnchanged.mockRejectedValue(new SourceSampleError("source_changed", "Changed"));
    await expect(runSourceSample(sampleRequest, sampleActorId, dependencies)).rejects.toMatchObject({ code: "source_changed" });
    expect(listFolderPage).not.toHaveBeenCalled();
  });
  it("discards a provider sample after permission loss during I/O", async () => {
    capture.mockResolvedValue(remote()); assertUnchanged.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new SourceSampleError("access_denied", "No writer"));
    await expect(runSourceSample(sampleRequest, sampleActorId, dependencies)).rejects.toMatchObject({ code: "access_denied" });
    expect(listFolderPage).toHaveBeenCalledOnce();
  });
  it.each(["provider", "workspaceId", "id"])("refuses mismatched credential %s before listing", async (field) => {
    capture.mockResolvedValue(remote()); credentials.mockResolvedValue({ connection: { id: sampleConnectionId, workspaceId: sampleRequest.workspaceId, provider: "google_drive", [field]: "different" }, connector: { listFolderPage }, accessToken: "private" });
    await expect(runSourceSample(sampleRequest, sampleActorId, dependencies)).rejects.toMatchObject({ code: "reference_unavailable" });
    expect(listFolderPage).not.toHaveBeenCalled();
  });
  it("refuses unsupported legacy filters before provider I/O", async () => {
    const value = remote(); value.source.ignorePatterns = ["?"]; capture.mockResolvedValue(value);
    await expect(runSourceSample(sampleRequest, sampleActorId, dependencies)).rejects.toMatchObject({ code: "sample_unsupported" });
    expect(credentials).not.toHaveBeenCalled();
  });
  it("rejects duplicate provider identities and oversized metadata without a usable plan", async () => {
    capture.mockResolvedValue(remote()); listFolderPage.mockResolvedValue({ entries: [entries[0], entries[0]] });
    await expect(runSourceSample(sampleRequest, sampleActorId, dependencies)).rejects.toMatchObject({ code: "sample_unsupported" });
    listFolderPage.mockResolvedValue({ entries: [{ ...entries[0], name: "x".repeat(513) }] });
    await expect(runSourceSample(sampleRequest, sampleActorId, dependencies)).rejects.toMatchObject({ code: "sample_unsupported" });
  });
});
