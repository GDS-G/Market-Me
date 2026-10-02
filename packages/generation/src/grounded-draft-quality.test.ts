import { describe, expect, it } from "vitest";
import { generateGroundedDraft } from "./index";

const base = { packageTitle: "Synthetic workshop notice", informationDepth: "minimal" as const,
  promotionalStrength: "informational" as const, format: "social_short" as const };
const evidence = (claim: string) => [{ id: "synthetic-evidence", claim, provenance: "observed" as const,
  sourceReferences: ["synthetic:notice"] }];

describe("grounded draft presentation regressions", () => {
  it.each(["Registration is not guaranteed!", "Is registration required?", "Registration is optional."])(
    "preserves the approved terminal punctuation in %s", claim => {
      const draft = generateGroundedDraft({ ...base, evidence: evidence(claim) });
      expect(draft.body).toBe(claim);
      expect(draft.claims[0]).toEqual({ kind: "fact", text: claim, evidenceItemIds: ["synthetic-evidence"] });
    });
  it("reports the base body/CTA copy including the two-newline separator", () => {
    const draft = generateGroundedDraft({ ...base, evidence: evidence("Registration is optional."), promotionalStrength: "light" });
    expect(draft.body).toBe("Registration is optional.");
    expect(draft.callToAction).toBe("Explore the details.");
    expect(draft.presentationChoices.characterCount).toBe(47);
  });
  it("names the selected format when another format shares its numeric ceiling", () => {
    expect(() => generateGroundedDraft({ ...base, format: "direct_message", evidence: evidence("x".repeat(1001)) }))
      .toThrow("1000-character direct_message format limit");
  });
});
