import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), createClient: vi.fn(), config: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ getServerConfiguration: mocks.config }));
vi.mock("@market-me/database", async importOriginal => ({
  ...await importOriginal<typeof import("@market-me/database")>(),
  createDatabaseClient: mocks.createClient,
}));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubGlobal("marketMeDatabase", undefined);
  vi.stubEnv("NODE_ENV", "production");
  mocks.createClient.mockReturnValue(mocks.sql);
  mocks.config.mockReturnValue({ databaseUrl: "postgres://synthetic.invalid/isolated_test" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("server-only repository pool lifetime", () => {
  it("does not initialize configuration, a SQL client or queries on import", async () => {
    await import("./database");
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.sql).not.toHaveBeenCalled();
  });
  it.each(["production", "development", "test"])("shares one bundle across all accessors in %s", async mode => {
    vi.stubEnv("NODE_ENV", mode);
    const databaseModule = await import("./database");
    const getters = Object.entries(databaseModule).filter(([name]) => name.startsWith("get") && name.endsWith("Repository"));
    expect(getters).toHaveLength(27);
    for (const [, getter] of getters) {
      const call = getter as () => unknown;
      const original = call();
      expect(call()).toBe(original);
    }
    expect(mocks.config).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledExactlyOnceWith("postgres://synthetic.invalid/isolated_test");
    expect(mocks.sql).not.toHaveBeenCalled();
  });
  it.each(["production", "development"])("preserves the shared bundle across module reimports in %s", async mode => {
    vi.stubEnv("NODE_ENV", mode);
    const first = await import("./database"), core = first.getRepository(), work = first.getPackageWorkRepository();
    vi.resetModules(); const second = await import("./database");
    expect(second.getRepository()).toBe(core); expect(second.getPackageWorkRepository()).toBe(work);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
  it("fails closed on absent configuration without poisoning later initialization", async () => {
    const databaseModule = await import("./database");
    mocks.config.mockReturnValue({});
    expect(() => databaseModule.getRepository()).toThrow(databaseModule.DatabaseUnavailableError);
    expect(mocks.createClient).not.toHaveBeenCalled();
    mocks.config.mockReturnValue({ databaseUrl: "postgres://synthetic.invalid/isolated_test" });
    expect(databaseModule.getRepository()).toBe(databaseModule.getRepository());
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
  it("does not cache a client-construction failure", async () => {
    const databaseModule = await import("./database");
    mocks.createClient.mockImplementationOnce(() => { throw new Error("synthetic construction failure"); });
    expect(() => databaseModule.getRepository()).toThrow("synthetic construction failure");
    const repository = databaseModule.getRepository(); expect(databaseModule.getRepository()).toBe(repository);
    expect(mocks.createClient).toHaveBeenCalledTimes(2);
  });
  it("does not silently replace a live pool when configuration changes", async () => {
    const databaseModule = await import("./database"), first = databaseModule.getRepository();
    mocks.config.mockReturnValue({ databaseUrl: "postgres://synthetic.invalid/changed_requires_restart" });
    expect(databaseModule.getRepository()).toBe(first);
    expect(mocks.config).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
  it("executes current membership reads for every call and actor, not cached authorization", async () => {
    const databaseModule = await import("./database"), repository = databaseModule.getRepository();
    mocks.sql.mockResolvedValueOnce([{ workspaceId: "synthetic-workspace", role: "owner" }])
      .mockResolvedValueOnce([{ workspaceId: "synthetic-workspace", role: "viewer" }]).mockResolvedValueOnce([]);
    await expect(repository.listWorkspaceAccess("first-actor")).resolves.toEqual([{ workspaceId: "synthetic-workspace", role: "owner" }]);
    await expect(databaseModule.getRepository().listWorkspaceAccess("first-actor")).resolves.toEqual([{ workspaceId: "synthetic-workspace", role: "viewer" }]);
    await expect(databaseModule.getRepository().listWorkspaceAccess("other-actor")).resolves.toEqual([]);
    expect(mocks.sql).toHaveBeenCalledTimes(3);
    expect(mocks.sql.mock.calls.map(call => call[1])).toEqual(["first-actor", "first-actor", "other-actor"]);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
  it("retains the client after query failure and performs the next query normally", async () => {
    const databaseModule = await import("./database"), repository = databaseModule.getRepository();
    mocks.sql.mockRejectedValueOnce(new Error("synthetic database unavailable")).mockResolvedValueOnce([]);
    await expect(repository.listWorkspaceAccess("actor")).rejects.toThrow("synthetic database unavailable");
    expect(databaseModule.getRepository()).toBe(repository);
    await expect(databaseModule.getRepository().listWorkspaceAccess("actor")).resolves.toEqual([]);
    expect(mocks.sql).toHaveBeenCalledTimes(2); expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });
});
