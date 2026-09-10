import { randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type {
  ConversationDraftingActorKind,
  ConversationDraftingPresence,
  ConversationResponseDraft,
} from "@market-me/domain";
import type { DatabaseClient } from "./client";
import type {
  ConversationResponseDraftWrite,
  StoredConversationComposerState,
} from "./models";

interface DraftRow extends Omit<ConversationResponseDraft, "createdAt" | "updatedAt"> {
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface PresenceRow extends Omit<ConversationDraftingPresence, "expiresAt" | "updatedAt"> {
  expiresAt: string | Date;
  updatedAt: string | Date;
}

export class ConversationComposerValidationError extends Error {
  constructor(readonly issues: readonly { field: string; message: string }[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "ConversationComposerValidationError";
  }
}

export class ConversationComposerRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async getState(
    workspaceId: string,
    conversationThreadId: string,
  ): Promise<StoredConversationComposerState> {
    const [drafts, presences] = await Promise.all([
      this.sql<DraftRow[]>`
        SELECT draft.id, draft.workspace_id, draft.conversation_thread_id,
          draft.body, draft.source_suggestion_id, draft.created_by,
          draft.updated_by, editor.display_name AS updated_by_display_name,
          draft.created_at, draft.updated_at
        FROM conversation_response_draft draft
        JOIN app_user editor ON editor.id = draft.updated_by
        WHERE draft.workspace_id = ${workspaceId}
          AND draft.conversation_thread_id = ${conversationThreadId}
        LIMIT 1
      `,
      this.sql<PresenceRow[]>`
        SELECT presence.conversation_thread_id, presence.actor_kind,
          presence.actor_user_id, actor.display_name AS actor_display_name,
          presence.expires_at, presence.updated_at
        FROM conversation_drafting_presence presence
        JOIN app_user actor ON actor.id = presence.actor_user_id
        WHERE presence.workspace_id = ${workspaceId}
          AND presence.conversation_thread_id = ${conversationThreadId}
          AND presence.expires_at > now()
        ORDER BY presence.actor_kind, lower(actor.display_name), actor.id
        LIMIT 20
      `,
    ]);
    return {
      draft: drafts[0] ? normalizeDraft(drafts[0]) : undefined,
      presences: presences.map(normalizePresence),
    };
  }

  async saveDraft(
    input: ConversationResponseDraftWrite,
    actorUserId: string,
  ): Promise<ConversationResponseDraft> {
    if (!input.body.trim() || input.body.length > 20_000)
      throw new ConversationComposerValidationError([
        {
          field: "body",
          message: "Response draft must contain 1 to 20,000 characters.",
        },
      ]);
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, input.workspaceId, actorUserId);
      await this.requireThread(
        transaction,
        input.workspaceId,
        input.conversationThreadId,
      );
      if (input.sourceSuggestionId) {
        const sources = await transaction<{ found: boolean }[]>`
          SELECT true AS found
          FROM conversation_response_suggestion
          WHERE id = ${input.sourceSuggestionId}
            AND workspace_id = ${input.workspaceId}
            AND conversation_thread_id = ${input.conversationThreadId}
        `;
        if (!sources[0])
          throw new ConversationComposerValidationError([
            {
              field: "sourceSuggestionId",
              message: "Source suggestion must belong to this conversation.",
            },
          ]);
      }
      const rows = await transaction<DraftRow[]>`
        INSERT INTO conversation_response_draft (
          id, workspace_id, conversation_thread_id, body,
          source_suggestion_id, created_by, updated_by
        ) VALUES (
          ${randomUUID()}, ${input.workspaceId}, ${input.conversationThreadId},
          ${input.body}, ${input.sourceSuggestionId ?? null},
          ${actorUserId}, ${actorUserId}
        )
        ON CONFLICT (workspace_id, conversation_thread_id) DO UPDATE
        SET body = EXCLUDED.body,
          source_suggestion_id = EXCLUDED.source_suggestion_id,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING id, workspace_id, conversation_thread_id, body,
          source_suggestion_id, created_by, updated_by, created_at, updated_at
      `;
      const editors = await transaction<{ displayName: string }[]>`
        SELECT display_name FROM app_user WHERE id = ${actorUserId}
      `;
      await this.upsertPresence(
        transaction,
        input.workspaceId,
        input.conversationThreadId,
        "human",
        actorUserId,
      );
      await this.audit(transaction, input.workspaceId, actorUserId, input.conversationThreadId, "conversation.response_draft_saved", {
        draftId: rows[0]!.id,
        sourceSuggestionId: input.sourceSuggestionId ?? null,
        characterCount: input.body.length,
      });
      return normalizeDraft({
        ...rows[0]!,
        updatedByDisplayName: editors[0]!.displayName,
      });
    });
  }

  async discardDraft(
    workspaceId: string,
    conversationThreadId: string,
    actorUserId: string,
  ): Promise<boolean> {
    return this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      const rows = await transaction<{ id: string; sourceSuggestionId?: string | null }[]>`
        DELETE FROM conversation_response_draft
        WHERE workspace_id = ${workspaceId}
          AND conversation_thread_id = ${conversationThreadId}
        RETURNING id, source_suggestion_id
      `;
      await transaction`
        DELETE FROM conversation_drafting_presence
        WHERE workspace_id = ${workspaceId}
          AND conversation_thread_id = ${conversationThreadId}
          AND actor_kind = 'human' AND actor_user_id = ${actorUserId}
      `;
      if (!rows[0]) return false;
      await this.audit(transaction, workspaceId, actorUserId, conversationThreadId, "conversation.response_draft_discarded", {
        draftId: rows[0].id,
        sourceSuggestionId: rows[0].sourceSuggestionId ?? null,
      });
      return true;
    });
  }

  async heartbeatPresence(
    workspaceId: string,
    conversationThreadId: string,
    actorKind: ConversationDraftingActorKind,
    actorUserId: string,
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await this.requireWriter(transaction, workspaceId, actorUserId);
      await this.requireThread(transaction, workspaceId, conversationThreadId);
      await this.upsertPresence(
        transaction,
        workspaceId,
        conversationThreadId,
        actorKind,
        actorUserId,
      );
    });
  }

  async clearPresence(
    workspaceId: string,
    conversationThreadId: string,
    actorKind: ConversationDraftingActorKind,
    actorUserId: string,
  ): Promise<void> {
    await this.sql`
      DELETE FROM conversation_drafting_presence presence
      USING workspace_membership membership
      WHERE presence.workspace_id = ${workspaceId}
        AND presence.conversation_thread_id = ${conversationThreadId}
        AND presence.actor_kind = ${actorKind}
        AND presence.actor_user_id = ${actorUserId}
        AND membership.workspace_id = presence.workspace_id
        AND membership.user_id = ${actorUserId}
        AND membership.role IN ('owner', 'admin', 'editor')
    `;
  }

  private async upsertPresence(
    transaction: TransactionSql,
    workspaceId: string,
    conversationThreadId: string,
    actorKind: ConversationDraftingActorKind,
    actorUserId: string,
  ): Promise<void> {
    await transaction`
      INSERT INTO conversation_drafting_presence (
        workspace_id, conversation_thread_id, actor_kind, actor_user_id,
        expires_at, updated_at
      ) VALUES (
        ${workspaceId}, ${conversationThreadId}, ${actorKind}, ${actorUserId},
        now() + interval '2 minutes', now()
      )
      ON CONFLICT (
        workspace_id, conversation_thread_id, actor_kind, actor_user_id
      ) DO UPDATE
      SET expires_at = now() + interval '2 minutes', updated_at = now()
    `;
  }

  private async requireWriter(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ): Promise<void> {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId} AND user_id = ${actorUserId}
        AND role IN ('owner', 'admin', 'editor')
    `;
    if (!rows[0])
      throw new ConversationComposerValidationError([
        {
          field: "workspaceId",
          message: "Response drafting requires workspace authoring access.",
        },
      ]);
  }

  private async requireThread(
    transaction: TransactionSql,
    workspaceId: string,
    conversationThreadId: string,
  ): Promise<void> {
    const rows = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM conversation_thread
      WHERE id = ${conversationThreadId} AND workspace_id = ${workspaceId}
      FOR UPDATE
    `;
    if (!rows[0])
      throw new ConversationComposerValidationError([
        { field: "conversationThreadId", message: "Conversation not found." },
      ]);
  }

  private async audit(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    subjectId: string,
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId},
        ${eventType}, 'conversation_thread', ${subjectId},
        ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }
}

function normalizeDraft(draft: DraftRow): ConversationResponseDraft {
  return {
    ...draft,
    sourceSuggestionId: draft.sourceSuggestionId ?? undefined,
    createdAt: new Date(draft.createdAt).toISOString(),
    updatedAt: new Date(draft.updatedAt).toISOString(),
  };
}

function normalizePresence(presence: PresenceRow): ConversationDraftingPresence {
  return {
    ...presence,
    expiresAt: new Date(presence.expiresAt).toISOString(),
    updatedAt: new Date(presence.updatedAt).toISOString(),
  };
}
