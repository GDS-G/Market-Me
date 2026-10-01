import { simulateSourceSample, SOURCE_SAMPLE_LIMIT, type SourceSampleItem } from "@market-me/domain";
import { SourceSampleError, type SourceSampleRepository, type SourceSampleRequest } from "@market-me/database";
import type { StorageIngestionService } from "@market-me/ingestion";
import { sourceSampleViewSchema, SOURCE_SAMPLE_RESPONSE_LIMIT, type SourceSampleView } from "../components/source-sample-contract";

export async function runSourceSample(input: SourceSampleRequest, actorUserId: string, dependencies: {
  repository: Pick<SourceSampleRepository, "capture" | "assertUnchanged">;
  ingestion: () => Pick<StorageIngestionService, "getConnectionAccessToken">;
  now?: () => Date;
}): Promise<SourceSampleView> {
  const captured = await dependencies.repository.capture(input, actorUserId);
  let items: readonly SourceSampleItem[] = captured.localItems;
  let partial = true, truncated = captured.localTruncated;
  try { simulateSourceSample(captured.source, [], { now: new Date(), partial: true }); }
  catch { throw new SourceSampleError("sample_unsupported", "The saved filters use legacy expressions this bounded dry test cannot evaluate. Review the source filters."); }
  if (captured.source.provider !== "local") {
    if (!captured.source.storageConnectionId) throw new SourceSampleError("reference_unavailable", "The source needs its saved storage connection.");
    const { connection, connector, accessToken } = await dependencies.ingestion().getConnectionAccessToken(input.workspaceId, captured.source.storageConnectionId);
    if (connection.provider !== captured.source.provider || connection.workspaceId !== input.workspaceId || connection.id !== captured.source.storageConnectionId) {
      throw new SourceSampleError("reference_unavailable", "The storage connection no longer matches this source.");
    }
    // Refresh may have needed external I/O. Check again before reading a private folder.
    await dependencies.repository.assertUnchanged(input, actorUserId, captured.fingerprint);
    const page = await connector.listFolderPage({ accessToken, providerLocationId: captured.location.providerLocationId });
    truncated = page.entries.length > SOURCE_SAMPLE_LIMIT || Boolean(page.nextPageToken);
    partial = truncated || page.incompleteSearch === true;
    items = page.entries.slice(0, SOURCE_SAMPLE_LIMIT).map((entry): SourceSampleItem => ({ key: entry.providerItemId,
      // This operation lists direct children of exactly one saved folder; it never follows a continuation or descends.
      parentKey: "selected-folder", name: entry.name,
      displayPath: `${captured.location.displayPath.replace(/\/$/, "")}/${entry.name}`.replace(/\/+/g, "/"),
      mimeType: entry.mimeType, isFolder: entry.isFolder, ...(entry.modifiedAt ? { modifiedAt: entry.modifiedAt } : {}) }));
  }
  let simulation;
  try { simulation = simulateSourceSample(captured.source, items, { now: dependencies.now?.() ?? new Date(), partial }); }
  catch { throw new SourceSampleError("sample_unsupported", "The sample exceeds the metadata or filter-work limits, or has ambiguous file identities. No partial plan was returned."); }
  const result = sourceSampleViewSchema.safeParse({ workspaceId: input.workspaceId, smartSourceId: input.smartSourceId, locationIndex: input.locationIndex,
    source: { name: captured.source.name, version: captured.source.version, enabled: captured.source.enabled, recursive: captured.source.recursive },
    location: captured.location.displayPath, coverage: { kind: captured.source.provider === "local" ? "historical_local_index" : "cloud_folder_page", partial, truncated },
    context: captured.context, preparation: captured.preparation, simulation });
  if (!result.success || Buffer.byteLength(JSON.stringify(result.data), "utf8") > SOURCE_SAMPLE_RESPONSE_LIMIT) {
    throw new SourceSampleError("sample_unsupported", "The saved source or context exceeds the bounded dry-test response limits.");
  }
  await dependencies.repository.assertUnchanged(input, actorUserId, captured.fingerprint);
  return result.data;
}
