import { INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS } from "@market-me/domain";
import { z } from "zod";

export const sourcePreparationUuid = z.string().trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  .transform((value) => value.toLowerCase());

const normalizedSingleLine = z.string().transform((value) => value.normalize("NFC").replace(/\s+/gu, " ").trim())
  .pipe(z.string().min(1).max(200));
const normalizedDescription = z.string().transform((value) => value.normalize("NFC").replace(/\r\n?/gu, "\n").trim())
  .pipe(z.string().max(5_000));
const timezone = z.string().trim().min(1).max(100).superRefine((value, context) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions();
  } catch {
    context.addIssue({ code: "custom", message: "Choose a valid timezone." });
  }
});

export const sourcePreparationBindingBody = z.object({
  workspaceId: sourcePreparationUuid,
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  enabled: z.boolean(),
  templateKey: z.literal("general_announcement"),
  templateVersion: z.literal(1),
  name: normalizedSingleLine,
  description: normalizedDescription,
  brandProfileVersionId: sourcePreparationUuid.optional(),
  audienceProfileVersionIds: z.array(sourcePreparationUuid).max(20),
  destinationId: sourcePreparationUuid.optional(),
  informationDepth: z.enum(INFORMATION_DEPTHS),
  promotionalStrength: z.enum(PROMOTIONAL_STRENGTHS),
  timezone,
}).strict().superRefine((value, context) => {
  if (new Set(value.audienceProfileVersionIds).size !== value.audienceProfileVersionIds.length) {
    context.addIssue({ code: "custom", path: ["audienceProfileVersionIds"], message: "Choose each Audience Profile version only once." });
  }
  for (const [field, candidate] of [["name", value.name], ["description", value.description]] as const) {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate)) {
      context.addIssue({ code: "custom", path: [field], message: "Text cannot contain control characters." });
    }
  }
});

export const sourcePreparationBindingPath = z.object({ id: sourcePreparationUuid }).strict();
export const sourcePreparationBindingQuery = z.object({ workspaceId: sourcePreparationUuid }).strict();

export type SourcePreparationBindingBody = z.infer<typeof sourcePreparationBindingBody>;

export function sourcePreparationQuery(request: Request): Record<string, string> {
  const parameters = new URL(request.url).searchParams;
  if ([...parameters.keys()].some((key) => key !== "workspaceId" || parameters.getAll(key).length !== 1)) {
    throw new z.ZodError([{ code: "custom", path: [], message: "Choose one explicit workspace." }]);
  }
  return Object.fromEntries(parameters);
}
