import { describe, expect, it } from "vitest";
import {
  conversationHandoffCloseSchema,
  conversationHandoffWriteSchema,
  conversationReadSchema,
  conversationDraftingPresenceSchema,
  conversationLegalHoldReleaseDecisionSchema,
  conversationLegalHoldReleaseRequestSchema,
  conversationLegalHoldSchema,
  conversationRetentionClassSchema,
  conversationRetentionErasureDecisionSchema,
  conversationRetentionErasureRequestSchema,
  conversationRetentionPolicySchema,
  conversationResponseDraftWriteSchema,
  conversationReviewRequestCloseSchema,
  conversationReviewRequestWriteSchema,
  conversationResponseSuggestionDecisionSchema,
  conversationResponseSuggestionGenerateSchema,
  conversationRoutingRuleEnabledSchema,
  conversationRoutingRuleWriteSchema,
  conversationServiceLevelPolicySchema,
  conversationSharedResourceWriteSchema,
  conversationThreadQuerySchema,
  conversationThreadWriteSchema,
  internalNoteSchema,
} from "./conversation-schema";

const base = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  relationshipId: "22222222-2222-4222-8222-222222222222",
  provider: "manual",
  subject: "Partnership follow-up",
};
const campaignId = "44444444-4444-4444-8444-444444444444";
const destinationId = "55555555-5555-4555-8555-555555555555";
const accountId = "66666666-6666-4666-8666-666666666666";
const publicationId = "77777777-7777-4777-8777-777777777777";
const brandId = "88888888-8888-4888-8888-888888888888";

describe("conversation schemas", () => {
  it("defaults a provider-neutral thread to new", () => {
    expect(conversationThreadWriteSchema.parse(base)).toEqual({
      ...base,
      status: "new",
    });
  });

  it("enforces assignment consistency", () => {
    expect(
      conversationThreadWriteSchema.safeParse({ ...base, status: "assigned" })
        .success,
    ).toBe(false);
    expect(
      conversationThreadWriteSchema.safeParse({
        ...base,
        status: "unassigned",
        assignedOwnerId: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(false);
    expect(
      conversationThreadWriteSchema.safeParse({
        ...base,
        status: "assigned",
        assignedOwnerId: "33333333-3333-4333-8333-333333333333",
      }).success,
    ).toBe(true);
  });

  it("accepts only bounded non-empty internal notes", () => {
    expect(
      internalNoteSchema.safeParse({
        workspaceId: base.workspaceId,
        body: "Reviewed note",
      }).success,
    ).toBe(true);
    expect(
      internalNoteSchema.safeParse({ workspaceId: base.workspaceId, body: " " })
        .success,
    ).toBe(false);
  });

  it("validates handoff briefs, close actions, and ISO deadlines", () => {
    const conversationThreadId = "44444444-4444-4444-8444-444444444444";
    expect(
      conversationHandoffWriteSchema.safeParse({
        workspaceId: base.workspaceId,
        conversationThreadId,
        contactSummary: "Jordan at Example Co.",
        importance: "Time-sensitive partnership question.",
        requestOrOffer: "Asked for reviewed terms.",
      }).success,
    ).toBe(true);
    expect(
      conversationHandoffWriteSchema.safeParse({
        workspaceId: base.workspaceId,
        conversationThreadId,
        contactSummary: " ",
        importance: "Required",
        requestOrOffer: "Required",
      }).success,
    ).toBe(false);
    expect(
      conversationHandoffCloseSchema.safeParse({
        workspaceId: base.workspaceId,
        status: "resolved",
      }).success,
    ).toBe(true);
    expect(
      conversationThreadWriteSchema.safeParse({
        ...base,
        responseDueAt: "tomorrow",
      }).success,
    ).toBe(false);
  });

  it("bounds inbox search and triage query values", () => {
    expect(
      conversationThreadQuerySchema.parse({
        search: "partnership",
        status: "assigned",
        owner: "33333333-3333-4333-8333-333333333333",
        sentiment: "negative",
        intent: "complaint",
        urgency: "high",
        campaign: campaignId,
        destination: destinationId,
        account: accountId,
        publication: publicationId,
        brand: brandId,
        handoff: "open",
        deadline: "upcoming",
        read: "unread",
        activityFrom: "2026-08-01",
        limit: "25",
      }),
    ).toEqual(expect.objectContaining({ search: "partnership", limit: 25 }));
    expect(
      conversationThreadQuerySchema.safeParse({ limit: 201 }).success,
    ).toBe(false);
    expect(
      conversationThreadQuerySchema.safeParse({ activityFrom: "08/01/2026" })
        .success,
    ).toBe(false);
    expect(
      conversationThreadQuerySchema.safeParse({ read: "maybe" }).success,
    ).toBe(false);
    expect(
      conversationThreadQuerySchema.safeParse({ owner: "someone" }).success,
    ).toBe(false);
    expect(
      conversationThreadQuerySchema.safeParse({ urgency: "emergency" }).success,
    ).toBe(false);
    expect(
      conversationThreadWriteSchema.safeParse({
        ...base,
        campaignId,
        destinationId,
        channelConnectionId: accountId,
        publicationActionId: publicationId,
        brandProfileId: brandId,
        sentiment: "positive",
        intent: "collaboration",
        urgency: "normal",
      }).success,
    ).toBe(true);
    expect(
      conversationThreadWriteSchema.safeParse({
        ...base,
        campaignId: "foreign",
      }).success,
    ).toBe(false);
    expect(
      conversationThreadWriteSchema.safeParse({
        ...base,
        brandProfileId: "brand",
      }).success,
    ).toBe(false);
    expect(
      conversationThreadWriteSchema.safeParse({
        ...base,
        campaignId: null,
        destinationId: null,
      }).success,
    ).toBe(true);
    expect(
      conversationThreadWriteSchema.safeParse({
        ...base,
        publicationActionId: publicationId,
      }).success,
    ).toBe(false);
  });

  it("requires a workspace UUID when marking a conversation read", () => {
    expect(
      conversationReadSchema.safeParse({ workspaceId: base.workspaceId })
        .success,
    ).toBe(true);
    expect(
      conversationReadSchema.safeParse({ workspaceId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("requires one exact observed shared-resource target", () => {
    const common = {
      workspaceId: base.workspaceId,
      idempotencyKey: "99999999-9999-4999-8999-999999999999",
      observedAt: "2026-08-01T12:00:00.000Z",
    };
    expect(
      conversationSharedResourceWriteSchema.safeParse({
        ...common,
        kind: "destination",
        destinationId,
      }).success,
    ).toBe(true);
    expect(
      conversationSharedResourceWriteSchema.safeParse({
        ...common,
        kind: "publication",
        publicationActionId: publicationId,
      }).success,
    ).toBe(true);
    expect(
      conversationSharedResourceWriteSchema.safeParse({
        ...common,
        kind: "destination",
        destinationId,
        publicationActionId: publicationId,
      }).success,
    ).toBe(false);
  });

  it("requires routing matchers and consistent target assignment", () => {
    const rule = {
      workspaceId: base.workspaceId,
      name: "Urgent collaboration",
      priority: 200,
      urgency: "high",
      intent: "collaboration",
      targetStatus: "assigned",
      targetOwnerId: "33333333-3333-4333-8333-333333333333",
    };
    expect(conversationRoutingRuleWriteSchema.safeParse(rule).success).toBe(
      true,
    );
    expect(
      conversationRoutingRuleWriteSchema.safeParse({
        ...rule,
        urgency: undefined,
        intent: undefined,
      }).success,
    ).toBe(false);
    expect(
      conversationRoutingRuleWriteSchema.safeParse({
        ...rule,
        targetStatus: "waiting_internal_information",
      }).success,
    ).toBe(false);
    expect(
      conversationRoutingRuleEnabledSchema.safeParse({
        workspaceId: base.workspaceId,
        enabled: false,
      }).success,
    ).toBe(true);
  });

  it("bounds service-level business calendars and targets", () => {
    const policy = {
      workspaceId: base.workspaceId,
      timezone: "America/Chicago",
      businessDaysMask: 62,
      businessStartTime: "09:00",
      businessEndTime: "17:00",
      unknownTargetMinutes: 480,
      lowTargetMinutes: 480,
      normalTargetMinutes: 240,
      highTargetMinutes: 60,
      criticalTargetMinutes: 15,
      atRiskBeforeMinutes: 15,
      escalationAfterMinutes: 60,
    };
    expect(conversationServiceLevelPolicySchema.safeParse(policy).success).toBe(true);
    expect(
      conversationServiceLevelPolicySchema.safeParse({
        ...policy,
        businessDaysMask: 0,
      }).success,
    ).toBe(false);
    expect(
      conversationServiceLevelPolicySchema.safeParse({
        ...policy,
        escalationAfterMinutes: 10081,
      }).success,
    ).toBe(false);
    expect(
      conversationServiceLevelPolicySchema.safeParse({
        ...policy,
        businessStartTime: "17:00",
        businessEndTime: "09:00",
      }).success,
    ).toBe(false);
  });

  it("validates internal review targets, mentions, and close states", () => {
    const review = {
      workspaceId: base.workspaceId,
      conversationThreadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      requestText: "Review the proposed internal next step.",
      requestedReviewerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      mentionedUserIds: ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"],
      dueAt: "2026-08-10T17:00:00.000Z",
    };
    expect(conversationReviewRequestWriteSchema.safeParse(review).success).toBe(
      true,
    );
    expect(
      conversationReviewRequestWriteSchema.safeParse({
        ...review,
        mentionedUserIds: [
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        ],
      }).success,
    ).toBe(false);
    expect(
      conversationReviewRequestWriteSchema.safeParse({
        ...review,
        mentionedUserIds: [review.requestedReviewerId],
      }).success,
    ).toBe(false);
    expect(
      conversationReviewRequestCloseSchema.safeParse({
        workspaceId: base.workspaceId,
        status: "resolved",
      }).success,
    ).toBe(true);
  });

  it("accepts only explicit Conversation Assistant generation and dismissal commands", () => {
    expect(
      conversationResponseSuggestionGenerateSchema.safeParse({
        workspaceId: base.workspaceId,
      }).success,
    ).toBe(true);
    expect(
      conversationResponseSuggestionGenerateSchema.safeParse({
        workspaceId: base.workspaceId,
        responseText: "client supplied",
      }).success,
    ).toBe(false);
    expect(
      conversationResponseSuggestionDecisionSchema.safeParse({
        workspaceId: base.workspaceId,
        status: "dismissed",
      }).success,
    ).toBe(true);
    expect(
      conversationResponseSuggestionDecisionSchema.safeParse({
        workspaceId: base.workspaceId,
        status: "accepted",
      }).success,
    ).toBe(false);
  });

  it("validates review-only response drafts and drafting presence", () => {
    expect(
      conversationResponseDraftWriteSchema.safeParse({
        workspaceId: base.workspaceId,
        body: "Thanks for the question. I am checking the details.",
        sourceSuggestionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }).success,
    ).toBe(true);
    expect(
      conversationResponseDraftWriteSchema.safeParse({
        workspaceId: base.workspaceId,
        body: "   ",
      }).success,
    ).toBe(false);
    expect(
      conversationDraftingPresenceSchema.safeParse({
        workspaceId: base.workspaceId,
        actorKind: "assistant",
      }).success,
    ).toBe(false);
    expect(
      conversationDraftingPresenceSchema.safeParse({
        workspaceId: base.workspaceId,
      }).success,
    ).toBe(true);
  });

  it("bounds explicit retention classes and preview policy windows", () => {
    expect(
      conversationRetentionClassSchema.safeParse({
        workspaceId: base.workspaceId,
        retentionClass: "personal_message",
      }).success,
    ).toBe(true);
    expect(
      conversationRetentionClassSchema.safeParse({
        workspaceId: base.workspaceId,
        retentionClass: "personal",
      }).success,
    ).toBe(false);
    const policy = {
      workspaceId: base.workspaceId,
      enabled: true,
      standardDays: 365,
      personalMessageDays: 180,
      importedEmailDays: 365,
    };
    expect(conversationRetentionPolicySchema.safeParse(policy).success).toBe(true);
    expect(
      conversationRetentionPolicySchema.safeParse({ ...policy, standardDays: 0 })
        .success,
    ).toBe(false);
    expect(
      conversationRetentionPolicySchema.safeParse({ ...policy, purge: true })
        .success,
    ).toBe(false);
  });

  it("requires bounded justification for retention erasure and its decision", () => {
    expect(
      conversationRetentionErasureRequestSchema.parse({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        requestNote: "  Policy window elapsed.  ",
      }),
    ).toEqual({
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      requestNote: "Policy window elapsed.",
    });
    expect(
      conversationRetentionErasureDecisionSchema.parse({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        decision: "execute",
        decisionNote: "Approved under workspace policy.",
      }).decision,
    ).toBe("execute");
    expect(
      conversationRetentionErasureDecisionSchema.safeParse({
        workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        decision: "approve",
        decisionNote: "No",
      }).success,
    ).toBe(false);
  });

  it("requires reasoned legal holds and separately justified releases", () => {
    expect(
      conversationRetentionClassSchema.safeParse({
        workspaceId: base.workspaceId,
        retentionClass: "legal_hold",
      }).success,
    ).toBe(false);
    expect(
      conversationLegalHoldSchema.parse({
        workspaceId: base.workspaceId,
        reason: "  Preserve for active case review.  ",
        caseReference: "  CASE-42  ",
      }),
    ).toEqual({
      workspaceId: base.workspaceId,
      reason: "Preserve for active case review.",
      caseReference: "CASE-42",
    });
    expect(
      conversationLegalHoldReleaseRequestSchema.safeParse({
        workspaceId: base.workspaceId,
        targetRetentionClass: "legal_hold",
        requestNote: "Release after review.",
      }).success,
    ).toBe(false);
    expect(
      conversationLegalHoldReleaseDecisionSchema.safeParse({
        workspaceId: base.workspaceId,
        decision: "approve",
        decisionNote: "Independent approval recorded.",
      }).success,
    ).toBe(true);
  });
});
