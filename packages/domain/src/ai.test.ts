import { describe, expect, it } from "vitest";
import { parseAiDraftRevisionPresentationSuggestion } from "./ai";

describe("parseAiDraftRevisionPresentationSuggestion", () => {
  it("accepts one bounded presentation-only object", () => {
    expect(parseAiDraftRevisionPresentationSuggestion(JSON.stringify({
      schemaVersion: "draft-revision-suggestion-v1",
      leadIn: "For local partners",
      callToAction: "Review the details.",
      hashtags: ["#MarketMe", "#Launch"],
      altText: "A reviewed campaign presentation.",
      rationale: "Makes the presentation clearer without changing the governed factual body.",
    }))).toEqual({
      status: "valid",
      suggestion: {
        schemaVersion: "draft-revision-suggestion-v1",
        leadIn: "For local partners",
        callToAction: "Review the details.",
        hashtags: ["#MarketMe", "#Launch"],
        altText: "A reviewed campaign presentation.",
        rationale: "Makes the presentation clearer without changing the governed factual body.",
      },
      issues: [],
      draftContentMutated: false,
      publishingAuthorized: false,
    });
  });

  it("accepts an exact JSON code fence but rejects surrounding prose", () => {
    expect(parseAiDraftRevisionPresentationSuggestion(
      "```json\n{\"schemaVersion\":\"draft-revision-suggestion-v1\",\"rationale\":\"Safe presentation change.\"}\n```",
    ).status).toBe("valid");
    expect(parseAiDraftRevisionPresentationSuggestion(
      "Here is the result: {\"schemaVersion\":\"draft-revision-suggestion-v1\",\"rationale\":\"Unsafe wrapper.\"}",
    ).status).toBe("unavailable");
  });

  it("rejects fact-bearing or unsupported fields", () => {
    for (const field of ["headline", "body", "facts", "evidence", "approval", "publish"]) {
      expect(parseAiDraftRevisionPresentationSuggestion(JSON.stringify({
        schemaVersion: "draft-revision-suggestion-v1",
        rationale: "Attempted unsupported authority.",
        [field]: "not allowed",
      }))).toMatchObject({ status: "unavailable", draftContentMutated: false, publishingAuthorized: false });
    }
  });

  it("rejects invalid presentation bounds and unknown schema versions", () => {
    const invalid = [
      { schemaVersion: "draft-revision-suggestion-v2", rationale: "Unknown version." },
      { schemaVersion: "draft-revision-suggestion-v1", leadIn: "A factual sentence.", rationale: "Punctuated lead-in." },
      { schemaVersion: "draft-revision-suggestion-v1", hashtags: ["#Same", "#same"], rationale: "Duplicate tags." },
      { schemaVersion: "draft-revision-suggestion-v1", hashtags: ["not-a-tag"], rationale: "Malformed tag." },
      { schemaVersion: "draft-revision-suggestion-v1", callToAction: "", rationale: "Empty call to action." },
      { schemaVersion: "draft-revision-suggestion-v1", rationale: "x" },
    ];
    for (const candidate of invalid)
      expect(parseAiDraftRevisionPresentationSuggestion(JSON.stringify(candidate)).status).toBe("unavailable");
  });
});
