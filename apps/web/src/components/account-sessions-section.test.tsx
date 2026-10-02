import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSessionError } from "@market-me/database";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => import("../server/auth"));
vi.mock("@/server/account-session-auth", () => ({ requireAccountSessionActor: mocks.actor }));
vi.mock("@/server/database", () => ({ getAccountSessionRepository: () => mocks }));
vi.mock("./account-sessions-panel", () => ({ AccountSessionsPanel: (props: unknown) => createElement("section", { "data-session-props": JSON.stringify(props) }, "Session controls") }));
import { AccountSessionsSection } from "./account-sessions-section";
const accountId = "11111111-1111-4111-8111-111111111111", sessionId = "22222222-2222-4222-8222-222222222222", time = "2026-10-02T00:00:00.000Z";
const actor = { accountId, tokenHash: "server-only-private-hash" };
const snapshot = { accountId, observedAt: time, current: { sessionId, createdAt: time, lastSeenAt: time, expiresAt: time }, others: [], totalOthers: "0", nextCursor: null };
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue(actor); mocks.list.mockResolvedValue(snapshot); });
describe("server session settings boundary", () => {
  it("passes only minimized snapshot props and independently authenticates paging", async () => {
    const html = renderToStaticMarkup(await AccountSessionsSection({ accountId, cursor: "cursor" }));
    expect(mocks.list).toHaveBeenCalledWith(accountId, actor, "cursor"); expect(html).toContain("Session controls"); expect(html).not.toContain(actor.tokenHash); expect(html).not.toContain("tokenHash");
  });
  it("rejects a changed account before repository work and offers sign-in", async () => {
    mocks.actor.mockResolvedValue({ ...actor, accountId: sessionId });
    const html = renderToStaticMarkup(await AccountSessionsSection({ accountId })); expect(html).toContain("Sign in again"); expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(["authentication_required", "invalid_input", "access_denied"] as const)("isolates %s failure without leaking details or rendering controls", async code => {
    mocks.list.mockRejectedValue(new AccountSessionError(code, "PRIVATE DATA")); const html = renderToStaticMarkup(await AccountSessionsSection({ accountId }));
    expect(html).toContain('role="alert"'); expect(html).not.toContain("Session controls"); expect(html).not.toContain("PRIVATE DATA");
    expect(html).toContain(code === "authentication_required" ? "Sign in again" : "Reload newest sessions");
  });
  it.each([{ accountId: sessionId }, { tokenHash: "PRIVATE" }, { current: { ...snapshot.current, tokenHash: "PRIVATE" } }])("rejects unexpected or foreign persistence projection %j", async patch => {
    mocks.list.mockResolvedValue({ ...snapshot, ...patch }); const html = renderToStaticMarkup(await AccountSessionsSection({ accountId }));
    expect(html).toContain("No sign-out request was sent"); expect(html).not.toContain("PRIVATE"); expect(html).not.toContain("Session controls");
  });
});
