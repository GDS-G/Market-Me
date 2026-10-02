import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODE_INDICATORS } from "@market-me/generation";
import type { AiSpendExceptionRequest } from "@market-me/domain";
import { AiPolicyForm } from "./ai-policy-form";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), fetch: vi.fn(), formError: "", emptyStateCount: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
// Preserve real hooks, but inject the existing error state for SSR feedback tests.
// The component's three initially-empty strings are justification, selected ID, error.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState(initial: unknown) {
    const state = actual.useState(initial);
    if (initial === "" && ++mocks.emptyStateCount === 3 && mocks.formError) return [mocks.formError, state[1]];
    return state;
  } };
});
type Props = Parameters<typeof AiPolicyForm>[0];
const props = (): Props => ({ userId: "synthetic-user", policyRevision: 1, workspaceId: "synthetic-workspace", policy: { workspaceId: "synthetic-workspace", mode: "recommended",
  maximumPrivacyClass: "cloud", failoverMode: "ask_before_switching", capBehavior: "require_approval", currency: "USD",
  monthlyBudgetMinor: 99999, alertThresholdPercentages: [50, 80, 100] },
  usage: { currency: "USD", currentMonthCostMinor: 500, requestCount: 1, inputUnits: 1, outputUnits: 1, cachedInputUnits: 0, byFeature: [] },
  budgetStatus: { asOf: "2026-10-01T12:00:00Z", currency: "USD", daily: { scope: "daily", spentMinor: 500, reservedMinor: 100 },
    monthly: { scope: "monthly", spentMinor: 500, reservedMinor: 100, capMinor: 1000, availableMinor: 400 }, activeReservationCount: 1, recentReservations: [] },
  budgetAlerts: [{ id: "synthetic-alert", workspaceId: "synthetic-workspace", sourceReservationId: "synthetic-reservation", scope: "monthly",
    windowKey: "2026-10", thresholdPercentage: 50, committedCostMinor: 600, capMinor: 1000, currency: "USD", status: "open", createdAt: "2026-10-01", updatedAt: "2026-10-01" }],
  spendExceptions: [], capResponses: [], canRequestSpendException: false, canApproveSpendException: false,
  canEditPolicy: false, hasSavedPolicy: true, modeIndicators: AI_MODE_INDICATORS });
const render = (value: Props) => { mocks.emptyStateCount = 0; return renderToStaticMarkup(createElement(AiPolicyForm, value)); };
beforeEach(() => { vi.clearAllMocks(); mocks.formError = ""; vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { expect(mocks.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
describe("role-honest AI policy presentation", () => {
  it("keeps request failure feedback visible to an approver without a policy form", () => {
    mocks.formError = "Synthetic spend decision failure";
    const html = render({ ...props(), canApproveSpendException: true });
    expect(html).toContain('role="alert">Synthetic spend decision failure</p>');
    expect(html).not.toContain("<form"); expect(html).not.toContain("Save AI policy");
  });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("renders %s affordances according to existing independent capabilities", role => {
    const write = ["owner", "admin", "editor"].includes(role), html = render({ ...props(), canEditPolicy: write, canRequestSpendException: write,
      canApproveSpendException: ["owner", "admin", "approver"].includes(role) });
    expect(html.includes("Save AI policy")).toBe(write);
    expect(html.includes('>Acknowledge</button>')).toBe(write);
    expect(html.match(/aria-pressed="/g)).toHaveLength(6);
    if (!write) { expect(html).not.toContain("<form"); expect(html).toContain("Saved privacy and budget policy");
      expect(html).toContain("Open — a writer can acknowledge"); expect(html.match(/disabled=""/g)).toHaveLength(6); }
  });
  it("keeps progress tied to the loaded saved cap and separates holds from spend", () => {
    const html = render(props());
    expect(html).toContain("Recorded spend plus active holds against the loaded monthly cap");
    expect(html).toContain("60% of $10.00"); expect(html).not.toContain("60% of $999.99");
  });
  it("describes unsaved defaults and mode indicators without claiming provider readiness", () => {
    const html = render({ ...props(), hasSavedPolicy: false });
    expect(html).toContain("Default preference — not yet saved"); expect(html).toContain("Unsaved application defaults");
    expect(html).toContain("not measured quality, verified model availability or a price quote");
    expect(html).toContain("Choosing a mode does not run AI or authorize spending");
  });
  it("does not invent a monthly cap from editor policy when the loaded budget has none", () => {
    const input = props(); input.budgetStatus.monthly = { scope: "monthly", spentMinor: 500, reservedMinor: 100 };
    const html = render(input); expect(html).toContain("No monthly cap is configured."); expect(html).not.toContain("% of ");
  });
  it("preserves independent approver review while withholding policy edits", () => {
    const request: AiSpendExceptionRequest = { id: "synthetic-exception", workspaceId: "synthetic-workspace", deniedReservationId: "synthetic-denied",
      capability: "generate_text", feature: "synthetic", currency: "USD", estimatedCostMinor: 100, capBehavior: "require_approval", exceededScopes: ["monthly"], status: "pending",
      justification: "Synthetic review", requestedBy: "synthetic-writer", expiresAt: "2026-10-02T12:00:00Z", createdAt: "2026-10-01", updatedAt: "2026-10-01" };
    const html = render({ ...props(), canApproveSpendException: true, spendExceptions: [request] });
    expect(html).toContain(">Approve</button>"); expect(html).toContain(">Reject</button>");
    expect(html).not.toContain("Save AI policy"); expect(html).not.toContain(">Acknowledge</button>");
    const reader = render({ ...props(), spendExceptions: [request] }); expect(reader).not.toContain(">Approve</button>");
  });
});
