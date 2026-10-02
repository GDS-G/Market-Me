# Workspace Analytics: reporting contracts and developer reference

Release: 1.45.0 candidate. [Release evidence](RELEASES.md) records acceptance separately. [Scope plan](WORKSPACE_ANALYTICS_PLAN.md) derives this first reporting slice from specification sections 01 and 17; it does not complete the entire Analytics specification.

## Product behavior

`/analytics` is a server-rendered, current-member-only view available from shared desktop/mobile navigation and each Campaign definition. All six current workspace roles may inspect it. It separates Campaign run/publication activity, recorded event observations and current provider lifetime aggregates. All-time means all retained records in the selected scope, not complete real-world coverage or a guaranteed retention period.

Optional Campaign filtering accepts explicit event Campaign attribution or a same-workspace run's Campaign when the event has no direct Campaign ID. If both links exist, they must agree. Unattributed and contradictory links remain visible only in the workspace-wide aggregate. Destination, publication, step, timing and person relationships are not used to invent attribution. A Campaign with no observations is a valid empty result, distinct from an inaccessible/nonexistent Campaign.

Refresh reloads saved data. It does not collect reports, synchronize providers, emit a workflow signal, create an audit, publish, reserve spending or change measurements. Only the existing workspace switch changes a selection cookie; it discards previous scope filters. No Analytics API, client store, polling, transport retry, export or new browser state is added.

## Files and ownership

- `packages/database/src/workspace-analytics-models.ts`: DTOs, immutable output bounds and UUID normalization.
- `packages/database/src/workspace-analytics-repository.ts`: one coherent authorized SQL projection, with no dependency on workflow success evaluation.
- `apps/web/src/server/workspace-analytics-view.ts`: exact decimal/count rendering, query/path helpers and display dictionaries/categories.
- `apps/web/src/app/analytics/page.tsx` and `analytics.module.css`: authenticated presentation, empty/coverage states, native time disclosures, links and responsive styling.
- `apps/web/src/server/database.ts`: `workspaceAnalytics` joins the existing lazy server-only shared repository bundle; `getWorkspaceAnalyticsRepository()` returns it. The bundle now has 23 getters and still one pool per server runtime. No actor, membership, query or snapshot is cached globally.
- `workspace-navigation.tsx` includes the Analytics/BarChart3 tuple; shared navigation now has 18 destinations. `workspace-selection.ts` admits only the exact `/analytics` root as a safe switch return path. Campaign listing adds a no-prefetch scoped Analytics link without removing original preparation receipts.

## Repository and coherent query

`WorkspaceAnalyticsRepository.getSnapshot(workspaceId, actorUserId, campaignId?)` validates all supplied IDs before SQL. It returns `WorkspaceAnalyticsSnapshot | undefined`; undefined covers absent current membership, unknown workspace and a missing/foreign Campaign. Persistence/size errors propagate, never become a successful empty report. Actor authority is the caller's authenticated user, not a query parameter.

One SELECT uses PostgreSQL's single-statement MVCC snapshot for membership, scope and every aggregate. The authorization decision is point-in-time: a revocation committed before this statement is visible; concurrent/later revocation does not retroactively erase an already authorized observation. This report has no lock/lease or subsequent mutation to authorize. It does not cache authorization between calls. `statement_timestamp()` is the read's observation time, not report freshness.

Request-local CTE collections:

| CTE | Role and invariant |
| --- | --- |
| `scope` | Current workspace membership plus optional same-workspace Campaign; no row means no report. |
| `runs` | Workspace/selected-Campaign instances joined to their workspace-owned Campaign labels. Exact instance Campaign version ID remains available for lineage. |
| `publications` | Actions belonging to those instances, with a same-workspace channel connection; provider/status are activity labels, not delivery proof. |
| `events` | Workspace measurement rows, with the optional explicit/run-derived consistency filter described above. |
| `event_groups` | Group by event type, collector source and nullable currency; exact event/value counts, numeric sum, first/last event timestamps. |
| `metrics` | Current `campaign_provider_metric_total` rows joined to scoped run/action/connection and an exact same-workspace/action report snapshot. Email/Mastodon source must match the connection provider. Inconsistent lineage is excluded, not repaired. |

Provider totals come from the correction-aware current-total table, not SUM of immutable report snapshots. A corrected 12-to-4 observation displays 4; an older snapshot does not add 12 back. Multiple publications' current totals are summed by provider and metric kind. `publicationCount` is DISTINCT publications with that metric, not all publications, delivered recipients or unique people. Email uniqueness is provider-defined per email campaign/publication; summing it does not establish workspace-wide uniqueness. A recorded provider zero remains zero; no current metric row means unobserved.

Run statuses and publication provider/status counts cover the entire authorized scope. Detailed event groups select the first 200 in event/source/currency order (null currency first), then the UI presents those groups in semantic sections. Recent runs select newest creation time first, with ID as the deterministic tie-break, at most 20. `groupCount` and headline totals are complete counts, not counts of the bounded lists. Explicit `hasMore` labels prevent partial details being mistaken for complete history. There is no pagination or arbitrary date window in this slice.

## Exact values and units

All PostgreSQL count/bigint/numeric aggregates are explicitly cast to text before JSON construction. The complete JSONB projection is returned as SQL text and parsed only after checking its UTF-8 size. No JavaScript Number conversion can round monetary values or very large aggregate counts. A sum can exceed an individual numeric(20,6) row's range; decimal strings preserve it.

`valueCount = count(value)` counts only events with a supplied numeric value. `sum(value)` stays null when none were supplied, and displays **No value recorded**. An actual zero displays its recorded precision, for example `0.000000`. Signed values, including negative adjustments, remain signed. Currency groups never combine or convert; null currency is explicitly unlabeled. Units are those of the original event collector, not inferred physical units, verified revenue, spend, profit or the separate AI-budget hundredths ledger. No division by 100 occurs here.

`analyticsDecimal(value)` accepts signed canonical decimal text, at most 128 characters and six fractional digits, adds thousands separators to the integer part and preserves every fractional digit. It rejects leading zeros, exponent notation, whitespace, NaN/Infinity, malformed values and excess precision rather than rounding. `analyticsCount(value)` first requires a nonnegative integer string, then delegates formatting. Both throw on incompatible data instead of manufacturing a number.

## DTO inventory

All DTOs are per-request observations; readonly arrays are contracts, not persisted collections. `schemaVersion` is literal 1.

| Field/type | Intent |
| --- | --- |
| `workspaceId`, `observedAt` | Authorized scope and SQL statement timestamp. |
| `campaign: {id,name} \| null` | Exact selected Campaign or workspace-wide scope; name is its current label. |
| `totals` | Exact string counts: `campaignRuns`, `publicationActions`, `measurementEvents`, `providerMetricRows`. The last is an internal/report coverage count, not a business metric. |
| `AnalyticsStatusCount` / `runStatuses` | `{status,count}` grouped operational records. |
| `publicationStatuses` | Status counts plus provider; no raw action/request payload. |
| `AnalyticsMeasurementGroup` | `eventType`, collector `source`, nullable `currency`, exact `eventCount`, `valueCount`, nullable `valueTotal`, `firstOccurredAt`, `lastOccurredAt`. |
| `measurements` | Complete `groupCount`, `hasMore`, and bounded `items` array. |
| `AnalyticsProviderMetric` / `providerMetrics` | `provider` (Mailchimp/Mastodon discriminant), `metricType`, exact `metricTotal`, exact `publicationCount`, earliest/latest current report observation times. Separate event and provider clocks must not be compared as equivalent periods. |
| `AnalyticsRun` | `id`, `campaignId`, `campaignVersionId`, current `campaignName`, `status`, `createdAt`. |
| `recentRuns` | `hasMore` plus bounded `items`; links target actual stored run identities. |

`WORKSPACE_ANALYTICS_LIMITS` is a frozen module constant: `measurementGroups=200`, `recentRuns=20`, `responseBytes=1_048_576`. Response checking uses `Buffer.byteLength(...,"utf8")`; oversize fails with a fixed narrower-scope explanation, without silently truncating labels/values. `workspaceAnalyticsUuid(unknown)` accepts canonical UUID-shaped version1–8/variant8–b strings, normalizes case and rejects padding, arrays, nil UUID and arbitrary IDs. Limits are not environment configuration or mutable globals.

## Page helpers, collections and lifetimes

`workspaceAnalyticsQuery(query,workspaceId)` permits only optional `campaignId` and `workspaceId`. Repeated query values become arrays and fail validation. The workspace hint must match the currently selected membership; it cannot select or authorize a workspace. `workspaceAnalyticsPath` validates IDs and builds an internal URL retaining the workspace hint and optional Campaign. The page resolves authentication/selection before parsing filters, rejects invalid filters with not-found, then verifies the returned workspace and exact Campaign discriminant before rendering.

`ANALYTICS_EVENT_SECTIONS` is an immutable tuple of outcome/engagement/feedback/custom display sections. Request-local `items` arrays are filtered from the bounded projection; they are not new measurements. Module-private readonly `outcomes` and `engagement` sets categorize known event types. Unknown/custom labels remain unclassified; unsubscribe/complaint are separate feedback. Categorization does not evaluate success criteria.

The frozen `labels` dictionary gives provider metric/status names; `Object.hasOwn` prevents prototype keys from becoming labels. Unknown labels replace underscores only and render as escaped React text. Status names say **Marked completed**, **Recorded success** or **Outcome uncertain**, avoiding a business/delivery guarantee. Event `source`, Campaign names and currencies are collector/user labels: escaping prevents markup execution but does not verify their content or promise they cannot contain user-entered personal information.

`ObservedTime` renders the complete ISO value in `dateTime`, with the existing explicit UTC millisecond formatter for visible text. PostgreSQL microseconds remain in the DTO/attribute but are not promised in the human-readable millisecond label. Native details have no custom React state; refresh obtains a new snapshot. All report links use `prefetch={false}`; Refresh is an ordinary full reload anchor. CSS scopes wrapping, numeric typography, stacked mobile cards and 3-pixel keyboard focus to this page.

The report omits event keys, person IDs, arbitrary properties, tracking payloads, report identity strings, credentials and provider request/response bodies. It displays only the selected aggregate fields and necessary Campaign/run labels/IDs. Source-label content itself is not redacted. Existing authenticated server rendering remains authoritative; no client filtering substitutes for SQL membership.

## Verification and rollout

Database tests use only isolated `market_me_ci` or `market_me_qa_145_*`, with synthetic SQL fixture records. They prove all six roles, revocation, foreign references, exact signed/large mixed-currency sums, missing versus zero values, strict source/provider separation, inconsistent attribution/lineage exclusion, correction replacement, immutable snapshot non-double-counting, bounded coverage and successful execution inside a PostgreSQL read-only transaction. Pure tests exercise invalid IDs, pre-query rejection, UTF-8 response bounds and error propagation.

Web tests cover strict query/path contracts, exact formatting, category/label maps, authentication, current returned scope, empty/error behavior, reader-only controls, Campaign links, escaping, provenance, no inferred rates, pagination-limit labels, native disclosures, no-prefetch navigation, 18 shared menu entries, safe switch return paths and 23 repository getters sharing one pool.

The ignored `.market-me/qa-workspace-analytics-145.ts` initializes the loopback-only `market_me_qa_145_analytics_v1` database once and thereafter offers read-only `--status`. Synthetic measured/empty workspaces give the QA user viewer/analyst roles. Synthetic provider connections are revoked and contain no real credentials; stored reports are seeded directly, with zero provider network calls or workflow commands. Take the fingerprint baseline after development login because bootstrap updates the user timestamp. The initial launch accidentally used unprefixed DEV_USER settings, creating a default development fixture before the baseline; it was signed out, correct `MARKET_ME_DEV_USER_EMAIL`/`MARKET_ME_DEV_USER_NAME` settings were applied, and the extra synthetic fixture was retained without reseeding or hiding it. The measured baseline includes it.

Browser inspection after the corrected login preserves all 141 table fingerprints and both intended workspace projections exactly, excluding only per-read `observedAt` in the projection comparison and session/OIDC bookkeeping from the table set. Schema remains 121. No migration, new environment setting, third-party dependency or provider permission is required. Existing user pnpm files remain untouched/excluded. Restart application runtimes for the new repository bundle; existing measurements are not rewritten. Rollback is the prior application binary, not a data conversion.

Remaining scope includes time windows/trends, full-history browsing, explicit exports, controlled experiments, attribution/commerce integration, recommendations and cost accounting. Those require separate definitions and acceptance; this view deliberately does not invent them.
