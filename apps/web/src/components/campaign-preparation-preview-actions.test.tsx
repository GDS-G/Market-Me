import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), push: vi.fn(), states: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0, cleanup: undefined as (() => void) | undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("./campaign-preparation-preview-contract", async original => ({ ...await original<typeof import("./campaign-preparation-preview-contract")>(), requestPreparationPreview: mocks.request }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState(initial: unknown) { const index = mocks.cursor++; if (!(index in mocks.states)) mocks.states[index] = typeof initial === "function" ? initial() : initial;
    return [mocks.states[index], (value: unknown) => { mocks.states[index] = typeof value === "function" ? value(mocks.states[index]) : value; }]; },
  useRef(initial: unknown) { const index = mocks.refCursor++; return mocks.refs[index] ?? (mocks.refs[index] = { current: initial }); },
  useEffect(effect: () => () => void) { mocks.cleanup ??= effect(); }, useSyncExternalStore: () => true,
}));
import { CampaignPreparationForm, PreparationFields, type PreparationFormProps } from "./campaign-preparation-form";
import { CampaignPreparationPreview } from "./campaign-preparation-preview";
import { ApprovedPackageReviewPicker } from "./approved-package-review-picker";
import { createPreparationAttempt, preparationStorageKey } from "./campaign-preparation-request";
import { previewTestData, previewTestFingerprint, previewTestInput } from "./campaign-preparation-preview.test-fixture";
import { reviewTestReview, reviewTestScope, reviewTestUuid } from "./content-package-review.test-fixture";

const props: PreparationFormProps = { ...reviewTestScope, selectedPackageId: reviewTestScope.packageId,
  packages: [{ id: reviewTestScope.packageId, title: "Captured café 🚀", version: 2 }], brands: [], audiences: [], destinations: [],
  preset: { id: reviewTestUuid(4), title: "Synthetic preset", revision: 1, versionNumber: 1, archived: false } };
let memory: Map<string, string>, setItem: ReturnType<typeof vi.fn>, removeItem: ReturnType<typeof vi.fn>, send: ReturnType<typeof vi.fn>, random: ReturnType<typeof vi.spyOn>;
function panel() {
  mocks.cursor = 0; mocks.refCursor = 0;
  const root = CampaignPreparationForm(props);
  if (!isValidElement<PreparationFormProps>(root) || typeof root.type !== "function") throw new Error("Expected hydrated editor");
  return (root.type as (value: PreparationFormProps) => ReactNode)(root.props);
}
function find<T>(node: ReactNode, predicate: (type: unknown, value: T) => boolean): T | undefined {
  if (Array.isArray(node)) return node.map(child => find<T>(child, predicate)).find(Boolean);
  if (!isValidElement<T & { children?: ReactNode }>(node)) return;
  return predicate(node.type, node.props) ? node.props : find<T>(node.props.children, predicate);
}
function button(label: string) { return find<{ children: string; disabled: boolean; onClick(): void }>(panel(), (type, value) => type === "button" && value.children === label); }
function fields() { return find<Parameters<typeof PreparationFields>[0]>(panel(), type => type === PreparationFields)!; }
function picker() { return find<Parameters<typeof ApprovedPackageReviewPicker>[0]>(panel(), type => type === ApprovedPackageReviewPicker)!; }
function preview() { return find<Parameters<typeof CampaignPreparationPreview>[0]>(panel(), type => type === CampaignPreparationPreview)?.preview; }
function loadReview() { picker().onReview({ ...reviewTestReview, reviewFingerprint: previewTestFingerprint }); }
function submit() { find<{ onSubmit(event: { preventDefault(): void }): void }>(panel(), type => type === "form")!.onSubmit({ preventDefault() {} }); }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.states = []; mocks.refs = []; mocks.cleanup = undefined;
  memory = new Map(); setItem = vi.fn((key: string, value: string) => memory.set(key, value)); removeItem = vi.fn((key: string) => memory.delete(key));
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => memory.get(key) ?? null, setItem, removeItem });
  send = vi.fn().mockRejectedValue(new Error("Synthetic response loss")); vi.stubGlobal("fetch", send);
  random = vi.spyOn(crypto, "randomUUID"); mocks.request.mockResolvedValue(previewTestData());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("preparation preview form lifetimes (handler-only, no external side effects)", () => {
  it("requires an explicitly loaded review, then previews without durable browser state or navigation", async () => {
    expect(button("Preview campaign and drafts")!.disabled).toBe(true); button("Preview campaign and drafts")!.onClick(); expect(mocks.request).not.toHaveBeenCalled();
    loadReview(); button("Preview campaign and drafts")!.onClick(); await flush();
    expect(preview()).toEqual(previewTestData()); expect(mocks.request).toHaveBeenCalledExactlyOnceWith(previewTestInput, previewTestFingerprint, expect.any(AbortController));
    expect(setItem).not.toHaveBeenCalled(); expect(removeItem).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
  });
  it("admits one same-tick preview and blocks save and preset-copy handlers while pending", async () => {
    let finish!: (value: ReturnType<typeof previewTestData>) => void; mocks.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    loadReview(); const action = button("Preview campaign and drafts")!.onClick;
    find<{ checked: boolean; onChange(event: { target: { checked: boolean } }): void }>(panel(), (type, value) => type === "input" && value.checked === false)!.onChange({ target: { checked: true } });
    const copy = button("Copy preset settings into this form")!.onClick;
    action(); action(); submit(); copy();
    expect(mocks.request).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled();
    expect(button("Building unsaved preview…")!.disabled).toBe(true); expect(picker().disabled).toBe(true);
    expect(find<{ disabled: boolean }>(panel(), type => type === "fieldset")!.disabled).toBe(true);
    finish(previewTestData()); await flush(); expect(preview()).toBeDefined(); expect(button("Preview campaign and drafts")!.disabled).toBe(false);
  });
  it("clears previews when settings or the exact review changes", async () => {
    loadReview(); button("Preview campaign and drafts")!.onClick(); await flush(); expect(preview()).toBeDefined();
    fields().onChange({ ...fields().values, name: "Changed" }); expect(preview()).toBeUndefined();
    button("Preview campaign and drafts")!.onClick(); await flush(); expect(preview()).toBeDefined();
    picker().onReview(undefined); expect(preview()).toBeUndefined(); expect(button("Preview campaign and drafts")!.disabled).toBe(true);
  });
  it("cancels and fences a late response even after inputs return to the original values", async () => {
    let finish!: (value: ReturnType<typeof previewTestData>) => void; mocks.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    loadReview(); button("Preview campaign and drafts")!.onClick(); const controller = mocks.request.mock.calls[0]![2] as AbortController;
    fields().onChange({ ...previewTestInput, name: "Changed" }); fields().onChange(previewTestInput);
    expect(controller.signal.aborted).toBe(true); finish(previewTestData()); await flush(); expect(preview()).toBeUndefined();
    expect(button("Preview campaign and drafts")!.disabled).toBe(false);
  });
  it("an old request cannot replace a newer request or release its busy fence", async () => {
    let first!: (value: ReturnType<typeof previewTestData>) => void, second!: (value: ReturnType<typeof previewTestData>) => void;
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockImplementationOnce(() => new Promise(resolve => { second = resolve; }));
    loadReview(); button("Preview campaign and drafts")!.onClick(); picker().onReview(undefined); loadReview(); button("Preview campaign and drafts")!.onClick();
    first(previewTestData()); await flush(); expect(preview()).toBeUndefined(); expect(button("Building unsaved preview…")!.disabled).toBe(true);
    second(previewTestData()); await flush(); expect(preview()).toBeDefined();
  });
  it("aborts and ignores response completion after user/workspace editor unmount", async () => {
    let finish!: (value: ReturnType<typeof previewTestData>) => void; mocks.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    loadReview(); button("Preview campaign and drafts")!.onClick(); const controller = mocks.request.mock.calls[0]![2] as AbortController;
    mocks.cleanup!(); const oldState = [...mocks.states]; finish(previewTestData()); await flush();
    expect(controller.signal.aborted).toBe(true); expect(mocks.states).toEqual(oldState); expect(mocks.push).not.toHaveBeenCalled();
  });
  it("handles failures without an unhandled rejection, stale success or lost form values", async () => {
    loadReview(); button("Preview campaign and drafts")!.onClick(); await flush(); mocks.request.mockRejectedValue(new Error("Private synthetic failure"));
    button("Preview campaign and drafts")!.onClick(); await flush(); expect(preview()).toBeUndefined(); expect(fields().values).toEqual(previewTestInput);
    expect(button("Preview campaign and drafts")!.disabled).toBe(false); expect(mocks.states).toContain("No verified preview was received. Nothing was prepared or sent. Reload the exact approved package review, check current profile settings, and try previewing again.");
    expect(setItem).not.toHaveBeenCalled();
  });
  it.each(["saved", "unreadable"])("does not preview over a %s durable preparation attempt", async kind => {
    memory.set(preparationStorageKey(props), kind === "saved" ? JSON.stringify(createPreparationAttempt(props, previewTestInput, reviewTestUuid(8), previewTestFingerprint)) : "broken");
    const action = button("Preview campaign and drafts"); if (action) { expect(action.disabled).toBe(true); action.onClick(); }
    await flush(); expect(mocks.request).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled(); expect(removeItem).not.toHaveBeenCalled();
  });
  it("keeps explicit saving separate and preserves its existing uncertain-attempt recovery", async () => {
    loadReview(); button("Preview campaign and drafts")!.onClick(); await flush(); submit(); await flush();
    expect(preview()).toBeUndefined(); expect(setItem).toHaveBeenCalledOnce(); expect(random).toHaveBeenCalledOnce(); expect(send).toHaveBeenCalledOnce();
    expect(button("Preview campaign and drafts")).toBeUndefined(); expect(button("Retry same preparation")).toBeDefined(); expect(memory.size).toBe(1);
  });
});
