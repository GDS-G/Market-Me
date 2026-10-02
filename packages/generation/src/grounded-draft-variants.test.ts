import { describe, expect, it } from "vitest";
import { generateGroundedDraft, generateGroundedDraftVariants, type GroundedDraftInput } from "./index";
const input: Omit<GroundedDraftInput, "audience" | "characterBudgetAudienceName"> = {
  packageTitle: "Synthetic announcement", evidence: [{ id: "fact-b", claim: "Can you join us?", provenance: "observed", sourceReferences: ["synthetic:b"] },
    { id: "fact-a", claim: "Admission is free!", provenance: "authoritative_context", sourceReferences: ["synthetic:a"] }],
  informationDepth: "contextual", promotionalStrength: "informational", format: "channel_neutral",
};
const profile: NonNullable<GroundedDraftInput["audience"]>["profile"] = { purpose: "Synthetic", industries: [], roles: [], interests: [], locations: [], languages: ["en"], knowledgeLevel: "new",
  needs: [], motivations: [], objections: [], questions: [], preferredChannels: [], preferredFormats: [], exclusions: [] };
describe("shared deterministic draft variants", () => {
  it("keeps the General result identical without inventing an audience", () => {
    expect(generateGroundedDraftVariants(input, [])).toEqual([generateGroundedDraft(input)]);
  });
  it("preserves authored order and uses the longest audience budget for every variant", () => {
    const audiences = [{ name: "Long synthetic community audience", profile }, { name: "A", profile }];
    const saved = JSON.stringify({ input, audiences });
    const actual = generateGroundedDraftVariants(input, audiences);
    expect(actual).toEqual(audiences.map(audience => generateGroundedDraft({ ...input, audience, characterBudgetAudienceName: audiences[0]!.name })));
    expect(actual[0]!.body).toContain("For Long synthetic community audience:"); expect(actual[1]!.body).toContain("For A:");
    expect(JSON.stringify({ input, audiences })).toBe(saved);
  });
  it.each(["minimal", "teaser", "contextual", "detailed", "comprehensive", "custom"] as const)("preserves direct-generator parity at %s depth", informationDepth => {
    const settings = { ...input, informationDepth }, audiences = [{ name: "Short", profile }, { name: "A longer audience", profile }];
    expect(generateGroundedDraftVariants(settings, audiences)).toEqual(audiences.map(audience => generateGroundedDraft({ ...settings, audience, characterBudgetAudienceName: "A longer audience" })));
  });
  it("does not turn invalid evidence into an empty successful batch", () => {
    expect(() => generateGroundedDraftVariants({ ...input, evidence: [] }, [])).toThrow("approved evidence");
  });
});
