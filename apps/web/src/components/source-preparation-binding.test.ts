import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SourcePreparationCommandSummary, StoredSourcePreparationBinding } from "@market-me/database";
import { SourcePreparationBindingForm, SourcePreparationCommandHistory } from "./source-preparation-binding-form";
import {
  addSourcePreparationAudience,
  initialSourcePreparationBindingValues,
  isScopedSourcePreparationBinding,
  moveSourcePreparationAudience,
  removeSourcePreparationAudience,
  sourcePreparationBindingRequest,
  sourcePreparationBindingRequestPath,
} from "./source-preparation-binding-request";
import { sourcePreparationBindingView, sourcePreparationCommandView } from "../server/source-preparation-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sourceId = "22222222-2222-4222-8222-222222222222";
const bindingId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const audienceA = "55555555-5555-4555-8555-555555555555";
const audienceB = "66666666-6666-4666-8666-666666666666";
const packageId = "77777777-7777-4777-8777-777777777777";
const commandId = "88888888-8888-4888-8888-888888888888";
const approvalId = "99999999-9999-4999-8999-999999999999";
const binding: StoredSourcePreparationBinding = {
  id: bindingId, workspaceId, smartSourceId: sourceId, writerUserId: userId,
  templateKey: "general_announcement", templateVersion: 1, name: "Saved plan", description: "",
  audienceProfileVersionIds: [audienceB, audienceA], informationDepth: "contextual", promotionalStrength: "informational",
  timezone: "UTC", enabled: true, revision: 3, createdBy: userId, updatedBy: userId,
  createdAt: "2026-09-15T10:00:00Z", updatedAt: "2026-09-15T11:00:00Z",
};

describe("source preparation binding browser contract", () => {
  it("retains explicit audience order across add, remove, and move operations", () => {
    expect(addSourcePreparationAudience([audienceB], audienceA)).toEqual([audienceB, audienceA]);
    expect(addSourcePreparationAudience([audienceB, audienceA], audienceB)).toEqual([audienceB, audienceA]);
    expect(moveSourcePreparationAudience([audienceB, audienceA], audienceA, -1)).toEqual([audienceA, audienceB]);
    expect(moveSourcePreparationAudience([audienceB, audienceA], audienceB, -1)).toEqual([audienceB, audienceA]);
    expect(removeSourcePreparationAudience([audienceB, audienceA], audienceB)).toEqual([audienceA]);
  });

  it("builds a strict scoped request without actor or writer authority", () => {
    const view = sourcePreparationBindingView(binding);
    const values = initialSourcePreparationBindingValues(workspaceId, view);
    const serialized = sourcePreparationBindingRequest(values);
    expect(JSON.parse(serialized).audienceProfileVersionIds).toEqual([audienceB, audienceA]);
    expect(JSON.parse(serialized).expectedRevision).toBe(binding.revision);
    expect(serialized).not.toContain("writerUserId"); expect(serialized).not.toContain("actorUserId");
    expect(sourcePreparationBindingRequestPath({ workspaceId, smartSourceId: sourceId }))
      .toBe(`/api/v1/smart-sources/${sourceId}/preparation-binding?workspaceId=${workspaceId}`);
  });

  it("rejects mismatched response scope and malformed audience identity", () => {
    const view = sourcePreparationBindingView(binding);
    expect(isScopedSourcePreparationBinding(view, { workspaceId, smartSourceId: sourceId })).toBe(true);
    expect(isScopedSourcePreparationBinding({ ...view, smartSourceId: packageId }, { workspaceId, smartSourceId: sourceId })).toBe(false);
    expect(isScopedSourcePreparationBinding({ ...view, audienceProfileVersionIds: ["bad"] }, { workspaceId, smartSourceId: sourceId })).toBe(false);
  });

  it("minimizes binding and command DTOs before crossing the client boundary", () => {
    const bindingView = sourcePreparationBindingView(binding);
    expect(bindingView).not.toHaveProperty("writerUserId"); expect(bindingView).not.toHaveProperty("updatedBy"); expect(bindingView).not.toHaveProperty("createdBy");
    const summary: SourcePreparationCommandSummary = {
      id: commandId, contentPackageId: packageId, contentPackageVersion: 4, expectedApprovalId: approvalId,
      bindingRevision: 3, status: "processing", attemptCount: 1, leaseExpiresAt: "2026-09-15T11:05:00Z",
      createdAt: "2026-09-15T11:00:00Z", updatedAt: "2026-09-15T11:01:00Z",
    };
    const view = sourcePreparationCommandView(summary);
    expect(view).not.toHaveProperty("id"); expect(view).not.toHaveProperty("expectedApprovalId");
    expect(view).not.toHaveProperty("leaseExpiresAt"); expect(view).not.toHaveProperty("campaignId");
    expect(JSON.stringify(view)).not.toContain(approvalId);
  });

  it("shows the non-retroactive, non-canceling, non-activation boundary and separates sync pause", () => {
    const html = renderToStaticMarkup(createElement(SourcePreparationBindingForm, {
      workspaceId, smartSourceId: sourceId, sourceEnabled: false, canWrite: false,
      initialBinding: sourcePreparationBindingView(binding), commands: [],
      brands: [], audiences: [{ id: audienceA, name: "Primary audience", versionNumber: 2 }], destinations: [],
    }));
    expect(html).toContain("Existing approvals are not processed retroactively");
    expect(html).toContain("does not cancel work already queued");
    expect(html).toContain("does not approve or finalize a Campaign or draft");
    expect(html).toContain("Source synchronization is paused");
    expect(html).toContain("does not disable this separate binding");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("renders only minimized durable command status and an immutable completed receipt link", () => {
    const completed = sourcePreparationCommandView({
      id: commandId, contentPackageId: packageId, contentPackageVersion: 4, expectedApprovalId: approvalId,
      bindingRevision: 3, status: "completed", attemptCount: 1, preparationId: bindingId, campaignId: sourceId,
      createdAt: "2026-09-15T11:00:00Z", updatedAt: "2026-09-15T11:01:00Z", completedAt: "2026-09-15T11:01:00Z",
    });
    const stopped = sourcePreparationCommandView({
      id: sourceId, contentPackageId: packageId, contentPackageVersion: 5, expectedApprovalId: approvalId,
      bindingRevision: 4, status: "dead_letter", attemptCount: 2, lastErrorCode: "authority_stale", safeError: "The configured writer is no longer eligible.",
      createdAt: "2026-09-15T12:00:00Z", updatedAt: "2026-09-15T12:01:00Z", completedAt: "2026-09-15T12:01:00Z",
    });
    const html = renderToStaticMarkup(createElement(SourcePreparationCommandHistory, { workspaceId, commands: [completed, stopped] }));
    expect(html).toContain(`/campaigns/preparations/${bindingId}?workspaceId=${workspaceId}`);
    expect(html).toContain("do not change or cancel it"); expect(html).toContain("will not retry automatically");
    expect(html).toContain("authority_stale"); expect(html).not.toContain(approvalId);
  });
});
