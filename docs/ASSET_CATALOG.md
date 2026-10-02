# Searchable asset inventory

## Purpose and boundary

Release1.49 adds `/assets` to the single shared desktop/mobile navigation and to the safe workspace-switch section roots. It answers which stored asset records exist,not which files are safe,licensed,downloadable,unique or ready to publish. Literal case-insensitive search covers current filename,MIME type and current containing-package title. The existing roles original/supporting/derivative are optional filters. Query percent,underscore,quotes and backslashes are ordinary characters; outer whitespace is trimmed. PostgreSQL's existing collation governs case; no fuzzy/accent-insensitive/semantic matching is promised.

The listing returns at most30 metadata records with exact full inventory/match counts. Each stored asset is one row,even if multiple records describe the same original file. Assets have `created_at` and no `updated_at`,so ordering is honestly **newest added first**,not recently edited. Rights or other metadata edits do not advance its added-time cursor. All recorded extraction/media/scan/rights states are explicitly labels,not derived clearance. Package review remains the entry for complete evidence and governed actions.

No thumbnails,original bytes,signed URLs,provider fetches,extracted document bodies,hashes,object/provider keys,source paths,recipes,private rights notes or claims are returned or searched. Opening the inventory does not synchronize,generate,approve,activate,download or send anything. No new API,dependency,environment key,schema migration or paid service is introduced. GET terms appear in URLs/history/shared links/access logs; avoid secrets and apply production log redaction/retention.

## Source and lifetime inventory

- `packages/database/src/asset-catalog-models.ts`: DTOs,frozen limits/roles,canonical UUID alias,strict input normalization and asset-domain cursor.
- `asset-catalog-repository.ts`: `AssetCatalogRepository.getPage(workspaceId,actorUserId,input={})`,one current-member metadata SELECT with exact counts and pagination.
- `apps/web/src/server/asset-catalog-view.ts`: safe browser selection/URL helpers,exact byte formatter and five frozen label dictionaries.
- `apps/web/src/app/assets/page.tsx`: authenticated server view,native GET form,empty/results/paging states,links to existing package review. It reuses `content-packages/catalog.module.css` for responsive cards,wrapping,44px controls and3px focus; no copy-specific CSS is needed.
- `workspace-navigation.tsx`: adds Assets to the shared constant navigation array; both presentations now have19 destinations. `workspace-selection.ts` adds only exact `/assets` to the existing `WORKSPACE_SECTION_PATHS` Set. Old query/record URLs remain rejected and reset to `/`.
- `server/database.ts` and lifecycle tests:26th shared-pool repository getter; repository instances/SQL pool are reused,not request authorization or result data.

Only frozen constants/dictionaries,existing static navigation collections and the shared repository/SQL bundle persist across requests. User,workspace,query,cursor,counts,rows and render state are local to each call. No browser storage,new client component or mutable global cache is added.

## Contracts, constants and collections

| Name | Type and intent |
| --- | --- |
| `ASSET_CATALOG_ROLES` | Frozen readonly tuple original,supporting,derivative; `AssetCatalogRole` derives its union. These are the schema's existing roles,not the specification's future arbitrary role vocabulary. |
| `ASSET_CATALOG_LIMITS` | Frozen pageSize30,queryLength120 UTF-16 units before trimming,cursorLength512 base64url characters,responseBytes1048576 UTF-8 bytes. Callers cannot change them. |
| `AssetCatalogFilters` | Trimmed query:string and role:AssetCatalogRole or null. |
| `AssetCatalogCursor` | Exact UTC six-fractional-digit at:string and canonical lowercase id:string. Together an exclusive added-time ordering boundary. |
| `AssetCatalogItem` | id,packageId,packageTitle,fileName,mimeType,role,nullable exact byteSize:string,exact createdAt,extractionStatus,mediaStatus,scanStatus,rightsStatus. No storage/rights evidence or body payload. |
| `AssetCatalogSnapshot` | schemaVersion1,workspaceId,statement observedAt,filters,totalAssets:string,totalMatches:string,readonly items,nextCursor:string|null. Totals are complete for the coherent eligible inventory,not just visible rows. |
| `AssetCatalogSelection` | Web helper shape query plus optional role and original validated encoded cursor. Web omits all-role; repository DTO role is nullable. |

`ASSET_ROLE_LABELS` maps original→Original,supporting→Supporting,derivative→Derivative. `ASSET_EXTRACTION_LABELS` maps pending/completed/skipped/failed to their title-case display. `ASSET_MEDIA_LABELS` maps stored/processed/unsupported/failed likewise. `ASSET_SCAN_LABELS` maps clean→Clean record,infected→Infected record,not_configured→Not configured,failed→Failed. `ASSET_RIGHTS_LABELS` maps unchecked→Unchecked,cleared→Cleared record,restricted→Restricted,expired→Expired record. All are frozen exhaustive typed records; existing database constraints limit values. A Cleared record might no longer apply to a current time,Campaign,Brand,channel or account; this page never evaluates those rights.

`assetCatalogBytes(null)` returns Unavailable; otherwise existing `catalogCount` validates a canonical nonnegative decimal string (up to128 digits),groups it with commas without Number conversion and adds bytes. Thus0 remains0 bytes and9007199254740995 remains9,007,199,254,740,995 bytes. SQL bigint `byte_size::text` prevents lossy serialization. Counts likewise use text before JSON; no numeric approximation or unit rounding is introduced.

## Validation and cursor

`assetCatalogUuid` aliases the proven `contentCatalogUuid` guard for canonical hyphenated version1–8/RFC-variant UUIDs,lowercasing valid values and rejecting nil/arrays/space. `cursorTime` requires calendar-valid year1000–9999,UTC Z and exactly six fractional digits. Date validates only; its rounded serialization never replaces the original timestamp.

`context` hashes JSON `["market-me.asset-catalog",1,normalizedWorkspaceId,normalizedQuery,normalizedRole]` with SHA-256. `encodeAssetCatalogCursor` emits UTF-8 base64url JSON with exactly v1,at,id,context. Decode checks canonical base64url round trip,exact keys/version/context,time and ID. Package/draft cursors are rejected even with empty filters. The hash is unkeyed context validation,not authentication; callers may construct cursors but SQL still authorizes every read.

`normalizeAssetCatalogQuery` accepts only object keys query/role/cursor. Missing query is empty; supplied value must be a string of at most120 UTF-16 units,no Unicode Cc/Cf controls,then outer whitespace is trimmed. Missing/empty/all/null role normalizes to null; otherwise it must be one of the three roles. Missing cursor means newest; supplied empty/oversized/noncanonical/bad/context-mismatched values throw before SQL. Unknown keys,arrays and malformed IDs fail closed.

`assetCatalogSelection` allows only workspaceId/q/role/cursor; duplicate query parameters become arrays and are rejected. Optional workspace hint must match independently selected current scope. It retains validated original cursor bytes. `assetCatalogPath` validates again and uses URLSearchParams,always including the normalized workspace ID. Current recipient membership is still required for copied links.

## SQL, coherence and exact paging

| CTE | Responsibility |
| --- | --- |
| scope | Current workspace_membership for authenticated actor; organization membership alone is insufficient. All six roles may read. |
| packages | Packages in scope with same-workspace Smart Source and same-workspace/root-source-to-Smart-Source lineage. |
| assets | Asset joins coherent package; optional source item must belong to the workspace; optional immediate parent asset must belong to a package in that workspace. Null references remain valid. Select only displayed fields. |
| matched | Optional recorded role and literal lower/strpos query over filename,MIME and package title. Never search bodies or private metadata. |
| page | Exclusive `(created_at,id)<(at,id)`,descending time/UUID,at most31. Explicit text-first timestamp binding prevents postgres.js Date rounding. |
| visible | First30 in the same order; extra row signals hasMore. Totals count all eligible/matched assets independently of the cursor. |

Immediate parent workspace coherence is not recursive derivative-chain validity,renewed malware proof,rights verification or source authenticity. The listing does not expose or traverse parent contents. Corrupt foreign references are excluded rather than followed or repaired. Ordinary same-workspace source/parent references and detached null references remain discoverable. Existing media access and package review retain their stronger authorization/validation duties.

Repository locals workspace/actor/filters/at/id are request-local. `row.snapshot` is text checked for UTF-8 size before JSON.parse; internal hasMore is removed. `last` produces a next cursor only with a31st row; impossible hasMore/empty output throws. Final serialized DTO is checked again. Missing membership returns undefined; validation/infrastructure/size errors propagate. There is no silent label truncation or partial-success count. The1MiB cap does not bound database memory,scan cost or guarantee large-workspace latency.

One statement gives a coherent membership/count/item observation. Later reads honor revocation; prior rendered data cannot be withdrawn. Each page is a new observation,so concurrent additions,deletions and metadata/filter changes can change results or move matches. UI states this and offers refresh/newest. Unchanged data has deterministic nonoverlapping pages even with timestamp ties and adjacent microseconds.

## UI behavior and operations

Page locals user/workspace/selection/data/firstPage are request-local. Missing session/workspace redirects to login; malformed query or mismatched returned workspace/filters yields notFound; infrastructure/size failures use the existing error boundary. Catalog empty,no matches and exhausted cursor have different messages. Filename/package/MIME empty strings get explicit fallback text; originals are React-escaped. Exact timestamps stay in datetime attributes; display uses shared UTC millisecond formatting without changing cursor precision.

The native GET form has a JSON tuple key `[workspaceId,query,role-or-null]`,so applied workspace/filter changes remount uncontrolled controls. Same-selection paging retains identity; search submits no old cursor. Clear resets query/role/cursor; newest/refresh retains normalized query/role. All application links disable prefetch; refresh is an ordinary anchor. Package links open full existing review,not a fabricated asset-detail or direct file URL. No download,thumbnail or write control appears for any role.

Own metadata1.49.0/schema121. Deploy web/database code together; rollback removes page/navigation/getter with no schema undo. Preserve user pnpm files. Never execute synthetic integration fixtures against user/production databases: tests require market_me_ci or market_me_qa_149_* and clean up only freshly created test organizations/users.

Focused data/model coverage51 cases and37 net-new web cases pass. The full3920-test/202-file local gate,44 quality cases,native/unsigned packaging and actual isolated desktop/mobile/production acceptance pass. Independent exact-source feature/main cloud gates reproduce the test/quality totals and121 migrations with both audits clean. Final Google readback verifies43 paragraphs and preserves30 tabs,prior bodies/styles/list definitions. Browser fixture market_me_qa_149_assets_v1 applies121 migrations once,with65 synthetic assets,all roles,null/zero/beyond-safe-integer sizes,Unicode filename,two microsecond groups,disabled intake and populated-viewer/empty-analyst scopes. Post-login baseline equals post-production state across141 domain tables and both projections,excluding session/OIDC bookkeeping and per-read observedAt. No reseed or mutation hides changes. [Releases](RELEASES.md) records exact evidence,not results inferred from prior releases.

Remaining: arbitrary asset roles,global cross-object/historical/semantic search,binary previews/downloads,bulk operations,full media understanding,real-provider acceptance,production hosting and whole-product completion remain separate work.
