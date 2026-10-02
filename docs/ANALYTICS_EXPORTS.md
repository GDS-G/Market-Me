# Analytics snapshot downloads: developer reference

Release: 1.46.0 candidate; acceptance is recorded separately in [Releases](RELEASES.md). [Scope plan](ANALYTICS_EXPORT_PLAN.md) implements the first CSV/JSON export slice of specification section 17. [Analytics contracts](WORKSPACE_ANALYTICS.md) remain authoritative for the unchanged SQL projection, current-membership authorization, exact numbers, clocks, attribution and provider corrections.

## Behavior and authority

The Analytics page exposes two ordinary `download` anchors, not prefetched Next Links. `/api/v1/analytics/export?workspaceId=UUID&format=json|csv[&campaignId=UUID]` obtains a fresh snapshot on each click. It is not the earlier rendered page's frozen contents. No provider collection, database mutation, report job, audit, spend, workflow command or client state is created. This is a session-authenticated internal download endpoint, not an externally authenticated public/BI API.

`GET` rejects supplied `Sec-Fetch-Site` other than `same-origin` or `none` before authentication. Missing metadata is allowed for compatible clients; it is never authority. The authenticated session supplies the actor, then `getActiveWorkspace(user.id)` resolves current selection. A required query workspace ID must match that selection and cannot choose another workspace. Optional Campaign ownership and membership are independently rechecked in the existing repository's single-statement SQL snapshot, including every current reader role. Returned workspace and Campaign identities must match exactly; revoked/foreign/missing results are unavailable, not empty successful files. No report or authorization is globally cached.

`analyticsExportQuery` accepts only one workspaceId, one lowercase format and at most one Campaign ID, rejecting unknown/repeated/empty/invalid values. `ANALYTICS_EXPORT_LIMITS` is frozen with `queryCharacters=512` (URLSearchParams' encoded serialization length) and `responseBytes=2_097_152` (actual UTF-8 bytes). Existing UUID normalization accepts canonical version1–8/variant8–b shapes and normalizes case. `analyticsExportPath` independently validates IDs/format and produces only an internal URL. Query size is checked after authentication/selection and before report SQL.

Every application-generated response uses private/no-store, nosniff, same-origin resource policy, no-referrer and `Vary: Cookie`. Success adds attachment disposition and UTF-8 JSON/CSV MIME type. There is no CORS grant or cookie mutation. Filenames contain only validated UUIDs and fixed tokens: `market-me-analytics-WORKSPACE-workspace.EXT` or `market-me-analytics-WORKSPACE-campaign-CAMPAIGN.EXT`; user labels never enter headers. Download directories may add local duplicate suffixes. The route only exports GET; Next handles unsupported methods/OPTIONS, and its automatic HEAD behavior is not a separate data-export permission.

Fixed errors: 401 `authentication_required`; 403 `cross_origin`; 400 `invalid_selection`; 404 `scope_unavailable`; 503 `export_unavailable` for auth/selection backend failure, persistence, schema/numeric incompatibility or response bounds. Errors are small JSON without attachment disposition. No raw error, SQL, label or credential is returned or logged. There is no streaming partial success; the file is fully validated/serialized/bounded before constructing a successful response. The database's existing 1MiB snapshot cap bounds the input; export serialization may add metadata, quoting and repeated scope IDs up to its separate 2MiB cap.

## JSON contract

`serializeAnalyticsExport` returns request-local `{body, filename, contentType}`. The body is a UTF-8 compact JSON object plus final LF:

- `format`: literal `market-me.analytics.snapshot`.
- `formatVersion`: numeric 1 for this export envelope; independent of the repository snapshot schema.
- `notes`: eight immutable interpretive/privacy/interchange notes from `ANALYTICS_EXPORT_NOTES`.
- `limits`: numeric `measurementGroups=200`, `recentRuns=20`; format limits, not event counts.
- `snapshot`: the explicit reporting DTO, `schemaVersion=1`, with full original labels, exact aggregate strings, nullable recorded fields, exact stored timestamps and bounded coverage flags.

The private `exportSnapshot` function allowlists every field at every nesting boundary. Never replace it with an object spread, JSON round-trip or direct repository serialization: future private fields must not silently become downloadable. Primitive `text`/`flag` guards reject object-valued text and non-boolean coverage. `count`/`decimal` call existing exact validators and return the original string, discarding only the formatter's presentation output. Thus there is no Number coercion, thousands separator, division, rounding or currency conversion. Unsupported snapshot schema, >200 detail groups, >20 recent runs and invalid UUID/aggregate primitives fail closed. SQL remains the authority for data relationships; this is not a second full domain validator.

Null differs from zero and empty text. A missing event amount remains JSON null; a zero remains its exact numeric string. Currency null differs from an empty collector label. Provider current totals retain correction-aware semantics; immutable snapshot history is never exported or summed. Counts remain aggregate observations, not personal identities or delivery/business proof.

## CSV version 1 contract

The file starts with a UTF-8 BOM, uses commas and CRLF record endings, and quotes every field. Internal quotes double; embedded newlines remain inside their quoted field. There is exactly one header and a rectangular long-form record collection. `ANALYTICS_CSV_COLUMNS` is the frozen ordered 26-column tuple:

`record_type, key, workspace_id, scope_campaign_id, snapshot_observed_at, text_value, status, provider, event_type, source, currency, currency_is_null, count, value_count, value_total, value_is_null, publication_count, first_occurred_at, last_occurred_at, first_observed_at, last_observed_at, run_id, campaign_id, campaign_version_id, campaign_name, created_at`.

Every row repeats authorized workspace ID, optional scope Campaign ID and read observation time. `scope_campaign_id` being empty means workspace-wide; it is not the Campaign ID of a recent-run row. The remaining fields are interpreted by kind:

| record_type | Meaning and populated fields |
| --- | --- |
| `metadata` | `key/text_value`: format/version/snapshot schema, scope/name, full event-group count, returned counts, limits, hasMore flags and empty-cell convention. Included even for no observations. |
| `note` | One-based note `key` and full interpretation/privacy text. |
| `total` | Four original totals keys and exact `count`: campaignRuns, publicationActions, measurementEvents, providerMetricRows. |
| `run_status` | Recorded status and exact count, not business success. |
| `publication_status` | Provider/status/count, not delivery guarantee. |
| `event_group` | Type/source/currency/null flag, event count, value count/total/null flag, first/last occurred timestamps. |
| `provider_metric` | Provider, metric type in `key`, exact current total in `count`, publication coverage, first/last current report observation timestamps. No occurred timestamp is inferred. |
| `recent_run` | Run/Campaign/version IDs, current Campaign name/status and creation time. No result values are invented. |

Unused cells are empty. `currency_is_null`/`value_is_null` explicitly distinguish a missing recorded field from a literal empty label, not-applicable cell or zero. Metadata booleans are lowercase strings, never blank. Complete counts and returned-detail counts are separate: this is the same bounded aggregate report as the page, not a silent full-history export. Ordering follows metadata/notes/totals/statuses/groups/provider metrics/recent runs; within data collections it retains repository ordering.

`CsvRow` is a partial typed dictionary keyed by the tuple's `CsvColumn` union. `rows` is an in-memory request-local array; `meta` appends one metadata row. `common` holds the three repeated scope/observation cells, and each `fields` dictionary combines it with one allowlisted row. The module-private readonly `numericColumns` set contains `count`, `value_count`, `value_total`, `publication_count`; these cells have already passed strict numeric validation. Counts originating from bounded array lengths are converted to text only for metadata; database aggregates never become Number.

## Spreadsheet safety and precision

CSV quoting alone does not prevent spreadsheet formula interpretation. OWASP identifies formula/control prefixes, full-width locale variants, and re-save hazards; no CSV sanitation strategy covers every downstream consumer. [OWASP CSV Injection guidance](https://github.com/OWASP/www-community/blob/master/pages/attacks/CSV_Injection.md).

`csvCell` marks nonnumeric text starting with whitespace, a Unicode control/format character, or `= + - @ ＝ ＋ － ＠` using the visible literal prefix `[text] `, then applies CSV quoting. This deliberately changes those labels in CSV. It does not depend on a leading spreadsheet quote/tab being retained, nor on removing a dangerous character. Validated signed decimals are exempt, so a legitimate `-0.000001` remains exact numeric text. Embedded delimiters/quotes/newlines cannot create extra cells. JSON preserves original labels for exact interchange; do not strip the visible CSV marker in spreadsheets or convert JSON labels into unprotected spreadsheet formulas.

CSV bytes preserve exact validated numbers, but spreadsheet auto-import can round large numbers, remove precision or reinterpret dates/labels. Import **all columns as text**, or use JSON for precision-sensitive processing. The export is not an XLSX workbook and makes no universal spreadsheet/re-save guarantee. User labels may contain personal information even though event keys/person IDs/arbitrary properties/raw payloads/credentials are excluded. Downloaded files leave application access controls; recipients and retention remain the user's responsibility.

## Integration, tests and rollout

Files: `apps/web/src/server/workspace-analytics-export.ts` owns format/query/serialization; `apps/web/src/app/api/v1/analytics/export/route.ts` owns transport/authentication; `apps/web/src/app/analytics/page.tsx` adds the native anchors and concise import/privacy warnings. Existing page CSS provides responsive wrapping, 44px links and 3px keyboard focus; no new component/client state/global cache is introduced. `privateHeaders` is immutable transport configuration, and `selection/data/file` are request-local values.

`workspace-analytics-export.test.ts` uses an independent quoted/multiline CSV parser and exact fixture values to test interchange, formula/text safety, source/currency/time separation, null/zero/empty, field allowlisting, bounded UTF-8, schema/numeric guards, empty reports and strict selection/path validation. `workspace-analytics-export-route.test.ts` verifies current-role reads, authenticated actor scope, stale/revoked/foreign selection, repeated reads, private fixed failures, metadata, safe filenames and headers. Existing Analytics page tests verify both download scopes and disclosures. Underlying 1.45 SQL authorization/read-only/correction tests remain unchanged and run in the full regression gate.

No migration, dependency, provider permission or environment key is added; schema remains 121. Restart application runtimes to serve the route/UI. Rollback to the prior application binary removes downloads without data conversion. Already downloaded files are not revoked by rollback or membership removal. Native companion changes are version metadata only. Full-history pagination, scheduled delivery, external API authentication/BI connectors, raw-event exports, date-window analytics and experiments are not implemented by this increment.
