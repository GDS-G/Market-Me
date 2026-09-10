import "server-only";
import type { StoredCompanionWorker } from "@market-me/database";
import { getCompanionRepository } from "./database";

export class CompanionAuthenticationError extends Error {
  constructor(message = "Valid companion worker authentication is required") {
    super(message);
    this.name = "CompanionAuthenticationError";
  }
}

export async function requireCompanionWorker(request: Request): Promise<{ worker: StoredCompanionWorker; secret: string }> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new CompanionAuthenticationError();
  const secret = authorization.slice("Bearer ".length).trim();
  if (!secret.startsWith("mm_worker_") || secret.length > 128) throw new CompanionAuthenticationError();
  const worker = await getCompanionRepository().authenticateWorker(secret);
  if (!worker || worker.status === "revoked") throw new CompanionAuthenticationError();
  return { worker, secret };
}
