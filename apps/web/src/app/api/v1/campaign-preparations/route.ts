import { z } from "zod";
import { compileGeneralAnnouncementPreparation } from "@market-me/database";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignPreparationRepository } from "@/server/database";
import { preparationApiError, preparationOriginAllowed } from "@/server/campaign-preparation-api";

const uuid = z.string().trim().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).transform((value) => value.toLowerCase());
// Transport envelope: template input cannot carry actor or idempotency authority.
const envelope = z.object({ input: z.unknown(), idempotencyKey: uuid }).strict();
const lookup = z.object({ workspaceId: uuid, idempotencyKey: uuid }).strict();

export async function POST(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) {
    return Response.json({ error: { code: "origin_forbidden", message: "Prepare campaigns from this application only." } }, { status: 403 });
  }
  try {
    const parsed = envelope.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Provide preparation settings and one valid attempt key." } }, { status: 422 });
    const compiled = compileGeneralAnnouncementPreparation(parsed.data.input);
    const { user, workspace } = await requireWorkspaceAccess(compiled.normalizedInput.workspaceId, "write");
    const result = await getCampaignPreparationRepository().prepare(
      { ...compiled.normalizedInput, workspaceId: workspace.workspaceId }, parsed.data.idempotencyKey, user.id,
    );
    return Response.json({ data: result.preparation, meta: { replayed: result.replayed } }, {
      status: result.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return preparationApiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    if ([...parameters.keys()].some((key) => !["workspaceId", "idempotencyKey"].includes(key))
      || parameters.getAll("workspaceId").length !== 1 || parameters.getAll("idempotencyKey").length !== 1) {
      return Response.json({ error: { code: "validation_failed", message: "Choose one workspace and preparation attempt." } }, { status: 422 });
    }
    const parsed = lookup.safeParse(Object.fromEntries(parameters));
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Choose a valid workspace and preparation attempt." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const preparation = await getCampaignPreparationRepository().getByKey(workspace.workspaceId, parsed.data.idempotencyKey, user.id);
    return preparation ? Response.json({ data: preparation }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: { code: "not_found", message: "No completed preparation was found for this attempt." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return preparationApiError(error);
  }
}
