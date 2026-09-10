import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { ConversationRepository } from "./conversation-repository";
import { RelationshipRepository } from "./relationship-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("conversation retention policy", () => {
  afterAll(async () => sql?.end());

  it("previews class-specific eligibility without deleting records", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const conversations = new ConversationRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `retention-${suffix}@market-me.local`,
      displayName: "Retention Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `retention-viewer-${suffix}@market-me.local`,
      displayName: "Retention Viewer",
    });
    const asOf = new Date("2026-08-06T12:00:00.000Z");

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      await expect(
        conversations.saveRetentionPolicy(
          {
            workspaceId: owner.workspace.workspaceId,
            enabled: true,
            standardDays: 30,
            personalMessageDays: 10,
            importedEmailDays: 20,
          },
          viewer.user.id,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      const policy = await conversations.saveRetentionPolicy(
        {
          workspaceId: owner.workspace.workspaceId,
          enabled: true,
          standardDays: 30,
          personalMessageDays: 10,
          importedEmailDays: 20,
        },
        owner.user.id,
      );
      expect(policy).toMatchObject({
        enabled: true,
        standardDays: 30,
        personalMessageDays: 10,
        importedEmailDays: 20,
      });

      const relationship = await relationships.saveRelationship(
        {
          workspaceId: owner.workspace.workspaceId,
          displayName: `Retention Contact ${suffix}`,
          stage: "engaged",
          contactPermission: "allowed",
          assignedOwnerId: owner.user.id,
          observedInterests: [],
          sharedTopics: [],
          notes: "",
          identities: [],
        },
        owner.user.id,
      );
      const createThread = async (subject: string, status: "new" | "resolved" | "archived") =>
        conversations.saveThread(
          {
            workspaceId: owner.workspace.workspaceId,
            relationshipId: relationship!.id,
            provider: "manual",
            subject,
            status,
          },
          owner.user.id,
        );
      const standard = await createThread("Standard retention", "resolved");
      const personal = await createThread("Personal retention", "resolved");
      const imported = await createThread("Imported retention", "archived");
      const held = await createThread("Held retention", "resolved");
      const active = await createThread("Active retention", "new");

      expect(
        await conversations.setRetentionClass(
          owner.workspace.workspaceId,
          personal!.id,
          "personal_message",
          owner.user.id,
        ),
      ).toMatchObject({ retentionClass: "personal_message" });
      await conversations.setRetentionClass(
        owner.workspace.workspaceId,
        imported!.id,
        "imported_email",
        owner.user.id,
      );
      await conversations.placeLegalHold(
        {
          workspaceId: owner.workspace.workspaceId,
          conversationThreadId: held!.id,
          reason: "Preserve under reviewed legal hold.",
          caseReference: "CASE-RETENTION-TEST",
        },
        owner.user.id,
      );
      await expect(
        conversations.placeLegalHold(
          {
            workspaceId: owner.workspace.workspaceId,
            conversationThreadId: standard!.id,
            reason: "A viewer cannot place a legal hold.",
          },
          viewer.user.id,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      await conversations.setRetentionClass(
        owner.workspace.workspaceId,
        active!.id,
        "personal_message",
        owner.user.id,
      );
      await expect(
        conversations.setRetentionClass(
          owner.workspace.workspaceId,
          standard!.id,
          "personal_message",
          viewer.user.id,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });

      await sql`
        UPDATE conversation_thread
        SET created_at = CASE id
          WHEN ${standard!.id} THEN '2026-06-01T12:00:00.000Z'::timestamptz
          ELSE '2026-07-01T12:00:00.000Z'::timestamptz
        END,
        last_message_at = NULL
        WHERE workspace_id = ${owner.workspace.workspaceId}
      `;
      const candidates = await conversations.listRetentionCandidates(
        owner.workspace.workspaceId,
        asOf,
      );
      expect(candidates).toEqual([
        expect.objectContaining({
          conversationThreadId: standard!.id,
          retentionClass: "standard",
          eligibleAfter: "2026-07-01T12:00:00.000Z",
        }),
        expect.objectContaining({
          conversationThreadId: personal!.id,
          retentionClass: "personal_message",
          eligibleAfter: "2026-07-11T12:00:00.000Z",
        }),
        expect.objectContaining({
          conversationThreadId: imported!.id,
          retentionClass: "imported_email",
          eligibleAfter: "2026-07-21T12:00:00.000Z",
        }),
      ]);
      expect(candidates).not.toContainEqual(
        expect.objectContaining({ conversationThreadId: held!.id }),
      );
      expect(candidates).not.toContainEqual(
        expect.objectContaining({ conversationThreadId: active!.id }),
      );
      expect(
        (
          await sql<{ count: number }[]>`
            SELECT count(*)::integer AS count FROM conversation_thread
            WHERE workspace_id = ${owner.workspace.workspaceId}
          `
        )[0]?.count,
      ).toBe(5);

      await conversations.saveRetentionPolicy(
        {
          workspaceId: owner.workspace.workspaceId,
          enabled: false,
          standardDays: 30,
          personalMessageDays: 10,
          importedEmailDays: 20,
        },
        owner.user.id,
      );
      expect(
        await conversations.listRetentionCandidates(
          owner.workspace.workspaceId,
          asOf,
        ),
      ).toEqual([]);
      const audits = await sql<{ eventType: string; data: Record<string, unknown> }[]>`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type IN (
            'conversation.retention_policy_saved',
            'conversation.retention_class_changed'
          )
        ORDER BY created_at, id
      `;
      expect(audits.filter((item) => item.eventType === "conversation.retention_policy_saved")).toHaveLength(2);
      expect(audits.filter((item) => item.eventType === "conversation.retention_class_changed")).toHaveLength(3);
      expect(JSON.stringify(audits)).not.toContain("Personal retention");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${viewer.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${viewer.user.id})`;
    }
  });

  it("requires a separate approver and atomically erases only an eligible conversation", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const conversations = new ConversationRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `erasure-owner-${suffix}@market-me.local`,
      displayName: "Erasure Owner",
    });
    const approver = await core.bootstrapDevelopmentWorkspace({
      email: `erasure-approver-${suffix}@market-me.local`,
      displayName: "Erasure Approver",
    });
    const asOf = new Date("2026-08-11T12:00:00.000Z");

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${approver.user.id}, 'approver')
      `;
      await conversations.saveRetentionPolicy(
        {
          workspaceId: owner.workspace.workspaceId,
          enabled: true,
          standardDays: 1,
          personalMessageDays: 1,
          importedEmailDays: 1,
        },
        owner.user.id,
      );
      const relationship = await relationships.saveRelationship(
        {
          workspaceId: owner.workspace.workspaceId,
          displayName: `Erasure Contact ${suffix}`,
          stage: "engaged",
          contactPermission: "allowed",
          assignedOwnerId: owner.user.id,
          observedInterests: [],
          sharedTopics: [],
          notes: "Relationship record must remain.",
          identities: [],
        },
        owner.user.id,
      );
      const createEligibleThread = async (subject: string) => {
        const thread = await conversations.saveThread(
          {
            workspaceId: owner.workspace.workspaceId,
            relationshipId: relationship!.id,
            provider: "manual",
            subject,
            status: "resolved",
          },
          owner.user.id,
        );
        await conversations.recordMessage({
          workspaceId: owner.workspace.workspaceId,
          conversationThreadId: thread!.id,
          providerMessageId: `retained-${thread!.id}`,
          kind: "inbound",
          body: "Private conversation content that must not enter the ledger.",
          occurredAt: "2026-08-01T12:00:00.000Z",
          metadata: {},
        });
        await conversations.markRead(
          owner.workspace.workspaceId,
          thread!.id,
          owner.user.id,
        );
        await sql!`
          UPDATE conversation_thread
          SET created_at = '2026-08-01T12:00:00.000Z',
            last_message_at = '2026-08-01T12:00:00.000Z'
          WHERE id = ${thread!.id}
        `;
        return thread!;
      };

      const rejectedThread = await createEligibleThread("Reject this erasure");
      await expect(
        conversations.requestRetentionErasure(
          {
            workspaceId: owner.workspace.workspaceId,
            conversationThreadId: rejectedThread.id,
            requestNote: "Approver cannot author a request.",
          },
          approver.user.id,
          asOf,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      const rejectedRequest = await conversations.requestRetentionErasure(
        {
          workspaceId: owner.workspace.workspaceId,
          conversationThreadId: rejectedThread.id,
          requestNote: "Retention policy window elapsed.",
        },
        owner.user.id,
        asOf,
      );
      expect(
        await conversations.requestRetentionErasure(
          {
            workspaceId: owner.workspace.workspaceId,
            conversationThreadId: rejectedThread.id,
            requestNote: "Retry returns the existing request.",
          },
          owner.user.id,
          asOf,
        ),
      ).toMatchObject({ id: rejectedRequest!.id });
      await expect(
        conversations.decideRetentionErasure(
          {
            workspaceId: owner.workspace.workspaceId,
            requestId: rejectedRequest!.id,
            decision: "execute",
            decisionNote: "Self approval is forbidden.",
          },
          owner.user.id,
          asOf,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "requestId" })],
      });
      expect(
        await conversations.decideRetentionErasure(
          {
            workspaceId: owner.workspace.workspaceId,
            requestId: rejectedRequest!.id,
            decision: "reject",
            decisionNote: "Preserve this conversation after review.",
          },
          approver.user.id,
          asOf,
        ),
      ).toMatchObject({ status: "rejected" });
      expect(
        await conversations.getThread(
          owner.workspace.workspaceId,
          rejectedThread.id,
        ),
      ).toBeDefined();

      const executedThread = await createEligibleThread("Execute this erasure");
      const executedRequest = await conversations.requestRetentionErasure(
        {
          workspaceId: owner.workspace.workspaceId,
          conversationThreadId: executedThread.id,
          requestNote: "Retention window elapsed and content is no longer needed.",
        },
        owner.user.id,
        asOf,
      );
      const hold = await conversations.placeLegalHold(
        {
          workspaceId: owner.workspace.workspaceId,
          conversationThreadId: executedThread.id,
          reason: "Pause erasure for case review.",
          caseReference: "CASE-ERASURE-TEST",
        },
        approver.user.id,
      );
      expect(hold).toMatchObject({
        status: "active",
        previousRetentionClass: "standard",
        reason: "Pause erasure for case review.",
        caseReference: "CASE-ERASURE-TEST",
        placedBy: approver.user.id,
      });
      expect(
        await conversations.listActiveLegalHolds(owner.workspace.workspaceId),
      ).toEqual([
        expect.objectContaining({
          id: hold!.id,
          subject: "Execute this erasure",
          relationshipDisplayName: `Erasure Contact ${suffix}`,
        }),
      ]);
      expect(
        await conversations.placeLegalHold(
          {
            workspaceId: owner.workspace.workspaceId,
            conversationThreadId: executedThread.id,
            reason: "A retried placement returns the active hold.",
          },
          approver.user.id,
        ),
      ).toMatchObject({ id: hold!.id });
      await expect(
        conversations.decideRetentionErasure(
          {
            workspaceId: owner.workspace.workspaceId,
            requestId: executedRequest!.id,
            decision: "execute",
            decisionNote: "Attempt while held.",
          },
          approver.user.id,
          asOf,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      const releaseRequest = await conversations.requestLegalHoldRelease(
        {
          workspaceId: owner.workspace.workspaceId,
          legalHoldCaseId: hold!.id,
          targetRetentionClass: "standard",
          requestNote: "Case review completed; request hold release.",
        },
        owner.user.id,
      );
      expect(
        await conversations.listPendingLegalHoldReleaseRequests(
          owner.workspace.workspaceId,
        ),
      ).toEqual([
        expect.objectContaining({
          id: releaseRequest!.id,
          subject: "Execute this erasure",
          relationshipDisplayName: `Erasure Contact ${suffix}`,
        }),
      ]);
      await expect(
        conversations.decideLegalHoldRelease(
          {
            workspaceId: owner.workspace.workspaceId,
            requestId: releaseRequest!.id,
            decision: "approve",
            decisionNote: "Self approval must be forbidden.",
          },
          owner.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "requestId" })],
      });
      expect(
        await conversations.decideLegalHoldRelease(
          {
            workspaceId: owner.workspace.workspaceId,
            requestId: releaseRequest!.id,
            decision: "reject",
            decisionNote: "More case review is required.",
          },
          approver.user.id,
        ),
      ).toMatchObject({ status: "rejected" });
      expect(
        await conversations.listPendingLegalHoldReleaseRequests(
          owner.workspace.workspaceId,
        ),
      ).toEqual([]);
      expect(
        await conversations.listRecentLegalHoldReleaseDecisions(
          owner.workspace.workspaceId,
        ),
      ).toEqual([
        expect.objectContaining({
          id: releaseRequest!.id,
          status: "rejected",
          decisionNote: "More case review is required.",
          decidedBy: approver.user.id,
          subject: "Execute this erasure",
          relationshipDisplayName: `Erasure Contact ${suffix}`,
        }),
      ]);
      expect(
        await conversations.getThread(
          owner.workspace.workspaceId,
          executedThread.id,
        ),
      ).toMatchObject({ retentionClass: "legal_hold" });
      const approvedReleaseRequest = await conversations.requestLegalHoldRelease(
        {
          workspaceId: owner.workspace.workspaceId,
          legalHoldCaseId: hold!.id,
          targetRetentionClass: "standard",
          requestNote: "Case review is complete; request hold release again.",
        },
        owner.user.id,
      );
      expect(
        await conversations.decideLegalHoldRelease(
          {
            workspaceId: owner.workspace.workspaceId,
            requestId: approvedReleaseRequest!.id,
            decision: "approve",
            decisionNote: "Independent release review completed.",
          },
          approver.user.id,
        ),
      ).toMatchObject({ status: "approved" });
      expect(
        await conversations.listActiveLegalHolds(owner.workspace.workspaceId),
      ).toEqual([]);
      const recentHoldDecisions =
        await conversations.listRecentLegalHoldReleaseDecisions(
          owner.workspace.workspaceId,
        );
      expect(recentHoldDecisions).toHaveLength(2);
      expect(recentHoldDecisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: releaseRequest!.id,
            status: "rejected",
          }),
          expect.objectContaining({
            id: approvedReleaseRequest!.id,
            status: "approved",
            decisionNote: "Independent release review completed.",
            decidedBy: approver.user.id,
            subject: "Execute this erasure",
            relationshipDisplayName: `Erasure Contact ${suffix}`,
          }),
        ]),
      );
      await expect(
        conversations.decideRetentionErasure(
          {
            workspaceId: owner.workspace.workspaceId,
            requestId: executedRequest!.id,
            decision: "execute",
            decisionNote: "Old request must remain stale after hold release.",
          },
          approver.user.id,
          asOf,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      await conversations.decideRetentionErasure(
        {
          workspaceId: owner.workspace.workspaceId,
          requestId: executedRequest!.id,
          decision: "reject",
          decisionNote: "Reject stale request after hold lifecycle.",
        },
        approver.user.id,
        asOf,
      );
      const freshRequest = await conversations.requestRetentionErasure(
        {
          workspaceId: owner.workspace.workspaceId,
          conversationThreadId: executedThread.id,
          requestNote: "Fresh request after independently approved hold release.",
        },
        owner.user.id,
        asOf,
      );
      const executed = await conversations.decideRetentionErasure(
        {
          workspaceId: owner.workspace.workspaceId,
          requestId: freshRequest!.id,
          decision: "execute",
          decisionNote: "Approved under the configured retention policy.",
        },
        approver.user.id,
        asOf,
      );
      expect(executed).toMatchObject({
        status: "executed",
        subject: undefined,
        relationshipDisplayName: undefined,
        deletedCounts: expect.objectContaining({
          threads: 1,
          messages: 1,
          readStates: 1,
        }),
      });
      expect(
        await conversations.getThread(
          owner.workspace.workspaceId,
          executedThread.id,
        ),
      ).toBeUndefined();
      expect(
        await relationships.getRelationship(
          owner.workspace.workspaceId,
          relationship!.id,
        ),
      ).toBeDefined();
      const ledger = await conversations.listRetentionErasureRequests(
        owner.workspace.workspaceId,
      );
      expect(JSON.stringify(ledger)).not.toContain("Private conversation content");
      const audits = await sql<{ eventType: string; data: Record<string, unknown> }[]>`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type LIKE 'conversation.retention_erasure_%'
        ORDER BY created_at, id
      `;
      expect(audits.map((audit) => audit.eventType)).toEqual([
        "conversation.retention_erasure_requested",
        "conversation.retention_erasure_rejected",
        "conversation.retention_erasure_requested",
        "conversation.retention_erasure_rejected",
        "conversation.retention_erasure_requested",
        "conversation.retention_erasure_executed",
      ]);
      expect(JSON.stringify(audits)).not.toContain("Private conversation content");
      const holdAudits = await sql<{ eventType: string; data: Record<string, unknown> }[]>`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type LIKE 'conversation.legal_hold_%'
        ORDER BY created_at, id
      `;
      expect(holdAudits.map((audit) => audit.eventType)).toEqual([
        "conversation.legal_hold_placed",
        "conversation.legal_hold_release_requested",
        "conversation.legal_hold_release_rejected",
        "conversation.legal_hold_release_requested",
        "conversation.legal_hold_released",
      ]);
      expect(JSON.stringify(holdAudits)).not.toContain("Pause erasure");
      expect(JSON.stringify(holdAudits)).not.toContain("CASE-ERASURE-TEST");
      expect(JSON.stringify(holdAudits)).not.toContain("Case review is complete");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${approver.workspace.organizationId})
      `;
      await sql`
        DELETE FROM app_user WHERE id IN (${owner.user.id}, ${approver.user.id})
      `;
    }
  });
});
