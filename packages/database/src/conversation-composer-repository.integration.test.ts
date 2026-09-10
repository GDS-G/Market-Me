import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ConversationAssistantRepository } from "./conversation-assistant-repository";
import {
  ConversationComposerRepository,
  ConversationComposerValidationError,
} from "./conversation-composer-repository";
import { ConversationRepository } from "./conversation-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { RelationshipRepository } from "./relationship-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("conversation composer repository", () => {
  afterAll(async () => sql?.end());

  it("shares review drafts and leases presence without dispatching messages", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const conversations = new ConversationRepository(sql);
    const assistant = new ConversationAssistantRepository(sql);
    const composer = new ConversationComposerRepository(sql);
    const suffix = randomUUID();
    const first = await core.bootstrapDevelopmentWorkspace({
      email: `composer-${suffix}@market-me.local`,
      displayName: "Composer Owner",
    });
    const second = await core.bootstrapDevelopmentWorkspace({
      email: `composer-editor-${suffix}@market-me.local`,
      displayName: "Composer Editor",
    });

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${first.workspace.workspaceId}, ${second.user.id}, 'editor')
      `;
      const relationship = await relationships.saveRelationship(
        {
          workspaceId: first.workspace.workspaceId,
          displayName: `Composer Contact ${suffix}`,
          stage: "engaged",
          contactPermission: "allowed",
          assignedOwnerId: first.user.id,
          observedInterests: [],
          sharedTopics: [],
          preferredTone: "clear",
          notes: "",
          identities: [],
        },
        first.user.id,
      );
      const thread = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          subject: "Shared response",
          status: "new",
        },
        first.user.id,
      );
      const otherThread = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          subject: "Different response",
          status: "new",
        },
        first.user.id,
      );
      await conversations.recordMessage({
        workspaceId: first.workspace.workspaceId,
        conversationThreadId: thread!.id,
        providerMessageId: `composer-inbound-${suffix}`,
        kind: "inbound",
        body: "Could you confirm the next step?",
        authorDisplay: "Contact",
        occurredAt: "2026-08-06T12:00:00.000Z",
        metadata: {},
      });

      const suggestion = await assistant.generateSuggestion(
        first.workspace.workspaceId,
        thread!.id,
        first.user.id,
      );
      expect(
        (await composer.getState(first.workspace.workspaceId, thread!.id))
          .presences,
      ).not.toContainEqual(expect.objectContaining({ actorKind: "assistant" }));

      const body = "Thanks for checking. We will confirm the next step shortly.";
      const saved = await composer.saveDraft(
        {
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          body,
          sourceSuggestionId: suggestion.id,
        },
        first.user.id,
      );
      expect(saved).toMatchObject({
        body,
        sourceSuggestionId: suggestion.id,
        updatedByDisplayName: "Composer Owner",
      });

      await composer.heartbeatPresence(
        first.workspace.workspaceId,
        thread!.id,
        "human",
        second.user.id,
      );
      const shared = await composer.getState(
        first.workspace.workspaceId,
        thread!.id,
      );
      expect(shared.draft).toMatchObject({ id: saved.id, body });
      expect(shared.presences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actorUserId: first.user.id }),
          expect.objectContaining({ actorUserId: second.user.id }),
        ]),
      );

      const revised = await composer.saveDraft(
        {
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          body: `${body} Reviewed by the editor.`,
          sourceSuggestionId: suggestion.id,
        },
        second.user.id,
      );
      expect(revised).toMatchObject({
        id: saved.id,
        updatedBy: second.user.id,
        updatedByDisplayName: "Composer Editor",
      });
      await expect(
        composer.saveDraft(
          {
            workspaceId: first.workspace.workspaceId,
            conversationThreadId: otherThread!.id,
            body: "Invalid provenance",
            sourceSuggestionId: suggestion.id,
          },
          first.user.id,
        ),
      ).rejects.toBeInstanceOf(ConversationComposerValidationError);

      await composer.clearPresence(
        first.workspace.workspaceId,
        thread!.id,
        "human",
        first.user.id,
      );
      await composer.clearPresence(
        first.workspace.workspaceId,
        thread!.id,
        "human",
        second.user.id,
      );
      expect(
        await composer.discardDraft(
          first.workspace.workspaceId,
          thread!.id,
          first.user.id,
        ),
      ).toBe(true);
      expect(
        await composer.getState(first.workspace.workspaceId, thread!.id),
      ).toEqual({ draft: undefined, presences: [] });

      const messages = await sql<{ inbound: number; outbound: number }[]>`
        SELECT
          count(*) FILTER (WHERE kind = 'inbound')::int AS inbound,
          count(*) FILTER (WHERE kind = 'outbound_observed')::int AS outbound
        FROM conversation_message
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND conversation_thread_id = ${thread!.id}
      `;
      expect(messages[0]).toEqual({ inbound: 1, outbound: 0 });
      const audits = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM audit_event
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND event_type LIKE 'conversation.response_draft_%'
      `;
      expect(audits).toHaveLength(3);
      expect(JSON.stringify(audits)).not.toContain(body);
      expect(JSON.stringify(audits)).not.toContain(suggestion.responseText ?? "never");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${first.workspace.organizationId}, ${second.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${first.user.id}, ${second.user.id})`;
    }
  });
});
