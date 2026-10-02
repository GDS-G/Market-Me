import type { DatabaseClient } from "./client";
import { DRAFT_CATALOG_LIMITS, draftCatalogUuid, encodeDraftCatalogCursor, normalizeDraftCatalogQuery, type DraftCatalogSnapshot } from "./draft-catalog-models";

/** Current variant discovery without full generation/claim hydration or generation side effects. */
export class DraftCatalogRepository {
  constructor(private readonly sql: DatabaseClient) {}
  async getPage(workspaceId: string, actorUserId: string, input: unknown = {}): Promise<DraftCatalogSnapshot | undefined> {
    const workspace = draftCatalogUuid(workspaceId), actor = draftCatalogUuid(actorUserId), filters = normalizeDraftCatalogQuery(workspace, input);
    const at = filters.cursor?.at ?? null, id = filters.cursor?.id ?? null;
    const [row] = await this.sql<{ snapshot: string }[]>`
      WITH scope AS (
        SELECT w.id FROM workspace w JOIN workspace_membership m ON m.workspace_id=w.id AND m.user_id=${actor} WHERE w.id=${workspace}
      ), drafts AS (
        SELECT d.id,d.status,d.updated_at,v.id AS version_id,v.version_number,v.headline,v.body,
          c.id AS campaign_id,c.name AS campaign_name,p.id AS package_id,p.title AS package_title,a.name AS audience_name
        FROM content_draft d JOIN scope s ON s.id=d.workspace_id
        JOIN content_draft_version v ON v.id=d.current_version_id AND v.content_draft_id=d.id
        JOIN draft_generation g ON g.id=d.draft_generation_id AND g.workspace_id=d.workspace_id
        JOIN campaign_version cv ON cv.id=g.campaign_version_id
        JOIN campaign c ON c.id=cv.campaign_id AND c.workspace_id=d.workspace_id
        JOIN content_package p ON p.id=g.content_package_id AND p.workspace_id=d.workspace_id
        LEFT JOIN audience_profile_version av ON av.id=d.audience_profile_version_id
        LEFT JOIN audience_profile a ON a.id=av.audience_profile_id AND a.workspace_id=d.workspace_id
        WHERE d.audience_profile_version_id IS NULL OR a.id IS NOT NULL
      ), matched AS (
        SELECT * FROM drafts WHERE (${filters.status}::text IS NULL OR status=${filters.status}) AND (
          ${filters.query}='' OR strpos(lower(headline),lower(${filters.query}))>0 OR strpos(lower(body),lower(${filters.query}))>0
          OR strpos(lower(campaign_name),lower(${filters.query}))>0 OR strpos(lower(package_title),lower(${filters.query}))>0
          OR strpos(lower(coalesce(audience_name,'')),lower(${filters.query}))>0
        )
      ), page AS (
        -- The explicit text cast prevents postgres.js from rounding through Date.
        SELECT * FROM matched WHERE ${at}::text IS NULL OR (updated_at,id)<(${at}::text::timestamptz,${id}::uuid)
        ORDER BY updated_at DESC,id DESC LIMIT ${DRAFT_CATALOG_LIMITS.pageSize + 1}
      ), visible AS (
        SELECT * FROM page ORDER BY updated_at DESC,id DESC LIMIT ${DRAFT_CATALOG_LIMITS.pageSize}
      )
      SELECT jsonb_build_object('schemaVersion',1,'workspaceId',s.id,'observedAt',statement_timestamp(),
        'filters',jsonb_build_object('query',${filters.query}::text,'status',${filters.status}::text),
        'totalDrafts',(SELECT count(*)::text FROM drafts),'totalMatches',(SELECT count(*)::text FROM matched),
        'hasMore',(SELECT count(*)>${DRAFT_CATALOG_LIMITS.pageSize} FROM page),
        'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',d.id,'currentVersionId',d.version_id,'versionNumber',d.version_number,'headline',d.headline,
          'bodyPreview',left(d.body,${DRAFT_CATALOG_LIMITS.bodyCharacters}),'bodyCharacters',char_length(d.body)::text,
          'bodyTruncated',char_length(d.body)>${DRAFT_CATALOG_LIMITS.bodyCharacters},
          'status',d.status,'updatedAt',to_char(d.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'campaignId',d.campaign_id,'campaignName',d.campaign_name,'packageId',d.package_id,'packageTitle',d.package_title,'audienceName',d.audience_name
        ) ORDER BY d.updated_at DESC,d.id DESC) FROM visible d),'[]'::jsonb))::text AS snapshot FROM scope s`;
    if (!row) return undefined;
    if (Buffer.byteLength(row.snapshot, "utf8") > DRAFT_CATALOG_LIMITS.responseBytes) throw new Error("Draft catalog exceeds the safe display limit. Narrow the search.");
    const { hasMore, ...data } = JSON.parse(row.snapshot) as Omit<DraftCatalogSnapshot, "nextCursor"> & { hasMore: boolean };
    const last = data.items.at(-1);
    if (hasMore && !last) throw new Error("Incomplete draft catalog page.");
    const result: DraftCatalogSnapshot = { ...data, nextCursor: hasMore && last ? encodeDraftCatalogCursor(workspace, filters, { at: last.updatedAt, id: last.id }) : null };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > DRAFT_CATALOG_LIMITS.responseBytes) throw new Error("Draft catalog exceeds the safe display limit. Narrow the search.");
    return result;
  }
}
