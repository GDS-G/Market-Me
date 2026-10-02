# Package-specific Related work

Implemented in 1.35.0. This is a read-only view of completed General Announcement preparation history for one Content Package, not a new execution workflow or a claim that the wider product is complete. See [release evidence](RELEASES.md) and the original [plan](PACKAGE_WORK_JOURNEY_PLAN.md).

## User and architecture contract

`/content-packages/[id]/work` follows recorded preparation → captured/current drafts → exact finalization → recent runs of that finalized version. Ordinary package review, the unsupported-review fallback, exact package approval receipts and preparation results link here. Existing review, receipt, draft and run pages independently authorize every navigation. The fallback link is not rendered for access-denied results.

The server page resolves authentication and active workspace, validates route/query, then passes server-owned workspace and actor IDs to `PackageWorkRepository.getSnapshot`. Missing scope, revoked membership or mismatched returned package/workspace/page becomes not-found; unauthenticated/no active workspace redirects to login. Projection/storage failures propagate as errors, not an empty healthy history. There is no organization-owner fallback.

One parameterized SELECT supplies current membership/role, package state, receipt lineage, current drafts and runs at one PostgreSQL statement snapshot. `statement_timestamp()` marks that observation. It does not lock membership for a subsequent operation or guarantee continued validity after the SELECT. Plain-anchor **Refresh saved state** requests the same page again; other links disable prefetch. There is no new API, client controller, recovery key, browser storage, domain write, audit write, mutation permission, worker, secret selection, provider/model call, retry or send. Ordinary authentication/workspace-selection cookies are separate existing behavior.

This view excludes unrelated manually authored Campaigns, independent generations/drafts and pending source-preparation commands. Exact approval-linked command status remains on its original approval receipt. Empty history never triggers preparation. Current package revision and captured preparation revision are deliberately separate; historical preparation does not approve a newer package. Current draft state is not historical approval proof. A finalization chose one immutable draft version, not every variant; it did not publish or activate. Even a completed run is not external delivery/engagement evidence.

## Files and repository lifetime

- `packages/database/src/package-work-models.ts`: strict minimized projection, frozen types/constants, input validation.
- `packages/database/src/package-work-repository.ts`: single-statement exact-lineage read; exported by database `index.ts`.
- `apps/web/src/server/package-work-view.ts`: canonical local paths, strict query parser and display dictionaries.
- `apps/web/src/app/content-packages/[id]/work/page.tsx` and `work.module.css`: authenticated server rendering, semantic cards, native guidance disclosure and narrow layouts.
- `apps/web/src/server/database.ts`: `packageWork` repository in the existing database bundle, sharing that bundle's SQL client and returned by `getPackageWorkRepository`. Existing development-only `globalThis.marketMeDatabase` retains repository instances across hot reload; it never stores results, grants or page snapshots. The existing production factory currently creates a fresh SQL client/bundle for each accessor call (no production singleton). Its default pool maximum is ten, idle timeout twenty seconds and connect timeout ten seconds. This increment does not change that lifecycle; production pooling merits a separate bounded correction/load check before deployment. Restart development when changing the factory/class contract.

## Types, fields and collections

All DTO objects and nested returned arrays/objects are frozen. IDs are normalized UUID strings; timestamps are ISO strings. Collections contain only explicit projected fields, never full database rows or canonical receipt payloads.

| Type | Fields and intent |
| --- | --- |
| `PackageWorkSnapshot` | `workspaceId`, `packageId`: exact scope; `title`, `packageVersion`, `packageStatus`: current package labels/state; `role`: current actor membership; `observedAt`: statement time; `page`: validated requested page; `hasMore`: one extra valid preparation was observed; `preparations`: at most ten projected receipts. |
| `PackageWorkPreparation` | `id`: immutable receipt; `campaignId`, `campaignName`: owning Campaign; `packageVersion`: captured revision, not current root revision; `createdAt`: original preparation time; `drafts`: 1–20 ordered saved variants; `finalization`: exact matching receipt or null. |
| `PackageWorkDraft` | `draftId`, `initialVersionId`: immutable prepared identities; `audienceLabel`: captured audience label in receipt order; `current`: null when exact live lineage cannot resolve, otherwise `versionId`, positive `versionNumber`, and current root draft `status`. A null value does not infer a replacement draft. |
| `PackageWorkFinalization` | `id`, `finalizedVersionId`: exact immutable finalization/plan identities; `selectedDraftId`, `selectedDraftVersionId`: saved selection, not today's draft pointer; `createdAt`; `runs`: at most five exact-version instances; `hasMoreRuns`: sixth matching instance exists. |
| `PackageWorkRun` | `id`, closed-enum `status`, `createdAt`. No action payload or claim of external delivery. |

The raw per-preparation `lineageValid` SQL boolean must be exactly true but is not exposed in the final DTO. Raw `preparationsJson` is selected as text so the SQL client's camel-case transform cannot rewrite historical nested JSON keys. It is byte-bounded before JSON parsing. Unknown raw fields are discarded by explicit construction, not forwarded to the page.

## Constants, helpers and dictionaries

| Name | Value / purpose |
| --- | --- |
| `PACKAGE_WORK_PAGE_SIZE` | 10 visible preparations, query/project at most 11 including lookahead. |
| `PACKAGE_WORK_MAX_PAGE` | 1000; maximum offset 9990. No page 1001 link or implication that older history is absent. |
| `PACKAGE_WORK_MAX_DRAFTS` | 20 per receipt, matching existing preparation limits; zero variants fails. |
| `PACKAGE_WORK_RUN_LIMIT` | 5 visible exact-version runs, query/project at most 6. Existing finalization receipt provides additional matching run links. |
| `PACKAGE_WORK_JSON_LIMIT` | 524288 UTF-8 bytes before nested JSON parse. This bounds accepted response data, not SQL scan cost or database aggregation work. |
| private frozen `roles` | owner, admin, editor, approver, analyst, viewer. All can inspect their own workspace; no new mutation affordances. |
| private frozen `packageStates` | detecting, stabilizing, analyzing, needs_review, ready, approved, executing, completed, failed. Validation only. |
| frozen `PACKAGE_WORK_DRAFT_STATES` | working, pending_review, approved, rejected, changes_requested, archived. |
| frozen `PACKAGE_WORK_RUN_STATES` | awaiting_approval, scheduled, active, paused, completed, failed, canceled. |

`unavailable` throws the generic snapshot-unavailable error. `object` rejects null/arrays/non-objects. `packageWorkUuid` accepts a trimmed RFC-variant UUID with version nibble 1–8, normalizes lowercase and rejects everything else before SQL. `positive` accepts only numeric safe integers from 1 through 2147483647; `packageWorkPage` defaults to 1 and applies the stricter 1000 cap. `label` accepts strings at most 800 UTF-16 units; SQL clips names to 200 Unicode characters before projection. `time` accepts a valid Date/string and normalizes to ISO. `choice` enforces a closed tuple. `list` requires an array within its cap. `unique` uses a request-local Set and rejects duplicate identities.

`draft`, `finalization` and `preparation` are explicit field projectors. Finalization's selected draft must occur in the same preparation. Duplicate draft IDs within a preparation, duplicate run IDs within a finalization, and duplicate preparation/Campaign IDs within a page fail. Every lookahead record is validated before slicing; corrupt hidden lookahead cannot silently establish a next page. `packageWorkSnapshot` validates all root fields, parses/project/freezes nested data and derives `hasMore`/`hasMoreRuns` from list lengths, not caller-provided booleans. Missing required values are errors, not fabricated defaults.

`packageWorkQuery` accepts only an optional single `page` string with canonical digits (`[1-9]` then at most three digits), then applies the numeric cap. Arrays, unknown keys (including workspace/role), whitespace, leading zero, exponent, negative and out-of-range values fail. `packageWorkPath` validates UUID/page and emits only a local path, omitting page 1's query. `PACKAGE_WORK_DRAFT_LABELS` is a frozen complete status-to-label Record: Working copy, Waiting for review, Marked approved, Review rejected, Changes requested, Archived. `PACKAGE_WORK_RUN_LABELS` similarly maps to Waiting for workflow approval, Scheduled, In progress, Paused, Marked completed, Could not complete, Canceled. Wording intentionally does not grant authority or prove delivery.

## SQL lineage and cost boundaries

`workspace`, `contentPackage`, `actor`, `selectedPage` are validated request locals. `scope` joins exact package/workspace to the current actor's workspace membership and carries current title/version/status/role. `selected` joins that scope to `campaign_preparation`, ordered `created_at DESC, id ASC`, with 11-row limit and ten-row offset pages. No title, latest Campaign pointer or guessed cross-item relationship is used.

Each selected preparation requires owning same-workspace `campaign c`, `campaign_version cv` belonging to that Campaign, and `draft_generation g` matching workspace, planning version, package and captured revision. These left joins feed `lineageValid`; broken root lineage fails the projection rather than disappearing into empty results.

`jsonb_array_elements(prepared_drafts) WITH ORDINALITY entry(value, ordinality)` preserves immutable variant order. `reference_snapshot.audiences[ordinality-1].name` supplies a clipped historical label, defaulting to General audience when absent. Draft alias `d` must match recorded ID, workspace and generation. `initial` must match captured version ID and its owning draft; `current` must match the draft's live pointer and owning draft. All three must resolve before returning live version/status. Archived drafts remain visible; a foreign pointer or moved generation becomes unavailable, not substituted from a sibling.

`campaign_finalization f` must match preparation, workspace, Campaign and planning version. Existing immutable/unique finalization constraints remain authoritative. Its run subquery `r` requires exact workspace/Campaign/finalized-version equality and returns at most six, ordered newest then ID. It cannot include planning-version or sibling-preparation runs. Existing receipt/schema invariants govern finalized/selected version validity; this read does not recalculate fingerprints, eligibility or execute verification. JSON aggregation keeps the same stable order inside this statement.

The response caps do not promise capped scan/sort/aggregation cost. Existing workspace/time indexes support these scoped queries; this increment adds no index or performance benchmark. Offset pages can shift when new receipts arrive. Very large/corrupt receipt JSON can fail the projection; investigate data integrity, do not silently truncate variants or weaken guards. This is not a stable historical export.

## Server-page variables and accessibility

`user`, `workspace` are authenticated request context. `route`, `query` come from awaited Next page promises; `id`, `page` are validated locals. `snapshot` is this request's DTO and `self` is its canonical refresh URL. Per-map `preparation`, `draft`, `run` and ordinal `index` exist only during server rendering; indexes label variants/runs but are not identity or authorization. Explicit immutable IDs are React keys. No new global, browser ref, map cache, client state machine or polling interval exists.

The page uses named sections, hierarchical headings, explicit preparation/draft list semantics, meaningful local links, `<time>` with ISO metadata and visible focus rings. Native `<details>/<summary>` keeps essential no-action/role/time guidance visible while progressively disclosing longer inclusion/status caveats. Keyboard Enter toggles it. At narrow widths cards/links wrap; no horizontal overflow at the tested 430×932 viewport (415-pixel document width). First-page empty and later-page empty messages differ; later empty pages link back to newest results. Page-limit and extra-run messages never imply omitted history is empty. Labels are React-escaped, not HTML or URLs supplied by the database.

## Verification, rollout and recovery

Focused new suites: 59 model cases, 16 live database cases and 37 server-page/query/link cases (112 total). Cover every role, package/tenant isolation, revoked membership and organization-owner denial, empty/missing scope, malformed input before SQL, failure propagation, exact preparation/finalization/run lineage, archived/edited/unavailable drafts, new package revision with old captured preparation, generation substitution denial, read-only transaction execution, paging/lookahead/max limits and HTML escaping. Read-only mutation-count checks scope their audit counts to the fixture workspace so concurrent unrelated tests do not cause false failures. Initial fixture creation correctly failed the existing source-item UUID guard; the test was fixed by creating a real source item, not weakening runtime validation.

Full integration uses only isolated `market_me_ci`; the new focused suite additionally allows `market_me_qa_135_*`. Synthetic browser data is built through real approval/preparation/finalization flows and inert run records, never provider execution. Browser acceptance covers owner/reader isolation, historical/current labels, 10+1 paging, five-of-seven run display, receipt return navigation, refresh, empty state, keyboard disclosure and desktop/mobile layout. Production-mode checks and final exact-source cloud results are recorded in [Releases](RELEASES.md), not inferred from development rendering.

Own package/npm/Cargo/Tauri version is 1.35.0, with no third-party dependency upgrade. No migration, environment variable, permission, credential or new deployment service is required. Retain all 120 frozen migrations ending at 0120 and deploy matching database exports/factory/web code; restart processes. Rollback of this read-only UI can remove matching navigation/view/repository code without deleting domain history. Refresh/reload after ordinary state changes. On failure inspect current membership, service/database errors and lineage integrity; never reset approvals, erase receipts, issue replacement preparations or replay sends to repair display. Existing backups already contain the history; no new recovery store is introduced.
