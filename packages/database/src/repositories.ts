import { randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type {
  ContextPackFact,
  ContextPackSource,
  ContextPackVersion,
} from "@market-me/domain";
import type { DatabaseClient } from "./client";
import type {
  AuthenticatedUser,
  SmartSourceTestResult,
  SmartSourceWrite,
  SourceItemRecord,
  SourceItemWrite,
  ConnectorCursorRecord,
  StorageConnectionRecord,
  StorageConnectionSecrets,
  StoredSmartSource,
  WorkspaceAccess,
  WorkspaceMember,
  WorkspaceRole,
  WebhookEventRecord,
  WebhookSubscriptionRecord,
  WebhookSubscriptionTarget,
  ContextPackDraftWrite,
  StoredContextPack,
  ContentPackageWrite,
  IngestionWorkItem,
  StoredContentPackage,
  StoredContentAssetForAccess,
  ContentAssetRightsReviewWrite,
  OidcSignInResult,
  StoredOidcAuthState,
  WorkspaceInvitation,
  WorkspaceInvitationRole,
} from "./models";

type SmartSourceRow = Omit<StoredSmartSource, "locations">;
type ContextPackRow = Omit<
  StoredContextPack,
  "currentVersion" | "draftVersion"
> & {
  currentVersionId?: string;
};
type ContextPackVersionRow = Omit<ContextPackVersion, "sources" | "facts">;
type ContentPackageRow = Omit<
  StoredContentPackage,
  "assets" | "evidence" | "conflicts"
>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizedTimestamp(
  value: string | Date | null | undefined,
): string | undefined {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

export class MarketMeRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async bootstrapDevelopmentWorkspace(input: {
    email: string;
    displayName: string;
  }): Promise<{ user: AuthenticatedUser; workspace: WorkspaceAccess }> {
    const normalizedEmail = normalizeEmail(input.email);
    const userId = randomUUID();
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const brandId = randomUUID();

    return this.sql.begin(async (transaction) => {
      const users = await transaction<AuthenticatedUser[]>`
        INSERT INTO app_user (id, email, normalized_email, display_name)
        VALUES (${userId}, ${input.email.trim()}, ${normalizedEmail}, ${input.displayName.trim()})
        ON CONFLICT (normalized_email) DO UPDATE
        SET display_name = EXCLUDED.display_name, updated_at = now()
        RETURNING id, email, display_name
      `;
      const user = users[0];

      const existing = await transaction<
        (WorkspaceAccess & { role: WorkspaceRole })[]
      >`
        SELECT w.id AS workspace_id, w.organization_id, w.name AS workspace_name, wm.role
        FROM workspace w
        JOIN workspace_membership wm ON wm.workspace_id = w.id
        WHERE wm.user_id = ${user.id}
        ORDER BY w.created_at
        LIMIT 1
      `;

      if (existing[0]) return { user, workspace: existing[0] };

      await transaction`
        INSERT INTO organization (id, name, slug)
        VALUES (${organizationId}, ${"Market Me"}, ${`market-me-${organizationId.slice(0, 8)}`})
      `;
      await transaction`
        INSERT INTO organization_membership (organization_id, user_id, role)
        VALUES (${organizationId}, ${user.id}, 'owner')
      `;
      await transaction`
        INSERT INTO workspace (id, organization_id, name, slug)
        VALUES (${workspaceId}, ${organizationId}, ${"Market Me"}, ${"market-me"})
      `;
      await transaction`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${workspaceId}, ${user.id}, 'owner')
      `;
      await transaction`
        INSERT INTO brand (id, workspace_id, name, is_default)
        VALUES (${brandId}, ${workspaceId}, ${"Market Me"}, true)
      `;

      return {
        user,
        workspace: {
          workspaceId,
          organizationId,
          workspaceName: "Market Me",
          role: "owner",
        },
      };
    });
  }

  async createSession(input: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.sql`
      INSERT INTO app_session (token_hash, user_id, expires_at)
      VALUES (${input.tokenHash}, ${input.userId}, ${input.expiresAt})
    `;
  }

  async getSession(tokenHash: string): Promise<AuthenticatedUser | undefined> {
    const users = await this.sql<AuthenticatedUser[]>`
      SELECT u.id, u.email, u.display_name
      FROM app_session s
      JOIN app_user u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()
      LIMIT 1
    `;
    if (users[0]) {
      await this
        .sql`UPDATE app_session SET last_seen_at = now() WHERE token_hash = ${tokenHash}`;
    }
    return users[0];
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.sql`DELETE FROM app_session WHERE token_hash = ${tokenHash}`;
  }

  async saveOidcAuthState(input: {
    stateHash: string;
    issuer: string;
    nonceHash: string;
    codeVerifier: string;
    returnTo: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`DELETE FROM oidc_auth_state WHERE expires_at <= now()`;
      await transaction`
        INSERT INTO oidc_auth_state (
          state_hash, issuer, nonce_hash, code_verifier, return_to, expires_at
        )
        VALUES (
          ${input.stateHash}, ${input.issuer}, ${input.nonceHash},
          ${input.codeVerifier}, ${input.returnTo}, ${input.expiresAt}
        )
      `;
    });
  }

  async consumeOidcAuthState(
    stateHash: string,
  ): Promise<StoredOidcAuthState | undefined> {
    const rows = await this.sql<StoredOidcAuthState[]>`
      DELETE FROM oidc_auth_state
      WHERE state_hash = ${stateHash} AND expires_at > now()
      RETURNING issuer, nonce_hash, code_verifier, return_to
    `;
    return rows[0];
  }

  async completeOidcSignIn(input: {
    issuer: string;
    subject: string;
    email: string;
    displayName: string;
    allowBootstrap: boolean;
  }): Promise<OidcSignInResult> {
    const normalizedEmail = normalizeEmail(input.email);
    return this.sql.begin(async (transaction) => {
      const linked = await transaction<(AuthenticatedUser & { normalizedEmail: string })[]>`
        SELECT app_user.id, app_user.email, app_user.display_name, app_user.normalized_email
        FROM oidc_identity
        JOIN app_user ON app_user.id = oidc_identity.user_id
        WHERE oidc_identity.issuer = ${input.issuer}
          AND oidc_identity.subject = ${input.subject}
        FOR UPDATE OF oidc_identity
      `;
      if (linked[0]) {
        const accepted = await this.acceptPendingOidcInvitations(
          transaction,
          linked[0].id,
          linked[0].normalizedEmail,
        );
        await transaction`
          UPDATE oidc_identity SET last_login_at = now()
          WHERE issuer = ${input.issuer} AND subject = ${input.subject}
        `;
        const { normalizedEmail: _normalizedEmail, ...user } = linked[0];
        return { status: accepted ? ("invited" as const) : ("authenticated" as const), user };
      }

      const pendingInvitations = await transaction<{ id: string }[]>`
        SELECT id FROM workspace_invitation
        WHERE normalized_email = ${normalizedEmail}
          AND status = 'pending' AND expires_at > now()
        ORDER BY created_at
        LIMIT 100
        FOR UPDATE
      `;

      let users = await transaction<AuthenticatedUser[]>`
        SELECT id, email, display_name
        FROM app_user
        WHERE normalized_email = ${normalizedEmail}
        FOR UPDATE
      `;
      let bootstrapped = false;
      if (!users[0]) {
        if (!input.allowBootstrap && !pendingInvitations.length) {
          return { status: "not_provisioned" as const };
        }
        const userId = randomUUID();
        users = await transaction<AuthenticatedUser[]>`
          INSERT INTO app_user (id, email, normalized_email, display_name)
          VALUES (
            ${userId}, ${input.email.trim()}, ${normalizedEmail},
            ${input.displayName.trim() || input.email.trim()}
          )
          RETURNING id, email, display_name
        `;
      }
      const user = users[0];
      const acceptedInvitation = await this.acceptPendingOidcInvitations(
        transaction,
        user.id,
        normalizedEmail,
      );

      const access = await transaction<{ found: boolean }[]>`
        SELECT true AS found FROM workspace_membership
        WHERE user_id = ${user.id}
        LIMIT 1
      `;
      if (!access[0] && !acceptedInvitation && !input.allowBootstrap) {
        return { status: "not_provisioned" as const };
      }

      if (input.allowBootstrap) {
        if (!access[0]) {
          const organizationId = randomUUID();
          const workspaceId = randomUUID();
          const brandId = randomUUID();
          await transaction`
            INSERT INTO organization (id, name, slug)
            VALUES (
              ${organizationId}, ${"Market Me"},
              ${`market-me-${organizationId.slice(0, 8)}`}
            )
          `;
          await transaction`
            INSERT INTO organization_membership (organization_id, user_id, role)
            VALUES (${organizationId}, ${user.id}, 'owner')
          `;
          await transaction`
            INSERT INTO workspace (id, organization_id, name, slug)
            VALUES (${workspaceId}, ${organizationId}, ${"Market Me"}, ${"market-me"})
          `;
          await transaction`
            INSERT INTO workspace_membership (workspace_id, user_id, role)
            VALUES (${workspaceId}, ${user.id}, 'owner')
          `;
          await transaction`
            INSERT INTO brand (id, workspace_id, name, is_default)
            VALUES (${brandId}, ${workspaceId}, ${"Market Me"}, true)
          `;
          bootstrapped = true;
        }
      }

      await transaction`
        INSERT INTO oidc_identity (
          issuer, subject, user_id, email_at_link
        ) VALUES (
          ${input.issuer}, ${input.subject}, ${user.id}, ${input.email.trim()}
        )
      `;
      return {
        status: bootstrapped
          ? ("bootstrapped" as const)
          : acceptedInvitation
            ? ("invited" as const)
            : ("authenticated" as const),
        user,
      };
    });
  }

  private async acceptPendingOidcInvitations(
    transaction: TransactionSql,
    userId: string,
    normalizedEmail: string,
  ): Promise<boolean> {
    const invitations = await transaction<{
      id: string;
      workspaceId: string;
      organizationId: string;
      role: WorkspaceInvitationRole;
    }[]>`
      SELECT invitation.id, invitation.workspace_id, workspace.organization_id,
        invitation.role
      FROM workspace_invitation invitation
      JOIN workspace ON workspace.id = invitation.workspace_id
      WHERE invitation.normalized_email = ${normalizedEmail}
        AND invitation.status = 'pending'
        AND invitation.expires_at > now()
      ORDER BY invitation.created_at
      LIMIT 100
      FOR UPDATE OF invitation
    `;
    for (const invitation of invitations) {
      await transaction`
        INSERT INTO organization_membership (organization_id, user_id, role)
        VALUES (${invitation.organizationId}, ${userId}, 'member')
        ON CONFLICT (organization_id, user_id) DO NOTHING
      `;
      await transaction`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${invitation.workspaceId}, ${userId}, ${invitation.role})
        ON CONFLICT (workspace_id, user_id) DO NOTHING
      `;
      await transaction`
        UPDATE workspace_invitation
        SET status = 'accepted', accepted_by = ${userId}, accepted_at = now()
        WHERE id = ${invitation.id} AND status = 'pending'
      `;
      await transaction`
        INSERT INTO audit_event (
          id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data
        ) VALUES (
          ${randomUUID()}, ${invitation.workspaceId}, ${userId},
          'workspace.invitation_accepted', 'workspace_invitation', ${invitation.id},
          ${transaction.json({ role: invitation.role } as JSONValue)}
        )
      `;
    }
    return invitations.length > 0;
  }

  async listWorkspaceAccess(
    userId: string,
  ): Promise<readonly WorkspaceAccess[]> {
    return this.sql<WorkspaceAccess[]>`
      SELECT w.id AS workspace_id, w.organization_id, w.name AS workspace_name, wm.role
      FROM workspace w
      JOIN workspace_membership wm ON wm.workspace_id = w.id
      WHERE wm.user_id = ${userId}
      ORDER BY w.name
    `;
  }

  async getWorkspaceAccess(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceAccess | undefined> {
    const rows = await this.sql<WorkspaceAccess[]>`
      SELECT w.id AS workspace_id, w.organization_id, w.name AS workspace_name, wm.role
      FROM workspace w
      JOIN workspace_membership wm ON wm.workspace_id = w.id
      WHERE wm.user_id = ${userId} AND w.id = ${workspaceId}
      LIMIT 1
    `;
    return rows[0];
  }

  async listWorkspaceMembers(
    workspaceId: string,
  ): Promise<readonly WorkspaceMember[]> {
    return this.sql<WorkspaceMember[]>`
      SELECT membership.user_id, app_user.display_name, membership.role,
        membership.role IN ('owner', 'admin', 'editor')
          AS assignable_to_conversations
      FROM workspace_membership membership
      JOIN app_user ON app_user.id = membership.user_id
      WHERE membership.workspace_id = ${workspaceId}
      ORDER BY lower(app_user.display_name), app_user.id
    `;
  }

  async listWorkspaceInvitations(workspaceId: string): Promise<readonly WorkspaceInvitation[]> {
    return this.sql<WorkspaceInvitation[]>`
      SELECT id, workspace_id, email, role,
        CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired' ELSE status END AS status,
        invited_by, accepted_by, expires_at, accepted_at, revoked_at, created_at
      FROM workspace_invitation
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
      LIMIT 200
    `;
  }

  async createWorkspaceInvitation(input: {
    workspaceId: string;
    email: string;
    role: WorkspaceInvitationRole;
    invitedBy: string;
    expiresAt: Date;
  }): Promise<WorkspaceInvitation> {
    const normalizedEmail = normalizeEmail(input.email);
    return this.sql.begin(async (transaction) => {
      const actor = await transaction<{ role: WorkspaceRole }[]>`
        SELECT role FROM workspace_membership
        WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.invitedBy}
        FOR UPDATE
      `;
      if (!actor[0] || !["owner", "admin"].includes(actor[0].role)) {
        throw new Error("Only workspace owners and administrators can invite members");
      }
      const existing = await transaction<WorkspaceInvitation[]>`
        SELECT id, workspace_id, email, role, status, invited_by, accepted_by,
          expires_at, accepted_at, revoked_at, created_at
        FROM workspace_invitation
        WHERE workspace_id = ${input.workspaceId}
          AND normalized_email = ${normalizedEmail}
          AND status = 'pending' AND expires_at > now()
        FOR UPDATE
      `;
      if (existing[0]) return existing[0];
      await transaction`
        UPDATE workspace_invitation
        SET status = 'revoked', revoked_at = now()
        WHERE workspace_id = ${input.workspaceId}
          AND normalized_email = ${normalizedEmail}
          AND status = 'pending'
      `;
      const id = randomUUID();
      const rows = await transaction<WorkspaceInvitation[]>`
        INSERT INTO workspace_invitation (
          id, workspace_id, email, normalized_email, role, invited_by, expires_at
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.email.trim()}, ${normalizedEmail},
          ${input.role}, ${input.invitedBy}, ${input.expiresAt}
        )
        RETURNING id, workspace_id, email, role, status, invited_by, accepted_by,
          expires_at, accepted_at, revoked_at, created_at
      `;
      await transaction`
        INSERT INTO audit_event (
          id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data
        ) VALUES (
          ${randomUUID()}, ${input.workspaceId}, ${input.invitedBy},
          'workspace.invitation_created', 'workspace_invitation', ${id},
          ${transaction.json({ role: input.role } as JSONValue)}
        )
      `;
      return rows[0];
    });
  }

  async revokeWorkspaceInvitation(input: {
    workspaceId: string;
    invitationId: string;
    revokedBy: string;
  }): Promise<WorkspaceInvitation | undefined> {
    return this.sql.begin(async (transaction) => {
      const actor = await transaction<{ role: WorkspaceRole }[]>`
        SELECT role FROM workspace_membership
        WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.revokedBy}
        FOR UPDATE
      `;
      if (!actor[0] || !["owner", "admin"].includes(actor[0].role)) {
        throw new Error("Only workspace owners and administrators can revoke invitations");
      }
      const rows = await transaction<WorkspaceInvitation[]>`
        UPDATE workspace_invitation
        SET status = 'revoked', revoked_at = now()
        WHERE id = ${input.invitationId} AND workspace_id = ${input.workspaceId}
          AND status = 'pending'
        RETURNING id, workspace_id, email, role, status, invited_by, accepted_by,
          expires_at, accepted_at, revoked_at, created_at
      `;
      if (rows[0]) {
        await transaction`
          INSERT INTO audit_event (
            id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data
          ) VALUES (
            ${randomUUID()}, ${input.workspaceId}, ${input.revokedBy},
            'workspace.invitation_revoked', 'workspace_invitation', ${input.invitationId},
            ${transaction.json({} as JSONValue)}
          )
        `;
      }
      return rows[0];
    });
  }

  async listSmartSources(
    workspaceId: string,
  ): Promise<readonly StoredSmartSource[]> {
    const rows = await this.sql<SmartSourceRow[]>`
      SELECT id, workspace_id, storage_connection_id, name, provider, recursive,
        readiness_mode, stabilization_window_seconds, related_file_minimum,
        ready_marker, ai_confidence_threshold, allowed_mime_types, ignore_patterns,
        context_pack_ids, autonomy_mode, enabled, version, last_scan_at,
        created_at, updated_at
      FROM smart_source
      WHERE workspace_id = ${workspaceId}
      ORDER BY name
    `;
    return this.attachLocations(rows);
  }

  async listEnabledRemoteSmartSources(): Promise<
    readonly { id: string; workspaceId: string }[]
  > {
    return this.sql<{ id: string; workspaceId: string }[]>`
      SELECT s.id, s.workspace_id
      FROM smart_source s
      JOIN storage_connection c ON c.id = s.storage_connection_id
      WHERE s.enabled = true AND s.provider <> 'local' AND c.status = 'active'
      ORDER BY COALESCE(s.last_scan_at, '-infinity'::timestamptz), s.created_at
    `;
  }

  async listEnabledRemoteSmartSourcesByConnection(
    connectionId: string,
  ): Promise<readonly { id: string; workspaceId: string }[]> {
    return this.sql<{ id: string; workspaceId: string }[]>`
      SELECT s.id, s.workspace_id
      FROM smart_source s
      JOIN storage_connection c ON c.id = s.storage_connection_id
      WHERE s.storage_connection_id = ${connectionId}
        AND s.enabled = true AND s.provider <> 'local' AND c.status = 'active'
      ORDER BY s.created_at
    `;
  }

  async getSmartSource(
    workspaceId: string,
    smartSourceId: string,
  ): Promise<StoredSmartSource | undefined> {
    const rows = await this.sql<SmartSourceRow[]>`
      SELECT id, workspace_id, storage_connection_id, name, provider, recursive,
        readiness_mode, stabilization_window_seconds, related_file_minimum,
        ready_marker, ai_confidence_threshold, allowed_mime_types, ignore_patterns,
        context_pack_ids, autonomy_mode, enabled, version, last_scan_at,
        created_at, updated_at
      FROM smart_source
      WHERE workspace_id = ${workspaceId} AND id = ${smartSourceId}
      LIMIT 1
    `;
    return (await this.attachLocations(rows))[0];
  }

  async createSmartSource(
    input: SmartSourceWrite,
    actorUserId: string,
  ): Promise<StoredSmartSource> {
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      if (input.storageConnectionId) {
        const connection = await transaction<{ id: string }[]>`
          SELECT id FROM storage_connection
          WHERE id = ${input.storageConnectionId} AND workspace_id = ${input.workspaceId} AND provider = ${input.provider}
        `;
        if (!connection[0])
          throw new Error(
            "Storage connection does not belong to the workspace and provider",
          );
      }
      await this.requirePublishedContextPacks(
        transaction,
        input.workspaceId,
        input.contextPackIds,
      );
      await transaction`
        INSERT INTO smart_source (
          id, workspace_id, storage_connection_id, name, provider, recursive,
          readiness_mode, stabilization_window_seconds, related_file_minimum,
          ready_marker, ai_confidence_threshold, allowed_mime_types, ignore_patterns,
          context_pack_ids, autonomy_mode, enabled, created_by
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.storageConnectionId ?? null}, ${input.name},
          ${input.provider}, ${input.recursive}, ${input.readinessMode},
          ${input.stabilizationWindowSeconds}, ${input.relatedFileMinimum ?? null},
          ${input.readyMarker ?? null}, ${input.aiConfidenceThreshold ?? null},
          ${[...input.allowedMimeTypes]}, ${[...input.ignorePatterns]},
          ${input.contextPackIds}, ${input.autonomyMode}, ${input.enabled}, ${actorUserId}
        )
      `;
      for (const location of input.locations) {
        await transaction`
          INSERT INTO smart_source_location (id, smart_source_id, provider_location_id, display_path)
          VALUES (${randomUUID()}, ${id}, ${location.providerLocationId}, ${location.displayPath})
        `;
      }
      await transaction`
        INSERT INTO audit_event (id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        VALUES (${randomUUID()}, ${input.workspaceId}, ${actorUserId}, 'smart_source.created', 'smart_source', ${id}, ${transaction.json({ name: input.name })})
      `;
    });
    return (await this.getSmartSource(input.workspaceId, id))!;
  }

  async updateSmartSource(
    smartSourceId: string,
    input: SmartSourceWrite,
    actorUserId: string,
  ): Promise<StoredSmartSource | undefined> {
    const existing = await this.getSmartSource(
      input.workspaceId,
      smartSourceId,
    );
    if (!existing) return undefined;

    await this.sql.begin(async (transaction) => {
      if (input.storageConnectionId) {
        const connection = await transaction<{ id: string }[]>`
          SELECT id FROM storage_connection
          WHERE id = ${input.storageConnectionId} AND workspace_id = ${input.workspaceId} AND provider = ${input.provider}
        `;
        if (!connection[0])
          throw new Error(
            "Storage connection does not belong to the workspace and provider",
          );
      }
      await this.requirePublishedContextPacks(
        transaction,
        input.workspaceId,
        input.contextPackIds,
      );
      await transaction`
        UPDATE smart_source SET
          storage_connection_id = ${input.storageConnectionId ?? null}, name = ${input.name},
          provider = ${input.provider}, recursive = ${input.recursive}, readiness_mode = ${input.readinessMode},
          stabilization_window_seconds = ${input.stabilizationWindowSeconds},
          related_file_minimum = ${input.relatedFileMinimum ?? null}, ready_marker = ${input.readyMarker ?? null},
          ai_confidence_threshold = ${input.aiConfidenceThreshold ?? null}, allowed_mime_types = ${[...input.allowedMimeTypes]},
          ignore_patterns = ${[...input.ignorePatterns]}, context_pack_ids = ${input.contextPackIds},
          autonomy_mode = ${input.autonomyMode}, enabled = ${input.enabled}, version = version + 1, updated_at = now()
        WHERE id = ${smartSourceId} AND workspace_id = ${input.workspaceId}
      `;
      await transaction`DELETE FROM smart_source_location WHERE smart_source_id = ${smartSourceId}`;
      for (const location of input.locations) {
        await transaction`
          INSERT INTO smart_source_location (id, smart_source_id, provider_location_id, display_path)
          VALUES (${randomUUID()}, ${smartSourceId}, ${location.providerLocationId}, ${location.displayPath})
        `;
      }
      await transaction`
        INSERT INTO audit_event (id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
        VALUES (${randomUUID()}, ${input.workspaceId}, ${actorUserId}, 'smart_source.updated', 'smart_source', ${smartSourceId}, ${transaction.json({ version: existing.version + 1 })})
      `;
    });
    return this.getSmartSource(input.workspaceId, smartSourceId);
  }

  async recordSmartSourceTest(
    input: Omit<SmartSourceTestResult, "id" | "createdAt"> & {
      requestedBy: string;
    },
  ): Promise<SmartSourceTestResult> {
    const id = randomUUID();
    const rows = await this.sql<SmartSourceTestResult[]>`
      INSERT INTO smart_source_test_run (
        id, smart_source_id, requested_by, status, matched_count, ignored_count, diagnostics
      ) VALUES (
        ${id}, ${input.smartSourceId}, ${input.requestedBy}, ${input.status},
        ${input.matchedCount}, ${input.ignoredCount}, ${this.sql.json(input.diagnostics)}
      )
      RETURNING id, smart_source_id, status, matched_count, ignored_count, diagnostics, created_at
    `;
    return rows[0];
  }

  async listStorageConnections(
    workspaceId: string,
  ): Promise<readonly StorageConnectionRecord[]> {
    return this.sql<StorageConnectionRecord[]>`
      SELECT id, workspace_id, provider, display_name, provider_account_id, status, scopes, access_token_expires_at
      FROM storage_connection
      WHERE workspace_id = ${workspaceId}
      ORDER BY display_name
    `;
  }

  async getStorageConnection(
    workspaceId: string,
    connectionId: string,
  ): Promise<StorageConnectionSecrets | undefined> {
    const rows = await this.sql<StorageConnectionSecrets[]>`
      SELECT id, workspace_id, provider, display_name, provider_account_id, status, scopes,
        access_token_expires_at, encrypted_access_token, encrypted_refresh_token
      FROM storage_connection
      WHERE workspace_id = ${workspaceId} AND id = ${connectionId}
      LIMIT 1
    `;
    return rows[0];
  }

  async updateStorageConnectionTokens(input: {
    connectionId: string;
    encryptedAccessToken: string;
    encryptedRefreshToken?: string;
    scopes: readonly string[];
    accessTokenExpiresAt?: Date;
  }): Promise<void> {
    await this.sql`
      UPDATE storage_connection SET
        encrypted_access_token = ${input.encryptedAccessToken},
        encrypted_refresh_token = COALESCE(${input.encryptedRefreshToken ?? null}, encrypted_refresh_token),
        scopes = ${[...input.scopes]},
        access_token_expires_at = ${input.accessTokenExpiresAt ?? null},
        status = 'active',
        updated_at = now()
      WHERE id = ${input.connectionId}
    `;
  }

  async getConnectorCursor(
    connectionId: string,
    scopeKey: string,
  ): Promise<ConnectorCursorRecord | undefined> {
    const rows = await this.sql<ConnectorCursorRecord[]>`
      SELECT storage_connection_id, scope_key, cursor, cursor_kind, last_synced_at
      FROM connector_cursor
      WHERE storage_connection_id = ${connectionId} AND scope_key = ${scopeKey}
      LIMIT 1
    `;
    return rows[0];
  }

  async saveConnectorCursor(input: ConnectorCursorRecord): Promise<void> {
    await this.sql`
      INSERT INTO connector_cursor (id, storage_connection_id, scope_key, cursor, cursor_kind, last_synced_at)
      VALUES (${randomUUID()}, ${input.storageConnectionId}, ${input.scopeKey}, ${input.cursor}, ${input.cursorKind}, now())
      ON CONFLICT (storage_connection_id, scope_key) DO UPDATE SET
        cursor = EXCLUDED.cursor,
        cursor_kind = EXCLUDED.cursor_kind,
        last_synced_at = now(),
        updated_at = now()
    `;
  }

  async applySourceItemChanges(input: {
    workspaceId: string;
    smartSourceId: string;
    upserts: readonly SourceItemWrite[];
    deletedProviderItemIds: readonly string[];
  }): Promise<{
    discoveredCount: number;
    changedCount: number;
    deletedCount: number;
  }> {
    const providerIds = [
      ...new Set([
        ...input.upserts.map((item) => item.providerItemId),
        ...input.deletedProviderItemIds,
      ]),
    ];
    if (providerIds.length === 0)
      return { discoveredCount: 0, changedCount: 0, deletedCount: 0 };

    return this.sql.begin(async (transaction) => {
      const existing = await transaction<SourceItemRecord[]>`
        SELECT id, workspace_id, smart_source_id, provider_item_id, provider_parent_id,
          name, display_path, mime_type, is_folder, size_bytes, modified_at,
          content_hash, provider_etag, web_url, object_key, deleted_at, first_seen_at, last_seen_at
        FROM source_item
        WHERE smart_source_id = ${input.smartSourceId} AND provider_item_id IN ${transaction(providerIds)}
      `;
      const existingByProviderId = new Map(
        existing.map((item) => [item.providerItemId, item]),
      );
      let discoveredCount = 0;
      let changedCount = 0;
      let deletedCount = 0;

      for (const item of input.upserts) {
        const previous = existingByProviderId.get(item.providerItemId);
        const eventKind =
          !previous || previous.deletedAt
            ? "discovered"
            : (previous.contentHash ?? undefined) !== item.contentHash ||
                normalizedTimestamp(
                  previous.modifiedAt as unknown as string | Date | undefined,
                ) !== normalizedTimestamp(item.modifiedAt) ||
                previous.name !== item.name ||
                (previous.providerParentId ?? undefined) !==
                  item.providerParentId
              ? "changed"
              : undefined;
        await transaction`
          INSERT INTO source_item (
            id, workspace_id, smart_source_id, provider_item_id, provider_parent_id,
            name, display_path, mime_type, is_folder, size_bytes, modified_at,
            content_hash, provider_etag, web_url
          ) VALUES (
            ${randomUUID()}, ${item.workspaceId}, ${item.smartSourceId}, ${item.providerItemId}, ${item.providerParentId ?? null},
            ${item.name}, ${item.displayPath}, ${item.mimeType}, ${item.isFolder}, ${item.sizeBytes ?? null},
            ${item.modifiedAt ?? null}, ${item.contentHash ?? null}, ${item.providerEtag ?? null}, ${item.webUrl ?? null}
          )
          ON CONFLICT (smart_source_id, provider_item_id) DO UPDATE SET
            provider_parent_id = EXCLUDED.provider_parent_id, name = EXCLUDED.name,
            display_path = EXCLUDED.display_path, mime_type = EXCLUDED.mime_type,
            is_folder = EXCLUDED.is_folder, size_bytes = EXCLUDED.size_bytes,
            modified_at = EXCLUDED.modified_at, content_hash = EXCLUDED.content_hash,
            provider_etag = EXCLUDED.provider_etag, web_url = EXCLUDED.web_url,
            object_key = CASE WHEN source_item.content_hash = EXCLUDED.content_hash THEN source_item.object_key ELSE NULL END,
            deleted_at = NULL, last_seen_at = now()
        `;
        if (eventKind && !item.isFolder) {
          if (eventKind === "discovered") discoveredCount += 1;
          else changedCount += 1;
          const version =
            item.contentHash ??
            item.modifiedAt ??
            item.providerEtag ??
            item.name;
          await transaction`
            INSERT INTO ingestion_event (
              id, workspace_id, smart_source_id, idempotency_key, event_kind, provider_item_id, metadata
            ) VALUES (
              ${randomUUID()}, ${input.workspaceId}, ${input.smartSourceId},
              ${`${item.providerItemId}:${eventKind}:${version}`}, ${eventKind}, ${item.providerItemId},
              ${transaction.json({ name: item.name, mimeType: item.mimeType, contentHash: item.contentHash })}
            ) ON CONFLICT (smart_source_id, idempotency_key) DO NOTHING
          `;
        }
      }

      for (const providerItemId of input.deletedProviderItemIds) {
        const previous = existingByProviderId.get(providerItemId);
        if (!previous || previous.deletedAt) continue;
        await transaction`
          UPDATE source_item SET deleted_at = now(), last_seen_at = now()
          WHERE smart_source_id = ${input.smartSourceId} AND provider_item_id = ${providerItemId}
        `;
        await transaction`
          INSERT INTO ingestion_event (
            id, workspace_id, smart_source_id, idempotency_key, event_kind, provider_item_id, metadata
          ) VALUES (
            ${randomUUID()}, ${input.workspaceId}, ${input.smartSourceId},
            ${`${providerItemId}:deleted:${previous.modifiedAt ?? previous.contentHash ?? "unknown"}`},
            'deleted', ${providerItemId}, ${transaction.json({ name: previous.name })}
          ) ON CONFLICT (smart_source_id, idempotency_key) DO NOTHING
        `;
        deletedCount += 1;
      }

      return { discoveredCount, changedCount, deletedCount };
    });
  }

  async listSourceItems(
    smartSourceId: string,
  ): Promise<readonly SourceItemRecord[]> {
    return this.sql<SourceItemRecord[]>`
      SELECT id, workspace_id, smart_source_id, provider_item_id, provider_parent_id,
        name, display_path, mime_type, is_folder, size_bytes, modified_at,
        content_hash, provider_etag, web_url, object_key, deleted_at, first_seen_at, last_seen_at
      FROM source_item
      WHERE smart_source_id = ${smartSourceId} AND deleted_at IS NULL
      ORDER BY display_path, name
    `;
  }

  async getSourceItemByProviderId(
    smartSourceId: string,
    providerItemId: string,
  ): Promise<SourceItemRecord | undefined> {
    const rows = await this.sql<SourceItemRecord[]>`
      SELECT id, workspace_id, smart_source_id, provider_item_id, provider_parent_id,
        name, display_path, mime_type, is_folder, size_bytes, modified_at,
        content_hash, provider_etag, web_url, object_key, deleted_at, first_seen_at, last_seen_at
      FROM source_item
      WHERE smart_source_id = ${smartSourceId} AND provider_item_id = ${providerItemId}
      LIMIT 1
    `;
    return rows[0];
  }

  async setLocalSourceObjectKey(input: {
    workspaceId: string;
    smartSourceId: string;
    providerItemId: string;
    contentHash: string;
    objectKey: string;
  }): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE source_item item SET object_key = ${input.objectKey}, last_seen_at = now()
      FROM smart_source source
      WHERE item.smart_source_id = source.id AND item.workspace_id = ${input.workspaceId}
        AND item.smart_source_id = ${input.smartSourceId} AND item.provider_item_id = ${input.providerItemId}
        AND item.content_hash = ${input.contentHash} AND item.deleted_at IS NULL AND item.is_folder = false
        AND source.provider = 'local'
      RETURNING item.id
    `;
    return Boolean(rows[0]);
  }

  async claimIngestionEvents(
    limit: number,
  ): Promise<readonly IngestionWorkItem[]> {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<IngestionWorkItem[]>`
        SELECT e.id, e.workspace_id, e.smart_source_id, s.storage_connection_id,
          e.provider_item_id, e.event_kind, e.attempt_count
        FROM ingestion_event e
        JOIN smart_source s ON s.id = e.smart_source_id
        WHERE (e.status IN ('pending', 'failed') AND e.next_attempt_at <= now())
          OR (e.status = 'processing' AND e.claimed_at < now() - interval '5 minutes')
        ORDER BY e.created_at
        FOR UPDATE OF e SKIP LOCKED
        LIMIT ${Math.max(1, Math.min(limit, 100))}
      `;
      if (rows.length > 0) {
        await transaction`
          UPDATE ingestion_event SET status = 'processing', attempt_count = attempt_count + 1,
            claimed_at = now(), last_error = NULL
          WHERE id IN ${transaction(rows.map((row) => row.id))}
        `;
      }
      return rows.map((row) => ({
        ...row,
        attemptCount: row.attemptCount + 1,
      }));
    });
  }

  async deferIngestionEvent(
    eventId: string,
    retryAt: Date,
    reason: string,
  ): Promise<void> {
    await this.sql`
      UPDATE ingestion_event SET status = 'pending', next_attempt_at = ${retryAt},
        claimed_at = NULL, last_error = ${reason}
      WHERE id = ${eventId}
    `;
  }

  async finishIngestionEvent(input: {
    eventId: string;
    status: "processed" | "ignored" | "failed";
    error?: string;
    retryAt?: Date;
  }): Promise<void> {
    await this.sql`
      UPDATE ingestion_event SET status = ${input.status}, last_error = ${input.error ?? null},
        next_attempt_at = COALESCE(${input.retryAt ?? null}, next_attempt_at),
        processed_at = CASE WHEN ${input.status} IN ('processed', 'ignored') THEN now() ELSE processed_at END,
        claimed_at = NULL
      WHERE id = ${input.eventId}
    `;
  }

  async startConnectorSyncRun(
    connectionId: string,
    smartSourceId: string,
  ): Promise<string> {
    const id = randomUUID();
    await this.sql`
      INSERT INTO connector_sync_run (id, storage_connection_id, smart_source_id, status)
      VALUES (${id}, ${connectionId}, ${smartSourceId}, 'running')
    `;
    return id;
  }

  async finishConnectorSyncRun(input: {
    runId: string;
    status: "completed" | "partial" | "failed";
    discoveredCount: number;
    changedCount: number;
    deletedCount: number;
    errorCode?: string;
  }): Promise<void> {
    await this.sql`
      UPDATE connector_sync_run SET
        status = ${input.status}, discovered_count = ${input.discoveredCount},
        changed_count = ${input.changedCount}, deleted_count = ${input.deletedCount},
        error_code = ${input.errorCode ?? null}, completed_at = now()
      WHERE id = ${input.runId}
    `;
    if (input.status !== "failed") {
      await this.sql`
        UPDATE smart_source SET last_scan_at = now(), updated_at = now()
        WHERE id = (SELECT smart_source_id FROM connector_sync_run WHERE id = ${input.runId})
      `;
    }
  }

  async listWebhookSubscriptionTargets(): Promise<
    readonly WebhookSubscriptionTarget[]
  > {
    return this.sql<WebhookSubscriptionTarget[]>`
      SELECT DISTINCT c.workspace_id, c.id AS storage_connection_id, c.provider,
        CASE
          WHEN c.provider = 'google_drive' THEN 'changes'
          WHEN c.provider = 'onedrive' THEN 'me/drive/root'
          ELSE 'drives/' || split_part(l.provider_location_id, ':', 1) || '/root'
        END AS resource
      FROM storage_connection c
      JOIN smart_source s ON s.storage_connection_id = c.id
      JOIN smart_source_location l ON l.smart_source_id = s.id
      WHERE c.status = 'active' AND s.enabled = true AND s.provider <> 'local'
        AND (c.provider <> 'sharepoint' OR position(':' in l.provider_location_id) > 1)
      ORDER BY storage_connection_id, resource
    `;
  }

  async getWebhookSubscriptionForTarget(
    connectionId: string,
    resource: string,
  ): Promise<WebhookSubscriptionRecord | undefined> {
    const rows = await this.sql<WebhookSubscriptionRecord[]>`
      SELECT w.id, c.workspace_id, w.storage_connection_id, c.provider,
        w.provider_subscription_id, w.provider_resource_id, w.resource,
        w.client_state_hash, w.expires_at, w.status, w.last_notification_at,
        w.renewal_attempt_count, w.last_error
      FROM webhook_subscription w
      JOIN storage_connection c ON c.id = w.storage_connection_id
      WHERE w.storage_connection_id = ${connectionId} AND w.resource = ${resource}
        AND w.status IN ('active', 'renewing', 'error')
      ORDER BY w.expires_at DESC
      LIMIT 1
    `;
    return rows[0];
  }

  async getWebhookSubscriptionByProviderId(
    provider: "google_drive" | "onedrive" | "sharepoint",
    providerSubscriptionId: string,
  ): Promise<WebhookSubscriptionRecord | undefined> {
    const rows = await this.sql<WebhookSubscriptionRecord[]>`
      SELECT w.id, c.workspace_id, w.storage_connection_id, c.provider,
        w.provider_subscription_id, w.provider_resource_id, w.resource,
        w.client_state_hash, w.expires_at, w.status, w.last_notification_at,
        w.renewal_attempt_count, w.last_error
      FROM webhook_subscription w
      JOIN storage_connection c ON c.id = w.storage_connection_id
      WHERE c.provider = ${provider} AND w.provider_subscription_id = ${providerSubscriptionId}
        AND w.status IN ('active', 'renewing', 'error') AND w.expires_at > now()
      LIMIT 1
    `;
    return rows[0];
  }

  async saveWebhookSubscription(input: {
    storageConnectionId: string;
    providerSubscriptionId: string;
    providerResourceId?: string;
    resource: string;
    clientStateHash: string;
    expiresAt: Date;
  }): Promise<string> {
    const id = randomUUID();
    await this.sql`
      INSERT INTO webhook_subscription (
        id, storage_connection_id, provider_subscription_id, provider_resource_id,
        resource, client_state_hash, expires_at, status
      ) VALUES (
        ${id}, ${input.storageConnectionId}, ${input.providerSubscriptionId},
        ${input.providerResourceId ?? null}, ${input.resource}, ${input.clientStateHash},
        ${input.expiresAt}, 'active'
      )
      ON CONFLICT (storage_connection_id, provider_subscription_id) DO UPDATE SET
        provider_resource_id = EXCLUDED.provider_resource_id,
        resource = EXCLUDED.resource,
        client_state_hash = EXCLUDED.client_state_hash,
        expires_at = EXCLUDED.expires_at,
        status = 'active', renewal_attempt_count = 0, last_error = NULL, updated_at = now()
    `;
    return id;
  }

  async updateWebhookSubscription(input: {
    id: string;
    status: WebhookSubscriptionRecord["status"];
    expiresAt?: Date;
    lastError?: string;
    incrementRenewalAttempt?: boolean;
  }): Promise<void> {
    await this.sql`
      UPDATE webhook_subscription SET
        status = ${input.status},
        expires_at = COALESCE(${input.expiresAt ?? null}, expires_at),
        last_error = ${input.lastError ?? null},
        renewal_attempt_count = CASE
          WHEN ${input.status} = 'active' THEN 0
          WHEN ${input.incrementRenewalAttempt ?? false} THEN renewal_attempt_count + 1
          ELSE renewal_attempt_count
        END,
        updated_at = now()
      WHERE id = ${input.id}
    `;
  }

  async enqueueWebhookEvent(input: {
    webhookSubscriptionId: string;
    providerEventId: string;
    eventKind: string;
    payload: Record<string, unknown>;
  }): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO webhook_event (
        id, webhook_subscription_id, provider_event_id, event_kind, payload
      ) VALUES (
        ${randomUUID()}, ${input.webhookSubscriptionId}, ${input.providerEventId},
        ${input.eventKind}, ${this.sql.json(input.payload as JSONValue)}
      )
      ON CONFLICT (webhook_subscription_id, provider_event_id) DO NOTHING
      RETURNING id
    `;
    if (rows[0]) {
      await this.sql`
        UPDATE webhook_subscription SET last_notification_at = now(), updated_at = now()
        WHERE id = ${input.webhookSubscriptionId}
      `;
    }
    return Boolean(rows[0]);
  }

  async claimWebhookEvents(
    limit: number,
  ): Promise<readonly WebhookEventRecord[]> {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<WebhookEventRecord[]>`
        SELECT e.id, e.webhook_subscription_id, w.storage_connection_id,
          c.workspace_id, c.provider, e.provider_event_id, e.event_kind,
          e.payload, e.attempt_count
        FROM webhook_event e
        JOIN webhook_subscription w ON w.id = e.webhook_subscription_id
        JOIN storage_connection c ON c.id = w.storage_connection_id
        WHERE (e.status IN ('pending', 'failed') AND e.next_attempt_at <= now())
          OR (e.status = 'processing' AND e.claimed_at < now() - interval '5 minutes')
        ORDER BY e.received_at
        FOR UPDATE OF e SKIP LOCKED
        LIMIT ${limit}
      `;
      if (rows.length > 0) {
        await transaction`
          UPDATE webhook_event SET status = 'processing', attempt_count = attempt_count + 1,
            claimed_at = now()
          WHERE id IN ${transaction(rows.map((row) => row.id))}
        `;
      }
      return rows.map((row) => ({
        ...row,
        attemptCount: row.attemptCount + 1,
      }));
    });
  }

  async completeWebhookEvent(eventId: string): Promise<void> {
    await this.sql`
      UPDATE webhook_event SET status = 'completed', processed_at = now(), last_error = NULL,
        claimed_at = NULL
      WHERE id = ${eventId}
    `;
  }

  async failWebhookEvent(input: {
    eventId: string;
    error: string;
    retryAt: Date;
    deadLetter: boolean;
  }): Promise<void> {
    await this.sql`
      UPDATE webhook_event SET status = ${input.deadLetter ? "dead_letter" : "failed"},
        last_error = ${input.error}, next_attempt_at = ${input.retryAt},
        processed_at = ${input.deadLetter ? new Date() : null}, claimed_at = NULL
      WHERE id = ${input.eventId}
    `;
  }

  async saveOAuthState(input: {
    stateHash: string;
    workspaceId: string;
    userId: string;
    provider: string;
    codeVerifier: string;
    returnTo: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.sql`
      INSERT INTO oauth_state (state_hash, workspace_id, user_id, provider, code_verifier, return_to, expires_at)
      VALUES (${input.stateHash}, ${input.workspaceId}, ${input.userId}, ${input.provider}, ${input.codeVerifier}, ${input.returnTo}, ${input.expiresAt})
    `;
  }

  async consumeOAuthState(stateHash: string): Promise<
    | {
        workspaceId: string;
        userId: string;
        provider: "google_drive" | "onedrive" | "sharepoint";
        codeVerifier: string;
        returnTo: string;
      }
    | undefined
  > {
    return this.sql.begin(async (transaction) => {
      const rows = await transaction<
        {
          workspaceId: string;
          userId: string;
          provider: "google_drive" | "onedrive" | "sharepoint";
          codeVerifier: string;
          returnTo: string;
        }[]
      >`
        DELETE FROM oauth_state
        WHERE state_hash = ${stateHash} AND expires_at > now()
        RETURNING workspace_id, user_id, provider, code_verifier, return_to
      `;
      return rows[0];
    });
  }

  async saveStorageConnection(input: {
    workspaceId: string;
    provider: "google_drive" | "onedrive" | "sharepoint";
    displayName: string;
    providerAccountId?: string;
    encryptedAccessToken: string;
    encryptedRefreshToken?: string;
    scopes: readonly string[];
    accessTokenExpiresAt?: Date;
    createdBy: string;
  }): Promise<string> {
    const id = randomUUID();
    await this.sql`
      INSERT INTO storage_connection (
        id, workspace_id, provider, provider_account_id, display_name,
        encrypted_access_token, encrypted_refresh_token, scopes, access_token_expires_at, created_by
      ) VALUES (
        ${id}, ${input.workspaceId}, ${input.provider}, ${input.providerAccountId ?? null}, ${input.displayName},
        ${input.encryptedAccessToken}, ${input.encryptedRefreshToken ?? null}, ${[...input.scopes]},
        ${input.accessTokenExpiresAt ?? null}, ${input.createdBy}
      )
    `;
    return id;
  }

  async listContextPacks(
    workspaceId: string,
  ): Promise<readonly StoredContextPack[]> {
    const rows = await this.sql<ContextPackRow[]>`
      SELECT id, workspace_id, name, description, status, current_version_id,
        created_by, created_at, updated_at
      FROM context_pack
      WHERE workspace_id = ${workspaceId}
      ORDER BY updated_at DESC, name
    `;
    return this.attachContextPackVersions(rows);
  }

  async getContextPack(
    workspaceId: string,
    contextPackId: string,
  ): Promise<StoredContextPack | undefined> {
    const rows = await this.sql<ContextPackRow[]>`
      SELECT id, workspace_id, name, description, status, current_version_id,
        created_by, created_at, updated_at
      FROM context_pack
      WHERE workspace_id = ${workspaceId} AND id = ${contextPackId}
      LIMIT 1
    `;
    return (await this.attachContextPackVersions(rows))[0];
  }

  async createContextPack(
    input: ContextPackDraftWrite,
    actorUserId: string,
  ): Promise<StoredContextPack> {
    const packId = randomUUID();
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO context_pack (id, workspace_id, name, description, created_by)
        VALUES (${packId}, ${input.workspaceId}, ${input.name}, ${input.description}, ${actorUserId})
      `;
      const versionId = randomUUID();
      await transaction`
        INSERT INTO context_pack_version (
          id, context_pack_id, version_number, status, instructions, authority_rules, created_by
        ) VALUES (
          ${versionId}, ${packId}, 1, 'draft', ${input.instructions},
          ${transaction.json(input.authorityRules as unknown as JSONValue)}, ${actorUserId}
        )
      `;
      await this.replaceContextVersionContent(
        transaction,
        input.workspaceId,
        versionId,
        input,
      );
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'context_pack.created',
          'context_pack', ${packId}, ${transaction.json({ versionNumber: 1 })}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
    });
    return (await this.getContextPack(input.workspaceId, packId))!;
  }

  async saveContextPackDraft(
    contextPackId: string,
    input: ContextPackDraftWrite,
    actorUserId: string,
  ): Promise<StoredContextPack | undefined> {
    const saved = await this.sql.begin(async (transaction) => {
      const packs = await transaction<{ id: string }[]>`
        SELECT id FROM context_pack
        WHERE id = ${contextPackId} AND workspace_id = ${input.workspaceId}
        FOR UPDATE
      `;
      if (!packs[0]) return false;
      const drafts = await transaction<{ id: string; versionNumber: number }[]>`
        SELECT id, version_number FROM context_pack_version
        WHERE context_pack_id = ${contextPackId} AND status = 'draft'
        LIMIT 1
      `;
      let draftId = drafts[0]?.id;
      let draftVersionNumber = drafts[0]?.versionNumber;
      if (!drafts[0]) {
        const versions = await transaction<{ nextVersion: number }[]>`
          SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
          FROM context_pack_version WHERE context_pack_id = ${contextPackId}
        `;
        draftId = randomUUID();
        draftVersionNumber = versions[0].nextVersion;
        await transaction`
          INSERT INTO context_pack_version (
            id, context_pack_id, version_number, status, instructions, authority_rules, created_by
          ) VALUES (
            ${draftId}, ${contextPackId}, ${draftVersionNumber}, 'draft', '', '[]'::jsonb, ${actorUserId}
          )
        `;
      }
      await transaction`
        UPDATE context_pack SET name = ${input.name}, description = ${input.description},
          status = CASE WHEN current_version_id IS NULL THEN 'draft' ELSE status END,
          updated_at = now()
        WHERE id = ${contextPackId}
      `;
      await transaction`
        UPDATE context_pack_version SET instructions = ${input.instructions},
          authority_rules = ${transaction.json(input.authorityRules as unknown as JSONValue)}
        WHERE id = ${draftId!}
      `;
      await this.replaceContextVersionContent(
        transaction,
        input.workspaceId,
        draftId!,
        input,
      );
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'context_pack.draft_saved',
          'context_pack', ${contextPackId}, ${transaction.json({ versionNumber: draftVersionNumber! })}
        FROM workspace WHERE id = ${input.workspaceId}
      `;
      return true;
    });
    return saved
      ? this.getContextPack(input.workspaceId, contextPackId)
      : undefined;
  }

  async publishContextPack(
    workspaceId: string,
    contextPackId: string,
    actorUserId: string,
  ): Promise<StoredContextPack | undefined> {
    const published = await this.sql.begin(async (transaction) => {
      const packs = await transaction<
        { id: string; currentVersionId?: string }[]
      >`
        SELECT id, current_version_id FROM context_pack
        WHERE id = ${contextPackId} AND workspace_id = ${workspaceId}
        FOR UPDATE
      `;
      if (!packs[0]) return false;
      const drafts = await transaction<{ id: string; versionNumber: number }[]>`
        SELECT id, version_number FROM context_pack_version
        WHERE context_pack_id = ${contextPackId} AND status = 'draft'
        LIMIT 1
      `;
      if (!drafts[0])
        throw new Error("Context Pack does not have a draft to publish");
      const sourceCount = await transaction<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM context_pack_source
        WHERE context_pack_version_id = ${drafts[0].id}
      `;
      if (sourceCount[0].count === 0)
        throw new Error(
          "Context Pack requires at least one source before publishing",
        );
      if (packs[0].currentVersionId) {
        await transaction`
          UPDATE context_pack_version SET status = 'superseded'
          WHERE id = ${packs[0].currentVersionId} AND status = 'published'
        `;
      }
      await transaction`
        UPDATE context_pack_version SET status = 'published', published_at = now()
        WHERE id = ${drafts[0].id}
      `;
      await transaction`
        UPDATE context_pack SET current_version_id = ${drafts[0].id}, status = 'published', updated_at = now()
        WHERE id = ${contextPackId}
      `;
      await transaction`
        INSERT INTO audit_event (
          id, organization_id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data
        ) SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, 'context_pack.published',
          'context_pack', ${contextPackId}, ${transaction.json({ versionNumber: drafts[0].versionNumber })}
        FROM workspace WHERE id = ${workspaceId}
      `;
      return true;
    });
    return published
      ? this.getContextPack(workspaceId, contextPackId)
      : undefined;
  }

  async listContentPackages(
    workspaceId: string,
  ): Promise<readonly StoredContentPackage[]> {
    const rows = await this.sql<ContentPackageRow[]>`
      SELECT id, workspace_id, smart_source_id, root_source_item_id, title, status,
        confidence, context_pack_version_ids, version, created_at, updated_at
      FROM content_package WHERE workspace_id = ${workspaceId}
      ORDER BY updated_at DESC
    `;
    return this.attachContentPackageDetails(rows);
  }

  async getContentPackage(
    workspaceId: string,
    packageId: string,
  ): Promise<StoredContentPackage | undefined> {
    const rows = await this.sql<ContentPackageRow[]>`
      SELECT id, workspace_id, smart_source_id, root_source_item_id, title, status,
        confidence, context_pack_version_ids, version, created_at, updated_at
      FROM content_package WHERE workspace_id = ${workspaceId} AND id = ${packageId}
      LIMIT 1
    `;
    return (await this.attachContentPackageDetails(rows))[0];
  }

  async saveContentPackage(
    input: ContentPackageWrite,
  ): Promise<StoredContentPackage> {
    const packageId = await this.sql.begin(async (transaction) => {
      const existing = await transaction<{ id: string }[]>`
        SELECT id FROM content_package
        WHERE smart_source_id = ${input.smartSourceId} AND root_source_item_id = ${input.rootSourceItemId}
        FOR UPDATE
      `;
      const id = existing[0]?.id ?? randomUUID();
      await transaction`
        INSERT INTO content_package (
          id, workspace_id, smart_source_id, root_source_item_id, title, status,
          confidence, context_pack_version_ids
        ) VALUES (
          ${id}, ${input.workspaceId}, ${input.smartSourceId}, ${input.rootSourceItemId},
          ${input.title}, ${input.status}, ${input.confidence ?? null}, ${[...input.contextPackVersionIds]}
        ) ON CONFLICT (smart_source_id, root_source_item_id) DO UPDATE SET
          title = EXCLUDED.title, status = EXCLUDED.status, confidence = EXCLUDED.confidence,
          context_pack_version_ids = EXCLUDED.context_pack_version_ids,
          version = content_package.version + 1, updated_at = now()
      `;
      await transaction`DELETE FROM content_asset WHERE content_package_id = ${id}`;
      await transaction`DELETE FROM evidence_conflict WHERE content_package_id = ${id}`;
      await transaction`DELETE FROM evidence_item WHERE content_package_id = ${id}`;
      const preparedAssets = input.assets.map((asset) => ({
        asset,
        clientKey: asset.clientKey ?? randomUUID(),
      }));
      const assetIds = new Map(
        preparedAssets.map(({ clientKey }) => [clientKey, randomUUID()]),
      );
      const orderedAssets = preparedAssets.sort(
        (left, right) =>
          Number(Boolean(left.asset.sourceAssetClientKey)) -
          Number(Boolean(right.asset.sourceAssetClientKey)),
      );
      for (const { asset, clientKey } of orderedAssets) {
        const sourceAssetId = asset.sourceAssetClientKey
          ? assetIds.get(asset.sourceAssetClientKey)
          : undefined;
        if (asset.sourceAssetClientKey && !sourceAssetId)
          throw new Error(
            "Derivative references an unknown source asset client key",
          );
        await transaction`
          INSERT INTO content_asset (
            id, content_package_id, source_item_id, role, file_name, mime_type,
            content_hash, source_asset_id, object_key, byte_size, processing_version,
            recipe, media_status, scan_status, scan_engine, scan_scanned_at, scan_revision,
            rights_status, alt_text, alt_text_status,
            accessibility_notes, extracted_text, extraction_status, extraction_error, metadata
          ) VALUES (
            ${assetIds.get(clientKey)!}, ${id}, ${asset.sourceItemId ?? null}, ${asset.role},
            ${asset.fileName}, ${asset.mimeType}, ${asset.contentHash},
            ${sourceAssetId ?? null}, ${asset.objectKey ?? null}, ${asset.byteSize ?? null},
            ${asset.processingVersion ?? null}, ${transaction.json((asset.recipe ?? {}) as JSONValue)},
            ${asset.mediaStatus ?? "unsupported"}, ${asset.scanStatus ?? "not_configured"},
            ${asset.scanEngine ?? null}, ${asset.scanScannedAt ?? null}, ${asset.scanRevision ?? 0},
            ${asset.rightsStatus ?? "unchecked"}, ${asset.altText ?? null},
            ${asset.altTextStatus ?? "not_applicable"}, ${asset.accessibilityNotes ?? null},
            ${asset.extractedText ?? null}, ${asset.extractionStatus}, ${asset.extractionError ?? null},
            ${transaction.json(asset.metadata as JSONValue)}
          )
        `;
      }
      for (const evidence of input.evidence) {
        await transaction`
          INSERT INTO evidence_item (
            id, content_package_id, fact_key, claim, provenance, source_references,
            confidence, context_pack_version_id
          ) VALUES (
            ${evidence.id}, ${id}, ${evidence.factKey ?? null}, ${evidence.claim}, ${evidence.provenance},
            ${[...evidence.sourceReferences]}, ${evidence.confidence ?? null}, ${evidence.contextPackVersionId ?? null}
          )
        `;
      }
      for (const conflict of input.conflicts) {
        await transaction`
          INSERT INTO evidence_conflict (
            id, content_package_id, fact_key, candidate_evidence_ids, status
          ) VALUES (${randomUUID()}, ${id}, ${conflict.factKey}, ${[...conflict.candidateEvidenceIds]}, 'open')
        `;
      }
      return id;
    });
    return (await this.getContentPackage(input.workspaceId, packageId))!;
  }

  async getContentAssetForAccess(
    assetId: string,
  ): Promise<StoredContentAssetForAccess | undefined> {
    const rows = await this.sql<StoredContentAssetForAccess[]>`
      SELECT id, content_package_id, object_key, mime_type, file_name, byte_size::integer AS byte_size
      FROM content_asset
      WHERE id = ${assetId} AND object_key IS NOT NULL
      LIMIT 1
    `;
    return rows[0];
  }

  async updateAssetAccessibility(input: {
    workspaceId: string;
    packageId: string;
    assetId: string;
    altText?: string;
    decorative: boolean;
    notes?: string;
    actorUserId: string;
  }): Promise<StoredContentPackage | undefined> {
    const altText = input.altText?.trim();
    if (!input.decorative && !altText)
      throw new Error("Informative images require reviewed alternative text");
    const rows = await this.sql<{ id: string }[]>`
      UPDATE content_asset a SET
        alt_text = ${input.decorative ? null : altText!},
        alt_text_status = ${input.decorative ? "decorative" : "approved"},
        accessibility_notes = ${input.notes?.trim() || null}
      FROM content_package p
      WHERE a.id = ${input.assetId} AND a.content_package_id = p.id
        AND p.id = ${input.packageId} AND p.workspace_id = ${input.workspaceId}
        AND a.role = 'original' AND a.mime_type LIKE 'image/%'
      RETURNING a.id
    `;
    if (!rows[0]) return undefined;
    await this.sql`
      INSERT INTO audit_event (id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data)
      VALUES (${randomUUID()}, ${input.workspaceId}, ${input.actorUserId}, 'content_asset.accessibility_updated',
        'content_asset', ${input.assetId}, ${this.sql.json({ decorative: input.decorative, altTextLength: altText?.length ?? 0 } as JSONValue)})
    `;
    return this.getContentPackage(input.workspaceId, input.packageId);
  }

  async reviewAssetRights(
    input: ContentAssetRightsReviewWrite,
    actorUserId: string,
  ): Promise<StoredContentPackage | undefined> {
    const owner = input.owner.trim();
    const sourceReference = input.sourceReference.trim();
    const proofReference = input.proofReference.trim();
    const reviewNote = input.reviewNote.trim();
    const attributionRequirement =
      input.attributionRequirement?.trim() || undefined;
    const watermarkRequirement =
      input.watermarkRequirement?.trim() || undefined;
    const disclaimerRequirement =
      input.disclaimerRequirement?.trim() || undefined;
    const permittedChannels = [...new Set(input.permittedChannels)];
    const permittedChannelConnectionIds = [
      ...new Set(input.permittedChannelConnectionIds),
    ];
    const permittedCampaignIds = [...new Set(input.permittedCampaignIds)];
    const permittedBrandProfileIds = [
      ...new Set(input.permittedBrandProfileIds),
    ];
    const validFrom = input.validFrom ? new Date(input.validFrom) : undefined;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
    const now = new Date();
    if (
      !owner ||
      sourceReference.length < 3 ||
      proofReference.length < 3 ||
      reviewNote.length < 3
    )
      throw new Error("Asset rights review evidence is incomplete");
    if (validFrom && Number.isNaN(validFrom.getTime()))
      throw new Error("Asset rights valid-from time is invalid");
    if (expiresAt && Number.isNaN(expiresAt.getTime()))
      throw new Error("Asset rights expiration time is invalid");
    if (validFrom && expiresAt && expiresAt <= validFrom)
      throw new Error(
        "Asset rights expiration must follow its valid-from time",
      );
    if (
      input.status === "cleared" &&
      (!input.commercialUseAllowed ||
        !input.derivativeUseAllowed ||
        !input.worldwideUseAllowed ||
        !permittedChannels.includes("discord_webhook") ||
        permittedChannelConnectionIds.length === 0 ||
        attributionRequirement ||
        watermarkRequirement ||
        disclaimerRequirement ||
        (validFrom && validFrom > now) ||
        (expiresAt && expiresAt <= now))
    )
      throw new Error(
        "Cleared rights require current worldwide commercial and derivative permission for at least one exact Discord Channel Connection with no unsatisfied attribution, watermark, or disclaimer requirement",
      );

    const updated = await this.sql.begin(async (transaction) => {
      const permittedConnections = permittedChannelConnectionIds.length
        ? await transaction<{ id: string }[]>`
            SELECT id FROM channel_connection
            WHERE workspace_id = ${input.workspaceId}
              AND id IN ${transaction(permittedChannelConnectionIds)}
              AND provider = ANY(${permittedChannels})
          `
        : [];
      if (permittedConnections.length !== permittedChannelConnectionIds.length)
        throw new Error(
          "Every permitted Channel Connection must belong to this workspace and match a permitted provider",
        );
      const permittedCampaigns = permittedCampaignIds.length
        ? await transaction<{ id: string }[]>`
            SELECT id FROM campaign
            WHERE workspace_id = ${input.workspaceId}
              AND id IN ${transaction(permittedCampaignIds)}
          `
        : [];
      if (permittedCampaigns.length !== permittedCampaignIds.length)
        throw new Error(
          "Every permitted Campaign must belong to this workspace",
        );
      const permittedBrandProfiles = permittedBrandProfileIds.length
        ? await transaction<{ id: string }[]>`
            SELECT id FROM brand_profile
            WHERE workspace_id = ${input.workspaceId}
              AND id IN ${transaction(permittedBrandProfileIds)}
          `
        : [];
      if (permittedBrandProfiles.length !== permittedBrandProfileIds.length)
        throw new Error(
          "Every permitted Brand Profile must belong to this workspace",
        );
      const rows = await transaction<{ id: string; rightsRevision: number }[]>`
        UPDATE content_asset asset SET
          rights_status = ${input.status},
          rights_owner = ${owner},
          rights_license_owner = ${input.licenseOwner?.trim() || null},
          rights_source_reference = ${sourceReference},
          rights_proof_reference = ${proofReference},
          rights_commercial_use_allowed = ${input.commercialUseAllowed},
          rights_derivative_use_allowed = ${input.derivativeUseAllowed},
          rights_worldwide_use_allowed = ${input.worldwideUseAllowed},
          rights_permitted_channels = ${permittedChannels},
          rights_valid_from = ${validFrom ?? null},
          rights_expires_at = ${expiresAt ?? null},
          rights_attribution_requirement = ${attributionRequirement ?? null},
          rights_watermark_requirement = ${watermarkRequirement ?? null},
          rights_disclaimer_requirement = ${disclaimerRequirement ?? null},
          rights_review_note = ${reviewNote},
          rights_reviewed_by = ${actorUserId},
          rights_reviewed_at = now(),
          rights_revision = asset.rights_revision + 1
        FROM content_package package, workspace_membership membership
        WHERE asset.id = ${input.assetId}
          AND asset.content_package_id = package.id
          AND package.id = ${input.packageId}
          AND package.workspace_id = ${input.workspaceId}
          AND membership.workspace_id = package.workspace_id
          AND membership.user_id = ${actorUserId}
          AND membership.role IN ('owner', 'admin', 'editor')
          AND asset.role = 'original'
          AND asset.mime_type LIKE 'image/%'
        RETURNING asset.id, asset.rights_revision
      `;
      if (!rows[0]) return undefined;
      await transaction`
        DELETE FROM content_asset_rights_channel_connection
        WHERE content_asset_id = ${input.assetId}
      `;
      for (const channelConnectionId of permittedChannelConnectionIds) {
        await transaction`
          INSERT INTO content_asset_rights_channel_connection (
            content_asset_id, channel_connection_id
          ) VALUES (${input.assetId}, ${channelConnectionId})
        `;
      }
      await transaction`
        DELETE FROM content_asset_rights_campaign
        WHERE content_asset_id = ${input.assetId}
      `;
      for (const campaignId of permittedCampaignIds) {
        await transaction`
          INSERT INTO content_asset_rights_campaign (content_asset_id, campaign_id)
          VALUES (${input.assetId}, ${campaignId})
        `;
      }
      await transaction`
        DELETE FROM content_asset_rights_brand_profile
        WHERE content_asset_id = ${input.assetId}
      `;
      for (const brandProfileId of permittedBrandProfileIds) {
        await transaction`
          INSERT INTO content_asset_rights_brand_profile (
            content_asset_id, brand_profile_id
          ) VALUES (${input.assetId}, ${brandProfileId})
        `;
      }
      await transaction`
        INSERT INTO audit_event (
          id, workspace_id, actor_user_id, event_type, subject_type, subject_id, data
        ) VALUES (
          ${randomUUID()}, ${input.workspaceId}, ${actorUserId},
          'content_asset.rights_reviewed', 'content_asset', ${input.assetId},
          ${transaction.json({
            status: input.status,
            rightsRevision: rows[0].rightsRevision,
            commercialUseAllowed: input.commercialUseAllowed,
            derivativeUseAllowed: input.derivativeUseAllowed,
            worldwideUseAllowed: input.worldwideUseAllowed,
            permittedChannelCount: permittedChannels.length,
            permittedChannelConnectionCount:
              permittedChannelConnectionIds.length,
            permittedCampaignCount: permittedCampaignIds.length,
            permittedBrandProfileCount: permittedBrandProfileIds.length,
            hasExpiration: Boolean(expiresAt),
            hasOutstandingRequirements: Boolean(
              attributionRequirement ||
              watermarkRequirement ||
              disclaimerRequirement,
            ),
          } as JSONValue)}
        )
      `;
      return rows[0].id;
    });
    return updated
      ? this.getContentPackage(input.workspaceId, input.packageId)
      : undefined;
  }

  async resolveEvidenceConflict(input: {
    workspaceId: string;
    packageId: string;
    conflictId: string;
    evidenceId: string;
    note?: string;
    actorUserId: string;
  }): Promise<StoredContentPackage | undefined> {
    const resolved = await this.sql.begin(async (transaction) => {
      const rows = await transaction<
        { conflictId: string; evidenceId: string }[]
      >`
        SELECT c.id AS conflict_id, e.id AS evidence_id
        FROM evidence_conflict c
        JOIN content_package p ON p.id = c.content_package_id
        JOIN evidence_item e ON e.content_package_id = p.id AND e.id = ${input.evidenceId}
        WHERE c.id = ${input.conflictId} AND p.id = ${input.packageId}
          AND p.workspace_id = ${input.workspaceId}
          AND ${input.evidenceId} = ANY(c.candidate_evidence_ids)
        FOR UPDATE OF c, p
      `;
      if (!rows[0]) return false;
      await transaction`
        UPDATE evidence_conflict SET status = 'resolved', resolution_evidence_id = ${input.evidenceId},
          resolution_note = ${input.note ?? null}, resolved_at = now()
        WHERE id = ${input.conflictId}
      `;
      await transaction`
        INSERT INTO learning_review (
          id, workspace_id, content_package_id, evidence_item_id, actor_user_id,
          action, notes
        ) VALUES (
          ${randomUUID()}, ${input.workspaceId}, ${input.packageId}, ${input.evidenceId},
          ${input.actorUserId}, 'conflict_resolved', ${input.note ?? null}
        )
      `;
      const open = await transaction<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM evidence_conflict
        WHERE content_package_id = ${input.packageId} AND status = 'open'
      `;
      const unresolved = await transaction<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM evidence_item
        WHERE content_package_id = ${input.packageId} AND provenance = 'unresolved'
          AND superseded_by_evidence_id IS NULL
      `;
      if (open[0].count === 0 && unresolved[0].count === 0) {
        await transaction`UPDATE content_package SET status = 'ready', updated_at = now() WHERE id = ${input.packageId}`;
      }
      return true;
    });
    return resolved
      ? this.getContentPackage(input.workspaceId, input.packageId)
      : undefined;
  }

  async approveContentPackage(input: {
    workspaceId: string;
    packageId: string;
    actorUserId: string;
  }): Promise<StoredContentPackage | undefined> {
    const rows = await this.sql<{ id: string }[]>`
      UPDATE content_package p SET status = 'approved', updated_at = now()
      WHERE p.id = ${input.packageId} AND p.workspace_id = ${input.workspaceId}
        AND p.status IN ('ready', 'needs_review')
        AND NOT EXISTS (SELECT 1 FROM evidence_conflict c WHERE c.content_package_id = p.id AND c.status = 'open')
        AND NOT EXISTS (SELECT 1 FROM evidence_item e WHERE e.content_package_id = p.id AND e.provenance = 'unresolved' AND e.superseded_by_evidence_id IS NULL)
        AND NOT EXISTS (SELECT 1 FROM content_asset a WHERE a.content_package_id = p.id AND a.alt_text_status = 'needs_review')
        AND NOT EXISTS (
          SELECT 1 FROM content_asset asset
          WHERE asset.content_package_id = p.id
            AND asset.role = 'original'
            AND asset.mime_type LIKE 'image/%'
            AND (asset.scan_status <> 'clean' OR asset.scan_engine IS NULL OR asset.scan_scanned_at IS NULL OR asset.scan_revision < 1)
        )
        AND NOT EXISTS (
          SELECT 1 FROM content_asset asset
          WHERE asset.content_package_id = p.id
            AND asset.role = 'original'
            AND asset.mime_type LIKE 'image/%'
            AND (
              asset.rights_status <> 'cleared'
              OR NOT EXISTS (
                SELECT 1 FROM content_asset_rights_channel_connection scope
                WHERE scope.content_asset_id = asset.id
              )
              OR (asset.rights_valid_from IS NOT NULL AND asset.rights_valid_from > now())
              OR (asset.rights_expires_at IS NOT NULL AND asset.rights_expires_at <= now())
            )
        )
      RETURNING id
    `;
    if (!rows[0]) return undefined;
    await this.sql`
      INSERT INTO learning_review (
        id, workspace_id, content_package_id, actor_user_id, action
      ) VALUES (${randomUUID()}, ${input.workspaceId}, ${input.packageId}, ${input.actorUserId}, 'package_approved')
    `;
    return this.getContentPackage(input.workspaceId, input.packageId);
  }

  async resolveUnresolvedEvidence(input: {
    workspaceId: string;
    packageId: string;
    evidenceId: string;
    correctedClaim: string;
    note?: string;
    actorUserId: string;
  }): Promise<StoredContentPackage | undefined> {
    const correctedId = randomUUID();
    const reviewId = randomUUID();
    const resolved = await this.sql.begin(async (transaction) => {
      const rows = await transaction<{ claim: string; factKey?: string }[]>`
        SELECT e.claim, e.fact_key FROM evidence_item e
        JOIN content_package p ON p.id = e.content_package_id
        WHERE e.id = ${input.evidenceId} AND p.id = ${input.packageId}
          AND p.workspace_id = ${input.workspaceId} AND e.provenance = 'unresolved'
          AND e.superseded_by_evidence_id IS NULL
        FOR UPDATE OF e, p
      `;
      if (!rows[0]) return false;
      await transaction`
        INSERT INTO evidence_item (
          id, content_package_id, fact_key, claim, provenance, source_references, confidence
        ) VALUES (
          ${correctedId}, ${input.packageId}, ${rows[0].factKey ?? null}, ${input.correctedClaim},
          'authoritative_context', ${[`learning-review:${reviewId}`]}, 1
        )
      `;
      await transaction`UPDATE evidence_item SET superseded_by_evidence_id = ${correctedId} WHERE id = ${input.evidenceId}`;
      await transaction`
        INSERT INTO learning_review (
          id, workspace_id, content_package_id, evidence_item_id, actor_user_id,
          action, original_claim, corrected_claim, notes
        ) VALUES (
          ${reviewId}, ${input.workspaceId}, ${input.packageId}, ${input.evidenceId},
          ${input.actorUserId}, 'corrected', ${rows[0].claim}, ${input.correctedClaim}, ${input.note ?? null}
        )
      `;
      const blockers = await transaction<{ count: number }[]>`
        SELECT
          (SELECT count(*) FROM evidence_conflict WHERE content_package_id = ${input.packageId} AND status = 'open') +
          (SELECT count(*) FROM evidence_item WHERE content_package_id = ${input.packageId} AND provenance = 'unresolved' AND superseded_by_evidence_id IS NULL)
          AS count
      `;
      if (Number(blockers[0].count) === 0) {
        await transaction`UPDATE content_package SET status = 'ready', updated_at = now() WHERE id = ${input.packageId}`;
      }
      return true;
    });
    return resolved
      ? this.getContentPackage(input.workspaceId, input.packageId)
      : undefined;
  }

  private async replaceContextVersionContent(
    transaction: TransactionSql,
    workspaceId: string,
    versionId: string,
    input: ContextPackDraftWrite,
  ): Promise<void> {
    await transaction`DELETE FROM context_pack_fact WHERE context_pack_version_id = ${versionId}`;
    await transaction`DELETE FROM context_pack_source WHERE context_pack_version_id = ${versionId}`;
    const sourceIds = new Map<string, string>();
    for (const source of input.sources) {
      if (source.sourceItemId) {
        const items = await transaction<{ id: string }[]>`
          SELECT id FROM source_item WHERE id = ${source.sourceItemId} AND workspace_id = ${workspaceId}
        `;
        if (!items[0])
          throw new Error(
            "Context Pack source item does not belong to the workspace",
          );
      }
      const sourceId = source.clientKey;
      sourceIds.set(source.clientKey, sourceId);
      await transaction`
        INSERT INTO context_pack_source (
          id, context_pack_version_id, source_kind, source_item_id, label,
          source_reference, selected_sections, authority_rank, content_text, content_hash
        ) VALUES (
          ${sourceId}, ${versionId}, ${source.kind}, ${source.sourceItemId ?? null},
          ${source.label}, ${source.sourceReference}, ${[...source.selectedSections]},
          ${source.authorityRank}, ${source.contentText ?? null}, ${source.contentHash ?? null}
        )
      `;
    }
    for (const fact of input.facts) {
      const sourceId = fact.sourceClientKey
        ? sourceIds.get(fact.sourceClientKey)
        : undefined;
      if (fact.sourceClientKey && !sourceId)
        throw new Error("Context Pack fact references an unknown source");
      await transaction`
        INSERT INTO context_pack_fact (
          id, context_pack_version_id, fact_key, value_json, source_id,
          confidence, status, notes
        ) VALUES (
          ${randomUUID()}, ${versionId}, ${fact.factKey},
          ${transaction.json(fact.value as JSONValue)}, ${sourceId ?? null},
          ${fact.confidence ?? null}, ${fact.status}, ${fact.notes ?? null}
        )
      `;
    }
  }

  private async requirePublishedContextPacks(
    transaction: TransactionSql,
    workspaceId: string,
    contextPackIds: readonly string[],
  ): Promise<void> {
    if (contextPackIds.length === 0) return;
    const uniqueIds = [...new Set(contextPackIds)];
    const packs = await transaction<{ id: string }[]>`
      SELECT id FROM context_pack
      WHERE workspace_id = ${workspaceId} AND status = 'published' AND id IN ${transaction(uniqueIds)}
    `;
    if (packs.length !== uniqueIds.length) {
      throw new Error(
        "Every Context Pack must be published and belong to the Smart Source workspace",
      );
    }
  }

  private async attachContextPackVersions(
    rows: readonly ContextPackRow[],
  ): Promise<StoredContextPack[]> {
    if (rows.length === 0) return [];
    const packIds = rows.map((row) => row.id);
    const currentVersionIds = rows.flatMap((row) =>
      row.currentVersionId ? [row.currentVersionId] : [],
    );
    const versions =
      currentVersionIds.length > 0
        ? await this.sql<ContextPackVersionRow[]>`
          SELECT id, context_pack_id, version_number, status, instructions,
            authority_rules, created_at, published_at
          FROM context_pack_version
          WHERE context_pack_id IN ${this.sql(packIds)}
            AND (status = 'draft' OR id IN ${this.sql(currentVersionIds)})
          ORDER BY version_number DESC
        `
        : await this.sql<ContextPackVersionRow[]>`
          SELECT id, context_pack_id, version_number, status, instructions,
            authority_rules, created_at, published_at
          FROM context_pack_version
          WHERE context_pack_id IN ${this.sql(packIds)} AND status = 'draft'
          ORDER BY version_number DESC
        `;
    const versionIds = versions.map((version) => version.id);
    const sources =
      versionIds.length === 0
        ? []
        : await this.sql<
            (ContextPackSource & { contextPackVersionId: string })[]
          >`
      SELECT id, context_pack_version_id, source_kind AS kind, source_item_id, label, source_reference,
        selected_sections, authority_rank, content_hash, content_text
      FROM context_pack_source WHERE context_pack_version_id IN ${this.sql(versionIds)}
      ORDER BY authority_rank DESC, created_at
    `;
    const facts =
      versionIds.length === 0
        ? []
        : await this.sql<
            (ContextPackFact & { contextPackVersionId: string })[]
          >`
      SELECT id, context_pack_version_id, fact_key, value_json AS value, source_id,
        confidence, status, notes
      FROM context_pack_fact WHERE context_pack_version_id IN ${this.sql(versionIds)}
      ORDER BY fact_key, created_at
    `;
    const hydrated = versions.map((version) => ({
      ...version,
      sources: sources.filter(
        (source) => source.contextPackVersionId === version.id,
      ),
      facts: facts.filter((fact) => fact.contextPackVersionId === version.id),
    }));
    return rows.map(({ currentVersionId, ...row }) => ({
      ...row,
      currentVersion: hydrated.find(
        (version) => version.id === currentVersionId,
      ),
      draftVersion: hydrated.find(
        (version) =>
          version.contextPackId === row.id && version.status === "draft",
      ),
    }));
  }

  private async attachContentPackageDetails(
    rows: readonly ContentPackageRow[],
  ): Promise<StoredContentPackage[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const assets = await this.sql<
      (StoredContentPackage["assets"][number] & { contentPackageId: string })[]
    >`
      SELECT asset.id, asset.content_package_id, asset.source_item_id, asset.role,
        asset.file_name, asset.mime_type, asset.content_hash, asset.source_asset_id,
        asset.object_key, asset.byte_size::integer AS byte_size, asset.processing_version,
        asset.recipe, asset.media_status, asset.scan_status, asset.scan_engine, asset.scan_scanned_at, asset.scan_revision,
        CASE
          WHEN effective.rights_status = 'cleared'
            AND effective.rights_valid_from IS NOT NULL
            AND effective.rights_valid_from > now() THEN 'restricted'
          WHEN effective.rights_status = 'cleared'
            AND effective.rights_expires_at IS NOT NULL
            AND effective.rights_expires_at <= now() THEN 'expired'
          ELSE effective.rights_status
        END AS rights_status,
        effective.rights_owner, effective.rights_license_owner,
        effective.rights_source_reference, effective.rights_proof_reference,
        effective.rights_commercial_use_allowed,
        effective.rights_derivative_use_allowed,
        effective.rights_worldwide_use_allowed,
        effective.rights_permitted_channels,
        ARRAY(
          SELECT scope.channel_connection_id::text
          FROM content_asset_rights_channel_connection scope
          WHERE scope.content_asset_id = effective.rights_source_asset_id
          ORDER BY scope.channel_connection_id
        ) AS rights_permitted_channel_connection_ids,
        ARRAY(
          SELECT scope.campaign_id::text
          FROM content_asset_rights_campaign scope
          WHERE scope.content_asset_id = effective.rights_source_asset_id
          ORDER BY scope.campaign_id
        ) AS rights_permitted_campaign_ids,
        ARRAY(
          SELECT scope.brand_profile_id::text
          FROM content_asset_rights_brand_profile scope
          WHERE scope.content_asset_id = effective.rights_source_asset_id
          ORDER BY scope.brand_profile_id
        ) AS rights_permitted_brand_profile_ids,
        effective.rights_valid_from, effective.rights_expires_at,
        effective.rights_attribution_requirement,
        effective.rights_watermark_requirement,
        effective.rights_disclaimer_requirement,
        effective.rights_review_note, effective.rights_reviewed_by,
        reviewer.display_name AS rights_reviewed_by_display_name,
        effective.rights_reviewed_at, effective.rights_revision,
        asset.alt_text, asset.alt_text_status, asset.accessibility_notes,
        asset.extracted_text, asset.extraction_status, asset.extraction_error,
        asset.metadata
      FROM content_asset asset
      LEFT JOIN content_asset source ON source.id = asset.source_asset_id
      CROSS JOIN LATERAL (
        SELECT
          COALESCE(source.rights_status, asset.rights_status) AS rights_status,
          COALESCE(source.rights_owner, asset.rights_owner) AS rights_owner,
          COALESCE(source.rights_license_owner, asset.rights_license_owner) AS rights_license_owner,
          COALESCE(source.rights_source_reference, asset.rights_source_reference) AS rights_source_reference,
          COALESCE(source.rights_proof_reference, asset.rights_proof_reference) AS rights_proof_reference,
          COALESCE(source.rights_commercial_use_allowed, asset.rights_commercial_use_allowed) AS rights_commercial_use_allowed,
          COALESCE(source.rights_derivative_use_allowed, asset.rights_derivative_use_allowed) AS rights_derivative_use_allowed,
          COALESCE(source.rights_worldwide_use_allowed, asset.rights_worldwide_use_allowed) AS rights_worldwide_use_allowed,
          CASE WHEN source.id IS NULL THEN asset.rights_permitted_channels ELSE source.rights_permitted_channels END AS rights_permitted_channels,
          CASE WHEN source.id IS NULL THEN asset.id ELSE source.id END AS rights_source_asset_id,
          COALESCE(source.rights_valid_from, asset.rights_valid_from) AS rights_valid_from,
          COALESCE(source.rights_expires_at, asset.rights_expires_at) AS rights_expires_at,
          COALESCE(source.rights_attribution_requirement, asset.rights_attribution_requirement) AS rights_attribution_requirement,
          COALESCE(source.rights_watermark_requirement, asset.rights_watermark_requirement) AS rights_watermark_requirement,
          COALESCE(source.rights_disclaimer_requirement, asset.rights_disclaimer_requirement) AS rights_disclaimer_requirement,
          COALESCE(source.rights_review_note, asset.rights_review_note) AS rights_review_note,
          COALESCE(source.rights_reviewed_by, asset.rights_reviewed_by) AS rights_reviewed_by,
          COALESCE(source.rights_reviewed_at, asset.rights_reviewed_at) AS rights_reviewed_at,
          CASE WHEN source.id IS NULL THEN asset.rights_revision ELSE source.rights_revision END AS rights_revision
      ) effective
      LEFT JOIN app_user reviewer ON reviewer.id = effective.rights_reviewed_by
      WHERE asset.content_package_id IN ${this.sql(ids)}
      ORDER BY asset.created_at
    `;
    const evidence = await this.sql<
      (StoredContentPackage["evidence"][number] & {
        contentPackageId: string;
      })[]
    >`
      SELECT id, content_package_id, fact_key, claim, provenance, source_references,
        confidence, context_pack_version_id, superseded_by_evidence_id
      FROM evidence_item WHERE content_package_id IN ${this.sql(ids)} ORDER BY created_at
    `;
    const conflicts = await this.sql<
      (StoredContentPackage["conflicts"][number] & {
        contentPackageId: string;
      })[]
    >`
      SELECT id, content_package_id, fact_key, candidate_evidence_ids, status,
        resolution_evidence_id, resolution_note
      FROM evidence_conflict WHERE content_package_id IN ${this.sql(ids)} ORDER BY created_at
    `;
    return rows.map((row) => ({
      ...row,
      assets: assets
        .filter((asset) => asset.contentPackageId === row.id)
        .map((asset) => ({
          ...asset,
          scanScannedAt: normalizedTimestamp(asset.scanScannedAt),
          rightsValidFrom: normalizedTimestamp(asset.rightsValidFrom),
          rightsExpiresAt: normalizedTimestamp(asset.rightsExpiresAt),
          rightsReviewedAt: normalizedTimestamp(asset.rightsReviewedAt),
        })),
      evidence: evidence.filter((item) => item.contentPackageId === row.id),
      conflicts: conflicts.filter(
        (conflict) => conflict.contentPackageId === row.id,
      ),
    }));
  }

  private async attachLocations(
    rows: readonly SmartSourceRow[],
  ): Promise<StoredSmartSource[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const locations = await this.sql<
      {
        smartSourceId: string;
        providerLocationId: string;
        displayPath: string;
      }[]
    >`
      SELECT smart_source_id, provider_location_id, display_path
      FROM smart_source_location
      WHERE smart_source_id IN ${this.sql(ids)}
      ORDER BY created_at
    `;
    return rows.map((row) => ({
      ...row,
      locations: locations.filter(
        (location) => location.smartSourceId === row.id,
      ),
    }));
  }
}
