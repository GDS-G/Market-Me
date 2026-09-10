import { createHash } from "node:crypto";
import path from "node:path";
import { requireCompanionWorker } from "@/server/companion-auth";
import { getCompanionRepository, getRepository } from "@/server/database";
import { localSourceManifestSchema } from "@/server/local-source-schema";
import { apiError } from "@/server/api-response";

function localId(relativePath: string): string {
  return `local:${createHash("sha256").update(relativePath).digest("hex")}`;
}

function mimeMatches(allowed: readonly string[], mimeType: string): boolean {
  return allowed.length === 0 || allowed.some((value) => value === mimeType || (value.endsWith("/*") && mimeType.startsWith(value.slice(0, -1))));
}

function ignored(patterns: readonly string[], relativePath: string, name: string): boolean {
  return patterns.some((pattern) => {
    const expression = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\0").replaceAll("*", "[^/]*").replaceAll("\0", ".*");
    const matcher = new RegExp(`^${expression}$`, "i");
    return matcher.test(relativePath) || matcher.test(name) || matcher.test(`/${relativePath}`);
  });
}

export async function GET(request: Request) {
  try {
    const { worker } = await requireCompanionWorker(request);
    return Response.json({ data: await getCompanionRepository().listLocalSourceAssignments(worker.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { worker } = await requireCompanionWorker(request);
    const parsed = localSourceManifestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "The local source manifest is invalid." } }, { status: 422 });
    if (new Set(parsed.data.entries.map((entry) => entry.providerItemId)).size !== parsed.data.entries.length) {
      return Response.json({ error: { code: "validation_failed", message: "The local source manifest contains duplicate item identities." } }, { status: 422 });
    }
    const assignment = (await getCompanionRepository().listLocalSourceAssignments(worker.id)).find((source) => source.id === parsed.data.smartSourceId);
    if (!assignment) return Response.json({ error: { code: "not_found", message: "Assigned local Smart Source not found." } }, { status: 404 });
    const accepted = parsed.data.entries.filter((entry) => {
      const normalized = entry.relativePath.replaceAll("\\", "/");
      if (entry.providerItemId !== localId(normalized) || path.posix.basename(normalized) !== entry.name) return false;
      const parentPath = path.posix.dirname(normalized);
      const expectedParentId = parentPath === "." ? undefined : localId(parentPath);
      if (entry.providerParentId !== expectedParentId || (!assignment.recursive && normalized.includes("/"))) return false;
      return entry.isFolder || (mimeMatches(assignment.allowedMimeTypes, entry.mimeType) && !ignored(assignment.ignorePatterns, normalized, entry.name));
    });
    const repository = getRepository();
    const existing = await repository.listSourceItems(assignment.id);
    const acceptedIds = new Set(accepted.map((entry) => entry.providerItemId));
    const counts = await repository.applySourceItemChanges({
      workspaceId: assignment.workspaceId,
      smartSourceId: assignment.id,
      upserts: accepted.map((entry) => ({
        workspaceId: assignment.workspaceId, smartSourceId: assignment.id,
        providerItemId: entry.providerItemId, providerParentId: entry.providerParentId,
        name: entry.name, displayPath: entry.relativePath, mimeType: entry.mimeType, isFolder: entry.isFolder,
        sizeBytes: entry.sizeBytes, modifiedAt: entry.modifiedAt, contentHash: entry.contentHash,
      })),
      deletedProviderItemIds: existing.filter((item) => !acceptedIds.has(item.providerItemId)).map((item) => item.providerItemId),
    });
    const current = await repository.listSourceItems(assignment.id);
    const requiredUploads = current.filter((item) => !item.isFolder && item.contentHash && !item.objectKey).map((item) => item.providerItemId);
    return Response.json({ data: { ...counts, acceptedCount: accepted.length, requiredUploads } });
  } catch (error) { return apiError(error); }
}
