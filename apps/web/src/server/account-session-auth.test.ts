import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), get: vi.fn(), getSession: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./database", () => ({ getRepository: () => mocks }));
import { requireAccountSessionActor } from "./account-session-auth";
beforeEach(() => { vi.resetAllMocks(); mocks.cookies.mockResolvedValue({ get: mocks.get }); });
describe("private session authority context", () => {
  it("requires an actual cookie and never queries for a missing token", async () => {
    await expect(requireAccountSessionActor()).rejects.toThrow("Authentication required"); expect(mocks.getSession).not.toHaveBeenCalled();
  });
  it("hashes the actual cookie once and returns only internal current-account context", async () => {
    const token = "synthetic-cookie-not-a-real-credential", tokenHash = createHash("sha256").update(token).digest("base64url");
    mocks.get.mockReturnValue({ value: token }); mocks.getSession.mockResolvedValue({ id: "own-account", email: "private@local", displayName: "Label" });
    expect(await requireAccountSessionActor()).toEqual({ accountId: "own-account", tokenHash });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("mm_session"); expect(mocks.getSession).toHaveBeenCalledExactlyOnceWith(tokenHash);
  });
  it("rejects expired/revoked session lookup without returning an account hint", async () => {
    mocks.get.mockReturnValue({ value: "synthetic-expired" }); mocks.getSession.mockResolvedValue(undefined);
    await expect(requireAccountSessionActor()).rejects.toThrow("Authentication required");
  });
});
