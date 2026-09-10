import { companionHeartbeatSchema } from "@market-me/companion-protocol";
import { apiError } from "@/server/api-response";
import { requireCompanionWorker } from "@/server/companion-auth";
import { getCompanionRepository } from "@/server/database";

export async function POST(request: Request) {
  try {
    const { worker } = await requireCompanionWorker(request);
    const parsed = companionHeartbeatSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Invalid bounded health payload." } }, { status: 422 });
    const updated = await getCompanionRepository().heartbeat({ workerId: worker.id, ...parsed.data });
    if (!updated) return Response.json({ error: { code: "worker_unavailable", message: "This companion is revoked." } }, { status: 409 });
    return Response.json({ data: { workerId: updated.id, status: updated.status, serverTime: new Date().toISOString() } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
