# Exact Content Package review and approval

Status: implemented on the Release 1.24 development branch. Migration 0113 is frozen at SHA-256 `2431cf89e54705443eca1ca390aa082f6ecb51e0a6a5509769c1a4944e2c924f`; isolated live migration/rerun and the committed-1.23 upgrade rehearsal passed, while final full workspace, browser, native, cloud and publication evidence remain pending. This document describes the current source contract, not a production-readiness or full-product-completion claim. Branch metadata may identify 1.24 before those release gates are complete.

## Purpose and boundaries

A Content Package's numeric ingestion version does not identify everything a person reviews. Evidence corrections, conflict decisions, alternative text, malware-scan records and rights decisions can change without incrementing that version. Release 1.24 adds a server-captured, lossless review snapshot and content fingerprint, mandatory optimistic preconditions, immutable approval receipts and Learning Review decision proofs.

The intended sequence is:

```text
source ingestion -> coherent package review -> resolve blockers / reload
                 -> exact package approval receipt
                 -> draft generation / General Announcement preparation
                 -> reviewed draft and exact channel preview
                 -> Campaign finalization -> separate publish / activate / approve
```

Package approval is an attestation to captured content and its effective fact set. It does not approve a content draft, authorize an external account, publish a Campaign, start a workflow, send content, waive media rights or grant a higher autonomy mode. No provider request, credential decryption, source recipe, autonomous conflict resolution, recurring campaign or cold-outreach automation is added by this boundary.

Three concepts must remain separate:

| Concept | Meaning |
| --- | --- |
| `content_package.version` / `expectedVersion` | Numeric ingestion revision. Refreshing ingestion increments it; the four material review actions do not. |
| `reviewFingerprint` / `expectedReviewFingerprint` | Exact content snapshot identity, including same-version material changes. It is neither a signature nor permission. |
| `currentApprovalValid` | Current server evaluation of package state, blockers, current receipt and exact live content at `evaluatedAt`. It can become false through time alone, such as rights expiration. |

An immutable old approval remains readable after content changes. Replaying that receipt must never make changed content approved again. Existing generation and publication history is not rewritten to current source facts. See [evidence retention](EVIDENCE_RETENTION.md), [preparation](CAMPAIGN_PREPARATION.md) and [finalization](CAMPAIGN_FINALIZATION.md) for the preceding immutable contracts.

## Modules and exported interfaces

Paths in this section are relative to `packages/database/src/`. The package index exports the review models, fingerprint, evidence evaluator and repository. Loader and mutation helpers are module-level implementation interfaces; do not treat their transaction preconditions as optional.

| Module / API | Result and responsibility |
| --- | --- |
| `content-package-review-fingerprint.ts`: `validateContentPackageReviewSnapshot(input: unknown)` | Validates and returns a detached, deeply frozen `ContentPackageReviewSnapshotV1`. No I/O, clock, permission or semantic evidence decision. |
| `createContentPackageReviewFingerprint(input: unknown)` | Returns `{token, canonicalSnapshot, snapshot}`. Canonical text is the retained hash input; `snapshot` is the detached frozen value. |
| `content-package-reviewed-evidence.ts`: `evaluateReviewedEvidence(input: unknown)` | Returns frozen `{effectiveEvidenceIds, excludedEvidenceIds, blockers}` under `effective-evidence-v1`; malformed schema throws, semantic problems return blockers. |
| `content-package-review-loader.ts`: `captureContentPackageReviewInTransaction(tx, {workspaceId, packageId})` | Returns `CapturedPackageReview`, extending the fingerprint result with current `status` and nullable `currentApprovalId`. Caller must hold the package root lock. |
| `content-package-review-repository.ts`: `new ContentPackageReviewRepository(sql)` | Holds the database client, not a cached review or authorization decision. |
| `getReview(workspaceId, packageId, actorUserId)` | Current permission-checked transaction returning one coherent `ContentPackageReview`, or `undefined` for unavailable package scope. |
| `approve(input: ContentPackageApprovalInput)` | Atomic approval, returning `{approval, replayed, review?}`. New approval returns the resulting coherent review; completed replay deliberately need not load mutable current content. |
| `getApproval(workspaceId, approvalId, actorUserId)` / `getApprovalByKey(workspaceId, idempotencyKey, actorUserId)` | Current read-authorized, validated immutable receipt or `undefined`. Neither operation changes current approval. |
| `listApprovalSummaries(workspaceId, packageId, actorUserId)` | At most 50 current-read-authorized history summaries, newest timestamp then ID first. |
| `assertPackageReviewUuid(value)` / `assertPackageReviewExpectation(input)` | Validate exact references and mandatory version/token shape; not authorization. |
| `assertPackageReviewAccessInTransaction(tx, identity, mode = "read")` | Locks current membership and its ancestors for `read`, `write` or `approve`. |
| `lockContentPackageReviewInTransaction(tx, identity, mode = "share")` | Locks the workspace-scoped package root in `share` or `update` mode. Missing scope throws. |
| `loadContentPackageReviewInTransaction(tx, identity)` | Returns `{review, canonicalSnapshot}` after capture, evidence/receipt validation and fresh-time asset eligibility. Assumes the root is already locked. |
| `assertExpectedContentPackageReviewInTransaction(tx, expectation, mode = "write")` | Validates input, authorizes, locks root `UPDATE`, loads the review and compares numeric version and fingerprint. `mode` is `write` or `approve`. |
| `invalidateContentPackageApprovalInTransaction(tx, identity)` | Clears the current pointer, reevaluates the changed content and returns the coherent result. Caller owns authority and root `UPDATE`. |
| `insertLearningReviewProofInTransaction(tx, input)` | Inserts exact decision evidence in the caller's transaction; cannot independently authorize or complete an action. |
| `assertCurrentContentPackageApprovalInTransaction(tx, input)` | Internal consumer gate. Requires caller-owned authorization, takes package root `SHARE`, rechecks current approval, and returns `{approvalId, reviewFingerprint, snapshot, effectiveEvidence}`. |

`PackageReviewIdentity` is `{workspaceId, packageId}`. `ContentPackageReviewExpectation` adds `expectedVersion`, `expectedReviewFingerprint` and authenticated `actorUserId`. `ContentPackageApprovalInput` additionally requires a UUID `idempotencyKey`. The actor is supplied by the authenticated server, never trusted from a browser body.

`ContentPackageReview` contains the following fields together, not independently hydrated from other DTOs:

| Field | Intent / lifetime |
| --- | --- |
| `snapshot`, `version`, `reviewFingerprint` | One captured review and its numeric/content identities. Replace as a unit after every refresh or material response. |
| `status` | Current workflow state outside the fingerprint. Only `ready`, `needs_review`, `approved` are human-review states. |
| `effectiveEvidenceIds`, `excludedEvidenceIds` | Derived identity arrays from the captured evidence graph, not guessed text matches. |
| `blockers` | Current diagnostics `{code, message, evidenceId?, conflictId?, assetId?}`. The DTO uses representative IDs; the captured graph retains all references. |
| `evaluatedAt` | Fresh database UTC time with six fractional digits. It describes this evaluation, not a future permission lease. |
| `currentApproval` | Nullable summary of the current stored receipt; its presence alone does not mean valid approval. |
| `currentApprovalValid` | Exact receipt/content/state/eligibility result. New consumers must use the server gate, not this earlier browser boolean. |
| `historicalApproval` | True for a legacy `approved` flag with no exact receipt; explicitly not authority for new work. |

`ContentPackageApprovalSummary` carries `id`, `workspaceId`, `contentPackageId`, `contentPackageVersion`, `reviewFingerprint`, `createdBy`, `createdAt`. `StoredContentPackageApproval` adds `idempotencyKey`, `contractVersion: 1`, `evidenceContract: "effective-evidence-v1"`, ordered `effectiveEvidenceIds`, exact `reviewSnapshot` and `configurationHash`. Canonical internal intent text is not a required public field. Receipt reads validate their retained canonical text, hash, scope, version, contracts and effective identities before returning this DTO.

## Exact v1 fingerprint schema

Every field below is required, including explicit `null` values. `UUID` means a canonical lowercase, nonzero UUID with supported version/variant syntax. `UTCµs` means `YYYY-MM-DDTHH:mm:ss.ffffffZ`. `RawObject` means an ordinary JSON object validated as described below; it is not executable configuration or authority.

```text
ContentPackageReviewSnapshotV1 {
  schemaVersion: 1
  reviewContract: "content-package-review-v1"
  package: {
    id: UUID, workspaceId: UUID, smartSourceId: UUID, rootSourceItemId: UUID
    version: positive integer, title: string, confidence: number | null
    contextPackVersionIds: UUID[], createdAtUtcMicros: UTCµs
  }
  evidence: [{
    id: UUID, factKey: string | null, claim: string
    provenance: "observed" | "authoritative_context" | "inferred" | "unresolved"
    sourceReferences: string[], confidence: number | null
    contextPackVersionId: UUID | null, supersededByEvidenceId: UUID | null
    createdAtUtcMicros: UTCµs
  }]
  conflicts: [{
    id: UUID, factKey: string, candidateEvidenceIds: UUID[]
    status: "open" | "resolved" | "dismissed"
    resolutionEvidenceId: UUID | null, resolutionNote: string | null
    createdAtUtcMicros: UTCµs, resolvedAtUtcMicros: UTCµs | null
  }]
  assets: [{
    id: UUID, sourceItemId: UUID | null, sourceAssetId: UUID | null
    role: "original" | "supporting" | "derivative"
    fileName: string, mimeType: string, contentHash: string
    objectKey: string | null, byteSizeDecimal: string | null
    processingVersion: string | null, recipe: RawObject
    mediaStatus: "stored" | "processed" | "unsupported" | "failed"
    extraction: {
      status: "pending" | "completed" | "skipped" | "failed"
      text: string | null, error: string | null
    }
    scan: {
      status: "clean" | "infected" | "not_configured" | "failed"
      engine: string | null, scannedAtUtcMicros: UTCµs | null, revision: integer
    }
    accessibility: {
      altText: string | null
      status: "not_applicable" | "needs_review" | "approved" | "decorative"
      notes: string | null
    }
    rights: {
      status: "unchecked" | "cleared" | "restricted" | "expired"
      owner: string | null, licenseOwner: string | null
      sourceReference: string | null, proofReference: string | null
      commercialUseAllowed: boolean | null, derivativeUseAllowed: boolean | null
      worldwideUseAllowed: boolean | null, permittedChannels: string[]
      permittedChannelConnectionIds: UUID[], permittedCampaignIds: UUID[]
      permittedBrandProfileIds: UUID[]
      validFromUtcMicros: UTCµs | null, expiresAtUtcMicros: UTCµs | null
      attributionRequirement: string | null, watermarkRequirement: string | null
      disclaimerRequirement: string | null, reviewNote: string | null
      reviewedBy: UUID | null, reviewedAtUtcMicros: UTCµs | null, revision: integer
    }
    metadata: RawObject, createdAtUtcMicros: UTCµs
  }]
}
```

Nested exported types are `ContentPackageReviewPackageV1`, `ContentPackageReviewEvidenceV1`, `ContentPackageReviewConflictV1`, `ContentPackageReviewAssetV1` and `ContentPackageReviewRightsV1`. `ContentPackageReviewProvenance` is the four-value provenance union. `ContentPackageReviewRawJson` recursively permits null, booleans, finite numbers, strings, readonly arrays and readonly string-keyed dictionaries; `ContentPackageReviewRawJsonObject` is its object-only form.

### Field and collection semantics

- Package identities bind the exact workspace/source/root and ingestion revision. `contextPackVersionIds` retains original ordered version references, not a live expansion of Context Pack contents. `confidence` is recorded assessment, not proof of truth.
- Each evidence ID denotes one retained claim, its provenance, source-reference array, confidence and optional Context Pack version. `factKey` groups a fact concept; it is not interchangeable with evidence identity. `supersededByEvidenceId` is a forward replacement edge, not deletion of the original observation.
- Conflicts retain the ordered candidate identities and an explicit selected identity, note and decision time. Matching `factKey` or identical claim text never permits reconstruction of missing candidates or automatic winner selection.
- Asset identity includes source-item and source-asset lineage, original/supporting/derivative role, file name, MIME type, content hash and object-store key. The fingerprint includes these references and the complete extracted text/metadata/recipe, not the media blob itself.
- `byteSizeDecimal` preserves a PostgreSQL bigint without JavaScript integer rounding. `processingVersion` and `recipe` identify recorded processing choices; fingerprinting them does not execute or approve a recipe.
- Extraction status/text/error, scan status/engine/time/revision and accessibility text/status/notes are independent recorded assessments. They must not be silently replaced by current parent values while hashing history.
- Rights retain the exact owner/license/source/proof and human decision, nullable permission flags, provider list, exact account/Campaign/Brand scope arrays, validity window, obligations and revision. A nonempty scope ID is not proof of current provider access.
- SQL orders `evidence`, `conflicts`, `assets` and each rights relation array by UUID. Intrinsic arrays (`contextPackVersionIds`, `sourceReferences`, conflict candidates, permitted provider names) retain their stored order. The pure primitive preserves all arrays exactly; callers must not sort historical arrays differently on retry.
- The raw snapshot does not include `status`, `current_approval_id`, `updated_at`, `evaluatedAt`, UI labels for related records, signed preview URLs, live channel capability manifests or credentials. Current eligibility is a separate projection. Raw metadata can still contain sensitive application-supplied values; exclusion of a dedicated credential field is not a universal metadata sanitizer.

### Constants, limits and canonical bytes

| Export | Exact value |
| --- | --- |
| `CONTENT_PACKAGE_REVIEW_VERSION` | `1` |
| `CONTENT_PACKAGE_REVIEW_CONTRACT` | `content-package-review-v1` |
| `CONTENT_PACKAGE_REVIEW_DOMAIN` | `market-me:content-package-review:v1\n` (one actual trailing LF) |
| `CONTENT_PACKAGE_REVIEW_PREFIX` | `mm-package-review-v1:sha256:` |
| `CONTENT_PACKAGE_REVIEWED_EVIDENCE_CONTRACT` | `effective-evidence-v1` |

`CONTENT_PACKAGE_REVIEW_LIMITS` is frozen:

| Key | Limit |
| --- | ---: |
| `depth` (root depth zero) | 32 |
| `nodes` | 200,000 |
| `stringCodeUnits` (each string/key) | 1,048,576 |
| `canonicalBytes` (UTF-8) | 8,388,608 |
| `rawProjectionBytes` (loader) | 16,777,216 |
| `evidenceItems` | 10,000 |
| `conflicts` | 2,000 |
| `assets` | 1,000 |
| `contextPackVersions` | 1,000 |
| `candidatesPerConflict` | 1,000 |
| `sourceReferencesPerEvidence` | 1,000 |
| `scopeIdsPerAsset` | 10,000 across all three UUID rights-scope arrays combined |

The primitive also bounds each individual rights-scope array by `scopeIdsPerAsset` and `permittedChannels` by 20. Integer revisions are `0..2,147,483,647`; package version is `1..2,147,483,647`. Nullable confidence values must otherwise be finite numbers in `[0,1]`. Required content strings, including title, claim, non-null fact key, file name, MIME type and content hash, must contain non-whitespace content; validation does not trim the stored bytes. Byte-size strings are canonical unsigned decimal, at most `9223372036854775807`.

The hash is:

```text
canonicalSnapshot = canonical JSON serialization of validated detached snapshot
token = CONTENT_PACKAGE_REVIEW_PREFIX
      + lowercaseHex(SHA256(UTF8(CONTENT_PACKAGE_REVIEW_DOMAIN + canonicalSnapshot)))
```

Canonical serialization directly traverses UTF-16-sorted object keys, including numeric-looking keys, and serializes scalar strings/numbers using JavaScript JSON serialization. Arrays preserve order; there is no Unicode, URL, whitespace or alias normalization. No pretty printing, BOM or extra newline is added to canonical JSON. Negative zero follows JSON number serialization. Do not replace the traversal with a sorted object passed to `JSON.stringify`: integer-like property enumeration can change the intended order. This follows the JSON canonicalization approach also used by the separate exact-preview primitive; this implementation does not alter exact-preview v1 bytes or errors.

Descriptor-based detachment refuses proxies, getters/accessors, exotic prototypes, symbols, non-enumerable data, functions, bigint, undefined, sparse or augmented arrays, cycles, nonfinite numbers and unpaired Unicode. `toJSON` is not executed. Own `__proto__` keys are copied as data properties safely. A path-local `WeakSet` detects cycles; repeated noncyclic references are independently copied. Node/depth/serialized-byte counters bound work. No input object is mutated; returned nested objects/arrays and validation issues are frozen.

`ContentPackageReviewFingerprintValidationError.issues` contains `{field, code, message}`. Codes are `invalid_json`, `invalid_schema`, `unsupported_version`, `unsupported_contract`, `invalid_reference`, `invalid_timestamp`, `invalid_number`, `limit_exceeded`. Unknown schema fields are rejected; arbitrary valid JSON keys are retained only inside `recipe` and `metadata`.

### Raw SQL and precision boundary

`captureContentPackageReviewInTransaction` first bounds row counts and estimated raw row/scope bytes. It then uses a static, parameterized SQL projection to capture the complete package and child arrays in one coherent SELECT. Static `projection` and `utc(column)` expressions are module constants/application code, not caller SQL.

The projection returns JSONB as text to avoid recursive driver key camelization. It SQL-formats times as six-digit UTC, rejecting BC/infinity/out-of-range timestamp lookalikes; accepted years are Gregorian AD 0001–9999, real dates, seconds 00–59. It casts bigint sizes to decimal text. `JSON.parse` feeds the strict primitive, then PostgreSQL compares the **same captured raw JSONB** with the canonical result converted back to JSONB. Arbitrary-precision SQL numeric data that JavaScript would round is rejected as `review_snapshot_lossy`; the loader never rereads newer metadata as a substitute.

Never pass fingerprint times through `Date`, a locale formatter or a datetime-local minute control. Six-digit UTC strings have meaningful lexicographic ordering. Numeric JSON losslessness is a loader responsibility in addition to the pure finite-number validator. A package exceeding the complete supported projection fails closed; no partial/truncated snapshot receives an approval token.

## Effective-evidence rules

`evaluateReviewedEvidence` validates the entire raw schema, then builds per-call evidence/conflict maps, duplicate-ID sets, a supersession incoming-edge map, winner/loser maps and a deduplicated blocker map. Duplicate IDs are removed from identity maps rather than accepting a first or last row. Blocker keys combine code and sorted identity arrays for deterministic output; all returned ID arrays are sorted. These collections are local to one evaluation, not global learning memory.

1. Supersession must reference another evidence row in the same captured package. Self-edges, missing targets, more than one predecessor targeting a replacement, and cycles block approval. Iterative traversal avoids recursive stack growth at the 10,000-row bound.
2. An active row has `supersededByEvidenceId === null`. Every active `unresolved` row blocks, even if it also appears as a losing conflict candidate. A superseded unresolved observation may remain as history.
3. Every conflict must have nonempty, distinct, local, active candidates. Open and dismissed conflicts block. A resolved conflict must select one of those candidates, active and not unresolved.
4. Collect the union of all selected winners and all nonselected candidate losers. A winner in any conflict may not be a loser in another. There is no newest-conflict priority, iteration-order priority or text-equality fallback. Consistent overlapping conflicts choosing the same winner are valid.
5. Effective evidence is every active, non-unresolved row not in the losing union. At least one effective fact is required.

The closed blocker codes are `duplicate_evidence_id`, `duplicate_conflict_id`, `supersession_invalid`, `conflict_candidates_invalid`, `conflict_open`, `conflict_dismissed`, `conflict_resolution_invalid`, `conflict_decisions_inconsistent`, `unresolved_evidence`, `no_effective_evidence`. Exported types are `ContentPackageReviewedEvidenceBlockerCode`, `ContentPackageReviewedEvidenceBlocker` and `ContentPackageReviewedEvidenceResult`. The module's frozen `messages` dictionary maps those codes to diagnostics only; it carries no mutable learned policy. A semantic blocker causes `effectiveEvidenceIds` to be empty: the evaluator does not offer a partially trusted subset. `excludedEvidenceIds` records known excluded/superseded/unresolved identities, not an invented classification of every blocked row. Blockers carry sorted `evidenceIds`, sorted `conflictIds` and a diagnostic message.

The evaluator is not a truth verifier and does not check SQL membership, assets, rights, provider access or time. SQL migration 0113 independently derives effective identities for receipt/generation insertion; it does not replace the application's full strict schema/canonical validation.

## Current asset and lineage eligibility

`loadContentPackageReviewInTransaction` evaluates raw evidence and validates any current receipt before sampling `clock_timestamp()` for `evaluatedAt`. Only then does it apply the current asset permission window. The clock is intentionally absent from the hash: an unchanged snapshot can cease to be eligible when a right expires.

The current package-level checks are:

- Only `ready`, `needs_review` and `approved` package states are eligible. Other states add `package_state_ineligible`.
- A derivative's `sourceAssetId` must point directly to a different `original` asset in this same captured package, whose own source pointer is null. Foreign/missing/self references, chains/cycles and source pointers on non-derivatives add `asset_source_invalid`. The per-call `assetsById` map resolves identities; no live parent hydration rewrites the raw snapshot.
- Any asset marked accessibility `needs_review` blocks. An original image additionally requires `approved` with nonblank alternative text, or an explicit `decorative` decision.
- An original image needs `scan.status === "clean"`, a recorded engine and scan time, and revision at least 1. Otherwise `clean_scan_required` blocks.
- An original image needs cleared, revisioned, attributed rights: reviewer/time, owner, source reference, proof reference and review note; all three commercial/derivative/worldwide flags true; a supported provider and at least one exact permitted Channel Connection; no outstanding attribution/watermark/disclaimer obligation. Otherwise `rights_review_required` blocks.
- Current rights start must have arrived; expiration must be strictly later than the fresh database time and later than start. Blockers are `rights_not_yet_valid`, `rights_expired`, `rights_window_invalid`.

Supported review rights channels are the existing domain `CONTENT_ASSET_RIGHTS_CHANNELS`: `discord_webhook` and `mastodon_account`. Review does not add Slack/email media support. Scope IDs are checked against workspace/provider when rights are written; actual publishing still has its own current connection, capability, exact scope, content, media, rights and dispatch checks. Package approval is not blanket send permission for every recorded Campaign or provider.

Non-image assets do not acquire an invented universal image-rights or clean-scan gate merely because they appear in this snapshot. Media/extraction failures remain captured and visible; this layer is not a replacement for downstream media eligibility. Valid derivative lineage and approved package content do not prove object storage bytes were fetched, malware-scanned again or published atomically.

## Authorization, lock order and atomicity

| Mode | Current workspace roles |
| --- | --- |
| Read review/receipt/history | owner, admin, editor, approver, analyst, viewer |
| Asset accessibility/rights; generation/preparation writers | owner, admin, editor |
| Evidence correction, conflict resolution, package approval | owner, admin, approver |

Tokens, receipt UUIDs, a prior browser role and idempotency keys do not grant authority. Transactions lock organization `KEY SHARE`, workspace `SHARE`, actor `KEY SHARE`, then membership `SHARE`; revocation/deletion must serialize with the action. A completed approval replay still requires current approve permission; receipt GET permits current readers.

The package root is the serialization boundary. Ordinary material writers acquire root `UPDATE` before changing evidence, conflicts, asset metadata, scan/extraction/accessibility/rights or their scope relations. Review capture and new-work proof take root `SHARE`. This rule applies to any future scanner, extractor, derivative or background metadata writer; bypassing it can invalidate the multi-query bounds/projection/CAS guarantee. There is no claim that arbitrary privileged child SQL is automatically forced through these repository locks.

Do not add child locks to the consumer snapshot loader. Finalization holds Campaign/preparation before package and later locks a Channel Connection; publication holds Channel Connection before asset locks. Holding assets before acquiring a channel would create the opposite order. Root-only package proof reads keep this existing ordering compatible.

Rights review additionally prelocks submitted foreign-key targets **before** root `UPDATE`: sorted Campaign IDs `KEY SHARE`, sorted Channel Connection IDs `KEY SHARE` with matching workspace/provider, then sorted Brand Profile IDs `KEY SHARE`. It then checks the exact package precondition and locks the original image. This avoids late FK upgrades/commit waits reversing finalization's Campaign-before-package order. Rights scope relations are replaced in fixed connection, Campaign, Brand order. Conflict resolution locks sorted candidate evidence then conflict; correction locks its original evidence then sorted affected conflicts, always after root `UPDATE`.

These functions use the caller's transaction or a single repository `sql.begin`. Their SQL writes, receipt/proof, current status/pointer and audit either commit together or roll back. Database FK/trigger errors are not permission to retry with proof removed. No process-level mutable review cache, authorization cache, background lease or external transaction coordinator is introduced by 1.24. Its one transaction-local approval admission marker is described below. The existing 1.23 transaction-local publication compatibility marker remains a separate finalization mechanism.

## Approval idempotency and immutable storage

Approval intent is fixed-key server JSON:

```json
{"contract":"market-me:content-package-approval:v1","workspaceId":"<uuid>","packageId":"<uuid>","expectedVersion":1,"expectedReviewFingerprint":"mm-package-review-v1:sha256:<64 lowercase hex>"}
```

`configuration_hash` is SHA-256 of the UTF-8 intent text, without the content fingerprint domain prefix. The UUID attempt key and actor are not intent fields. Equality compares full canonical input text, not just its digest. A transaction-scoped advisory lock on `hashtextextended("package-approval:<workspace>:<key>", 0)` serializes the workspace/key, backed by a unique constraint. Hash collisions can only serialize unrelated attempts, not merge their identities.

After current authorization, `approve` checks the completed receipt **before** mutable current package eligibility. Same key/same intent returns the original validated receipt (`replayed: true`) even after later source edits. Same key/different intent throws `idempotency_conflict`, optionally identifying `existingApprovalId`. A different key can record another explicit attestation to identical content; there is no unique-by-content rule and no automatic reuse of a new key for response-loss recovery.

For a new key, approval takes root `UPDATE`, requires exact numeric version and fingerprint and zero blockers, then inserts Learning Review, approval receipt, decision proof, current pointer/status and minimized audit in one transaction. New approval/Learning Review creation times use `clock_timestamp()` rather than transaction-start time. It reloads current eligibility at a fresh database time near completion and rejects if permission expired during waits. This is an evaluation boundary, not a guarantee that time cannot advance between evaluation and commit or a lease on future execution. Downstream new-work checks sample time again.

Immediately before receipt insertion, the repository sets `market_me.content_package_approval_admission` using `set_config(..., true)` on the same transaction. Its JSON object is exactly `{approvalId, workspaceId, contentPackageId, version, reviewFingerprint, configurationHash, createdBy, learningReviewId}`. The receipt trigger requires exact object equality with the new row. The actor is the `createdBy` value; all other identities/hash values are the already validated server values. The marker is transaction-local, expires on commit/rollback and must never be set with session scope on a pooled connection. It is a compatibility/rollout fence against missing or mismatched old-writer admission, not a secret or an authorization grant against privileged or same-role arbitrary SQL.

### Migration 0113 tables and columns

`0113_content_package_approval_receipts.sql` is additive to frozen 0110–0112; do not modify those older migrations or recanonicalize their receipts.

| Table / columns | Purpose and constraints |
| --- | --- |
| `content_package_approval.id` | Immutable UUID receipt identity. |
| `workspace_id`, `content_package_id`, `content_package_version` | Exact workspace/package/revision lineage; positive revision. Workspace cascade; package reference restricts unsupported isolated erasure. |
| `idempotency_key` | UUID attempt, unique with workspace. |
| `contract_version`, `evidence_contract` | Exactly `1` and `effective-evidence-v1`. |
| `review_fingerprint`, `canonical_review_snapshot` | Token and retained canonical text; SQL recomputes the domain-separated digest. Snapshot UTF-8 length 2–8,388,608 bytes. |
| `effective_evidence_ids` | Exact sorted effective UUID array, cardinality 1–10,000, independently rederived from retained evidence/conflicts. |
| `canonical_input`, `configuration_hash` | Original approval intent text (2–65,536 bytes) and checked SHA-256 hex. |
| `created_by`, `created_at`, `learning_review_id` | Human actor, persisted decision time and unique matching Learning Review action; no inferred historical approver. |
| `content_package.current_approval_id` | Nullable FK hint to current receipt, constrained to same workspace/package/version. Not sufficient without current exact revalidation. |
| `draft_generation.content_package_approval_id` | Nullable only for pre-contract history; every new generation requires exact receipt provenance. This is a column, not a separate generation sidecar table. |
| `learning_review_proof.learning_review_id` | PK and FK to the decision, with cascade for authorized parent lifecycle. |
| `learning_review_proof.workspace_id`, `content_package_id`, `content_package_version`, `action` | Exact decision lineage. SQL action set includes `accepted`, `rejected`, `corrected`, `conflict_resolved`, `package_approved`; current writers here emit the latter three. |
| `before_review_fingerprint`, `after_review_fingerprint` | Content identities before and after the decision. Approval has equal before/after values because approving changes state, not snapshot content. |
| `decision_snapshot`, `created_at` | Retained raw JSONB object of exact affected evidence/decision context, SQL text size 2–16,777,216 bytes, and proof creation time. |

The approval package/time index supports history lookup. Snapshot evidence/assets/rights references remain embedded historical values rather than new FKs to every live child; source refresh can replace those children without erasing the proof.

### Trigger and history semantics

- `content_package_review_effective_evidence(snapshot)` independently checks bounded evidence/conflict identity, local active candidates, supersession reachability and winner/loser consistency; invalid/unresolved returns null, empty is ineligible. Its indexed JSON dictionaries avoid repeated full scans for every edge.
- `content_package_approval_generation_evidence(snapshot, effective_ids)` projects exactly the approved facts for generation. Order is `createdAtUtcMicros`, then UUID; fields are `id`, `claim`, `provenance`, `sourceReferences`, explicit nullable `confidence`, plus `factKey` only when non-null.
- `content_package_approval_receipt_guard` rejects receipt UPDATE, requires the exact transaction-local admission marker and validates insert scope/version/effective IDs/intent and matching package-approved Learning Review actor. Table checks enforce content and intent hashes. Application receipt reads additionally enforce canonical bytes and the complete v1 schema.
- `content_package_current_approval_guard` refuses a current pointer with another workspace/package/revision.
- `learning_review_proof_guard` rejects proof UPDATE and validates decision lineage; package approval proof must match its linked receipt with equal before/after tokens.
- `learning_review_requires_proof` is an initially deferred new-row constraint: Learning Review, receipt and proof may be inserted in that order, but a surviving new decision must have proof at commit.
- `learning_review_proved_history_guard` refuses changes to every new or legacy decision row. It permits only the live `evidence_item_id` becoming null when a source refresh removes that row, never retargeting it to another ID. Immutable decision JSON retains original evidence for proved rows.
- Initially deferred `learning_review_proof_delete_guard`, `content_package_approval_delete_guard` and `learning_review_delete_guard` prevent erasing or replacing proof, receipt or decision while the owning workspace survives. This includes delete/reinsert, parent-ID retargeting and coordinated package/history erasure. Deferral permits only authorized whole-workspace/organization cascades regardless of FK trigger order; reviewed packages are archive-only until a future explicit retention design says otherwise.
- `draft_generation_package_approval_guard` requires a current same-lineage exact receipt and the exact approved evidence projection for each new generation. Proof-bearing generation contents are immutable, and `draft_generation_proved_delete_guard` prevents their deletion while the workspace survives. A legacy null proof cannot be promoted later to an invented historical approval.
- `campaign_preparation_package_approval_guard` requires the new preparation's generation/current package receipt and exact `reference_snapshot.contentPackage` approval ID/token pins.
- `campaign_finalization_package_approval_guard` requires the preparation's original generation approval and current approved package content to agree in scope/version, token, canonical snapshot and effective IDs. An identical-content reapproval may have a different receipt ID.

These guards validate application persistence and old-writer compatibility; they do not independently rederive every live asset/child byte or enforce human workspace authorization. Locked live repository validation is authoritative. Receipt/effective-evidence checks validate retained facts, while current-pointer/generation triggers assume a trusted application database role. A caller able to execute arbitrary SQL as that same role can also set a custom GUC; neither the marker nor a matching hash defeats that threat. The guards are also not protection against a database administrator disabling triggers, changing schema or issuing privileged destructive operations. Retention policy and authorized workspace destruction remain operational responsibilities.

## Material review actions and invalidation

All four public `MarketMeRepository` review methods now delegate to `content-package-review-mutations.ts` and require the displayed version/fingerprint. They return `ContentPackageReview | undefined`, not a refreshed legacy `StoredContentPackage`. Missing scoped eligible asset/evidence/conflict returns undefined; stale preconditions and blocked actions throw typed errors. No public optional-precondition bypass is available.

| Wrapper / mutation | Inputs and behavior |
| --- | --- |
| `updateAssetAccessibility` / `updatePackageAssetAccessibility` | Expectation plus `assetId`, `decorative`, optional `altText`, `notes`. Only original images; informative image needs nonblank text, decorative stores null alt text. |
| `reviewAssetRights` / `reviewPackageAssetRights` | `ContentAssetRightsReviewWrite` plus authenticated actor. Exact expectation/asset, `cleared` or `restricted`, owner/license/source/proof/note, three booleans, provider/scope arrays, optional validity window and obligations. Locks and validates exact referenced scope, increments rights revision and captures reviewer/time. |
| `resolveEvidenceConflict` / `resolvePackageEvidenceConflict` | Expectation plus `conflictId`, selected `evidenceId`, optional note. Only an open conflict and exact local active usable candidate. Rejects contradictions with existing resolved winners/losers before any write. |
| `resolveUnresolvedEvidence` / `resolvePackageUnresolvedEvidence` | Expectation plus active unresolved `evidenceId`, `correctedClaim`, optional note. Inserts a distinct authoritative replacement and supersedes the original; does not rewrite the old claim. |

Every action first refuses package states outside `ready|needs_review|approved` with `review_blocked`, without writes, invalidation or audit. It cannot reset an executing/completed/failed/ingesting package into a human-review state. After a permitted material action, the current approval pointer is cleared and status becomes `needs_review`; when the resulting complete review has zero blockers it becomes `ready`. It does not automatically become approved. Numeric ingestion version stays unchanged, but content fingerprint captures the material edit. Even a repeated explicit review action must not preserve old approval merely because some submitted fields match.

Conflict resolution preflights all already resolved overlaps: reject a proposed selected ID already excluded elsewhere, or any proposed loser already selected elsewhere. The conflict remains open on rejection. Consistent repeated selection across overlaps is allowed. Its decision proof records `contract: "content-package-review-decision-v1"`, `selectedEvidenceId`, exact `candidateEvidence`, `beforeConflict`, `afterConflict`.

Unresolved correction creates a new UUID row with the original fact key, corrected text, `authoritative_context`, confidence 1 and `sourceReferences: ["learning-review:<learningId>"]`. It replaces that exact old ID in every affected conflict candidate array, reopens those conflicts and clears their prior selection/note/time. The proof records original/corrected IDs, before/after evidence for affected candidates, and before/after conflicts. Subsequent decisions must review those reopened conflicts. No claim-text matching, all-current-evidence fallback or guessed supersession mapping is used.

Input text bounds are narrower than the raw snapshot maximum: alt text/accessibility notes/conflict notes up to 2,000 code units; corrected claim 1–5,000; owner/license owner up to 200; source/proof references 3–1,000; review note 3–2,000; obligations up to 1,000. Submitted scope arrays are at most 100 each, deduplicated and UUID-sorted; provider list at most 20. Permission flags must be actual booleans, not string truthiness.

`normalizePackageReviewRightsInstant` accepts a real AD 0001–9999 RFC3339 timestamp with `Z` or explicit offset and zero to six fractional digits. It normalizes with explicit Gregorian/offset arithmetic to six-digit UTC, not `Date`; malformed dates, leap seconds, out-of-range offsets and UTC year overflow fail. Undefined means no bound. SQL binds normalized values through `::text::timestamptz`, avoiding driver timestamp inference that could round microseconds. Cleared rights must currently be valid, have all required permissions/exact accounts, and have no outstanding obligations. Expiration is sampled again after scope/audit work before returning; expiry rolls the transaction back.

### General audit versus exact retained proof

General `audit_event.data` is intentionally minimized. Accessibility events retain before/after fingerprint and status, decorative flag, alt-text length and whether notes exist—not raw alt text or notes. Rights events retain tokens, statuses/revisions, permission booleans, scope counts and presence/obligation flags—not owner/license/proof/note text, exact scope arrays or validity strings. Conflict/correction audit events retain decision IDs and before/after tokens rather than duplicating the full claims. Approval audit retains receipt ID, version, token and effective-evidence count; the exact identity array remains in the immutable receipt/proof.

Exact evidence belongs in immutable approval canonical snapshots and Learning Review decision proofs. Accessibility/rights actions do not create an invented Learning Review action or full arbitrary before/after history row; a subsequent approval retains the resulting full review, and an earlier approval retains its own prior captured fields. Do not expand broad operational logs with that private content. Equally, do not redact or normalize retained proof in place while pretending its original fingerprint still verifies.

### Ingestion writers

`saveContentPackage` cannot accept `approved` as an ingestion state. It validates source/root workspace lineage, obtains the actual upserted package identity, increments the existing numeric revision, clears current approval and replaces live child rows under the root writer lock. Concurrent first ingestion must use the returned actual root, not a losing generated UUID. Existing immutable approval, Learning Review and generation evidence history stays distinct from the new rows. New scan/accessibility/rights/derived-asset writers must preserve this root-lock and invalidation discipline.

## Generation, preparation, finalization and recovery

The internal consumer gate takes root `SHARE`, loads current exact review and requires matching numeric version, any supplied content pin, zero blockers and valid current approved receipt. It returns retained effective evidence, sorted by microsecond creation time then UUID. Authorization must already be held by the caller. Its optional token parameter supports internal original-receipt comparison; it is not a public no-token generation path.

`DraftRepository.generate` requires `expectedPackageVersion` and `expectedReviewFingerprint` at runtime. `generateDraftsInTransaction` requires exact Campaign version and `expectedContentPackageVersion`, and also refuses an absent review token. Some TypeScript input properties remain optional for compatibility/error reporting; omission is not accepted authority. The exact published/superseded Campaign version must belong to the workspace/Campaign and bind the package. New generation stores `content_package_approval_id` and only the approved effective evidence projection, with explicit nullable confidence and stable ordering before generator ranking. Existing two-pass immutable per-claim linkage from 0110 remains unchanged. Existing draft review/approval and channel-preview steps remain separate.

`CampaignPreparationRepository.prepare(input, key, actor, {expectedReviewFingerprint})` retains General Announcement compiler v1 canonical configuration unchanged. New requests require the exact token separately; the preparation reference snapshot adds `contentPackage.approvalId` and `contentPackage.reviewFingerprint` to its existing ID/title/version. Its exact generation pin and all initial variant IDs remain atomic. Completed new-format replay requires the same canonical compiler settings and original review token, then returns the original receipt without reevaluating changed source/profile content. Completed legacy receipts without these new fields retain their prior recovery behavior; they are not upgraded to proof-bearing receipts. The browser distinguishes its new saved-attempt format from legacy recovery-only attempts.

Before **new** finalization, the selected preparation's exact generation must have its original package approval. A pre-contract generation produces `historical_approval_unavailable`: review the current package and prepare a new Campaign; do not attach a guessed old approval. Finalization checks current package revision, full fingerprint and canonical bytes against the original approval while retaining current profile/preview/rights gates. Another receipt approving byte-identical content is allowed without rewriting original provenance. Changed source, same-version facts, rights or accessibility require new reviewed preparation rather than replacing the original generation's evidence. The additive 0113 insert trigger enforces corresponding stored lineage independently of the application path.

Completed preparation/finalization replay remains before mutable eligibility checks and retains its original IDs and content. Existing draft history/revision paths keep their immutable-generation behavior. This release does not add live-package checks to each existing provider action or rewrite accepted external success as failure because source content later changed. Publication proof, approval, account/rights checks and success/ambiguous recovery remain governed by [finalization](CAMPAIGN_FINALIZATION.md) and [scheduling contracts](SCHEDULING_CONTRACTS.md). Never create new unproved work as a workaround for a recovery failure.

## API and UI contract

Release 1.24 exact-review API calls use explicit workspace identity and current authenticated access. Bodies are strict; callers cannot provide a trusted snapshot, actor, current-approval flag or authority override. `readReviewJson` streams at most 65,536 bytes, uses fatal UTF-8 decoding and rejects malformed/oversized bodies through validation. Mutations require exact allowed `Origin` against trusted `APP_BASE_URL`; missing/mismatched origin returns `origin_forbidden` 403. Exact-review responses set `Cache-Control: no-store`, and their unknown or duplicated query parameters are rejected. The established package-detail GET remains a separate compatibility route with its previous active-workspace fallback and response shape.

| Route | Request / result |
| --- | --- |
| `GET /api/v1/content-packages/:id?workspaceId=...` | Established v1 `{data: StoredContentPackage}` detail contract. Release 1.24 preserves this route and its active-workspace fallback for existing clients; it is not an exact approval snapshot. |
| `GET /api/v1/content-packages/:id/review?workspaceId=...` | `{data: ContentPackageReview}` from one captured review; explicit workspace is mandatory and unavailable scope is 404. This is the review/precondition endpoint for new callers. |
| `POST /api/v1/content-packages/:id/approve` | `{workspaceId, expectedVersion, expectedReviewFingerprint, idempotencyKey}`. New 201 or replay 200: `{data: approval, review?, meta: {replayed}}`. |
| `GET /api/v1/content-packages/:id/approve?workspaceId=...` | Latest up to 50 approval summaries. |
| Same GET with `idempotencyKey` **or** `approvalId` | Exact immutable receipt, additionally checked against the route package/workspace. A 404 means no completed receipt found yet, not proof an earlier in-flight request was canceled. |
| `POST .../:id/conflicts/:conflictId/resolve` | Common precondition plus selected `evidenceId`, optional note; coherent changed review. |
| `POST .../:id/evidence/:evidenceId/resolve` | Common precondition plus corrected claim, optional note; coherent changed review. |
| `PATCH .../:id/assets/:assetId` | Common precondition plus alternative text/decorative decision/notes. |
| `PUT .../:id/assets/:assetId` | Common precondition plus exact rights decision fields and scopes. |

Common precondition is `{workspaceId, expectedVersion, expectedReviewFingerprint}`. Browser/API UUID syntax normalizes hex case to lowercase; canonical fingerprint bytes never normalize caller snapshot data. Rights time inputs preserve raw fractional precision and explicit offsets until the repository's lossless normalizer. Campaign preparation and draft-generation APIs also carry required review pins; they must not substitute a token fetched independently of the selected displayed package version.

The package page renders captured facts, effective/excluded identities, conflicts, assets, lineage, accessibility, scan and rights fields, with expandable extracted text/recipe/raw metadata. It does not combine a new token with a legacy `StoredContentPackage` body. Related account/Campaign/Brand labels are separately fetched editing choices, not fingerprint authority. Signed derivative image previews are presentation-only, associated with captured asset ID/hash; they are not persisted inside approval proof. The historical receipt page uses the retained snapshot only and states that it is not current permission. A complete unsupported/lossy/oversized review shows an unavailable state without a partial token.

Client approval recovery uses `PackageApprovalAttempt = {version: 1, userId, idempotencyKey, input: {workspaceId, packageId, expectedVersion, expectedReviewFingerprint}}`. It is stored in tab-scoped `sessionStorage` at `market-me:package-approval:v1:<user>:<workspace>:<package>` **before** sending a new approval. Storage failure blocks sending. Scope mismatch/corruption does not silently discard the attempt. `packageApprovalRequest` resends only the saved key and exact old precondition, never today's newly fetched token.

The component's `attempt`/storage-error state freezes new material actions; `inFlight` prevents overlapping submissions, `pending` drives controls, `needsRefresh` prevents reuse after an uncertain/stale material response, and `confirmed` is reset with each coherent replacement. Response-loss recovery can check the original key or retry it; it does not automatically mint another key. Explicitly clearing the browser recovery copy requires acknowledgment and reload and neither deletes a server receipt nor cancels an earlier request. Material actions have no equivalent automatic replay loop: an uncertain response requires reloading current content before deciding whether another edit is needed. Role-based controls are usability only; server roles are authoritative.

### Errors and caller behavior

`ContentPackageReviewError` exposes `code`, `message`, `blockers` and optional `existingApprovalId`.

| Code / family | Review API status | Required interpretation |
| --- | ---: | --- |
| `invalid_review_input` | 422 | Malformed/unsupported input or stored review shape; do not coerce missing pins. |
| `review_snapshot_too_large`, `review_snapshot_lossy` | 422 | Complete exact representation unavailable. Split/correct source data; no truncated approval fallback. |
| `access_denied` | 403 | Current role/scope unavailable, including completed replay. |
| `package_unavailable`, `approval_unavailable` | 404 | Requested scope or current exact attestation unavailable in this route's error mapping. |
| `package_version_mismatch`, `review_changed` | 409 | Reload and review the new coherent content before making a new decision. |
| `review_blocked`, `conflict_not_open` | 409 | Resolve eligible review state/blockers or reload a decided conflict; do not retry blindly. |
| `historical_approval_unavailable` | 409 | Retained proof is invalid/missing for the requested new operation. Preserve history and create a new reviewed path where appropriate. |
| `idempotency_conflict` | 409 | Key belongs to different intent; inspect original receipt rather than overwriting it. |

Routes may also return `not_found`, origin errors, authentication responses and generic server errors. Draft generation wraps review failures in `DraftValidationError.issues`; preparation/finalization retain the corresponding review code in their error unions. Database invariant violations are not necessarily these friendly application errors and must be investigated without disabling guards.

## Deployment, compatibility and rollback

Migration 0113 is a **stop-the-world, forward-only writer migration**, not a rolling mixed-writer upgrade. Drain/stop 1.23 web mutation traffic and all ingestion, Learning Review, generation, preparation and finalization writers; apply the reviewed migration; deploy the matching 1.24 writers/readers/UI; validate readiness and representative exact-review/new-work/recovery paths; only then reopen writes. Include background workers and queued work that can write these tables, not only the visible web server. The frozen source checksum is `2431cf89e54705443eca1ca390aa082f6ecb51e0a6a5509769c1a4944e2c924f`; isolated QA verified exactly 113 applied migrations, 133 public base tables and a second runner pass that skipped all 113 unchanged.

Post-migration old Learning Review writers omit required immutable proof; old generation writers omit receipt provenance; old preparation/finalization writers cannot create new unproved lineage. A receipt writer also needs the exact transaction-local admission marker. They fail closed. This prevents accidental old-format acceptance, but intentional failure is not a zero-downtime compatibility promise. A code-only rollback to 1.23 while retaining 0113 is unsafe for ordinary writes. Do not drop guards, null proof pointers, edit checksums or fabricate historical approvals to make it work. Prefer a forward repair; any complete database restore must be a coordinated recovery that accounts for all newer decisions and external publication outcomes.

The migration does not fabricate an approval for existing `status='approved'` packages or add proof to historical Learning Review rows/generations. Legacy null generation proof stays null. Users must explicitly review/approve current supported content for new generation/preparation, and create new preparations when legacy unfinalized lineage cannot prove its original package approval. Existing completed receipts and accepted publication recovery remain recoverable subject to current access and their original contracts. Old 0111/0112 canonical configuration and receipts are not rewritten.

New canonical contracts must use explicit new version/domain/prefix and reader support; do not silently change v1 field ordering, nullable shape, timestamp precision, evidence rules or historical bytes. Deploy consumers/writers consistently before admitting new proof formats. The 1.23 exact-preview/GUC boundary remains separately documented and must not be weakened as part of package-review rollout.

## QA and release evidence

Recorded development checks for this slice: 146 pure fingerprint cases, 34 effective-evidence cases, 78 mutation-helper cases, and 134 unchanged exact-preview fingerprint cases passed (392 distinct cases in that focused run); database TypeScript checking passed. Frozen 0113 passed transactional rollback probes for admission, immutable-history bypasses, legacy-row protection, workspace/organization cleanup and 10,000-evidence/2,000-conflict upper bounds, then isolated QA applied all 113 migrations into 133 public base tables and reran with all 113 checksums skipped unchanged. A genuine committed-1.23 database upgraded successfully with exact legacy byte/provenance pins and completed recovery behavior preserved. The live exact-approval suite passed 17/17, including both root-lock orderings and membership revocation, with zero fixture users/packages or tagged backends left; repositories integration passed 7/7. The browser helper rejected an unknown command before database configuration, and a live PostgreSQL probe placed concurrent `seed` and `clean` processes behind one held fixture lock: both showed advisory waits, the second queued behind the first, no marker row appeared while blocked, and the error path released the lock for its successor. A subsequent successful seed/clean restored the exact non-fixture baseline with no lock session left. This is point-in-time pre-release evidence, not the final integrated release count. Mutation coverage includes 39 lossless timestamp cases, 36 human-review-state guards and three overlap-admission cases. Final full workspace, browser, cloud CI and native release acceptance is not asserted here yet.

Relevant test sources include:

- `content-package-review-fingerprint.test.ts`: fixed canonical/hash vectors, every material field, raw keys/numeric-key order, Unicode, nulls, resource bounds, hostile descriptors, mutation/no-input-mutation and old-preview compatibility.
- `content-package-reviewed-evidence.test.ts`: duplicates, missing/cyclic/merged supersession, open/dismissed/invalid candidates, unresolved active rows, overlapping winner/loser contradictions, stable output and large chains.
- `content-package-review-mutations.test.ts` and `repositories.integration.test.ts`: exact rights time arithmetic, fail-closed package states, contradictory/consistent overlap decisions, mandatory preconditions, changed review DTO and mutation invalidation.
- `content-package-review.integration.test.ts`: 17 executed live capture/history/retry, legacy-flag, in-place edit, raw JSON/number/bigint precision, asset-lineage, ingestion-scope and deterministic lock-race cases. The targeted pass against frozen 0113 does not replace the final full workspace gate.
- Consumer/SQL guard suites: require exact new generation evidence/order, receipt lineage, immutable proof/update/delete behavior, old-writer rejection, legacy completed replay, changed package rejection and identical-content reapproval. Run the current full database suite after migration freeze; retain deterministic lock-order, revocation, same-key concurrency, expiry and rollback checks as release gates.
- Web request/route/page/view tests: strict preconditions/origin/body limits, roles and scope, snapshot-only display, immutable receipt retrieval, precision-preserving rights values and saved-attempt response-loss recovery.

Run integration checks only against a specifically provisioned synthetic database such as `market_me_qa_<slice>` or `market_me_ci`, never the default development/app database. The new review integration suite refuses other names and skips without `DATABASE_URL`; a skipped suite is not a live pass. Apply migration via the repository migration runner after freeze, not by editing its stored checksum. The browser `qa:governed-drafts` helper accepts only `seed`, `bridge`, or `clean`, requires `market_me_qa_*`, and holds one fixture-specific session advisory lock across each complete multi-transaction command. It deletes its dedicated organization but retains the shared synthetic developer actor; repository-test fixtures delete their own organization and actor. Do not directly delete protected receipt/proof history to evade deferred guards. Review FK/deferred failures at transaction completion as well as immediate statements.

Typical targeted commands, with an explicitly approved isolated database configured for live cases, are:

```text
npm run typecheck --workspace @market-me/database
npm run test --workspace @market-me/database -- src/content-package-review-fingerprint.test.ts src/content-package-reviewed-evidence.test.ts src/content-package-review-mutations.test.ts src/exact-preview-fingerprint.test.ts
npm run test --workspace @market-me/database -- src/content-package-review.integration.test.ts src/repositories.integration.test.ts
```

Final full-suite/build/browser/native/cloud results belong in [release history](RELEASES.md) and the release owner's checkpoint once actually observed. Deployment and runtime configuration remain in [development](DEVELOPMENT.md) and [security](SECURITY.md).

## Privacy and security caveats

Snapshots intentionally retain claims, source references, extracted text, object keys, raw metadata, rights proof/owner/notes and scope identities needed to explain the human decision. Treat them as private workspace data in database access, backups, exports, retention and support tooling. `no-store` reduces HTTP caching; it does not encrypt the database or browser. Receipt/token/key possession is not a bearer authorization mechanism. Session recovery stores identity and intent/token, not a copy of the whole source snapshot, and still deserves normal browser/session protection.

All source text/metadata is untrusted data, not instructions, executable HTML, SQL or provider configuration. A matching SHA-256 proves equality to recorded bytes, not factual accuracy, copyright ownership, clean remote content or an authorized publisher. Scan/rights records are checked as recorded claims; provider/media boundaries still need their own current checks. Preserve the exact proof needed for accountability while keeping broad audit/console logs minimized. Production retention, access reviews, backup/restore rehearsals, legal permission verification and secure infrastructure are separate operational work, not implied by this release.
