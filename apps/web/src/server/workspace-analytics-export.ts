import { WORKSPACE_ANALYTICS_LIMITS, workspaceAnalyticsUuid, type WorkspaceAnalyticsSnapshot } from "@market-me/database";
import { analyticsCount, analyticsDecimal } from "./workspace-analytics-view";

export type AnalyticsExportFormat = "json" | "csv";
export const ANALYTICS_EXPORT_LIMITS = Object.freeze({ queryCharacters: 512, responseBytes: 2_097_152 });
export const ANALYTICS_EXPORT_NOTES = Object.freeze([
  "A fresh all-time retained-data snapshot, not complete real-world history or a copy of an earlier page render.",
  "Activity, collector events and current provider lifetime totals are separate; no attribution, rates, ROI or unique people are inferred.",
  "Event timestamps describe recorded occurrences; provider timestamps describe current report observations, not interaction time or guaranteed freshness.",
  "Headline counts cover the selected scope; event groups and recent runs are bounded and have explicit hasMore coverage flags.",
  "Values retain original recorded units and separate currencies; null is missing, not zero. No currency conversion or financial verification occurs.",
  "JSON numeric values are exact strings. Import all CSV columns as text to avoid spreadsheet rounding and automatic conversion.",
  "CSV text starting with whitespace/control characters or formula prefixes is marked [text] before quoting. JSON retains original labels. Do not remove this protection in spreadsheets.",
  "Source and Campaign labels are unverified user-supplied text and may contain personal information. Handle downloaded files according to your workspace policies.",
] as const);
export const ANALYTICS_CSV_COLUMNS = Object.freeze([
  "record_type", "key", "workspace_id", "scope_campaign_id", "snapshot_observed_at", "text_value",
  "status", "provider", "event_type", "source", "currency", "currency_is_null", "count", "value_count", "value_total", "value_is_null",
  "publication_count", "first_occurred_at", "last_occurred_at", "first_observed_at", "last_observed_at",
  "run_id", "campaign_id", "campaign_version_id", "campaign_name", "created_at",
] as const);
type CsvColumn = typeof ANALYTICS_CSV_COLUMNS[number];
type CsvRow = Partial<Record<CsvColumn, string>>;
const numericColumns: ReadonlySet<CsvColumn> = new Set(["count", "value_count", "value_total", "publication_count"]);
const count = (value: string) => { analyticsCount(value); return value; };
const decimal = (value: string) => { analyticsDecimal(value); return value; };
const text = (value: string) => { if (typeof value !== "string") throw new Error("Invalid reporting text."); return value; };
const flag = (value: boolean) => { if (typeof value !== "boolean") throw new Error("Invalid reporting coverage."); return value; };

export function analyticsExportQuery(query: URLSearchParams, activeWorkspaceId: string): { format: AnalyticsExportFormat; campaignId?: string } {
  const allowed = ["workspaceId", "campaignId", "format"];
  if (query.toString().length > ANALYTICS_EXPORT_LIMITS.queryCharacters || [...query.keys()].some(key => !allowed.includes(key)) ||
    query.getAll("workspaceId").length !== 1 || query.getAll("format").length !== 1 || query.getAll("campaignId").length > 1) throw new Error("Invalid export selection.");
  if (workspaceAnalyticsUuid(query.get("workspaceId")) !== workspaceAnalyticsUuid(activeWorkspaceId)) throw new Error("Different workspace.");
  const format = query.get("format"); if (format !== "json" && format !== "csv") throw new Error("Invalid export format.");
  return { format, ...(query.has("campaignId") ? { campaignId: workspaceAnalyticsUuid(query.get("campaignId")) } : {}) };
}
export function analyticsExportPath(workspaceId: string, format: AnalyticsExportFormat, campaignId?: string): string {
  if (format !== "json" && format !== "csv") throw new Error("Invalid export format.");
  return `/api/v1/analytics/export?workspaceId=${workspaceAnalyticsUuid(workspaceId)}&format=${format}${campaignId === undefined ? "" : `&campaignId=${workspaceAnalyticsUuid(campaignId)}`}`;
}

/** Explicit field projection prevents future repository extensions leaking through exports. */
function exportSnapshot(data: WorkspaceAnalyticsSnapshot): WorkspaceAnalyticsSnapshot {
  if (data.schemaVersion !== 1 || data.measurements.items.length > WORKSPACE_ANALYTICS_LIMITS.measurementGroups || data.recentRuns.items.length > WORKSPACE_ANALYTICS_LIMITS.recentRuns)
    throw new Error("Unsupported reporting snapshot.");
  return {
    schemaVersion: 1, workspaceId: workspaceAnalyticsUuid(data.workspaceId), observedAt: text(data.observedAt),
    campaign: data.campaign === null ? null : { id: workspaceAnalyticsUuid(data.campaign.id), name: text(data.campaign.name) },
    totals: { campaignRuns: count(data.totals.campaignRuns), publicationActions: count(data.totals.publicationActions), measurementEvents: count(data.totals.measurementEvents), providerMetricRows: count(data.totals.providerMetricRows) },
    runStatuses: data.runStatuses.map(row => ({ status: text(row.status), count: count(row.count) })),
    publicationStatuses: data.publicationStatuses.map(row => ({ status: text(row.status), provider: text(row.provider), count: count(row.count) })),
    measurements: { groupCount: count(data.measurements.groupCount), hasMore: flag(data.measurements.hasMore), items: data.measurements.items.map(row => ({
      eventType: text(row.eventType), source: text(row.source), currency: row.currency === null ? null : text(row.currency), eventCount: count(row.eventCount), valueCount: count(row.valueCount),
      valueTotal: row.valueTotal === null ? null : decimal(row.valueTotal), firstOccurredAt: text(row.firstOccurredAt), lastOccurredAt: text(row.lastOccurredAt),
    })) },
    providerMetrics: data.providerMetrics.map(row => ({ provider: text(row.provider) as typeof row.provider, metricType: text(row.metricType), metricTotal: count(row.metricTotal), publicationCount: count(row.publicationCount), firstObservedAt: text(row.firstObservedAt), lastObservedAt: text(row.lastObservedAt) })),
    recentRuns: { hasMore: flag(data.recentRuns.hasMore), items: data.recentRuns.items.map(row => ({
      id: workspaceAnalyticsUuid(row.id), campaignId: workspaceAnalyticsUuid(row.campaignId), campaignVersionId: workspaceAnalyticsUuid(row.campaignVersionId), campaignName: text(row.campaignName), status: text(row.status), createdAt: text(row.createdAt),
    })) },
  };
}

/** A visible literal prefix is not a spreadsheet quote that may be stripped on re-save. */
function csvCell(value: string, numeric: boolean): string {
  // Whitespace, Unicode format/control characters and locale full-width formula prefixes are untrusted text.
  const safe = !numeric && /^[\s\p{Cc}\p{Cf}=+@\-＝＋－＠]/u.test(value) ? `[text] ${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
function csvSnapshot(data: WorkspaceAnalyticsSnapshot): string {
  const rows: CsvRow[] = [];
  const meta = (key: string, value: string) => rows.push({ record_type: "metadata", key, text_value: value });
  meta("format", "market-me.analytics.snapshot"); meta("format_version", "1"); meta("snapshot_schema_version", "1");
  meta("scope", data.campaign === null ? "workspace" : "campaign"); meta("scope_campaign_name", data.campaign?.name ?? "");
  meta("event_group_count", data.measurements.groupCount); meta("event_groups_returned", String(data.measurements.items.length));
  meta("event_groups_limit", String(WORKSPACE_ANALYTICS_LIMITS.measurementGroups)); meta("event_groups_has_more", String(data.measurements.hasMore));
  meta("recent_runs_returned", String(data.recentRuns.items.length)); meta("recent_runs_limit", String(WORKSPACE_ANALYTICS_LIMITS.recentRuns)); meta("recent_runs_has_more", String(data.recentRuns.hasMore));
  meta("empty_cells", "Not applicable unless currency_is_null/value_is_null explicitly identify a missing recorded field; empty labels remain empty.");
  ANALYTICS_EXPORT_NOTES.forEach((note, index) => rows.push({ record_type: "note", key: String(index + 1), text_value: note }));
  for (const [key, value] of Object.entries(data.totals)) rows.push({ record_type: "total", key, count: value });
  for (const row of data.runStatuses) rows.push({ record_type: "run_status", status: row.status, count: row.count });
  for (const row of data.publicationStatuses) rows.push({ record_type: "publication_status", provider: row.provider, status: row.status, count: row.count });
  for (const row of data.measurements.items) rows.push({ record_type: "event_group", event_type: row.eventType, source: row.source, currency: row.currency ?? "", currency_is_null: String(row.currency === null), count: row.eventCount, value_count: row.valueCount, value_total: row.valueTotal ?? "", value_is_null: String(row.valueTotal === null), first_occurred_at: row.firstOccurredAt, last_occurred_at: row.lastOccurredAt });
  for (const row of data.providerMetrics) rows.push({ record_type: "provider_metric", provider: row.provider, key: row.metricType, count: row.metricTotal, publication_count: row.publicationCount, first_observed_at: row.firstObservedAt, last_observed_at: row.lastObservedAt });
  for (const row of data.recentRuns.items) rows.push({ record_type: "recent_run", run_id: row.id, campaign_id: row.campaignId, campaign_version_id: row.campaignVersionId, campaign_name: row.campaignName, status: row.status, created_at: row.createdAt });
  const common: CsvRow = { workspace_id: data.workspaceId, scope_campaign_id: data.campaign?.id ?? "", snapshot_observed_at: data.observedAt };
  return "\uFEFF" + [ANALYTICS_CSV_COLUMNS.map(column => csvCell(column, false)).join(","), ...rows.map(row => {
    const fields = { ...common, ...row };
    return ANALYTICS_CSV_COLUMNS.map(column => csvCell(fields[column] ?? "", numericColumns.has(column))).join(",");
  })].join("\r\n") + "\r\n";
}

export function serializeAnalyticsExport(snapshot: WorkspaceAnalyticsSnapshot, format: AnalyticsExportFormat): { body: string; filename: string; contentType: string } {
  if (format !== "json" && format !== "csv") throw new Error("Invalid export format.");
  const data = exportSnapshot(snapshot);
  const body = format === "json" ? JSON.stringify({ format: "market-me.analytics.snapshot", formatVersion: 1, notes: ANALYTICS_EXPORT_NOTES,
    limits: { measurementGroups: WORKSPACE_ANALYTICS_LIMITS.measurementGroups, recentRuns: WORKSPACE_ANALYTICS_LIMITS.recentRuns }, snapshot: data }) + "\n" : csvSnapshot(data);
  if (Buffer.byteLength(body, "utf8") > ANALYTICS_EXPORT_LIMITS.responseBytes) throw new Error("Export exceeds the response limit.");
  return { body, filename: `market-me-analytics-${data.workspaceId}${data.campaign ? `-campaign-${data.campaign.id}` : "-workspace"}.${format}`, contentType: format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8" };
}
