import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ConversationAssistantRepository } from "./conversation-assistant-repository";
import { ConversationRepository } from "./conversation-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { RelationshipRepository } from "./relationship-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("conversation assistant repository", () => {
  afterAll(async () => sql?.end());

  it("stores cited immutable suggestions without dispatching a response", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const conversations = new ConversationRepository(sql);
    const assistant = new ConversationAssistantRepository(sql);
    const suffix = randomUUID();
    const boot = await core.bootstrapDevelopmentWorkspace({
      email: `assistant-${suffix}@market-me.local`,
      displayName: "Assistant Test",
    });
    try {
      const relationship = await relationships.saveRelationship(
        {
          workspaceId: boot.workspace.workspaceId,
          displayName: `Assistant Contact ${suffix}`,
          stage: "engaged",
          contactPermission: "allowed",
          assignedOwnerId: boot.user.id,
          observedInterests: [],
          sharedTopics: [],
          preferredTone: "clear",
          notes: "",
          identities: [],
        },
        boot.user.id,
      );
      const destinationId = randomUUID();
      const canonicalUrl = `https://example.test/assistant/${suffix}`;
      await sql`
        INSERT INTO destination (
          id, workspace_id, provider, canonical_url, title, description,
          topics, status, created_by
        ) VALUES (
          ${destinationId}, ${boot.workspace.workspaceId}, 'web',
          ${canonicalUrl}, 'Approved answer page', '', ${[]}, 'published',
          ${boot.user.id}
        )
      `;
      const thread = await conversations.saveThread(
        {
          workspaceId: boot.workspace.workspaceId,
          relationshipId: relationship!.id,
          destinationId,
          provider: "manual",
          subject: "Answer request",
          status: "new",
          sentiment: "neutral",
          intent: "question",
          urgency: "normal",
        },
        boot.user.id,
      );
      const inboundBody = `Where is the approved answer for ${suffix}?`;
      const inbound = await conversations.recordMessage({
        workspaceId: boot.workspace.workspaceId,
        conversationThreadId: thread!.id,
        providerMessageId: `assistant-inbound-${suffix}`,
        kind: "inbound",
        body: inboundBody,
        authorDisplay: "Contact",
        occurredAt: "2026-08-06T12:00:00.000Z",
        metadata: { privateProviderValue: "not-copied" },
      });

      const first = await assistant.generateSuggestion(
        boot.workspace.workspaceId,
        thread!.id,
        boot.user.id,
      );
      expect(first).toMatchObject({
        status: "active",
        recommendation: "respond",
        identifiedQuestions: [inboundBody],
        proposedDestinationId: destinationId,
        generatorModel: "grounded-conversation-template",
      });
      expect(first.responseText).toContain(canonicalUrl);
      expect(first.contextSnapshot.messages).toEqual([
        expect.objectContaining({ id: inbound!.id, body: inboundBody }),
      ]);
      expect(first.claims).toEqual([
        expect.objectContaining({ citationIndexes: [2] }),
      ]);
      expect(first.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);

      const second = await assistant.generateSuggestion(
        boot.workspace.workspaceId,
        thread!.id,
        boot.user.id,
      );
      const afterRegeneration = await assistant.listSuggestions(
        boot.workspace.workspaceId,
        thread!.id,
      );
      expect(afterRegeneration.filter((item) => item.status === "active")).toEqual([
        expect.objectContaining({ id: second.id }),
      ]);
      expect(afterRegeneration).toContainEqual(
        expect.objectContaining({ id: first.id, status: "superseded" }),
      );
      expect(
        await assistant.dismissSuggestion(
          second.id,
          {
            workspaceId: boot.workspace.workspaceId,
            conversationThreadId: thread!.id,
            status: "dismissed",
          },
          boot.user.id,
        ),
      ).toEqual(expect.objectContaining({ status: "dismissed" }));

      await sql`
        UPDATE relationship_contact
        SET contact_permission = 'suppressed',
          suppression_reason = 'Explicit test opt-out',
          suppressed_at = now(), suppressed_by = ${boot.user.id}
        WHERE id = ${relationship!.id}
      `;
      const suppressed = await assistant.generateSuggestion(
        boot.workspace.workspaceId,
        thread!.id,
        boot.user.id,
      );
      expect(suppressed).toMatchObject({
        recommendation: "no_response",
      });
      expect(suppressed.responseText).toBeUndefined();
      expect(suppressed.proposedDestinationId).toBeUndefined();

      const messages = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM conversation_message
        WHERE workspace_id = ${boot.workspace.workspaceId}
          AND conversation_thread_id = ${thread!.id}
      `;
      expect(messages[0]?.count).toBe(1);
      const audits = await sql<{ eventType: string; data: Record<string, unknown> }[]>`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${boot.workspace.workspaceId}
          AND event_type LIKE 'conversation.response_suggestion_%'
        ORDER BY created_at, id
      `;
      expect(audits.map((item) => item.eventType)).toEqual([
        "conversation.response_suggestion_generated",
        "conversation.response_suggestion_generated",
        "conversation.response_suggestion_dismissed",
        "conversation.response_suggestion_generated",
      ]);
      expect(JSON.stringify(audits)).not.toContain(inboundBody);
      expect(JSON.stringify(audits)).not.toContain(canonicalUrl);
      expect(JSON.stringify(audits)).not.toContain(relationship!.displayName);
      expect(JSON.stringify(audits)).not.toContain("not-copied");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id = (
          SELECT organization_id FROM workspace
          WHERE id = ${boot.workspace.workspaceId}
        )
      `;
    }
  });
});
