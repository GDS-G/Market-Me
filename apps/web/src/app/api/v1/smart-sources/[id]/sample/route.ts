import { z } from "zod";
import { SourceSetupInputError } from "@market-me/domain";
import { isSourceSampleError, SourceSampleError } from "@market-me/database";
import { sourceSampleRequestSchema } from "@/components/source-sample-contract";
import { AuthenticationError, AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { getSourceSampleRepository } from "@/server/database";
import { getIngestionService } from "@/server/ingestion";
import { runSourceSample } from "@/server/source-sample";
import { preparationOriginAllowed } from "@/server/campaign-preparation-api";
import { readSourceSetupJson, SourceSetupTransportError } from "@/server/source-setup-api";

function response(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? "")) {
      return response({ error: { code: "origin_forbidden", message: "Run a dry test from this application only." } }, 403);
    }
    const id = z.uuid().safeParse((await context.params).id);
    if (!id.success || new URL(request.url).search) throw new SourceSampleError("invalid_input", "Choose a source and send dry-test settings in the request body only.");
    const parsed = sourceSampleRequestSchema.safeParse(await readSourceSetupJson(request));
    if (!parsed.success) throw new SourceSampleError("invalid_input", "Choose a saved source version and location to test.");
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await runSourceSample({ ...parsed.data, smartSourceId: id.data }, user.id, {
      repository: getSourceSampleRepository(), ingestion: getIngestionService,
    });
    return response({ data });
  } catch (error) {
    if (error instanceof SourceSetupTransportError) return response({ error: { code: error.code, message: "Send a bounded application/json dry-test request." } }, error.status);
    if (error instanceof SourceSetupInputError) return response({ error: { code: "invalid_input", message: "Provide valid JSON dry-test settings." } }, 422);
    if (isSourceSampleError(error)) return response({ error: { code: error.code, message: error.message } },
      error.code === "access_denied" ? 403 : error.code === "source_unavailable" ? 404 : ["invalid_input", "sample_unsupported"].includes(error.code) ? 422 : 409);
    if (error instanceof AuthenticationError) return response({ error: { code: "authentication_required", message: "Sign in to run a dry test." } }, 401);
    if (error instanceof AuthorizationError) return response({ error: { code: "access_denied", message: "Current workspace writer access is required." } }, 403);
    // Provider/SQL exceptions can contain tokens, metadata or private statements.
    console.error("Smart Source dry test could not complete; no provider or persistence detail was logged.");
    return response({ error: { code: "sample_unavailable", message: "The sample is unavailable. Check the connection and try again. No source settings or content were created by this test." } }, 503);
  }
}
