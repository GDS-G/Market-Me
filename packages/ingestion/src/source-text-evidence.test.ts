import { describe, expect, it } from "vitest";
import { assessSourceTextEvidence, SOURCE_TEXT_EVIDENCE_MAX_CODE_UNITS, SOURCE_TEXT_EVIDENCE_VERSION,
  type SourceTextEvidenceInput } from "./source-text-evidence";

const complete: SourceTextEvidenceInput = { extractedText: "Only registered members may attend.", extractionStatus: "completed" };

describe("whole-source text evidence assessment", () => {
  it("publishes an explicit stable contract", () => {
    expect(SOURCE_TEXT_EVIDENCE_VERSION).toBe("source-evidence-v1");
    expect(SOURCE_TEXT_EVIDENCE_MAX_CODE_UNITS).toBe(500);
  });
  it.each(["Attendance is not guaranteed!", "Only if the venue confirms.", "Is registration required?", "本日ではありません。", "غير مؤكد؟", "A\nB\tC", "😀".repeat(250), "x".repeat(500)])("preserves whole admitted text: %s", (text) => {
    expect(assessSourceTextEvidence({ ...complete, extractedText: text })).toEqual({
      reviewRequired: false, claim: text, provenance: "observed", metadata: { version: "source-evidence-v1",
        state: "whole_text", characterCount: text.length, characterCountUnit: "utf16_code_units", automaticCharacterLimit: 500, reasons: [] },
    });
  });
  it("excludes only exterior whitespace from its explicit count", () => {
    const input = { ...complete, extractedText: `\n ${"x".repeat(500)} \t` };
    expect(assessSourceTextEvidence(input)).toMatchObject({ reviewRequired: false, claim: "x".repeat(500), metadata: { characterCount: 500 } });
  });
  it.each(["x".repeat(501), `${"x".repeat(499)}😀`, "😀".repeat(251)])("never creates a bounded prefix from oversized text", (text) => {
    const result = assessSourceTextEvidence({ ...complete, extractedText: text });
    expect(result).toMatchObject({ reviewRequired: true, provenance: "unresolved", metadata: {
      characterCount: text.length, reasons: ["automatic_limit_exceeded"],
    } });
    expect(result.claim).not.toContain(text.slice(0, 20));
  });
  it.each([undefined, "", " \n\t"])("requires review for empty text %s", (extractedText) => {
    expect(assessSourceTextEvidence({ ...complete, extractedText })).toMatchObject({ reviewRequired: true,
      provenance: "unresolved", metadata: { characterCount: 0, reasons: ["empty_text"] } });
  });
  it.each(["skipped", "failed"] as const)("rejects residual text with %s status", (extractionStatus) => {
    expect(assessSourceTextEvidence({ ...complete, extractionStatus })).toMatchObject({ reviewRequired: true,
      metadata: { reasons: ["extraction_not_completed"] } });
  });
  it.each(["documentExtraction", "textExtraction"])("requires explicit completed state when %s diagnostics exist", (key) => {
    for (const value of [undefined, null, [], "completed", {}, { state: null }, { state: "truncated" }, { state: "requires_ocr" }, { state: "failed" }, { state: "new_state" }]) {
      expect(assessSourceTextEvidence({ ...complete, metadata: { [key]: value } }).reviewRequired).toBe(true);
    }
    expect(assessSourceTextEvidence({ ...complete, metadata: { [key]: { state: "completed", extra: 123 } } }).reviewRequired).toBe(false);
  });
  it("does not let a complete document marker hide incomplete text", () => {
    expect(assessSourceTextEvidence({ ...complete, metadata: { documentExtraction: { state: "completed" }, textExtraction: { state: "truncated" } } }))
      .toMatchObject({ reviewRequired: true, metadata: { reasons: ["text_incomplete"] } });
  });
  it("keeps reported error text on the asset, not in the generated review instruction", () => {
    const result = assessSourceTextEvidence({ ...complete, extractionError: "Untrusted provider detail" });
    expect(result).toMatchObject({ reviewRequired: true, metadata: { reasons: ["extraction_error"] } });
    expect(result.claim).not.toContain("Untrusted provider detail");
  });
  it("ignores blank diagnostics and unrelated metadata", () => {
    expect(assessSourceTextEvidence({ ...complete, extractionError: "  ", metadata: { displayPath: "synthetic" } }).reviewRequired).toBe(false);
  });
  it("retains every distinct reason in stable order", () => {
    const input = { extractedText: " ", extractionStatus: "failed" as const, extractionError: "Failed",
      metadata: { documentExtraction: { state: "requires_ocr" }, textExtraction: { state: "truncated" } } };
    expect(assessSourceTextEvidence(input).metadata.reasons).toEqual([
      "extraction_not_completed", "extraction_error", "document_incomplete", "text_incomplete", "empty_text",
    ]);
  });
  it("does not mutate inputs or share per-call result arrays", () => {
    const input = structuredClone(complete), original = structuredClone(input);
    const first = assessSourceTextEvidence(input), second = assessSourceTextEvidence(input);
    expect(input).toEqual(original); expect(second).toEqual(first);
    expect(second.metadata).not.toBe(first.metadata); expect(second.metadata.reasons).not.toBe(first.metadata.reasons);
  });
});
