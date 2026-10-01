import { normalizeSourceSetup, sourceSetupUuid, type SourceSetupInput } from "@market-me/domain";
import type { SourceSetupReceipt } from "@market-me/database";

export interface SourceSetupScope { workspaceId: string; userId: string }
export interface SourceSetupAttempt { version: 1; userId: string; input: SourceSetupInput }
export function sourceSetupStorageKey(scope: SourceSetupScope) {
  return `market-me:source-setup:v1:${sourceSetupUuid(scope.workspaceId)}:${sourceSetupUuid(scope.userId)}`;
}
export function createSourceSetupAttempt(scope: SourceSetupScope, input: SourceSetupInput): SourceSetupAttempt {
  const normalized = normalizeSourceSetup(input);
  if (normalized.workspaceId !== sourceSetupUuid(scope.workspaceId)) throw new Error("Setup workspace changed.");
  return { version: 1, userId: sourceSetupUuid(scope.userId), input: normalized };
}
export function restoreSourceSetupAttempt(raw: string | null, scope: SourceSetupScope): SourceSetupAttempt | undefined {
  if (raw === null) return;
  if (raw.length > 40_000) throw new Error("Saved setup is too large.");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved setup.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["version", "userId", "input"].includes(key)) || record.version !== 1
    || record.userId !== sourceSetupUuid(scope.userId)) throw new Error("Saved setup scope changed.");
  return createSourceSetupAttempt(scope, normalizeSourceSetup(record.input));
}
export function isSourceSetupReceipt(value: unknown, input: SourceSetupInput): value is SourceSetupReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = ["workspaceId", "requestId", "smartSourceId", "name", "createdAt", "initialState"];
  if (Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))) return false;
  try {
    return record.workspaceId === input.workspaceId && record.requestId === input.requestId
      && record.smartSourceId === sourceSetupUuid(record.smartSourceId) && record.initialState === "paused"
      && record.name === input.name
      && typeof record.createdAt === "string" && new Date(record.createdAt).toISOString() === record.createdAt;
  } catch { return false; }
}
export function sourceSetupResultPath(receipt: SourceSetupReceipt) {
  return `/smart-sources/${sourceSetupUuid(receipt.smartSourceId)}/edit?workspaceId=${sourceSetupUuid(receipt.workspaceId)}`;
}

export interface SourceSetupFolderPage {
  folders: readonly { providerLocationId: string; name: string }[];
  examinedCount: number;
  incompleteSearch: boolean;
  nextCursor?: string;
}
export function isSourceSetupFolderPage(value: unknown): value is SourceSetupFolderPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => ["folders", "examinedCount", "incompleteSearch", "nextCursor"].includes(key))
    && Array.isArray(record.folders) && record.folders.length <= 200 && record.folders.every((folder: unknown) => {
      if (!folder || typeof folder !== "object" || Array.isArray(folder)) return false;
      const entry = folder as Record<string, unknown>;
      return Object.keys(entry).length === 2 && typeof entry.providerLocationId === "string" && entry.providerLocationId.length > 0
        && entry.providerLocationId.length <= 500 && typeof entry.name === "string" && entry.name.length > 0 && entry.name.length <= 1000;
    }) && typeof record.examinedCount === "number" && Number.isInteger(record.examinedCount) && record.examinedCount >= record.folders.length
    && record.examinedCount <= 200 && typeof record.incompleteSearch === "boolean"
    && (record.nextCursor === undefined || typeof record.nextCursor === "string" && record.nextCursor.length > 0 && record.nextCursor.length <= 24_000);
}
