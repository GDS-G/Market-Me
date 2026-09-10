import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHeaders: vi.fn(), setCookie: vi.fn(), authenticate: vi.fn(), membership: vi.fn(),
  revalidate: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("next/headers", () => ({ headers: mocks.getHeaders, cookies: async () => ({ set: mocks.setCookie }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, RedirectType: { replace: "replace" } }));
vi.mock("./auth", () => ({ getAuthenticatedUser: mocks.authenticate }));
vi.mock("./database", () => ({ getRepository: () => ({ getWorkspaceAccess: mocks.membership }) }));
vi.mock("./config", () => ({ getServerConfiguration: () => ({ appBaseUrl: "https://market-me.example.test" }) }));

import { switchActiveWorkspace } from "./workspace-actions";
import { ACTIVE_WORKSPACE_COOKIE, ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS } from "./workspace-selection";

const workspaceId = "22222222-2222-4222-8222-222222222222";
function selectionForm(returnPath = "/campaigns") {
  const form = new FormData();
  form.set("workspaceId", workspaceId);
  form.set("returnPath", returnPath);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getHeaders.mockResolvedValue(new Headers({ origin: "https://market-me.example.test" }));
  mocks.authenticate.mockResolvedValue({ id: "session-user", displayName: "Member" });
  mocks.membership.mockResolvedValue({ workspaceId, workspaceName: "Selected", role: "viewer" });
});
afterEach(() => vi.unstubAllEnvs());

describe("workspace switch action", () => {
  it("rechecks membership, writes a secure hint, invalidates prior pages and redirects to the section root", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(switchActiveWorkspace({}, selectionForm())).rejects.toThrow("redirect:/campaigns");
    expect(mocks.membership).toHaveBeenCalledWith("session-user", workspaceId);
    expect(mocks.setCookie).toHaveBeenCalledWith(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
    expect(mocks.redirect).toHaveBeenCalledWith("/campaigns", "replace");
  });

  it("rejects a forged or revoked membership without changing the selected workspace", async () => {
    mocks.membership.mockResolvedValue(undefined);
    await expect(switchActiveWorkspace({}, selectionForm())).resolves.toEqual({ error: "Choose a workspace you can access." });
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://outside.example", "https://market-me.example.test.outside.example", "https://market-me.example.test/path"])(
    "rejects untrusted request origin %s before membership lookup", async (origin) => {
      mocks.getHeaders.mockResolvedValue(new Headers(origin ? { origin } : {}));
      await expect(switchActiveWorkspace({}, selectionForm())).resolves.toMatchObject({ error: expect.any(String) });
      expect(mocks.authenticate).not.toHaveBeenCalled();
      expect(mocks.membership).not.toHaveBeenCalled();
      expect(mocks.setCookie).not.toHaveBeenCalled();
    },
  );

  it("requires a current authenticated session", async () => {
    mocks.authenticate.mockResolvedValue(undefined);
    await expect(switchActiveWorkspace({}, selectionForm())).rejects.toThrow("redirect:/login");
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it.each(["malformed", "duplicate"])("rejects %s workspace input before querying membership", async (kind) => {
    const form = selectionForm();
    if (kind === "malformed") form.set("workspaceId", "not-a-uuid");
    else form.append("workspaceId", workspaceId);
    await expect(switchActiveWorkspace({}, form)).resolves.toMatchObject({ error: expect.any(String) });
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });

  it("never follows an external URL or a previous workspace detail on selection", async () => {
    await expect(switchActiveWorkspace({}, selectionForm("https://outside.example"))).rejects.toThrow("redirect:/");
    expect(mocks.redirect).toHaveBeenCalledWith("/", "replace");
  });
});
