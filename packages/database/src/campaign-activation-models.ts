/** One request identifies one intended run, not every run of a campaign version. */
export const CAMPAIGN_ACTIVATION_LIMITS = Object.freeze({ requestBytes: 2_048, previewSteps: 100, responseBytes: 65_536 });
export const CAMPAIGN_ACTIVATION_INITIAL_STATUSES = Object.freeze(["scheduled", "awaiting_approval"] as const);
export type CampaignActivationInitialStatus = (typeof CAMPAIGN_ACTIVATION_INITIAL_STATUSES)[number];
const ERROR_BRAND = Symbol.for("@market-me/database/CampaignActivationError/v1");
export class CampaignActivationError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "not_found" | "request_conflict" | "request_closed" | "grant_changed" | "preview_unavailable", message: string) {
    super(message); this.name = "CampaignActivationError";
  }
}
export const isCampaignActivationError = (value: unknown): value is CampaignActivationError =>
  value instanceof Error && Reflect.get(value, ERROR_BRAND) === true;

export interface CampaignActivationRequest {
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly requestId: string;
  readonly expectedVersionId: string;
  readonly expectedActorIncarnationId: string;
}
/** Immutable initial acceptance. Current run progress is a separate observation. */
export interface CampaignActivationReceipt extends CampaignActivationRequest {
  readonly instanceId: string;
  readonly initialStatus: CampaignActivationInitialStatus;
  readonly acceptedAt: string;
}
/** Closing an unaccepted request prevents later creation with that exact key.
 * It never cancels a run that was already accepted. */
export interface CampaignActivationClosure extends CampaignActivationRequest { readonly closedAt: string }
export type CampaignActivationOutcome = Readonly<{ kind: "accepted"; receipt: CampaignActivationReceipt }>
  | Readonly<{ kind: "closed"; receipt: CampaignActivationClosure }>;
export interface CampaignActivationStepSummary {
  readonly stepKey: string;
  readonly name: string;
  readonly operationType: string;
  readonly scheduleType: string;
  readonly approvalRequired: boolean;
}
/** A display observation, never a permission lease, quote, approval or reservation. */
export type CampaignActivationPreview = Readonly<{
  workspaceId: string; campaignId: string; versionId: string; versionNumber: number;
  campaignName: string; autonomyMode: string; timezone: string; observedAt: string;
  steps: readonly CampaignActivationStepSummary[];
}> & (Readonly<{ canActivate: false }> | Readonly<{ canActivate: true; actorIncarnationId: string }>);

export function campaignActivationUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new CampaignActivationError("invalid_input", "Provide exact campaign, workspace, version, grant and request identifiers.");
  }
  return value.toLowerCase();
}
export function normalizeCampaignActivationRequest(input: unknown): CampaignActivationRequest {
  const invalid = (): never => { throw new CampaignActivationError("invalid_input", "Review one published version before activation."); };
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields = ["workspaceId", "campaignId", "requestId", "expectedVersionId", "expectedActorIncarnationId"] as const;
  const allowed = new Set<string>(fields), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !allowed.has(key)
    || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) invalid();
  const raw = input as Record<string, unknown>;
  const request: CampaignActivationRequest = {
    workspaceId: campaignActivationUuid(raw.workspaceId), campaignId: campaignActivationUuid(raw.campaignId),
    requestId: campaignActivationUuid(raw.requestId), expectedVersionId: campaignActivationUuid(raw.expectedVersionId),
    expectedActorIncarnationId: campaignActivationUuid(raw.expectedActorIncarnationId),
  };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > CAMPAIGN_ACTIVATION_LIMITS.requestBytes) invalid();
  return Object.freeze(request);
}
