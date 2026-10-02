import type { AudienceProfileData, DraftFormat, EvidenceItem, InformationDepth, PromotionalStrength } from "@market-me/domain";
import type { GroundedDraftInput } from "../index";

export const DRAFT_QUALITY_CORPUS_VERSION = "synthetic-grounded-drafts-v1";
export interface DraftQualityCase {
  id: string;
  input: GroundedDraftInput;
  expected: { body: string; evidenceIds: readonly string[]; callToAction?: string; limit?: number } | { error: string };
}
const profile: AudienceProfileData = { purpose: "Inform", industries: [], roles: [], interests: [], locations: [], languages: ["en"],
  knowledgeLevel: "general", needs: [], motivations: [], objections: [], questions: [], preferredChannels: [], preferredFormats: [], exclusions: [] };
const fact = (id: string, claim: string, provenance: EvidenceItem["provenance"] = "observed"): EvidenceItem =>
  ({ id, claim, provenance, sourceReferences: [`synthetic:notice:${id}`] });
const base = (evidence: readonly EvidenceItem[]): GroundedDraftInput => ({ packageTitle: "Fictional community workshop", evidence,
  informationDepth: "comprehensive", promotionalStrength: "informational" });
// Explicit evaluation ceilings are an independent oracle, not imported implementation values.
const formatLimits: readonly [DraftFormat, number][] = [
  ["social_short", 280], ["social_standard", 1000], ["email", 4000],
  ["article_intro", 5000], ["community_reply", 2000], ["direct_message", 1000],
];
const depthCases: readonly [InformationDepth, readonly string[], string][] = [
  ["minimal", ["a"], "A."], ["teaser", ["a"], "A."], ["contextual", ["a", "b"], "A. B."],
  ["detailed", ["a", "b", "c", "d"], "A. B. C. D."],
  ["comprehensive", ["a", "b", "c", "d", "e"], "A. B. C. D. E."], ["custom", ["a", "b"], "A. B."],
];
const promotionCases: readonly [PromotionalStrength, string | undefined][] = [
  ["informational", undefined], ["subtle", "Learn more when it is useful."], ["light", "Explore the details."],
  ["standard", "See how this can help and take the next step."], ["strong", "Take the next step today."],
  ["campaign_push", "Act now and join the campaign."], ["custom", "Explore the next step."],
];

export const DRAFT_QUALITY_CASES: readonly DraftQualityCase[] = [
  { id: "negative-and-conditional", input: base([fact("a", "Admission is not guaranteed."), fact("b", "The workshop opens only if staffing is confirmed.")]),
    expected: { body: "Admission is not guaranteed. The workshop opens only if staffing is confirmed.", evidenceIds: ["a", "b"] } },
  { id: "question-and-exclamation", input: base([fact("a", "Is registration required?"), fact("b", "Check the published notice!")]),
    expected: { body: "Is registration required? Check the published notice!", evidenceIds: ["a", "b"] } },
  { id: "unicode-and-quotes", input: base([fact("a", "参加は任意です。"), fact("b", "هل التسجيل مطلوب؟"), fact("c", 'The notice says “Please check!”')]),
    expected: { body: "参加は任意です。 هل التسجيل مطلوب؟ The notice says “Please check!”", evidenceIds: ["a", "b", "c"] } },
  { id: "outer-whitespace-only", input: base([fact("a", "  Keep  internal spacing\nexactly.  ")]),
    expected: { body: "Keep  internal spacing\nexactly.", evidenceIds: ["a"] } },
  { id: "no-terminal-stop", input: base([fact("a", "The workshop has three sessions")]),
    expected: { body: "The workshop has three sessions.", evidenceIds: ["a"] } },
  { id: "authority-and-id-order", input: base([fact("z", "Observed Z."), fact("b", "Approved context B.", "authoritative_context"), fact("a", "Approved context A.", "authoritative_context")]),
    expected: { body: "Approved context A. Approved context B. Observed Z.", evidenceIds: ["a", "b", "z"] } },
  { id: "exclude-unresolved-and-superseded", input: base([fact("a", "Current notice."), fact("b", "Unresolved claim must not leak.", "unresolved"),
    { ...fact("c", "Superseded claim must not leak."), supersededByEvidenceId: "a" }]),
    expected: { body: "Current notice.", evidenceIds: ["a"] } },
  { id: "no-usable-evidence", input: base([fact("a", "Unknown capacity.", "unresolved")]),
    expected: { error: "An approved evidence item is required to generate a draft." } },
  { id: "empty-evidence", input: base([]), expected: { error: "An approved evidence item is required to generate a draft." } },
  { id: "blank-claim", input: base([fact("a", " \n ")]), expected: { error: "An approved factual claim must contain text." } },
  { id: "explicit-promotion", input: { ...base([fact("a", "Admission is optional.")]), promotionalStrength: "light" },
    expected: { body: "Admission is optional.", evidenceIds: ["a"], callToAction: "Explore the details." } },
  ...["Members", "Community partners"].map(name => ({ id: `audience-${name.toLowerCase().replaceAll(" ", "-")}`,
    input: { ...base([fact("a", "Admission is optional.")]), audience: { name, profile } },
    expected: { body: `For ${name}: Admission is optional.`, evidenceIds: ["a"] } })),
  ...depthCases.map(([depth, evidenceIds, body]) => ({ id: `depth-${depth}`,
    input: { ...base([fact("e", "E."), fact("c", "C."), fact("b", "B."), fact("d", "D."), fact("a", "A.")]), informationDepth: depth },
    expected: { body, evidenceIds } })),
  ...promotionCases.map(([promotionalStrength, callToAction]) => ({ id: `promotion-${promotionalStrength}`,
    input: { ...base([fact("a", "Registration is optional.")]), promotionalStrength },
    expected: { body: "Registration is optional.", evidenceIds: ["a"], callToAction } })),
  { id: "reviewed-inference-remains-last", input: base([fact("a", "Reviewed interpretation.", "inferred"), fact("b", "Direct observation.")]),
    expected: { body: "Direct observation. Reviewed interpretation.", evidenceIds: ["b", "a"] } },
  { id: "do-not-skip-an-oversized-first-fact", input: { ...base([fact("a", "x".repeat(280) + "!", "authoritative_context"), fact("b", "Short observation.")]), format: "social_short" },
    expected: { error: "Approved evidence cannot fit the 280-character social_short format limit." } },
  ...["A", "Community partners"].map(name => ({ id: `shared-audience-budget-${name.toLowerCase().replaceAll(" ", "-")}`,
    input: { ...base([fact("a", "x".repeat(249) + "."), fact("b", "Second fact.")]), format: "social_short" as const,
      audience: { name, profile }, characterBudgetAudienceName: "Community partners" },
    expected: { body: `For ${name}: ${"x".repeat(249)}.`, evidenceIds: ["a"], limit: 280 } })),
  ...formatLimits.flatMap(([format, limit]): DraftQualityCase[] => [
    { id: `format-${format}-exact`, input: { ...base([fact("a", "x".repeat(limit - 1) + "!")]), format },
      expected: { body: "x".repeat(limit - 1) + "!", evidenceIds: ["a"], limit } },
    { id: `format-${format}-overflow`, input: { ...base([fact("a", "x".repeat(limit) + "!")]), format },
      expected: { error: `Approved evidence cannot fit the ${limit}-character ${format} format limit.` } },
  ]),
  { id: "cta-separator-exact", input: { ...base([fact("a", "x".repeat(257) + "!")]), format: "social_short", promotionalStrength: "light" },
    expected: { body: "x".repeat(257) + "!", evidenceIds: ["a"], callToAction: "Explore the details.", limit: 280 } },
  { id: "cta-separator-overflow", input: { ...base([fact("a", "x".repeat(258) + "!")]), format: "social_short", promotionalStrength: "light" },
    expected: { error: "Approved evidence cannot fit the 280-character social_short format limit." } },
];
