import {
  CONTEXT_FACT_STATUSES,
  CONTEXT_SOURCE_KINDS,
} from "@market-me/domain";
import { z } from "zod";

const authorityRuleSchema = z.object({
  factKey: z.string().trim().min(1).max(160),
  preferredSourceIds: z.array(z.string().uuid()).min(1).max(20),
  resolution: z.enum(["prefer_authority", "require_review"]),
});

const sourceSchema = z.object({
  clientKey: z.string().uuid(),
  kind: z.enum(CONTEXT_SOURCE_KINDS),
  sourceItemId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(160),
  sourceReference: z.string().trim().min(1).max(2048),
  selectedSections: z.array(z.string().trim().min(1).max(500)).max(100),
  authorityRank: z.number().int().min(0).max(100),
  contentText: z.string().max(50_000).optional(),
  contentHash: z.string().trim().min(1).max(256).optional(),
});

const factSchema = z.object({
  factKey: z.string().trim().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(160),
  value: z.json(),
  sourceClientKey: z.string().uuid().optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(CONTEXT_FACT_STATUSES),
  notes: z.string().max(2000).optional(),
});

export const contextPackInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000),
  instructions: z.string().max(20_000),
  authorityRules: z.array(authorityRuleSchema).max(200),
  sources: z.array(sourceSchema).max(100),
  facts: z.array(factSchema).max(1000),
}).superRefine((value, context) => {
  const sourceKeys = new Set(value.sources.map((source) => source.clientKey));
  if (sourceKeys.size !== value.sources.length) {
    context.addIssue({ code: "custom", path: ["sources"], message: "Source IDs must be unique." });
  }
  const references = new Set(value.sources.map((source) => source.sourceReference));
  if (references.size !== value.sources.length) {
    context.addIssue({ code: "custom", path: ["sources"], message: "Source references must be unique." });
  }
  value.sources.forEach((source, index) => {
    if (source.kind === "source_item" && !source.sourceItemId) {
      context.addIssue({ code: "custom", path: ["sources", index, "sourceItemId"], message: "A source item is required." });
    }
    if (source.kind === "manual_text" && !source.contentText?.trim()) {
      context.addIssue({ code: "custom", path: ["sources", index, "contentText"], message: "Manual sources require text." });
    }
    if (source.kind === "url") {
      try {
        const url = new URL(source.sourceReference);
        if (url.protocol !== "https:") throw new Error("HTTPS required");
      } catch {
        context.addIssue({ code: "custom", path: ["sources", index, "sourceReference"], message: "URL sources must use HTTPS." });
      }
    }
  });
  value.facts.forEach((fact, index) => {
    if (fact.sourceClientKey && !sourceKeys.has(fact.sourceClientKey)) {
      context.addIssue({ code: "custom", path: ["facts", index, "sourceClientKey"], message: "Fact source is not in this draft." });
    }
  });
  value.authorityRules.forEach((rule, index) => {
    if (rule.preferredSourceIds.some((id) => !sourceKeys.has(id))) {
      context.addIssue({ code: "custom", path: ["authorityRules", index, "preferredSourceIds"], message: "Authority source is not in this draft." });
    }
  });
});

export function contextPackValidationError(error: z.ZodError): Response {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "The Context Pack draft is invalid.",
      fields: z.flattenError(error).fieldErrors,
    },
  }, { status: 422 });
}
