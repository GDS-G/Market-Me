import type { ProcessedMediaAsset } from "@market-me/media";

export const SOURCE_TEXT_EVIDENCE_VERSION = "source-evidence-v1";
/** Automatic whole-extraction admission, not a source/download or manual-correction limit. */
export const SOURCE_TEXT_EVIDENCE_MAX_CODE_UNITS = 500;
export type SourceTextReviewReason = "extraction_not_completed" | "extraction_error"
  | "document_incomplete" | "text_incomplete" | "empty_text" | "automatic_limit_exceeded";
const reviewMessages: Readonly<Record<SourceTextReviewReason, string>> = {
  extraction_not_completed: "text extraction did not complete",
  extraction_error: "the extractor reported a diagnostic",
  document_incomplete: "document extraction is incomplete or its state is unrecognized",
  text_incomplete: "text extraction is incomplete or its state is unrecognized",
  empty_text: "no readable text was captured",
  automatic_limit_exceeded: "the whole text exceeds the 500 UTF-16-unit automatic-evidence limit",
};
export interface SourceTextEvidenceInput {
  readonly extractedText?: string;
  readonly extractionStatus: ProcessedMediaAsset["extractionStatus"];
  readonly extractionError?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
/** Present diagnostics must explicitly say completed. Absence is the existing plain-text contract. */
function incompleteDiagnostic(metadata: SourceTextEvidenceInput["metadata"], key: string): boolean {
  if (!metadata || !Object.hasOwn(metadata, key)) return false;
  const diagnostic = metadata[key];
  return diagnostic === null || typeof diagnostic !== "object" || Array.isArray(diagnostic)
    || (diagnostic as Record<string, unknown>).state !== "completed";
}

/** No summarization, prefix selection, authorization or truth assessment. Asset text is never mutated. */
export function assessSourceTextEvidence(input: SourceTextEvidenceInput) {
  const text = input.extractedText?.trim() ?? "";
  const reasons: SourceTextReviewReason[] = [];
  if (input.extractionStatus !== "completed") reasons.push("extraction_not_completed");
  if (input.extractionError?.trim()) reasons.push("extraction_error");
  if (incompleteDiagnostic(input.metadata, "documentExtraction")) reasons.push("document_incomplete");
  if (incompleteDiagnostic(input.metadata, "textExtraction")) reasons.push("text_incomplete");
  if (!text) reasons.push("empty_text");
  if (text.length > SOURCE_TEXT_EVIDENCE_MAX_CODE_UNITS) reasons.push("automatic_limit_exceeded");
  const reviewRequired = reasons.length > 0;
  return {
    reviewRequired,
    claim: reviewRequired
      ? `Source text requires review: ${reasons.map((reason) => reviewMessages[reason]).join("; ")}. Inspect the original source and available captured text before recording a supported fact. This notice is not a factual claim.`
      : text,
    provenance: reviewRequired ? "unresolved" as const : "observed" as const,
    metadata: {
      version: SOURCE_TEXT_EVIDENCE_VERSION,
      state: reviewRequired ? "review_required" as const : "whole_text" as const,
      characterCount: text.length,
      characterCountUnit: "utf16_code_units" as const,
      automaticCharacterLimit: SOURCE_TEXT_EVIDENCE_MAX_CODE_UNITS,
      reasons,
    },
  };
}
