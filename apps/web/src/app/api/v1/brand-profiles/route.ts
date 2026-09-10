import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getProfileRepository } from "@/server/database";
import { brandProfileDraftSchema, profileValidationError } from "@/server/profile-schema";

export async function GET(request: Request) { try { const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined; const { workspace } = await requireWorkspaceAccess(workspaceId); const data = await getProfileRepository().listBrandProfiles(workspace.workspaceId); return Response.json({ data, meta: { count: data.length, persistence: "postgresql" } }); } catch (error) { return apiError(error); } }
export async function POST(request: Request) { try { const parsed = brandProfileDraftSchema.safeParse(await request.json()); if (!parsed.success) return profileValidationError(parsed.error); const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write"); return Response.json({ data: await getProfileRepository().createBrandProfile(parsed.data, user.id) }, { status: 201 }); } catch (error) { return apiError(error); } }
