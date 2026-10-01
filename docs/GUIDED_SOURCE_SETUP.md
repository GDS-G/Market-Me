# Guided Smart Source setup

## Scope and intent

Release 1.28 replaces the new-source technical form with four steps: Connection, Folder, Intake rules, and Review & save. The result is one **paused** Smart Source. This is a bounded configuration compiler, not an AI instruction interpreter or the full ten-step setup described in the conceptual specification.

An owner, administrator or editor chooses one existing active Google Drive/OneDrive/SharePoint connection or one non-revoked paired desktop. Cloud folders can be browsed one page at a time, or entered explicitly through advanced controls. SharePoint currently requires a known `driveId:itemId` library/folder reference; automatic site/library discovery is not implemented. A local source stores a worker UUID and the fixed label `Approved companion folder`, never a filesystem path. Folder consent and binding stay in the companion.

Saving does not browse, synchronize, extract content, create a Content Package, generate drafts, create an approval/preparation command, finalize/activate a Campaign, or send anything. The user separately tests/configures/enables the saved source. General Announcement preparation remains the separate [source-bound preparation](SOURCE_BOUND_DRAFT_PREPARATION.md) contract, with its own [configuration preview](SOURCE_PREPARATION_PLAN_PREVIEW.md).

The review is not a sample-content dry-run or cost estimate. Free-form source instruction interpretation, reusable Campaign templates, automatic finalization/activation, complete first-run onboarding, live deployment-specific OAuth acceptance, and the broader original specification remain open. Video/audio selection allows indexing only; it does not implement transcription, captions or full multimedia understanding.

## Implementation map

| Path | Responsibility |
| --- | --- |
| `packages/domain/src/source-setup.ts` | Closed input normalization, canonical set ordering and pure compilation to existing source fields |
| `packages/database/migrations/0117_guided_source_setup.sql` | Immutable, tenant-scoped creation receipt and integrity trigger |
| `packages/database/src/source-setup-repository.ts` | Current-authority/reference locks, atomic paused creation, exact retries and receipt lookup |
| `apps/web/src/app/api/v1/smart-sources/setup/route.ts` | Origin-checked POST creation and current-writer GET recovery |
| `apps/web/src/app/api/v1/smart-sources/setup/browse/route.ts` | One explicit folder page, minimized results, current-writer recheck |
| `apps/web/src/server/source-setup-api.ts` | Actual-byte JSON limit, safe errors and no-store responses |
| `apps/web/src/server/source-setup-browse.ts` | Strict browse schema and encrypted, short-lived continuation scope |
| `apps/web/src/components/source-setup-request.ts` | Session attempt validation, exact receipt and bounded folder-response guards |
| `apps/web/src/components/source-setup-wizard.tsx` | Four-step editor, explicit scope/review acknowledgements and uncertain-save recovery |
| `apps/web/src/components/source-setup-review.tsx` | Pure, human-readable configuration summary and next-action boundaries |
| `apps/web/src/components/source-setup.module.css` | Scoped readable controls and narrow-screen layouts |
| `apps/web/src/app/smart-sources/new/page.tsx` | Authenticated current-workspace choices projected without credentials/private content |
| `apps/web/src/app/smart-sources/[id]/edit/page.tsx` | Existing advanced edit surface; optional receipt workspace must match active workspace |
| `packages/database/src/repositories.ts`, `packages/ingestion/src/service.ts` | Compare-and-set token refresh; a stale refresh cannot reactivate a revoked connection |

## Input fields and canonical identity

`SourceSetupInput` is the entire accepted configuration. Unknown keys are rejected at the root, location and Context Pack entries. The actor is always supplied by authentication, not the body. `normalizeSourceSetup()` creates a fresh object in deterministic property order; its JSON bytes identify the request. All text is NFC-normalized and trimmed, with control characters rejected. UUIDs are validated and lowercased.

| Field | Type/limit | Intent |
| --- | --- | --- |
| `workspaceId` | UUID | Explicit tenant; membership is checked again transactionally |
| `requestId` | UUID | One logical creation attempt; reuse only with the identical normalized request and actor |
| `name` | 2–120 characters | Historical creation label and initial source name |
| `provider` | `google_drive`, `onedrive`, `sharepoint`, `local` | Chooses the existing connector/local intake path |
| `storageConnectionId` | UUID for cloud; absent for local | Exact active, same-workspace/provider connection |
| `location.providerLocationId` | Cloud ID up to 500 characters; local worker UUID | One folder or paired desktop, not a filesystem path or bearer permission |
| `location.displayPath` | Cloud label 1–1,000 characters; fixed local label | Display only; entering a label/ID does not prove provider access |
| `recursive` | Boolean | Whether later synchronization includes nested folders |
| `readinessMode` | `immediate`, `related_files`, `ready_marker` | Existing deterministic readiness policy; no AI-recommended mode in the wizard |
| `stabilizationWindowSeconds` | Integer 0–86,400 | Existing settling period; UI offers 30/120/300/900 seconds |
| `relatedFileMinimum` | Integer 1–100, related-files mode only | Existing supporting-file grouping threshold |
| `readyMarker` | 1–100 characters, marker mode only | Existing filename/metadata marker rule, not executable instructions |
| `fileTypes` | Nonempty subset of six catalog values | Compiles to MIME filters; duplicate/unknown values rejected |
| `ignoredFolders` | Subset of four catalog values | Compiles to eligible-file glob exclusions |
| `contextPacks` | At most 20 unique `{id, expectedVersionId}` pairs | Checks exactly the current published version reviewed at creation |
| `autonomyMode` | `draft_only` or `approval_required` | Existing source policy; no autonomous-send choice or authority |

Inactive readiness fields are dropped from canonical identity. File types and folder exclusions are unordered sets normalized to catalog order. Context Pack selections are an unordered set sorted by root UUID, with duplicate roots rejected. Reordering these inputs does not create a different canonical request. Context admission pins a version only for the creation check: the source retains the existing root-based `context_pack_ids` semantics and future processing uses current published versions. This is not a permanent version pin.

## Constants, collections and compilation

`SOURCE_SETUP_FILE_TYPES` is a frozen tuple ordered as images, documents, presentations, spreadsheets, video, audio. `SOURCE_SETUP_IGNORED_FOLDERS` is a frozen tuple ordered as Archive, Drafts, Raw, Internal. `SOURCE_SETUP_MIME_TYPES` is a frozen dictionary of individually frozen arrays:

| Choice | Compiled MIME patterns |
| --- | --- |
| images | `image/*` |
| documents | `text/plain`, `application/pdf`, DOCX, native Google document |
| presentations | PPTX, native Google presentation |
| spreadsheets | `text/csv`, XLSX, native Google spreadsheet |
| video | `video/*` |
| audio | `audio/*` |

The exact MIME strings are defined once in the domain module. These are filter choices, not a promise that every included format can be extracted or transformed. `compileSourceSetup()` normalizes again, flattens selected MIME arrays, emits one-element `locations`, maps Context Pack pairs to root IDs, and generates `ignorePatterns = ["~$*", ...selectedFolders.map(folder => "**/" + folder + "/**")]`. Exclusions filter eligible files; they do not guarantee provider metadata is never enumerated. The output fixes `enabled: false` and contains no actor, request ID, instruction, generation graph, approval or provider credential.

UI defaults are recursive intake, 120-second settling, each settled file ready, images/documents/presentations/spreadsheets, Archive/Drafts/Internal exclusions, no Context Packs and review-required behavior. Raw is available but not selected by default. A name, connection and location have no implicit selection. The default provider is Google Drive. Selecting a drive/library root requires an additional broad-scope acknowledgement; the server still treats the ID as configuration, not proof of user consent or provider access.

## Atomic creation and durable receipt

Migration 0117 creates `smart_source_setup_receipt`:

| Column | Role/lifetime |
| --- | --- |
| `workspace_id`, `request_id` | Composite primary key; one logical request per tenant |
| `smart_source_id` | Unique FK to the created source; restricts individual source deletion while evidence exists |
| `created_by` | Creating user FK; another writer cannot recover/replay this private receipt |
| `name` | Immutable original label, not a live mirror of later edits |
| `canonical_request` | Private exact normalized JSON, at most 32,768 UTF-8 bytes; never in broad audits or browser results |
| `created_at` | Database `clock_timestamp()` at receipt insertion |

The trigger requires a matching same-workspace/same-creator version-1 disabled source and a current writer membership on insert. Updates always fail. Receipt deletion is blocked while the workspace exists; deliberate whole-workspace erasure cascades. Source/user retention must account for the foreign keys; never delete receipts merely to allow a duplicate retry. This trigger is defense in depth, not a substitute for application locks or least-privilege database access.

`SourceSetupRepository.create(input, actorUserId)` uses one transaction and this lock order:

1. Organization `FOR KEY SHARE`, workspace `FOR SHARE`, actor `FOR KEY SHARE`, current membership `FOR SHARE`.
2. Transaction advisory lock on `hashtextextended("source-setup:" + workspaceId + ":" + requestId, 0)`.
3. Existing receipt lookup. Exact same actor and canonical bytes return the historical receipt immediately. A changed request or actor conflicts without disclosing its source.
4. For a new request, selected worker or cloud connection `FOR SHARE`; sorted Context Pack roots followed by their exact current published versions `FOR SHARE`.
5. Insert one disabled version-1 source, one location, one immutable receipt and one minimized `smart_source.created` audit; commit together.

An active or paused paired worker is eligible, even if currently disconnected, because no local work is dispatched by creation. A cloud connection must be active, same-provider and same-workspace. A stale Context Pack fails rather than silently switching the version reviewed. A missing/revoked reference or role cannot produce a partial source.

`getReceipt(workspaceId, requestId, actorUserId)` independently locks/checks the current writer and looks up only the creating actor's request. Unknown requests and another actor's receipts return no result. Role loss blocks recovery even if a historical receipt exists. Exact replay does not revalidate references that changed after creation, reset later source edits, or change its enabled state: it reports only the original committed creation. Existing advanced source edits and the legacy create API retain their separate preexisting contracts; this release does not retrofit all source writes with these receipts.

The browser-safe `SourceSetupReceipt` has exactly six fields: `workspaceId`, `requestId`, `smartSourceId`, original `name`, ISO `createdAt`, and `initialState: "paused"`. It is historical evidence, not an enablement guarantee or execution credential. The browser validates exact workspace/request/name, canonical source UUID, fixed initial state and timestamp before showing success. Its local edit link includes the explicit workspace; malformed, repeated or changed workspace query values fail closed before loading the source.

## API and folder browsing

- `POST /api/v1/smart-sources/setup`: strict `SourceSetupInput`; returns 201 with `{data:{receipt,replayed:false}}`, or 200 for exact replay. Query overrides are rejected.
- `GET /api/v1/smart-sources/setup?workspaceId=...&requestId=...`: exactly one of each parameter and no extras; returns `{data:receipt}` or `{data:null}`. Null means no committed result visible at that read, not proof that an in-flight attempt failed.
- `POST /api/v1/smart-sources/setup/browse`: strict `{workspaceId,connectionId,provider,locationId,cursor?}` body and no query overrides. Each explicit click makes at most one provider page request; there is no automatic recursive enumeration.

POST transport requires the configured `APP_BASE_URL` Origin, `application/json`, valid UTF-8 and at most `SOURCE_SETUP_BODY_LIMIT = 32_768` actual streamed bytes. It does not trust Content-Length or forwarded host. All responses use `Cache-Control: no-store`. Input errors are 422, wrong media type 415, oversized body 413, unauthenticated 401, denied access/origin 403, configuration conflicts 409, unavailable storage/unexpected failures 503. Unexpected exception details, SQL, credentials and canonical request bodies are neither returned nor logged by this boundary.

Browsing requires a current writer before credentials/provider I/O and again before returning metadata. It uses the existing ingestion credential and connector code, verifies the stored provider, lists a bounded page, and returns only folder `{providerLocationId,name}` pairs, `examinedCount`, `incompleteSearch`, and optional `nextCursor`. Non-folder names, file contents, metadata, URLs and tokens are not returned. The UI validates at most 200 entries, IDs up to 500 characters, names up to 1,000, and cursor length up to 24,000. SharePoint child IDs retain the explicitly selected library prefix. Manual ID entry performs no access check; a later source test/sync remains necessary.

`source_setup_page_v1` cursors encrypt the workspace, actor, connection, provider, exact folder, provider page token and expiry with the existing connector token-encryption key. `PAGE_LIFETIME_MS` is ten minutes; a cursor with any changed scope, invalid ciphertext, expiry at/before now or beyond the maximum lifetime is rejected before credentials are accessed. The provider token is at most 12,000 characters. A cursor is only a bound continuation, never authorization, and no plaintext provider next-link is accepted from the browser.

`updateStorageConnectionTokens()` now returns a Boolean compare-and-set result. Inputs `expectedEncryptedAccessToken` and optional `expectedEncryptedRefreshToken` are encrypted envelopes, not plaintext. Updates match exact connection/workspace/provider, active status and the observed pair of encrypted token values. A late refresh cannot set status active or overwrite a concurrent refresh. The ingestion service refuses to use the new plaintext token unless persistence wins. One concurrent winner and revoked-connection non-resurrection are live-database tested. No new environment variable, OAuth scope or provider permission is introduced.

## Browser state and uncertain outcomes

`SourceSetupProps` contains workspace/user scope and projected arrays: active connections `{id,name,provider}`, non-revoked companions `{id,name,health}`, and current published Context Packs `{id,expectedVersionId,name,versionNumber}`. Private account IDs, credential scopes, token prefixes, health details and Context Pack instructions never enter these setup props.

State is per component; there is no mutable global configuration dictionary. Server `getSourceSetupRepository()` returns the `sourceSetups` repository in the existing repository factory. In development that factory's established `databaseGlobal.marketMeDatabase` cache retains repository instances and the shared SQL client across hot reloads; it does not store setup requests, actor authority or receipts. Restart the development server when adding a repository field to an already-running older cache. Production follows the existing factory/pool lifecycle, not a new setup-specific global:

| Variable/collection | Intent and lifetime |
| --- | --- |
| `stepNames`, hydration functions | Module-local presentation constants; hydration delays browser storage access until client mount |
| `values`, `step` | Editable proposed settings and current 0–3 step; scoped by workspace/user remount key |
| `reviewed`, `rootConfirmed` | Explicit configuration and broad-root acknowledgements; invalidated by relevant edits/navigation |
| `trail` | Ordered array of selected folder breadcrumbs; unrelated to execution order |
| `folderPage` | Latest bounded folder page; explicit navigation replaces it and clears prior selection |
| `manualLocation`, `manualLabel` | Temporary advanced-entry text; normalized before selection |
| `options`, `connectionName`, `contextNames` | Derived display-only collections; stale restored choices are labeled as previous selections |
| `attempt`, `restored`, `storageKey` | Exact canonical version-1 attempt and browser recovery state |
| `receipt` | Validated historical creation receipt; never a mutable source model |
| `inFlight` | Synchronous `useRef` mutex preventing same-component overlapping requests |
| `pending` | Visual/fieldset request lock; always cleared in `finally` |
| `error`, `storageError`, `message` | Bounded safe explanation/uncertain-result state; no raw server exception |
| `resetConfirmed` | Separate acknowledgement that a new request may create another source |
| `heading` | Focus target after step advancement; not data authority |

Before the first POST, the client stores `{version:1,userId,input}` under `market-me:source-setup:v1:<workspaceId>:<userId>` in sessionStorage. The parser limits the raw string to 40,000 characters, rejects unknown wrapper/input keys and verifies the actor/workspace. Storage failure sends no POST. Once saved locally, settings are locked; an uncertain response cannot turn a changed payload into an accidental retry. The stored content is private configuration, not a credential, and remains accessible to same-origin scripts. It is tab/session recovery, not cross-device or indefinite browser retention. Closing/clearing the browser may lose the key; check the source list before creating another attempt.

Reload restores the exact attempt without an automatic request. **Check saved result** issues GET; **Retry same settings** issues the exact original POST. Network errors, malformed responses and unknown outcomes retain the attempt. A receipt survives subsequent edits/enablement and repeats do not reset it. **Start a separate setup** requires its own acknowledgement, removes only this session entry and creates a new UUID; it does not cancel an earlier in-flight transaction or delete any source.

## Build, rollout and verification

No new dependency is required. Package/native metadata are synchronized at 1.28.0. Apply additive migration 0117 before starting matching web code; readiness expects 117 migrations ending at `0117_guided_source_setup.sql`. Never modify frozen earlier migrations. Back up first, drain active setup/credential-refresh requests, deploy matching database/ingestion/web code, check readiness, and verify paused creation/recovery before enabling intake. Preserve receipts on rollback; do not roll back credential-refresh protection or drop history to make an older client work. Prefer forward repair.

Run the full integration suite only against disposable `market_me_ci`. The focused new database file additionally accepts `market_me_qa_128_*`; existing suites have their own isolated-database guards. Do not point integration tests at an application database. Typical gate: `npm run db:migrate`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run companion:native:check`, `npm run companion:native:test`. Windows packaging is a separate `npm run companion:bundle`; passing an unsigned local bundle does not establish distribution or cross-platform acceptance.

Tests cover normalization/compiler identity, unknown authority fields, strict transport, current writer and tenant boundaries, same-workspace actor privacy, six concurrent identical creates with one winner, changed payload conflicts, historical replay after later changes, reference staleness, immutable receipts, whole-workspace cleanup, sealed pagination scope/expiry/tampering, post-provider membership loss, minimized page props, session recovery contracts and refresh compare-and-set races. Browser acceptance uses a fresh synthetic database without live provider credentials: missing desktop selection is rejected; an explicitly reviewed related-file source saves once paused; reload/GET and repeated POST recover the same source; its edit page shows exact chosen settings, zero discovered items and no preparation command. A 430-pixel viewport fits without horizontal overflow.

Exact local/cloud test totals, migration hash, production smoke, native artifact, documentation synchronization and publication evidence are maintained in [Releases](RELEASES.md) and [CI](CI.md), not inferred from successful compilation. Mocked provider pages are not live Google/Graph acceptance. Native connector document readback is not rendered-PDF visual QA.
