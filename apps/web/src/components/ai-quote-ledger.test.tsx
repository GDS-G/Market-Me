import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AiQuoteLedger } from "./ai-quote-ledger";
import type { AiCostQuoteLedgerItem } from "@market-me/domain";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const quote: AiCostQuoteLedgerItem = { id: "11111111-1111-4111-8111-111111111111", capability: "generate_text", feature: "synthetic", currency: "USD", minorUnitExponent: 2, minimumCostMinor: 100, maximumCostMinor: 100,
  quotedAt: "2032-01-01T00:00:00Z", expiresAt: "2032-01-01T00:05:00Z", status: "active", reservationRequired: true, reservationAuthorized: false, execution: false };
const props = { workspaceId: "22222222-2222-4222-8222-222222222222", quotes: [quote], canEdit: true, budgetCurrency: "USD", budgetUnitIntegrity: { status: "compatible" as const, ledgerExponent: 2 as const, incompatibleReservationCount: 0 } };
const render = (input: Parameters<typeof AiQuoteLedger>[0]) => renderToStaticMarkup(createElement(AiQuoteLedger, input));
describe("quote ledger unit boundary", () => {
  it("preserves compatible quote display and reservability", () => { const html = render(props); expect(html).toContain("$1.00"); expect(html).toContain("Reserve maximum"); });
  it.each([0, 1, 3, 4])("keeps exponent %i inspection but withholds reservability", exponent => {
    const html = render({ ...props, quotes: [{ ...quote, minorUnitExponent: exponent, minimumCostMinor: 10 ** exponent, maximumCostMinor: 10 ** exponent }] });
    expect(html).toContain("different money scale"); expect(html).not.toContain("Reserve maximum"); expect(html).toContain("Not reservable");
  });
  it("does not treat a historical linked reservation as safe execution authority", () => {
    const html = render({ ...props, quotes: [{ ...quote, minorUnitExponent: 0, reservationId: "historical" }], budgetUnitIntegrity: { status: "incompatible_history", ledgerExponent: 2, incompatibleReservationCount: 1 } });
    expect(html).toContain("historical reservations with incompatible money units"); expect(html).toContain("not execution authority"); expect(html).not.toContain("Reserve maximum");
  });
  it("fails closed when unit metadata is absent", () => { const html = render({ ...props, budgetUnitIntegrity: undefined as never }); expect(html).toContain("verification is unavailable"); expect(html).not.toContain("Reserve maximum"); });
  it("does not offer implicit currency conversion", () => { const html = render({ ...props, budgetCurrency: "EUR" }); expect(html).toContain("No currency conversion"); expect(html).not.toContain("Reserve maximum"); });
  it.each(["expired", "consumed"] as const)("does not reserve a %s quote", status => { expect(render({ ...props, quotes: [{ ...quote, status }] })).not.toContain("Reserve maximum"); });
  it("does not offer a writer action to a viewer", () => { expect(render({ ...props, canEdit: false })).not.toContain("Reserve maximum"); });
  it.each([-1, 5, NaN, Infinity])("does not crash or offer an action for malformed exponent %s", minorUnitExponent => {
    const html = render({ ...props, quotes: [{ ...quote, minorUnitExponent }] }); expect(html).toContain("Quote amount unavailable"); expect(html).not.toContain("Reserve maximum");
  });
  it.each([{ currency: "<bad>" }, { minimumCostMinor: -1 }, { maximumCostMinor: 1.1 }, { maximumCostMinor: 99 }, { maximumCostMinor: 1000000001 }])("does not offer malformed quote money %j", change => {
    const html = render({ ...props, quotes: [{ ...quote, ...change }] }); expect(html).toContain("Quote amount unavailable"); expect(html).not.toContain("Reserve maximum");
  });
});
