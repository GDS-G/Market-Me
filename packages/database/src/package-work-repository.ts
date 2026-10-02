import type { DatabaseClient } from "./client";
import { PACKAGE_WORK_PAGE_SIZE, PACKAGE_WORK_RUN_LIMIT, packageWorkPage, packageWorkSnapshot, packageWorkUuid, type PackageWorkSnapshot } from "./package-work-models";

/** Exact saved lineage, not current approval/launch eligibility. No domain writes or network calls. */
export class PackageWorkRepository {
  constructor(private readonly sql: DatabaseClient) {}
  async getSnapshot(workspaceId: string, packageId: string, actorUserId: string, page = 1): Promise<PackageWorkSnapshot | undefined> {
    const workspace = packageWorkUuid(workspaceId), contentPackage = packageWorkUuid(packageId), actor = packageWorkUuid(actorUserId), selectedPage = packageWorkPage(page);
    const rows = await this.sql`
      WITH scope AS (
        SELECT p.id,p.workspace_id,left(p.title,200) AS title,p.version,p.status,m.role
        FROM content_package p JOIN workspace_membership m ON m.workspace_id=p.workspace_id AND m.user_id=${actor}
        WHERE p.workspace_id=${workspace} AND p.id=${contentPackage}
      ), selected AS (
        SELECT p.* FROM campaign_preparation p JOIN scope s ON s.id=p.content_package_id AND s.workspace_id=p.workspace_id
        ORDER BY p.created_at DESC,p.id LIMIT ${PACKAGE_WORK_PAGE_SIZE + 1} OFFSET ${(selectedPage - 1) * PACKAGE_WORK_PAGE_SIZE}
      )
      SELECT s.workspace_id,s.id AS package_id,s.title,s.version AS package_version,s.status AS package_status,s.role,
        statement_timestamp() AS observed_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',p.id,'campaignId',p.campaign_id,'campaignName',left(c.name,200),'packageVersion',p.content_package_version,'createdAt',p.created_at,
          'lineageValid',(c.id IS NOT NULL AND cv.id IS NOT NULL AND g.id IS NOT NULL),
          'drafts',(SELECT jsonb_agg(jsonb_build_object(
            'draftId',entry.value->>'draftId','initialVersionId',entry.value->>'versionId',
            'audienceLabel',left(COALESCE(p.reference_snapshot->'audiences'->(entry.ordinality::int-1)->>'name','General audience'),200),
            'current',CASE WHEN d.id IS NOT NULL AND initial.id IS NOT NULL AND current.id IS NOT NULL THEN jsonb_build_object(
              'versionId',current.id,'versionNumber',current.version_number,'status',d.status) ELSE NULL END
          ) ORDER BY entry.ordinality)
          FROM jsonb_array_elements(p.prepared_drafts) WITH ORDINALITY entry(value,ordinality)
          LEFT JOIN content_draft d ON d.id::text=entry.value->>'draftId' AND d.workspace_id=p.workspace_id AND d.draft_generation_id=p.generation_id
          LEFT JOIN content_draft_version initial ON initial.id::text=entry.value->>'versionId' AND initial.content_draft_id=d.id
          LEFT JOIN content_draft_version current ON current.id=d.current_version_id AND current.content_draft_id=d.id),
          'finalization',CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id',f.id,'finalizedVersionId',f.finalized_version_id,'selectedDraftId',f.content_draft_id,
            'selectedDraftVersionId',f.content_draft_version_id,'createdAt',f.created_at,
            'runs',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'createdAt',r.created_at) ORDER BY r.created_at DESC,r.id)
              FROM (SELECT id,status,created_at FROM campaign_instance
                WHERE workspace_id=p.workspace_id AND campaign_id=p.campaign_id AND campaign_version_id=f.finalized_version_id
                ORDER BY created_at DESC,id LIMIT ${PACKAGE_WORK_RUN_LIMIT + 1}) r),'[]'::jsonb)
          ) END
        ) ORDER BY p.created_at DESC,p.id)
        FROM selected p
        LEFT JOIN campaign c ON c.id=p.campaign_id AND c.workspace_id=p.workspace_id
        LEFT JOIN campaign_version cv ON cv.id=p.planning_version_id AND cv.campaign_id=c.id
        LEFT JOIN draft_generation g ON g.id=p.generation_id AND g.workspace_id=p.workspace_id AND g.campaign_version_id=p.planning_version_id
          AND g.content_package_id=p.content_package_id AND g.content_package_version=p.content_package_version
        LEFT JOIN campaign_finalization f ON f.preparation_id=p.id AND f.workspace_id=p.workspace_id AND f.campaign_id=p.campaign_id AND f.planning_version_id=p.planning_version_id
        ),'[]'::jsonb)::text AS preparations_json
      FROM scope s`;
    return rows[0] ? packageWorkSnapshot(rows[0], selectedPage) : undefined;
  }
}
