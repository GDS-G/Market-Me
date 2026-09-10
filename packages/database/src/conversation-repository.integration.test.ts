import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { ConversationRepository } from "./conversation-repository";
import { RelationshipRepository } from "./relationship-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("conversation repository", () => {
  afterAll(async () => sql?.end());

  it("persists idempotent history and keeps internal notes non-deliverable", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const conversations = new ConversationRepository(sql);
    const suffix = randomUUID();
    const first = await core.bootstrapDevelopmentWorkspace({
      email: `conversation-${suffix}@market-me.local`,
      displayName: "Conversation Test",
    });
    const second = await core.bootstrapDevelopmentWorkspace({
      email: `conversation-other-${suffix}@market-me.local`,
      displayName: "Other Conversation Test",
    });
    const third = await core.bootstrapDevelopmentWorkspace({
      email: `conversation-mentioned-${suffix}@market-me.local`,
      displayName: "Mentioned Conversation Test",
    });
    const campaignId = randomUUID();
    const destinationId = randomUUID();
    const foreignCampaignId = randomUUID();
    const foreignDestinationId = randomUUID();
    const channelConnectionId = randomUUID();
    const foreignChannelConnectionId = randomUUID();
    const campaignVersionId = randomUUID();
    const campaignStepId = randomUUID();
    const campaignInstanceId = randomUUID();
    const campaignStepRunId = randomUUID();
    const publicationActionId = randomUUID();
    const brandProfileId = randomUUID();
    const foreignBrandProfileId = randomUUID();
    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${first.workspace.workspaceId}, ${second.user.id}, 'viewer')
        ON CONFLICT (workspace_id, user_id) DO NOTHING
      `;
      await sql`
        INSERT INTO campaign (id, workspace_id, name, description, created_by)
        VALUES
          (${campaignId}, ${first.workspace.workspaceId}, 'Partner launch', 'Launch context', ${first.user.id}),
          (${foreignCampaignId}, ${second.workspace.workspaceId}, 'Foreign campaign', '', ${second.user.id})
      `;
      await sql`
        INSERT INTO brand_profile (
          id, workspace_id, name, description, status, created_by
        ) VALUES
          (${brandProfileId}, ${first.workspace.workspaceId}, 'Partner brand', 'brand-context-037', 'published', ${first.user.id}),
          (${foreignBrandProfileId}, ${second.workspace.workspaceId}, 'Foreign brand', '', 'published', ${second.user.id})
      `;
      await sql`
        INSERT INTO channel_connection (
          id, workspace_id, provider, name, encrypted_credentials,
          capabilities, created_by
        ) VALUES
          (${channelConnectionId}, ${first.workspace.workspaceId}, 'discord_webhook', 'Partner Discord', 'encrypted-test', ${sql.json({ publish: true })}, ${first.user.id}),
          (${foreignChannelConnectionId}, ${second.workspace.workspaceId}, 'discord_webhook', 'Foreign Discord', 'encrypted-test', ${sql.json({ publish: true })}, ${second.user.id})
      `;
      await sql`
        INSERT INTO campaign_version (
          id, campaign_id, version_number, status, objective,
          information_depth, promotional_strength, autonomy_mode, created_by
        ) VALUES (
          ${campaignVersionId}, ${campaignId}, 1, 'draft', 'awareness',
          'contextual', 'informational', 'draft_only', ${first.user.id}
        )
      `;
      await sql`
        INSERT INTO campaign_step (
          id, campaign_version_id, step_key, name, operation_type,
          desired_capability, execution_methods, approval_required
        ) VALUES (
          ${campaignStepId}, ${campaignVersionId}, 'publish', 'Publish',
          'publish_content', 'publish_content', ${["manual_handoff"]}, false
        )
      `;
      await sql`
        INSERT INTO campaign_instance (
          id, workspace_id, campaign_id, campaign_version_id,
          status, requested_by
        ) VALUES (
          ${campaignInstanceId}, ${first.workspace.workspaceId}, ${campaignId},
          ${campaignVersionId}, 'completed', ${first.user.id}
        )
      `;
      await sql`
        INSERT INTO campaign_step_run (
          id, campaign_instance_id, campaign_step_id, status, idempotency_key
        ) VALUES (
          ${campaignStepRunId}, ${campaignInstanceId}, ${campaignStepId},
          'succeeded', ${`conversation-step-${suffix}`}
        )
      `;
      await sql`
        INSERT INTO publication_action (
          id, workspace_id, campaign_instance_id, campaign_step_run_id,
          channel_connection_id, action_type, status, idempotency_key,
          request_snapshot, provider_external_id
        ) VALUES (
          ${publicationActionId}, ${first.workspace.workspaceId},
          ${campaignInstanceId}, ${campaignStepRunId}, ${channelConnectionId},
          'publish_content', 'succeeded', ${`conversation-publication-${suffix}`},
          ${sql.json({ private: "not-for-directory" })}, 'post-035'
        )
      `;
      await sql`
        INSERT INTO destination (
          id, workspace_id, provider, canonical_url, title, description,
          topics, status, created_by
        ) VALUES
          (${destinationId}, ${first.workspace.workspaceId}, 'web', ${`https://market-me.local/${suffix}`}, 'Partner landing page', 'Reviewed offer', ${["partner launch"]}, 'published', ${first.user.id}),
          (${foreignDestinationId}, ${second.workspace.workspaceId}, 'web', ${`https://market-me.local/foreign-${suffix}`}, 'Foreign landing page', '', ${[]}, 'published', ${second.user.id})
      `;
      const contextDirectory = await conversations.listContextDirectory(
        first.workspace.workspaceId,
      );
      expect(contextDirectory.channels).toContainEqual({
        id: channelConnectionId,
        name: "Partner Discord",
        provider: "discord_webhook",
        status: "active",
      });
      expect(contextDirectory.brands).toContainEqual({
        id: brandProfileId,
        name: "Partner brand",
        status: "published",
      });
      expect(contextDirectory.publications).toContainEqual(
        expect.objectContaining({
          id: publicationActionId,
          channelConnectionId,
          channelConnectionName: "Partner Discord",
          providerExternalId: "post-035",
          status: "succeeded",
          startedAt: expect.any(String),
        }),
      );
      expect(JSON.stringify(contextDirectory)).not.toContain("encrypted-test");
      expect(JSON.stringify(contextDirectory)).not.toContain(
        "not-for-directory",
      );
      expect(
        await core.listWorkspaceMembers(first.workspace.workspaceId),
      ).toEqual([
        {
          userId: first.user.id,
          displayName: "Conversation Test",
          role: "owner",
          assignableToConversations: true,
        },
        {
          userId: second.user.id,
          displayName: "Other Conversation Test",
          role: "viewer",
          assignableToConversations: false,
        },
      ]);
      const relationship = await relationships.saveRelationship(
        {
          workspaceId: first.workspace.workspaceId,
          displayName: "Jordan Example",
          stage: "active_conversation",
          contactPermission: "suppressed",
          suppressionReason: "No outbound contact",
          observedInterests: [],
          sharedTopics: ["partnership"],
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
          providerThreadId: `thread-${suffix}`,
          subject: "Partnership follow-up",
          status: "new",
          responseDueAt: new Date(Date.now() + 60_000).toISOString(),
          followUpAt: new Date(Date.now() + 120_000).toISOString(),
        },
        first.user.id,
      );
      expect(thread).toEqual(
        expect.objectContaining({
          relationshipDisplayName: "Jordan Example",
          relationshipStage: "active_conversation",
          contactPermission: "suppressed",
          priorThreadCount: 0,
          priorMessageCount: 0,
          lastPriorInteractionAt: undefined,
          messageCount: 0,
          messages: [],
          handoffs: [],
          responseDueAt: expect.any(String),
          followUpAt: expect.any(String),
        }),
      );
      const priorThread = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          providerThreadId: `prior-thread-${suffix}`,
          subject: "Earlier partnership conversation",
          status: "resolved",
        },
        first.user.id,
      );
      const priorMessage = await conversations.recordMessage({
        workspaceId: first.workspace.workspaceId,
        conversationThreadId: priorThread!.id,
        providerMessageId: `prior-message-${suffix}`,
        kind: "inbound",
        body: "Earlier conversation detail.",
        authorDisplay: "Jordan",
        occurredAt: new Date(Date.now() - 172_800_000).toISOString(),
        metadata: {},
      });
      await sql`
        UPDATE conversation_thread
        SET created_at = ${new Date(Date.now() - 172_800_000).toISOString()}
        WHERE id = ${priorThread!.id}
      `;
      await sql`
        UPDATE conversation_message
        SET created_at = ${new Date(Date.now() - 86_400_000).toISOString()}
        WHERE id = ${priorMessage!.id}
      `;
      expect(
        await conversations.getThread(first.workspace.workspaceId, thread!.id),
      ).toEqual(
        expect.objectContaining({
          relationshipStage: "active_conversation",
          priorThreadCount: 1,
          priorMessageCount: 1,
          lastPriorInteractionAt: expect.any(String),
        }),
      );
      await sql`DELETE FROM conversation_thread WHERE id = ${priorThread!.id}`;
      await expect(
        conversations.saveThread(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: relationship!.id,
            provider: "manual",
            providerThreadId: `thread-${suffix}`,
            subject: "Duplicate provider thread",
            status: "new",
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "providerThreadId" })],
      });

      const inboundAt = new Date(Date.now() - 1_000).toISOString();
      const inbound = await conversations.recordMessage({
        workspaceId: first.workspace.workspaceId,
        conversationThreadId: thread!.id,
        providerMessageId: `message-${suffix}`,
        kind: "inbound",
        body: "Can you send the reviewed details?",
        authorDisplay: "Jordan",
        occurredAt: inboundAt,
        metadata: { imported: true },
      });
      expect(inbound?.kind).toBe("inbound");
      expect(
        await conversations.recordMessage({
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          providerMessageId: `message-${suffix}`,
          kind: "inbound",
          body: "Replay",
          occurredAt: inboundAt,
          metadata: {},
        }),
      ).toBeUndefined();
      await expect(
        conversations.recordMessage({
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          kind: "internal_note",
          body: "No actor",
          occurredAt: new Date().toISOString(),
          metadata: {},
        }),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });

      const note = await conversations.addInternalNote(
        first.workspace.workspaceId,
        thread!.id,
        "Review suppression before any reply.",
        first.user.id,
      );
      expect(note).toEqual(
        expect.objectContaining({
          kind: "internal_note",
          createdBy: first.user.id,
        }),
      );
      const firstViewer = await conversations.getThread(
        first.workspace.workspaceId,
        thread!.id,
        first.user.id,
      );
      const secondViewer = await conversations.getThread(
        first.workspace.workspaceId,
        thread!.id,
        second.user.id,
      );
      expect(firstViewer).toEqual(
        expect.objectContaining({ unreadCount: 1, lastReadAt: undefined }),
      );
      expect(secondViewer).toEqual(
        expect.objectContaining({ unreadCount: 2, lastReadAt: undefined }),
      );
      expect(
        await conversations.listThreads(
          first.workspace.workspaceId,
          { unread: true },
          first.user.id,
        ),
      ).toHaveLength(1);
      expect(
        await conversations.listThreads(
          first.workspace.workspaceId,
          { unread: false },
          first.user.id,
        ),
      ).toHaveLength(0);
      await expect(
        conversations.listThreads(first.workspace.workspaceId, {
          unread: true,
        }),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      const firstReadAt = await conversations.markRead(
        first.workspace.workspaceId,
        thread!.id,
        first.user.id,
      );
      expect(firstReadAt).toEqual(expect.any(String));
      expect(
        await conversations.getThread(
          first.workspace.workspaceId,
          thread!.id,
          first.user.id,
        ),
      ).toEqual(
        expect.objectContaining({ unreadCount: 0, lastReadAt: firstReadAt }),
      );
      expect(
        (
          await conversations.getThread(
            first.workspace.workspaceId,
            thread!.id,
            second.user.id,
          )
        )?.unreadCount,
      ).toBe(2);
      await conversations.recordMessage({
        workspaceId: first.workspace.workspaceId,
        conversationThreadId: thread!.id,
        providerMessageId: `message-after-read-${suffix}`,
        kind: "inbound",
        body: "One more detail arrived after the read receipt.",
        authorDisplay: "Jordan",
        occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
        metadata: { imported: true },
      });
      expect(
        (
          await conversations.getThread(
            first.workspace.workspaceId,
            thread!.id,
            first.user.id,
          )
        )?.unreadCount,
      ).toBe(1);
      expect(
        (
          await conversations.getThread(
            first.workspace.workspaceId,
            thread!.id,
            second.user.id,
          )
        )?.unreadCount,
      ).toBe(3);
      expect(
        await conversations.markRead(
          second.workspace.workspaceId,
          thread!.id,
          second.user.id,
        ),
      ).toBeUndefined();
      const detailed = await conversations.getThread(
        first.workspace.workspaceId,
        thread!.id,
      );
      expect(detailed?.messageCount).toBe(3);
      expect(detailed?.messages.map((message) => message.kind)).toEqual([
        "inbound",
        "inbound",
        "internal_note",
      ]);
      expect(
        (await conversations.listThreads(first.workspace.workspaceId))[0],
      ).toEqual(
        expect.objectContaining({
          messageCount: 3,
          latestMessage: expect.objectContaining({ kind: "internal_note" }),
          messages: [],
        }),
      );
      expect(
        await conversations.getThread(second.workspace.workspaceId, thread!.id),
      ).toBeUndefined();

      await expect(
        conversations.saveThread(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: relationship!.id,
            provider: "manual",
            providerThreadId: `thread-${suffix}`,
            subject: "Partnership follow-up",
            status: "assigned",
            assignedOwnerId: second.user.id,
          },
          first.user.id,
          thread!.id,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      await sql`
        UPDATE workspace_membership SET role = 'editor'
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND user_id = ${second.user.id}
      `;
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${first.workspace.workspaceId}, ${third.user.id}, 'viewer')
        ON CONFLICT (workspace_id, user_id) DO NOTHING
      `;
      await expect(
        conversations.createReviewRequest(
          {
            workspaceId: first.workspace.workspaceId,
            conversationThreadId: thread!.id,
            sourceMessageId: inbound!.id,
            requestText: "This must not cite an inbound message.",
            requestedReviewerId: second.user.id,
            mentionedUserIds: [],
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "sourceMessageId" })],
      });
      const reviewRequest = await conversations.createReviewRequest(
        {
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          sourceMessageId: note!.id,
          requestText: "Review the suppression-safe internal next step.",
          dueAt: new Date(Date.now() + 180_000).toISOString(),
          requestedReviewerId: second.user.id,
          mentionedUserIds: [third.user.id],
        },
        first.user.id,
      );
      expect(reviewRequest).toEqual(
        expect.objectContaining({
          status: "open",
          sourceMessageId: note!.id,
          requestedBy: first.user.id,
          requestedByDisplayName: "Conversation Test",
          requestedReviewerId: second.user.id,
          requestedReviewerDisplayName: "Other Conversation Test",
          mentionedMembers: [
            {
              userId: third.user.id,
              displayName: "Mentioned Conversation Test",
            },
          ],
        }),
      );
      expect(
        await conversations.getThread(first.workspace.workspaceId, thread!.id),
      ).toEqual(
        expect.objectContaining({
          openReviewRequestCount: 1,
          reviewRequests: [expect.objectContaining({ id: reviewRequest!.id })],
        }),
      );
      expect(
        (await conversations.listThreads(first.workspace.workspaceId))[0],
      ).toEqual(
        expect.objectContaining({
          openReviewRequestCount: 1,
          reviewRequests: [],
        }),
      );
      await expect(
        conversations.closeReviewRequest(
          first.workspace.workspaceId,
          thread!.id,
          reviewRequest!.id,
          "resolved",
          first.user.id,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      const resolvedReview = await conversations.closeReviewRequest(
        first.workspace.workspaceId,
        thread!.id,
        reviewRequest!.id,
        "resolved",
        second.user.id,
      );
      expect(resolvedReview).toEqual(
        expect.objectContaining({
          status: "resolved",
          closedBy: second.user.id,
          closedAt: expect.any(String),
        }),
      );
      const cancelledReview = await conversations.createReviewRequest(
        {
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          requestText: "A request the requester will cancel.",
          requestedReviewerId: second.user.id,
          mentionedUserIds: [],
        },
        first.user.id,
      );
      expect(
        await conversations.closeReviewRequest(
          first.workspace.workspaceId,
          thread!.id,
          cancelledReview!.id,
          "cancelled",
          first.user.id,
        ),
      ).toEqual(expect.objectContaining({ status: "cancelled" }));
      const teammateAssigned = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          providerThreadId: `thread-${suffix}`,
          subject: "Partnership follow-up",
          status: "assigned",
          assignedOwnerId: second.user.id,
        },
        first.user.id,
        thread!.id,
      );
      expect(teammateAssigned).toEqual(
        expect.objectContaining({
          assignedOwnerId: second.user.id,
          assignedOwnerDisplayName: "Other Conversation Test",
        }),
      );

      const assigned = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          providerThreadId: `thread-${suffix}`,
          subject: "Partnership follow-up",
          status: "assigned",
          assignedOwnerId: first.user.id,
        },
        first.user.id,
        thread!.id,
      );
      expect(assigned?.status).toBe("assigned");
      const classified = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          providerThreadId: `thread-${suffix}`,
          subject: "Partnership follow-up",
          status: "assigned",
          assignedOwnerId: first.user.id,
          sentiment: "negative",
          intent: "complaint",
          urgency: "high",
        },
        first.user.id,
        thread!.id,
      );
      expect(classified).toEqual(
        expect.objectContaining({
          sentiment: "negative",
          intent: "complaint",
          urgency: "high",
          classificationUpdatedBy: first.user.id,
          classificationUpdatedAt: expect.any(String),
        }),
      );
      const contextualized = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: relationship!.id,
          campaignId,
          destinationId,
          brandProfileId,
          channelConnectionId,
          publicationActionId,
          provider: "manual",
          providerThreadId: `thread-${suffix}`,
          subject: "Partnership follow-up",
          status: "assigned",
          assignedOwnerId: first.user.id,
        },
        first.user.id,
        thread!.id,
      );
      expect(contextualized).toEqual(
        expect.objectContaining({
          campaignId,
          campaignName: "Partner launch",
          destinationId,
          destinationTitle: "Partner landing page",
          brandProfileId,
          brandProfileName: "Partner brand",
          brandProfileStatus: "published",
          channelConnectionId,
          channelConnectionName: "Partner Discord",
          channelProvider: "discord_webhook",
          publicationActionId,
          publicationExternalId: "post-035",
          publicationStatus: "succeeded",
          sentiment: "negative",
          intent: "complaint",
          urgency: "high",
        }),
      );
      await expect(
        conversations.saveThread(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: relationship!.id,
            campaignId: foreignCampaignId,
            destinationId,
            provider: "manual",
            subject: "Foreign campaign",
            status: "assigned",
            assignedOwnerId: first.user.id,
          },
          first.user.id,
          thread!.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "campaignId" })],
      });
      await expect(
        conversations.saveThread(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: relationship!.id,
            brandProfileId: foreignBrandProfileId,
            provider: "manual",
            subject: "Foreign brand",
            status: "assigned",
            assignedOwnerId: first.user.id,
          },
          first.user.id,
          thread!.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "brandProfileId" })],
      });
      await sql`
        UPDATE workspace_membership SET role = 'viewer'
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND user_id = ${second.user.id}
      `;
      await expect(
        conversations.saveThread(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: relationship!.id,
            channelConnectionId: foreignChannelConnectionId,
            publicationActionId,
            provider: "manual",
            subject: "Foreign account",
            status: "assigned",
            assignedOwnerId: first.user.id,
          },
          first.user.id,
          thread!.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "channelConnectionId" })],
      });
      await expect(
        conversations.saveThread(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: relationship!.id,
            channelConnectionId,
            publicationActionId: foreignDestinationId,
            provider: "manual",
            subject: "Foreign publication",
            status: "assigned",
            assignedOwnerId: first.user.id,
          },
          first.user.id,
          thread!.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "publicationActionId" })],
      });
      await expect(
        conversations.saveThread(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: relationship!.id,
            campaignId,
            destinationId: foreignDestinationId,
            provider: "manual",
            subject: "Foreign destination",
            status: "assigned",
            assignedOwnerId: first.user.id,
          },
          first.user.id,
          thread!.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "destinationId" })],
      });
      const handoff = await conversations.createHandoff(
        {
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          contactSummary: "Jordan Example",
          importance: "A partnership decision needs human review.",
          requestOrOffer: "Requested reviewed partnership details.",
          priorResponseSummary: "Only receipt was acknowledged.",
          relevantContext: "Suppression remains active.",
          suggestedResponse: "Do not respond until permission is restored.",
          dueAt: new Date(Date.now() + 180_000).toISOString(),
        },
        first.user.id,
      );
      expect(handoff).toEqual(
        expect.objectContaining({ status: "open", requestedBy: first.user.id }),
      );
      expect(
        (await conversations.getThread(first.workspace.workspaceId, thread!.id))
          ?.activeHandoff,
      ).toEqual(expect.objectContaining({ id: handoff!.id }));
      expect(
        await conversations.listThreads(first.workspace.workspaceId, {
          search: "reviewed details",
          campaignId,
          destinationId,
          brandProfileId,
          channelConnectionId,
          publicationActionId,
          provider: "manual",
          status: "assigned",
          sentiment: "negative",
          intent: "complaint",
          urgency: "high",
          assignedOwnerId: first.user.id,
          handoff: "open",
          deadline: "upcoming",
          activityFrom: new Date(Date.now() - 86_400_000).toISOString(),
          limit: 10,
        }),
      ).toHaveLength(1);
      expect(
        await conversations.listThreads(first.workspace.workspaceId, {
          search: "post-035",
          campaignId,
          destinationId,
          brandProfileId,
          channelConnectionId,
          publicationActionId,
        }),
      ).toHaveLength(1);
      expect(
        await conversations.listThreads(first.workspace.workspaceId, {
          search: "brand-context-037",
          brandProfileId,
        }),
      ).toHaveLength(1);
      expect(
        await conversations.listThreads(first.workspace.workspaceId, {
          search: "definitely absent",
        }),
      ).toHaveLength(0);
      expect(
        await conversations.listThreads(first.workspace.workspaceId, {
          assignedOwnerId: null,
        }),
      ).toHaveLength(0);
      await expect(
        conversations.createHandoff(
          {
            workspaceId: first.workspace.workspaceId,
            conversationThreadId: thread!.id,
            contactSummary: "Duplicate",
            importance: "Duplicate",
            requestOrOffer: "Duplicate",
            priorResponseSummary: "",
            relevantContext: "",
            suggestedResponse: "",
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });
      const resolvedHandoff = await conversations.closeHandoff(
        first.workspace.workspaceId,
        thread!.id,
        handoff!.id,
        "resolved",
        first.user.id,
      );
      expect(resolvedHandoff).toEqual(
        expect.objectContaining({
          status: "resolved",
          closedBy: first.user.id,
        }),
      );
      const destinationShareKey = randomUUID();
      const destinationShare = await conversations.recordSharedResource(
        {
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          kind: "destination",
          destinationId,
          idempotencyKey: destinationShareKey,
          observedAt: new Date(Date.now() - 120_000).toISOString(),
        },
        first.user.id,
      );
      expect(destinationShare).toEqual(
        expect.objectContaining({
          kind: "destination",
          destinationId,
          destinationTitle: "Partner landing page",
          destinationCanonicalUrl: expect.stringContaining("market-me.local"),
          isCurrentThread: true,
        }),
      );
      expect(
        await conversations.recordSharedResource(
          {
            workspaceId: first.workspace.workspaceId,
            conversationThreadId: thread!.id,
            kind: "destination",
            destinationId,
            idempotencyKey: destinationShareKey,
            observedAt: new Date(Date.now() - 120_000).toISOString(),
          },
          first.user.id,
        ),
      ).toEqual(expect.objectContaining({ id: destinationShare!.id }));
      const publicationShare = await conversations.recordSharedResource(
        {
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          kind: "publication",
          publicationActionId,
          idempotencyKey: randomUUID(),
          observedAt: new Date(Date.now() - 60_000).toISOString(),
        },
        first.user.id,
      );
      expect(publicationShare).toEqual(
        expect.objectContaining({
          kind: "publication",
          channelConnectionId,
          channelConnectionName: "Partner Discord",
          publicationActionId,
          publicationExternalId: "post-035",
          isCurrentThread: true,
        }),
      );
      await expect(
        conversations.recordSharedResource(
          {
            workspaceId: first.workspace.workspaceId,
            conversationThreadId: thread!.id,
            kind: "destination",
            destinationId: foreignDestinationId,
            idempotencyKey: randomUUID(),
            observedAt: new Date().toISOString(),
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "destinationId" })],
      });
      await expect(
        conversations.recordSharedResource(
          {
            workspaceId: first.workspace.workspaceId,
            conversationThreadId: thread!.id,
            kind: "publication",
            publicationActionId: foreignDestinationId,
            idempotencyKey: randomUUID(),
            observedAt: new Date().toISOString(),
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "publicationActionId" })],
      });
      await expect(
        conversations.recordSharedResource(
          {
            workspaceId: first.workspace.workspaceId,
            conversationThreadId: thread!.id,
            kind: "destination",
            destinationId,
            idempotencyKey: randomUUID(),
            observedAt: new Date(Date.now() + 600_000).toISOString(),
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "observedAt" })],
      });
      expect(
        await conversations.getThread(first.workspace.workspaceId, thread!.id),
      ).toEqual(
        expect.objectContaining({
          sharedResourceHistoryCount: 2,
          recentSharedResources: expect.arrayContaining([
            expect.objectContaining({ id: destinationShare!.id }),
            expect.objectContaining({ id: publicationShare!.id }),
          ]),
        }),
      );
      const laterThread = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: relationship!.id,
          provider: "manual",
          providerThreadId: `later-share-thread-${suffix}`,
          subject: "Later share history view",
          status: "new",
        },
        first.user.id,
      );
      expect(
        await conversations.getThread(
          first.workspace.workspaceId,
          laterThread!.id,
        ),
      ).toEqual(
        expect.objectContaining({
          sharedResourceHistoryCount: 2,
          recentSharedResources: expect.arrayContaining([
            expect.objectContaining({ isCurrentThread: false }),
          ]),
        }),
      );
      await conversations.recordSharedResource(
        {
          workspaceId: first.workspace.workspaceId,
          conversationThreadId: thread!.id,
          kind: "destination",
          destinationId,
          idempotencyKey: randomUUID(),
          observedAt: new Date().toISOString(),
        },
        first.user.id,
      );
      expect(
        (
          await conversations.getThread(
            first.workspace.workspaceId,
            laterThread!.id,
          )
        )?.sharedResourceHistoryCount,
      ).toBe(2);
      await sql`DELETE FROM conversation_thread WHERE id = ${laterThread!.id}`;
      const broadRoutingRule = await conversations.saveRoutingRule(
        {
          workspaceId: first.workspace.workspaceId,
          name: "High urgency review",
          enabled: true,
          priority: 100,
          urgency: "high",
          targetStatus: "waiting_internal_information",
        },
        first.user.id,
      );
      const specificRoutingRule = await conversations.saveRoutingRule(
        {
          workspaceId: first.workspace.workspaceId,
          name: "Partner complaint owner",
          enabled: true,
          priority: 200,
          brandProfileId,
          channelConnectionId,
          intent: "complaint",
          urgency: "high",
          targetOwnerId: first.user.id,
          targetStatus: "assigned",
        },
        first.user.id,
      );
      expect(specificRoutingRule).toEqual(
        expect.objectContaining({
          brandProfileName: "Partner brand",
          channelConnectionName: "Partner Discord",
          targetOwnerDisplayName: "Conversation Test",
        }),
      );
      expect(
        (await conversations.getThread(first.workspace.workspaceId, thread!.id))
          ?.routingSuggestion,
      ).toEqual({
        ruleId: specificRoutingRule!.id,
        ruleName: "Partner complaint owner",
        priority: 200,
        matchedOn: ["brand", "account", "intent", "urgency"],
        targetOwnerId: first.user.id,
        targetOwnerDisplayName: "Conversation Test",
        targetStatus: "assigned",
      });
      await conversations.setRoutingRuleEnabled(
        first.workspace.workspaceId,
        specificRoutingRule!.id,
        false,
        first.user.id,
      );
      expect(
        (await conversations.getThread(first.workspace.workspaceId, thread!.id))
          ?.routingSuggestion,
      ).toEqual({
        ruleId: broadRoutingRule!.id,
        ruleName: "High urgency review",
        priority: 100,
        matchedOn: ["urgency"],
        targetOwnerId: undefined,
        targetOwnerDisplayName: undefined,
        targetStatus: "waiting_internal_information",
      });
      await conversations.setRoutingRuleEnabled(
        first.workspace.workspaceId,
        specificRoutingRule!.id,
        true,
        first.user.id,
      );
      await expect(
        conversations.saveRoutingRule(
          {
            workspaceId: first.workspace.workspaceId,
            name: "partner COMPLAINT owner",
            enabled: true,
            priority: 300,
            urgency: "high",
            targetStatus: "resolved",
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "name" })],
      });
      await expect(
        conversations.saveRoutingRule(
          {
            workspaceId: first.workspace.workspaceId,
            name: "Foreign brand routing",
            enabled: true,
            priority: 300,
            brandProfileId: foreignBrandProfileId,
            targetStatus: "resolved",
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "brandProfileId" })],
      });
      await expect(
        conversations.saveRoutingRule(
          {
            workspaceId: first.workspace.workspaceId,
            name: "Viewer owner routing",
            enabled: true,
            priority: 300,
            urgency: "high",
            targetOwnerId: second.user.id,
            targetStatus: "assigned",
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({
        name: "ConversationValidationError",
        issues: [expect.objectContaining({ field: "targetOwnerId" })],
      });
      await sql`
        DELETE FROM workspace_membership
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND user_id = ${second.user.id}
      `;
      await expect(
        conversations.saveThread(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: relationship!.id,
            provider: "manual",
            subject: "Foreign owner",
            status: "assigned",
            assignedOwnerId: second.user.id,
          },
          first.user.id,
          thread!.id,
        ),
      ).rejects.toMatchObject({ name: "ConversationValidationError" });

      const calendar = await sql<{ dueAt: string | Date }[]>`
        SELECT conversation_add_business_minutes(
          '2026-08-07T21:30:00.000Z'::timestamptz,
          'America/Chicago', 62, '09:00'::time, '17:00'::time, 120
        ) AS due_at
      `;
      expect(new Date(calendar[0]!.dueAt).toISOString()).toBe(
        "2026-08-10T15:30:00.000Z",
      );
      const policy = await conversations.saveServiceLevelPolicy(
        {
          workspaceId: first.workspace.workspaceId,
          timezone: "UTC",
          businessDaysMask: 127,
          businessStartTime: "00:00",
          businessEndTime: "23:59",
          unknownTargetMinutes: 60,
          lowTargetMinutes: 60,
          normalTargetMinutes: 60,
          highTargetMinutes: 60,
          criticalTargetMinutes: 60,
          atRiskBeforeMinutes: 10,
          escalationAfterMinutes: 60,
        },
        first.user.id,
      );
      expect(policy).toEqual(
        expect.objectContaining({
          timezone: "UTC",
          businessDaysMask: 127,
          highTargetMinutes: 60,
        }),
      );
      expect(
        (await conversations.getThread(first.workspace.workspaceId, thread!.id))
          ?.serviceLevel,
      ).toEqual(
        expect.objectContaining({
          source: "workspace_policy",
          state: "on_track",
        }),
      );
      await sql`
        UPDATE conversation_thread
        SET response_due_at = now() + interval '5 minutes'
        WHERE id = ${thread!.id}
      `;
      expect(
        (await conversations.getThread(first.workspace.workspaceId, thread!.id))
          ?.serviceLevel,
      ).toEqual(expect.objectContaining({ source: "manual", state: "at_risk" }));
      await sql`
        UPDATE conversation_thread SET response_due_at = NULL
        WHERE id = ${thread!.id}
      `;

      const audits = await sql<
        { eventType: string; data: Record<string, unknown> }[]
      >`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND subject_type = 'conversation_thread'
          AND subject_id = ${thread!.id}
        ORDER BY created_at
      `;
      expect(audits.map((audit) => audit.eventType)).toEqual([
        "conversation.created",
        "conversation.internal_note_added",
        "conversation.review_requested",
        "conversation.review_resolved",
        "conversation.review_requested",
        "conversation.review_cancelled",
        "conversation.status_changed",
        "conversation.assignment_changed",
        "conversation.classification_changed",
        "conversation.context_changed",
        "conversation.handoff_requested",
        "conversation.handoff_resolved",
        "conversation.shared_resource_recorded",
        "conversation.shared_resource_recorded",
        "conversation.shared_resource_recorded",
      ]);
      expect(JSON.stringify(audits)).not.toContain("Review suppression");
      expect(JSON.stringify(audits)).not.toContain("partnership decision");
      expect(JSON.stringify(audits)).not.toContain(
        "suppression-safe internal next step",
      );
      expect(audits[1].data).toEqual({ messageId: note!.id });
      expect(audits[2].data).toEqual(
        expect.objectContaining({
          reviewRequestId: reviewRequest!.id,
          requestedReviewerId: second.user.id,
          mentionedUserIds: [third.user.id],
          hasSourceNote: true,
        }),
      );
      expect(audits[7].data).toEqual(
        expect.objectContaining({ assignedOwnerId: first.user.id }),
      );
      expect(audits[8].data).toEqual(
        expect.objectContaining({
          sentiment: "negative",
          intent: "complaint",
          urgency: "high",
        }),
      );
      expect(audits[9].data).toEqual(
        expect.objectContaining({
          campaignId,
          destinationId,
          brandProfileId,
          channelConnectionId,
          publicationActionId,
        }),
      );
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id = (
          SELECT organization_id FROM workspace
          WHERE id = ${first.workspace.workspaceId}
        )
      `;
      await sql`
        DELETE FROM organization
        WHERE id IN (
          SELECT organization_id FROM workspace
          WHERE id IN (${second.workspace.workspaceId}, ${third.workspace.workspaceId})
        )
      `;
    }
  });
});
