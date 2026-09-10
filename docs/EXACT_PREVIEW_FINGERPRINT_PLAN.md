# Exact-preview fingerprint and finalization plan

Status: **implemented locally for the 1.23 preview; full release validation pending**. The pure primitive, raw loader, finalization compiler/repository, migration 0112 receipt/content/compatibility guards, and activation/activity/initial-and-retry publication proof checks are now implemented. The current programmer contract is [Campaign finalization](CAMPAIGN_FINALIZATION.md); this document retains the reviewed design rationale and acceptance checklist. Focused evidence is 134 fingerprint, 52 loader, 101 compiler, 57 finalization, 44 combined helper/fence and 30 common-proof cases, not a full-regression total. No cloud, native, browser or complete-product acceptance is asserted here. See [Releases](RELEASES.md) for final acceptance; the 1.22 capability race repair remains a prerequisite.

## Purpose and bounded scope

`draft_channel_preview` can be rewritten under the same ID. A preview ID, approved source version, and current capability timestamp do not prove that a later executable plan uses the exact rendering the user selected. Finalization must bind the selected rendering and its routing context, then preserve that binding through activation and publication admission.

The first finalizer accepts one current approved **text-only** preview from a prepared Campaign, for an explicitly selected Discord, Slack, or Mastodon connection using exactly `official_api`. It creates an ordinary executable **draft version of the same Campaign**, with `approval_required` and a publication step requiring approval. It does not publish that version, activate a Campaign, create a workflow command, approve anything, contact a provider, select an attachment, or initiate outreach. Email, media, multi-method fallback, automatic source-ready finalization, and user-authored template compilation remain outside this slice.

No existing editable Campaign draft may be overwritten. The finalizer must compare the expected current planning version and absence of an editable draft under the Campaign lock. Draft IDs alone do not detect in-place editing. Preserve the planning version and generation that own the selected copy; the selected current approved copy may be a reviewed revision of an initially prepared draft.

## Primitive values and lifetimes

`packages/database/src/exact-preview-fingerprint.ts` implements `createExactPreviewFingerprint(input: unknown)`, returning frozen `{ token, canonicalSnapshot, snapshot }`, and exports `ExactPreviewFingerprintResult`, `ExactPreviewSnapshotV1`, `ExactPreviewProvider`, `ExactPreviewConnectionV1`, `ExactPreviewRawJson`, and `ExactPreviewRawJsonObject`. It is server-only pure code using Node's SHA-256 implementation, with no database, Date conversion, clock sampling, random identity, or provider access. Storage and enforcement lifetimes below are implemented in the bounded 1.23 path and documented with its APIs in the current contract guide.

`ExactPreviewFingerprintValidationError` exposes frozen `issues: [{ field, code, message }]`. Validation rejects unknown/missing schema fields, unsupported providers/contracts, noncanonical IDs, incomplete identities, malformed HTTP(S) URLs, attachments, invalid Gregorian timestamps, nonfinite values, exotic/proxy containers, getters, symbols, hidden properties, sparse/custom arrays, cycles and unpaired Unicode. Counts use PostgreSQL integer bounds and link slugs retain their 8–64-character database bound. Every accepted object/array is separately detached and frozen; caller input is unchanged. Known blocked/inactive statuses may be fingerprinted structurally: equality and readiness are separate responsibilities.

`EXACT_PREVIEW_FINGERPRINT_LIMITS` is frozen: `depth: 32` (root at zero), `nodes: 50000` (values/containers visited), `stringCodeUnits: 262144` (per value/key), and `canonicalBytes: 1048576` (UTF-8 including JSON escaping/punctuation). Limits are enforced while copying, before allocating the final canonical string. `EXACT_PREVIEW_FINGERPRINT_DOMAIN` and `EXACT_PREVIEW_FINGERPRINT_PREFIX` expose the exact byte-domain and token-prefix strings below. No process-global mutable request collection is used. The caller still must perform the raw JSONB precision round-trip and all authorization/locked eligibility checks; the primitive cannot recover information already rounded before it receives input.

| Value | Purpose and lifetime |
| --- | --- |
| `EXACT_PREVIEW_FINGERPRINT_VERSION = 1` | Server-owned canonicalization/field-selection contract. Keep its interpreter while durable v1 plans remain usable. Independent of application and template versions. |
| `EXACT_PREVIEW_RENDERER_CONTRACT = "stored-channel-preview-text-v1"` | Names the validation rules used when checking the stored rendering against approved source fields. It does not claim that historical rows recorded their original renderer build. |
| `ExactPreviewSnapshotV1` | Detached, strict plain-JSON snapshot loaded from exact raw database values. Transaction/request-local until retained in a successful finalization receipt. |
| `canonicalSnapshot` | Exact UTF-8 canonical JSON text. Persist it with the completed receipt so later retries do not reconstruct history from live rows. |
| `draftChannelPreviewFingerprint` | Versioned SHA-256 token submitted with finalization, retained in immutable compiled step inputs, approval inputs, receipt, and publication request evidence. Not a secret or grant of authority. |
| `expectedFingerprint` / `actualFingerprint` | Request-local expected token and freshly computed locked token. Never a process-global mutable cache. |
| `idempotencyKey` / finalization canonical input | Workspace-scoped durable retry identity and full normalized intent, including expected lineage, selected fingerprint, and schedule settings. Distinct from the preview fingerprint. |
| protected finalization provenance | Durable receipt/campaign provenance outside editable `step.inputs` that makes proof mandatory for this Campaign. It cannot disappear when draft steps are deleted/reinserted or a later version is created. |

The browser receives the token alongside the exact server-rendered preview/account summary. It submits the token and explicit settings, not an authoritative snapshot. A missing, malformed, unknown-version, or mismatched token produces a review-again conflict; it must not silently downgrade to preview-ID-only behavior.

## Exact snapshot schema

All keys below are present. Optional scalar/object values use JSON `null`, never omitted properties or `undefined`. IDs use database `uuid::text` spelling. Strings retain their exact contents; this contract does not trim, NFC-normalize, case-fold, rewrite URLs, or normalize line endings in approved copy. URL parsing validates syntax only; its normalized result is never fingerprinted in place of the stored string.

```text
schemaVersion: 1
rendererContract: "stored-channel-preview-text-v1"
lineage: {
  workspaceId, campaignId, sourceCampaignVersionId, generationId,
  previewId, contentDraftId, contentDraftVersionId
}
preview: {
  provider, channelConnectionId, destinationId | null, linkMode, status,
  renderedSubject | null, renderedContent,
  subjectCount | null, subjectLimit | null, characterCount, characterLimit | null,
  validationIssues, capabilityVersion, capabilityObservedAtUtcMicros,
  capabilitySnapshot, createdBy, createdAtUtcMicros,
  assets: []
}
connection: {
  id, workspaceId, provider, status,
  identity: <provider-specific object below>
}
destination: null | {
  id, workspaceId, provider, status, canonicalUrl
}
trackedLink: null | {
  id, workspaceId, destinationId, draftChannelPreviewId,
  campaignInstanceId | null, campaignStepRunId | null,
  slug, canonicalUrl, utmParameters, status, expiresAtUtcMicros | null,
  publicRedirectUrl
}
```

Provider identity objects follow the existing `PublishingRepository` identity checks:

- Discord: `{ webhookId, channelId, guildId: string | null }`; the webhook/channel pair is required, while a direct-message webhook may have no guild.
- Slack: `{ teamId, serviceId, host }`.
- Mastodon: `{ accountId, instanceOrigin, host }`.

Require complete already-tested identity; do not decode credentials or call providers merely to finalize. No destination or audience contact is inferred. A fingerprint pin does not authorize a new account, direct-message recipient, or relationship contact.

`capabilitySnapshot`, `validationIssues`, and `utmParameters` are exact raw JSON values, not a driver's transformed projection. Preserve array order. `assets` must be exactly empty and the underlying preview attachment count must be zero; do not omit attachment state or fingerprint only attachments that happened to survive a join. Future media support needs a new contract covering the complete ordered asset/source/hash/rights/scan/accessibility snapshot and corresponding live validation.

Exclude connection display names, destination titles/descriptions, unrelated tracking settings, computed `isStale`, evaluation time, and credentials. Receipt presentation metadata may retain labels separately. **Exclude connection `updated_at` and `last_tested_at`: worker preflight legitimately updates these before publication admission and would invalidate its own fingerprint.** Explicit account identity and capability observation remain pinned; live credential/preflight correlation still applies independently. Include preview `created_at`/`created_by`, which intentionally changes the token when the same preview is recreated, even with identical text.

## Raw reads and canonical bytes

`StoredDraftChannelPreview` is a display DTO, not the fingerprint input. It omits generation lineage and full tracked-link routing, returns JSON through `postgres.camel`, and represents timestamp values through a driver Date. The dedicated `loadExactTextPreviewInTransaction` loader now uses explicit columns and joins. For a preview display response, it loads one coherent database snapshot; mutation/admission loads again after the required locks. Do not assemble fields from independently timed list/get calls.

Read JSONB as `::text` and parse explicitly. This avoids the driver's recursive conversion of `publish_content` to `publishContent`. Do not canonicalize those aliases or discard unfamiliar fields: 1.22 deliberately treats a historically transformed/mismatched capability snapshot as stale until its preview is recreated.

Use [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785): recursively sorted object keys, unchanged array order and Unicode string data, no insignificant whitespace, and prescribed primitive serialization. A conforming implementation must reject invalid Unicode and nonfinite numbers. Avoid a home-grown sorted-object-plus-`JSON.stringify` approximation that mishandles numeric-looking object keys. The RFC is an informational specification, not an authorization protocol.

```text
canonicalSnapshot = JCS(ExactPreviewSnapshotV1)
fingerprintBytes = UTF8("market-me:exact-preview:v1\n") || UTF8(canonicalSnapshot)
token = "mm-preview-v1:sha256:" + lowercaseHex(SHA256(fingerprintBytes))
```

The prefix is literal ASCII with one LF, not a platform newline. Serialization has no BOM. Store the token and canonical text; compare full canonical finalization input on idempotent replay, not only a digest. Changing fields, canonicalization, renderer interpretation, or domain separation requires a new version.

### JSON and timestamp precision

PostgreSQL JSONB can represent numbers that a JavaScript `number` cannot preserve. Reading JSONB as text prevents key transformation but does not itself prevent `JSON.parse` rounding. For each JSON field, verify that the parsed/canonically serialized value round-trips to the original JSONB using database JSONB equality before accepting a fingerprint. Reject lossy input with an explicit unsupported-snapshot/recreate error. This detects, for example, a large integer or precise decimal that becomes another value after parsing. No conversion to a numeric string is allowed merely to make the comparison pass.

Current manifests mostly use bounded integer limits and booleans, so lossless ordinary JSON is the smallest first implementation. A future lossless-number parser is an alternative if real supported manifests require wider values; it must have its own tested canonical contract. Do not hash raw JSONB textual formatting as a substitute: database key ordering/number spelling is not the cross-runtime byte contract. Bound input size/depth and reject exotic native objects, getters, `toJSON`, nonfinite values, and malformed schema. Traverse own properties safely without prototype-mutating assignment.

Format every included finite timestamp in SQL as fixed six-digit UTC:

```sql
to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
```

The loader validates the supported AD timestamp range and rejects BC, infinity and out-of-range values before formatting. Never pass this string through `Date`, `toISOString`, or locale formatting. If writing it back, bind as text and cast inside SQL (`parameter::text::timestamptz`); even a JavaScript string bound directly as a timestamptz parameter can invoke the driver's millisecond Date serializer. Existing stored timestamp precision must not be rounded to fit a fingerprint.

## Eligibility before hashing and finalizing

Fingerprint construction does not replace permission or eligibility checks. Require all of the following under the applicable locks:

1. Current authorized writer membership; exact preparation/workspace/Campaign/planning-version/generation lineage; selected draft belongs to the preparation; expected Campaign state still matches and no editable draft exists. Keep source/package/profile checks separate from fingerprint identity.
2. Exact current draft version and draft status are approved, with a matching real approved draft decision. An older version's approval cannot authorize a revision. Lock approval rows before draft/version rows, consistent with decision writers.
3. Preview is ready, belongs to that exact approved version and workspace, uses the selected connection and expected Campaign Destination, has zero validation issues and no attachment rows. Social-only v1 requires rendered subject/count/limit to be null.
4. Connection is active and of an allowed provider, supports publication and official API execution, and has complete matching account identity. Current raw capabilities, capability timestamp and provider exactly equal the preview's observation.
5. Re-render the approved version's headline/body/call-to-action/hashtags with the existing channel renderer and trusted destination/tracked URL. Require exact stored subject/content/counts/limits/issues equality. Preserve Discord/Slack UTF-16 counting versus Mastodon's existing URL-aware counting; do not replace either with generic string length. A changed renderer rule requires review/recreation or explicitly retained versioned validation, not silently changed bytes.
6. Optional Destination is current, published, correctly scoped, and has the expected canonical URL. Tracked mode requires exactly one active, unexpired, correctly scoped preview link; reject unexpected instance/step linkage for a preparation-owned preview. Include raw UTM parameters and redirect target. Derive `publicRedirectUrl` through the existing trusted `APP_BASE_URL` rules, not by extracting an arbitrary URL from rendered content. A changed trusted origin requires a new review; canonical mode needs no tracked-link environment setting.

Recheck time-dependent availability against current database time without placing that evaluation time in the fingerprint. Schedule settings are normalized separately in finalization intent and must obey existing execution/scheduling policy; the preview token contains no caller-controlled deadline or permission flag.

## Locking and full admission integration

Use transaction-scoped helpers; do not compose public methods that each open their own transaction. The finalizer acquires membership/ancestor and Campaign/idempotency locks before resolving the exact preview. Thereafter it preserves the publication order: **connection → draft approval rows → draft → draft version → preview → Destination → tracked link**, with deterministic ordering within each collection. Do not hold a Destination lock and then request the preview lock, or add a late approval lock after locking the draft. Package/profile locks follow the existing package-first and profile-root-before-version writer contracts; current pointers are rechecked under those locks.

The preview row lock must exclude concurrent preview/attachment rewriting while the zero-asset count and raw snapshot are checked. Re-read current scoped rows after waiting for locks. A transaction that updates capability or draft state first should make finalization observe that new state and reject the stale selection. A finalizer that locks first may commit the exact old plan; subsequent mutation must make later activation/admission reject it. A finalization token is not a lease that prevents future changes.

The bounded 1.23 implementation covers the boundaries below; the table remains the invariant checklist for future changes. Shipping only the finalizer receipt is insufficient:

| Boundary | Required behavior |
| --- | --- |
| Preview choice/read API | Return exact displayed data and its server token from one coherent raw projection. Client token is an optimistic expected value only. |
| Finalization transaction | Lock, authorize, re-render, recompute and compare expected token; compile an ordinary same-Campaign draft with exact preview ID and token; retain immutable receipt, canonical intent, compiled definition and lineage atomically. |
| Campaign authoring/versioning | Preserve token exactly in step inputs and derive mandatory proof from durable finalization provenance outside those inputs. Strictly reject missing/malformed/unknown proof for protected plans. The implemented first slice rejects advanced edits and successor versions after finalization. |
| Campaign activation | Derive required proof from durable provenance, not just token presence. Resolve current raw snapshot and enforce its expected token and existing eligibility. A protected plan missing the token fails closed. Retain existing schedule, autonomy, package, provider and consent gates. |
| Step execution authorization | `assertStepExecutionAuthorized` must check protected provenance and exact proof for the instance's pinned version, before any bounded-schedule early return. Do not use the Campaign's newer current version or rely only on activation having checked earlier. |
| Workflow/approval snapshot | Carry fingerprint-bearing immutable step inputs into the pinned version and exact step/campaign approval snapshot. No new approval bypass or reinterpretation of older workflow command histories. |
| Initial/retry publication admission | Under `PublishingRepository.admitPublication` locks, derive proof requirement from durable Campaign provenance, require the exact pinned step proof, and verify it against current raw preview/routing state before creating/claiming a new action. Both initial creation and failed retry must use this boundary. Preserve final fresh schedule checks after lock/conflict waits. |
| Router/preflight/request evidence | Carry the same token in the trusted request snapshot. Keep preflight account identity, credential/connection correlation, unchanged rendered content and no append/replace-link rules. Client-supplied request metadata is not proof. |

Publication admission currently locks instance, pinned version/steps, sorted runs, campaign approvals, then connection/content approvals/draft/version/preview/assets/Destination/link. Extend that existing transaction instead of introducing a competing partial lock order. The first finalizer forbids assets, but existing media paths must retain their protections.

Preserve recovery-before-new-dispatch behavior. An exact-lineage prior succeeded action must return its historical result even if its preview later changes; an ambiguous/dispatching action must require reconciliation, not be relabeled as clean fingerprint rejection or resent. Only new/retry dispatch authorization uses current fingerprint eligibility. A failed attempt or no recorded action is not permission to ignore current mutation. See [bounded scheduling contracts](SCHEDULING_CONTRACTS.md).

## Retry, compatibility and tamper boundaries

Normalize finalization intent on the server, including expected lineage, selected token, template/fingerprint versions, explicit schedule and copy-plan choices. Current writer authorization precedes receipt replay. An identical completed retry returns its original receipt and draft/version IDs even if the live preview has since changed; it does not create another version, restore an overwritten draft, reapprove, or reactivate. Different canonical intent under the same key conflicts. New attempts must pass current eligibility again.

Migration `0112_campaign_finalizations.sql` implements the completed immutable lineage/compiled-definition receipt and unique workspace retry key. Exact output-version and step-key/proof bindings remain outside editable inputs. Protection does not disappear through a cascading foreign key to mutable `campaign_step` rows. No mutable preview revision column or historical preview rewrite was added. Do not delete history to enforce staleness.

Legacy `saveCampaignDraft` edits a draft in place and deletes/reinserts its steps; after publication it can also create a wholly new draft from caller input. Thus optional step inputs, or protection attached only to the first finalized version, are insufficient. The implemented policy denies advanced editing when immutable finalization provenance exists, while retaining explicit publication, activation and cancellation. If continued editing is added later, every successor version must inherit protected provenance and every publication step must carry a valid new/reselected proof; enforce that in repository writes, activation and admission. The current result UI explains the edit restriction.

Deploy readers/admission/workers that understand and enforce v1 before exposing a finalizer that emits it. Only Campaigns without protected finalization provenance qualify for legacy proof-optional behavior; deleting a step token cannot regain that path. Retain v1 canonicalization while v1 receipts/plans remain usable. An unsupported future version must fail closed, not be read as v1. Do not advertise the UI before activation and publication enforcement are both integrated.

An old 1.22 worker ignores an added input token: deployment order alone is not a fence if old workers remain on the same task queue. Migration 0112 now requires a scoped transaction-local `market_me.exact_preview_admission` JSON marker for protected new/failed-retry dispatch claims and changed request snapshots; common admission sets it only after current locked proof. Token presence alone is insufficient. This fences incompatible old claim code but is not authority against a privileged SQL client that can set its own marker. The first rollout must still stop/drain or exclude incompatible workers/writers and verify compatible consumers before enabling finalization. Do not roll protected executions back onto incompatible binaries. Existing in-flight result settlement remains allowed.

A hash detects a change relative to retained expected bytes; it is not a signature, authentication credential, approval, or protection against a privileged database owner changing both snapshot and expected token. Workspace authorization, server-derived provenance, immutable version/receipt rules, provider preflight, and DB-role controls remain essential. Never log or fingerprint plaintext credentials. No new environment variable or background worker is required by the fingerprint itself.

## Acceptance before exposing finalization

- Fixed canonical vectors: object key ordering including numeric-looking keys, nested arrays, Unicode/escaping, unchanged whitespace and URL spelling, explicit nulls, size/depth limits, unsupported versions and no input mutation/getter execution.
- Raw JSON correctness: snake/camel mismatch remains distinct; unknown fields are retained; equivalent JSON object ordering yields one token; lossy large/decimal numbers fail the database round-trip guard.
- Full timestamp precision: six-digit observations/creation/expiry times; UTC invariance across database/session settings; no Date round trip; identical bytes across supported Node/runtime platforms.
- Mutation matrix: every included field changes the token; excluded health timestamps and display names do not. Subject/body/counts/capabilities/account identity/URL/UTM/expiry and same-ID preview recreation are covered.
- Eligibility: foreign workspace/generation/version, stale approval, inactive account, mismatched raw observation, attached preview, unsupported provider/method, expired link and manipulated stored render are rejected.
- Live races: both orderings of connection update, draft approval/revision, preview rewrite, attachment insertion, Destination/link mutation and Campaign edit; deterministic lock observation; no deadlock against publication or approval writers.
- Atomicity/retry: one immutable finalization result under concurrent identical requests, no partial version/audit/receipt after failure, changed-intent conflict, original-result replay after source/preview changes, and current membership required for replay.
- End-to-end enforcement: later preview mutation blocks activation and new/retry action admission, cannot be bypassed with raw content or dropped token, but cannot erase accepted or ambiguous provider history. Finalization itself creates zero instances, workflow commands, approvals and publication actions.
- Existing preview/media, approval, scheduler/replay, provider uncertainty and preparation suites must remain green, followed by browser review, production build and cloud CI. The focused results in the status section do not imply these remaining release gates have passed.
