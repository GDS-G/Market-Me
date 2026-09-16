import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), workspace: vi.fn(), sources: vi.fn(), source: vi.fn(), connections: vi.fn(), contextPacks: vi.fn(), items: vi.fn(),
  companions: vi.fn(), bindings: vi.fn(), binding: vi.fn(), commands: vi.fn(), brands: vi.fn(), audiences: vi.fn(), destinations: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/database", () => ({
  getRepository: () => ({ listSmartSources: mocks.sources, getSmartSource: mocks.source, listStorageConnections: mocks.connections,
    listContextPacks: mocks.contextPacks, listSourceItems: mocks.items }),
  getCompanionRepository: () => ({ listWorkers: mocks.companions }),
  getSourcePreparationRepository: () => ({ listSourcePreparationBindings: mocks.bindings,
    getSourcePreparationBindingForSource: mocks.binding, listSourcePreparationCommands: mocks.commands }),
  getProfileRepository: () => ({ listBrandProfiles: mocks.brands, listAudienceProfiles: mocks.audiences }),
  getCampaignRepository: () => ({ listDestinations: mocks.destinations }),
}));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("@/components/smart-source-form", () => ({ SmartSourceForm: () => createElement("form", {}, "Source fields") }));
vi.mock("@/components/source-preparation-binding-form", () => ({ SourcePreparationBindingForm: (props: unknown) => createElement("section", { "data-preparation-props": JSON.stringify(props) }, "Preparation binding") }));
vi.mock("@/components/source-preparation-binding-request", () => import("../components/source-preparation-binding-request"));
vi.mock("@/server/source-preparation-schema", () => import("./source-preparation-schema"));
vi.mock("@/server/source-preparation-view", () => import("./source-preparation-view"));

import SmartSourcesPage from "../app/smart-sources/page";
import EditSmartSourcePage from "../app/smart-sources/[id]/edit/page";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const bindingId = "44444444-4444-4444-8444-444444444444";
const audienceId = "55555555-5555-4555-8555-555555555555";
const approvalId = "66666666-6666-4666-8666-666666666666";
const source = { id: sourceId, workspaceId, name: "Newsroom", version: 2, provider: "local", locations: [{ displayPath: "News" }],
  readinessMode: "stabilization_window", enabled: false };
const binding = { id: bindingId, workspaceId, smartSourceId: sourceId, writerUserId: userId, templateKey: "general_announcement", templateVersion: 1,
  name: "News brief", description: "", audienceProfileVersionIds: [audienceId], informationDepth: "contextual", promotionalStrength: "informational",
  timezone: "UTC", enabled: true, revision: 2, createdBy: userId, updatedBy: userId, createdAt: "2026-09-15T10:00:00Z", updatedAt: "2026-09-15T11:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: userId, displayName: "QA" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA workspace", role: "editor" });
  mocks.sources.mockResolvedValue([source]); mocks.source.mockResolvedValue(source);
  mocks.connections.mockResolvedValue([]); mocks.contextPacks.mockResolvedValue([]); mocks.items.mockResolvedValue([]); mocks.companions.mockResolvedValue([]);
  mocks.bindings.mockResolvedValue([binding]); mocks.binding.mockResolvedValue(binding); mocks.commands.mockResolvedValue([]);
  mocks.brands.mockResolvedValue([]); mocks.audiences.mockResolvedValue([]); mocks.destinations.mockResolvedValue([]);
});

describe("Smart Source preparation status pages", () => {
  it("separates paused synchronization from enabled approval-linked preparation on the source list", async () => {
    const html = renderToStaticMarkup(await SmartSourcesPage());
    expect(html).toContain("Sync paused"); expect(html).toContain("Draft prep enabled");
    expect(mocks.bindings).toHaveBeenCalledExactlyOnceWith(workspaceId, userId);
  });

  it("shows not configured and disabled binding states without treating them as source sync", async () => {
    mocks.bindings.mockResolvedValue([]);
    expect(renderToStaticMarkup(await SmartSourcesPage())).toContain("Not configured");
    mocks.bindings.mockResolvedValue([{ ...binding, enabled: false }]);
    expect(renderToStaticMarkup(await SmartSourcesPage())).toContain("Draft prep paused");
  });

  it("loads one scoped binding/status history and passes only current published choices", async () => {
    mocks.brands.mockResolvedValue([
      { name: "Current brand", status: "published", currentVersion: { id: bindingId, status: "published", versionNumber: 3 } },
      { name: "Draft brand", status: "draft", currentVersion: { id: approvalId, status: "published", versionNumber: 1 } },
    ]);
    mocks.audiences.mockResolvedValue([
      { name: "Current audience", status: "published", currentVersion: { id: audienceId, status: "published", versionNumber: 2 } },
      { name: "Archived audience", status: "archived", currentVersion: { id: approvalId, status: "published", versionNumber: 1 } },
    ]);
    mocks.destinations.mockResolvedValue([{ id: bindingId, title: "Published destination", status: "published" }, { id: approvalId, title: "Draft destination", status: "draft" }]);
    mocks.commands.mockResolvedValue([{ id: bindingId, contentPackageId: sourceId, contentPackageVersion: 4, expectedApprovalId: approvalId,
      bindingRevision: 2, status: "pending", attemptCount: 0, leaseExpiresAt: "2026-09-15T12:00:00Z", createdAt: "2026-09-15T11:00:00Z", updatedAt: "2026-09-15T11:00:00Z" }]);
    const html = renderToStaticMarkup(await EditSmartSourcePage({ params: Promise.resolve({ id: sourceId }) }));
    const decoded = html.replaceAll("&quot;", '"');
    expect(decoded).toContain('"canWrite":true'); expect(decoded).toContain("Current brand"); expect(decoded).not.toContain("Draft brand");
    expect(decoded).toContain("Current audience"); expect(decoded).not.toContain("Archived audience");
    expect(decoded).toContain("Published destination"); expect(decoded).not.toContain("Draft destination");
    expect(decoded).not.toContain("writerUserId"); expect(decoded).not.toContain("expectedApprovalId"); expect(decoded).not.toContain("leaseExpiresAt");
    expect(mocks.binding).toHaveBeenCalledExactlyOnceWith(workspaceId, sourceId, userId);
    expect(mocks.commands).toHaveBeenCalledExactlyOnceWith(workspaceId, sourceId, userId);
  });

  it("renders binding configuration read-only for non-writers and rejects malformed source IDs before DB", async () => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "QA", role: "approver" });
    const html = renderToStaticMarkup(await EditSmartSourcePage({ params: Promise.resolve({ id: sourceId }) }));
    expect(html.replaceAll("&quot;", '"')).toContain('"canWrite":false');
    await expect(EditSmartSourcePage({ params: Promise.resolve({ id: "bad" }) })).rejects.toThrow("not-found");
    expect(mocks.source).toHaveBeenCalledTimes(1);
  });
});
