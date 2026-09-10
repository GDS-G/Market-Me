import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI routing preferences", () => {
  afterAll(async () => sql?.end());

  it("replaces only approved action-compatible routes with writer authority", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `routing-owner-${suffix}@market-me.local`,
      displayName: "Routing Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `routing-viewer-${suffix}@market-me.local`,
      displayName: "Routing Viewer",
    });
    const local = {
      provider: "market-me",
      model: "grounded-template",
    };

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      const input = {
        workspaceId: owner.workspace.workspaceId,
        preferences: [
          { action: "prepare_copy" as const, ...local },
          { action: "plan_campaign" as const, ...local },
        ],
      };
      await expect(
        ai.replaceRoutingPreferences(input, viewer.user.id),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(
        ai.replaceRoutingPreferences(
          {
            workspaceId: owner.workspace.workspaceId,
            preferences: [
              {
                action: "discover_profiles_and_content",
                ...local,
              },
            ],
          },
          owner.user.id,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(
        ai.replaceRoutingPreferences(
          {
            workspaceId: owner.workspace.workspaceId,
            preferences: [
              {
                action: "prepare_copy",
                provider: "unknown-provider",
                model: "unknown-model",
              },
            ],
          },
          owner.user.id,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      expect(
        await ai.replaceRoutingPreferences(input, owner.user.id),
      ).toMatchObject([
        { action: "plan_campaign", ...local },
        { action: "prepare_copy", ...local },
      ]);
      expect(
        await ai.replaceRoutingPreferences(
          {
            workspaceId: owner.workspace.workspaceId,
            preferences: [input.preferences[0]!],
          },
          owner.user.id,
        ),
      ).toMatchObject([{ action: "prepare_copy", ...local }]);
      const audits = await sql<{ data: { preferences: unknown[] } }[]>`
        SELECT data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type = 'ai.routing_preferences_saved'
        ORDER BY created_at
      `;
      expect(audits).toHaveLength(2);
      expect(audits[1]?.data.preferences).toEqual([
        { action: "prepare_copy", ...local },
      ]);
    } finally {
      await sql`
        DELETE FROM organization
        WHERE id IN (${owner.workspace.organizationId}, ${viewer.workspace.organizationId})
      `;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${viewer.user.id})`;
    }
  });
});
