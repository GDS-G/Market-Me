import type { DatabaseClient } from "./client";
import { CONTENT_CATALOG_LIMITS, contentCatalogUuid, encodeContentCatalogCursor, normalizeContentCatalogQuery, type ContentCatalogSnapshot } from "./content-catalog-models";

/** Lightweight current-member listing; never hydrates full evidence or extracted content. */
export class ContentCatalogRepository {
  constructor(private readonly sql: DatabaseClient) {}
  async getPage(workspaceId: string, actorUserId: string, input: unknown = {}): Promise<ContentCatalogSnapshot | undefined> {
    const workspace = contentCatalogUuid(workspaceId), actor = contentCatalogUuid(actorUserId), filters = normalizeContentCatalogQuery(workspace, input);
    // Bind timestamp text first: postgres.js serializes inferred timestamptz
    // parameters through Date, which would erase sub-millisecond cursor digits.
    const at = filters.cursor?.at ?? null, id = filters.cursor?.id ?? null;
    const [row] = await this.sql<{ snapshot: string }[]>`
      WITH scope AS (
        SELECT w.id FROM workspace w JOIN active_workspace_membership m ON m.workspace_id=w.id AND m.user_id=${actor} WHERE w.id=${workspace}
      ), packages AS (
        SELECT p.id,p.title,p.status,p.confidence,p.updated_at FROM content_package p JOIN scope s ON s.id=p.workspace_id
        JOIN smart_source ss ON ss.id=p.smart_source_id AND ss.workspace_id=p.workspace_id
        JOIN source_item root ON root.id=p.root_source_item_id AND root.workspace_id=p.workspace_id AND root.smart_source_id=p.smart_source_id
      ), assets AS (
        SELECT a.id,a.content_package_id,a.file_name FROM content_asset a JOIN packages p ON p.id=a.content_package_id
        LEFT JOIN source_item i ON i.id=a.source_item_id
        WHERE a.source_item_id IS NULL OR i.workspace_id=${workspace}
      ), matched AS (
        SELECT p.* FROM packages p WHERE (${filters.status}::text IS NULL OR p.status=${filters.status})
          AND (${filters.query}='' OR strpos(lower(p.title),lower(${filters.query}))>0 OR EXISTS (
            SELECT 1 FROM assets a WHERE a.content_package_id=p.id AND strpos(lower(a.file_name),lower(${filters.query}))>0
          ))
      ), page AS (
        SELECT * FROM matched WHERE ${at}::text IS NULL OR (updated_at,id)<(${at}::text::timestamptz,${id}::uuid)
        ORDER BY updated_at DESC,id DESC LIMIT ${CONTENT_CATALOG_LIMITS.pageSize + 1}
      ), visible AS (
        SELECT * FROM page ORDER BY updated_at DESC,id DESC LIMIT ${CONTENT_CATALOG_LIMITS.pageSize}
      )
      SELECT jsonb_build_object('schemaVersion',1,'workspaceId',s.id,'observedAt',statement_timestamp(),
        'filters',jsonb_build_object('query',${filters.query}::text,'status',${filters.status}::text),
        'totalPackages',(SELECT count(*)::text FROM packages),'totalMatches',(SELECT count(*)::text FROM matched),
        'hasMore',(SELECT count(*)>${CONTENT_CATALOG_LIMITS.pageSize} FROM page),
        'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',p.id,'title',p.title,'status',p.status,'confidence',p.confidence,
          'updatedAt',to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'assetCount',(SELECT count(*)::text FROM assets a WHERE a.content_package_id=p.id),
          'evidenceCount',(SELECT count(*)::text FROM evidence_item e WHERE e.content_package_id=p.id),
          'fileNames',COALESCE((SELECT jsonb_agg(a.file_name ORDER BY a.file_name,a.id) FROM (
            SELECT a.id,a.file_name FROM assets a WHERE a.content_package_id=p.id ORDER BY a.file_name,a.id LIMIT ${CONTENT_CATALOG_LIMITS.fileNames}
          ) a),'[]'::jsonb)) ORDER BY p.updated_at DESC,p.id DESC) FROM visible p),'[]'::jsonb)
      )::text AS snapshot FROM scope s`;
    if (!row) return undefined;
    if (Buffer.byteLength(row.snapshot, "utf8") > CONTENT_CATALOG_LIMITS.responseBytes) throw new Error("Catalog response exceeds the safe display limit. Narrow the search.");
    const { hasMore, ...data } = JSON.parse(row.snapshot) as Omit<ContentCatalogSnapshot, "nextCursor"> & { hasMore: boolean };
    const last = data.items.at(-1);
    if (hasMore && !last) throw new Error("Incomplete catalog page.");
    const result: ContentCatalogSnapshot = { ...data, nextCursor: hasMore && last ? encodeContentCatalogCursor(workspace, filters, { at: last.updatedAt, id: last.id }) : null };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > CONTENT_CATALOG_LIMITS.responseBytes) throw new Error("Catalog response exceeds the safe display limit. Narrow the search.");
    return result;
  }
}
