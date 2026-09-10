import { decryptToken, encryptToken, type NormalizedStorageEntry, type StorageConnector } from "@market-me/connectors";
import type {
  ConnectorCursorRecord,
  MarketMeRepository,
  SourceItemWrite,
  StorageConnectionSecrets,
  StoredSmartSource,
} from "@market-me/database";

const REFRESH_SKEW_MS = 2 * 60 * 1000;
const MAX_ITEMS_PER_SYNC = 10_000;

export interface IngestionServiceOptions {
  tokenEncryptionKey: string;
  connectorFor(provider: "google_drive" | "onedrive" | "sharepoint"): StorageConnector;
}

export interface SyncResult {
  runId: string;
  status: "completed" | "partial";
  discoveredCount: number;
  changedCount: number;
  deletedCount: number;
  inspectedCount: number;
}

function mimeMatches(allowed: readonly string[], mimeType: string): boolean {
  if (allowed.length === 0) return true;
  return allowed.some((pattern) => pattern === mimeType || (pattern.endsWith("/*") && mimeType.startsWith(pattern.slice(0, -1))));
}

function globExpression(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function ignored(patterns: readonly string[], path: string, name: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  return patterns.some((pattern) => {
    const matcher = globExpression(pattern.replaceAll("\\", "/"));
    return matcher.test(normalizedPath) || matcher.test(name) || matcher.test(`/${normalizedPath.replace(/^\//, "")}`);
  });
}

function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/$/, "")}/${name}`.replace(/\/+/g, "/");
}

function eligible(source: StoredSmartSource, entry: NormalizedStorageEntry, displayPath: string): boolean {
  return entry.isFolder || (
    mimeMatches(source.allowedMimeTypes, entry.mimeType) &&
    !ignored(source.ignorePatterns, displayPath, entry.name)
  );
}

function toSourceItem(
  source: StoredSmartSource,
  entry: NormalizedStorageEntry,
  displayPath: string,
): SourceItemWrite {
  return {
    workspaceId: source.workspaceId,
    smartSourceId: source.id,
    providerItemId: entry.providerItemId,
    providerParentId: entry.providerParentId,
    name: entry.name,
    displayPath,
    mimeType: entry.mimeType,
    isFolder: entry.isFolder,
    sizeBytes: entry.sizeBytes,
    modifiedAt: entry.modifiedAt,
    contentHash: entry.contentHash,
    providerEtag: entry.providerEtag,
    webUrl: entry.webUrl,
  };
}

export class StorageIngestionService {
  constructor(
    private readonly repository: MarketMeRepository,
    private readonly options: IngestionServiceOptions,
  ) {}

  async sampleLocation(input: {
    workspaceId: string;
    connectionId: string;
    providerLocationId: string;
  }): Promise<{ entries: readonly NormalizedStorageEntry[]; incompleteSearch: boolean }> {
    const connection = await this.requireConnection(input.workspaceId, input.connectionId);
    const connector = this.options.connectorFor(connection.provider);
    const accessToken = await this.accessToken(connection, connector);
    const page = await connector.listFolderPage({
      accessToken,
      providerLocationId: input.providerLocationId,
    });
    return { entries: page.entries.slice(0, 25), incompleteSearch: page.incompleteSearch ?? false };
  }

  async getConnectionAccessToken(workspaceId: string, connectionId: string): Promise<{
    connection: StorageConnectionSecrets;
    connector: StorageConnector;
    accessToken: string;
  }> {
    const connection = await this.requireConnection(workspaceId, connectionId);
    const connector = this.options.connectorFor(connection.provider);
    return {
      connection,
      connector,
      accessToken: await this.accessToken(connection, connector),
    };
  }

  async sampleSmartSource(workspaceId: string, smartSourceId: string) {
    const source = await this.repository.getSmartSource(workspaceId, smartSourceId);
    if (!source || !source.storageConnectionId || source.provider === "local") {
      throw new Error("Smart Source does not have a remote storage connection");
    }
    const location = source.locations[0];
    if (!location) throw new Error("Smart Source does not have a location");
    const sample = await this.sampleLocation({
      workspaceId,
      connectionId: source.storageConnectionId,
      providerLocationId: location.providerLocationId,
    });
    const entries = sample.entries.map((entry) => ({
      entry,
      displayPath: joinPath(location.displayPath, entry.name),
    }));
    const matched = entries.filter(({ entry, displayPath }) => eligible(source, entry, displayPath));
    return {
      matchedCount: matched.length,
      ignoredCount: entries.length - matched.length,
      incompleteSearch: sample.incompleteSearch,
      entries: matched.map(({ entry, displayPath }) => ({ ...entry, displayPath })),
    };
  }

  async syncSmartSource(workspaceId: string, smartSourceId: string): Promise<SyncResult> {
    const source = await this.repository.getSmartSource(workspaceId, smartSourceId);
    if (!source) throw new Error("Smart Source not found");
    if (!source.storageConnectionId || source.provider === "local") {
      throw new Error("Smart Source does not have a remote storage connection");
    }
    const connection = await this.requireConnection(workspaceId, source.storageConnectionId);
    if (connection.provider !== source.provider) throw new Error("Smart Source provider does not match its connection");
    const runId = await this.repository.startConnectorSyncRun(connection.id, source.id);
    let totals = { discoveredCount: 0, changedCount: 0, deletedCount: 0 };
    let inspectedCount = 0;
    let partial = false;

    try {
      const connector = this.options.connectorFor(connection.provider);
      const accessToken = await this.accessToken(connection, connector);
      for (const location of source.locations) {
        const result = connection.provider === "google_drive"
          ? await this.syncGoogleLocation(source, connection, connector, accessToken, location)
          : await this.syncMicrosoftLocation(source, connection, connector, accessToken, location);
        totals = {
          discoveredCount: totals.discoveredCount + result.discoveredCount,
          changedCount: totals.changedCount + result.changedCount,
          deletedCount: totals.deletedCount + result.deletedCount,
        };
        inspectedCount += result.inspectedCount;
        partial ||= result.partial;
      }
      await this.repository.finishConnectorSyncRun({
        runId,
        status: partial ? "partial" : "completed",
        ...totals,
      });
      return { runId, status: partial ? "partial" : "completed", inspectedCount, ...totals };
    } catch (error) {
      await this.repository.finishConnectorSyncRun({
        runId,
        status: "failed",
        ...totals,
        errorCode: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  }

  private async syncGoogleLocation(
    source: StoredSmartSource,
    connection: StorageConnectionSecrets,
    connector: StorageConnector,
    accessToken: string,
    location: { providerLocationId: string; displayPath: string },
  ) {
    const scopeKey = `smart-source:${source.id}:${location.providerLocationId}`;
    const storedCursor = await this.repository.getConnectorCursor(connection.id, scopeKey);
    let totals = { discoveredCount: 0, changedCount: 0, deletedCount: 0, inspectedCount: 0, partial: false };

    if (!storedCursor) {
      const queue = [{ id: location.providerLocationId, path: location.displayPath }];
      const visited = new Set<string>();
      while (queue.length > 0 && totals.inspectedCount < MAX_ITEMS_PER_SYNC) {
        const current = queue.shift()!;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        let pageToken: string | undefined;
        do {
          const page = await connector.listFolderPage({ accessToken, providerLocationId: current.id, pageToken });
          const mapped = page.entries
            .map((entry) => ({ entry, path: joinPath(current.path, entry.name) }))
            .filter(({ entry, path }) => eligible(source, entry, path));
          const applied = await this.repository.applySourceItemChanges({
            workspaceId: source.workspaceId,
            smartSourceId: source.id,
            upserts: mapped.map(({ entry, path }) => toSourceItem(source, entry, path)),
            deletedProviderItemIds: [],
          });
          totals = { ...totals, ...this.addCounts(totals, applied) };
          totals.inspectedCount += page.entries.length;
          totals.partial ||= page.incompleteSearch === true;
          if (source.recursive) {
            queue.push(...mapped.filter(({ entry }) => entry.isFolder).map(({ entry, path }) => ({ id: entry.providerItemId, path })));
          }
          pageToken = page.nextPageToken;
        } while (pageToken && totals.inspectedCount < MAX_ITEMS_PER_SYNC);
      }
      totals.partial ||= totals.inspectedCount >= MAX_ITEMS_PER_SYNC;
      const cursorPage = await connector.listChangePage({ accessToken });
      if (cursorPage.newCursor) {
        await this.repository.saveConnectorCursor({
          storageConnectionId: connection.id,
          scopeKey,
          cursor: cursorPage.newCursor,
          cursorKind: "google_page_token",
        });
      }
      return totals;
    }

    let cursor: string | undefined = storedCursor.cursor;
    const knownItems = await this.repository.listSourceItems(source.id);
    const knownFolders = new Set([
      location.providerLocationId,
      ...knownItems.filter((item) => item.isFolder).map((item) => item.providerItemId),
    ]);
    const knownPaths = new Map(knownItems.map((item) => [item.providerItemId, item.displayPath]));
    do {
      const page = await connector.listChangePage({ accessToken, cursor });
      const mapped = page.entries
        .filter((entry) => knownFolders.has(entry.providerParentId ?? ""))
        .map((entry) => ({
          entry,
          path: joinPath(knownPaths.get(entry.providerParentId ?? "") ?? location.displayPath, entry.name),
        }))
        .filter(({ entry, path }) => eligible(source, entry, path));
      for (const { entry, path } of mapped) {
        if (entry.isFolder) {
          knownFolders.add(entry.providerItemId);
          knownPaths.set(entry.providerItemId, path);
        }
      }
      const deleted = page.deletedProviderItemIds.filter((id) => knownItems.some((item) => item.providerItemId === id));
      const applied = await this.repository.applySourceItemChanges({
        workspaceId: source.workspaceId,
        smartSourceId: source.id,
        upserts: mapped.map(({ entry, path }) => toSourceItem(source, entry, path)),
        deletedProviderItemIds: deleted,
      });
      totals = { ...totals, ...this.addCounts(totals, applied) };
      totals.inspectedCount += page.entries.length + page.deletedProviderItemIds.length;
      if (page.newCursor) {
        await this.repository.saveConnectorCursor({
          storageConnectionId: connection.id,
          scopeKey,
          cursor: page.newCursor,
          cursorKind: "google_page_token",
        });
      }
      cursor = page.nextPageToken;
    } while (cursor && totals.inspectedCount < MAX_ITEMS_PER_SYNC);
    totals.partial ||= totals.inspectedCount >= MAX_ITEMS_PER_SYNC;
    return totals;
  }

  private async syncMicrosoftLocation(
    source: StoredSmartSource,
    connection: StorageConnectionSecrets,
    connector: StorageConnector,
    accessToken: string,
    location: { providerLocationId: string; displayPath: string },
  ) {
    const scopeKey = `smart-source:${source.id}:${location.providerLocationId}`;
    const storedCursor = await this.repository.getConnectorCursor(connection.id, scopeKey);
    let cursor = storedCursor?.cursor;
    let totals = { discoveredCount: 0, changedCount: 0, deletedCount: 0, inspectedCount: 0, partial: false };
    const knownItems = await this.repository.listSourceItems(source.id);
    const paths = new Map(knownItems.map((item) => [item.providerItemId, item.displayPath]));

    do {
      const page = await connector.listChangePage({
        accessToken,
        providerLocationId: location.providerLocationId,
        cursor,
      });
      const mapped = page.entries
        .map((entry) => ({
          entry,
          path: joinPath(paths.get(entry.providerParentId ?? "") ?? location.displayPath, entry.name),
        }))
        .filter(({ entry, path }) => eligible(source, entry, path));
      for (const { entry, path } of mapped) if (entry.isFolder) paths.set(entry.providerItemId, path);
      const applied = await this.repository.applySourceItemChanges({
        workspaceId: source.workspaceId,
        smartSourceId: source.id,
        upserts: mapped.map(({ entry, path }) => toSourceItem(source, entry, path)),
        deletedProviderItemIds: page.deletedProviderItemIds,
      });
      totals = { ...totals, ...this.addCounts(totals, applied) };
      totals.inspectedCount += page.entries.length + page.deletedProviderItemIds.length;
      if (page.newCursor) {
        await this.repository.saveConnectorCursor({
          storageConnectionId: connection.id,
          scopeKey,
          cursor: page.newCursor,
          cursorKind: "microsoft_delta_link",
        });
      }
      cursor = page.nextPageToken;
    } while (cursor && totals.inspectedCount < MAX_ITEMS_PER_SYNC);
    totals.partial ||= totals.inspectedCount >= MAX_ITEMS_PER_SYNC;
    return totals;
  }

  private addCounts(
    current: Pick<SyncResult, "discoveredCount" | "changedCount" | "deletedCount">,
    next: Pick<SyncResult, "discoveredCount" | "changedCount" | "deletedCount">,
  ) {
    return {
      discoveredCount: current.discoveredCount + next.discoveredCount,
      changedCount: current.changedCount + next.changedCount,
      deletedCount: current.deletedCount + next.deletedCount,
    };
  }

  private async requireConnection(workspaceId: string, connectionId: string) {
    const connection = await this.repository.getStorageConnection(workspaceId, connectionId);
    if (!connection || connection.status !== "active") throw new Error("Active storage connection not found");
    return connection;
  }

  private async accessToken(connection: StorageConnectionSecrets, connector: StorageConnector): Promise<string> {
    const key = this.options.tokenEncryptionKey;
    const expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : undefined;
    if (!expiresAt || expiresAt > Date.now() + REFRESH_SKEW_MS) {
      return decryptToken(connection.encryptedAccessToken, key);
    }
    if (!connection.encryptedRefreshToken) throw new Error("Storage connection requires reauthorization");
    const refreshToken = decryptToken(connection.encryptedRefreshToken, key);
    const tokenSet = await connector.refreshAccessToken(refreshToken);
    await this.repository.updateStorageConnectionTokens({
      connectionId: connection.id,
      encryptedAccessToken: encryptToken(tokenSet.accessToken, key),
      encryptedRefreshToken: tokenSet.refreshToken ? encryptToken(tokenSet.refreshToken, key) : undefined,
      scopes: tokenSet.scopes,
      accessTokenExpiresAt: tokenSet.expiresAt,
    });
    return tokenSet.accessToken;
  }
}
