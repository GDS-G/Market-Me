import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourcePresetPicker } from "./source-preset-picker";
import { SourcePreparationBindingForm } from "./source-preparation-binding-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const scope = { workspaceId: "11111111-1111-4111-8111-111111111111", smartSourceId: "22222222-2222-4222-8222-222222222222" };

describe("source preset chooser rendering boundaries", () => {
  it("begins without automatic reads or selection and clearly explains the values-only boundary", () => {
    const onCopy = vi.fn();
    const html = renderToStaticMarkup(createElement(SourcePresetPicker, { ...scope, disabled: false, onCopy }));
    expect(html).toContain("Browse preparation presets");
    expect(html).toContain("never changes source synchronization or the approval-linked enabled checkbox");
    expect(html).not.toContain("Saved preparation preset</span>");
    expect(html).not.toContain("Copy preset into source settings</button>");
    expect(onCopy).not.toHaveBeenCalled();
  });
  it("disables browsing while a parent operation or uncertain save holds the editor", () => {
    const html = renderToStaticMarkup(createElement(SourcePresetPicker, { ...scope, disabled: true, onCopy: vi.fn() }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Browse preparation presets/);
  });
  it.each([false, true])("only exposes the chooser for canWrite=%s without changing initial source binding values", canWrite => {
    const html = renderToStaticMarkup(createElement(SourcePreparationBindingForm, { ...scope,
      sourceVersion: 3, sourceEnabled: false, canWrite, commands: [], brands: [], audiences: [], destinations: [] }));
    expect(html.includes("Browse preparation presets")).toBe(canWrite);
    expect(html).not.toContain('type="checkbox" checked=""');
    expect(html).toContain("Preview this setup");
    expect(html).toContain("Create preparation binding");
  });
});
