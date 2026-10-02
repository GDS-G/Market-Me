import type { DatabaseClient } from "./client";
import { WORKSPACE_ANALYTICS_LIMITS, workspaceAnalyticsUuid, type WorkspaceAnalyticsSnapshot } from "./workspace-analytics-models";

/** One statement/MVCC snapshot, including membership and optional Campaign scope. No writes or provider I/O. */
export class WorkspaceAnalyticsRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async getSnapshot(workspaceId: string, actorUserId: string, campaignId?: string): Promise<WorkspaceAnalyticsSnapshot | undefined> {
    const workspace = workspaceAnalyticsUuid(workspaceId), actor = workspaceAnalyticsUuid(actorUserId), campaign = campaignId === undefined ? null : workspaceAnalyticsUuid(campaignId);
    const [row] = await this.sql<{ snapshot: string }[]>`
      WITH scope AS (
        SELECT w.id AS workspace_id,c.id AS campaign_id,c.name AS campaign_name
        FROM workspace w JOIN active_workspace_membership m ON m.workspace_id=w.id AND m.user_id=${actor}
        LEFT JOIN campaign c ON c.workspace_id=w.id AND c.id=${campaign}
        WHERE w.id=${workspace} AND (${campaign}::uuid IS NULL OR c.id IS NOT NULL)
      ), runs AS (
        SELECT i.id,i.campaign_id,i.campaign_version_id,i.status,i.created_at,c.name AS campaign_name
        FROM campaign_instance i JOIN scope s ON s.workspace_id=i.workspace_id
        JOIN campaign c ON c.id=i.campaign_id AND c.workspace_id=i.workspace_id
        WHERE s.campaign_id IS NULL OR i.campaign_id=s.campaign_id
      ), publications AS (
        SELECT p.id,p.status,cc.provider FROM publication_action p
        JOIN scope s ON s.workspace_id=p.workspace_id JOIN runs r ON r.id=p.campaign_instance_id
        JOIN channel_connection cc ON cc.id=p.channel_connection_id AND cc.workspace_id=p.workspace_id
      ), events AS (
        SELECT e.event_type,e.source,e.currency,e.value,e.occurred_at
        FROM measurement_event e JOIN scope s ON s.workspace_id=e.workspace_id
        LEFT JOIN campaign_instance i ON i.id=e.campaign_instance_id AND i.workspace_id=e.workspace_id
        WHERE s.campaign_id IS NULL OR (
          (e.campaign_id=s.campaign_id OR (e.campaign_id IS NULL AND i.campaign_id=s.campaign_id))
          AND (e.campaign_instance_id IS NULL OR i.campaign_id=s.campaign_id)
        )
      ), event_groups AS (
        SELECT event_type,source,currency,count(*)::text AS event_count,count(value)::text AS value_count,
          sum(value)::text AS value_total,min(occurred_at) AS first_occurred_at,max(occurred_at) AS last_occurred_at
        FROM events GROUP BY event_type,source,currency
      ), metrics AS (
        SELECT t.metric_type,t.metric_total,t.observed_at,p.id AS publication_id,
          CASE WHEN t.report_snapshot_id IS NOT NULL THEN 'mailchimp_email' ELSE 'mastodon_account' END AS provider
        FROM campaign_provider_metric_total t JOIN scope s ON s.workspace_id=t.workspace_id
        JOIN runs r ON r.id=t.campaign_instance_id
        JOIN publication_action p ON p.id=t.publication_action_id AND p.workspace_id=t.workspace_id AND p.campaign_instance_id=t.campaign_instance_id
        JOIN publications scoped ON scoped.id=p.id
        LEFT JOIN mailchimp_campaign_report_snapshot email ON email.id=t.report_snapshot_id AND email.workspace_id=t.workspace_id AND email.publication_action_id=t.publication_action_id
        LEFT JOIN mastodon_status_report_snapshot social ON social.id=t.mastodon_report_snapshot_id AND social.workspace_id=t.workspace_id AND social.publication_action_id=t.publication_action_id
        WHERE (email.id IS NOT NULL AND scoped.provider='mailchimp_email') OR (social.id IS NOT NULL AND scoped.provider='mastodon_account')
      )
      SELECT jsonb_build_object(
        'schemaVersion',1,'workspaceId',s.workspace_id,'observedAt',statement_timestamp(),
        'campaign',CASE WHEN s.campaign_id IS NULL THEN NULL ELSE jsonb_build_object('id',s.campaign_id,'name',s.campaign_name) END,
        'totals',jsonb_build_object('campaignRuns',(SELECT count(*)::text FROM runs),'publicationActions',(SELECT count(*)::text FROM publications),
          'measurementEvents',(SELECT count(*)::text FROM events),'providerMetricRows',(SELECT count(*)::text FROM metrics)),
        'runStatuses',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',r.status,'count',r.count) ORDER BY r.status) FROM (SELECT status,count(*)::text AS count FROM runs GROUP BY status) r),'[]'::jsonb),
        'publicationStatuses',COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',p.provider,'status',p.status,'count',p.count) ORDER BY p.provider,p.status)
          FROM (SELECT provider,status,count(*)::text AS count FROM publications GROUP BY provider,status) p),'[]'::jsonb),
        'measurements',jsonb_build_object('groupCount',(SELECT count(*)::text FROM event_groups),'hasMore',(SELECT count(*)>${WORKSPACE_ANALYTICS_LIMITS.measurementGroups} FROM event_groups),
          'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('eventType',e.event_type,'source',e.source,'currency',e.currency,'eventCount',e.event_count,'valueCount',e.value_count,
            'valueTotal',e.value_total,'firstOccurredAt',e.first_occurred_at,'lastOccurredAt',e.last_occurred_at) ORDER BY e.event_type,e.source,e.currency NULLS FIRST)
            FROM (SELECT * FROM event_groups ORDER BY event_type,source,currency NULLS FIRST LIMIT ${WORKSPACE_ANALYTICS_LIMITS.measurementGroups}) e),'[]'::jsonb)),
        'providerMetrics',COALESCE((SELECT jsonb_agg(jsonb_build_object('provider',t.provider,'metricType',t.metric_type,'metricTotal',t.total,
          'publicationCount',t.publications,'firstObservedAt',t.first_observed_at,'lastObservedAt',t.last_observed_at) ORDER BY t.provider,t.metric_type)
          FROM (SELECT provider,metric_type,sum(metric_total)::text AS total,count(DISTINCT publication_id)::text AS publications,
            min(observed_at) AS first_observed_at,max(observed_at) AS last_observed_at FROM metrics GROUP BY provider,metric_type) t),'[]'::jsonb),
        'recentRuns',jsonb_build_object('hasMore',(SELECT count(*)>${WORKSPACE_ANALYTICS_LIMITS.recentRuns} FROM runs),
          'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'campaignId',r.campaign_id,'campaignVersionId',r.campaign_version_id,'campaignName',r.campaign_name,
            'status',r.status,'createdAt',r.created_at) ORDER BY r.created_at DESC,r.id)
            FROM (SELECT * FROM runs ORDER BY created_at DESC,id LIMIT ${WORKSPACE_ANALYTICS_LIMITS.recentRuns}) r),'[]'::jsonb))
      )::text AS snapshot FROM scope s`;
    if (!row) return undefined;
    if (Buffer.byteLength(row.snapshot, "utf8") > WORKSPACE_ANALYTICS_LIMITS.responseBytes) throw new Error("Analytics details exceed the safe display limit. Select a narrower Campaign scope.");
    // JSON text is deliberately decoded here: numeric sums were explicitly cast
    // to text in SQL, so neither postgres nor JavaScript can round their values.
    return JSON.parse(row.snapshot) as WorkspaceAnalyticsSnapshot;
  }
}
