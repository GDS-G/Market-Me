import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI assistant assignments", () => {
  afterAll(async () => sql?.end());

  it("replaces compatible workspace choices with writer authorization", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `assistant-owner-${suffix}@market-me.local`,
      displayName: "Assistant Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `assistant-viewer-${suffix}@market-me.local`,
      displayName: "Assistant Viewer",
    });

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      const input = {
        workspaceId: owner.workspace.workspaceId,
        assignments: [
          {
            action: "prepare_copy" as const,
            profileId: "conversation_assistant" as const,
          },
          {
            action: "plan_campaign" as const,
            profileId: "performance_analyst" as const,
          },
        ],
      };
      await expect(
        ai.replaceAssistantAssignments(input, viewer.user.id),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(
        ai.replaceAssistantAssignments(
          {
            workspaceId: owner.workspace.workspaceId,
            assignments: [
              {
                action: "prepare_copy",
                profileId: "performance_analyst",
              },
            ],
          },
          owner.user.id,
        ),
      ).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      expect(
        await ai.replaceAssistantAssignments(input, owner.user.id),
      ).toMatchObject([
        { action: "plan_campaign", profileId: "performance_analyst" },
        { action: "prepare_copy", profileId: "conversation_assistant" },
      ]);
      expect(
        await ai.replaceAssistantAssignments(
          {
            workspaceId: owner.workspace.workspaceId,
            assignments: [input.assignments[0]!],
          },
          owner.user.id,
        ),
      ).toMatchObject([
        { action: "prepare_copy", profileId: "conversation_assistant" },
      ]);
      const audits = await sql<{ data: { assignments: unknown[] } }[]>`
        SELECT data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND event_type = 'ai.assistant_assignments_saved'
        ORDER BY created_at
      `;
      expect(audits).toHaveLength(2);
      expect(audits[1]?.data.assignments).toEqual([
        {
          action: "prepare_copy",
          profileId: "conversation_assistant",
        },
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
