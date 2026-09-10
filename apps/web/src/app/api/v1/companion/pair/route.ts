import { createWorkerToken, hashCompanionSecret, normalizePairingCode, pairCompanionSchema } from "@market-me/companion-protocol";
import { apiError } from "@/server/api-response";
import { getCompanionRepository } from "@/server/database";

export async function POST(request: Request) {
  try {
    const parsed = pairCompanionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Enter a valid pairing code and device details." } }, { status: 422 });
    const token = createWorkerToken();
    const worker = await getCompanionRepository().pairWorker({
      codeHash: hashCompanionSecret(normalizePairingCode(parsed.data.code)),
      name: parsed.data.name,
      platform: parsed.data.platform,
      architecture: parsed.data.architecture,
      appVersion: parsed.data.appVersion,
      tokenPrefix: token.prefix,
      tokenHash: token.tokenHash,
    });
    if (!worker) return Response.json({ error: { code: "pairing_code_invalid", message: "The pairing code is invalid, expired, or already used." } }, { status: 401 });
    return Response.json({ data: { worker, token: token.secret }, warning: "The worker token is returned once and must remain in the operating-system credential store." }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
