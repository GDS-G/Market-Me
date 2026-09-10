import {
  INFORMATION_DEPTHS,
  PROMOTIONAL_STRENGTHS,
  type InformationDepth,
  type PromotionalStrength,
} from "@market-me/domain";
import type { CampaignDraftWrite } from "./models";

export const GENERAL_ANNOUNCEMENT_TEMPLATE_KEY = "general_announcement";
export const GENERAL_ANNOUNCEMENT_TEMPLATE_VERSION = 1;

/** Limits match the existing Campaign authoring API and PostgreSQL integer revision. */
export const CAMPAIGN_PREPARATION_LIMITS = Object.freeze({
  nameCharacters: 200,
  descriptionCharacters: 5_000,
  audienceProfiles: 20,
  timezoneCharacters: 100,
  packageVersion: 2_147_483_647,
});

export interface CampaignPreparationTemplateInput {
  workspaceId: string;
  contentPackageId: string;
  expectedPackageVersion: number;
  templateKey?: typeof GENERAL_ANNOUNCEMENT_TEMPLATE_KEY;
  templateVersion?: typeof GENERAL_ANNOUNCEMENT_TEMPLATE_VERSION;
  name?: string;
  description?: string;
  brandProfileVersionId?: string;
  audienceProfileVersionIds?: readonly string[];
  destinationId?: string;
  informationDepth?: InformationDepth;
  promotionalStrength?: PromotionalStrength;
  timezone?: string;
}

export interface NormalizedCampaignPreparationInput {
  readonly templateKey: typeof GENERAL_ANNOUNCEMENT_TEMPLATE_KEY;
  readonly templateVersion: typeof GENERAL_ANNOUNCEMENT_TEMPLATE_VERSION;
  readonly workspaceId: string;
  readonly contentPackageId: string;
  readonly expectedPackageVersion: number;
  readonly name: string;
  readonly description: string;
  readonly brandProfileVersionId?: string;
  /** Author order is meaningful: it determines generated audience-variant order. */
  readonly audienceProfileVersionIds: readonly string[];
  readonly destinationId?: string;
  readonly informationDepth: InformationDepth;
  readonly promotionalStrength: PromotionalStrength;
  readonly timezone: string;
}

export interface CompiledCampaignPreparation {
  readonly normalizedInput: NormalizedCampaignPreparationInput;
  /** Fixed-key JSON, suitable for server-side hashing; not itself an idempotency record. */
  readonly canonicalPayload: string;
  readonly campaign: Readonly<CampaignDraftWrite>;
}

export interface CampaignPreparationTemplateIssue {
  readonly field: string;
  readonly code: "invalid_input" | "unsupported_field" | "unsupported_template" | "invalid_reference"
    | "invalid_package_version" | "invalid_text" | "invalid_choice" | "invalid_timezone" | "invalid_audiences";
  readonly message: string;
}

export class CampaignPreparationTemplateValidationError extends Error {
  readonly issues: readonly CampaignPreparationTemplateIssue[];

  constructor(issue: CampaignPreparationTemplateIssue) {
    super(issue.message);
    this.name = "CampaignPreparationTemplateValidationError";
    this.issues = Object.freeze([Object.freeze(issue)]);
  }
}

const INPUT_FIELDS: ReadonlySet<string> = new Set([
  "workspaceId", "contentPackageId", "expectedPackageVersion", "templateKey", "templateVersion",
  "name", "description", "brandProfileVersionId", "audienceProfileVersionIds", "destinationId",
  "informationDepth", "promotionalStrength", "timezone",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalid(field: string, code: CampaignPreparationTemplateIssue["code"], message: string): never {
  throw new CampaignPreparationTemplateValidationError({ field, code, message });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid("input", "invalid_input", "Provide an ordinary JSON object containing preparation settings.");
  }
  // Do not invoke getters, inherit authority fields, call toJSON, or spread an untrusted object.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !INPUT_FIELDS.has(key)) {
      invalid("input", "unsupported_field", "The preparation contains an unsupported field.");
    }
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || !descriptor.enumerable) {
      invalid(key, "invalid_input", "Preparation settings must be ordinary JSON values.");
    }
  }
  return value as Record<string, unknown>;
}

function reference(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field, "invalid_reference", "Choose a valid resource ID.");
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) invalid(field, "invalid_reference", "Choose a valid resource ID.");
  return normalized;
}

function optionalReference(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : reference(value, field);
}

function audienceReferences(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > CAMPAIGN_PREPARATION_LIMITS.audienceProfiles) {
    invalid("audienceProfileVersionIds", "invalid_audiences", "Choose at most 20 published Audience Profile versions.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => key !== "length"
    && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
    invalid("audienceProfileVersionIds", "invalid_audiences", "Audience selection must be an ordinary JSON array.");
  }
  const ids: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      invalid("audienceProfileVersionIds", "invalid_audiences", "Audience selection must contain only resource IDs.");
    }
    ids.push(reference(descriptor.value, `audienceProfileVersionIds.${index}`));
  }
  if (new Set(ids).size !== ids.length) {
    invalid("audienceProfileVersionIds", "invalid_audiences", "Choose each Audience Profile version only once.");
  }
  return ids;
}

function text(value: unknown, field: string, fallback: string, maximum: number, singleLine = false): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") invalid(field, "invalid_text", "Provide text for this preparation setting.");
  let normalized = value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  if (singleLine) normalized = normalized.replace(/\s+/gu, " ");
  if (normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    invalid(field, "invalid_text", `Use at most ${maximum} characters without control characters.`);
  }
  if (singleLine && !normalized) invalid(field, "invalid_text", "Enter a non-empty preparation name.");
  return normalized;
}

function choice<T extends readonly string[]>(value: unknown, field: string, choices: T, fallback: T[number]): T[number] {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !choices.includes(value.trim())) {
    invalid(field, "invalid_choice", "Choose a supported copy control.");
  }
  return value.trim() as T[number];
}

function timezone(value: unknown): string {
  if (value === undefined) return "UTC";
  if (typeof value !== "string" || !value.trim() || value.trim().length > CAMPAIGN_PREPARATION_LIMITS.timezoneCharacters) {
    invalid("timezone", "invalid_timezone", "Choose a valid timezone.");
  }
  try {
    const identifier = value.trim();
    new Intl.DateTimeFormat("en-US", { timeZone: identifier }).resolvedOptions();
    // Validate with ICU, but do not hash ICU's version-dependent alias canonicalization.
    // Accepted identifier spellings are explicit input; aliases intentionally remain distinct.
    return identifier;
  } catch {
    invalid("timezone", "invalid_timezone", "Choose a valid timezone.");
  }
}

/**
 * Pure, versioned planning compiler. It creates no IDs, clocks, DB rows, workflow
 * commands, providers, approvals, or credentials. ID syntax is not authorization:
 * the caller must lock/recheck package revision and resolve all references and
 * policies within the authorized workspace inside the preparation transaction.
 * Changing emitted template semantics requires a new server-owned template version.
 */
export function compileGeneralAnnouncementPreparation(input: unknown): CompiledCampaignPreparation {
  const raw = record(input);
  if (raw.templateKey !== undefined && raw.templateKey !== GENERAL_ANNOUNCEMENT_TEMPLATE_KEY) {
    invalid("templateKey", "unsupported_template", "Choose the supported General Announcement template.");
  }
  if (raw.templateVersion !== undefined && raw.templateVersion !== GENERAL_ANNOUNCEMENT_TEMPLATE_VERSION) {
    invalid("templateVersion", "unsupported_template", "This Campaign template version is not supported.");
  }
  if (typeof raw.expectedPackageVersion !== "number" || !Number.isInteger(raw.expectedPackageVersion)
    || raw.expectedPackageVersion < 1 || raw.expectedPackageVersion > CAMPAIGN_PREPARATION_LIMITS.packageVersion) {
    invalid("expectedPackageVersion", "invalid_package_version", "Choose a positive Content Package revision within the database integer range.");
  }
  const audienceProfileVersionIds = audienceReferences(raw.audienceProfileVersionIds);
  const brandProfileVersionId = optionalReference(raw.brandProfileVersionId, "brandProfileVersionId");
  const destinationId = optionalReference(raw.destinationId, "destinationId");
  // Deliberate field order: caller object-key order never changes canonical bytes.
  const normalizedInput: NormalizedCampaignPreparationInput = Object.freeze({
    templateKey: GENERAL_ANNOUNCEMENT_TEMPLATE_KEY,
    templateVersion: GENERAL_ANNOUNCEMENT_TEMPLATE_VERSION,
    workspaceId: reference(raw.workspaceId, "workspaceId"),
    contentPackageId: reference(raw.contentPackageId, "contentPackageId"),
    expectedPackageVersion: raw.expectedPackageVersion,
    name: text(raw.name, "name", "General announcement", CAMPAIGN_PREPARATION_LIMITS.nameCharacters, true),
    description: text(raw.description, "description", "", CAMPAIGN_PREPARATION_LIMITS.descriptionCharacters),
    ...(brandProfileVersionId ? { brandProfileVersionId } : {}),
    audienceProfileVersionIds: Object.freeze(audienceProfileVersionIds),
    ...(destinationId ? { destinationId } : {}),
    informationDepth: choice(raw.informationDepth, "informationDepth", INFORMATION_DEPTHS, "contextual"),
    promotionalStrength: choice(raw.promotionalStrength, "promotionalStrength", PROMOTIONAL_STRENGTHS, "informational"),
    timezone: timezone(raw.timezone),
  });
  const campaign: Readonly<CampaignDraftWrite> = Object.freeze({
    workspaceId: normalizedInput.workspaceId,
    name: normalizedInput.name,
    description: normalizedInput.description,
    objective: "awareness",
    contentPackageIds: Object.freeze([normalizedInput.contentPackageId]),
    ...(brandProfileVersionId ? { brandProfileVersionId } : {}),
    audienceProfileVersionIds: Object.freeze([...audienceProfileVersionIds]),
    ...(destinationId ? { destinationId } : {}),
    informationDepth: normalizedInput.informationDepth,
    promotionalStrength: normalizedInput.promotionalStrength,
    autonomyMode: "draft_only",
    timezone: normalizedInput.timezone,
    context: Object.freeze({}),
    successCriteria: Object.freeze([]),
    successAction: "notify_only",
    steps: Object.freeze([Object.freeze({
      id: "review_preparation", name: "Review prepared campaign", operationType: "request_approval",
      desiredCapability: "workflow.approval", dependsOn: Object.freeze([]), dependencyDelaySeconds: 0,
      inputs: Object.freeze({}), outputs: Object.freeze({}), executionMethods: Object.freeze(["manual_handoff"] as const),
      approvalRequired: true, scheduleType: "immediate", condition: Object.freeze({}),
      maxAttempts: 1, timeoutSeconds: 300, optional: false,
    })]),
  });
  return Object.freeze({ normalizedInput, canonicalPayload: JSON.stringify(normalizedInput), campaign });
}
