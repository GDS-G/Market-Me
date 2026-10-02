import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PACKAGE_WORK_DRAFT_STATES, PACKAGE_WORK_RUN_STATES, packageWorkPage, packageWorkSnapshot, packageWorkUuid } from "./package-work-models";
const id = () => randomUUID(), at = "2026-10-01T12:00:00.000Z";
const variant = () => ({ draftId: id(), initialVersionId: id(), audienceLabel: "Synthetic audience", current: { versionId: id(), versionNumber: 2, status: "working" } });
const preparation = () => ({ id: id(), campaignId: id(), campaignName: "Synthetic plan", packageVersion: 1, createdAt: at, lineageValid: true, drafts: [variant()], finalization: null as unknown });
const row = (preparations: unknown[] = []) => ({ workspaceId: id(), packageId: id(), title: "Synthetic package", packageVersion: 2, packageStatus: "approved", role: "owner", observedAt: at, preparationsJson: JSON.stringify(preparations) });
describe("minimized package work projection", () => {
  it.each(["owner", "admin", "editor", "approver", "analyst", "viewer"])("projects current %s membership without grants or private receipt fields", role => {
    const input = row([preparation()]), result = packageWorkSnapshot({ ...input, role, secret: "not returned" }, 1);
    expect(result.role).toBe(role); expect(result.preparations).toHaveLength(1); expect(result).not.toHaveProperty("secret");
    expect(result).not.toHaveProperty("preparationsJson"); expect(result.preparations[0]).not.toHaveProperty("lineageValid");
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.preparations[0]?.drafts[0]?.current)).toBe(true);
  });
  it("normalizes UUIDs but never coerces page values", () => {
    const value = id(); expect(packageWorkUuid(` ${value.toUpperCase()} `)).toBe(value);
    expect(packageWorkPage()).toBe(1); expect(packageWorkPage(1000)).toBe(1000);
  });
  it.each([0, -1, 1.5, NaN, Infinity, 1001, "1", null, true, {}, [], Number.MAX_SAFE_INTEGER])("rejects invalid page %s", value => {
    expect(() => packageWorkPage(value)).toThrow("unavailable");
  });
  it.each([undefined, null, "", "00000000-0000-0000-0000-000000000000", "../other", "11111111-1111-4111-8111-111111111111?role=owner"])("rejects malformed identity %s", value => {
    expect(() => packageWorkUuid(value)).toThrow("unavailable");
  });
  it.each(PACKAGE_WORK_DRAFT_STATES)("preserves %s as current state, separate from captured version", status => {
    const p = preparation(); p.drafts[0]!.current.status = status;
    const result = packageWorkSnapshot(row([p]), 1).preparations[0]!.drafts[0]!;
    expect(result.current?.status).toBe(status); expect(result.current?.versionId).not.toBe(result.initialVersionId);
  });
  it.each(PACKAGE_WORK_RUN_STATES)("preserves exact-version run %s without a delivery flag", status => {
    const p = preparation(); p.finalization = { id: id(), finalizedVersionId: id(), selectedDraftId: p.drafts[0]!.draftId,
      selectedDraftVersionId: id(), createdAt: at, runs: [{ id: id(), status, createdAt: at }] };
    const result = packageWorkSnapshot(row([p]), 1).preparations[0]!.finalization!;
    expect(result.runs[0]?.status).toBe(status); expect(result).not.toHaveProperty("delivered"); expect(Object.isFrozen(result.runs)).toBe(true);
  });
  it("keeps lookahead out of both visible collections", () => {
    const p = preparation(); p.finalization = { id: id(), finalizedVersionId: id(), selectedDraftId: p.drafts[0]!.draftId,
      selectedDraftVersionId: id(), createdAt: at, runs: Array.from({ length: 6 }, () => ({ id: id(), status: "completed", createdAt: at })) };
    const result = packageWorkSnapshot(row([p, ...Array.from({ length: 10 }, preparation)]), 1);
    expect(result.preparations).toHaveLength(10); expect(result.hasMore).toBe(true);
    expect(result.preparations[0]?.finalization?.runs).toHaveLength(5); expect(result.preparations[0]?.finalization?.hasMoreRuns).toBe(true);
  });
  it("accepts empty and unavailable historical state without inventing present versions", () => {
    expect(packageWorkSnapshot(row(), 1)).toMatchObject({ hasMore: false, preparations: [] });
    const p = preparation(); (p.drafts[0] as Record<string, unknown>).current = null;
    expect(packageWorkSnapshot(row([p]), 1).preparations[0]?.drafts[0]?.current).toBeNull();
  });
  it.each([
    { role: "__proto__" }, { role: "organization_owner" }, { packageVersion: "1" }, { packageVersion: 0 }, { packageStatus: "future" },
    { observedAt: null }, { observedAt: "invalid" }, { title: "x".repeat(801) }, { preparationsJson: "null" }, { preparationsJson: "{}" },
    { preparationsJson: "[" }, { preparationsJson: " ".repeat(524289) },
  ])("fails closed for malformed snapshot %j", override => { expect(() => packageWorkSnapshot({ ...row(), ...override }, 1)).toThrow(); });
  it("rejects malformed nested lineage, duplicate identities and oversized collections", () => {
    const bad: unknown[] = [];
    bad.push({ ...preparation(), lineageValid: false }, { ...preparation(), drafts: [] }, { ...preparation(), drafts: Array.from({ length: 21 }, variant) });
    const duplicate = variant(); bad.push({ ...preparation(), drafts: [duplicate, duplicate] });
    const p = preparation(); bad.push({ ...p, finalization: { id: id(), finalizedVersionId: id(), selectedDraftId: id(), selectedDraftVersionId: id(), createdAt: at, runs: [] } });
    bad.push({ ...p, drafts: [{ ...variant(), current: { versionId: id(), versionNumber: 1, status: "superseded" } }] });
    for (const value of bad) expect(() => packageWorkSnapshot(row([value]), 1)).toThrow();
    expect(() => packageWorkSnapshot(row([p, p]), 1)).toThrow();
    expect(() => packageWorkSnapshot(row(Array.from({ length: 12 }, preparation)), 1)).toThrow();
  });
  it.each(["missing", "invalid_id", "invalid_time", "invalid_status", "too_many_runs", "duplicate_run"])("rejects invalid finalization %s", variant => {
    const p = preparation(), run = { id: id(), status: "completed", createdAt: at };
    const final: Record<string, unknown> = { id: id(), finalizedVersionId: id(), selectedDraftId: p.drafts[0]!.draftId, selectedDraftVersionId: id(), createdAt: at, runs: [run] };
    if (variant === "missing") delete final.runs;
    if (variant === "invalid_id") final.finalizedVersionId = "bad";
    if (variant === "invalid_time") final.createdAt = null;
    if (variant === "invalid_status") final.runs = [{ ...run, status: "delivered" }];
    if (variant === "too_many_runs") final.runs = Array.from({ length: 7 }, () => ({ ...run, id: id() }));
    if (variant === "duplicate_run") final.runs = [run, run];
    p.finalization = final; expect(() => packageWorkSnapshot(row([p]), 1)).toThrow();
  });
});
