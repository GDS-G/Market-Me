import { describe, expect, it } from "vitest";
import { DRAFT_FORMATS, INFORMATION_DEPTHS, PROMOTIONAL_STRENGTHS } from "@market-me/domain";
import { generateGroundedDraft } from "../index";
import { DRAFT_QUALITY_CASES } from "./draft-cases";
import { evaluateDraftCase, type DraftGenerator } from "./draft-evaluator";

describe("versioned synthetic grounded-draft quality corpus", () => {
  it.each(DRAFT_QUALITY_CASES)("$id", testCase => {
    expect(evaluateDraftCase(testCase, generateGroundedDraft)).toEqual({ caseId: testCase.id, passed: true, failures: [] });
  });
  it("requires unique case identities", () => expect(new Set(DRAFT_QUALITY_CASES.map(item => item.id)).size).toBe(DRAFT_QUALITY_CASES.length));
  it("covers every declared format, depth and promotion choice", () => {
    expect([...new Set(DRAFT_QUALITY_CASES.map(item => item.input.format ?? "channel_neutral"))].sort()).toEqual([...DRAFT_FORMATS].sort());
    expect([...new Set(DRAFT_QUALITY_CASES.map(item => item.input.informationDepth))].sort()).toEqual([...INFORMATION_DEPTHS].sort());
    expect([...new Set(DRAFT_QUALITY_CASES.map(item => item.input.promotionalStrength))].sort()).toEqual([...PROMOTIONAL_STRENGTHS].sort());
  });
  const fixture = DRAFT_QUALITY_CASES[0]!;
  const corruptions: readonly [string, DraftGenerator][] = [
    ["changed wording", input => ({ ...generateGroundedDraft(input), body: "Admission is guaranteed." })],
    ["missing citations", input => ({ ...generateGroundedDraft(input), claims: [] })],
    ["wrong citations", input => { const result = generateGroundedDraft(input); return { ...result, claims: result.claims.map(claim => ({ ...claim, evidenceItemIds: ["unknown"] })) }; }],
    ["invented CTA", input => ({ ...generateGroundedDraft(input), callToAction: "Buy a guaranteed place." })],
    ["wrong measurement", input => { const result = generateGroundedDraft(input); return { ...result, presentationChoices: { ...result.presentationChoices, characterCount: 0 } }; }],
    ["mutated input", input => { const result = generateGroundedDraft(input); input.packageTitle = "Changed"; return result; }],
    ["unexpected failure", () => { throw new Error("Synthetic failure"); }],
  ];
  it.each(corruptions)("rejects %s rather than rubber-stamping output", (_name, generate) => {
    expect(evaluateDraftCase(fixture, generate).passed).toBe(false);
  });
  it("rejects nondeterministic output", () => {
    let sequence = 0;
    const result = evaluateDraftCase(fixture, input => ({ ...generateGroundedDraft(input), rationale: String(sequence++) }));
    expect(result.failures).toContain("repeatable");
  });
  it("does not accept unexpected success in a fail-closed case", () => {
    const negative = DRAFT_QUALITY_CASES.find(item => item.id === "no-usable-evidence")!;
    expect(evaluateDraftCase(negative, () => generateGroundedDraft(fixture.input)).failures).toContain("expected_failure");
  });
  it("rejects overflowing actual copy even if its reported count looks acceptable", () => {
    const bounded = DRAFT_QUALITY_CASES.find(item => item.id === "format-social_short-exact")!;
    const result = evaluateDraftCase(bounded, input => ({ ...generateGroundedDraft(input), body: "x".repeat(281) }));
    expect(result.failures).toContain("format_ceiling");
  });
});
