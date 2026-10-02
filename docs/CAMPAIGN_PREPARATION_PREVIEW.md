# Read-only campaign and draft preview

Release: 1.44.0 candidate. Acceptance/publication evidence belongs in [Releases](RELEASES.md), not in this contract. [Plan](CAMPAIGN_PREPARATION_PREVIEW_PLAN.md) records the scope derived from specification sections 01, 10 and 23.

## Product behavior and limits

The existing Prepare campaign form offers **Preview campaign and drafts** after the user loads the exact current approved package review. It displays normalized General Announcement settings, optional current published Brand, ordered Audiences and published Destination context, the single manual review step, actual channel-neutral draft copy and approved evidence citations. No audience selected yields one General variant. The view is unsaved: nothing is approved, activated, scheduled or sent.

Preview creates no Campaign, generation, draft, receipt, audit, reservation, execution command, tracked link or provider request. It does not select an account, attachment or schedule. A Destination remains context, not an inserted link or publishing identity. Source references are escaped text, never automatically followed. Approved evidence is not independent verification of source truth. The deterministic generator does not provide semantic or multimodal analysis.

Saving remains the separate existing preparation operation. It revalidates current actor membership, package approval and profiles; preview is not a lease. A later source/profile change can invalidate preparation. Changes elsewhere cannot be pushed into an already displayed point-in-time preview; a fresh preview or preparation rechecks them.

## Backend functions and collections

- `CampaignPreparationRepository.preview(input, actorUserId, options)` uses the existing pure `compileGeneralAnnouncementPreparation`. `configuration` is normalized input and `compiled.campaign` its fixed draft-only plan. Unknown/unsupported input retains existing compiler rejection behavior.
- `CampaignPreparationOptions.expectedReviewFingerprint` is required for new previews. Optional `expectedApprovalId` is an internal exact-receipt pin, not accepted in the public envelope. No idempotency key is accepted or generated.
- In one transaction, `lockWriter` takes existing ancestor/current writer locks; `lockReferences` locks the exact package approval and current profile/destination rows. It now returns `{referenceSnapshot, approval}` so preparation and preview share reads. Stored receipt snapshot shapes are unchanged.
- Profile roots precede versions. Audience roots/versions lock in stable ID order; a request-local `Map` restores authored order. Locks remain through preview completion. Tests force each membership/package/Brand/Audience/Destination revocation to win and lose the race and prove later saving never inherits preview authority.
- `CampaignRepository.validateReferencesInTransaction(tx, campaign)` exposes existing graph/reference/communication-ceiling validation. It does not authorize an actor or create rows; callers establish authority and lock references. Durable Campaign creation retains independent validation.
- `approvedDraftEvidence(items)` copies/sorts exact effective evidence by microsecond creation timestamp and ID. `usable` preserves claim/provenance/source references and non-null optional fact/confidence/context IDs; `snapshot` preserves historical nullable confidence used by generations. Neither mutates the approved array.
- `generateGroundedDraftVariants(input, audiences)` is shared pure generation. Input excludes per-variant `audience` and `characterBudgetAudienceName`. The readonly ordered audience list supplies names/profiles; the longest name sets the common character budget. Empty audiences produce one General draft; otherwise the helper maps every audience through existing `generateGroundedDraft`, returning a readonly array.
- Durable `DraftRepository.generateDraftsInTransaction` uses that same evidence/variant path before its generation insert. Subsequent draft/version/claim writes retain existing lineage and rollback. Output semantics are unchanged: generator `1.1.0` and prompt `grounded-draft-v2`. Parity tests compare every returned draft field/claim with subsequent saved versions.
- `drafts`, `references`, `usable` and the preview are request-local. No cache, mutable global state, persistence-via-rollback or synthetic durable ID exists. Generation errors become `preview_generation_failed`; unexpected compiler authority is rejected. Destination IDs/titles require string projections, not coercion.

## Response fields (schemaVersion 1)

`CampaignPreparationPreview` is the database DTO; `PreparationPreview` is the independently validated browser projection. Neither is a saved receipt or channel-finalization preview.

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `workspaceId`, `configuration` | Literal1, authorized workspace, complete normalized settings: template/version, package/version, name/description, optional Brand/Destination IDs, ordered Audience IDs, depth/promotion/timezone. |
| `contentPackage` | Exact `id`, captured `title`, integer `version`, current `approvalId` and matching `reviewFingerprint`. No assets/private object keys. |
| `brand`, `destination` | Optional small projections: Brand version ID/name/version number; Destination ID/title. No raw profile JSON, URL/tracking or mutable persistence fields. |
| `campaign` | Fixed awareness/draft_only, one review_preparation step: request_approval, tuple [manual_handoff], approvalRequired true, immediate schedule type. A planning review step, not a scheduled outbound run. |
| `generator` | Actual provider/model/version/promptVersion. |
| `variants` | One to20 entries with zero-based position, discriminated General/versioned Audience identity and exact generated draft. |
| `draft` | Headline/body, optional CTA/altText, hashtags, rationale, fact/CTA claims. Internal presentationChoices omitted; no invented draft/version ID. |
| `evidence` | Effective approved IDs, full claims, provenance and source-reference arrays. No unresolved, superseded or live unapproved facts. |
| `effects` | persisted/providerRequest/budgetReservation/approved/activated are all literal false; describe this endpoint, not later saving. |

## HTTP and bounds

`POST /api/v1/campaign-preparations/preview` delegates to `previewCampaignPreparationRequest`. It rejects every query string, requires configured same Origin and authenticated identity before body reading, and delegates current owner/admin/editor authority to the repository. Content type must be application/json. The strict envelope accepts only `{input, expectedReviewFingerprint}`; no actor/approval ID, attempt key or execution authority.

`CAMPAIGN_PREPARATION_PREVIEW_LIMITS` and `PREPARATION_PREVIEW_BROWSER_LIMITS` freeze matching **32,768-byte request** and **1,048,576-byte response** limits; browser timeout is **20,000ms**. Declared/streamed UTF-8 sizes are checked before fatal decoding/JSON parsing. Readers release locks and cancel on overflow. Exact output never silently truncates. Repository bounds `{data}`; HTTP helper bounds the complete metadata envelope again.

Response is `{data, meta:{requestDigest}}`, Cache-Control no-store. Digest is SHA-256 of exact UTF-8 request bytes: correlation, not a credential, receipt, permission or signed proof. `PreviewTransportError` carries safe code/status/message. Authentication401, writer denial403, unavailable package404, invalid settings422 and stale reference conflicts409 are distinguished. Oversized request/response is rejected. Unknown errors are minimized503 with fixed log text, never raw persistence/profile detail.

## Browser variables and lifetimes

- `preparationPreviewBody` serializes the envelope, checks fingerprint/bytes. `preparationPreviewDigest` uses Web Crypto SHA-256. The browser imports no persistence runtime.
- `requestPreparationPreview` sends one same-origin credentialed no-store POST with redirect rejection and AbortController. It races a timeout, aborts and clears the timer in finally. No automatic retry, UUID, sessionStorage write or preview lookup.
- `readPreparationPreviewResponse` requires bounded valid UTF-8 JSON, including errors. `parsePreparationPreview` validates strict nested schemas, fixed authority/effects, versions/positions, scope/package/review/digest, normalized settings, optional reference identities and authored audience order. `facts` is an ID Map: duplicate/missing/different fact citations are rejected. Facts require one matching evidence claim; CTAs require zero evidence IDs.
- Local `normalizedText` only checks display coherence using compiler-equivalent NFC/newline/trim/name-whitespace rules. It is not server validation or authority. UUID comparisons trim/lowercase; captured raw input remains unchanged.
- `PreparationEditor` is keyed by user/workspace. `preview` holds `{identity,data}`; `previewIdentity` is JSON of current values/review fingerprint. Display requires identity equality and no saved/unreadable attempt.
- Existing `inFlight` synchronously fences preview, prepare, lookup and preset copy. `pending` disables fields/review/actions; `previewPending` selects truthful labels. `previewAbort` owns the active controller; monotonic `previewSequence` fences completion independently of form identity.
- `invalidatePreview` clears display and aborts/increments the generation when superseded. Edits, review reload, copied presets, reset and saving clear results. Returning to identical settings cannot revive an old request. Unmount increments/aborts; stale success/failure/finally callbacks cannot update state or release a newer busy fence.
- Failure preserves editable settings with a safe explanation, never success. Saved-attempt recovery remains separate/frozen. Explicit preparation still retains its own UUID/exact request before independent writing.
- `CampaignPreparationPreview` is display-only; `evidenceById` provides linear-size indexing. Native details/summary controls expose evidence/identity with44-pixel targets and3-pixel visible focus. CSS wraps long text, preserves body whitespace and stacks metadata below700px. No nested consequential action.

## Verification and rollout

Pure tests cover General/ordered/longest-audience parity, supported depths, no mutation and empty evidence. Live tests cover no writes, saved-output parity, roles/approval/foreign references/ceilings, oversized evidence, repeated/reversed previews and deterministic authorization races. HTTP tests cover Origin/auth/envelopes/UTF-8/bounds/correlation/safe errors. Client contract/handler tests cover response mismatch, timeout, duplicate clicks, saved/unreadable attempts, invalidation, old/new fences, unmount and independent recovery. These are in-memory handler tests, not browser-network fault injection.

Ignored isolated `market_me_qa_144_preview_v1` seeds one synthetic user/workspace, exact approved café content, two Audiences, one Brand and Destination. `--init` refuses existing databases; never reseed. `--status` fingerprints all141 domain tables; session/OIDC housekeeping excluded. Browser acceptance must not click Prepare/Approve/Activate/Send for this read-only slice; disposable database parity tests exercise saving separately.

Own package/npm/native metadata1.44.0, schema121. No migration, third-party dependency, environment key, credential or provider configuration. Deploy matching web/database/generation consumers; prior receipts/generator identities stay compatible. User pnpm files remain excluded. [Releases](RELEASES.md) separates local/cloud/native/browser evidence, source SHA and limitations from product completeness.
