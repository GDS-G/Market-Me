import { apiError } from "@/server/api-response";
import { deleteUserSession } from "@/server/auth";

export async function POST() {
  try {
    await deleteUserSession();
    return Response.redirect(new URL("/login", process.env.APP_BASE_URL ?? "http://localhost:3000"), 303);
  } catch (error) {
    return apiError(error);
  }
}
