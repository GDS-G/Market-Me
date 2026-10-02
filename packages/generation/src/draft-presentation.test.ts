import { describe, expect, it } from "vitest";
import { draftCopyCharacterCount, draftCopyPresentation, renderGroundedFact } from "./draft-presentation";

describe("shared grounded copy presentation contract", () => {
  it.each(["A.", "A!", "A?", "A…", "A。", "A！", "A？", "A؟", "A।", '“A!”', '"A?"', "(A.)", "[A!]"])("retains terminal punctuation in %s", claim => {
    expect(renderGroundedFact(claim)).toBe(claim);
  });
  it("trims only outside and adds a stop when absent", () => expect(renderGroundedFact("  A  B\nC  ")).toBe("A  B\nC."));
  it("rejects blank approved text", () => expect(() => renderGroundedFact(" \n ")).toThrow("must contain text"));
  it.each([
    ["A", undefined, 1], ["A", "", 1], ["A", " \n ", 1], [" A ", " B ", 4], ["😀", "!", 5], ["", "B", 1],
  ] as const)("counts the normalized body/CTA fields (%s, %s)", (body, cta, expected) => {
    expect(draftCopyCharacterCount(body, cta)).toBe(expected);
  });
  it("records units and scope even for unbounded generic copy", () => {
    expect(draftCopyPresentation("A", "B", "channel_neutral")).toEqual({ groundedCopyVersion: "grounded-copy-v2",
      format: "channel_neutral", characterCount: 4, characterCountUnit: "utf16_code_units", characterCountScope: "body_and_cta" });
  });
});
