import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient, type DatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";

const databaseUrl = process.env.DATABASE_URL;
let sql: DatabaseClient | undefined;

describe.skipIf(!databaseUrl)("AI provider connections", () => {
  afterAll(async () => sql?.end());

  it("stores encrypted credentials with writer authority and erases them on replay-safe revoke", async () => {
    sql = createDatabaseClient(databaseUrl!);
    const core = new MarketMeRepository(sql);
    const ai = new AiRepository(sql);
    const suffix = randomUUID();
    const owner = await core.bootstrapDevelopmentWorkspace({
      email: `provider-owner-${suffix}@market-me.local`,
      displayName: "Provider Owner",
    });
    const viewer = await core.bootstrapDevelopmentWorkspace({
      email: `provider-viewer-${suffix}@market-me.local`,
      displayName: "Provider Viewer",
    });
    const firstEnvelope = "v1.fixture-iv.fixture-tag.fixture-ciphertext-one";
    const secondEnvelope = "v1.fixture-iv.fixture-tag.fixture-ciphertext-two";
    const firstFingerprint = "1".repeat(64);
    const secondFingerprint = "2".repeat(64);
    const rateCardId = randomUUID();
    const invocationContractId = "00000000-0000-4000-8000-000000000741";

    try {
      await sql`
        INSERT INTO workspace_membership (workspace_id, user_id, role)
        VALUES (${owner.workspace.workspaceId}, ${viewer.user.id}, 'viewer')
      `;
      expect(await ai.getWorkspaceAiOperationalIncidentResponsePolicy(
        owner.workspace.workspaceId, owner.user.id,
      )).toMatchObject({
        configured: false,
        criticalAcknowledgementMinutes: 5,
        highAcknowledgementMinutes: 30,
        criticalResolutionMinutes: 60,
        highResolutionMinutes: 240,
        executionAuthority: false,
        externalAlertDeliveryConfigured: false,
      });
      await expect(ai.saveWorkspaceAiOperationalIncidentResponsePolicy({
        workspaceId: owner.workspace.workspaceId,
        criticalAcknowledgementMinutes: 5,
        highAcknowledgementMinutes: 30,
        criticalResolutionMinutes: 60,
        highResolutionMinutes: 240,
        runbookUrl: "https://operations.example.test/runbooks/ai-incidents",
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.saveWorkspaceAiOperationalIncidentResponsePolicy({
        workspaceId: owner.workspace.workspaceId,
        criticalAcknowledgementMinutes: 5,
        highAcknowledgementMinutes: 30,
        criticalResolutionMinutes: 60,
        highResolutionMinutes: 240,
        runbookUrl: "https://operations.example.test/runbooks/ai-incidents",
      }, owner.user.id)).toMatchObject({
        configured: true,
        runbookUrl: "https://operations.example.test/runbooks/ai-incidents",
        executionAuthority: false,
        externalAlertDeliveryConfigured: false,
      });
      await expect(ai.saveProviderConnection({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        encryptedCredential: firstEnvelope,
        credentialFingerprint: firstFingerprint,
        encryptionKeyVersion: "v1",
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });

      expect(await ai.saveProviderConnection({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        encryptedCredential: firstEnvelope,
        credentialFingerprint: firstFingerprint,
        encryptionKeyVersion: "v1",
      }, owner.user.id)).toMatchObject({
        provider: "openai",
        status: "unverified",
        credentialConfigured: true,
        execution: false,
      });
      const publicRead = await ai.listProviderConnections(
        owner.workspace.workspaceId,
        viewer.user.id,
      );
      expect(publicRead[0]).not.toHaveProperty("encryptedCredential");
      expect(publicRead[0]).not.toHaveProperty("credentialFingerprint");
      expect((await sql<{ encryptedCredential: string }[]>`
        SELECT encrypted_credential FROM workspace_ai_provider_connection
        WHERE workspace_id = ${owner.workspace.workspaceId} AND provider = 'openai'
      `)[0]?.encryptedCredential).toBe(firstEnvelope);

      await expect(ai.getProviderConnectionVerificationTarget(
        owner.workspace.workspaceId,
        "openai",
        viewer.user.id,
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.getProviderConnectionVerificationTarget(
        owner.workspace.workspaceId,
        "openai",
        owner.user.id,
      )).toMatchObject({
        encryptedCredential: firstEnvelope,
        credentialFingerprint: firstFingerprint,
      });
      expect(await ai.recordProviderConnectionVerification({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        expectedCredentialFingerprint: firstFingerprint,
        status: "verified",
      }, owner.user.id)).toMatchObject({
        status: "verified",
        credentialConfigured: true,
        execution: false,
      });
      await expect(ai.listProviderModelInventory(
        owner.workspace.workspaceId,
        "openai",
        viewer.user.id,
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const inventory = await ai.replaceProviderModelInventory({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        expectedCredentialFingerprint: firstFingerprint,
        models: [
          { modelId: "gpt-example-a", inputTokenLimit: 128000, providerCreatedAt: "2026-01-01T00:00:00.000Z" },
          { modelId: "gpt-example-b" },
        ],
      }, owner.user.id);
      expect(inventory.summary).toMatchObject({
        totalModelCount: 2,
        activeModelCount: 2,
        retiredModelCount: 0,
        adapterActivation: false,
        execution: false,
      });
      expect(inventory.models[0]).not.toHaveProperty("credentialFingerprint");
      await sql`
        UPDATE workspace_membership SET role = 'editor'
        WHERE workspace_id = ${owner.workspace.workspaceId} AND user_id = ${viewer.user.id}
      `;
      const candidate = await ai.submitWorkspaceAdapterCandidate({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        modelId: "gpt-example-a",
        displayName: "GPT Example A",
        capabilities: ["generate_text", "generate_structured_output"],
        quality: "enhanced",
        speed: "balanced",
        cost: "medium",
        contextLimit: 128000,
        evidenceReference: "https://example.invalid/qa-evidence",
        evidenceSha256: "a".repeat(64),
      }, viewer.user.id);
      expect(candidate).toMatchObject({
        status: "pending",
        privacyClass: "cloud",
        requiresPaidReservation: true,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      });
      await expect(ai.decideWorkspaceAdapterCandidate({
        workspaceId: owner.workspace.workspaceId,
        candidateId: candidate.id,
        decision: "approved",
        reviewNote: "Editor cannot approve this candidate.",
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.decideWorkspaceAdapterCandidate({
        workspaceId: owner.workspace.workspaceId,
        candidateId: candidate.id,
        decision: "approved",
        reviewNote: "QA evidence reviewed for governance only.",
      }, owner.user.id)).toMatchObject({
        status: "approved",
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      });
      await expect(ai.registerWorkspaceAdapter({
        workspaceId: owner.workspace.workspaceId,
        candidateId: candidate.id,
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const registration = await ai.registerWorkspaceAdapter({
        workspaceId: owner.workspace.workspaceId,
        candidateId: candidate.id,
      }, owner.user.id);
      expect(registration).toMatchObject({
        candidateId: candidate.id,
        status: "registered",
        capabilities: ["generate_structured_output", "generate_text"],
        privacyClass: "cloud",
        requiresPaidReservation: true,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      });
      expect(await ai.listWorkspaceAdapterRegistrations(
        owner.workspace.workspaceId,
        viewer.user.id,
      )).toHaveLength(1);
      await sql`
        INSERT INTO ai_provider_rate_card (
          id, provider, model_family, model_version, currency,
          minor_unit_exponent, status, effective_from,
          source_reference, source_hash, verified_at, approved_at
        ) VALUES (
          ${rateCardId}, 'openai', 'gpt-example-a', 'qa-2026-08', 'USD',
          2, 'approved', '2026-01-01T00:00:00.000Z',
          'https://example.invalid/qa-pricing', ${"f".repeat(64)},
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `;
      await sql`
        INSERT INTO ai_provider_rate_component (
          rate_card_id, kind, unit, unit_quantity, price_micros
        ) VALUES
          (${rateCardId}, 'input', 'token', 1000000, 2500000),
          (${rateCardId}, 'output', 'token', 1000000, 10000000)
      `;
      await expect(ai.bindWorkspaceAdapterRateCard({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateCardId,
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const binding = await ai.bindWorkspaceAdapterRateCard({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateCardId,
      }, owner.user.id);
      expect(binding).toMatchObject({
        status: "bound",
        provider: "openai",
        modelId: "gpt-example-a",
        currency: "USD",
        modelVersion: "qa-2026-08",
        evidenceCurrent: true,
        pricingReady: true,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      });
      expect(binding.components).toEqual([
        { kind: "input", unit: "token", unitQuantity: 1000000, priceMicros: 2500000 },
        { kind: "output", unit: "token", unitQuantity: 1000000, priceMicros: 10000000 },
      ]);
      expect(await ai.listProviderInvocationContracts(
        owner.workspace.workspaceId,
        viewer.user.id,
      )).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: invocationContractId,
          provider: "openai",
          contractKey: "openai-hosted-json",
          status: "approved",
          codecAvailable: true,
          codecVersion: "text-codec-v1",
          transportAvailable: true,
          transportVersion: "fixed-https-text-v1",
          implementationVersion: "hosted-text-implementation-v1",
          implementationAvailable: true,
          healthReady: false,
          execution: false,
        }),
      ]));
      await expect(ai.configureWorkspaceAdapterInvocation({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateBindingId: binding.id,
        contractId: invocationContractId,
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const invocation = await ai.configureWorkspaceAdapterInvocation({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateBindingId: binding.id,
        contractId: invocationContractId,
      }, owner.user.id);
      expect(invocation).toMatchObject({
        status: "configured",
        provider: "openai",
        modelId: "gpt-example-a",
        rateCardId,
        pricingCurrency: "USD",
        contractKey: "openai-hosted-json",
        contractVersion: "contract-v4",
        codecAvailable: true,
        codecVersion: "text-codec-v1",
        transportAvailable: true,
        transportVersion: "fixed-https-text-v1",
        configurationCurrent: true,
        implementationVersion: "hosted-text-implementation-v1",
        implementationAvailable: true,
        healthReady: false,
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      });
      await expect(ai.getWorkspaceAdapterHealthProbeTarget(
        owner.workspace.workspaceId,
        invocation.id,
        viewer.user.id,
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const healthTarget = await ai.getWorkspaceAdapterHealthProbeTarget(
        owner.workspace.workspaceId,
        invocation.id,
        owner.user.id,
      );
      expect(healthTarget).toMatchObject({
        provider: "openai",
        encryptedCredential: firstEnvelope,
        credentialFingerprint: firstFingerprint,
      });
      expect(await ai.recordWorkspaceAdapterHealthObservation({
        workspaceId: owner.workspace.workspaceId,
        invocationBindingId: invocation.id,
        provider: "openai",
        expectedCredentialFingerprint: firstFingerprint,
        expectedContractSourceHash: healthTarget.contractSourceHash,
        status: "healthy",
      }, owner.user.id)).toMatchObject({
        status: "healthy",
        evidenceCurrent: true,
        providerRequest: true,
        providerResponseStored: false,
        generation: false,
        implementationAvailable: true,
        healthReady: true,
        routingAvailable: false,
        execution: false,
      });
      expect((await ai.listWorkspaceAdapterInvocationBindings(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        rateCardId,
        providerHealthEvidenceCurrent: true,
        implementationAvailable: true,
        healthReady: true,
        execution: false,
      });
      const textQuote = await ai.createCostQuote({
        workspaceId: owner.workspace.workspaceId,
        rateCardId,
        capability: "generate_text",
        feature: "assistant.prepare_copy",
        forecasts: [
          { kind: "input", unit: "token", minimumUnits: 100, maximumUnits: 200 },
          { kind: "output", unit: "token", minimumUnits: 50, maximumUnits: 100 },
        ],
      }, owner.user.id);
      const textReservation = await ai.reserveQuotedSpend({
        workspaceId: owner.workspace.workspaceId,
        quoteId: textQuote.id,
        idempotencyKey: randomUUID(),
      }, owner.user.id);
      const intentWrite = {
        workspaceId: owner.workspace.workspaceId,
        invocationBindingId: invocation.id,
        reservationId: textReservation.id,
        idempotencyKey: randomUUID(),
        systemText: "Follow the approved workspace voice.",
        userText: "Prepare a concise launch announcement.",
        maxOutputTokens: 512,
      };
      const textIntent = await ai.prepareWorkspaceTextInvocationIntent(intentWrite, owner.user.id);
      expect(textIntent).toMatchObject({
        reservationId: textReservation.id,
        costQuoteId: textQuote.id,
        provider: "openai",
        modelId: "gpt-example-a",
        feature: "assistant.prepare_copy",
        status: "prepared",
        authorizationCurrent: true,
        promptStored: false,
        providerRequest: false,
        outputStored: false,
        usageRecorded: false,
        settlement: false,
        routingAvailable: false,
        execution: false,
      });
      expect(await ai.prepareWorkspaceTextInvocationIntent(intentWrite, owner.user.id)).toMatchObject({ id: textIntent.id });
      await expect(ai.prepareWorkspaceTextInvocationIntent({
        ...intentWrite,
        userText: "A different request cannot reuse the key.",
      }, owner.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const privateIntent = (await sql<{
        userTextSha256: string;
        systemTextSha256: string;
        credentialFingerprint: string;
        requestHash: string;
      }[]>`
        SELECT user_text_sha256, system_text_sha256,
          credential_fingerprint, request_hash
        FROM workspace_ai_text_invocation_intent WHERE id = ${textIntent.id}
      `)[0]!;
      expect(privateIntent.userTextSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(privateIntent.systemTextSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(privateIntent.credentialFingerprint).toBe(firstFingerprint);
      expect(privateIntent.requestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(textIntent)).not.toContain(intentWrite.userText);
      expect(await ai.cancelWorkspaceTextInvocationIntent({
        workspaceId: owner.workspace.workspaceId,
        intentId: textIntent.id,
        reason: "QA cancellation releases the exact reservation.",
      }, owner.user.id)).toMatchObject({
        status: "cancelled",
        authorizationCurrent: false,
        settlement: false,
        execution: false,
      });
      expect((await sql<{ status: string }[]>`
        SELECT status FROM ai_spend_reservation WHERE id = ${textReservation.id}
      `)[0]?.status).toBe("released");
      expect(await ai.getWorkspaceExecutionControl(
        owner.workspace.workspaceId,
        owner.user.id,
      )).toMatchObject({ state: "stopped", configured: false, executionAllowed: false });
      await expect(ai.saveWorkspaceExecutionControl({
        workspaceId: owner.workspace.workspaceId,
        state: "enabled",
        reason: "Editor must not release provider execution.",
        enabledForMinutes: 60,
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.saveWorkspaceExecutionControl({
        workspaceId: owner.workspace.workspaceId,
        state: "enabled",
        reason: "Release integration verification window.",
        enabledForMinutes: 60,
      }, owner.user.id)).toMatchObject({
        state: "enabled",
        configured: true,
        executionAllowed: true,
      });
      const prepareAdditionalExecution = async (prompt: string) => {
        const quote = await ai.createCostQuote({
          workspaceId: owner.workspace.workspaceId,
          rateCardId,
          capability: "generate_text",
          feature: "assistant.prepare_copy",
          forecasts: [
            { kind: "input" as const, unit: "token" as const, minimumUnits: 1, maximumUnits: 10 },
            { kind: "output" as const, unit: "token" as const, minimumUnits: 1, maximumUnits: 10 },
          ],
        }, owner.user.id);
        const reservation = await ai.reserveQuotedSpend({
          workspaceId: owner.workspace.workspaceId,
          quoteId: quote.id,
          idempotencyKey: randomUUID(),
        }, owner.user.id);
        const intent = await ai.prepareWorkspaceTextInvocationIntent({
          workspaceId: owner.workspace.workspaceId,
          invocationBindingId: invocation.id,
          reservationId: reservation.id,
          idempotencyKey: randomUUID(),
          userText: prompt,
          maxOutputTokens: 64,
        }, owner.user.id);
        return { intent, reservation };
      };
      const attemptQuote = await ai.createCostQuote({
        workspaceId: owner.workspace.workspaceId,
        rateCardId,
        capability: "generate_text",
        feature: "assistant.prepare_copy",
        forecasts: [
          { kind: "input", unit: "token", minimumUnits: 101, maximumUnits: 201 },
          { kind: "output", unit: "token", minimumUnits: 51, maximumUnits: 101 },
        ],
      }, owner.user.id);
      const attemptReservation = await ai.reserveQuotedSpend({
        workspaceId: owner.workspace.workspaceId,
        quoteId: attemptQuote.id,
        idempotencyKey: randomUUID(),
      }, owner.user.id);
      const attemptPrompt = "Prepare a second bounded QA announcement.";
      const attemptIntent = await ai.prepareWorkspaceTextInvocationIntent({
        workspaceId: owner.workspace.workspaceId,
        invocationBindingId: invocation.id,
        reservationId: attemptReservation.id,
        idempotencyKey: randomUUID(),
        userText: attemptPrompt,
        maxOutputTokens: 256,
      }, owner.user.id);
      await expect(ai.settleSpend({
        workspaceId: owner.workspace.workspaceId,
        reservationId: attemptReservation.id,
        actualCostMinor: 1,
        usage: {
          provider: "bypass-forbidden",
          model: "bypass-forbidden",
          privacyClass: "cloud",
          inputUnits: 1,
          outputUnits: 1,
          cachedInputUnits: 0,
          latencyMs: 1,
        },
      }, owner.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: attemptIntent.id,
        userText: "Prompt substitution is forbidden.",
      }, owner.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const attemptTarget = await ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: attemptIntent.id,
        userText: attemptPrompt,
      }, owner.user.id);
      expect(attemptTarget).toMatchObject({
        workspaceId: owner.workspace.workspaceId,
        intentId: attemptIntent.id,
        provider: "openai",
        modelId: "gpt-example-a",
        encryptedCredential: firstEnvelope,
        credentialFingerprint: firstFingerprint,
      });
      await expect(ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: attemptIntent.id,
        userText: attemptPrompt,
      }, owner.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const completedAttempt = await ai.completeWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        attemptId: attemptTarget.attemptId,
        expectedCredentialFingerprint: firstFingerprint,
        expectedContractSourceHash: attemptTarget.contractSourceHash,
        outcome: {
          status: "succeeded",
          outputText: "A private QA output that must not be projected.",
          encryptedOutput: "v1.fixture-iv.fixture-tag.fixture-encrypted-output",
          encryptionKeyVersion: "v1",
          responseId: "resp-private-qa",
          stopReason: "completed",
          inputTokens: 9,
          outputTokens: 11,
          latencyMs: 25,
        },
      }, owner.user.id);
      expect(completedAttempt).toMatchObject({
        status: "succeeded",
        providerRequestStatus: "sent",
        outputStored: true,
        outputEncrypted: true,
        outputHashStored: true,
        providerResponseIdStored: false,
        providerResponseIdHashStored: true,
        usageRecorded: false,
        settlement: false,
        retryAllowed: false,
        attemptComplete: true,
        providerExecutionSucceeded: true,
      });
      expect(JSON.stringify(completedAttempt)).not.toContain("private QA output");
      expect((await sql<{ status: string; actualCostMinor: number }[]>`
        SELECT status, actual_cost_minor
        FROM workspace_ai_text_invocation_reconciliation
        WHERE attempt_id = ${attemptTarget.attemptId}
      `)[0]).toMatchObject({ status: "settled", actualCostMinor: 1 });
      expect((await sql<{ status: string; actualCostMinor: number }[]>`
        SELECT status, actual_cost_minor FROM ai_spend_reservation
        WHERE id = ${attemptReservation.id}
      `)[0]).toMatchObject({ status: "settled", actualCostMinor: 1 });
      const artifacts = await ai.listWorkspaceTextOutputArtifacts(
        owner.workspace.workspaceId, owner.user.id,
      );
      expect(artifacts[0]).toMatchObject({
        attemptId: attemptTarget.attemptId,
        status: "pending_review",
        outputEncrypted: true,
        outputReturned: false,
        outputHashReturned: false,
        publishingAuthorized: false,
      });
      expect(JSON.stringify(artifacts)).not.toContain("private QA output");
      expect(JSON.stringify(artifacts)).not.toContain("fixture-encrypted-output");
      await expect(ai.getWorkspaceTextOutputArtifactReadTarget(
        owner.workspace.workspaceId, artifacts[0]!.id, viewer.user.id,
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.getWorkspaceTextOutputArtifactReadTarget(
        owner.workspace.workspaceId, artifacts[0]!.id, owner.user.id,
      )).toMatchObject({
        encryptedOutput: "v1.fixture-iv.fixture-tag.fixture-encrypted-output",
        encryptionKeyVersion: "v1",
      });
      expect(await ai.reviewWorkspaceTextOutputArtifact({
        workspaceId: owner.workspace.workspaceId,
        artifactId: artifacts[0]!.id,
        decision: "accepted",
        reviewNote: "Approved during encrypted output QA.",
      }, owner.user.id)).toMatchObject({
        status: "accepted",
        reviewNote: "Approved during encrypted output QA.",
        publishingAuthorized: false,
      });
      const proposalSmartSourceId = randomUUID();
      const proposalSourceItemId = randomUUID();
      const proposalPackageId = randomUUID();
      const proposalEvidenceId = randomUUID();
      const proposalCampaignId = randomUUID();
      const proposalCampaignVersionId = randomUUID();
      const proposalGenerationId = randomUUID();
      const proposalDraftId = randomUUID();
      const proposalDraftVersionId = randomUUID();
      const proposalClaimId = randomUUID();
      await sql`
        INSERT INTO smart_source (
          id, workspace_id, name, provider, readiness_mode,
          stabilization_window_seconds, autonomy_mode, created_by
        ) VALUES (${proposalSmartSourceId}, ${owner.workspace.workspaceId},
          'AI proposal fixture', 'local', 'immediate', 0,
          'draft_only', ${owner.user.id})
      `;
      await sql`
        INSERT INTO source_item (
          id, workspace_id, smart_source_id, provider_item_id,
          name, display_path, mime_type
        ) VALUES (${proposalSourceItemId}, ${owner.workspace.workspaceId},
          ${proposalSmartSourceId}, 'proposal-fixture', 'proposal.txt',
          'proposal.txt', 'text/plain')
      `;
      await sql`
        INSERT INTO content_package (
          id, workspace_id, smart_source_id, root_source_item_id,
          title, status
        ) VALUES (${proposalPackageId}, ${owner.workspace.workspaceId},
          ${proposalSmartSourceId}, ${proposalSourceItemId},
          'AI proposal package', 'approved')
      `;
      await sql`
        INSERT INTO evidence_item (
          id, content_package_id, fact_key, claim, provenance,
          source_references, confidence
        ) VALUES (
          ${proposalEvidenceId}, ${proposalPackageId}, 'governed-proposal-fact',
          'Existing evidence-backed copy', 'observed',
          ${['proposal.txt']}, 1
        )
      `;
      await sql`
        INSERT INTO campaign (id, workspace_id, name, status, created_by)
        VALUES (${proposalCampaignId}, ${owner.workspace.workspaceId},
          'AI proposal campaign', 'draft', ${owner.user.id})
      `;
      await sql`
        INSERT INTO campaign_version (
          id, campaign_id, version_number, status, objective,
          content_package_ids, information_depth, promotional_strength,
          autonomy_mode, created_by
        ) VALUES (${proposalCampaignVersionId}, ${proposalCampaignId}, 1,
          'published', 'awareness', ${[proposalPackageId]}, 'minimal',
          'informational', 'draft_only', ${owner.user.id})
      `;
      await sql`UPDATE campaign SET current_version_id = ${proposalCampaignVersionId} WHERE id = ${proposalCampaignId}`;
      await sql`
        INSERT INTO draft_generation (
          id, workspace_id, campaign_version_id, content_package_id,
          content_package_version, information_depth, promotional_strength,
          evidence_snapshot, generator_provider, generator_model,
          generator_version, prompt_version, draft_format, created_by
        ) VALUES (${proposalGenerationId}, ${owner.workspace.workspaceId},
          ${proposalCampaignVersionId}, ${proposalPackageId}, 1, 'minimal',
          'informational', '[]'::jsonb, 'fixture', 'fixture', 'fixture-v1',
          'fixture-v1', 'channel_neutral', ${owner.user.id})
      `;
      await sql`
        INSERT INTO content_draft (
          id, workspace_id, draft_generation_id, status,
          current_version_id, created_by
        ) VALUES (${proposalDraftId}, ${owner.workspace.workspaceId},
          ${proposalGenerationId}, 'working', null, ${owner.user.id})
      `;
      await sql`
        INSERT INTO content_draft_version (
          id, content_draft_id, version_number, status, headline, body,
          rationale, presentation_choices, created_by
        ) VALUES (${proposalDraftVersionId}, ${proposalDraftId}, 1, 'working',
          'Governed proposal target', 'Existing evidence-backed copy.',
          'Fixture rationale.', '{}'::jsonb, ${owner.user.id})
      `;
      await sql`UPDATE content_draft SET current_version_id = ${proposalDraftVersionId} WHERE id = ${proposalDraftId}`;
      await sql`
        INSERT INTO content_draft_claim (
          id, content_draft_version_id, kind, claim_text, sort_order
        ) VALUES (
          ${proposalClaimId}, ${proposalDraftVersionId}, 'fact',
          'Existing evidence-backed copy', 0
        )
      `;
      await sql`
        INSERT INTO content_draft_claim_evidence (
          content_draft_claim_id, evidence_item_id
        ) VALUES (${proposalClaimId}, ${proposalEvidenceId})
      `;
      const draftRevisionQuote = await ai.createCostQuote({
        workspaceId: owner.workspace.workspaceId,
        rateCardId,
        capability: "generate_text",
        feature: "assistant.prepare_copy",
        forecasts: [
          { kind: "input", unit: "token", minimumUnits: 20, maximumUnits: 200 },
          { kind: "output", unit: "token", minimumUnits: 10, maximumUnits: 100 },
        ],
      }, owner.user.id);
      const draftRevisionReservation = await ai.reserveQuotedSpend({
        workspaceId: owner.workspace.workspaceId,
        quoteId: draftRevisionQuote.id,
        idempotencyKey: randomUUID(),
      }, owner.user.id);
      const draftRevision = await ai.prepareWorkspaceDraftRevisionIntent({
        workspaceId: owner.workspace.workspaceId,
        contentDraftId: proposalDraftId,
        invocationBindingId: invocation.id,
        reservationId: draftRevisionReservation.id,
        idempotencyKey: randomUUID(),
        goal: "clarity",
        maxOutputTokens: 512,
      }, owner.user.id);
      expect(draftRevision.intent).toMatchObject({
        sourceContentDraftId: proposalDraftId,
        sourceContentDraftVersionId: proposalDraftVersionId,
        draftRevisionGoal: "clarity",
        productPromptVersion: "draft-revision-v2",
        productBound: true,
        sourceContextHashStored: true,
        authorizationCurrent: true,
        promptStored: false,
        providerRequest: false,
        execution: false,
      });
      expect(JSON.stringify(draftRevision.intent)).not.toContain("Existing evidence-backed copy");
      expect(draftRevision.prompt.userText).toContain("Existing evidence-backed copy");
      expect(draftRevision.prompt.userText).toContain(proposalEvidenceId);
      expect(draftRevision.prompt.systemText).toContain("review-only copy assistant");
      expect(draftRevision.prompt.systemText).toContain("draft-revision-suggestion-v1");
      expect((await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM audit_event
        WHERE subject_type = 'workspace_ai_text_invocation_intent'
          AND subject_id = ${draftRevision.intent.id}
          AND event_type = 'ai.text_invocation_intent_prepared'
      `)[0]?.data).toMatchObject({
        productBound: true,
        sourceContentDraftId: proposalDraftId,
        sourceContentDraftVersionId: proposalDraftVersionId,
        draftRevisionGoal: "clarity",
        promptIncluded: false,
        promptHashIncluded: false,
        sourceContextHashIncluded: false,
        draftMutationAuthority: false,
        publishingAuthority: false,
      });
      expect(await ai.getWorkspaceDraftRevisionExecutionPrompt(
        owner.workspace.workspaceId, draftRevision.intent.id, owner.user.id,
      )).toEqual(draftRevision.prompt);
      expect(await ai.cancelWorkspaceTextInvocationIntent({
        workspaceId: owner.workspace.workspaceId,
        intentId: draftRevision.intent.id,
        reason: "Close the prepared Draft revision fixture without provider I/O.",
      }, owner.user.id)).toMatchObject({
        status: "cancelled",
        productBound: true,
        sourceContentDraftId: proposalDraftId,
      });
      const proposal = await ai.attachWorkspaceTextOutputToDraft({
        workspaceId: owner.workspace.workspaceId,
        artifactId: artifacts[0]!.id,
        contentDraftId: proposalDraftId,
      }, owner.user.id);
      expect(proposal).toMatchObject({
        artifactId: artifacts[0]!.id,
        contentDraftId: proposalDraftId,
        sourceDraftVersionId: proposalDraftVersionId,
        status: 'attached',
        sourceCurrent: true,
        outputEncrypted: true,
        outputReturned: false,
        draftContentMutated: false,
        publishingAuthorized: false,
      });
      expect(await ai.attachWorkspaceTextOutputToDraft({
        workspaceId: owner.workspace.workspaceId,
        artifactId: artifacts[0]!.id,
        contentDraftId: proposalDraftId,
      }, owner.user.id)).toMatchObject({ id: proposal.id });
      expect(JSON.stringify(await ai.listWorkspaceTextDraftProposals(
        owner.workspace.workspaceId, proposalDraftId, viewer.user.id,
      ))).not.toContain('fixture-encrypted-output');
      expect(await ai.getWorkspaceTextDraftProposalReadTarget(
        owner.workspace.workspaceId, proposal.id, viewer.user.id,
      )).toMatchObject({ contentDraftId: proposalDraftId });
      expect(await ai.getWorkspaceTextDraftProposalReadTarget(
        owner.workspace.workspaceId, proposal.id, owner.user.id,
      )).toMatchObject({
        contentDraftId: proposalDraftId,
        encryptedOutput: 'v1.fixture-iv.fixture-tag.fixture-encrypted-output',
      });
      const appliedProposal = await ai.applyWorkspaceTextDraftProposal({
        workspaceId: owner.workspace.workspaceId,
        proposalId: proposal.id,
        leadIn: 'For proposal reviewers',
        callToAction: 'Review the governed details.',
        hashtags: ['#GovernedProposal'],
        altText: 'A governed proposal review fixture.',
        changeNote: 'Applied author-selected presentation fields during QA.',
      }, owner.user.id);
      expect(appliedProposal).toMatchObject({
        status: 'applied',
        applicationNote: 'Applied author-selected presentation fields during QA.',
        selectedFields: ['lead_in', 'call_to_action', 'hashtags', 'alt_text'],
        sourceCurrent: false,
        draftContentMutated: true,
        publishingAuthorized: false,
      });
      expect(appliedProposal.appliedVersionId).toBeTruthy();
      expect(await ai.applyWorkspaceTextDraftProposal({
        workspaceId: owner.workspace.workspaceId,
        proposalId: proposal.id,
        leadIn: 'For proposal reviewers',
        callToAction: 'Review the governed details.',
        hashtags: ['#GovernedProposal'],
        altText: 'A governed proposal review fixture.',
        changeNote: 'Applied author-selected presentation fields during QA.',
      }, owner.user.id)).toMatchObject({
        id: proposal.id,
        appliedVersionId: appliedProposal.appliedVersionId,
      });
      expect((await sql<{
        versionNumber: number;
        status: string;
        body: string;
        sourceVersionId: string;
        changeNote: string;
      }[]>`
        SELECT version_number, status, body, source_version_id, change_note
        FROM content_draft_version
        WHERE id = ${appliedProposal.appliedVersionId!}
      `)[0]).toMatchObject({
        versionNumber: 2,
        status: 'working',
        body: 'For proposal reviewers: Existing evidence-backed copy.',
        sourceVersionId: proposalDraftVersionId,
        changeNote: 'Applied author-selected presentation fields during QA.',
      });
      expect((await sql<{ status: string }[]>`
        SELECT status FROM content_draft_version WHERE id = ${proposalDraftVersionId}
      `)[0]?.status).toBe('superseded');
      expect(await sql`
        SELECT 1 FROM content_draft_version
        WHERE content_draft_id = ${proposalDraftId}
      `).toHaveLength(2);
      expect((await sql<{
        kind: string;
        text: string;
        evidenceItemIds: string[];
      }[]>`
        SELECT claim.kind, claim.claim_text AS text,
          COALESCE(array_agg(binding.evidence_item_id)
            FILTER (WHERE binding.evidence_item_id IS NOT NULL), '{}') AS evidence_item_ids
        FROM content_draft_claim claim
        LEFT JOIN content_draft_claim_evidence binding
          ON binding.content_draft_claim_id = claim.id
        WHERE claim.content_draft_version_id = ${appliedProposal.appliedVersionId!}
        GROUP BY claim.id
        ORDER BY min(claim.sort_order)
      `)[0]).toMatchObject({
        kind: 'fact',
        text: 'Existing evidence-backed copy',
        evidenceItemIds: [proposalEvidenceId],
      });
      await expect(ai.getWorkspaceTextDraftProposalReadTarget(
        owner.workspace.workspaceId, proposal.id, owner.user.id,
      )).rejects.toMatchObject({ name: 'AiPolicyValidationError' });
      await expect(ai.dismissWorkspaceTextDraftProposal({
        workspaceId: owner.workspace.workspaceId,
        proposalId: proposal.id,
        dismissalNote: 'Applied proposals are terminal.',
      }, owner.user.id)).rejects.toMatchObject({ name: 'AiPolicyValidationError' });
      expect((await ai.listWorkspaceTextInvocationReconciliations(
        owner.workspace.workspaceId, owner.user.id,
      ))[0]).toMatchObject({
        attemptId: attemptTarget.attemptId,
        status: "settled",
        actualCostMinor: 1,
        usageRecorded: true,
        reservationSettled: true,
        retryAllowed: false,
      });
      const quarantineQuote = await ai.createCostQuote({
        workspaceId: owner.workspace.workspaceId,
        rateCardId,
        capability: "generate_text",
        feature: "assistant.prepare_copy",
        forecasts: [
          { kind: "input", unit: "token", minimumUnits: 103, maximumUnits: 203 },
          { kind: "output", unit: "token", minimumUnits: 53, maximumUnits: 103 },
        ],
      }, owner.user.id);
      const quarantineReservation = await ai.reserveQuotedSpend({
        workspaceId: owner.workspace.workspaceId,
        quoteId: quarantineQuote.id,
        idempotencyKey: randomUUID(),
      }, owner.user.id);
      const quarantinePrompt = "Store output but quarantine missing usage evidence.";
      const quarantineIntent = await ai.prepareWorkspaceTextInvocationIntent({
        workspaceId: owner.workspace.workspaceId,
        invocationBindingId: invocation.id,
        reservationId: quarantineReservation.id,
        idempotencyKey: randomUUID(),
        userText: quarantinePrompt,
        maxOutputTokens: 128,
      }, owner.user.id);
      const quarantineTarget = await ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: quarantineIntent.id,
        userText: quarantinePrompt,
      }, owner.user.id);
      expect(await ai.completeWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        attemptId: quarantineTarget.attemptId,
        expectedCredentialFingerprint: firstFingerprint,
        expectedContractSourceHash: quarantineTarget.contractSourceHash,
        outcome: {
          status: "succeeded",
          outputText: "Encrypted output with missing provider usage.",
          encryptedOutput: "v1.fixture-iv.fixture-tag.fixture-quarantined-output",
          encryptionKeyVersion: "v1",
          stopReason: "completed",
          latencyMs: 31,
        },
      }, owner.user.id)).toMatchObject({ outputStored: true, outputEncrypted: true });
      expect((await ai.listWorkspaceTextInvocationReconciliations(
        owner.workspace.workspaceId, owner.user.id,
      )).find((item) => item.attemptId === quarantineTarget.attemptId)).toMatchObject({
        status: "quarantined",
        reason: "missing_usage",
        usageRecorded: false,
        reservationSettled: false,
        retryAllowed: false,
      });
      expect((await sql<{ status: string }[]>`
        SELECT status FROM ai_spend_reservation WHERE id = ${quarantineReservation.id}
      `)[0]?.status).toBe("reserved");
      expect((await ai.listWorkspaceAiOperationalIncidents(
        owner.workspace.workspaceId, owner.user.id,
      )).find((incident) => incident.attemptId === quarantineTarget.attemptId)).toMatchObject({
        type: "reconciliation_quarantined",
        severity: "high",
        reconciliationId: expect.any(String),
        reason: "missing_usage",
        acknowledged: false,
        active: true,
        providerRequestRetried: false,
        executionAuthority: false,
      });
      const abandonedQuote = await ai.createCostQuote({
        workspaceId: owner.workspace.workspaceId,
        rateCardId,
        capability: "generate_text",
        feature: "assistant.prepare_copy",
        forecasts: [
          { kind: "input", unit: "token", minimumUnits: 102, maximumUnits: 202 },
          { kind: "output", unit: "token", minimumUnits: 52, maximumUnits: 102 },
        ],
      }, owner.user.id);
      const abandonedReservation = await ai.reserveQuotedSpend({
        workspaceId: owner.workspace.workspaceId,
        quoteId: abandonedQuote.id,
        idempotencyKey: randomUUID(),
      }, owner.user.id);
      const abandonedIntent = await ai.prepareWorkspaceTextInvocationIntent({
        workspaceId: owner.workspace.workspaceId,
        invocationBindingId: invocation.id,
        reservationId: abandonedReservation.id,
        idempotencyKey: randomUUID(),
        userText: "Reconcile an abandoned claim without retrying it.",
        maxOutputTokens: 128,
      }, owner.user.id);
      const abandonedClaimedAt = new Date();
      const abandonedTarget = await ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: abandonedIntent.id,
        userText: "Reconcile an abandoned claim without retrying it.",
      }, owner.user.id, abandonedClaimedAt);
      expect((await ai.listWorkspaceAiOperationalIncidents(
        owner.workspace.workspaceId,
        owner.user.id,
        new Date(abandonedClaimedAt.getTime() + 60_001),
      )).find((incident) => incident.attemptId === abandonedTarget.attemptId)).toMatchObject({
        type: "invocation_ambiguous",
        reason: "claim_abandoned",
        acknowledged: false,
        active: true,
      });
      expect((await ai.reconcileAbandonedTextInvocationAttempts(
        owner.workspace.workspaceId,
        owner.user.id,
        new Date(abandonedClaimedAt.getTime() + 60_001),
      )).find((item) => item.id === abandonedTarget.attemptId)).toMatchObject({
        status: "ambiguous",
        failureCode: "claim_abandoned",
        providerRequestStatus: "unknown",
        retryAllowed: false,
        providerExecutionSucceeded: false,
      });
      expect((await sql<{ status: string }[]>`
        SELECT status FROM ai_spend_reservation WHERE id = ${abandonedReservation.id}
      `)[0]?.status).toBe("reserved");
      await expect(ai.releaseSpend(
        owner.workspace.workspaceId,
        quarantineReservation.id,
        owner.user.id,
      )).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(ai.resolveWorkspaceTextInvocation({
        workspaceId: owner.workspace.workspaceId,
        attemptId: quarantineTarget.attemptId,
        disposition: "settled_provider_charge",
        providerChargeMinor: 7,
        evidenceReference: "Provider invoice QA-081-Q.",
        resolutionNote: "Editor must not resolve quarantined provider billing.",
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const quarantineResolution = await ai.resolveWorkspaceTextInvocation({
        workspaceId: owner.workspace.workspaceId,
        attemptId: quarantineTarget.attemptId,
        disposition: "settled_provider_charge",
        providerChargeMinor: 7,
        evidenceReference: "Provider invoice QA-081-Q.",
        resolutionNote: "Reviewed invoice and recorded the exact provider charge without token inference.",
      }, owner.user.id);
      expect(quarantineResolution).toMatchObject({
        reconciliationId: expect.any(String),
        disposition: "settled_provider_charge",
        providerChargeMinor: 7,
        reservationPreviousStatus: "reserved",
        reservationFinalStatus: "settled",
        usageUnitsKnown: false,
        retryAllowed: false,
        providerRequestRetried: false,
      });
      expect((await sql<{ status: string; actualCostMinor: number }[]>`
        SELECT status, actual_cost_minor FROM ai_spend_reservation
        WHERE id = ${quarantineReservation.id}
      `)[0]).toMatchObject({ status: "settled", actualCostMinor: 7 });
      expect((await ai.listWorkspaceTextInvocationReconciliations(
        owner.workspace.workspaceId,
        owner.user.id,
      )).find((item) => item.attemptId === quarantineTarget.attemptId)).toMatchObject({
        status: "quarantined",
        usageRecorded: false,
        reservationSettled: true,
      });
      expect(await ai.resolveWorkspaceTextInvocation({
        workspaceId: owner.workspace.workspaceId,
        attemptId: abandonedTarget.attemptId,
        disposition: "confirmed_no_charge",
        evidenceReference: "Provider request log QA-081-A.",
        resolutionNote: "Provider log confirms the abandoned claim produced no billable request.",
      }, owner.user.id)).toMatchObject({
        disposition: "confirmed_no_charge",
        reservationPreviousStatus: "reserved",
        reservationFinalStatus: "released",
        usageUnitsKnown: false,
        providerRequestRetried: false,
      });
      expect((await sql<{ status: string }[]>`
        SELECT status FROM ai_spend_reservation WHERE id = ${abandonedReservation.id}
      `)[0]?.status).toBe("released");
      expect(await ai.resolveWorkspaceTextInvocation({
        workspaceId: owner.workspace.workspaceId,
        attemptId: abandonedTarget.attemptId,
        disposition: "settled_provider_charge",
        providerChargeMinor: 999,
        evidenceReference: "Replay with different input.",
        resolutionNote: "Exact replay must return the original resolution.",
      }, owner.user.id)).toMatchObject({ disposition: "confirmed_no_charge" });
      expect(await ai.listWorkspaceTextInvocationResolutions(
        owner.workspace.workspaceId,
        owner.user.id,
      )).toHaveLength(2);
      expect(await ai.getCurrentMonthUsage(
        owner.workspace.workspaceId,
        "USD",
      )).toMatchObject({ currentMonthCostMinor: 8, requestCount: 2 });
      expect((await ai.getBudgetStatus(
        owner.workspace.workspaceId,
        "USD",
      )).monthly.spentMinor).toBe(8);
      const stoppedInFlight = await prepareAdditionalExecution(
        "Discard this outcome if an operator stops execution in flight.",
      );
      const stoppedInFlightTarget = await ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: stoppedInFlight.intent.id,
        userText: "Discard this outcome if an operator stops execution in flight.",
      }, owner.user.id);
      await ai.saveWorkspaceExecutionControl({
        workspaceId: owner.workspace.workspaceId,
        state: "stopped",
        reason: "Exercise the in-flight acceptance stop.",
      }, owner.user.id);
      expect(await ai.completeWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        attemptId: stoppedInFlightTarget.attemptId,
        expectedCredentialFingerprint: firstFingerprint,
        expectedContractSourceHash: stoppedInFlightTarget.contractSourceHash,
        outcome: {
          status: "succeeded",
          outputText: "This output must be discarded.",
          encryptedOutput: "v1.fixture-discarded-output",
          encryptionKeyVersion: "v1",
          stopReason: "completed",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        },
      }, owner.user.id)).toMatchObject({
        status: "ambiguous",
        failureCode: "evidence_changed",
        outputStored: false,
      });
      await ai.saveWorkspaceExecutionControl({
        workspaceId: owner.workspace.workspaceId,
        state: "enabled",
        reason: "Resume after the in-flight stop verification.",
        enabledForMinutes: 60,
      }, owner.user.id);
      const credentialFailure = await prepareAdditionalExecution(
        "Open the provider circuit on a known credential failure.",
      );
      const credentialFailureTarget = await ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: credentialFailure.intent.id,
        userText: "Open the provider circuit on a known credential failure.",
      }, owner.user.id);
      expect(await ai.completeWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        attemptId: credentialFailureTarget.attemptId,
        expectedCredentialFingerprint: firstFingerprint,
        expectedContractSourceHash: credentialFailureTarget.contractSourceHash,
        outcome: {
          status: "failed",
          failureCode: "credential_unavailable",
          safeMessage: "The credential could not be opened.",
        },
      }, owner.user.id)).toMatchObject({ status: "failed" });
      expect((await sql<{ status: string }[]>`
        SELECT status FROM ai_spend_reservation WHERE id = ${credentialFailure.reservation.id}
      `)[0]?.status).toBe("released");
      await expect(ai.resolveWorkspaceTextInvocation({
        workspaceId: owner.workspace.workspaceId,
        attemptId: credentialFailureTarget.attemptId,
        disposition: "confirmed_no_charge",
        evidenceReference: "Known pre-request credential failure.",
        resolutionNote: "Failed attempts are released automatically and are not operator-resolution candidates.",
      }, owner.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect((await ai.listWorkspaceProviderCircuits(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        provider: "openai",
        state: "open",
        lastFailureCode: "credential_unavailable",
        executionAllowed: false,
      });
      const openIncidents = await ai.listWorkspaceAiOperationalIncidents(
        owner.workspace.workspaceId, owner.user.id,
      );
      expect(openIncidents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: "provider_circuit_open",
          severity: "critical",
          attemptId: credentialFailureTarget.attemptId,
          reason: "credential_unavailable",
          acknowledged: false,
          active: true,
          providerRequestRetried: false,
          executionAuthority: false,
          acknowledgementDueAt: expect.any(String),
          resolutionDueAt: expect.any(String),
          responseState: "within_target",
        }),
        expect.objectContaining({
          type: "invocation_ambiguous",
          severity: "high",
          attemptId: stoppedInFlightTarget.attemptId,
          reason: "evidence_changed",
          acknowledged: false,
        }),
      ]));
      expect(await ai.getWorkspaceAiOperationalAlertWebhook(
        owner.workspace.workspaceId, viewer.user.id,
      )).toMatchObject({ configured: false, deliveryEnabled: false, secretConfigured: false });
      await expect(ai.saveWorkspaceAiOperationalAlertWebhook({
        workspaceId: owner.workspace.workspaceId,
        endpointUrl: "https://alerts.example.test/private/market-me",
        encryptedSigningSecret: "v1.fixture-iv.fixture-tag.fixture-alert-secret",
        secretFingerprint: "3".repeat(64),
        encryptionKeyVersion: "v1",
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.saveWorkspaceAiOperationalAlertWebhook({
        workspaceId: owner.workspace.workspaceId,
        endpointUrl: "https://alerts.example.test/private/market-me",
        encryptedSigningSecret: "v1.fixture-iv.fixture-tag.fixture-alert-secret",
        secretFingerprint: "3".repeat(64),
        encryptionKeyVersion: "v1",
      }, owner.user.id)).toMatchObject({
        status: "unverified",
        endpointOrigin: "https://alerts.example.test",
        secretConfigured: true,
        deliveryEnabled: false,
      });
      const alertPublicRead = await ai.getWorkspaceAiOperationalAlertWebhook(
        owner.workspace.workspaceId, viewer.user.id,
      );
      expect(alertPublicRead).not.toHaveProperty("endpointUrl");
      expect(alertPublicRead).not.toHaveProperty("encryptedSigningSecret");
      await expect(ai.recordWorkspaceAiOperationalAlertWebhookVerification({
        workspaceId: owner.workspace.workspaceId,
        expectedSecretFingerprint: "4".repeat(64),
        status: "verified",
      }, owner.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.recordWorkspaceAiOperationalAlertWebhookVerification({
        workspaceId: owner.workspace.workspaceId,
        expectedSecretFingerprint: "3".repeat(64),
        status: "verified",
      }, owner.user.id)).toMatchObject({ status: "verified", deliveryEnabled: true });
      const alertAsOf = new Date(Date.now() + 300 * 60_000);
      expect(await ai.enqueueAiOperationalAlertEvents(alertAsOf)).toBe(6);
      expect(await ai.enqueueAiOperationalAlertEvents(alertAsOf)).toBe(0);
      const alertTargets = await ai.claimAiOperationalAlertDeliveries(100, alertAsOf);
      expect(alertTargets).toHaveLength(6);
      expect(alertTargets[0]).toMatchObject({
        endpointUrl: "https://alerts.example.test/private/market-me",
        encryptedSigningSecret: "v1.fixture-iv.fixture-tag.fixture-alert-secret",
        attemptCount: 1,
      });
      await ai.recordAiOperationalAlertDeliveryOutcome({
        deliveryId: alertTargets[0]!.id,
        workspaceId: owner.workspace.workspaceId,
        attemptCount: 1,
        outcome: { status: "delivered", responseStatus: 204 },
      }, alertAsOf);
      await ai.recordAiOperationalAlertDeliveryOutcome({
        deliveryId: alertTargets[1]!.id,
        workspaceId: owner.workspace.workspaceId,
        attemptCount: 1,
        outcome: { status: "failed", retryable: true, responseStatus: 503,
          safeError: "Webhook receiver was temporarily unavailable." },
      }, alertAsOf);
      const alertHistory = await ai.listWorkspaceAiOperationalAlertDeliveries(
        owner.workspace.workspaceId, viewer.user.id,
      );
      expect(alertHistory).toHaveLength(6);
      expect(alertHistory.some((delivery) => delivery.status === "delivered")).toBe(true);
      expect(alertHistory.some((delivery) => delivery.status === "failed")).toBe(true);
      expect(alertHistory.every((delivery) =>
        delivery.payloadReturned === false && delivery.endpointReturned === false &&
        delivery.signingSecretReturned === false && !("payload" in delivery)
      )).toBe(true);
      expect(await ai.getWorkspaceAiOperationalReadiness(
        owner.workspace.workspaceId, owner.user.id,
      )).toMatchObject({
        state: "blocked",
        activeIncidentCount: 2,
        unacknowledgedIncidentCount: 2,
        criticalIncidentCount: 1,
        acknowledgementOverdueCount: 0,
        acknowledgementLateCount: 0,
        resolutionOverdueCount: 0,
        executionShouldRemainStopped: true,
        externalAlertDeliveryConfigured: true,
        publicExecutionRouteAvailable: false,
      });
      expect(await ai.getWorkspaceAiOperationalReadiness(
        owner.workspace.workspaceId,
        owner.user.id,
        new Date(Date.now() + 300 * 60_000),
      )).toMatchObject({
        state: "blocked",
        activeIncidentCount: 2,
        resolutionOverdueCount: 2,
      });
      await expect(ai.acknowledgeWorkspaceAiOperationalIncident({
        workspaceId: owner.workspace.workspaceId,
        type: "provider_circuit_open",
        attemptId: credentialFailureTarget.attemptId,
        acknowledgementNote: "Editor must not acknowledge operational incidents.",
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.acknowledgeWorkspaceAiOperationalIncident({
        workspaceId: owner.workspace.workspaceId,
        type: "provider_circuit_open",
        attemptId: credentialFailureTarget.attemptId,
        acknowledgementNote: "Credential incident assigned for separate connection and circuit review.",
      }, owner.user.id)).toMatchObject({
        acknowledged: true,
        acknowledgementNote: "Credential incident assigned for separate connection and circuit review.",
        active: true,
        executionAuthority: false,
      });
      expect(await ai.acknowledgeWorkspaceAiOperationalIncident({
        workspaceId: owner.workspace.workspaceId,
        type: "provider_circuit_open",
        attemptId: credentialFailureTarget.attemptId,
        acknowledgementNote: "Replay cannot replace the first acknowledgement note.",
      }, owner.user.id)).toMatchObject({
        acknowledgementNote: "Credential incident assigned for separate connection and circuit review.",
      });
      const blockedByCircuit = await prepareAdditionalExecution(
        "Do not claim this intent until the reviewed circuit is reset.",
      );
      await expect(ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: blockedByCircuit.intent.id,
        userText: "Do not claim this intent until the reviewed circuit is reset.",
      }, owner.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      await expect(ai.resetWorkspaceProviderCircuit({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        resetNote: "Editor must not reset provider circuits.",
      }, viewer.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await ai.resetWorkspaceProviderCircuit({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        resetNote: "Credential configuration reviewed during release verification.",
      }, owner.user.id)).toMatchObject({
        state: "closed",
        consecutiveUnsafeOutcomes: 0,
        executionAllowed: true,
      });
      expect(await ai.acknowledgeWorkspaceAiOperationalIncident({
        workspaceId: owner.workspace.workspaceId,
        type: "invocation_ambiguous",
        attemptId: stoppedInFlightTarget.attemptId,
        acknowledgementNote: "In-flight stop outcome assigned for billing evidence resolution.",
      }, owner.user.id)).toMatchObject({ acknowledged: true, active: true });
      expect(await ai.getWorkspaceAiOperationalReadiness(
        owner.workspace.workspaceId, owner.user.id,
      )).toMatchObject({
        state: "attention",
        activeIncidentCount: 1,
        unacknowledgedIncidentCount: 0,
        criticalIncidentCount: 0,
        executionShouldRemainStopped: true,
      });
      const afterResetTarget = await ai.claimWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        intentId: blockedByCircuit.intent.id,
        userText: "Do not claim this intent until the reviewed circuit is reset.",
      }, owner.user.id);
      expect(await ai.completeWorkspaceTextInvocationAttempt({
        workspaceId: owner.workspace.workspaceId,
        attemptId: afterResetTarget.attemptId,
        expectedCredentialFingerprint: firstFingerprint,
        expectedContractSourceHash: afterResetTarget.contractSourceHash,
        outcome: {
          status: "succeeded",
          outputText: "Circuit reset verified.",
          encryptedOutput: "v1.fixture-reset-output",
          encryptionKeyVersion: "v1",
          stopReason: "completed",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        },
      }, owner.user.id)).toMatchObject({ status: "succeeded" });
      expect(await ai.retireWorkspaceAdapterInvocationBinding({
        workspaceId: owner.workspace.workspaceId,
        bindingId: invocation.id,
        retirementReason: "Administrator retired QA invocation staging.",
      }, owner.user.id)).toMatchObject({
        status: "retired",
        configurationCurrent: false,
        execution: false,
      });
      expect(await ai.configureWorkspaceAdapterInvocation({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateBindingId: binding.id,
        contractId: invocationContractId,
      }, owner.user.id)).toMatchObject({
        id: invocation.id,
        status: "configured",
        configurationCurrent: true,
      });
      expect((await ai.listWorkspaceAdapterInvocationBindings(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({ providerHealthEvidenceCurrent: false });
      expect(await ai.recordWorkspaceAdapterHealthObservation({
        workspaceId: owner.workspace.workspaceId,
        invocationBindingId: invocation.id,
        provider: "openai",
        expectedCredentialFingerprint: firstFingerprint,
        expectedContractSourceHash: healthTarget.contractSourceHash,
        status: "unhealthy",
        failureCode: "provider_unavailable",
        safeMessage: "The provider health service could not be reached.",
      }, owner.user.id)).toMatchObject({
        status: "unhealthy",
        evidenceCurrent: true,
        failureCode: "provider_unavailable",
        providerResponseStored: false,
        healthReady: false,
        execution: false,
      });
      expect(await ai.retireWorkspaceAdapterRateBinding({
        workspaceId: owner.workspace.workspaceId,
        bindingId: binding.id,
        retirementReason: "Administrator retired QA pricing evidence.",
      }, owner.user.id)).toMatchObject({
        status: "retired",
        pricingReady: false,
        routingAvailable: false,
        execution: false,
      });
      expect((await ai.listWorkspaceAdapterInvocationBindings(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        status: "retired",
        retirementReason: "Pricing evidence retired; invocation configuration retired automatically.",
        configurationCurrent: false,
        execution: false,
      });
      expect(await ai.bindWorkspaceAdapterRateCard({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateCardId,
      }, owner.user.id)).toMatchObject({ id: binding.id, status: "bound", pricingReady: true });
      expect(await ai.configureWorkspaceAdapterInvocation({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateBindingId: binding.id,
        contractId: invocationContractId,
      }, owner.user.id)).toMatchObject({ id: invocation.id, status: "configured" });
      expect(await ai.retireWorkspaceAdapterRegistration({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        retirementReason: "Administrator paused deployment staging for QA.",
      }, owner.user.id)).toMatchObject({
        status: "retired",
        retirementReason: "Administrator paused deployment staging for QA.",
        routingAvailable: false,
        execution: false,
      });
      expect((await ai.listWorkspaceAdapterInvocationBindings(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        status: "retired",
        retirementReason: "Workspace registration retired; invocation configuration retired automatically.",
        configurationCurrent: false,
        execution: false,
      });
      expect((await ai.listWorkspaceAdapterRateBindings(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        status: "retired",
        retirementReason: "Workspace registration retired; pricing binding retired automatically.",
        pricingReady: false,
        execution: false,
      });
      expect(await ai.registerWorkspaceAdapter({
        workspaceId: owner.workspace.workspaceId,
        candidateId: candidate.id,
      }, owner.user.id)).toMatchObject({
        id: registration.id,
        status: "registered",
        routingAvailable: false,
        execution: false,
      });
      expect(await ai.bindWorkspaceAdapterRateCard({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateCardId,
      }, owner.user.id)).toMatchObject({ id: binding.id, status: "bound", pricingReady: true });
      expect(await ai.configureWorkspaceAdapterInvocation({
        workspaceId: owner.workspace.workspaceId,
        registrationId: registration.id,
        rateBindingId: binding.id,
        contractId: invocationContractId,
      }, owner.user.id)).toMatchObject({ id: invocation.id, status: "configured" });

      await ai.saveProviderConnection({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        encryptedCredential: secondEnvelope,
        credentialFingerprint: secondFingerprint,
        encryptionKeyVersion: "v1",
      }, owner.user.id);
      expect((await ai.listProviderModelInventory(
        owner.workspace.workspaceId,
        "openai",
        owner.user.id,
      )).summary).toMatchObject({
        totalModelCount: 2,
        activeModelCount: 0,
        retiredModelCount: 2,
      });
      expect((await ai.listWorkspaceAdapterCandidates(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        status: "retired",
        reviewNote: "Credential changed; candidate retired automatically.",
        routingAvailable: false,
        execution: false,
      });
      expect((await ai.listWorkspaceAdapterRegistrations(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        status: "retired",
        retirementReason: "Credential changed; registration retired automatically.",
        routingAvailable: false,
        adapterActivation: false,
        execution: false,
      });
      expect((await ai.listWorkspaceAdapterRateBindings(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        status: "retired",
        pricingReady: false,
        routingAvailable: false,
        execution: false,
      });
      expect((await ai.listWorkspaceAdapterInvocationBindings(
        owner.workspace.workspaceId,
        owner.user.id,
      ))[0]).toMatchObject({
        status: "retired",
        configurationCurrent: false,
        implementationAvailable: true,
        healthReady: false,
        routingAvailable: false,
        execution: false,
      });
      await expect(ai.recordProviderConnectionVerification({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        expectedCredentialFingerprint: firstFingerprint,
        status: "verified",
      }, owner.user.id)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
      const failedVerification = await ai.recordProviderConnectionVerification({
        workspaceId: owner.workspace.workspaceId,
        provider: "openai",
        expectedCredentialFingerprint: secondFingerprint,
        status: "error",
        lastError: "The provider rejected this credential.",
      }, owner.user.id);
      expect(failedVerification).toMatchObject({
        status: "error",
        lastError: "The provider rejected this credential.",
      });
      expect(failedVerification).not.toHaveProperty("verifiedAt");
      expect(await ai.revokeProviderConnection(
        owner.workspace.workspaceId,
        "openai",
        owner.user.id,
      )).toMatchObject({
        status: "revoked",
        credentialConfigured: false,
        execution: false,
      });
      await ai.revokeProviderConnection(
        owner.workspace.workspaceId,
        "openai",
        owner.user.id,
      );
      const stored = (await sql<{
        encryptedCredential?: string;
        credentialFingerprint?: string;
        status: string;
      }[]>`
        SELECT encrypted_credential, credential_fingerprint, status
        FROM workspace_ai_provider_connection
        WHERE workspace_id = ${owner.workspace.workspaceId} AND provider = 'openai'
      `)[0]!;
      expect(stored).toMatchObject({
        encryptedCredential: null,
        credentialFingerprint: null,
        status: "revoked",
      });
      const audits = await sql<{ eventType: string; data: Record<string, unknown> }[]>`
        SELECT event_type, data FROM audit_event
        WHERE workspace_id = ${owner.workspace.workspaceId}
          AND (
            event_type LIKE 'ai.provider_connection_%' OR
            event_type = 'ai.provider_model_inventory_replaced' OR
            event_type LIKE 'ai.adapter_candidate%' OR
            event_type LIKE 'ai.adapter_registration%' OR
            event_type LIKE 'ai.adapter_rate%' OR
            event_type LIKE 'ai.adapter_invocation%' OR
            event_type = 'ai.adapter_health_observed'
          )
        ORDER BY created_at
      `;
      expect(audits).toHaveLength(29);
      expect(audits.map((event) => event.eventType)).toEqual(expect.arrayContaining([
        "ai.provider_connection_saved",
        "ai.provider_connection_verified",
        "ai.provider_model_inventory_replaced",
        "ai.adapter_candidate_submitted",
        "ai.adapter_candidate_approved",
        "ai.adapter_registration_registered",
        "ai.adapter_candidates_retired",
        "ai.adapter_registrations_retired",
        "ai.provider_connection_saved",
        "ai.provider_connection_verification_failed",
        "ai.provider_connection_revoked",
      ]));
      expect(audits.find((event) => event.eventType === "ai.provider_connection_verified")?.data).toMatchObject({
        status: "verified",
        credentialsIncluded: false,
        providerResponseIncluded: false,
        generation: false,
        execution: false,
      });
      expect(audits.find((event) => event.eventType === "ai.provider_model_inventory_replaced")?.data).toMatchObject({
        discoveredModelCount: 2,
        modelIdentifiersIncluded: false,
        credentialFingerprintIncluded: false,
        providerResponseIncluded: false,
        adapterActivation: false,
        execution: false,
      });
      expect(audits.find((event) => event.eventType === "ai.adapter_candidate_submitted")?.data).toMatchObject({ modelIdentifierIncluded: false, routingAvailable: false, execution: false });
      expect(audits.find((event) => event.eventType === "ai.adapter_candidate_approved")?.data).toMatchObject({ modelIdentifierIncluded: false, adapterActivation: false, execution: false });
      expect(audits.find((event) => event.eventType === "ai.adapter_candidates_retired")?.data).toMatchObject({ retiredCandidateCount: 1, reason: "credential_changed", modelIdentifiersIncluded: false });
      expect(audits.find((event) => event.eventType === "ai.adapter_registration_registered")?.data).toMatchObject({ modelIdentifierIncluded: false, capabilitiesIncluded: false, routingAvailable: false, adapterActivation: false, execution: false });
      expect(audits.filter((event) => event.eventType === "ai.adapter_registration_registered")).toHaveLength(2);
      expect(audits.find((event) => event.eventType === "ai.adapter_registration_retired")?.data).toMatchObject({ modelIdentifierIncluded: false, capabilitiesIncluded: false, routingAvailable: false, adapterActivation: false, execution: false });
      expect(audits.find((event) => event.eventType === "ai.adapter_registrations_retired")?.data).toMatchObject({ retiredRegistrationCount: 1, reason: "credential_changed", modelIdentifiersIncluded: false, capabilitiesIncluded: false });
      expect(audits.filter((event) => event.eventType === "ai.adapter_rate_binding_bound")).toHaveLength(3);
      expect(audits.find((event) => event.eventType === "ai.adapter_rate_binding_bound")?.data).toMatchObject({ currency: "USD", modelIdentifierIncluded: false, rateCardIdentifierIncluded: false, sourceEvidenceIncluded: false, execution: false });
      expect(audits.find((event) => event.eventType === "ai.adapter_rate_binding_retired")?.data).toMatchObject({ currency: "USD", sourceEvidenceIncluded: false, routingAvailable: false, execution: false });
      expect(audits.filter((event) => event.eventType === "ai.adapter_rate_bindings_retired")).toHaveLength(2);
      expect(audits.filter((event) => event.eventType === "ai.adapter_invocation_binding_configured")).toHaveLength(4);
      expect(audits.find((event) => event.eventType === "ai.adapter_invocation_binding_configured")?.data).toMatchObject({ contractIdentifierIncluded: false, pricingIdentifierIncluded: false, implementationAvailable: true, healthReady: false, routingAvailable: false, execution: false });
      expect(audits.find((event) => event.eventType === "ai.adapter_invocation_binding_retired")?.data).toMatchObject({ sourceEvidenceIncluded: false, credentialFingerprintIncluded: false, execution: false });
      expect(audits.filter((event) => event.eventType === "ai.adapter_invocation_bindings_retired")).toHaveLength(3);
      expect(audits.filter((event) => event.eventType === "ai.adapter_health_observed")).toHaveLength(2);
      expect(audits.find((event) => event.eventType === "ai.adapter_health_observed")?.data).toMatchObject({ providerResponseIncluded: false, credentialFingerprintIncluded: false, generation: false, implementationAvailable: true, healthReady: true, routingAvailable: false, execution: false });
      expect(audits.filter((event) => event.eventType === "ai.provider_connection_saved").find((event) => event.data.rotated === true)?.data).toMatchObject({ rotated: true, credentialsIncluded: false });
      expect(audits.find((event) => event.eventType === "ai.provider_connection_verification_failed")?.data).toMatchObject({
        status: "error",
        providerResponseIncluded: false,
        generation: false,
        execution: false,
      });
      expect(audits.find((event) => event.eventType === "ai.provider_connection_revoked")?.data).toMatchObject({ credentialErased: true, execution: false });
    } finally {
      await sql`DELETE FROM workspace_ai_text_draft_proposal WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_operational_alert_delivery WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_operational_alert_webhook WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_operational_incident_acknowledgement WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_operational_incident_response_policy WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_text_invocation_resolution WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_text_invocation_reconciliation WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_text_output_artifact WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM ai_usage_event WHERE workspace_id = ${owner.workspace.workspaceId} AND text_invocation_attempt_id IS NOT NULL`;
      await sql`DELETE FROM workspace_ai_text_invocation_attempt WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_text_invocation_intent WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_adapter_health_observation WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_adapter_invocation_binding WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_adapter_rate_binding WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_adapter_registration WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM workspace_ai_adapter_candidate WHERE workspace_id = ${owner.workspace.workspaceId}`;
      await sql`DELETE FROM organization WHERE id IN (${owner.workspace.organizationId}, ${viewer.workspace.organizationId})`;
      await sql`DELETE FROM app_user WHERE id IN (${owner.user.id}, ${viewer.user.id})`;
      await sql`DELETE FROM ai_provider_rate_card WHERE id = ${rateCardId}`;
    }
  });
});
