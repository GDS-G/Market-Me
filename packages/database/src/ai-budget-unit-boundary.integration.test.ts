import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { AiRepository } from "./ai-repository";
import { createDatabaseClient } from "./client";
import { MarketMeRepository } from "./repositories";
import { readAiBudgetUnitIntegrity } from "./ai-budget-unit-integrity";

const databaseUrl = process.env.DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : "";
if (databaseUrl && databaseName !== "market_me_ci" && !databaseName.startsWith("market_me_qa_143_"))
  throw new Error("Budget-unit tests require an isolated CI or release-143 QA database.");
const sql = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
afterAll(async () => sql?.end());

describe.skipIf(!sql)("quote to legacy budget-unit boundary", () => {
  it.each([0, 1, 3, 4])("rejects quote exponent %i without changing any reservation, alert or audit", async exponent => {
    const suffix = randomUUID(), rateCardId = randomUUID();
    const core = new MarketMeRepository(sql!), ai = new AiRepository(sql!);
    const owner = await core.bootstrapDevelopmentWorkspace({ email: `budget-units-${suffix}@market-me.local`, displayName: "Synthetic budget unit boundary" });
    const workspaceId = owner.workspace.workspaceId;
    const asOf = new Date("2032-01-01T12:00:00.000Z");
    try {
      await ai.savePolicy({ workspaceId, mode: "recommended", maximumPrivacyClass: "cloud", failoverMode: "ask_before_switching", capBehavior: "require_approval", currency: "USD", dailyBudgetMinor: 50, alertThresholdPercentages: [50] }, owner.user.id);
      await sql!`
        INSERT INTO ai_provider_rate_card (id, provider, model_family, model_version, currency, minor_unit_exponent,
          status, effective_from, source_reference, source_hash, verified_at, approved_at, created_at)
        VALUES (${rateCardId}, ${`unit-test-${suffix}`}, 'synthetic', 'v1', 'USD', ${exponent}, 'approved',
          '2031-01-01T00:00:00Z', 'https://example.invalid/synthetic-unit-evidence', ${"d".repeat(64)},
          '2030-12-01T00:00:00Z', '2030-12-02T00:00:00Z', '2030-12-02T00:00:00Z')
      `;
      await sql!`INSERT INTO ai_provider_rate_component (rate_card_id, kind, unit, unit_quantity, price_micros)
        VALUES (${rateCardId}, 'request', 'request', 1, 1000000)`;
      const quote = await ai.createCostQuote({ workspaceId, rateCardId, capability: "generate_text", feature: "unit_boundary", forecasts: [] }, owner.user.id, asOf);
      expect(quote.maximumCostMinor).toBe(10 ** exponent);
      const snapshot = async () => {
        const rows = await sql!`
          SELECT 'reservation' AS kind, count(*)::integer AS count FROM ai_spend_reservation WHERE workspace_id = ${workspaceId}
          UNION ALL SELECT 'alert', count(*)::integer FROM ai_budget_alert WHERE workspace_id = ${workspaceId}
          UNION ALL SELECT 'audit', count(*)::integer FROM audit_event WHERE workspace_id = ${workspaceId}
          ORDER BY kind
        `;
        return Array.from(rows);
      };
      const before = await snapshot();
      await expect(ai.reserveQuotedSpend({ workspaceId, quoteId: quote.id, idempotencyKey: randomUUID() }, owner.user.id, asOf))
        .rejects.toMatchObject({ name: "AiPolicyValidationError" });
      expect(await snapshot()).toEqual(before);
    } finally {
      await sql!`DELETE FROM organization WHERE id = ${owner.workspace.organizationId}`;
      await sql!`DELETE FROM app_user WHERE id = ${owner.user.id}`;
      await sql!`DELETE FROM ai_provider_rate_card WHERE id = ${rateCardId}`;
    }
  });
});

async function historicalFixture(run: (f: { ai: AiRepository; workspaceId: string; actor: string; quoteId: string; cardId: string; asOf: Date; legacy: (status: "reserved" | "denied" | "released" | "expired" | "settled") => Promise<string>; snapshot: () => Promise<unknown> }) => Promise<void>) {
  const suffix = randomUUID(), cardId = randomUUID(), ai = new AiRepository(sql!);
  const owner = await new MarketMeRepository(sql!).bootstrapDevelopmentWorkspace({ email: `historical-units-${suffix}@market-me.local`, displayName: "Synthetic historical units" });
  const workspaceId = owner.workspace.workspaceId, actor = owner.user.id, asOf = new Date("2032-01-01T12:00:00Z");
  try {
    await ai.savePolicy({ workspaceId, mode: "recommended", maximumPrivacyClass: "cloud", failoverMode: "ask_before_switching", capBehavior: "require_approval", currency: "USD", dailyBudgetMinor: 50, alertThresholdPercentages: [50] }, actor);
    await sql!`INSERT INTO ai_provider_rate_card (id,provider,model_family,model_version,currency,minor_unit_exponent,status,effective_from,source_reference,source_hash,verified_at,approved_at,created_at)
      VALUES (${cardId},${`history-${suffix}`},'synthetic','v1','USD',3,'approved','2031-01-01T00:00:00Z','https://example.invalid/unit-history',${"a".repeat(64)},'2030-12-01T00:00:00Z','2030-12-02T00:00:00Z','2030-12-02T00:00:00Z')`;
    await sql!`INSERT INTO ai_provider_rate_component (rate_card_id,kind,unit,unit_quantity,price_micros) VALUES (${cardId},'request','request',1,1000000)`;
    const quote = await ai.createCostQuote({ workspaceId, rateCardId: cardId, capability: "generate_text", feature: "historical_units", forecasts: [] }, actor, asOf);
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of ["workspace_ai_policy", "workspace_ai_policy_save_receipt", "ai_cost_quote", "ai_spend_reservation", "ai_spend_exception_request", "ai_usage_event", "ai_budget_alert", "audit_event"])
        result[table] = Array.from(await sql!`SELECT to_jsonb(t) AS data FROM ${sql!(table)} t WHERE workspace_id=${workspaceId} ORDER BY to_jsonb(t)::text`);
      return result;
    };
    const legacy = async (status: "reserved" | "denied" | "released" | "expired" | "settled") => {
      const id = randomUUID();
      // Historical fixture only: reproduces a record accepted before the unit boundary existed.
      await sql!`INSERT INTO ai_spend_reservation (id,workspace_id,cost_quote_id,idempotency_key,capability,feature,currency,estimated_cost_minor,actual_cost_minor,status,exceeded_scopes,cap_behavior,requested_by,resolved_by,expires_at,resolved_at,created_at,updated_at)
        VALUES (${id},${workspaceId},${quote.id},${randomUUID()},'generate_text','historical_units','USD',1000,${status === "settled" ? 500 : null},${status},${status === "denied" ? ["daily"] : []},'require_approval',${actor},${status === "reserved" ? null : actor},${status === "denied" ? null : new Date(asOf.getTime()+900000)},${status === "reserved" ? null : asOf},${asOf},${asOf})`;
      return id;
    };
    await run({ ai, workspaceId, actor, quoteId: quote.id, cardId, asOf, legacy, snapshot });
  } finally {
    await sql!`DELETE FROM organization WHERE id=${owner.workspace.organizationId}`;
    await sql!`DELETE FROM app_user WHERE id=${actor}`;
    await sql!`DELETE FROM ai_provider_rate_card WHERE id=${cardId}`;
  }
}

describe.skipIf(!sql)("historical incompatible money evidence", () => {
  it("does not authorize a new compatible quote against incompatible historical totals", () => historicalFixture(async f => {
    await f.legacy("released");
    // A new synthetic rate snapshot uses hundredths; the original quote remains exponent3.
    await sql!`UPDATE ai_provider_rate_card SET minor_unit_exponent=2 WHERE id=${f.cardId}`;
    const compatible = await f.ai.createCostQuote({ workspaceId: f.workspaceId, rateCardId: f.cardId, capability: "generate_text", feature: "compatible_new_quote", forecasts: [] }, f.actor, f.asOf);
    expect(compatible.minorUnitExponent).toBe(2); const before = await f.snapshot();
    await expect(f.ai.reserveQuotedSpend({ workspaceId: f.workspaceId, quoteId: compatible.id, idempotencyKey: randomUUID() }, f.actor, f.asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    expect(await f.snapshot()).toEqual(before);
  }));
  it("follows consumed-exception lineage without assigning the quote's integer scale to the ledger", () => historicalFixture(async f => {
    const deniedId = await f.legacy("denied"), requestId = randomUUID(), consumerId = randomUUID();
    await sql!`INSERT INTO ai_spend_exception_request (id,workspace_id,denied_reservation_id,status,justification,requested_by,resolved_by,resolved_at,consumed_at,expires_at,created_at,updated_at)
      VALUES (${requestId},${f.workspaceId},${deniedId},'approved','Synthetic historical consumed exception',${f.actor},${f.actor},${f.asOf},${f.asOf},${new Date(f.asOf.getTime()+86400000)},${f.asOf},${f.asOf})`;
    await sql!`INSERT INTO ai_spend_reservation (id,workspace_id,spend_exception_request_id,idempotency_key,capability,feature,currency,estimated_cost_minor,status,exceeded_scopes,cap_behavior,requested_by,expires_at,created_at,updated_at)
      VALUES (${consumerId},${f.workspaceId},${requestId},${randomUUID()},'generate_text','historical_units','USD',1000,'reserved','{}','require_approval',${f.actor},${new Date(f.asOf.getTime()+900000)},${f.asOf},${f.asOf})`;
    const before = await f.snapshot();
    expect(await readAiBudgetUnitIntegrity(sql!, f.workspaceId, "USD")).toEqual({ status: "incompatible_history", ledgerExponent: 2, incompatibleReservationCount: 2 });
    await expect(f.ai.authorizeApprovedSpend(f.workspaceId, requestId, f.actor, f.asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    await expect(f.ai.settleSpend({ workspaceId: f.workspaceId, reservationId: consumerId, actualCostMinor: 1, usage: { provider: "synthetic", model: "synthetic", privacyClass: "cloud", inputUnits: 1, outputUnits: 1, cachedInputUnits: 0, latencyMs: 1 } }, f.actor, f.asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    expect(await f.snapshot()).toEqual(before);
    expect(await f.ai.releaseSpend(f.workspaceId, consumerId, f.actor, f.asOf)).toMatchObject({ status: "released" });
  }));
  it.each(["reserved", "denied", "released", "expired", "settled"] as const)("preserves %s history, exposes the unit warning and blocks new authorization without incidental writes", status => historicalFixture(async f => {
    await f.legacy(status); const before = await f.snapshot();
    const integrity = { ledgerExponent: 2, status: "incompatible_history", incompatibleReservationCount: 1 };
    expect(await readAiBudgetUnitIntegrity(sql!, f.workspaceId, "USD")).toEqual(integrity);
    expect((await f.ai.getBudgetStatus(f.workspaceId, "USD", f.asOf)).unitIntegrity).toEqual(integrity);
    expect((await f.ai.getCurrentMonthUsage(f.workspaceId, "USD", f.asOf)).unitIntegrity).toEqual(integrity);
    expect(await readAiBudgetUnitIntegrity(sql!, f.workspaceId, "EUR")).toMatchObject({ status: "compatible", incompatibleReservationCount: 0 });
    expect(await readAiBudgetUnitIntegrity(sql!, randomUUID(), "USD")).toMatchObject({ status: "compatible", incompatibleReservationCount: 0 });
    await expect(f.ai.reserveSpend({ workspaceId: f.workspaceId, idempotencyKey: randomUUID(), capability: "generate_text", feature: "new", currency: "USD", estimatedCostMinor: 1 }, f.actor, new Date(f.asOf.getTime()+3600000))).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    expect(await f.snapshot()).toEqual(before);
  }));
  it("blocks settlement but still permits explicit release of a historical hold", () => historicalFixture(async f => {
    const id = await f.legacy("reserved"), before = await f.snapshot();
    await expect(f.ai.settleSpend({ workspaceId: f.workspaceId, reservationId: id, actualCostMinor: 1, usage: { provider: "synthetic", model: "synthetic", privacyClass: "cloud", inputUnits: 1, outputUnits: 1, cachedInputUnits: 0, latencyMs: 1 } }, f.actor, f.asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    expect(await f.snapshot()).toEqual(before);
    expect(await f.ai.releaseSpend(f.workspaceId, id, f.actor, f.asOf)).toMatchObject({ status: "released", estimatedCostMinor: 1000 });
    expect((await f.ai.getSpendReservation(f.workspaceId, id, f.asOf))?.estimatedCostMinor).toBe(1000);
  }));
  it.each(["pending", "approved"] as const)("blocks new request, approval and consumption of historical %s exception without rewriting it", status => historicalFixture(async f => {
    const deniedId = await f.legacy("denied"), requestId = randomUUID();
    await sql!`INSERT INTO ai_spend_exception_request (id,workspace_id,denied_reservation_id,status,justification,requested_by,resolved_by,resolved_at,expires_at,created_at,updated_at)
      VALUES (${requestId},${f.workspaceId},${deniedId},${status},'Synthetic historical exception',${f.actor},${status === "approved" ? f.actor : null},${status === "approved" ? f.asOf : null},${new Date(f.asOf.getTime()+86400000)},${f.asOf},${f.asOf})`;
    const before = await f.snapshot();
    await expect(f.ai.requestSpendException({ workspaceId: f.workspaceId, deniedReservationId: deniedId, justification: "Cannot reinterpret these units" }, f.actor, f.asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    await expect(f.ai.decideSpendException(f.workspaceId, requestId, "approved", f.actor, undefined, f.asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    await expect(f.ai.authorizeApprovedSpend(f.workspaceId, requestId, f.actor, f.asOf)).rejects.toMatchObject({ name: "AiPolicyValidationError" });
    expect(await f.snapshot()).toEqual(before);
    expect(await f.ai.getBudgetActionState(f.workspaceId, "decide_exception", requestId, f.actor, f.asOf)).toMatchObject({ status });
    if (status === "pending") expect(await f.ai.decideSpendException(f.workspaceId, requestId, "rejected", f.actor, undefined, f.asOf)).toMatchObject({ status: "rejected" });
  }));
});
