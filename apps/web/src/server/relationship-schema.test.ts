import { describe, expect, it } from "vitest";
import {
  relationshipIdentityLinkDecisionSchema,
  relationshipIdentityLinkWriteSchema,
  relationshipIdentityCandidateScanSchema,
  relationshipWriteSchema,
} from "./relationship-schema";

const base = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  displayName: "Taylor Example",
};

describe("relationship write schema", () => {
  it("defaults a workspace-local record to contact allowed", () => {
    expect(relationshipWriteSchema.parse(base)).toEqual({
      ...base,
      stage: "unknown",
      contactPermission: "allowed",
      observedInterests: [],
      sharedTopics: [],
      notes: "",
      identities: [],
    });
  });

  it("accepts a reasoned suppression and bounded verified identity", () => {
    expect(
      relationshipWriteSchema.parse({
        ...base,
        stage: "active_conversation",
        contactPermission: "suppressed",
        suppressionReason: "Explicit opt-out",
        identities: [
          {
            provider: "discord",
            providerSubjectId: "12345",
            displayHandle: "taylor",
            profileUrl: "https://example.com/taylor",
            status: "verified",
            confidence: 1,
          },
        ],
      }).contactPermission,
    ).toBe("suppressed");
  });

  it("rejects unsafe suppression and identity contracts", () => {
    expect(
      relationshipWriteSchema.safeParse({
        ...base,
        contactPermission: "suppressed",
      }).success,
    ).toBe(false);
    expect(
      relationshipWriteSchema.safeParse({
        ...base,
        identities: [
          { provider: "email", providerSubjectId: "same" },
          { provider: "email", providerSubjectId: "same" },
        ],
      }).success,
    ).toBe(false);
    expect(
      relationshipWriteSchema.safeParse({
        ...base,
        identities: [
          {
            provider: "social",
            providerSubjectId: "unsafe",
            profileUrl: "http://example.com/profile",
            confidence: 1.1,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("relationship identity-link schemas", () => {
  it("accepts only closed evidence, confidence, and decision values", () => {
    expect(
      relationshipIdentityLinkWriteSchema.parse({
        workspaceId: base.workspaceId,
        candidateRelationshipId: "22222222-2222-4222-8222-222222222222",
        evidenceKind: "exact_address",
        confidence: 0.925,
      }),
    ).toEqual({
      workspaceId: base.workspaceId,
      candidateRelationshipId: "22222222-2222-4222-8222-222222222222",
      evidenceKind: "exact_address",
      confidence: 0.925,
      initialStatus: "suggested",
    });
    expect(
      relationshipIdentityLinkWriteSchema.safeParse({
        workspaceId: base.workspaceId,
        candidateRelationshipId: "22222222-2222-4222-8222-222222222222",
        evidenceKind: "similar_name",
        confidence: 0.8,
      }).success,
    ).toBe(false);
    expect(
      relationshipIdentityLinkWriteSchema.safeParse({
        workspaceId: base.workspaceId,
        candidateRelationshipId: "22222222-2222-4222-8222-222222222222",
        evidenceKind: "verified_link",
        confidence: 1.01,
      }).success,
    ).toBe(false);
    expect(
      relationshipIdentityLinkDecisionSchema.safeParse({
        workspaceId: base.workspaceId,
        status: "suggested",
      }).success,
    ).toBe(false);
    expect(
      relationshipIdentityCandidateScanSchema.parse({
        workspaceId: base.workspaceId,
      }),
    ).toEqual({ workspaceId: base.workspaceId });
  });
});
