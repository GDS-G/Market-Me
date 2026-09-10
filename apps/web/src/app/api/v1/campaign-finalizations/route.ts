import { z } from "zod";
import { normalizeCampaignFinalizationInput } from "@market-me/database";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCampaignFinalizationRepository } from "@/server/database";
import { preparationOriginAllowed } from "@/server/campaign-preparation-api";
import { finalizationApiError, finalizationUuid, finalizationValidation } from "@/server/campaign-finalization-api";

const envelope = z.object({ input: z.unknown(), idempotencyKey: finalizationUuid }).strict();
const lookup = z.object({ workspaceId: finalizationUuid, idempotencyKey: finalizationUuid }).strict();

export async function POST(request: Request) {
  if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) {
    return Response.json({ error: { code: "origin_forbidden", message: "Finalize campaigns from this application only." } }, { status: 403 });
  }
  try {
    const parsed = envelope.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return finalizationValidation("Provide finalization settings and one valid attempt key.");
    const { normalizedInput } = normalizeCampaignFinalizationInput(parsed.data.input);
    const { user, workspace } = await requireWorkspaceAccess(normalizedInput.workspaceId, "write");
    const result = await getCampaignFinalizationRepository().finalize({ ...normalizedInput, workspaceId: workspace.workspaceId }, parsed.data.idempotencyKey, user.id);
    return Response.json({ data: result.finalization, meta: { replayed: result.replayed } }, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return finalizationApiError(error); }
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["workspaceId", "idempotencyKey"].includes(key))
      || query.getAll("workspaceId").length !== 1 || query.getAll("idempotencyKey").length !== 1) return finalizationValidation("Choose one workspace and finalization attempt.");
    const parsed = lookup.safeParse(Object.fromEntries(query));
    if (!parsed.success) return finalizationValidation("Choose a valid workspace and finalization attempt.");
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const finalization = await getCampaignFinalizationRepository().getByKey(workspace.workspaceId, parsed.data.idempotencyKey, user.id);
    return finalization ? Response.json({ data: finalization }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: { code: "not_found", message: "No completed finalization was found for this attempt." } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return finalizationApiError(error); }
}
