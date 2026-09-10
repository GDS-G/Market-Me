import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI provider adapter registry", () => {
  afterAll(async () => sql?.end());

  it("loads governed adapter metadata and validates preferences from the durable catalog", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const provider = `registry-test-${suffix}`;
    const model = "rerank-v1";
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `registry-owner-${suffix}@market-me.local`,
      displayName: "Registry Owner",
    });

    try {
      const seeded = (await ai.listProviderAdapters()).find(
        (adapter) =>
          adapter.provider === "market-me" &&
          adapter.model === "grounded-template",
      );
      expect(seeded).toMatchObject({
        displayName: "Market Me grounded templates",
        capabilities: ["generate_structured_output", "generate_text"],
        privacyClass: "local",
        available: true,
        approved: true,
        requiresPaidReservation: false,
        configurationSource: "built_in",
      });

      await sql`
        INSERT INTO ai_provider_adapter (
          provider, model, display_name, privacy_class, quality, speed, cost,
          context_limit, is_available, is_approved, requires_paid_reservation,
          configuration_source, verified_at
        ) VALUES (
          ${provider}, ${model}, 'Integration reranker', 'private_cloud',
          'enhanced', 'balanced', 'medium', 16000, true, true, true,
          'administrator', now()
        )
      `;
      await sql`
        INSERT INTO ai_provider_adapter_capability (provider, model, capability)
        VALUES (${provider}, ${model}, 'rerank')
      `;

      expect(await ai.listProviderAdapters()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            provider,
            model,
            capabilities: ["rerank"],
            available: true,
            approved: true,
            requiresPaidReservation: true,
          }),
        ]),
      );
      expect(await ai.getProviderAdapterRegistrySummary()).toMatchObject({
        approvedAdapterCount: expect.any(Number),
        availableAdapterCount: expect.any(Number),
        paidReservationAdapterCount: expect.any(Number),
        capabilityCount: expect.any(Number),
      });

      await expect(
        ai.replaceRoutingPreferences(
          {
            workspaceId: owner.workspace.workspaceId,
            preferences: [
              {
                action: "discover_profiles_and_content",
                provider,
                model,
              },
            ],
          },
          owner.user.id,
        ),
      ).resolves.toMatchObject([
        { action: "discover_profiles_and_content", provider, model },
      ]);
    } finally {
      await sql`DELETE FROM organization WHERE id = ${owner.workspace.organizationId}`;
      await sql`DELETE FROM app_user WHERE id = ${owner.user.id}`;
      await sql`DELETE FROM ai_provider_adapter WHERE provider = ${provider} AND model = ${model}`;
    }
  });
});
