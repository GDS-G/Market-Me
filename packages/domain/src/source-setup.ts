/** Beginner setup is a bounded compiler, never an interpreter of execution instructions. */
export const SOURCE_SETUP_FILE_TYPES = Object.freeze(["images", "documents", "presentations", "spreadsheets", "video", "audio"] as const);
export const SOURCE_SETUP_IGNORED_FOLDERS = Object.freeze(["Archive", "Drafts", "Raw", "Internal"] as const);
export const SOURCE_SETUP_MIME_TYPES = Object.freeze({
  images: Object.freeze(["image/*"]),
  documents: Object.freeze(["text/plain", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.google-apps.document"]),
  presentations: Object.freeze(["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/vnd.google-apps.presentation"]),
  spreadsheets: Object.freeze(["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.google-apps.spreadsheet"]),
  video: Object.freeze(["video/*"]),
  audio: Object.freeze(["audio/*"]),
});

export type SourceSetupFileType = typeof SOURCE_SETUP_FILE_TYPES[number];
export type SourceSetupIgnoredFolder = typeof SOURCE_SETUP_IGNORED_FOLDERS[number];
export interface SourceSetupInput {
  workspaceId: string;
  requestId: string;
  name: string;
  provider: "google_drive" | "onedrive" | "sharepoint" | "local";
  storageConnectionId?: string;
  location: { providerLocationId: string; displayPath: string };
  recursive: boolean;
  readinessMode: "immediate" | "related_files" | "ready_marker";
  stabilizationWindowSeconds: number;
  relatedFileMinimum?: number;
  readyMarker?: string;
  fileTypes: readonly SourceSetupFileType[];
  ignoredFolders: readonly SourceSetupIgnoredFolder[];
  contextPacks: readonly { id: string; expectedVersionId: string }[];
  autonomyMode: "draft_only" | "approval_required";
}

export class SourceSetupInputError extends Error {
  constructor(message: string) { super(message); this.name = "SourceSetupInputError"; }
}

export function sourceSetupUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new SourceSetupInputError("Choose a valid workspace, connection, or setup request.");
  }
  return value.toLowerCase();
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new SourceSetupInputError("Provide only the supported setup settings.");
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new SourceSetupInputError(`Provide ${label}.`);
  const result = value.normalize("NFC").trim();
  if (result.length < min || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new SourceSetupInputError(`Review ${label}; use ${min}–${max} characters without control characters.`);
  }
  return result;
}
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new SourceSetupInputError(`Choose ${label}.`);
  return value as T;
}
function selection<T extends string>(value: unknown, choices: readonly T[], minimum: number, label: string): T[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > choices.length
    || value.some((item) => !choices.includes(item)) || new Set(value).size !== value.length) {
    throw new SourceSetupInputError(`Review ${label}.`);
  }
  // These are sets. Canonical catalog order makes equivalent retries byte-identical.
  return choices.filter((item) => value.includes(item));
}
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new SourceSetupInputError(`Review ${label}.`);
  }
  return value;
}

export function normalizeSourceSetup(value: unknown): SourceSetupInput {
  const input = record(value, ["workspaceId", "requestId", "name", "provider", "storageConnectionId", "location", "recursive",
    "readinessMode", "stabilizationWindowSeconds", "relatedFileMinimum", "readyMarker", "fileTypes", "ignoredFolders", "contextPacks", "autonomyMode"]);
  const provider = choice(input.provider, ["google_drive", "onedrive", "sharepoint", "local"] as const, "a storage provider");
  const location = record(input.location, ["providerLocationId", "displayPath"]);
  const providerLocationId = provider === "local" ? sourceSetupUuid(location.providerLocationId)
    : text(location.providerLocationId, "the selected folder", 1, 500);
  if (provider === "local" && input.storageConnectionId !== undefined) throw new SourceSetupInputError("A local source uses its paired desktop, not a cloud connection.");
  if (provider === "sharepoint" && !/^[^:\s]+:[^:\s]+$/u.test(providerLocationId)) {
    throw new SourceSetupInputError("Choose a SharePoint library and folder (driveId:itemId).");
  }
  if (provider !== "sharepoint" && provider !== "local" && !/^[A-Za-z0-9_!-]+$/u.test(providerLocationId)) {
    throw new SourceSetupInputError("Choose a folder identifier, not a URL or a filesystem path.");
  }
  if (typeof input.recursive !== "boolean") throw new SourceSetupInputError("Choose whether to include subfolders.");
  if (!Array.isArray(input.contextPacks) || input.contextPacks.length > 20) throw new SourceSetupInputError("Choose up to 20 published Context Packs.");
  const contextPacks = input.contextPacks.map((value) => {
    const item = record(value, ["id", "expectedVersionId"]);
    return { id: sourceSetupUuid(item.id), expectedVersionId: sourceSetupUuid(item.expectedVersionId) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(contextPacks.map((item) => item.id)).size !== contextPacks.length) throw new SourceSetupInputError("Choose each Context Pack only once.");
  const readinessMode = choice(input.readinessMode, ["immediate", "related_files", "ready_marker"] as const, "a readiness rule");
  return {
    workspaceId: sourceSetupUuid(input.workspaceId), requestId: sourceSetupUuid(input.requestId),
    name: text(input.name, "a source name", 2, 120), provider,
    ...(provider !== "local" ? { storageConnectionId: sourceSetupUuid(input.storageConnectionId) } : {}),
    location: { providerLocationId, displayPath: provider === "local" ? "Approved companion folder" : text(location.displayPath, "a folder label", 1, 1000) },
    recursive: input.recursive, readinessMode,
    stabilizationWindowSeconds: integer(input.stabilizationWindowSeconds, 0, 86400, "the settling time"),
    ...(readinessMode === "related_files" ? { relatedFileMinimum: integer(input.relatedFileMinimum, 1, 100, "the supporting-file count") } : {}),
    ...(readinessMode === "ready_marker" ? { readyMarker: text(input.readyMarker, "a ready marker", 1, 100) } : {}),
    fileTypes: selection(input.fileTypes, SOURCE_SETUP_FILE_TYPES, 1, "the file types"),
    ignoredFolders: selection(input.ignoredFolders, SOURCE_SETUP_IGNORED_FOLDERS, 0, "the excluded folders"),
    contextPacks,
    autonomyMode: choice(input.autonomyMode, ["draft_only", "approval_required"] as const, "Draft or Review behavior"),
  };
}

export function compileSourceSetup(input: SourceSetupInput) {
  const normalized = normalizeSourceSetup(input);
  return {
    workspaceId: normalized.workspaceId, name: normalized.name, provider: normalized.provider,
    storageConnectionId: normalized.storageConnectionId, locations: [normalized.location], recursive: normalized.recursive,
    readinessMode: normalized.readinessMode, stabilizationWindowSeconds: normalized.stabilizationWindowSeconds,
    relatedFileMinimum: normalized.relatedFileMinimum, readyMarker: normalized.readyMarker,
    allowedMimeTypes: normalized.fileTypes.flatMap((type) => SOURCE_SETUP_MIME_TYPES[type]),
    ignorePatterns: ["~$*", ...normalized.ignoredFolders.map((folder) => `**/${folder}/**`)],
    contextPackIds: normalized.contextPacks.map((pack) => pack.id), autonomyMode: normalized.autonomyMode,
    enabled: false,
  };
}
