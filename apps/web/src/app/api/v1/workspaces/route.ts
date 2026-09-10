import { apiError } from "@/server/api-response";
import { requireAuthenticatedUser } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function GET() {
  try {
    const user = await requireAuthenticatedUser();
    const data = await getRepository().listWorkspaceAccess(user.id);
    return Response.json({ data });
  } catch (error) {
    return apiError(error);
  }
}
