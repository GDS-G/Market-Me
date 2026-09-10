import { completeCompanionJobSchema } from "@market-me/companion-protocol";
import { apiError } from "@/server/api-response";
import { requireCompanionWorker } from "@/server/companion-auth";
import { getCompanionRepository } from "@/server/database";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { worker } = await requireCompanionWorker(request);
    const parsed = completeCompanionJobSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Invalid bounded job result." } }, { status: 422 });
    const completed = await getCompanionRepository().completeJob({
      workerId: worker.id,
      jobId: id,
      claimToken: parsed.data.claimToken,
      status: parsed.data.status,
      result: { externalUrl: parsed.data.externalUrl, ...parsed.data.details },
      error: parsed.data.error,
    });
    if (!completed) return Response.json({ error: { code: "claim_invalid", message: "The job claim is expired, invalid, or already completed." } }, { status: 409 });
    return Response.json({ data: { id, status: parsed.data.status } });
  } catch (error) { return apiError(error); }
}
