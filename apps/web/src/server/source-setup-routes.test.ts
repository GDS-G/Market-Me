import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { SourceSetupError } from "@market-me/database";
import { setupInput, setupReceipt, setupUserId } from "../components/source-setup.test-fixture";
const mocks = vi.hoisted(() => ({ access: vi.fn(), create: vi.fn(), get: vi.fn(), credentials: vi.fn(), list: vi.fn(), config: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth", () => ({ requireWorkspaceAccess: mocks.access,
  AuthenticationError: class extends Error {}, AuthorizationError: class extends Error {} }));
vi.mock("@/server/database", () => ({ getSourceSetupRepository: () => ({ create: mocks.create, getReceipt: mocks.get }) }));
vi.mock("@/server/config", () => ({ getServerConfiguration: mocks.config }));
vi.mock("@/server/ingestion", () => ({ getIngestionService: () => ({ getConnectionAccessToken: mocks.credentials }) }));
vi.mock("@/server/source-setup-api", () => import("./source-setup-api"));
vi.mock("@/server/source-setup-browse", () => import("./source-setup-browse"));
vi.mock("./api-response", () => ({ apiError: () => Response.json({ error: { code: "unexpected" } }, { status: 500 }) }));
import { GET, POST } from "../app/api/v1/smart-sources/setup/route";
import { POST as browse } from "../app/api/v1/smart-sources/setup/browse/route";
import { openSourceSetupCursor, sealSourceSetupCursor } from "./source-setup-browse";
import { SOURCE_SETUP_BODY_LIMIT } from "./source-setup-api";
import { AuthenticationError, AuthorizationError } from "./auth";

const base = "http://localhost:3119", key = randomBytes(32).toString("base64");
const folderInput = { workspaceId: setupInput.workspaceId, connectionId: setupInput.storageConnectionId!, provider: "google_drive" as const, locationId: "root" };
function request(value: unknown = setupInput, origin: string | null = base, type = "application/json") {
  return new Request(`${base}/api/v1/smart-sources/setup`, { method: "POST",
    headers: { ...(origin === null ? {} : { origin }), "content-type": type }, body: typeof value === "string" ? value : JSON.stringify(value) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_BASE_URL", base);
  mocks.access.mockResolvedValue({ user: { id: setupUserId }, workspace: { workspaceId: setupInput.workspaceId } });
  mocks.create.mockResolvedValue({ receipt: setupReceipt, replayed: false }); mocks.get.mockResolvedValue(setupReceipt);
  mocks.config.mockReturnValue({ connectorTokenEncryptionKey: key });
  mocks.credentials.mockResolvedValue({ connection: { provider: "google_drive" }, connector: { listFolderPage: mocks.list }, accessToken: "private-access-token" });
  mocks.list.mockResolvedValue({ entries: [{ providerItemId: "folder", name: "News", isFolder: true, webUrl: "private-url", metadata: "private" },
    { providerItemId: "file", name: "Confidential document", isFolder: false }], nextPageToken: "private-next-token", incompleteSearch: false });
});
afterEach(() => vi.unstubAllEnvs());

describe("guided source setup API", () => {
  it.each([null, "null", "https://foreign.example", `${base}/path`])("blocks Origin %s before reads or writes", async (origin) => {
    expect((await POST(request("{", origin))).status).toBe(403); expect((await browse(request("{", origin))).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it("bounds transport bytes, rejects malformed JSON and enforces content type before database access", async () => {
    expect((await POST(request("x".repeat(SOURCE_SETUP_BODY_LIMIT + 1)))).status).toBe(413);
    expect((await POST(request("é".repeat(SOURCE_SETUP_BODY_LIMIT / 2 + 1)))).status).toBe(413);
    expect((await POST(request("{"))).status).toBe(422);
    expect((await POST(request(setupInput, base, "text/plain"))).status).toBe(415);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{ ...setupInput, enabled: true }, { ...setupInput, writerUserId: setupUserId }, { ...setupInput, workspaceId: "bad" }, { ...setupInput, fileTypes: [] }])("rejects unsupported or authority-bearing input", async (input) => {
    expect((await POST(request(input))).status).toBe(422); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.access).not.toHaveBeenCalled();
  });
  it("uses the authenticated writer and returns created/replay evidence without caching", async () => {
    const first = await POST(request()); expect(first.status).toBe(201); expect(first.headers.get("cache-control")).toBe("no-store");
    expect(await first.json()).toEqual({ data: { receipt: setupReceipt, replayed: false } });
    expect(mocks.access).toHaveBeenCalledWith(setupInput.workspaceId, "write"); expect(mocks.create).toHaveBeenCalledWith(setupInput, setupUserId);
    mocks.create.mockResolvedValue({ receipt: setupReceipt, replayed: true }); expect((await POST(request())).status).toBe(200);
  });
  it.each(["access_denied", "request_conflict", "context_changed", "connection_unavailable", "companion_unavailable"] as const)("maps %s without exposing authority", async (code) => {
    mocks.create.mockRejectedValue(new SourceSetupError(code, "Safe explanation"));
    const response = await POST(request()); expect(response.status).toBe(code === "access_denied" ? 403 : 409);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual({ error: { code, message: "Safe explanation" } });
  });
  it("does not expose or log SQL/provider exception details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.create.mockRejectedValue(new Error("sensitive token/private canonical request"));
      const response = await POST(request()); expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("sensitive"); expect(JSON.stringify(log.mock.calls)).not.toContain("sensitive");
    } finally { log.mockRestore(); }
  });
  it("looks up only the exact scoped actor request, returning null when nothing is committed", async () => {
    const url = `${base}/api/v1/smart-sources/setup?workspaceId=${setupInput.workspaceId}&requestId=${setupInput.requestId}`;
    expect(await (await GET(new Request(url))).json()).toEqual({ data: setupReceipt });
    expect(mocks.get).toHaveBeenCalledWith(setupInput.workspaceId, setupInput.requestId, setupUserId);
    mocks.get.mockResolvedValue(undefined); expect(await (await GET(new Request(url))).json()).toEqual({ data: null });
    expect((await GET(new Request(`${base}/api/v1/smart-sources/setup`))).status).toBe(422);
    for (const suffix of [`&workspaceId=${setupInput.workspaceId}`, "&unexpected=true", `&requestId=${setupInput.requestId}`]) {
      expect((await GET(new Request(url + suffix))).status).toBe(422);
    }
  });
  it.each([[AuthenticationError, 401], [AuthorizationError, 403]] as const)("preserves authentication/authorization failures without persistence", async (ErrorClass, status) => {
    mocks.access.mockRejectedValue(new ErrorClass());
    expect((await POST(request())).status).toBe(status); expect(mocks.create).not.toHaveBeenCalled();
    expect((await browse(request(folderInput))).status).toBe(status); expect(mocks.credentials).not.toHaveBeenCalled();
  });
});

describe("bounded source folder browsing", () => {
  it("rejects query overrides before parsing settings or accessing credentials", async () => {
    const response = await browse(new Request(`${base}/api/v1/smart-sources/setup/browse?workspaceId=${setupUserId}`, {
      method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(folderInput),
    }));
    expect(response.status).toBe(422); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it("returns folder labels and IDs only, sealing continuation scope and hiding file contents/tokens", async () => {
    const response = await browse(request(folderInput)), payload = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.data.folders).toEqual([{ providerLocationId: "folder", name: "News" }]);
    expect(payload.data.examinedCount).toBe(2); expect(payload.data.incompleteSearch).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("private"); expect(JSON.stringify(payload)).not.toContain("Confidential");
    expect(openSourceSetupCursor({ ...folderInput, cursor: payload.data.nextCursor }, setupUserId, key)).toBe("private-next-token");
    expect(mocks.list).toHaveBeenCalledWith({ accessToken: "private-access-token", providerLocationId: "root", pageToken: undefined });
    expect(mocks.access).toHaveBeenCalledTimes(2); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("returns SharePoint child identities qualified by the selected library", async () => {
    mocks.credentials.mockResolvedValue({ connection: { provider: "sharepoint" }, connector: { listFolderPage: mocks.list }, accessToken: "private-access-token" });
    const payload = await (await browse(request({ ...folderInput, provider: "sharepoint", locationId: "b!library:root" }))).json();
    expect(payload.data.folders[0].providerLocationId).toBe("b!library:folder");
  });
  it("blocks malformed locations, unconfigured storage and a mismatched connection before listing", async () => {
    expect((await browse(request({ ...folderInput, locationId: "https://foreign.example" }))).status).toBe(422);
    mocks.config.mockReturnValue({}); expect((await browse(request(folderInput))).status).toBe(503);
    mocks.config.mockReturnValue({ connectorTokenEncryptionKey: key });
    expect((await browse(request({ ...folderInput, provider: "onedrive" }))).status).toBe(422);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(["actor", "workspace", "connection", "provider", "folder", "expired", "tampered"])("rejects a %s cursor before credential access", async (mode) => {
    const now = Date.now();
    const cursor = sealSourceSetupCursor(folderInput, setupUserId, "page-2", key, mode === "expired" ? now - 600_001 : now)!;
    const input = { ...folderInput, cursor: mode === "tampered" ? cursor.slice(0, -4) + "evil" : cursor };
    if (mode === "actor") mocks.access.mockResolvedValue({ user: { id: setupInput.requestId } });
    if (mode === "workspace") input.workspaceId = setupInput.requestId;
    if (mode === "connection") input.connectionId = setupInput.requestId;
    if (mode === "provider") input.provider = "onedrive" as "google_drive";
    if (mode === "folder") input.locationId = "another-folder";
    expect((await browse(request(input))).status).toBe(422); expect(mocks.credentials).not.toHaveBeenCalled();
  });
  it("opens only a server-sealed next page and rechecks writer access before returning results", async () => {
    const cursor = sealSourceSetupCursor(folderInput, setupUserId, "page-2", key)!;
    expect((await browse(request({ ...folderInput, cursor }))).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ pageToken: "page-2" }));
    expect(mocks.access).toHaveBeenCalledTimes(2);
  });
  it("does not return metadata if membership is lost during a provider request", async () => {
    mocks.access.mockResolvedValueOnce({ user: { id: setupUserId } }).mockRejectedValueOnce(new AuthorizationError());
    const response = await browse(request(folderInput));
    expect(response.status).toBe(403); expect(await response.text()).not.toContain("News");
  });
});
