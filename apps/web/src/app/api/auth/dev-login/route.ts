import { apiError } from "@/server/api-response";
import { createUserSession } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getRepository } from "@/server/database";

export async function POST() {
  try {
    const config = getServerConfiguration();
    if (!config.developmentLoginEnabled) {
      return Response.json(
        { error: { code: "development_login_disabled", message: "Development login is disabled." } },
        { status: 404 },
      );
    }
    const result = await getRepository().bootstrapDevelopmentWorkspace({
      email: config.developmentUserEmail,
      displayName: config.developmentUserName,
    });
    await createUserSession(result.user.id);
    return Response.json({ data: result });
  } catch (error) {
    return apiError(error);
  }
}
