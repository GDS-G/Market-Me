import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({ getRepository: () => ({ listContentPackages: mocks.list }) }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`Redirect: ${url}`); } }));
import ContentPackagesPage from "../app/content-packages/page";

describe("Content Package list confidence", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "synthetic-user", displayName: "Synthetic" });
    mocks.workspace.mockResolvedValue({ workspaceId: "synthetic-workspace", workspaceName: "Synthetic" });
    mocks.list.mockResolvedValue([]);
  });
  it.each([
    { value: null, expected: "Unavailable" }, { value: undefined, expected: "Unavailable" },
    { value: 0, expected: "0%" }, { value: 0.54, expected: "54%" }, { value: 1, expected: "100%" },
  ])("distinguishes captured confidence $value from an absent score", async ({ value, expected }) => {
    mocks.list.mockResolvedValue([{ id: "package", title: "Synthetic", assets: [], evidence: [], confidence: value, status: "needs_review" }]);
    const html = renderToStaticMarkup(await ContentPackagesPage());
    expect(html).toContain(`<strong>${expected}</strong>`);
    if (value == null) expect(html).not.toContain("0%");
    expect(html).toContain("needs review");
  });
  it("reads packages only for the current selected workspace", async () => {
    await ContentPackagesPage();
    expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith("synthetic-user");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("synthetic-workspace");
  });
  it("does not read packages without an authenticated user", async () => {
    mocks.user.mockResolvedValue(undefined);
    await expect(ContentPackagesPage()).rejects.toThrow("Redirect: /login");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("does not read packages without current workspace access", async () => {
    mocks.workspace.mockResolvedValue(undefined);
    await expect(ContentPackagesPage()).rejects.toThrow("Redirect: /login");
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
