import { z } from "zod";
import { AUDIENCE_TYPES, INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS } from "@market-me/domain";

const list = z.array(z.string().trim().min(1).max(300)).max(100).default([]);
const optionalText = z.string().trim().max(5000).optional();
const controls = {
  informationDepthDefault: z.enum(INFORMATION_DEPTHS).optional(),
  informationDepthCeiling: z.enum(["minimal", "teaser", "contextual", "detailed", "comprehensive"]).optional(),
  promotionalStrengthDefault: z.enum(PROMOTIONAL_STRENGTHS).optional(),
  promotionalStrengthCeiling: z.enum(["informational", "subtle", "light", "standard", "strong", "campaign_push"]).optional(),
};

export const brandProfileDraftSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  profile: z.object({
    officialName: z.string().trim().min(1).max(300),
    shortName: z.string().trim().max(150).optional(),
    description: z.string().trim().max(10000).default(""),
    products: list, services: list, valuePropositions: list,
    voice: z.object({ tones: list, formality: optionalText, humor: optionalText, emotion: optionalText }),
    terminology: z.object({ preferred: list, prohibited: list }),
    style: z.object({ capitalization: optionalText, punctuation: optionalText, emoji: optionalText, hashtags: optionalText, abbreviations: optionalText }),
    callToActionGuidance: optionalText,
    claims: list, evidenceRequirements: list, requiredDisclosures: list, attributionRules: list, competitorRules: list,
    visualGuidance: optionalText,
    channelPersonas: z.record(z.string().trim().min(1).max(100), z.string().trim().max(2000)).default({}),
  }),
  ...controls,
});

export const audienceProfileDraftSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  audienceType: z.enum(AUDIENCE_TYPES),
  profile: z.object({
    purpose: z.string().trim().min(1).max(5000),
    industries: list, roles: list, interests: list, locations: list, languages: list,
    knowledgeLevel: optionalText,
    needs: list, motivations: list, objections: list, questions: list,
    preferredChannels: list, preferredFormats: list,
    relationshipStage: optionalText, familiarity: optionalText,
    exclusions: list,
  }),
  ...controls,
});

export function profileValidationError(error: z.ZodError) {
  return Response.json({ error: { code: "validation_error", message: "Profile validation failed.", details: error.flatten() } }, { status: 400 });
}
