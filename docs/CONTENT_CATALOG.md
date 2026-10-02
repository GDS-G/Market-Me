# Content Package catalog

## Scope and user contract

Release 1.47 replaces the unbounded Content Packages listing with a current-workspace, read-only catalog. A native GET form searches package titles and attached filenames, optionally filters the recorded package status, and shows at most 30 packages. Counts describe the complete eligible catalog and complete matching set, not merely the rendered page. The existing detail/review route, mutation permissions, ingestion, generation and worker loaders are unchanged.

Matching uses PostgreSQL `strpos(lower(value), lower(query))`: literal case-insensitive substrings under the database's existing collation. Percent, underscore, quotes and backslashes are ordinary characters, not SQL/search syntax. Only outer whitespace is trimmed. This is not fuzzy, accent-insensitive, semantic, full-text, document-body, evidence-claim, draft or cross-workspace search. A matching filename may be outside the three-name preview. The preview/counts concern file records, not verified readable files; evidence counts are raw scoped records, not a count of approved or usable claims. Stored status/confidence do not grant approval or launch authority.

GET search terms are visible in the URL and may remain in browser history, copied links and infrastructure access logs. Do not put credentials or sensitive document contents in the search field; configure deployment log retention/redaction appropriately. A copied scoped link still requires current authenticated membership and does not switch the recipient's active workspace.

## Source map and lifecycle

- `packages/database/src/content-catalog-models.ts`: limits, DTOs, UUID/query validation and filter-bound cursor encoding.
- `packages/database/src/content-catalog-repository.ts`: `ContentCatalogRepository.getPage(workspaceId, actorUserId, input = {})`, one authorized SQL observation, bounded decoding and next-cursor construction. Missing current membership returns `undefined`; malformed input, database and size errors throw. It never writes or logs sensitive query contents.
- `apps/web/src/server/content-catalog-view.ts`: browser-query normalization, scoped URL construction, exact count formatting and recorded-status labels.
- `apps/web/src/app/content-packages/page.tsx` and `catalog.module.css`: authenticated server-rendered GET search, bounded cards, coverage/time disclosures, reset/newest/next navigation and responsive focus/layout rules. No new API endpoint, client state store or mutation is added.
- `apps/web/src/server/database.ts`: `contentCatalogRepository` is the 24th getter in the existing shared database bundle. It holds only the shared SQL client; no user, membership, selection, cursor or results are cached globally. Lifecycle unit/integration checks cover reuse.

All selections, SQL snapshots and arrays are request-local. Frozen limits and the status-label dictionary are module-lifetime constants. `MarketMeRepository.listContentPackages` remains available unchanged for existing detail-oriented consumers; do not replace those consumers with this minimized projection.

## Types, fields and important variables

| Contract | Fields and intent |
| --- | --- |
| `CONTENT_CATALOG_LIMITS` | Frozen `pageSize=30`, `fileNames=3`, `queryLength=120` UTF-16 units before trimming, `cursorLength=512` base64url characters, `responseBytes=1_048_576` UTF-8 bytes. No caller override. |
| `ContentCatalogFilters` | `query`: trimmed literal string; `status`: one existing `ContentPackageStatus` or `null` for all. |
| `ContentCatalogCursor` | `at`: exact UTC timestamp with six fractional digits; `id`: canonical lowercase package UUID. Both define an exclusive keyset boundary. |
| `ContentCatalogItem` | `id`, original `title`, stored `status`, nullable numeric `confidence`, exact `updatedAt`, string `assetCount`, string `evidenceCount`, readonly `fileNames` array of at most three names. |
| `ContentCatalogSnapshot` | `schemaVersion=1`, authorized `workspaceId`, `observedAt`, normalized `filters`, exact string `totalPackages`/`totalMatches`, readonly `items` array, nullable `nextCursor`. `observedAt` is statement time, not source update time. |
| `ContentCatalogSelection` | Web/request shape: required `query`, optional stored `status`, optional encoded `cursor`. Omit status for all. This differs from the normalized DTO's nullable status. |
| `CONTENT_CATALOG_STATUS_LABELS` | Frozen exhaustive typed dictionary: detecting→Detected; stabilizing→Waiting for stable files; analyzing→Analyzing; needs_review→Needs review; ready→Ready for review; approved→Approved record; executing→In progress; completed→Marked completed; failed→Could not complete. Labels deliberately describe records, not current authority. |

`contentCatalogUuid(value)` accepts only canonical hyphenated UUID versions 1–8 and RFC variant 8–b, returning lowercase; it does not trim or accept arrays/nil IDs. `cursorTime(value)` requires a valid calendar date, year 1000–9999, UTC Z and exactly six fractional digits. Its temporary `Date` checks date validity only; it returns the untouched input string. Do not use that Date for ordering or SQL parameters.

`normalizeContentCatalogQuery(workspaceId, input)` accepts only object keys `query`, `status`, `cursor`. Missing query becomes empty. A supplied query must be a string within the limit and contain no Unicode Cc/Cf characters; this includes line breaks and invisible formatting controls. Missing/empty/all/null status normalizes to null; other values must be in the existing `PACKAGE_STATUSES` tuple. Missing cursor starts at newest; a supplied empty, oversized, noncanonical or corrupt cursor is invalid. Arrays, unknown keys and invalid UUIDs fail before SQL.

`context(workspaceId, filters)` is SHA-256 over the JSON tuple `[1, lowercaseWorkspaceId, normalizedQuery, normalizedStatus]`. `encodeContentCatalogCursor` base64url-encodes UTF-8 JSON with exactly `v=1`, `at`, `id`, `context`. Decoding checks the canonical base64url round trip, exact key set, version, current context and timestamp/UUID. The digest is an accidental-mismatch fence, not a MAC/signature or secret: callers can construct a cursor. A cursor is never permission, ownership proof or a frozen snapshot lease. Changing query case still changes cursor context even when its search results happen to be equal.

`contentCatalogSelection(searchParams, workspaceId)` permits only `workspaceId`, `q`, `status`, `cursor`; array-valued duplicate parameters are rejected by underlying guards. An optional workspace hint must match the independently selected active workspace. It returns normalized query/status and the validated encoded cursor. `contentCatalogPath` validates again and uses `URLSearchParams` to encode only those fields, always including workspaceId. `catalogCount` validates canonical nonnegative decimal strings of at most 128 digits and inserts commas without Number conversion. `hiddenCatalogFiles(count, shown)` validates the preview length and subtracts through BigInt, returning an exact string.

Repository locals `workspace`/`actor` are validated identities; `filters` is normalized once; `at`/`id` are null or the decoded exclusive boundary. `row.snapshot` is PostgreSQL JSONB serialized to text. Internal `hasMore` is removed before returning `data`; `last` generates the next cursor only when an extra row exists. No cursor is emitted on the last page. Both the raw UTF-8 snapshot before JSON.parse and final JSON with cursor are capped; oversized output throws without silently truncating labels or counts. This bound controls returned data, not total database scan cost or peak PostgreSQL JSON construction memory.

Page locals `user`, `workspace`, `selection`, `data`, `firstPage` and per-card `hiddenFiles` remain request-local. The page checks returned workspace and normalized filters against the active selection. Invalid query/scope is notFound; no session or active workspace redirects to login. Infrastructure/oversize exceptions follow the existing application error boundary. `data.items.length` is a bounded page count only; database totals remain strings. Null/undefined confidence is Unavailable, zero is 0%, other values are rounded for display without implying evidence quality. Original text is React-escaped. The raw full timestamp remains in the time element's datetime attribute; visible UTC time uses the shared millisecond formatter.

## One-statement SQL and authorization

| CTE | Responsibility |
| --- | --- |
| `scope` | Join current workspace membership for the authenticated actor and requested workspace. All six current reader roles may search; organization membership alone is insufficient. |
| `packages` | Join Content Packages to scope, same-workspace Smart Source and same-workspace root Source Item belonging to that source. Exclude inconsistent lineage without changing it. |
| `assets` | Include attached assets only for eligible packages. Assets with null source-item identity are supported; non-null Source Items must belong to this workspace. Exclude cross-workspace filenames and their counts. |
| `matched` | Apply optional stored status and literal title/eligible-filename search. Never inspect extracted text, metadata or evidence claims. |
| `page` | Order `updated_at DESC, id DESC`, apply exclusive `(updated_at,id) < (at,id)` when present and take 31. |
| `visible` | Take the first 30 in the same order. The extra page row determines hasMore, not a guessed remaining total. |

Final JSON obtains complete `count(*)::text` from packages/matched, exact per-package asset/evidence counts, at most three filenames ordered by filename then asset ID, and ordered visible items. No full asset/evidence hydration, source paths, extracted content, provider payloads, storage addresses, credentials or claims leave this projection. `observedAt`, membership, totals and items belong to the same SQL statement snapshot. Revocation affects the next observation; it cannot retract a response already rendered. Every next-page request reauthenticates/rechecks membership.

Existing schema 121 is unchanged. The workspace/updated-time index from migration 0006 and existing package/asset/evidence identities are reused; there is no new search index or migration. Literal substring matching and complete totals may scan eligible workspace records. Response pagination is not a performance guarantee; benchmark representative data before adding indexes or changing query plans.

## Exact paging and reproduced precision regression

PostgreSQL preserves microseconds, JavaScript Date does not. With unchanged data, the timestamp/UUID pair gives deterministic non-overlapping pages, including ties. The SQL timestamp output uses explicit UTC `to_char(...US...)`. Crucially the cursor parameter is bound as text before `::timestamptz`: `${at}::text::timestamptz`. Binding directly as timestamptz lets postgres.js serialize through Date and loses fractional digits. The initial precision fixture had the same problem and was corrected first; both genuine regression cases then failed against the old query. The targeted fix passes both 65 tied records (30/30/5) and a one-microsecond difference crossing a page boundary. Do not globally alter driver serialization to solve this local boundary.

Pages are separate observations, not a shared transaction. Concurrent edits can move a row before/after a saved boundary, causing repeats or omissions across observations. UI discloses this and offers Refresh from newest. Status/query form submission omits cursor, clearing old pagination. Clear removes all filters; newest keeps query/status; next keeps query/status and adds its validated cursor. Detail and pagination/reset links disable Next prefetch; refresh is a normal anchor. Search never synchronizes a source or approves, prepares, launches or publishes a package.

## Testing, build and rollout

Model/repository tests add 54 cases; web additions expand the gate by 44 cases. They cover all roles and revocation, scoped lineage, empty versus no match, all statuses, Unicode/literal wildcard/quote input, filename matches beyond the preview, exact counts, deterministic microsecond paging, invalid context/shape/duplicates, minimized fields, UTF-8 limits, read-only SQL, escaped content and scoped no-prefetch links. Shared-pool lifecycle assertions include the new getter. Focused DB tests require isolated market_me_ci or market_me_qa_147_*; never run them against user/production data because fixtures are created and cleaned up.

Browser fixture market_me_qa_147_catalog_v1 is a separate loopback database initialized once through the ignored QA helper. It contains 65 synthetic packages, all recorded statuses, two adjacent microsecond timestamp groups, a newest café/percent/underscore package with five filenames and zero confidence, a null-confidence record, an empty workspace, a viewer/analyst user and a disabled draft-only source. Only synthetic reads/search/navigation are authorized during acceptance. Capture all 141 domain-table fingerprints and both catalog projections after development login; app_session/OIDC bookkeeping is excluded, and per-read observedAt is excluded from projection comparison. Never reinitialize or mutate fixtures to conceal a failed comparison.

Own metadata is 1.47.0; no new dependencies or environment keys. Preserve user-owned pnpm files. Full local/cloud/native/browser evidence is recorded separately in [Releases](RELEASES.md) and [CI](CI.md); pending evidence must not be described as passed. Deploy matching web/database package code together. Rollback has no schema undo, but restoring the old page also restores its unbounded listing behavior. This is not completion of draft/asset/variant search, global content discovery, production hosting or real-provider acceptance.
