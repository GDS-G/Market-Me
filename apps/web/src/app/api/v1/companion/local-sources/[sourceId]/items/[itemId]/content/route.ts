import { sha256Hex } from "@market-me/media";
import { requireCompanionWorker } from "@/server/companion-auth";
import { getCompanionRepository, getRepository } from "@/server/database";
import { apiError } from "@/server/api-response";
import { getMediaObjectStore } from "@/server/media";

const MAX_LOCAL_SOURCE_BYTES = 10 * 1024 * 1024;

export async function PUT(request: Request, context: { params: Promise<{ sourceId: string; itemId: string }> }) {
  try {
    const { worker } = await requireCompanionWorker(request);
    const { sourceId, itemId } = await context.params;
    const assignment = (await getCompanionRepository().listLocalSourceAssignments(worker.id)).find((source) => source.id === sourceId);
    if (!assignment) return Response.json({ error: { code: "not_found", message: "Assigned local Smart Source not found." } }, { status: 404 });
    const repository = getRepository();
    const item = await repository.getSourceItemByProviderId(sourceId, itemId);
    if (!item || item.isFolder || !item.contentHash || item.deletedAt) return Response.json({ error: { code: "not_found", message: "Requested local source item not found." } }, { status: 404 });
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isInteger(declaredLength) || declaredLength < 1 || declaredLength > MAX_LOCAL_SOURCE_BYTES) {
      return Response.json({ error: { code: "invalid_size", message: "Local source content must contain 1 through 10 MiB." } }, { status: 413 });
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== declaredLength || bytes.byteLength > MAX_LOCAL_SOURCE_BYTES) return Response.json({ error: { code: "invalid_size", message: "Local source content length did not match." } }, { status: 413 });
    const digest = sha256Hex(bytes);
    if (item.contentHash !== `sha256:${digest}`) return Response.json({ error: { code: "hash_mismatch", message: "Local source content did not match its manifest hash." } }, { status: 409 });
    const objectKey = `originals/${digest}/source`;
    const store = getMediaObjectStore();
    await store.putImmutable(objectKey, bytes);
    const updated = await repository.setLocalSourceObjectKey({ workspaceId: assignment.workspaceId, smartSourceId: sourceId, providerItemId: itemId, contentHash: item.contentHash, objectKey });
    if (!updated) return Response.json({ error: { code: "conflict", message: "The local source changed before content was stored." } }, { status: 409 });
    return Response.json({ data: { providerItemId: itemId, contentHash: item.contentHash, byteSize: bytes.byteLength } });
  } catch (error) { return apiError(error); }
}
