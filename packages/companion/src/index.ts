import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const COMPANION_PLATFORMS = ["windows", "macos", "linux"] as const;
export const COMPANION_ARCHITECTURES = ["x86_64", "aarch64"] as const;
export const COMPANION_ACTIONS = ["open_url"] as const;
export const COMPANION_ACTION_MODES = ["confirm_before_submit", "assisted"] as const;
export const COMPANION_JOB_STATUSES = ["queued", "claimed", "succeeded", "failed", "canceled", "expired"] as const;
export const COMPANION_WORKER_STATUSES = ["active", "paused", "revoked"] as const;
export const COMPANION_HEALTH_STATES = ["healthy", "working", "needs_attention", "disconnected"] as const;

export type CompanionPlatform = typeof COMPANION_PLATFORMS[number];
export type CompanionAction = typeof COMPANION_ACTIONS[number];
export type CompanionActionMode = typeof COMPANION_ACTION_MODES[number];
export type CompanionJobStatus = typeof COMPANION_JOB_STATUSES[number];
export type CompanionWorkerStatus = typeof COMPANION_WORKER_STATUSES[number];

const localDevelopmentHost = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

export function validateCompanionServerUrl(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("Server URL must not contain credentials, a query, or a fragment");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localDevelopmentHost(url.hostname))) {
    throw new Error("Server URL must use HTTPS except for localhost development");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function validateCompanionTargetUrl(value: string, allowedDomains: readonly string[]): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new Error("Companion targets must be credential-free HTTPS URLs without a custom port or fragment");
  }
  const host = url.hostname.toLowerCase();
  if (!allowedDomains.some((domain) => domain.toLowerCase() === host)) throw new Error("Target host is outside the job allowlist");
  return url.toString();
}

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashCompanionSecret(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function createPairingCode(): { displayCode: string; normalizedCode: string; codeHash: string } {
  const bytes = randomBytes(8);
  const characters = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
  const displayCode = `MM-${characters.slice(0, 4)}-${characters.slice(4)}`;
  const normalizedCode = normalizePairingCode(displayCode);
  return { displayCode, normalizedCode, codeHash: hashCompanionSecret(normalizedCode) };
}

export function createWorkerToken(): { secret: string; prefix: string; tokenHash: string } {
  const secret = `mm_worker_${randomBytes(32).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 18), tokenHash: hashCompanionSecret(secret) };
}

export interface CompanionJobEnvelope {
  schemaVersion: 1;
  jobId: string;
  workerId: string;
  workspaceId: string;
  action: CompanionAction;
  mode: CompanionActionMode;
  targetUrl: string;
  expectedOrigin: string;
  allowedDomains: string[];
  instructions: string;
  idempotencyKey: string;
  claimToken: string;
  issuedAt: string;
  expiresAt: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

export function signCompanionJob(secret: string, envelope: CompanionJobEnvelope): string {
  return createHmac("sha256", secret).update(canonicalize(envelope)).digest("base64url");
}

export function verifyCompanionJob(secret: string, envelope: CompanionJobEnvelope, signature: string, now = new Date()): boolean {
  if (Date.parse(envelope.expiresAt) <= now.getTime() || Date.parse(envelope.issuedAt) > now.getTime() + 60_000) return false;
  const expected = Buffer.from(signCompanionJob(secret, envelope));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export const pairCompanionSchema = z.object({
  code: z.string().min(8).max(32),
  name: z.string().trim().min(1).max(100),
  platform: z.enum(COMPANION_PLATFORMS),
  architecture: z.enum(COMPANION_ARCHITECTURES),
  appVersion: z.string().trim().min(1).max(32),
}).strict();

export const companionHeartbeatSchema = z.object({
  appVersion: z.string().trim().min(1).max(32),
  platform: z.enum(COMPANION_PLATFORMS),
  architecture: z.enum(COMPANION_ARCHITECTURES),
  healthState: z.enum(["healthy", "working", "needs_attention"]),
  capabilities: z.record(z.string().max(80), z.boolean()).refine((value) => Object.keys(value).length <= 32),
  details: z.record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length <= 32).default({}),
}).strict();

export const createCompanionJobSchema = z.object({
  workspaceId: z.uuid(),
  workerId: z.uuid(),
  action: z.literal("open_url"),
  mode: z.enum(COMPANION_ACTION_MODES),
  targetUrl: z.url().max(2048),
  instructions: z.string().trim().min(1).max(2000),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const completeCompanionJobSchema = z.object({
  claimToken: z.string().min(32).max(200),
  status: z.enum(["succeeded", "failed"]),
  externalUrl: z.url().max(2048).optional(),
  error: z.string().trim().max(2000).optional(),
  details: z.record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length <= 32).default({}),
}).strict();
