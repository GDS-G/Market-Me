import { apiError } from "@/server/api-response";
import { getPublishingRepository } from "@/server/database";
import { measurementEventSchema } from "@/server/publishing-schema";

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const secret = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!secret)
      return Response.json(
        {
          error: {
            code: "unauthorized",
            message: "Bearer measurement key required.",
          },
        },
        { status: 401 },
      );
    const repository = getPublishingRepository();
    const principal = await repository.authenticateMeasurementKey(secret);
    if (!principal)
      return Response.json(
        {
          error: {
            code: "unauthorized",
            message: "Measurement key is invalid, revoked, or expired.",
          },
        },
        { status: 401 },
      );
    const parsed = measurementEventSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the measurement event.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    if (!principal.allowedEventTypes.includes(parsed.data.eventType)) {
      return Response.json(
        {
          error: {
            code: "forbidden",
            message:
              "Measurement key is not permitted to ingest this event type.",
          },
        },
        { status: 403 },
      );
    }
    if (
      !(await repository.isMeasurementCampaignAllowed(principal, parsed.data))
    ) {
      return Response.json(
        {
          error: {
            code: "forbidden",
            message:
              "Measurement key is not permitted to ingest events for this Campaign.",
          },
        },
        { status: 403 },
      );
    }
    const created = await repository.recordMeasurementEvent({
      workspaceId: principal.workspaceId,
      ...parsed.data,
    });
    return Response.json(
      { data: { accepted: true, duplicate: !created } },
      { status: created ? 202 : 200 },
    );
  } catch (error) {
    return apiError(error);
  }
}
