import type { GeneratedDraft, GroundedDraftInput } from "../index";
import type { DraftQualityCase } from "./draft-cases";

export type DraftGenerator = (input: GroundedDraftInput) => GeneratedDraft;
export interface DraftQualityResult { caseId: string; passed: boolean; failures: readonly string[]; }

/** Offline exact oracle; expected wording/order comes from curated fixtures, not rendering helpers. */
export function evaluateDraftCase(testCase: DraftQualityCase, generate: DraftGenerator): DraftQualityResult {
  const failures: string[] = [];
  const input = structuredClone(testCase.input);
  const before = JSON.stringify(input);
  const invoke = (value: GroundedDraftInput) => {
    try { return { output: generate(value) }; }
    catch (error) { return { error: error instanceof Error ? error.message : "Non-Error thrown" }; }
  };
  const actual = invoke(input);
  const repeated = invoke(structuredClone(testCase.input));
  const check = (condition: boolean, name: string) => { if (!condition) failures.push(name); };
  check(JSON.stringify(input) === before, "input_unchanged");
  check(JSON.stringify(actual) === JSON.stringify(repeated), "repeatable");
  if ("error" in testCase.expected) {
    check(actual.error === testCase.expected.error && !actual.output, "expected_failure");
  } else if (!actual.output) {
    failures.push("expected_output");
  } else {
    const output = actual.output, expected = testCase.expected;
    check(output.headline === testCase.input.packageTitle, "headline_preserved");
    check(output.body === expected.body, "exact_body");
    check(output.callToAction === expected.callToAction, "exact_cta");
    const expectedClaims = expected.evidenceIds.map(id => ({ kind: "fact", text: testCase.input.evidence.find(item => item.id === id)?.claim, evidenceItemIds: [id] }));
    if (expected.callToAction) expectedClaims.push({ kind: "call_to_action", text: expected.callToAction, evidenceItemIds: [] });
    check(JSON.stringify(output.claims) === JSON.stringify(expectedClaims), "exact_claims_and_citations");
    check(expected.evidenceIds.every(id => testCase.input.evidence.some(item => item.id === id && item.provenance !== "unresolved" && !item.supersededByEvidenceId)), "eligible_citations");
    const copy = expected.body + (expected.callToAction ? `\n\n${expected.callToAction}` : "");
    check(output.presentationChoices.characterCount === copy.length, "copy_count");
    const actualCopy = output.body.trim() + (output.callToAction?.trim() ? `\n\n${output.callToAction.trim()}` : "");
    check(expected.limit === undefined || actualCopy.length <= expected.limit, "format_ceiling");
    check(output.presentationChoices.characterLimit === expected.limit, "reported_ceiling");
    check(output.presentationChoices.format === (testCase.input.format ?? "channel_neutral"), "reported_format");
    check(output.presentationChoices.groundedCopyVersion === "grounded-copy-v2" &&
      output.presentationChoices.characterCountUnit === "utf16_code_units" &&
      output.presentationChoices.characterCountScope === "body_and_cta", "presentation_contract");
    check(JSON.stringify(output.presentationChoices.factOrder) === JSON.stringify(expected.evidenceIds), "reported_fact_order");
    check(output.hashtags.length === 0 && output.altText === undefined, "no_invented_extras");
  }
  return { caseId: testCase.id, passed: failures.length === 0, failures };
}
