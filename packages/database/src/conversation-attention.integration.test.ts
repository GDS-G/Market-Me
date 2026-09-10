import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { ConversationRepository } from "./conversation-repository";
import { RelationshipRepository } from "./relationship-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("conversation attention queue", () => {
  afterAll(async () => sql?.end());

  it("aggregates deterministic due reasons without mutating conversations", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const conversations = new ConversationRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `attention-${suffix}@market-me.local`,
      displayName: "Attention Owner",
    });
    const reviewer = await core.bootstrapDevelopmentWorkspace({
      email: `attention-reviewer-${suffix}@market-me.local`,
      displayName: "Attention Reviewer",
    });
    const asOf = new Date("2026-08-06T15:00:00.000Z");

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${reviewer.user.id}, 'editor')
      `;
      await conversations.saveServiceLevelPolicy(
        {
          workspaceId: owner.workspace.workspaceId,
          timezone: "UTC",
          businessDaysMask: 127,
          businessStartTime: "00:00",
          businessEndTime: "23:59",
          unknownTargetMinutes: 60,
          lowTargetMinutes: 60,
          normalTargetMinutes: 60,
          highTargetMinutes: 30,
          criticalTargetMinutes: 15,
          atRiskBeforeMinutes: 10,
          escalationAfterMinutes: 30,
        },
        owner.user.id,
      );
      const relationship = await relationships.saveRelationship(
        {
          workspaceId: owner.workspace.workspaceId,
          displayName: `Attention Contact ${suffix}`,
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
      const urgent = await conversations.saveThread(
        {
          workspaceId: owner.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          subject: "Escalated attention",
          status: "assigned",
          assignedOwnerId: owner.user.id,
          responseDueAt: "2026-08-06T14:20:00.000Z",
          followUpAt: "2026-08-06T14:50:00.000Z",
        },
        owner.user.id,
      );
      const atRisk = await conversations.saveThread(
        {
          workspaceId: owner.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          subject: "At-risk attention",
          status: "new",
          responseDueAt: "2026-08-06T15:05:00.000Z",
        },
        owner.user.id,
      );
      await conversations.saveThread(
        {
          workspaceId: owner.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          subject: "Closed attention",
          status: "resolved",
          responseDueAt: "2026-08-06T12:00:00.000Z",
          followUpAt: "2026-08-06T12:00:00.000Z",
        },
        owner.user.id,
      );
      await sql`
        INSERT INTO conversation_review_request (
          id, workspace_id, conversation_thread_id, status, request_text,
          due_at, requested_by, requested_reviewer_id
        ) VALUES (
          ${randomUUID()}, ${owner.workspace.workspaceId}, ${urgent!.id},
          'open', 'Review the internal response', '2026-08-06T14:45:00.000Z',
          ${owner.user.id}, ${reviewer.user.id}
        )
      `;
      await sql`
        INSERT INTO conversation_handoff_brief (
          id, workspace_id, conversation_thread_id, status,
          contact_summary, importance, request_or_offer,
          due_at, requested_by
        ) VALUES (
          ${randomUUID()}, ${owner.workspace.workspaceId}, ${urgent!.id}, 'open',
          'Attention contact', 'Deadline-sensitive request', 'Confirm next step',
          '2026-08-06T14:40:00.000Z', ${owner.user.id}
        )
      `;

      const items = await conversations.listAttentionItems(
        owner.workspace.workspaceId,
        asOf,
      );
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        conversationThreadId: urgent!.id,
        assignedOwnerDisplayName: "Attention Owner",
        reasons: [
          "response_escalation_due",
          "follow_up_due",
          "review_request_due",
          "handoff_due",
        ],
        primaryDueAt: "2026-08-06T14:20:00.000Z",
      });
      expect(items[1]).toMatchObject({
        conversationThreadId: atRisk!.id,
        reasons: ["response_at_risk"],
        primaryDueAt: "2026-08-06T15:05:00.000Z",
      });
      const statuses = await sql<{ subject: string; status: string }[]>`
        SELECT subject, status FROM conversation_thread
        WHERE workspace_id = ${owner.workspace.workspaceId}
        ORDER BY subject
      `;
      expect(statuses).toEqual([
        { subject: "At-risk attention", status: "new" },
        { subject: "Closed attention", status: "resolved" },
        { subject: "Escalated attention", status: "assigned" },
      ]);
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${reviewer.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${reviewer.user.id})`;
    }
  });
});
