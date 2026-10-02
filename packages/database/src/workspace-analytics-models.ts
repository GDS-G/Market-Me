/** Reporting observations only; no workflow evaluation or execution authority. */
export const WORKSPACE_ANALYTICS_LIMITS = Object.freeze({ measurementGroups: 200, recentRuns: 20, responseBytes: 1_048_576 });
export function workspaceAnalyticsUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error("Choose a valid workspace or Campaign.");
  return value.toLowerCase();
}
export interface AnalyticsStatusCount { status: string; count: string }
export interface AnalyticsMeasurementGroup {
  eventType: string; source: string; currency: string | null;
  eventCount: string; valueCount: string; valueTotal: string | null;
  firstOccurredAt: string; lastOccurredAt: string;
}
export interface AnalyticsProviderMetric {
  provider: "mailchimp_email" | "mastodon_account"; metricType: string;
  metricTotal: string; publicationCount: string; firstObservedAt: string; lastObservedAt: string;
}
export interface AnalyticsRun {
  id: string; campaignId: string; campaignVersionId: string; campaignName: string;
  status: string; createdAt: string;
}
export interface WorkspaceAnalyticsSnapshot {
  schemaVersion: 1; workspaceId: string; observedAt: string;
  campaign: { id: string; name: string } | null;
  totals: { campaignRuns: string; publicationActions: string; measurementEvents: string; providerMetricRows: string };
  runStatuses: readonly AnalyticsStatusCount[];
  publicationStatuses: readonly (AnalyticsStatusCount & { provider: string })[];
  measurements: { groupCount: string; hasMore: boolean; items: readonly AnalyticsMeasurementGroup[] };
  providerMetrics: readonly AnalyticsProviderMetric[];
  recentRuns: { hasMore: boolean; items: readonly AnalyticsRun[] };
}
