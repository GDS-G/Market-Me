import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn(), config: vi.fn(), drafts: vi.fn(), repository: vi.fn(),
  captures: {} as Record<string, Record<string, unknown>> }));
function panel(name: string, props: Record<string, unknown>) {
  mocks.captures[name] = props; return createElement("section", { "data-panel": name }, name);
}
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/server/auth", () => ({ getAuthenticatedUser: mocks.user }));
vi.mock("@/server/active-workspace", () => ({ getActiveWorkspace: mocks.workspace }));
vi.mock("@/server/config", () => ({ getServerConfiguration: mocks.config }));
vi.mock("@/server/ai-schema", async () => await import("./ai-schema"));
vi.mock("@/server/database", () => ({ getAiRepository: mocks.repository, getDraftRepository: () => ({ list: mocks.drafts }) }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => createElement("main", {}, children) }));
vi.mock("../app/ai-settings/ai-settings.module.css", () => ({ default: {} }));
vi.mock("@/components/ai-policy-form", () => ({ AiPolicyForm: (props: Record<string, unknown>) => panel("policy", props) }));
vi.mock("@/components/ai-execution-control", () => ({ AiExecutionControl: (props: Record<string, unknown>) => panel("execution", props) }));
vi.mock("@/components/ai-operational-incidents", () => ({ AiOperationalIncidents: (props: Record<string, unknown>) => panel("incidents", props) }));
vi.mock("@/components/ai-assistant-assignments", () => ({ AiAssistantAssignments: (props: Record<string, unknown>) => panel("assistants", props) }));
vi.mock("@/components/ai-routing-preferences", () => ({ AiRoutingPreferences: (props: Record<string, unknown>) => panel("routing", props) }));
vi.mock("@/components/ai-provider-connections", () => ({ AiProviderConnections: (props: Record<string, unknown>) => panel("providers", props) }));
vi.mock("@/components/ai-adapter-candidates", () => ({ AiAdapterCandidates: (props: Record<string, unknown>) => panel("candidates", props) }));
vi.mock("@/components/ai-adapter-registrations", () => ({ AiAdapterRegistrations: (props: Record<string, unknown>) => panel("registrations", props) }));
vi.mock("@/components/ai-adapter-rate-bindings", () => ({ AiAdapterRateBindings: (props: Record<string, unknown>) => panel("rates", props) }));
vi.mock("@/components/ai-adapter-invocation-bindings", () => ({ AiAdapterInvocationBindings: (props: Record<string, unknown>) => panel("bindings", props) }));
vi.mock("@/components/ai-text-invocation-intents", () => ({ AiTextInvocationIntents: (props: Record<string, unknown>) => panel("requests", props) }));
vi.mock("@/components/ai-quote-ledger", () => ({ AiQuoteLedger: (props: Record<string, unknown>) => panel("quotes", props) }));
import Page from "../app/ai-settings/page";
import { AiPolicyForm } from "@/components/ai-policy-form";
import { defaultWorkspaceAiPolicy } from "./ai-schema";
const workspaceId = "22222222-2222-4222-8222-222222222222", userId = "11111111-1111-4111-8111-111111111111";
const reads = ["getPolicy", "getCurrentMonthUsage", "getBudgetStatus", "listBudgetAlerts", "listSpendExceptions", "listAssistantAssignments",
  "listRoutingPreferences", "listProviderConnections", "listProviderAdapters", "getProviderAdapterRegistrySummary", "getAnalysisCacheSummary",
  "getProviderRateCardSummary", "listEffectiveProviderRateCards", "listCostQuotes", "listProviderModelInventory", "getWorkspaceExecutionControl",
  "listWorkspaceProviderCircuits", "getWorkspaceAiOperationalIncidentResponsePolicy", "listWorkspaceAiOperationalIncidents", "getWorkspaceAiOperationalReadiness",
  "listWorkspaceAdapterCandidates", "listWorkspaceAdapterRegistrations", "listWorkspaceAdapterRateBindings", "listProviderInvocationContracts",
  "listWorkspaceAdapterInvocationBindings", "listWorkspaceTextInvocationIntents", "listWorkspaceTextInvocationAttempts", "listWorkspaceTextOutputArtifacts",
  "listWorkspaceTextInvocationReconciliations", "listWorkspaceTextInvocationResolutions", "getWorkspaceAiOperationalAlertWebhook",
  "listWorkspaceAiOperationalAlertDeliveries", "listWorkspaceTextDraftProposals"] as const;
const repository = Object.fromEntries(reads.map(name => [name, vi.fn()])) as Record<typeof reads[number], ReturnType<typeof vi.fn>>;
const render = async () => renderToStaticMarkup(await Page());
function policyKey(node: ReactNode): string | null | undefined {
  if (Array.isArray(node)) return node.map(policyKey).find(key => key !== undefined);
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === AiPolicyForm) return node.key;
  return policyKey(node.props.children);
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.captures = {};
  mocks.user.mockResolvedValue({ id: userId, displayName: "Synthetic user" });
  mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role: "owner" });
  mocks.config.mockReturnValue({ aiProviderExecutionEnabled: false, aiOperationalAlertAllowedHosts: [] });
  mocks.repository.mockReturnValue(repository); mocks.drafts.mockResolvedValue([]);
  for (const read of reads) repository[read].mockResolvedValue([]);
  repository.getPolicy.mockResolvedValue(undefined);
  repository.getBudgetStatus.mockResolvedValue({ recentReservations: [] });
  repository.getWorkspaceExecutionControl.mockResolvedValue({ executionAllowed: false });
  repository.getProviderAdapterRegistrySummary.mockResolvedValue({ totalAdapterCount: 0, approvedAdapterCount: 0, availableAdapterCount: 0, capabilityCount: 0 });
  repository.getAnalysisCacheSummary.mockResolvedValue({ activeEntryCount: 0, totalHitCount: 0, totalResultBytes: 0 });
  repository.getProviderRateCardSummary.mockResolvedValue({ activeCardCount: 0, currencies: [] });
});
describe("AI settings disclosure and authority presentation", () => {
  it("redirects missing authentication or workspace before loading AI data", async () => {
    mocks.user.mockResolvedValue(undefined); await expect(Page()).rejects.toThrow("redirect:/login");
    mocks.user.mockResolvedValue({ id: userId }); mocks.workspace.mockResolvedValue(undefined); await expect(Page()).rejects.toThrow("redirect:/login");
    expect(mocks.repository).not.toHaveBeenCalled();
  });
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("keeps %s write, approval and execution capabilities independent", async role => {
    mocks.workspace.mockResolvedValue({ workspaceId, workspaceName: "Synthetic workspace", role }); await render();
    const write = ["owner", "admin", "editor"].includes(role), approve = ["owner", "admin", "approver"].includes(role), manage = ["owner", "admin"].includes(role);
    expect(mocks.captures.policy).toMatchObject({ userId, workspaceId, policyRevision: 0, canEditPolicy: write, canRequestSpendException: write, canApproveSpendException: approve, hasSavedPolicy: false });
    expect(mocks.captures.execution).toMatchObject({ canManage: manage });
    expect(mocks.captures.incidents).toMatchObject({ canAcknowledge: approve, canManagePolicy: manage, canManageAlert: manage });
    expect(mocks.captures.providers).toMatchObject({ canEdit: write });
    expect(repository.listProviderModelInventory.mock.calls.length > 0).toBe(write);
  });
  it("keeps all advanced children in four native disclosures after the policy controls", async () => {
    const html = await render();
    expect(html.match(/<details/g)).toHaveLength(4); expect(html).not.toMatch(/<details[^>]*open/);
    for (const name of ["policy", "execution", "incidents", "assistants", "routing", "providers", "candidates", "registrations", "rates", "bindings", "requests", "quotes"]) {
      expect(html.match(new RegExp(`data-panel="${name}"`, "g"))).toHaveLength(1);
    }
    expect(html.indexOf('data-panel="policy"')).toBeLessThan(html.indexOf('id="ai-configuration"'));
    for (const title of ["Provider adapter registry", "Provider rate cards", "Analysis cache", "Capabilities"]) expect(html).toContain(title);
    expect(html).toContain("Opening sections does not connect a provider, spend money or run a model");
    expect(html).toContain("not a complete health or launch-readiness check");
  });
  it.each(["window", "incident", "circuit"])("opens safety automatically for an active %s", async reason => {
    if (reason === "window") repository.getWorkspaceExecutionControl.mockResolvedValue({ executionAllowed: true });
    if (reason === "incident") repository.listWorkspaceAiOperationalIncidents.mockResolvedValue([{ active: true }]);
    if (reason === "circuit") repository.listWorkspaceProviderCircuits.mockResolvedValue([{ state: "open" }]);
    const html = await render(); expect(html).toMatch(/<details id="ai-safety"[^>]*open=""/); expect(html.match(/open=""/g)).toHaveLength(1);
  });
  it("describes deployment and workspace execution gates without treating an open window as authority", async () => {
    expect(await render()).toContain("stopped for this deployment");
    mocks.config.mockReturnValue({ aiProviderExecutionEnabled: true, aiOperationalAlertAllowedHosts: [] });
    expect(await render()).toContain("stopped for this workspace");
    repository.getWorkspaceExecutionControl.mockResolvedValue({ executionAllowed: true });
    expect(await render()).toContain("Each request still needs its own eligibility and spending checks");
    expect(mocks.captures.requests.executionAvailable).toBe(false); // No credential vault key.
  });
  it("distinguishes a saved policy from equal unsaved defaults", async () => {
    await render(); expect(mocks.captures.policy.hasSavedPolicy).toBe(false);
    repository.getPolicy.mockResolvedValue(defaultWorkspaceAiPolicy(workspaceId));
    await render(); expect(mocks.captures.policy.hasSavedPolicy).toBe(true);
  });
  it("passes policy values and revision from the same read and isolates account identity", async () => {
    repository.getPolicy.mockResolvedValue({...defaultWorkspaceAiPolicy(workspaceId),revision:7,mode:"faster"});
    await render();expect(mocks.captures.policy).toMatchObject({userId,policyRevision:7,policy:{mode:"faster",revision:7}});
    expect(repository.getPolicy).toHaveBeenCalledOnce();const original=policyKey(await Page());
    mocks.user.mockResolvedValue({id:workspaceId,displayName:"Other synthetic account"});expect(policyKey(await Page())).not.toBe(original);
  });
  it("resets editor identity on workspace, role, savedness or policy changes but not identical refresh", async () => {
    const original = policyKey(await Page()); expect(original).toBeTruthy(); expect(policyKey(await Page())).toBe(original);
    repository.getPolicy.mockResolvedValue(defaultWorkspaceAiPolicy(workspaceId)); const saved = policyKey(await Page()); expect(saved).not.toBe(original);
    repository.getPolicy.mockResolvedValue({ ...defaultWorkspaceAiPolicy(workspaceId), mode: "lower_cost" }); expect(policyKey(await Page())).not.toBe(saved);
    mocks.workspace.mockResolvedValue({ workspaceId, role: "viewer" }); const reader = policyKey(await Page()); expect(reader).not.toBe(saved);
    mocks.workspace.mockResolvedValue({ workspaceId: "other-workspace", role: "viewer" }); expect(policyKey(await Page())).not.toBe(reader);
  });
  it("retains workspace/actor parameters and reads current data again on refresh", async () => {
    await render(); await render();
    expect(repository.getPolicy).toHaveBeenNthCalledWith(2, workspaceId);
    expect(repository.listProviderConnections).toHaveBeenNthCalledWith(2, workspaceId, userId);
    expect(repository.getWorkspaceExecutionControl).toHaveBeenNthCalledWith(2, workspaceId, userId);
    expect(mocks.drafts).toHaveBeenNthCalledWith(2, workspaceId);
  });
  it("propagates failed reads instead of rendering no issues or zero spend", async () => {
    repository.getBudgetStatus.mockRejectedValue(new Error("synthetic unavailable")); await expect(Page()).rejects.toThrow("synthetic unavailable");
  });
});
