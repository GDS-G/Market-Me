import packageMetadata from "../../../../package.json";
import { checkWebReadiness } from "@/server/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = await checkWebReadiness({ version: packageMetadata.version });
  return Response.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
