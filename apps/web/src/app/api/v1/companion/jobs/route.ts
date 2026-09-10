import { createCompanionJobSchema, signCompanionJob, validateCompanionTargetUrl, type CompanionJobEnvelope } from "@market-me/companion-protocol";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { requireCompanionWorker } from "@/server/companion-auth";
import { getCompanionRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { worker, secret } = await requireCompanionWorker(request);
    if (worker.status === "paused") return Response.json({ data: null, workerStatus: "paused" }, { headers: { "Cache-Control": "no-store" } });
    const claimed = await getCompanionRepository().claimNextJob(worker.id);
    if (!claimed) return Response.json({ data: null, workerStatus: worker.status }, { headers: { "Cache-Control": "no-store" } });
    validateCompanionTargetUrl(claimed.job.targetUrl, claimed.job.allowedDomains);
    const issuedAt = new Date().toISOString();
    const envelope: CompanionJobEnvelope = {
      schemaVersion: 1,
      jobId: claimed.job.id,
      workerId: claimed.job.workerId,
      workspaceId: claimed.job.workspaceId,
      action: claimed.job.action,
      mode: claimed.job.actionMode,
      targetUrl: claimed.job.targetUrl,
      expectedOrigin: claimed.job.expectedOrigin,
      allowedDomains: claimed.job.allowedDomains,
      instructions: claimed.job.instructions,
      idempotencyKey: claimed.job.idempotencyKey,
      claimToken: claimed.claimToken,
      issuedAt,
      expiresAt: claimed.job.leaseExpiresAt!,
    };
    return Response.json({ data: { envelope, signature: signCompanionJob(secret, envelope) }, workerStatus: worker.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = createCompanionJobSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Enter a valid worker, HTTPS target, instructions, and idempotency key." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const worker = (await getCompanionRepository().listWorkers(workspace.workspaceId)).find((candidate) => candidate.id === parsed.data.workerId);
    if (!worker || worker.status === "revoked") return Response.json({ error: { code: "worker_unavailable", message: "Select an available companion in this workspace." } }, { status: 422 });
    const target = new URL(parsed.data.targetUrl);
    const targetUrl = validateCompanionTargetUrl(parsed.data.targetUrl, [target.hostname]);
    const job = await getCompanionRepository().createJob({
      workspaceId: workspace.workspaceId,
      workerId: parsed.data.workerId,
      action: parsed.data.action,
      actionMode: parsed.data.mode,
      targetUrl,
      expectedOrigin: target.origin,
      allowedDomains: [target.hostname.toLowerCase()],
      instructions: parsed.data.instructions,
      idempotencyKey: parsed.data.idempotencyKey,
      createdBy: user.id,
    });
    return Response.json({ data: job }, { status: 201 });
  } catch (error) { return apiError(error); }
}
