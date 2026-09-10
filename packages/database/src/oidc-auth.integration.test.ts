import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("OIDC authentication persistence", () => {
  afterAll(async () => sql?.end());

  it("consumes browser-bound authorization state exactly once", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(sql);
    const suffix = randomUUID();
    const stateHash = `state-${suffix}`.padEnd(43, "x");
    await repository.saveOidcAuthState({
      stateHash,
      issuer: "https://identity.example.test/tenant",
      nonceHash: `nonce-${suffix}`.padEnd(43, "x"),
      codeVerifier: `verifier-${suffix}`.padEnd(64, "x"),
      returnTo: "/campaigns?view=ready",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(repository.consumeOidcAuthState(stateHash)).resolves.toEqual({
      issuer: "https://identity.example.test/tenant",
      nonceHash: `nonce-${suffix}`.padEnd(43, "x"),
      codeVerifier: `verifier-${suffix}`.padEnd(64, "x"),
      returnTo: "/campaigns?view=ready",
    });
    await expect(repository.consumeOidcAuthState(stateHash)).resolves.toBeUndefined();
  });

  it("links only a provisioned verified-email account and keeps issuer subject authoritative", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(sql);
    const suffix = randomUUID();
    const owner = await repository.bootstrapDevelopmentWorkspace({
      email: `oidc-${suffix}@market-me.local`,
      displayName: "OIDC Owner",
    });
    const issuer = "https://identity.example.test/tenant";
    try {
      await expect(repository.completeOidcSignIn({
        issuer,
        subject: `subject-${suffix}`,
        email: owner.user.email.toUpperCase(),
        displayName: "Provider-controlled name",
        allowBootstrap: false,
      })).resolves.toEqual({ status: "authenticated", user: owner.user });

      await expect(repository.completeOidcSignIn({
        issuer,
        subject: `subject-${suffix}`,
        email: `changed-${suffix}@example.test`,
        displayName: "Changed Provider Name",
        allowBootstrap: false,
      })).resolves.toEqual({ status: "authenticated", user: owner.user });

      await expect(repository.completeOidcSignIn({
        issuer,
        subject: `different-${suffix}`,
        email: owner.user.email,
        displayName: "OIDC Owner",
        allowBootstrap: false,
      })).rejects.toMatchObject({ code: "23505" });
    } finally {
      await sql`DELETE FROM organization WHERE id = ${owner.workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${owner.user.id}`;
    }
  });

  it("rejects unknown accounts unless the deployment explicitly bootstraps the email", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(sql);
    const suffix = randomUUID();
    const email = `bootstrap-${suffix}@example.test`;
    await expect(repository.completeOidcSignIn({
      issuer: "https://identity.example.test/tenant",
      subject: `unknown-${suffix}`,
      email,
      displayName: "Bootstrap Owner",
      allowBootstrap: false,
    })).resolves.toEqual({ status: "not_provisioned" });

    const result = await repository.completeOidcSignIn({
      issuer: "https://identity.example.test/tenant",
      subject: `bootstrap-${suffix}`,
      email,
      displayName: "Bootstrap Owner",
      allowBootstrap: true,
    });
    expect(result).toMatchObject({ status: "bootstrapped", user: { email, displayName: "Bootstrap Owner" } });
    if (result.status === "not_provisioned") throw new Error("Expected a bootstrapped account");
    try {
      await expect(repository.listWorkspaceAccess(result.user.id)).resolves.toEqual([
        expect.objectContaining({ role: "owner", workspaceName: "Market Me" }),
      ]);
    } finally {
      const organizations = await sql<{ organizationId: string }[]>`
        SELECT organization_id FROM organization_membership WHERE user_id = ${result.user.id}
      `;
      for (const row of organizations) await sql`DELETE FROM organization WHERE id = ${row.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${result.user.id}`;
    }
  });

  it("accepts an unexpired exact-email workspace invitation without open registration", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const repository = new MarketMeRepository(sql);
    const suffix = randomUUID();
    const owner = await repository.bootstrapDevelopmentWorkspace({
      email: `inviter-${suffix}@market-me.local`,
      displayName: "Invitation Owner",
    });
    const invitedEmail = `invited-${suffix}@example.test`;
    let invitedUserId: string | undefined;
    try {
      const invitation = await repository.createWorkspaceInvitation({
        workspaceId: owner.workspace.workspaceId,
        email: invitedEmail.toUpperCase(),
        role: "editor",
        invitedBy: owner.user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await expect(repository.createWorkspaceInvitation({
        workspaceId: owner.workspace.workspaceId,
        email: invitedEmail,
        role: "viewer",
        invitedBy: owner.user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })).resolves.toEqual(invitation);

      const result = await repository.completeOidcSignIn({
        issuer: "https://identity.example.test/tenant",
        subject: `invited-${suffix}`,
        email: invitedEmail,
        displayName: "Invited Editor",
        allowBootstrap: false,
      });
      expect(result).toMatchObject({ status: "invited", user: { email: invitedEmail } });
      if (result.status === "not_provisioned") throw new Error("Expected invitation acceptance");
      invitedUserId = result.user.id;
      await expect(repository.getWorkspaceAccess(result.user.id, owner.workspace.workspaceId)).resolves.toMatchObject({
        role: "editor",
      });
      await expect(repository.listWorkspaceInvitations(owner.workspace.workspaceId)).resolves.toEqual([
        expect.objectContaining({ id: invitation.id, status: "accepted", acceptedBy: result.user.id }),
      ]);
      const audit = await sql<{ eventType: string; data: { role: string } }[]>`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND subject_id = ${invitation.id}
        ORDER BY created_at
      `;
      expect(audit).toEqual([
        { eventType: "workspace.invitation_created", data: { role: "editor" } },
        { eventType: "workspace.invitation_accepted", data: { role: "editor" } },
      ]);
    } finally {
      await sql`DELETE FROM organization WHERE id = ${owner.workspace.organizationId}`;
      if (invitedUserId) await sql`DELETE FROM app_user WHERE id = ${invitedUserId}`;
      await sql`DELETE FROM app_user WHERE id = ${owner.user.id}`;
    }
  });
});
