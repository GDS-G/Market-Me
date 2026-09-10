import { createPairingCode } from "@market-me/companion-protocol";
import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getCompanionRepository } from "@/server/database";

const schema = z.object({ workspaceId: z.uuid() }).strict();

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "A workspace is required." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const code = createPairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await getCompanionRepository().createPairingCode({ workspaceId: workspace.workspaceId, codeHash: code.codeHash, expiresAt, createdBy: user.id });
    return Response.json({ data: { code: code.displayCode, expiresAt: expiresAt.toISOString() }, warning: "This pairing code expires in 10 minutes and can be used once." }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
