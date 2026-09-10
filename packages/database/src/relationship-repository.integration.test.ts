import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { RelationshipRepository } from "./relationship-repository";
import { ConversationRepository } from "./conversation-repository";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("relationship repository", () => {
  afterAll(async () => sql?.end());

  it("keeps identities tenant-bound and audits suppression transitions", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const suffix = randomUUID();
    const first = await core.bootstrapDevelopmentWorkspace({
      email: `relationship-${suffix}@market-me.local`,
      displayName: "Relationship Test",
    });
    const second = await core.bootstrapDevelopmentWorkspace({
      email: `relationship-other-${suffix}@market-me.local`,
      displayName: "Other Relationship Test",
    });
    try {
      const input = {
        workspaceId: first.workspace.workspaceId,
        displayName: "Taylor Example",
        organizationName: "Example Cooperative",
        stage: "engaged" as const,
        contactPermission: "allowed" as const,
        assignedOwnerId: first.user.id,
        observedInterests: ["accessible publishing"],
        sharedTopics: ["community"],
        preferredTone: "direct",
        notes: "Met through an approved event.",
        identities: [
          {
            provider: "discord",
            providerSubjectId: "discord-123",
            displayHandle: "taylor",
            profileUrl: "https://example.com/taylor",
            status: "verified" as const,
            confidence: 1,
          },
        ],
      };
      const created = await relationships.saveRelationship(
        input,
        first.user.id,
      );
      expect(created).toEqual(
        expect.objectContaining({
          displayName: "Taylor Example",
          stage: "engaged",
          contactPermission: "allowed",
          assignedOwnerId: first.user.id,
          suppressionReason: undefined,
        }),
      );
      expect(created!.identities).toEqual([
        expect.objectContaining({
          provider: "discord",
          providerSubjectId: "discord-123",
          status: "verified",
          confidence: 1,
        }),
      ]);
      expect(
        await relationships.getRelationship(
          second.workspace.workspaceId,
          created!.id,
        ),
      ).toBeUndefined();

      await expect(
        relationships.saveRelationship(
          { ...input, assignedOwnerId: second.user.id },
          first.user.id,
          created!.id,
        ),
      ).rejects.toMatchObject({ name: "RelationshipValidationError" });
      await expect(
        relationships.saveRelationship(
          { ...input, displayName: "Duplicate identity" },
          first.user.id,
        ),
      ).rejects.toMatchObject({ name: "RelationshipValidationError" });

      const suppressed = await relationships.saveRelationship(
        {
          ...input,
          contactPermission: "suppressed",
          suppressionReason: "Explicit opt-out",
        },
        first.user.id,
        created!.id,
      );
      expect(suppressed).toEqual(
        expect.objectContaining({
          contactPermission: "suppressed",
          suppressionReason: "Explicit opt-out",
          suppressedBy: first.user.id,
          suppressedAt: expect.any(Date),
        }),
      );

      const restored = await relationships.saveRelationship(
        {
          ...input,
          contactPermission: "allowed",
          suppressionReason: undefined,
        },
        first.user.id,
        created!.id,
      );
      expect(restored).toEqual(
        expect.objectContaining({
          contactPermission: "allowed",
          suppressionReason: undefined,
          suppressedAt: undefined,
          suppressedBy: undefined,
        }),
      );

      const audits = await sql<
        { eventType: string; data: Record<string, unknown> }[]
      >`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND subject_type = 'relationship_contact'
          AND subject_id = ${created!.id}
        ORDER BY created_at
      `;
      expect(audits.map((audit) => audit.eventType)).toEqual([
        "relationship.created",
        "relationship.contact_suppressed",
        "relationship.contact_restored",
      ]);
      expect(audits[0].data).toEqual({
        stage: "engaged",
        contactPermission: "allowed",
        identityProviders: ["discord"],
      });
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (
          SELECT organization_id FROM workspace
          WHERE id IN (${first.workspace.workspaceId}, ${second.workspace.workspaceId})
        )
      `;
    }
  });

  it("keeps suggested identities separate and builds a reversible confirmed shared view", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const conversations = new ConversationRepository(sql);
    const suffix = randomUUID();
    const first = await core.bootstrapDevelopmentWorkspace({
      email: `identity-resolution-${suffix}@market-me.local`,
      displayName: "Identity Reviewer",
    });
    const second = await core.bootstrapDevelopmentWorkspace({
      email: `identity-resolution-other-${suffix}@market-me.local`,
      displayName: "Other Identity Reviewer",
    });
    const baseInput = {
      workspaceId: first.workspace.workspaceId,
      organizationName: "Example Cooperative",
      stage: "engaged" as const,
      contactPermission: "allowed" as const,
      observedInterests: [],
      sharedTopics: [],
      notes: "",
    };
    try {
      const email = await relationships.saveRelationship(
        {
          ...baseInput,
          displayName: "Taylor Email",
          identities: [
            {
              provider: "email",
              providerSubjectId: `taylor-${suffix}@example.test`,
              displayHandle: "taylor@example.test",
              status: "verified" as const,
              confidence: 1,
            },
          ],
        },
        first.user.id,
      );
      const community = await relationships.saveRelationship(
        {
          ...baseInput,
          displayName: "Taylor Community",
          identities: [
            {
              provider: "discord",
              providerSubjectId: `discord-${suffix}`,
              displayHandle: "taylor-community",
              status: "reported" as const,
              confidence: 0.8,
            },
          ],
        },
        first.user.id,
      );
      const crm = await relationships.saveRelationship(
        {
          ...baseInput,
          displayName: "Taylor CRM",
          contactPermission: "suppressed" as const,
          suppressionReason: "CRM opt-out",
          identities: [
            {
              provider: "crm",
              providerSubjectId: `crm-${suffix}`,
              status: "verified" as const,
              confidence: 1,
            },
          ],
        },
        first.user.id,
      );
      const foreign = await relationships.saveRelationship(
        {
          ...baseInput,
          workspaceId: second.workspace.workspaceId,
          displayName: "Foreign relationship",
          identities: [],
        },
        second.user.id,
      );

      await expect(
        relationships.saveIdentityLink(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: email!.id,
            candidateRelationshipId: email!.id,
            evidenceKind: "user_confirmation",
            confidence: 1,
            initialStatus: "confirmed",
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({ name: "RelationshipValidationError" });
      await expect(
        relationships.saveIdentityLink(
          {
            workspaceId: first.workspace.workspaceId,
            relationshipId: email!.id,
            candidateRelationshipId: foreign!.id,
            evidenceKind: "strong_identifier",
            confidence: 0.9,
            initialStatus: "suggested",
          },
          first.user.id,
        ),
      ).rejects.toMatchObject({ name: "RelationshipValidationError" });

      const suggestion = await relationships.saveIdentityLink(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: email!.id,
          candidateRelationshipId: community!.id,
          evidenceKind: "exact_address",
          confidence: 0.925,
          initialStatus: "suggested",
        },
        first.user.id,
      );
      expect(suggestion).toEqual(
        expect.objectContaining({
          status: "suggested",
          evidenceKind: "exact_address",
          confidence: 0.925,
          suggestedByName: "Identity Reviewer",
        }),
      );
      const separate = await relationships.getIdentityResolution(
        first.workspace.workspaceId,
        email!.id,
      );
      expect(separate).toEqual(
        expect.objectContaining({
          effectiveContactPermission: "allowed",
          members: [expect.objectContaining({ id: email!.id })],
          links: [expect.objectContaining({ status: "suggested" })],
        }),
      );

      await relationships.reviewIdentityLink(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: email!.id,
          linkId: suggestion!.id,
          status: "confirmed",
        },
        first.user.id,
      );
      await relationships.saveIdentityLink(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: community!.id,
          candidateRelationshipId: crm!.id,
          evidenceKind: "user_confirmation",
          confidence: 1,
          initialStatus: "confirmed",
        },
        first.user.id,
      );
      const shared = await relationships.getIdentityResolution(
        first.workspace.workspaceId,
        email!.id,
      );
      expect(shared!.members.map((member) => member.id).sort()).toEqual(
        [email!.id, community!.id, crm!.id].sort(),
      );
      expect(shared!.members.flatMap((member) => member.identities)).toHaveLength(3);
      expect(shared!.effectiveContactPermission).toBe("suppressed");
      expect(
        (await relationships.getRelationship(first.workspace.workspaceId, email!.id))!
          .effectiveContactPermission,
      ).toBe("suppressed");

      const thread = await conversations.saveThread(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: email!.id,
          provider: "manual",
          providerThreadId: `identity-thread-${suffix}`,
          subject: "Identity-linked safety",
          status: "new",
        },
        first.user.id,
      );
      expect(thread!.contactPermission).toBe("suppressed");

      await relationships.reviewIdentityLink(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: email!.id,
          linkId: suggestion!.id,
          status: "dismissed",
        },
        first.user.id,
      );
      const separatedAgain = await relationships.getIdentityResolution(
        first.workspace.workspaceId,
        email!.id,
      );
      expect(separatedAgain!.members.map((member) => member.id)).toEqual([email!.id]);
      expect(separatedAgain!.effectiveContactPermission).toBe("allowed");
      expect(
        (await conversations.getThread(first.workspace.workspaceId, thread!.id))!
          .contactPermission,
      ).toBe("allowed");

      const audits = await sql<
        { eventType: string; data: Record<string, unknown> }[]
      >`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND event_type LIKE 'relationship.identity_link_%'
        ORDER BY created_at, id
      `;
      expect(audits.map((audit) => audit.eventType)).toEqual([
        "relationship.identity_link_suggested",
        "relationship.identity_link_confirmed",
        "relationship.identity_link_confirmed",
        "relationship.identity_link_dismissed",
      ]);
      expect(JSON.stringify(audits)).not.toContain(`taylor-${suffix}@example.test`);
      expect(JSON.stringify(audits)).not.toContain("Taylor Email");
      expect(audits[0].data).toEqual(
        expect.objectContaining({
          identityLinkId: suggestion!.id,
          candidateRelationshipId: community!.id,
          evidenceKind: "exact_address",
          confidence: 0.925,
        }),
      );
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (
          SELECT organization_id FROM workspace
          WHERE id IN (${first.workspace.workspaceId}, ${second.workspace.workspaceId})
        )
      `;
    }
  });

  it("discovers only verified exact identity evidence without reopening reviewed pairs", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const relationships = new RelationshipRepository(sql);
    const suffix = randomUUID();
    const first = await core.bootstrapDevelopmentWorkspace({
      email: `identity-scan-${suffix}@market-me.local`,
      displayName: "Identity Scanner",
    });
    const create = (
      displayName: string,
      identity: {
        provider: string;
        providerSubjectId: string;
        displayHandle?: string;
        profileUrl?: string;
      },
    ) =>
      relationships.saveRelationship(
        {
          workspaceId: first.workspace.workspaceId,
          displayName,
          stage: "unknown",
          contactPermission: "allowed",
          observedInterests: [],
          sharedTopics: [],
          notes: "",
          identities: [{ ...identity, status: "verified", confidence: 1 }],
        },
        first.user.id,
      );
    try {
      const emailA = await create("Scan Email A", {
        provider: "email",
        providerSubjectId: `scan-${suffix}@example.test`,
      });
      const emailB = await create("Scan Email B", {
        provider: "crm_email",
        providerSubjectId: `SCAN-${suffix}@EXAMPLE.TEST`,
      });
      await create("Scan Profile A", {
        provider: "community",
        providerSubjectId: `community-${suffix}`,
        profileUrl: `https://example.test/people/${suffix}/?b=2&a=1#profile`,
      });
      await create("Scan Profile B", {
        provider: "social",
        providerSubjectId: `social-${suffix}`,
        profileUrl: `https://example.test/people/${suffix}?a=1&b=2`,
      });
      const strongId = `urn:market-me:person:${suffix}`;
      await create("Scan Strong A", {
        provider: "crm",
        providerSubjectId: strongId,
      });
      await create("Scan Strong B", {
        provider: "customer_record",
        providerSubjectId: strongId.toUpperCase(),
      });
      await create("Same Name", {
        provider: "discord",
        providerSubjectId: `unrelated-a-${suffix}`,
      });
      await create("Same Name", {
        provider: "forum",
        providerSubjectId: `unrelated-b-${suffix}`,
      });

      const scan = await relationships.scanIdentityCandidates(
        first.workspace.workspaceId,
        first.user.id,
      );
      expect(scan).toEqual(
        expect.objectContaining({
          scannedIdentityCount: 8,
          matchedPairCount: 3,
          createdSuggestionCount: 3,
          skippedExistingCount: 0,
          ambiguousSignalCount: 0,
          scanTruncated: false,
        }),
      );
      expect(scan.suggestions).toHaveLength(3);
      expect(
        scan.suggestions.map(({ evidenceKind, confidence, origin }) => ({
          evidenceKind,
          confidence,
          origin,
        })),
      ).toEqual([
        {
          evidenceKind: "exact_address",
          confidence: 0.99,
          origin: "deterministic_scan",
        },
        {
          evidenceKind: "verified_link",
          confidence: 0.97,
          origin: "deterministic_scan",
        },
        {
          evidenceKind: "strong_identifier",
          confidence: 0.95,
          origin: "deterministic_scan",
        },
      ]);

      const repeat = await relationships.scanIdentityCandidates(
        first.workspace.workspaceId,
        first.user.id,
      );
      expect(repeat.createdSuggestionCount).toBe(0);
      expect(repeat.skippedExistingCount).toBe(3);

      const emailSuggestion = scan.suggestions.find(
        (suggestion) => suggestion.evidenceKind === "exact_address",
      )!;
      await relationships.reviewIdentityLink(
        {
          workspaceId: first.workspace.workspaceId,
          relationshipId: emailA!.id,
          linkId: emailSuggestion.id,
          status: "dismissed",
        },
        first.user.id,
      );
      const afterDismissal = await relationships.scanIdentityCandidates(
        first.workspace.workspaceId,
        first.user.id,
      );
      expect(afterDismissal.createdSuggestionCount).toBe(0);
      expect(
        await relationships.getIdentityResolution(
          first.workspace.workspaceId,
          emailB!.id,
        ),
      ).toEqual(
        expect.objectContaining({
          members: [expect.objectContaining({ id: emailB!.id })],
        }),
      );

      const fingerprints = await sql<{ fingerprint: string }[]>`
        SELECT evidence_fingerprint AS fingerprint
        FROM relationship_identity_link
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND origin = 'deterministic_scan'
        ORDER BY evidence_fingerprint
      `;
      expect(fingerprints).toHaveLength(3);
      expect(fingerprints.every(({ fingerprint }) => /^[0-9a-f]{64}$/.test(fingerprint))).toBe(true);
      const audits = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM audit_event
        WHERE workspace_id = ${first.workspace.workspaceId}
          AND event_type = 'relationship.identity_candidate_discovered'
        ORDER BY created_at, id
      `;
      expect(audits).toHaveLength(3);
      expect(JSON.stringify(audits)).not.toContain(`scan-${suffix}@example.test`);
      expect(JSON.stringify(audits)).not.toContain("https://example.test/people");
      expect(JSON.stringify(audits)).not.toContain(strongId);
      expect(JSON.stringify(audits)).not.toContain("Same Name");
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id = (
          SELECT organization_id FROM workspace
          WHERE id = ${first.workspace.workspaceId}
        )
      `;
    }
  });
});
