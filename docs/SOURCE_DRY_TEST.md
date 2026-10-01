# Smart Source metadata dry test

Implementation in progress for the next release after 1.28. This contract describes the working source on `codex/source-dry-test`; final release gates/publication are not yet recorded here. The complete Test & Simulation specification is **not** complete: individual-item/date-range scopes, recursive full inventories, content interpretation and supported future cost estimates remain separate work.

## User behavior and safety boundary

The saved-source edit page offers **Run dry test**, separately from saving configuration and the older persisted connection/configuration diagnostic. The panel tests the displayed saved version and selected saved location. Unsaved form edits are not used. It works with synchronization paused and does not change that state. Each run clears its preceding result; reload or a changed component scope discards the result.

Cloud mode reads one direct-child page from the exact saved provider/folder, at most 200 returned entries. It never follows a continuation, descends into folders, downloads content, extracts text, calls AI or sends content. An existing cloud credential may be refreshed using the established active-snapshot compare-and-swap path. The provider's next-page token, excess entries or incomplete-search flag makes coverage partial. A complete direct-child page does **not** mean the entire recursive source has been inspected.

Local mode reads at most 200 active historical `source_item` rows. It does not read a PC path, dispatch companion work, populate the index or prove current folder contents. The index may be stale, may omit previously excluded/new files and may contain records from older location/recursion settings. Coverage is always partial in this sense, even with zero rows. Multiple saved local locations are unsupported because the current index cannot establish which location supplied each item. No source must be enabled merely to obtain a preview.

There are no sample-result tables, receipts, migrations, audit writes, sync runs, ingestion events, packages, approvals, preparation commands, Campaigns, drafts, finalizations or external actions created by this feature. Temporary read locks and optional refresh of an existing provider credential are explicitly distinct from domain-content writes. Results confer no authority for later approval or activation.

## Request and response

`POST /api/v1/smart-sources/[id]/sample` accepts only a valid UUID route ID, no query parameters, configured same-origin `Origin`, and `application/json`. It uses the existing streaming 32,768-byte JSON reader (named `readSourceSetupJson` for historical reasons). Invalid UTF-8/JSON, unknown keys and mismatched request authority are rejected. Body fields are:

| Field | Meaning / validation |
| --- | --- |
| `workspaceId` | Explicit workspace UUID. Current authenticated writer membership is required. |
| `expectedSourceVersion` | Saved configuration version displayed in the page; integer 1–2,147,483,647. |
| `locationIndex` | Zero-based saved location index, integer 0–19. It is not a provider ID, URL, cursor or filesystem path. |

The authenticated actor comes only from the session. Location ordering is `created_at, id` in both core source hydration and the locked capture. That tie-breaker makes the page's index deterministic. The source version and final fingerprint protect against mixing settings across edits.

Every success/failure is `Cache-Control: no-store`. Success is `{ data: SourceSampleView }`; failure is `{ error: { code, message } }`. No tokens, encrypted credentials, raw provider metadata/URLs/cursors, internal fingerprints, command/approval identities, file provider IDs, source keys or context values/instructions are returned. The browser receives only the following bounded view:

| Field | Intent |
| --- | --- |
| `workspaceId`, `smartSourceId`, `locationIndex` | Response scope, checked against the initiating page. Not an action capability. |
| `source` | Name, saved version, synchronization enabled state and recursion setting at capture. |
| `location` | Saved display label, at most 2,048 characters. |
| `coverage` | `kind` is `cloud_folder_page` or `historical_local_index`; `partial` describes uncertainty; `truncated` specifically identifies an entry/page cutoff. |
| `context.packs` | Names and published version numbers that would be consulted, without instruction text. |
| `context.facts` | Structured fact keys, resolution status and safe resolver explanation; no values or candidate IDs. |
| `context.unresolvedRecordedFacts` | Count of recorded fact rows marked unresolved or lacking a usable source identity. This is separate from the resolver's set of fact keys. |
| `preparation` | `null`, or saved binding `enabled` and `revision`. References/writer may still fail later; this does not promise execution. |
| `simulation` | Evaluated UTC instant, coverage, ordered item explanations, aggregate counts, literal zero `aiRequests`, and null `futureProcessingCost` (not estimated). |

`SOURCE_SAMPLE_RESPONSE_LIMIT` is 2,097,152 UTF-8 bytes. The server validates the strict view and checks serialized size. The browser applies a streaming size limit before parsing JSON, validates the strict view again, checks counts/relationships, and rejects another workspace/source/version/location. This is memory-only UI state: no browser storage, durable preview object or receipt is created.

## Pure domain model

`source-intake-filter.ts` supplies the single `classifySourceIntake` used by remote ingestion and metadata simulation. `SourceIntakeFilter` contains `allowedMimeTypes` and `ignorePatterns`; `SourceIntakeEntry` contains `name`, `mimeType`, `isFolder`. `displayPath` is passed explicitly. `SourceIntakeDecision` returns `eligible`, `kind` (`folder`/`file`) and ordered `exclusions` (`mime_type`/`ignored_path`). The first failing gate is reported. Folders remain traversable independent of file filters, but never imply a package. Empty MIME selections mean all; exact MIME values and `type/*` retain the historical case-sensitive rules.

Paths and patterns normalize backslashes to `/`. Ignore matching tests displayed path, filename, and a leading-slash path, case-insensitively. Ordinary `*` stays within a directory; `**` spans directories but preserves historical regex-dot line-terminator behavior. A non-backtracking dynamic-programming matcher replaces exponential ordinary wildcard backtracking without changing those match results. Tokens are literal single-character case-insensitive regexes or `star`/`globstar`; `previous` and `next` are per-match `Uint8Array` rows. No global cache is retained. Tests compare it with the prior matcher across thousands of punctuation, separator, case, Unicode and line-terminator combinations. Historical `?` and NUL expressions retain the original ingestion matcher behavior; dry testing rejects them rather than silently interpreting different rules.

`SOURCE_SAMPLE_LIMIT = 200`. `SourceSampleConfiguration` is the subset of source filters, recursion, readiness mode, settling time, related-file minimum, marker and AI threshold. `SourceSampleItem` contains `key`, optional `parentKey`, name/path/MIME/folder flag and optional `modifiedAt`/`lastSeenAt`. Keys are capture-local relationship identities, not browser capabilities; duplicate/empty keys are rejected. Keys/parents are bounded to 500 characters, names 512, paths 4,096 and MIME types 200. Dry-test filter work is bounded by `sum(pattern lengths) * sum(2 * path length + filename length + 1) <= 10,000,000` before matching.

`simulateSourceSample(source, sample, { now, partial })` is deterministic and performs no I/O, random ID generation, extraction, persistence or AI. It requires a valid supplied clock. `filters` parallels input order. `groups: Map<string, number[]>` associates observed parent identities with eligible file indexes. Unknown parents remain separate single-root groups; folders and ignored files are excluded. Cloud direct-child results use one internal `selected-folder` group because that exact folder-list operation establishes membership. Local entries retain observed historical parent identities. The root itself counts toward related-file readiness, matching existing intake convention. Unstable supporting items can still appear in the group because existing readiness counts siblings, not only independently stable siblings; this is not asset merging or content validation.

Each `SourceSampleExplanation` contains the visible zero-based `index`, file labels, `filter`, `outcome`, `reason`, optional `stableForSeconds`, `relatedItemIndexes` and `missingRequirements`. No provider/key identity is returned. Outcomes:

| Outcome | Meaning |
| --- | --- |
| `folder` | Folder metadata only; never a proposed package root. |
| `ignored` | MIME or path gate excludes this file under current saved filters. |
| `ready_for_analysis` | Metadata readiness satisfied; a candidate for later content analysis, **not** an approved or ready Content Package. |
| `waiting` | The sample establishes a remaining readiness condition, such as settling. |
| `unknown` | Timestamp/parent/support evidence cannot establish readiness; partial absence is not definitive absence. |
| `review_required` | AI-recommended mode has no recommendation from this non-AI test; existing intake prepares review-needed content in that mode. |

Timestamp precedence is `modifiedAt ?? lastSeenAt`. A present invalid timestamp does not fall back. Missing/invalid/future timestamps are uncertain, including future times when settling is zero. Otherwise elapsed whole seconds feed the existing `evaluateReadiness`. Exact marker filename and related-count semantics are retained. If missing support/marker evidence comes from a partial sample or unknown parent, the result is `unknown`; positive observed evidence can still satisfy metadata readiness. Counts derive from item outcomes and must add up. One eligible root means one potential package; sibling readiness does not combine roots into a package.

## Coherent authorized capture

`SourceSampleRepository.capture(SourceSampleRequest, actorUserId)` uses a short PostgreSQL repeatable-read transaction. `SourceSampleRequest` adds server-resolved `smartSourceId` to the request fields. It holds organization/user key-share and workspace/current-writer membership share locks, then locks the scoped source and selected locations. It verifies expected version, bounded configuration, active same-workspace/same-provider connection or usable nonrevoked desktop pairing, and current published Context Pack roots/versions. No network happens in the transaction.

`CapturedSource` intentionally excludes source creation/audit fields and scan timestamps. `SourceSampleCapture` carries that source, the selected internal location, public context summary, preparation flag/revision, bounded local entries/truncation, and an internal SHA-256 fingerprint. `fingerprint` covers source, all saved locations, selected context roots, ordered versions/rules/instruction hashes, facts and saved preparation flag/revision. It is ephemeral, never a browser capability, never persisted. Credential envelopes are not captured, so an ordinary credential refresh does not invalidate the configuration fingerprint. Active status and provider/workspace pairing are revalidated separately.

Selected packs follow the same `updated_at DESC, name` ordering as `listContextPacks`, not version-number order. This matters because the shared `resolveContextFacts` uses the first authored authority rule for a fact. Candidates include facts with a source identity and status other than unresolved; candidate keys plus authority-rule keys feed that existing resolver. Recorded unresolved/source-less facts are counted separately. No unpublished context, raw instruction text or private fact values are returned. PostgreSQL's built-in `sha256(convert_to(instructions,'UTF8'))` detects instruction changes without returning their text; the hexadecimal hash remains internal. SHA-256 also covers the full selected fingerprint representation.

`CONTEXT_FACT_LIMIT = 1,000`; `CONTEXT_BYTES_LIMIT = 262,144`. A database-side aggregate checks rule/fact-value bytes before returning those values to the application, followed by a serialized capture-size check. Oversized context fails without pretending a truncated interpretation is complete. Local metadata uses `LIMIT 201` then returns 200; it selects no object keys, URLs or broad raw metadata. The fingerprint excludes historical item rows: the result remains the explicitly timestamped observation from its initial capture, not a guarantee the index has not advanced afterward.

`assertUnchanged` performs another fresh authorized capture and compares fingerprints. `runSourceSample` captures first; on cloud sources it obtains the existing credential, checks again after any refresh I/O, reads one page, builds the pure result, and checks again before returning it. Connection provider/workspace/ID must match exactly. Membership loss, source-version change, unavailable references and changed fingerprints fail closed. PostgreSQL serialization conflicts become a refresh/review conflict rather than an incomplete mixed snapshot.

`SourceSampleError` carries a finite safe code/message. `SOURCE_SAMPLE_ERROR_BRAND = Symbol.for('@market-me/database/SourceSampleError/v1')` identifies these server-authored errors across module copies retained by development hot reload. It is a registry identity, not mutable global application state. `isSourceSampleError` requires the symbol on an actual Error; a provider error merely copying the name/code is not trusted. The API never logs/reflects unknown provider/SQL messages. `databaseGlobal.marketMeDatabase.sourceSamples` adds one repository instance to the existing development-only repository cache; production follows existing factory behavior.

## UI lifecycle and errors

`SourceSamplePanelProps` contains only workspace/source/version/provider, saved location labels and current write capability. An inner stateful component is keyed by that entire scope. State is `locationIndex`, optional validated `result`, `pending`, and safe `error`. `inFlight: Ref<AbortController | null>` is a synchronous duplicate-action guard, with abort-on-unmount cleanup. Changing a location clears the result; changing scope remounts and aborts the old request. A request clears old result/error, catches network/parse/validation errors and releases pending state in `finally`. Nothing automatically retries or saves source configuration.

`outcomeLabels` is the exhaustive UI dictionary for the six outcome values. Item order is stable sample order, displayed as one-based indexes; related indexes are converted to the same visible numbering. Context rows show only key/status explanations. The panel explains historical/partial coverage, per-root proposals, conditional later preparation and zero-AI-versus-unestimated-future-cost separately. CSS contains bounded grids, wrapping long labels, a scrollable item list and a two-column summary breakpoint below 700px. Buttons/fields are disabled for non-writers and while pending.

Transport errors use 401 (sign-in), 403 (Origin/current writer), 404 (unavailable scoped source), 409 (source/reference change), 413 (body size), 415 (content type), 422 (invalid/unsupported bounded sample), or sanitized 503 (unknown database/provider failure). Stale results are discarded on every attempted retest, including conflicts/failures.

## Current verification and known limits

Final local regression passes **2,256 TypeScript tests across 130 files without skips**: web 759/44, workflow-worker 68/5, companion protocol 4/1, connectors 166/10, database 1002/50, domain 128/6, generation 29/4, ingestion 33/5, media 24/2 and workflows 43/3. All 12 typechecks and lint pass. Existing ingestion tests prove the old 25-entry diagnostic reports incomplete coverage when entries are sliced or a continuation exists. All 117 existing migrations applied to the dedicated browser QA database; replay applied none and skipped all 117 unchanged. The full integration database returned to zero fixture organizations.

Actual Chrome UI acceptance: paused synthetic local source; seven indexed items; two ignored, two candidates, two uncertain, one folder; context conflict; zero AI requests/unestimated cost; result cleared on reload; 430px requested viewport with content/client width 415px and no horizontal overflow. Database before/after matched exactly: paused v1, seven items, zero packages/events/test-history/Campaigns/preparation commands, one original source-created audit. A separate empty-index source correctly refuses to imply that the current filesystem is empty. A stale-version check exposed retained development error-class identity; the symbol-brand correction, regression and actual browser 409/reload/200 recovery all pass. Explicit fixture version changes are separate from the zero-write assertion. Screenshot proof is retained in the task workspace.

Next.js 16.3.8 production compilation passes in 5.3 seconds, TypeScript in 11.5 seconds and prerender generation at 96/96 in 482 ms. Companion Vite builds 18 modules; JavaScript is 201.34 kB/64.02 kB gzip. Cargo check and all three Rust tests pass. The unsigned, uninstalled Windows NSIS bundle is 2,945,532 bytes with SHA-256 `5eb641ab5754c201c4668933f58bc159eb0e32bd874fdb1dfb42cba30e7654a7`; it has not been uploaded or signed.

Production starts in 190 ms, serves healthy 1.29.0 status and passes an authenticated real-browser mixed-file sample. Unauthenticated edit redirects to sign-in, unauthenticated sample returns 401, and development login stays 404/disabled. Readiness correctly returns 503 for absent production origin/identity/storage and worker heartbeats while database, secrets and 117-migration checks pass. This is production-mode verification against isolated synthetic QA, not a deployed production service. The Google development parent and five nested child tabs have been synchronized and read back with all 30 tabs and previous content preserved.

Reviewed-source publication and exact feature/main cloud audits remain pending. Also not claimed: live Google/Graph account acceptance, current local filesystem inspection, full recursive/date-range/item simulation, semantic content interpretation, or a model/workload/pricing-based cost estimate.
