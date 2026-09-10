import { describe, expect, it } from "vitest";
import {
  generateGroundedConversationResponse,
  generateGroundedDraft,
} from "./index";

const evidence = [
  { id: "observed", claim: "The event begins at nine", provenance: "observed" as const, sourceReferences: ["asset:1"] },
  { id: "authority", claim: "Admission is free", provenance: "authoritative_context" as const, sourceReferences: ["context:1"] },
  { id: "unresolved", claim: "Capacity may be unlimited", provenance: "unresolved" as const, sourceReferences: [] },
];

describe("generateGroundedDraft", () => {
  it("uses a shared evidence-backed fact set while audience data only changes presentation", () => {
    const base = { packageTitle: "Community event", evidence, informationDepth: "contextual" as const, promotionalStrength: "light" as const };
    const first = generateGroundedDraft({ ...base, audience: { name: "Members", profile: { purpose: "Inform", industries: [], roles: [], interests: [], locations: [], languages: ["en"], knowledgeLevel: "new", needs: [], motivations: [], objections: [], questions: [], preferredChannels: [], preferredFormats: [], exclusions: [] } } });
    const second = generateGroundedDraft({ ...base, audience: { name: "Partners", profile: { purpose: "Inform", industries: [], roles: [], interests: [], locations: [], languages: ["en"], knowledgeLevel: "expert", needs: [], motivations: [], objections: [], questions: [], preferredChannels: [], preferredFormats: [], exclusions: [] } } });
    expect(first.claims.filter((claim) => claim.kind === "fact")).toEqual(second.claims.filter((claim) => claim.kind === "fact"));
    expect(first.body).toContain("For Members:");
    expect(second.body).toContain("For Partners:");
    expect(first.body).not.toContain("unlimited");
  });

  it("fails closed without usable evidence", () => {
    expect(() => generateGroundedDraft({ packageTitle: "Empty", evidence: [evidence[2]!], informationDepth: "minimal", promotionalStrength: "informational" })).toThrow("approved evidence");
  });

  it("honors a short-format character ceiling without truncating a factual claim", () => {
    const result = generateGroundedDraft({ packageTitle: "Event", evidence, informationDepth: "comprehensive", promotionalStrength: "informational", format: "social_short" });
    expect(result.body.length).toBeLessThanOrEqual(280);
    expect(result.presentationChoices).toMatchObject({ format: "social_short", characterLimit: 280 });
    expect(result.body).not.toContain("unlimited");
  });
});

describe("generateGroundedConversationResponse", () => {
  const base = {
    contactName: "Alex",
    intent: "question" as const,
    sentiment: "neutral" as const,
    urgency: "normal" as const,
    context: {
      messages: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          kind: "inbound" as const,
          body: "Where can I find the approved 0.45 launch details?",
          occurredAt: "2026-08-06T12:00:00.000Z",
        },
      ],
      relationship: {
        id: "22222222-2222-4222-8222-222222222222",
        stage: "engaged" as const,
        effectiveContactPermission: "allowed" as const,
      },
      destination: {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Launch guide",
        canonicalUrl: "https://example.test/launch",
        status: "published" as const,
      },
    },
  };

  it("cites the exact approved Destination used by a factual response", () => {
    const result = generateGroundedConversationResponse(base);
    expect(result).toMatchObject({
      recommendation: "respond",
      proposedDestinationId: base.context.destination.id,
      uncertainty: 0.25,
    });
    expect(result.identifiedQuestions).toEqual([
      "Where can I find the approved 0.45 launch details?",
    ]);
    expect(result.responseText).toContain(base.context.destination.canonicalUrl);
    expect(result.claims[0]?.citationIndexes).toEqual([
      result.citations.findIndex((citation) => citation.kind === "destination"),
    ]);
  });

  it("fails safe to human review for sensitive reviewed intent", () => {
    const result = generateGroundedConversationResponse({
      ...base,
      intent: "complaint",
      urgency: "high",
    });
    expect(result).toMatchObject({
      recommendation: "human_review",
      recommendedPromotionalStrength: "informational",
    });
    expect(result.responseText).toBeUndefined();
  });

  it("never drafts a response for a suppressed relationship", () => {
    const result = generateGroundedConversationResponse({
      ...base,
      context: {
        ...base.context,
        relationship: {
          ...base.context.relationship,
          effectiveContactPermission: "suppressed",
        },
      },
    });
    expect(result.recommendation).toBe("no_response");
    expect(result.responseText).toBeUndefined();
    expect(result.proposedDestinationId).toBeUndefined();
  });
});
