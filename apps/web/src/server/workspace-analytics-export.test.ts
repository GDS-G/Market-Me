import { describe, expect, it } from "vitest";
import type { WorkspaceAnalyticsSnapshot } from "@market-me/database";
import { ANALYTICS_CSV_COLUMNS, ANALYTICS_EXPORT_LIMITS, analyticsExportPath, analyticsExportQuery, serializeAnalyticsExport } from "./workspace-analytics-export";
const workspaceId = "22222222-2222-4222-8222-222222222222", campaignId = "33333333-3333-4333-8333-333333333333", runId = "44444444-4444-4444-8444-444444444444";
const time = "2026-10-01T12:00:00.123456Z";
function snapshot(): WorkspaceAnalyticsSnapshot {
  return { schemaVersion: 1, workspaceId, campaign: { id: campaignId, name: 'Café, "synthetic"\r\nsecond line' }, observedAt: time,
    totals: { campaignRuns: "23", publicationActions: "3", measurementEvents: "205", providerMetricRows: "2" },
    runStatuses: [{ status: "completed", count: "23" }], publicationStatuses: [{ provider: "mastodon_account", status: "ambiguous", count: "3" }],
    measurements: { groupCount: "205", hasMore: true, items: [
      { eventType: "purchase", source: "checkout", currency: "USD", eventCount: "4", valueCount: "3", valueTotal: "199999999999999.999997", firstOccurredAt: time, lastOccurredAt: time },
      { eventType: "purchase", source: "adjustment", currency: "EUR", eventCount: "1", valueCount: "1", valueTotal: "-0.000001", firstOccurredAt: time, lastOccurredAt: time },
      { eventType: "destination_visit", source: "", currency: null, eventCount: "2", valueCount: "0", valueTotal: null, firstOccurredAt: time, lastOccurredAt: time },
      { eventType: "custom", source: "import", currency: "", eventCount: "1", valueCount: "1", valueTotal: "0.000000", firstOccurredAt: time, lastOccurredAt: time },
    ] },
    providerMetrics: [{ provider: "mastodon_account", metricType: "mastodon_favourite", metricTotal: "18014398509481982", publicationCount: "2", firstObservedAt: time, lastObservedAt: time }],
    recentRuns: { hasMore: true, items: [{ id: runId, campaignId, campaignVersionId: runId, campaignName: "Synthetic", status: "completed", createdAt: time }] } };
}
/** Independent test parser understands quoted multiline cells; assertions do not split at embedded newlines. */
function parseCsv(body: string): Record<string, string>[] {
  const rows: string[][] = [], row: string[] = []; let cell = "", quoted = false;
  const input = body.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && ch === ",") { row.push(cell); cell = ""; }
    else if (!quoted && ch === "\r" && input[i + 1] === "\n") { row.push(cell); rows.push([...row]); row.length = 0; cell = ""; i++; }
    else cell += ch;
  }
  expect(quoted).toBe(false); expect(cell).toBe(""); expect(row).toHaveLength(0);
  const header = rows.shift()!; expect(header).toEqual(ANALYTICS_CSV_COLUMNS);
  return rows.map(values => { expect(values).toHaveLength(header.length); return Object.fromEntries(header.map((name, index) => [name, values[index]])); });
}
describe("Analytics exact snapshot export", () => {
  it("retains original JSON projection, precision, null, source labels and separate clocks without mutation", () => {
    const data = snapshot(), before = structuredClone(data), output = serializeAnalyticsExport(data, "json"), decoded = JSON.parse(output.body);
    expect(decoded.snapshot).toEqual(before); expect(data).toEqual(before); expect(decoded.formatVersion).toBe(1);
    expect(decoded.limits).toEqual({ measurementGroups: 200, recentRuns: 20 }); expect(decoded.notes.join(" ")).toContain("not complete real-world history");
    expect(decoded.snapshot.providerMetrics[0].metricTotal).toBe("18014398509481982"); expect(decoded.snapshot.measurements.items[0].valueTotal).toBe("199999999999999.999997");
    expect(output.contentType).toBe("application/json; charset=utf-8"); expect(output.filename).toBe(`market-me-analytics-${workspaceId}-campaign-${campaignId}.json`);
  });
  it("exports a rectangular UTF-8 BOM/CRLF CSV with complete metadata, coverage and exact numeric bytes", () => {
    const file = serializeAnalyticsExport(snapshot(), "csv"), rows = parseCsv(file.body);
    expect(file.body.startsWith("\uFEFF")).toBe(true); expect(file.body.endsWith("\r\n")).toBe(true); expect(file.contentType).toBe("text/csv; charset=utf-8");
    for (const row of rows) { expect(row.workspace_id).toBe(workspaceId); expect(row.scope_campaign_id).toBe(campaignId); expect(row.snapshot_observed_at).toBe(time); }
    const meta = Object.fromEntries(rows.filter(row => row.record_type === "metadata").map(row => [row.key, row.text_value]));
    expect(meta).toMatchObject({ format_version: "1", event_group_count: "205", event_groups_returned: "4", event_groups_has_more: "true", recent_runs_has_more: "true", scope_campaign_name: snapshot().campaign!.name });
    const events = rows.filter(row => row.record_type === "event_group"); expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ count: "4", value_count: "3", currency: "USD", value_total: "199999999999999.999997", value_is_null: "false", first_observed_at: "", first_occurred_at: time });
    expect(events[1].value_total).toBe("-0.000001");
    expect(events[2]).toMatchObject({ source: "", currency: "", currency_is_null: "true", value_total: "", value_is_null: "true" });
    expect(events[3]).toMatchObject({ currency: "", currency_is_null: "false", value_total: "0.000000", value_is_null: "false" });
    expect(rows.find(row => row.record_type === "provider_metric")).toMatchObject({ count: "18014398509481982", publication_count: "2", first_observed_at: time, first_occurred_at: "" });
    expect(rows.find(row => row.record_type === "recent_run")).toMatchObject({ run_id: runId, campaign_version_id: runId, created_at: time });
    expect(rows.filter(row => row.record_type === "total")).toHaveLength(4);
  });
  it.each(["=1+2", "+SUM(1,2)", "-1+2", "@SUM(1,2)", "\t=1", "\r=1", "\n=1", "   =1", "\u0000=1", "\u200b=1", "＝1", "＋1", "－1", "＠1", '=1+2";,=3', " trailing-space-prefix", "\uFEFF=1"])("neutralizes untrusted text %j without changing JSON or validated negative amounts", malicious => {
    const data = snapshot(); data.campaign!.name = malicious; data.measurements.items[0].source = malicious; data.recentRuns.items[0].campaignName = malicious;
    const rows = parseCsv(serializeAnalyticsExport(data, "csv").body);
    expect(rows.find(row => row.key === "scope_campaign_name")?.text_value).toBe(`[text] ${malicious}`);
    expect(rows.find(row => row.record_type === "event_group")?.source).toBe(`[text] ${malicious}`);
    expect(rows.find(row => row.record_type === "recent_run")?.campaign_name).toBe(`[text] ${malicious}`);
    expect(rows.filter(row => row.record_type === "event_group")[1].value_total).toBe("-0.000001");
    expect(JSON.parse(serializeAnalyticsExport(data, "json").body).snapshot.campaign.name).toBe(malicious);
  });
  it("keeps delimiter/newline injection inside one field and leaves ordinary Unicode unchanged", () => {
    const data = snapshot(); data.measurements.items[0].source = 'café😀",=1\nnext';
    const rows = parseCsv(serializeAnalyticsExport(data, "csv").body); expect(rows.find(row => row.record_type === "event_group")?.source).toBe(data.measurements.items[0].source);
    expect(rows.filter(row => row.record_type === "event_group")).toHaveLength(4);
  });
  it.each(["json", "csv"] as const)("omits future private extensions at every nesting boundary in %s", format => {
    const data = snapshot();
    for (const value of [data, data.totals, data.campaign!, ...data.runStatuses, ...data.publicationStatuses, data.measurements, ...data.measurements.items, ...data.providerMetrics, data.recentRuns, ...data.recentRuns.items]) Object.assign(value, { privatePayload: "DO_NOT_EXPORT" });
    expect(serializeAnalyticsExport(data, format).body).not.toContain("DO_NOT_EXPORT");
  });
  it("provides metadata and actual zero totals for a valid empty workspace", () => {
    const data = snapshot(); data.campaign = null; data.totals = { campaignRuns: "0", publicationActions: "0", measurementEvents: "0", providerMetricRows: "0" };
    data.runStatuses = []; data.publicationStatuses = []; data.measurements = { groupCount: "0", hasMore: false, items: [] }; data.providerMetrics = []; data.recentRuns = { hasMore: false, items: [] };
    const file = serializeAnalyticsExport(data, "csv"), rows = parseCsv(file.body); expect(file.filename).toContain("-workspace.csv");
    expect(rows.find(row => row.key === "event_groups_has_more")?.text_value).toBe("false"); expect(rows.find(row => row.key === "scope")?.text_value).toBe("workspace");
    expect(rows.filter(row => row.record_type === "total").every(row => row.count === "0")).toBe(true); expect(rows.some(row => row.record_type === "event_group")).toBe(false);
    expect(JSON.parse(serializeAnalyticsExport(data, "json").body).snapshot.campaign).toBeNull();
  });
  it.each(["=1+2", "NaN", "1e6", " 1", "01", "0.1234567"])("rejects malformed numeric text %s in both formats", value => {
    const data = snapshot(); data.measurements.items[0].valueTotal = value;
    for (const format of ["json", "csv"] as const) expect(() => serializeAnalyticsExport(data, format)).toThrow();
  });
  it("rejects negative counts, changed schema, expanded details and object-valued text rather than serializing private data", () => {
    const data = snapshot(); data.totals.campaignRuns = "-1"; expect(() => serializeAnalyticsExport(data, "json")).toThrow();
    const version = snapshot(); Object.assign(version, { schemaVersion: 2 }); expect(() => serializeAnalyticsExport(version, "json")).toThrow();
    const groups = snapshot(); groups.measurements.items = Array(201).fill(groups.measurements.items[0]); expect(() => serializeAnalyticsExport(groups, "csv")).toThrow();
    const runs = snapshot(); runs.recentRuns.items = Array(21).fill(runs.recentRuns.items[0]); expect(() => serializeAnalyticsExport(runs, "csv")).toThrow();
    const privateText = snapshot(); Object.assign(privateText.measurements.items[0], { source: { token: "secret" } }); expect(() => serializeAnalyticsExport(privateText, "json")).toThrow();
    Object.assign(privateText.measurements, { hasMore: "false" }); expect(() => serializeAnalyticsExport(privateText, "csv")).toThrow();
  });
  it.each(["json", "csv"] as const)("bounds actual UTF-8 bytes without successful truncation for %s", format => {
    const data = snapshot(); data.campaign!.name = "é".repeat(ANALYTICS_EXPORT_LIMITS.responseBytes / 2); expect(() => serializeAnalyticsExport(data, format)).toThrow("response limit");
  });
});
describe("Analytics export strict selection", () => {
  it.each(["json", "csv"] as const)("constructs and parses only the selected %s scope", format => {
    const path = analyticsExportPath(workspaceId.toUpperCase(), format, campaignId); expect(analyticsExportQuery(new URL(path, "https://example.invalid").searchParams, workspaceId)).toEqual({ format, campaignId });
    expect(analyticsExportQuery(new URLSearchParams({ workspaceId, format }), workspaceId)).toEqual({ format });
  });
  it.each(["", `workspaceId=${workspaceId}`, "format=json", `workspaceId=${campaignId}&format=json`, `workspaceId=${workspaceId}&format=JSON`, `workspaceId=${workspaceId}&format=csv&format=csv`, `workspaceId=${workspaceId}&workspaceId=${workspaceId}&format=json`, `workspaceId=${workspaceId}&format=json&campaignId=`, `workspaceId=${workspaceId}&format=json&campaignId=${campaignId}&campaignId=${campaignId}`, `workspaceId=${workspaceId}&format=json&actorUserId=owner`, `workspaceId=${workspaceId}&format=json&__proto__=x`, `workspaceId=${workspaceId}&format=json&${"x".repeat(513)}`])("rejects invalid selection %s", query => {
    expect(() => analyticsExportQuery(new URLSearchParams(query), workspaceId)).toThrow();
  });
  it("rejects invalid path IDs and unexpected runtime formats", () => {
    expect(() => analyticsExportPath("../../private", "csv")).toThrow(); expect(() => analyticsExportPath(workspaceId, "json", "bad")).toThrow();
    expect(() => analyticsExportPath(workspaceId, "xml" as "csv")).toThrow(); expect(() => serializeAnalyticsExport(snapshot(), "xml" as "csv")).toThrow();
  });
});
