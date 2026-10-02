import type { DatabaseClient } from "./client";
import { ASSET_CATALOG_LIMITS, assetCatalogUuid, encodeAssetCatalogCursor, normalizeAssetCatalogQuery, type AssetCatalogSnapshot } from "./asset-catalog-models";

/** Stored metadata discovery only: no original content, signed URLs or access decisions. */
export class AssetCatalogRepository {
  constructor(private readonly sql: DatabaseClient) {}
  async getPage(workspaceId: string, actorUserId: string, input: unknown = {}): Promise<AssetCatalogSnapshot | undefined> {
    const workspace = assetCatalogUuid(workspaceId), actor = assetCatalogUuid(actorUserId), filters = normalizeAssetCatalogQuery(workspace, input);
    const at = filters.cursor?.at ?? null, id = filters.cursor?.id ?? null;
    const [row] = await this.sql<{ snapshot: string }[]>`
      WITH scope AS (
        SELECT w.id FROM workspace w JOIN workspace_membership m ON m.workspace_id=w.id AND m.user_id=${actor} WHERE w.id=${workspace}
      ), packages AS (
        SELECT p.id,p.title FROM content_package p JOIN scope s ON s.id=p.workspace_id
        JOIN smart_source ss ON ss.id=p.smart_source_id AND ss.workspace_id=p.workspace_id
        JOIN source_item root ON root.id=p.root_source_item_id AND root.workspace_id=p.workspace_id AND root.smart_source_id=p.smart_source_id
      ), assets AS (
        SELECT a.id,a.content_package_id,p.title,a.file_name,a.mime_type,a.role,a.byte_size,a.created_at,
          a.extraction_status,a.media_status,a.scan_status,a.rights_status
        FROM content_asset a JOIN packages p ON p.id=a.content_package_id
        LEFT JOIN source_item i ON i.id=a.source_item_id
        LEFT JOIN content_asset parent ON parent.id=a.source_asset_id
        LEFT JOIN content_package parent_package ON parent_package.id=parent.content_package_id
        WHERE (a.source_item_id IS NULL OR i.workspace_id=${workspace})
          AND (a.source_asset_id IS NULL OR parent_package.workspace_id=${workspace})
      ), matched AS (
        SELECT * FROM assets WHERE (${filters.role}::text IS NULL OR role=${filters.role}) AND (
          ${filters.query}='' OR strpos(lower(file_name),lower(${filters.query}))>0
          OR strpos(lower(mime_type),lower(${filters.query}))>0 OR strpos(lower(title),lower(${filters.query}))>0
        )
      ), page AS (
        -- Assets have created_at, not updated_at. Preserve added-time microseconds.
        SELECT * FROM matched WHERE ${at}::text IS NULL OR (created_at,id)<(${at}::text::timestamptz,${id}::uuid)
        ORDER BY created_at DESC,id DESC LIMIT ${ASSET_CATALOG_LIMITS.pageSize + 1}
      ), visible AS (
        SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT ${ASSET_CATALOG_LIMITS.pageSize}
      )
      SELECT jsonb_build_object('schemaVersion',1,'workspaceId',s.id,'observedAt',statement_timestamp(),
        'filters',jsonb_build_object('query',${filters.query}::text,'role',${filters.role}::text),
        'totalAssets',(SELECT count(*)::text FROM assets),'totalMatches',(SELECT count(*)::text FROM matched),
        'hasMore',(SELECT count(*)>${ASSET_CATALOG_LIMITS.pageSize} FROM page),
        'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',a.id,'packageId',a.content_package_id,'packageTitle',a.title,'fileName',a.file_name,'mimeType',a.mime_type,'role',a.role,
          'byteSize',a.byte_size::text,'createdAt',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'extractionStatus',a.extraction_status,'mediaStatus',a.media_status,'scanStatus',a.scan_status,'rightsStatus',a.rights_status
        ) ORDER BY a.created_at DESC,a.id DESC) FROM visible a),'[]'::jsonb))::text AS snapshot FROM scope s`;
    if (!row) return undefined;
    if (Buffer.byteLength(row.snapshot, "utf8") > ASSET_CATALOG_LIMITS.responseBytes) throw new Error("Asset catalog exceeds the safe display limit. Narrow the search.");
    const { hasMore, ...data } = JSON.parse(row.snapshot) as Omit<AssetCatalogSnapshot, "nextCursor"> & { hasMore: boolean };
    const last = data.items.at(-1);
    if (hasMore && !last) throw new Error("Incomplete asset catalog page.");
    const result: AssetCatalogSnapshot = { ...data, nextCursor: hasMore && last ? encodeAssetCatalogCursor(workspace, filters, { at: last.createdAt, id: last.id }) : null };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > ASSET_CATALOG_LIMITS.responseBytes) throw new Error("Asset catalog exceeds the safe display limit. Narrow the search.");
    return result;
  }
}
