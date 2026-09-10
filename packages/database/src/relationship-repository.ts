import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";
import type {
  RelationshipIdentity,
  RelationshipIdentityEvidenceKind,
  RelationshipIdentityGroupMember,
} from "@market-me/domain";
import type { DatabaseClient } from "./client";
import type {
  RelationshipIdentityLinkDecision,
  RelationshipIdentityLinkWrite,
  RelationshipIdentityCandidateScanResult,
  RelationshipWrite,
  StoredRelationship,
  StoredRelationshipIdentityLink,
  StoredRelationshipIdentityResolution,
} from "./models";

type RelationshipRow = Omit<StoredRelationship, "identities">;
type RelationshipPersistedRow = Omit<
  RelationshipRow,
  "effectiveContactPermission"
>;
type IdentityGroupMemberRow = Omit<
  RelationshipIdentityGroupMember,
  "identities"
>;

type IdentityScanRow = {
  relationshipContactId: string;
  provider: string;
  providerSubjectId: string;
  displayHandle: string | null;
  profileUrl: string | null;
};

type ExistingIdentityLinkRow = {
  relationshipAId: string;
  relationshipBId: string;
  status: "suggested" | "confirmed" | "dismissed";
};

type IdentityCandidate = {
  relationshipAId: string;
  relationshipBId: string;
  evidenceKind: RelationshipIdentityEvidenceKind;
  confidence: number;
  evidenceFingerprint: string;
};

export class RelationshipValidationError extends Error {
  constructor(readonly issues: readonly { field: string; message: string }[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "RelationshipValidationError";
  }
}

export class RelationshipRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async listRelationships(workspaceId: string): Promise<StoredRelationship[]> {
    return this.attachIdentities(
      await this.sql<RelationshipRow[]>`
        SELECT id, workspace_id, display_name, organization_name, stage,
          contact_permission, assigned_owner_id, observed_interests, shared_topics,
          preferred_tone, notes, suppression_reason, suppressed_at, suppressed_by,
          created_by, created_at, updated_at,
          relationship_effective_contact_permission(workspace_id, id)
            AS effective_contact_permission
        FROM relationship_contact
        WHERE workspace_id = ${workspaceId}
        ORDER BY updated_at DESC, display_name
      `,
    );
  }

  async getRelationship(
    workspaceId: string,
    id: string,
  ): Promise<StoredRelationship | undefined> {
    return (
      await this.attachIdentities(
        await this.sql<RelationshipRow[]>`
          SELECT id, workspace_id, display_name, organization_name, stage,
            contact_permission, assigned_owner_id, observed_interests, shared_topics,
            preferred_tone, notes, suppression_reason, suppressed_at, suppressed_by,
            created_by, created_at, updated_at,
            relationship_effective_contact_permission(workspace_id, id)
              AS effective_contact_permission
          FROM relationship_contact
          WHERE workspace_id = ${workspaceId} AND id = ${id}
        `,
      )
    )[0];
  }

  async saveRelationship(
    input: RelationshipWrite,
    actorUserId: string,
    id: string = randomUUID(),
  ): Promise<StoredRelationship | undefined> {
    const duplicates = new Set<string>();
    for (const identity of input.identities) {
      const key = `${identity.provider}\0${identity.providerSubjectId}`;
      if (duplicates.has(key)) {
        throw new RelationshipValidationError([
          {
            field: "identities",
            message:
              "Relationship identities must be unique by provider and subject.",
          },
        ]);
      }
      duplicates.add(key);
    }
    if (
      input.contactPermission === "suppressed" &&
      !input.suppressionReason?.trim()
    ) {
      throw new RelationshipValidationError([
        {
          field: "suppressionReason",
          message: "A suppression reason is required.",
        },
      ]);
    }

    const saved = await this.sql.begin(async (transaction) => {
      if (input.assignedOwnerId) {
        const owners = await transaction<{ found: boolean }[]>`
          SELECT true AS found FROM workspace_membership
          WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.assignedOwnerId}
        `;
        if (!owners[0]) {
          throw new RelationshipValidationError([
            {
              field: "assignedOwnerId",
              message: "Assigned owner must belong to this workspace.",
            },
          ]);
        }
      }
      for (const identity of input.identities) {
        const conflicts = await transaction<
          { relationshipContactId: string }[]
        >`
          SELECT relationship_contact_id FROM relationship_identity
          WHERE workspace_id = ${input.workspaceId}
            AND provider = ${identity.provider}
            AND provider_subject_id = ${identity.providerSubjectId}
            AND relationship_contact_id <> ${id}
        `;
        if (conflicts[0]) {
          throw new RelationshipValidationError([
            {
              field: "identities",
              message:
                "That provider identity already belongs to another relationship.",
            },
          ]);
        }
      }

      const existing = (
        await transaction<RelationshipPersistedRow[]>`
          SELECT id, workspace_id, display_name, organization_name, stage,
            contact_permission, assigned_owner_id, observed_interests, shared_topics,
            preferred_tone, notes, suppression_reason, suppressed_at, suppressed_by,
            created_by, created_at, updated_at
          FROM relationship_contact
          WHERE id = ${id} AND workspace_id = ${input.workspaceId}
          FOR UPDATE
        `
      )[0];

      const existingIdentities = existing
        ? await transaction<RelationshipIdentity[]>`
            SELECT id, provider, provider_subject_id, display_handle, profile_url,
              status, confidence::float8 AS confidence
            FROM relationship_identity
            WHERE relationship_contact_id = ${id} AND workspace_id = ${input.workspaceId}
          `
        : [];
      const suppressedAt =
        input.contactPermission === "suppressed"
          ? existing?.contactPermission === "suppressed" &&
            existing.suppressedAt
            ? existing.suppressedAt
            : new Date().toISOString()
          : null;

      if (existing) {
        await transaction`
          UPDATE relationship_contact SET
            display_name = ${input.displayName},
            organization_name = ${input.organizationName ?? null},
            stage = ${input.stage},
            contact_permission = ${input.contactPermission},
            assigned_owner_id = ${input.assignedOwnerId ?? null},
            observed_interests = ${[...input.observedInterests]},
            shared_topics = ${[...input.sharedTopics]},
            preferred_tone = ${input.preferredTone ?? null},
            notes = ${input.notes},
            suppression_reason = ${input.contactPermission === "suppressed" ? input.suppressionReason!.trim() : null},
            suppressed_at = ${suppressedAt},
            suppressed_by = ${input.contactPermission === "suppressed" ? actorUserId : null},
            updated_at = now()
          WHERE id = ${id} AND workspace_id = ${input.workspaceId}
        `;
      } else {
        await transaction`
          INSERT INTO relationship_contact (
            id, workspace_id, display_name, organization_name, stage, contact_permission,
            assigned_owner_id, observed_interests, shared_topics, preferred_tone, notes,
            suppression_reason, suppressed_at, suppressed_by, created_by
          ) VALUES (
            ${id}, ${input.workspaceId}, ${input.displayName}, ${input.organizationName ?? null},
            ${input.stage}, ${input.contactPermission}, ${input.assignedOwnerId ?? null},
            ${[...input.observedInterests]}, ${[...input.sharedTopics]}, ${input.preferredTone ?? null},
            ${input.notes}, ${input.contactPermission === "suppressed" ? input.suppressionReason!.trim() : null},
            ${suppressedAt}, ${input.contactPermission === "suppressed" ? actorUserId : null}, ${actorUserId}
          )
        `;
      }

      await transaction`
        DELETE FROM relationship_identity
        WHERE relationship_contact_id = ${id} AND workspace_id = ${input.workspaceId}
      `;
      for (const identity of input.identities) {
        const prior = existingIdentities.find(
          (candidate) =>
            candidate.provider === identity.provider &&
            candidate.providerSubjectId === identity.providerSubjectId,
        );
        await transaction`
          INSERT INTO relationship_identity (
            id, workspace_id, relationship_contact_id, provider, provider_subject_id,
            display_handle, profile_url, status, confidence
          ) VALUES (
            ${prior?.id ?? randomUUID()}, ${input.workspaceId}, ${id}, ${identity.provider},
            ${identity.providerSubjectId}, ${identity.displayHandle ?? null},
            ${identity.profileUrl ?? null}, ${identity.status}, ${identity.confidence ?? null}
          )
        `;
      }

      const eventType = !existing
        ? "relationship.created"
        : existing.contactPermission !== input.contactPermission
          ? input.contactPermission === "suppressed"
            ? "relationship.contact_suppressed"
            : "relationship.contact_restored"
          : "relationship.updated";
      await this.audit(
        transaction,
        input.workspaceId,
        actorUserId,
        eventType,
        id,
        {
          stage: input.stage,
          contactPermission: input.contactPermission,
          identityProviders: input.identities.map(
            (identity) => identity.provider,
          ),
        },
      );
      return true;
    });

    return saved ? this.getRelationship(input.workspaceId, id) : undefined;
  }

  async getIdentityResolution(
    workspaceId: string,
    relationshipId: string,
  ): Promise<StoredRelationshipIdentityResolution | undefined> {
    const members = await this.sql<IdentityGroupMemberRow[]>`
      WITH RECURSIVE confirmed_group(id) AS (
        SELECT ${relationshipId}::uuid
        UNION
        SELECT CASE
          WHEN link.relationship_a_id = confirmed_group.id
            THEN link.relationship_b_id
          ELSE link.relationship_a_id
        END
        FROM relationship_identity_link link
        JOIN confirmed_group
          ON link.relationship_a_id = confirmed_group.id
          OR link.relationship_b_id = confirmed_group.id
        WHERE link.workspace_id = ${workspaceId}
          AND link.status = 'confirmed'
      )
      SELECT contact.id, contact.display_name, contact.organization_name,
        contact.stage, contact.contact_permission
      FROM confirmed_group
      JOIN relationship_contact contact
        ON contact.id = confirmed_group.id
        AND contact.workspace_id = ${workspaceId}
      ORDER BY contact.display_name, contact.id
    `;
    if (!members.length) return undefined;

    const identities = await this.sql<
      (RelationshipIdentity & { relationshipContactId: string })[]
    >`
      SELECT relationship_contact_id, id, provider, provider_subject_id,
        display_handle, profile_url, status, confidence::float8 AS confidence
      FROM relationship_identity
      WHERE workspace_id = ${workspaceId}
        AND relationship_contact_id IN ${this.sql(members.map((member) => member.id))}
      ORDER BY provider, display_handle NULLS LAST, provider_subject_id
    `;
    const links = await this.sql<StoredRelationshipIdentityLink[]>`
      WITH RECURSIVE confirmed_group(id) AS (
        SELECT ${relationshipId}::uuid
        UNION
        SELECT CASE
          WHEN link.relationship_a_id = confirmed_group.id
            THEN link.relationship_b_id
          ELSE link.relationship_a_id
        END
        FROM relationship_identity_link link
        JOIN confirmed_group
          ON link.relationship_a_id = confirmed_group.id
          OR link.relationship_b_id = confirmed_group.id
        WHERE link.workspace_id = ${workspaceId}
          AND link.status = 'confirmed'
      )
      SELECT link.id, link.workspace_id, link.relationship_a_id,
        link.relationship_b_id, link.status, link.evidence_kind, link.origin,
        link.confidence::float8 AS confidence, link.suggested_by,
        link.reviewed_by, link.reviewed_at, link.created_at, link.updated_at,
        first.display_name AS relationship_a_name,
        second.display_name AS relationship_b_name,
        suggester.display_name AS suggested_by_name,
        reviewer.display_name AS reviewed_by_name
      FROM relationship_identity_link link
      JOIN relationship_contact first
        ON first.id = link.relationship_a_id
        AND first.workspace_id = link.workspace_id
      JOIN relationship_contact second
        ON second.id = link.relationship_b_id
        AND second.workspace_id = link.workspace_id
      JOIN app_user suggester ON suggester.id = link.suggested_by
      LEFT JOIN app_user reviewer ON reviewer.id = link.reviewed_by
      WHERE link.workspace_id = ${workspaceId}
        AND (
          link.relationship_a_id IN (SELECT id FROM confirmed_group)
          OR link.relationship_b_id IN (SELECT id FROM confirmed_group)
        )
      ORDER BY
        CASE link.status WHEN 'suggested' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
        link.updated_at DESC,
        link.id
    `;
    const hydratedMembers = members.map((member) => ({
      ...member,
      organizationName: member.organizationName ?? undefined,
      identities: identities
        .filter((identity) => identity.relationshipContactId === member.id)
        .map(({ relationshipContactId: _, ...identity }) => ({
          ...identity,
          displayHandle: identity.displayHandle ?? undefined,
          profileUrl: identity.profileUrl ?? undefined,
          confidence: identity.confidence ?? undefined,
        })),
    }));
    return {
      relationshipId,
      effectiveContactPermission: hydratedMembers.some(
        (member) => member.contactPermission === "suppressed",
      )
        ? "suppressed"
        : "allowed",
      members: hydratedMembers,
      links: links.map((link) => ({
        ...link,
        reviewedBy: link.reviewedBy ?? undefined,
        reviewedAt: link.reviewedAt ?? undefined,
        reviewedByName: link.reviewedByName ?? undefined,
      })),
    };
  }

  async saveIdentityLink(
    input: RelationshipIdentityLinkWrite,
    actorUserId: string,
  ): Promise<StoredRelationshipIdentityLink | undefined> {
    if (input.relationshipId === input.candidateRelationshipId) {
      throw new RelationshipValidationError([
        {
          field: "candidateRelationshipId",
          message: "A relationship cannot be linked to itself.",
        },
      ]);
    }
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new RelationshipValidationError([
        { field: "confidence", message: "Confidence must be between 0 and 1." },
      ]);
    }
    const [relationshipAId, relationshipBId] =
      input.relationshipId < input.candidateRelationshipId
        ? [input.relationshipId, input.candidateRelationshipId]
        : [input.candidateRelationshipId, input.relationshipId];
    const linkId = await this.sql.begin(async (transaction) => {
      await this.requireIdentityWriter(transaction, input.workspaceId, actorUserId);
      const roots = await transaction<{ id: string }[]>`
        SELECT id FROM relationship_contact
        WHERE workspace_id = ${input.workspaceId}
          AND id IN ${transaction([relationshipAId, relationshipBId])}
        ORDER BY id
        FOR UPDATE
      `;
      if (roots.length !== 2) {
        throw new RelationshipValidationError([
          {
            field: "candidateRelationshipId",
            message: "Both relationships must belong to this workspace.",
          },
        ]);
      }
      const existing = (
        await transaction<{ id: string; status: string }[]>`
          SELECT id, status FROM relationship_identity_link
          WHERE workspace_id = ${input.workspaceId}
            AND relationship_a_id = ${relationshipAId}
            AND relationship_b_id = ${relationshipBId}
          FOR UPDATE
        `
      )[0];
      if (existing?.status === "confirmed") return existing.id;

      const alreadyConnected = await transaction<{ found: boolean }[]>`
        WITH RECURSIVE confirmed_group(id) AS (
          SELECT ${input.relationshipId}::uuid
          UNION
          SELECT CASE
            WHEN link.relationship_a_id = confirmed_group.id
              THEN link.relationship_b_id
            ELSE link.relationship_a_id
          END
          FROM relationship_identity_link link
          JOIN confirmed_group
            ON link.relationship_a_id = confirmed_group.id
            OR link.relationship_b_id = confirmed_group.id
          WHERE link.workspace_id = ${input.workspaceId}
            AND link.status = 'confirmed'
        )
        SELECT true AS found FROM confirmed_group
        WHERE id = ${input.candidateRelationshipId}
        LIMIT 1
      `;
      if (alreadyConnected[0]) {
        throw new RelationshipValidationError([
          {
            field: "candidateRelationshipId",
            message: "These relationships already share a confirmed identity view.",
          },
        ]);
      }

      const id = existing?.id ?? randomUUID();
      if (existing) {
        await transaction`
          UPDATE relationship_identity_link SET
            status = ${input.initialStatus},
            evidence_kind = ${input.evidenceKind},
            confidence = ${input.confidence},
            origin = 'manual_review',
            evidence_fingerprint = NULL,
            suggested_by = ${actorUserId},
            reviewed_by = ${input.initialStatus === "confirmed" ? actorUserId : null},
            reviewed_at = ${input.initialStatus === "confirmed" ? new Date().toISOString() : null},
            updated_at = now()
          WHERE id = ${id} AND workspace_id = ${input.workspaceId}
        `;
      } else {
        await transaction`
          INSERT INTO relationship_identity_link (
            id, workspace_id, relationship_a_id, relationship_b_id, status,
            evidence_kind, confidence, origin, evidence_fingerprint,
            suggested_by, reviewed_by, reviewed_at
          ) VALUES (
            ${id}, ${input.workspaceId}, ${relationshipAId}, ${relationshipBId},
            ${input.initialStatus}, ${input.evidenceKind}, ${input.confidence},
            'manual_review', NULL,
            ${actorUserId},
            ${input.initialStatus === "confirmed" ? actorUserId : null},
            ${input.initialStatus === "confirmed" ? new Date().toISOString() : null}
          )
        `;
      }
      await this.audit(
        transaction,
        input.workspaceId,
        actorUserId,
        input.initialStatus === "confirmed"
          ? "relationship.identity_link_confirmed"
          : "relationship.identity_link_suggested",
        input.relationshipId,
        {
          identityLinkId: id,
          candidateRelationshipId: input.candidateRelationshipId,
          evidenceKind: input.evidenceKind,
          confidence: input.confidence,
        },
      );
      return id;
    });
    return this.identityLinkById(input.workspaceId, linkId);
  }

  async reviewIdentityLink(
    input: RelationshipIdentityLinkDecision,
    actorUserId: string,
  ): Promise<StoredRelationshipIdentityLink | undefined> {
    const updated = await this.sql.begin(async (transaction) => {
      await this.requireIdentityWriter(transaction, input.workspaceId, actorUserId);
      const existing = (
        await transaction<{
          id: string;
          relationshipAId: string;
          relationshipBId: string;
          status: string;
        }[]>`
          SELECT id, relationship_a_id, relationship_b_id, status
          FROM relationship_identity_link
          WHERE id = ${input.linkId}
            AND workspace_id = ${input.workspaceId}
            AND (
              relationship_a_id = ${input.relationshipId}
              OR relationship_b_id = ${input.relationshipId}
            )
          FOR UPDATE
        `
      )[0];
      if (!existing) return false;
      if (existing.status === input.status) return true;
      await transaction`
        UPDATE relationship_identity_link SET
          status = ${input.status},
          reviewed_by = ${actorUserId},
          reviewed_at = now(),
          updated_at = now()
        WHERE id = ${input.linkId} AND workspace_id = ${input.workspaceId}
      `;
      const candidateRelationshipId =
        existing.relationshipAId === input.relationshipId
          ? existing.relationshipBId
          : existing.relationshipAId;
      await this.audit(
        transaction,
        input.workspaceId,
        actorUserId,
        input.status === "confirmed"
          ? "relationship.identity_link_confirmed"
          : "relationship.identity_link_dismissed",
        input.relationshipId,
        { identityLinkId: input.linkId, candidateRelationshipId },
      );
      return true;
    });
    return updated
      ? this.identityLinkById(input.workspaceId, input.linkId)
      : undefined;
  }

  async listIdentitySuggestions(
    workspaceId: string,
  ): Promise<StoredRelationshipIdentityLink[]> {
    const links = await this.sql<StoredRelationshipIdentityLink[]>`
      SELECT link.id, link.workspace_id, link.relationship_a_id,
        link.relationship_b_id, link.status, link.evidence_kind, link.origin,
        link.confidence::float8 AS confidence, link.suggested_by,
        link.reviewed_by, link.reviewed_at, link.created_at, link.updated_at,
        first.display_name AS relationship_a_name,
        second.display_name AS relationship_b_name,
        suggester.display_name AS suggested_by_name,
        reviewer.display_name AS reviewed_by_name
      FROM relationship_identity_link link
      JOIN relationship_contact first
        ON first.id = link.relationship_a_id
        AND first.workspace_id = link.workspace_id
      JOIN relationship_contact second
        ON second.id = link.relationship_b_id
        AND second.workspace_id = link.workspace_id
      JOIN app_user suggester ON suggester.id = link.suggested_by
      LEFT JOIN app_user reviewer ON reviewer.id = link.reviewed_by
      WHERE link.workspace_id = ${workspaceId}
        AND link.status = 'suggested'
      ORDER BY link.confidence DESC, link.updated_at DESC, link.id
      LIMIT 200
    `;
    return links.map(normalizeIdentityLink);
  }

  async scanIdentityCandidates(
    workspaceId: string,
    actorUserId: string,
  ): Promise<RelationshipIdentityCandidateScanResult> {
    const scan = await this.sql.begin(async (transaction) => {
      await this.requireIdentityWriter(transaction, workspaceId, actorUserId);
      await transaction`
        SELECT id FROM relationship_contact
        WHERE workspace_id = ${workspaceId}
        ORDER BY id
        FOR SHARE
      `;
      const scanned = await transaction<IdentityScanRow[]>`
        SELECT relationship_contact_id, provider, provider_subject_id,
          display_handle, profile_url
        FROM relationship_identity
        WHERE workspace_id = ${workspaceId}
          AND status = 'verified'
        ORDER BY relationship_contact_id, provider, provider_subject_id
        LIMIT 5001
      `;
      const scanTruncated = scanned.length > 5000;
      const identities = scanTruncated ? scanned.slice(0, 5000) : scanned;
      const existing = await transaction<ExistingIdentityLinkRow[]>`
        SELECT relationship_a_id, relationship_b_id, status
        FROM relationship_identity_link
        WHERE workspace_id = ${workspaceId}
      `;
      const discovered = discoverIdentityCandidates(identities, existing);
      const candidates = discovered.candidates.slice(0, 100);
      const createdIds: string[] = [];
      for (const candidate of candidates) {
        const id = randomUUID();
        const inserted = await transaction<{ id: string }[]>`
          INSERT INTO relationship_identity_link (
            id, workspace_id, relationship_a_id, relationship_b_id, status,
            evidence_kind, confidence, origin, evidence_fingerprint,
            suggested_by
          ) VALUES (
            ${id}, ${workspaceId}, ${candidate.relationshipAId},
            ${candidate.relationshipBId}, 'suggested', ${candidate.evidenceKind},
            ${candidate.confidence}, 'deterministic_scan',
            ${candidate.evidenceFingerprint}, ${actorUserId}
          )
          ON CONFLICT (workspace_id, relationship_a_id, relationship_b_id)
          DO NOTHING
          RETURNING id
        `;
        if (!inserted[0]) continue;
        createdIds.push(id);
        await this.audit(
          transaction,
          workspaceId,
          actorUserId,
          "relationship.identity_candidate_discovered",
          candidate.relationshipAId,
          {
            identityLinkId: id,
            candidateRelationshipId: candidate.relationshipBId,
            evidenceKind: candidate.evidenceKind,
            confidence: candidate.confidence,
            origin: "deterministic_scan",
          },
        );
      }
      return {
        scannedIdentityCount: identities.length,
        matchedPairCount: discovered.matchedPairCount,
        createdSuggestionCount: createdIds.length,
        skippedExistingCount: discovered.skippedExistingCount,
        ambiguousSignalCount: discovered.ambiguousSignalCount,
        scanTruncated:
          scanTruncated || discovered.candidates.length > candidates.length,
        createdIds,
      };
    });
    const suggestions = scan.createdIds.length
      ? (await this.listIdentitySuggestions(workspaceId)).filter((link) =>
          scan.createdIds.includes(link.id),
        )
      : [];
    return { ...scan, suggestions };
  }

  private async identityLinkById(
    workspaceId: string,
    linkId: string,
  ): Promise<StoredRelationshipIdentityLink | undefined> {
    const link = (
      await this.sql<StoredRelationshipIdentityLink[]>`
        SELECT link.id, link.workspace_id, link.relationship_a_id,
          link.relationship_b_id, link.status, link.evidence_kind, link.origin,
          link.confidence::float8 AS confidence, link.suggested_by,
          link.reviewed_by, link.reviewed_at, link.created_at, link.updated_at,
          first.display_name AS relationship_a_name,
          second.display_name AS relationship_b_name,
          suggester.display_name AS suggested_by_name,
          reviewer.display_name AS reviewed_by_name
        FROM relationship_identity_link link
        JOIN relationship_contact first
          ON first.id = link.relationship_a_id
          AND first.workspace_id = link.workspace_id
        JOIN relationship_contact second
          ON second.id = link.relationship_b_id
          AND second.workspace_id = link.workspace_id
        JOIN app_user suggester ON suggester.id = link.suggested_by
        LEFT JOIN app_user reviewer ON reviewer.id = link.reviewed_by
        WHERE link.workspace_id = ${workspaceId} AND link.id = ${linkId}
      `
    )[0];
    return link ? normalizeIdentityLink(link) : undefined;
  }

  private async requireIdentityWriter(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
  ) {
    const memberships = await transaction<{ found: boolean }[]>`
      SELECT true AS found FROM workspace_membership
      WHERE workspace_id = ${workspaceId}
        AND user_id = ${actorUserId}
        AND role IN ('owner', 'admin', 'editor')
    `;
    if (!memberships[0]) {
      throw new RelationshipValidationError([
        {
          field: "workspaceId",
          message: "Identity links require workspace authoring permission.",
        },
      ]);
    }
  }

  private async attachIdentities(
    rows: readonly RelationshipRow[],
  ): Promise<StoredRelationship[]> {
    if (!rows.length) return [];
    const identities = await this.sql<
      (RelationshipIdentity & { relationshipContactId: string })[]
    >`
      SELECT relationship_contact_id, id, provider, provider_subject_id,
        display_handle, profile_url, status, confidence::float8 AS confidence
      FROM relationship_identity
      WHERE relationship_contact_id IN ${this.sql(rows.map((row) => row.id))}
      ORDER BY provider, display_handle NULLS LAST, provider_subject_id
    `;
    return rows.map((row) => ({
      ...row,
      organizationName: row.organizationName ?? undefined,
      assignedOwnerId: row.assignedOwnerId ?? undefined,
      preferredTone: row.preferredTone ?? undefined,
      suppressionReason: row.suppressionReason ?? undefined,
      suppressedAt: row.suppressedAt ?? undefined,
      suppressedBy: row.suppressedBy ?? undefined,
      identities: identities
        .filter((identity) => identity.relationshipContactId === row.id)
        .map(({ relationshipContactId: _, ...identity }) => ({
          ...identity,
          displayHandle: identity.displayHandle ?? undefined,
          profileUrl: identity.profileUrl ?? undefined,
          confidence: identity.confidence ?? undefined,
        })),
    }));
  }

  private async audit(
    transaction: TransactionSql,
    workspaceId: string,
    actorUserId: string,
    eventType: string,
    subjectId: string,
    data: Record<string, unknown>,
  ) {
    await transaction`
      INSERT INTO audit_event (
        id, organization_id, workspace_id, actor_user_id,
        event_type, subject_type, subject_id, data
      )
      SELECT ${randomUUID()}, organization_id, id, ${actorUserId}, ${eventType},
        'relationship_contact', ${subjectId}, ${transaction.json(data as JSONValue)}
      FROM workspace WHERE id = ${workspaceId}
    `;
  }
}

function normalizeIdentityLink(
  link: StoredRelationshipIdentityLink,
): StoredRelationshipIdentityLink {
  return {
    ...link,
    reviewedBy: link.reviewedBy ?? undefined,
    reviewedAt: link.reviewedAt ?? undefined,
    reviewedByName: link.reviewedByName ?? undefined,
  };
}

function discoverIdentityCandidates(
  identities: readonly IdentityScanRow[],
  existing: readonly ExistingIdentityLinkRow[],
): {
  candidates: IdentityCandidate[];
  matchedPairCount: number;
  skippedExistingCount: number;
  ambiguousSignalCount: number;
} {
  const signals = new Map<
    string,
    {
      kind: RelationshipIdentityEvidenceKind;
      value: string;
      relationshipIds: Set<string>;
    }
  >();
  for (const identity of identities) {
    for (const signal of strongIdentitySignals(identity)) {
      const key = `${signal.kind}\0${signal.value}`;
      const current = signals.get(key) ?? {
        ...signal,
        relationshipIds: new Set<string>(),
      };
      current.relationshipIds.add(identity.relationshipContactId);
      signals.set(key, current);
    }
  }

  let ambiguousSignalCount = 0;
  const matched = new Map<string, IdentityCandidate>();
  for (const signal of signals.values()) {
    const relationshipIds = [...signal.relationshipIds].sort();
    if (relationshipIds.length < 2) continue;
    if (relationshipIds.length > 5) {
      ambiguousSignalCount += 1;
      continue;
    }
    for (let first = 0; first < relationshipIds.length - 1; first += 1) {
      for (let second = first + 1; second < relationshipIds.length; second += 1) {
        const relationshipAId = relationshipIds[first];
        const relationshipBId = relationshipIds[second];
        const key = identityPairKey(relationshipAId, relationshipBId);
        const candidate: IdentityCandidate = {
          relationshipAId,
          relationshipBId,
          evidenceKind: signal.kind,
          confidence: identityEvidenceConfidence(signal.kind),
          evidenceFingerprint: createHash("sha256")
            .update(`${signal.kind}\0${signal.value}`)
            .digest("hex"),
        };
        const prior = matched.get(key);
        if (
          !prior ||
          identityEvidenceRank(candidate.evidenceKind) >
            identityEvidenceRank(prior.evidenceKind)
        ) {
          matched.set(key, candidate);
        }
      }
    }
  }

  const directLinks = new Set(
    existing.map((link) =>
      identityPairKey(link.relationshipAId, link.relationshipBId),
    ),
  );
  const components = new IdentityComponents();
  for (const link of existing) {
    if (link.status === "confirmed") {
      components.union(link.relationshipAId, link.relationshipBId);
    }
  }
  let skippedExistingCount = 0;
  const candidates = [...matched.values()]
    .filter((candidate) => {
      const direct = directLinks.has(
        identityPairKey(candidate.relationshipAId, candidate.relationshipBId),
      );
      const connected = components.connected(
        candidate.relationshipAId,
        candidate.relationshipBId,
      );
      if (direct || connected) skippedExistingCount += 1;
      return !direct && !connected;
    })
    .sort(
      (left, right) =>
        identityEvidenceRank(right.evidenceKind) -
          identityEvidenceRank(left.evidenceKind) ||
        right.confidence - left.confidence ||
        left.relationshipAId.localeCompare(right.relationshipAId) ||
        left.relationshipBId.localeCompare(right.relationshipBId),
    );
  return {
    candidates,
    matchedPairCount: matched.size,
    skippedExistingCount,
    ambiguousSignalCount,
  };
}

function strongIdentitySignals(identity: IdentityScanRow): {
  kind: RelationshipIdentityEvidenceKind;
  value: string;
}[] {
  const found = new Map<RelationshipIdentityEvidenceKind, Set<string>>();
  const add = (kind: RelationshipIdentityEvidenceKind, value?: string) => {
    if (!value) return;
    const values = found.get(kind) ?? new Set<string>();
    values.add(value);
    found.set(kind, values);
  };
  for (const value of [identity.providerSubjectId, identity.displayHandle]) {
    add("exact_address", normalizeEmailAddress(value));
  }
  add("verified_link", normalizeHttpsProfile(identity.profileUrl));
  if (!normalizeEmailAddress(identity.providerSubjectId)) {
    add("strong_identifier", normalizeStrongIdentifier(identity.providerSubjectId));
  }
  return [...found.entries()].flatMap(([kind, values]) =>
    [...values].map((value) => ({ kind, value })),
  );
}

function normalizeEmailAddress(value: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      normalized,
    )
    ? normalized
    : undefined;
}

function normalizeHttpsProfile(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    url.hash = "";
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return undefined;
  }
}

function normalizeStrongIdentifier(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalized,
    ) ||
    /^urn:[a-z0-9][a-z0-9:._/-]{12,}$/.test(normalized) ||
    /^[a-z][a-z0-9._-]{2,20}:[a-z0-9][a-z0-9._:-]{12,}$/.test(normalized)
  ) {
    return normalized;
  }
  return undefined;
}

function identityEvidenceRank(kind: RelationshipIdentityEvidenceKind): number {
  if (kind === "exact_address") return 3;
  if (kind === "verified_link") return 2;
  return 1;
}

function identityEvidenceConfidence(
  kind: RelationshipIdentityEvidenceKind,
): number {
  if (kind === "exact_address") return 0.99;
  if (kind === "verified_link") return 0.97;
  return 0.95;
}

function identityPairKey(first: string, second: string): string {
  return first < second ? `${first}\0${second}` : `${second}\0${first}`;
}

class IdentityComponents {
  private readonly parents = new Map<string, string>();

  union(first: string, second: string) {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);
    if (firstRoot !== secondRoot) this.parents.set(secondRoot, firstRoot);
  }

  connected(first: string, second: string): boolean {
    return this.find(first) === this.find(second);
  }

  private find(value: string): string {
    const parent = this.parents.get(value);
    if (!parent) {
      this.parents.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parents.set(value, root);
    return root;
  }
}
