# Exact-preview Campaign finalization

Status: **implemented locally for the 1.23 preview; full release validation pending**. This is a programmer contract, not a production-readiness or whole-product completion declaration. Focused evidence currently comprises 57 finalization integration cases, 52 raw-loader cases, 134 fingerprint cases, 101 compiler cases, 44 combined helper/fence cases and 30 common-proof cases. These are separate focused suites, not a full-regression total. Browser, native, cloud and final release acceptance are not asserted here; consult [Releases](RELEASES.md) and [Implementation status](IMPLEMENTATION_STATUS.md).

## Product boundary and lifecycle

The beginner path is approved package → [preparation](CAMPAIGN_PREPARATION.md) → governed draft review/revision → approved exact channel preview → finalization. Finalization inserts one **unpublished executable draft version of the same Campaign**, preserving its published `draft_only` planning ancestor and generated copy. It also inserts one immutable completed receipt. It does not publish the Campaign version, activate a run, approve a step, create a workflow command/publication action, decrypt credentials or contact a provider.

The first template chooses one text-only Discord, Slack or Mastodon preview and exactly `official_api`. The source draft may be an original generated version or an approved reviewed revision of one of the preparation's initial draft IDs. Selecting one audience variant does not regenerate the others or silently change the original ordered Campaign audience settings. No selected profiles or Destination is valid: the existing General-audience path remains supported without inferring references.

Immediate, absolute exact-time and absolute preferred request-start-window timing are supported. Exact time is a not-before time and may already be past. A window is `[start,end)` and must not have ended at the final fresh database-clock check. Existing scheduler/approval gates still control actual execution. Media, email, multi-step finalization, fallback methods, direct-message/cold-outreach automation, automatic source-ready finalization, arbitrary templates, recurrence and evergreen recipes are not added.

Finalized Campaigns are read-only for advanced definition editing, including successor versions. Explicit publication, activation, approvals and cancellation remain separate operations. A changed preview/account/link invalidates new execution; it does not rewrite the receipt. Recovery requiring changed content or timing uses a new reviewed preparation/plan, not removal of proof from an existing protected Campaign.

## Modules and exported APIs

Database paths below are under `packages/database/src/`. Public finalization/compiler/loader/fingerprint exports are re-exported by the database package; proof helpers are internal module exports.

| Module / API | Contract and authority |
| --- | --- |
| `campaign-finalization-template.ts`: `normalizeCampaignFinalizationInput(input: unknown)` | Returns frozen `{normalizedInput,canonicalPayload}`. Validates request structure only; no I/O, clock sample, random ID or permission grant. |
| `compileCampaignFinalization(input, trusted: CampaignFinalizationTrustedContext)` | Returns the normalized intent plus `{campaignId,expectedPlanningVersionId,campaign}`. Separately supplied trusted preparation/preview projections must already have been authorized, locked and verified by the server. |
| `campaign-finalization-repository.ts`: `new CampaignFinalizationRepository(sql,{appBaseUrl?})` | Holds only the database client and trusted process configuration. No cross-request mutable attempt cache. |
| `finalize(input: unknown, idempotencyKey: unknown, actorUserId: string)` | One transaction, returning `{finalization: StoredCampaignFinalization,replayed:boolean}`. Current owner/admin/editor membership is required, including completed replay. Actor comes from the authenticated server, never the request body. |
| `get(workspaceId,finalizationId,actorUserId)`, `getByKey(workspaceId,idempotencyKey,actorUserId)`, `getForCampaign(workspaceId,campaignId,actorUserId)` | Current membership-joined reads returning receipt or `undefined`. Reader roles may rediscover history; read access is not finalization authority. |
| `getPreviewSelection(workspaceId,preparationId,previewId,actorUserId)` | Coherent `ExactTextPreviewSelection` or `undefined` for unavailable scope/lineage. Current read membership, exact workspace/Campaign/planning/generation and membership in `preparedDrafts` are checked. Approved reviewed revisions are allowed. Eligible-state errors remain typed. No write or lease is created. |
| `exact-preview-repository.ts`: `loadExactTextPreviewInTransaction(tx,{workspaceId,previewId},{appBaseUrl?})` | One coherent raw SELECT, losslessness check, current eligibility and re-render check; returns `{token,canonicalSnapshot,snapshot,connectionName,destinationTitle}`. Caller owns membership and preparation/instance authorization. |
| `lockExactTextPreviewInTransaction(tx,{workspaceId,previewId})` | Establishes shared publication content lock order. Caller must load again after locks; this function alone grants no access or proof. |
| `CampaignRepository.insertPreparedExecutableDraftInTransaction(tx,{workspaceId,campaignId,preparationId,expectedPlanningVersionId,definition},actorUserId)` | Returns `{campaignVersionId,versionNumber}` after existing graph/execution/reference checks. Repeats exact parent/preparation preconditions, rejects any existing editable draft/finalization, and inserts a distinct draft only. Never opens a transaction, publishes or hydrates through a post-commit current pointer. Caller must create the receipt in the same transaction. |
| `campaign-finalization-proof.ts`: `assertFinalizedCampaignPreviewInTransaction(sqlOrTx,{workspaceId,campaignId,campaignVersionId,stepKey?},{appBaseUrl?,lockPreview?})` | Returns `FinalizedCampaignProof` when protected, `undefined` only without protected Campaign provenance, or throws. `lockPreview:true` requires a real transaction. The function is not user authorization. |
| `setFinalizedPublicationAdmissionInTransaction(tx,proof,{campaignInstanceId,campaignStepRunId})` | Sets the transaction-local compatibility marker only after common admission has validated exact current proof and authority. Never call against a pooled standalone client. |

### Normalized input, types and compiler output

`CampaignFinalizationTemplateInput` has required `workspaceId`, `preparationId`, `expectedPlanningVersionId`, `draftId`, `expectedDraftVersionId`, `previewId`, `expectedPreviewFingerprint` and `timing`; optional `templateVersion` defaults to `1`. UUIDs trim/lowercase and must be nonzero canonical-version/variant UUIDs. Fingerprint spelling must exactly match `mm-preview-v1:sha256:` followed by 64 lowercase hexadecimal digits. Unknown fields, authority flags, arbitrary steps/context, credentials, exotic objects, accessors and malformed nested timing are rejected.

`CampaignFinalizationTiming` is a discriminated union:

- `{type:"immediate"}` with no bounds;
- `{type:"exact_time",scheduledAt}`;
- `{type:"preferred_window",start,end}`, with start strictly before end.

Timing input must be an absolute supported ISO instant with at most millisecond precision in years 0001–9999. Offsets normalize to UTC milliseconds. These scheduling strings are intentionally distinct from the fingerprint's six-digit microsecond strings; never apply the schedule normalizer to a raw preview timestamp. No browser deadline or elapsed-time authority is accepted.

`NormalizedCampaignFinalizationInput` makes template version required. `NormalizedCampaignFinalizationIntent.canonicalPayload` is fixed-key server JSON of `{compiler:"market-me:campaign-finalization",input:normalizedInput}`. `configurationHash` is lowercase SHA-256 of those UTF-8 bytes, without the preview domain prefix. Idempotency compares full canonical text, not just this hash. Actor, attempt key and changing live references are not canonical intent fields.

`CampaignFinalizationTrustedContext.preparation` is an exact projection of receipt IDs, original package/revision, normalized configuration and ordered initial `{draftId,versionId}` pairs. `preview` contains exact workspace/Campaign/source planning/generation/draft/version/preview/connection IDs, optional Destination, supported provider, fingerprint and attachment count. It is server-only and never deserialized as trusted request input. `CompiledCampaignFinalization.campaign` is an ordinary `CampaignDraftWrite` carrying the original name/description/package/profile/audience/Destination/copy controls/timezone, awareness objective, `approval_required`, empty context and success criteria, and `notify_only`.

The one fixed step has key `publish_prepared_preview`, name `Publish reviewed preview`, operation/capability `publish_content`, empty dependencies, delay zero, `approvalRequired:true`, `executionMethods:["official_api"]`, empty outputs/condition, `maxAttempts:3`, `timeoutSeconds:300`, `optional:false`, and the selected schedule. Its complete inputs dictionary is `{draftChannelPreviewId,draftChannelPreviewFingerprint,channelConnectionId}`. No append-link, raw-copy override, fallback or hidden permission flag is emitted.

`CAMPAIGN_FINALIZATION_COMPILER` and `CAMPAIGN_FINALIZATION_TEMPLATE_VERSION` are immutable semantics, not the application version. Module-level input/timing field Sets, UUID/fingerprint patterns and supported instant limits are validation constants. Copy-on-write normalization preserves caller inputs; arrays and dictionaries in the compiler output are frozen.

## Exact snapshot, canonical bytes and raw precision

`createExactPreviewFingerprint(input: unknown)` is pure server-only Node code returning detached frozen `ExactPreviewFingerprintResult = {token,canonicalSnapshot,snapshot}`. `ExactPreviewProvider` is Discord/Slack/Mastodon only. `ExactPreviewRawJson` is recursively null/boolean/number/string/readonly array/plain dictionary; `ExactPreviewRawJsonObject` is its dictionary form. `ExactPreviewConnectionV1` is provider-discriminated. The primitive may describe known blocked/inactive states structurally; loader eligibility must reject them before selection or admission.

The exact v1 fields are:

```text
schemaVersion: 1; rendererContract: "stored-channel-preview-text-v1"
lineage: workspaceId, campaignId, sourceCampaignVersionId, generationId,
         previewId, contentDraftId, contentDraftVersionId
preview: provider, channelConnectionId, destinationId|null, linkMode, status,
         renderedSubject|null, renderedContent, subjectCount|null, subjectLimit|null,
         characterCount, characterLimit|null, validationIssues[{code,message}],
         capabilityVersion, capabilityObservedAtUtcMicros, capabilitySnapshot,
         createdBy, createdAtUtcMicros, assets:[]
connection: id, workspaceId, provider, status, identity
destination: null | {id,workspaceId,provider,status,canonicalUrl}
trackedLink: null | {id,workspaceId,destinationId,draftChannelPreviewId,
                    campaignInstanceId|null,campaignStepRunId|null,slug,canonicalUrl,
                    utmParameters,status,expiresAtUtcMicros|null,publicRedirectUrl}
```

Identity is `{webhookId,channelId,guildId:null|string}` for Discord, `{teamId,serviceId,host}` for Slack, and `{accountId,instanceOrigin,host}` for Mastodon. Raw identity fields must be strings (except absent/null Discord guild); numeric `->>` coercion and snake-case aliases that collide with driver camelization are rejected, even if an alias has equal text. All schema keys are mandatory, using explicit nulls. All strings retain exact spelling, whitespace, Unicode, URLs and line endings. `utmParameters` is a string dictionary; capability JSON retains unfamiliar raw fields and array order. The underlying attachment count must be zero, not merely an empty result from a lossy join.

Constants are `EXACT_PREVIEW_FINGERPRINT_VERSION=1`, `EXACT_PREVIEW_RENDERER_CONTRACT="stored-channel-preview-text-v1"`, `EXACT_PREVIEW_FINGERPRINT_DOMAIN="market-me:exact-preview:v1\n"`, and `EXACT_PREVIEW_FINGERPRINT_PREFIX="mm-preview-v1:sha256:"`. The domain contains one LF, never the platform newline. The token hashes domain UTF-8 followed by canonical snapshot UTF-8, with no BOM.

Object keys are traversed in UTF-16 lexical order, directly serialized rather than inserted into an object whose numeric-looking keys would be reordered. Arrays retain order; primitive serialization follows [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785). Strings are not Unicode-normalized. Nonfinite numbers and unpaired Unicode are rejected. This is canonical equality, not a signature.

`EXACT_PREVIEW_FINGERPRINT_LIMITS` is frozen: root depth zero with maximum `32`, at most `50000` visited values/containers, at most `262144` UTF-16 code units per string/key, and at most `1048576` canonical UTF-8 bytes including escaping/punctuation. Descriptor-only detachment rejects proxies, accessors, hidden/symbol properties, sparse/custom arrays, cycles, functions and undefined; it does not call getters or `toJSON`. New objects are separately frozen. Node/path/byte counters and the recursion ancestor Set live only for one call.

The raw loader uses JSONB `::text` and fixed SQL UTC formatting `YYYY-MM-DDTHH:mm:ss.ffffffZ`, never the normal `StoredDraftChannelPreview` display DTO. Range checks reject BC/infinity/out-of-range timestamps before formatted eras could collide. Never pass these strings through Date; for writes use `parameter::text::timestamptz`. Even string parameters inferred directly as timestamptz may trigger driver millisecond serialization.

`JSON.parse` can round PostgreSQL arbitrary-precision numbers. The loader compares the **same captured raw JSONB** against canonical JSONB after parsing, rejecting changed numeric values instead of hashing rounded data. It bounds raw snapshot/configuration text before parsing (twice the canonical byte limit to allow JSONB formatting spaces), then applies the tighter primitive limits. A future lossless-number parser or changed field/renderer contract requires explicit versioning; do not reinterpret existing v1 hashes.

The loader re-renders approved headline/body/CTA/hashtags with the existing provider renderer and canonical/trusted tracked URL, comparing exact content/subject/counts/limits and requiring no issues. Current provider/raw capabilities/observation stamp must match the preview. `APP_BASE_URL` contributes its validated origin only for tracked links; it is trusted server configuration, not a client field. Destination and tracked-link availability use the current database statement time. Changing UTM/expiry/identity changes the proof even when visible copy does not.

Excluded values are connection names, Destination titles/descriptions, routine connection health/update timestamps, evaluation time and credentials. Safe current display labels are returned separately. Preview creation time/actor are included, so rewriting the same preview ID requires reselection even if its text is identical. No credential is fingerprinted, returned or logged.

## Atomic transaction and lock order

1. Normalize input/key and compute the canonical-input hash. Inside one transaction, lock organization/workspace/actor ancestors and current membership; require owner/admin/editor.
2. Acquire `pg_advisory_xact_lock(hashtextextended("campaign-finalization:<workspace>:<key>",0))`. Hash collisions only serialize; table uniqueness and full canonical text establish identity. Read an existing receipt first. Identical input returns the original IDs/snapshot despite later source/profile/preview changes; different input gives `idempotency_conflict`.
3. Discover the scoped preparation, lock Campaign `FOR UPDATE`, then its exact preparation `FOR SHARE`. Reject any existing finalization under another key. Require nonarchived Campaign with the expected published `draft_only` planning version still current and no editable draft. Verify preparation canonical settings/hash, complete unique initial draft references, pinned generation and one bound exact package.
4. Lock the original package `FOR SHARE`, requiring unchanged revision and approval. Lock optional Brand root then version; lock all Audience roots in UUID order before their versions, retaining authored variant order separately. Require all selected roots/versions still current/published in the workspace and preserve current communication ceilings. A refreshed package or superseded profile requires new preparation, not substitution.
5. Acquire content locks in publication order: connection `SHARE` → ordered content approvals `SHARE` → draft `SHARE` → version `SHARE` → preview `UPDATE` → Destination `SHARE` → ordered tracked links `SHARE`. Recheck discovered preview lineage after waits. The preview update lock also excludes ordinary FK-backed attachment insertion. Do not lock Destination earlier and then wait for preview, or lock draft before its approval rows.
6. Load the coherent current exact snapshot, re-render, compare expected token, and compile using server-derived preparation/preview context. Insert a distinct executable draft through the transaction helper, then immutable receipt and `campaign.finalized` audit. Finalization audit includes exact IDs, version number, fingerprint/hash/template version, `published:false` and `activated:false`, not credentials.
7. After all insert/constraint/lock waits, use fresh `clock_timestamp()` to require preferred-window end strictly in the future. Failure rolls back draft, receipt and audit together. Commit and return the inserted receipt; no post-commit lookup or compensating delete is needed.

There is no durable pending-finalization row. Different keys for one Campaign serialize through the Campaign lock and cannot leave orphan versions. Receipt replays are history retrieval only, not renewed approval or execution. Transaction-local variables `intent`, `selected`, `key`, `configurationHash`, `preparation`, `exact`, `compiled`, `created` and `receipt` hold validated snapshots/IDs; they are discarded at transaction completion. Sorting copies of audience IDs must not mutate their meaningful authored order.

## Migration 0112 and retained data

`0112_campaign_finalizations.sql` is frozen and was applied to isolated QA123. SHA-256: `f38620c1b9c61a2e8298b9a1eb70b2b7a37ddc453e1f73f15ef243575c479566`. Never edit an applied migration/checksum; fixes require a forward migration. Its table is completed-only:

| Column(s) | Meaning / constraint |
| --- | --- |
| `id`, `workspace_id`, `idempotency_key` | Receipt UUID, tenant binding and durable unique `(workspace_id,idempotency_key)` retry identity. |
| `preparation_id`, `campaign_id`, `planning_version_id`, `finalized_version_id` | Exact original preparation/Campaign/planning ancestor/new executable version. Preparation, Campaign and finalized-version references are individually unique; planning and finalized versions must differ. |
| `content_draft_id`, `content_draft_version_id`, `draft_channel_preview_id` | Selected initial-draft lineage with the reviewed current copy version and exact mutable preview ID. Restrictive references retain the history. |
| `preview_fingerprint`, `canonical_preview_snapshot` | Versioned token and exact canonical text, 1–1,048,576 UTF-8 bytes. Database checks the prefixed SHA-256 relation. |
| `canonical_input`, `configuration_hash` | Full normalized finalization intent, 1–65,536 bytes, and its SHA-256. Database checks their relation; full text decides replay. |
| `compiled_definition` | JSONB historical compiler output, not a newly compiled read of current settings. Receipt guard compares it with the actual stored version/one-step projection and original preparation controls. |
| `template_version` | Must equal 1; independent of schema, preview contract and application release numbers. |
| `created_by`, `created_at` | Authenticated actor reference and database transaction timestamp. Neither comes from caller-authored template settings. |

`StoredCampaignFinalization` explicitly exposes receipt/lineage IDs, fingerprint, parsed raw `canonicalPreviewSnapshot: ExactPreviewSnapshotV1`, parsed historical `compiledDefinition`, configuration hash, template version, actor and six-digit UTC `createdAt`. It omits canonical intent text. Reading JSON columns through explicit text aliases prevents `postgres.camel` from rewriting historical keys. The returned top-level receipt is frozen; parsed nested history is detached from persistence, not a writable database handle. No expiry/pruning/deletion API exists.

`enforce_campaign_finalization_receipt` rejects UPDATE and checks inserted lineage, approved draft, exact fixed step, canonical intent/definition and preparation pins. `enforce_finalized_campaign_version_content` and `enforce_finalized_campaign_child_content` protect every version/step/audience binding in a finalized Campaign, not just optional input fields or the first executable version. Version status/published-at changes remain possible for ordinary publication; replacing content/successor versions is rejected. Tests remove only their own finalization rows before preparation and organization cleanup. Administrative erasure needs a separate deliberate FK-aware retention design.

## Mandatory execution proof and compatibility fence

Durable Campaign receipt existence determines whether proof is required. A missing step token cannot regain legacy behavior. `assertFinalizedCampaignPreviewInTransaction` verifies the exact finalized version, one fixed approval-required official-API step, exact input dictionary, stored canonical/hash/lineage, and freshly loaded current preview. Optional `stepKey` must match. `FinalizedCampaignProof` returns `{finalizationId,campaignId,campaignVersionId,campaignStepId,stepKey,previewId,previewFingerprint,channelConnectionId}` for the exact admitted target.

Activation performs this check with content locks before creating an instance/outbox. `assertStepExecutionAuthorized` checks the instance's pinned version before its bounded-scheduling early return; that read is an activity gate, not a transactional lease. `PublishingRepository.admitPublication` repeats proof under its existing instance/version/steps/runs/approvals/connection/content/Destination/link locks for both initial action and failed retry. It compares actual request content, identity, target lineage and trusted `campaignFinalizationId`/`draftChannelPreviewFingerprint`; request metadata alone is never accepted as proof. The worker retains these fields in publication evidence. Existing exact approval snapshots retain the immutable step inputs.

Migration 0112's `enforce_exact_preview_publication_admission` checks the transaction-local PostgreSQL setting `market_me.exact_preview_admission`. Its JSON dictionary is exactly `{finalizationId,campaignVersionId,campaignStepId,campaignInstanceId,campaignStepRunId,previewFingerprint}`. Common admission sets it using `set_config(...,true)` only after current proof and normal authorization checks. It expires at commit/rollback; never cache it, persist it as consent, set it globally, or set it on a pooled connection outside the transaction.

An old worker cannot insert a protected dispatch claim or transition failed→dispatching merely by retaining an old request token. The marker must match receipt/instance/run/step/request evidence. Changed request snapshots also require that marker; protected history cannot be retargeted. Unchanged dispatching observations and outcome writes remain possible so already accepted/ambiguous provider history can settle. This is an old-binary **compatibility fence**, not security against a privileged SQL client able to set its own GUC or change schema. Restrict database-role access and retain application authorization.

Existing recovery precedes authorization for a *new* send: exact persisted success returns its historical result; dispatching/ambiguous delivery requires reconciliation, even if current preview evidence changed. Never convert uncertain delivery into clean rejection or resend it. Only failed/no-action paths seek current new-dispatch proof. Locks are released before provider HTTP; they cannot recall an already admitted request or promise remote completion within a window. See [Scheduling contracts](SCHEDULING_CONTRACTS.md) for cutoff and cancellation settlement.

## Errors, browser state and API contracts

| Error type / codes | Meaning and caller response |
| --- | --- |
| `CampaignFinalizationTemplateValidationError.issues[{field,code,message}]` | `invalid_input`, `unsupported_field`, `unsupported_template`, `invalid_reference`, `invalid_fingerprint`, `invalid_timing`, `lineage_mismatch`, `unsupported_preview`, `invalid_definition`. Correct selection/settings; do not weaken server validation. |
| `CampaignFinalizationError.code` | `access_denied`, `invalid_idempotency_key`, `idempotency_conflict`, `preparation_unavailable`, `preparation_invalid`, `already_finalized`, `campaign_changed`, `package_unavailable`, `package_version_mismatch`, `package_not_approved`, `brand_unavailable`, `audience_unavailable`, `preview_changed`, `window_expired`. Conflict errors may expose `existingFinalizationId` for authorized rediscovery. |
| `ExactPreviewReadError.code` | `preview_unavailable`, `preview_ineligible`, `snapshot_lossy`, `snapshot_too_large`, `render_changed`, `tracked_origin_required`. Recreate/review the supported exact preview or repair trusted configuration; do not replace raw values with guessed equivalents. |
| `ExactPreviewFingerprintValidationError.issues[{field,code,message}]` | `invalid_json`, `invalid_schema`, `unsupported_version`, `unsupported_renderer`, `invalid_reference`, `invalid_timestamp`, `invalid_number`, `invalid_url`, `limit_exceeded`. Frozen issue array; structural acceptance never implies eligibility. |
| `CampaignFinalizationProofError.code` | `finalized_plan_invalid` or `finalized_preview_changed`. Existing Campaign/publication gates map these to `CampaignValidationError` issues; block new dispatch while preserving prior outcome evidence. |
| Existing validation/SQL errors | Profile ceilings, graph/route policies and database `23514` guards can also reject. Transactions roll back; unexpected errors must not be presented as successful completion. |

The web POST `/api/v1/campaign-finalizations` accepts strict `{input,idempotencyKey}`, verifies configured Origin and current write membership, and supplies the session actor. New success is 201, replay 200, with `{data:receipt,meta:{replayed}}` and no-store. GET on the same path requires exactly one `workspaceId` and `idempotencyKey` for current-membership rediscovery. GET `/api/v1/campaign-preparations/[id]/preview-selection?workspaceId=...&previewId=...` returns coherent exact display data/token, not write authority. Validation is 422, unavailable scope 404, access denial 403, and stale/conflicting state 409; unknown errors use the ordinary application mapper.

Form/result routes are `/campaigns/preparations/[id]/finalize?workspaceId=...` and `/campaigns/finalizations/[id]?workspaceId=...`. The result separates immutable original plan from current published/run state. Publication/activation controls submit the exact expected version; finalization does not auto-click them. An uncertain activation response prompts checking existing runs rather than automatic resend.

Browser `FinalizationAttempt` is `{version:1,userId,idempotencyKey,input}` and contains no credential or authoritative snapshot. `sessionStorage` key `market-me:campaign-finalization:v1:<user>:<workspace>:<preparation>` retains it before every POST. Storage failure sends nothing. Response loss reuses the same exact key/payload; checking a 404 does not prove an earlier request cannot finish. Scope/shape validation prevents restoration under another user/workspace/preparation. Reset is explicit, not silent key replacement.

`FinalizationPreviewChoice[]` is a filtered display list; `selected: ExactTextPreviewSelection` is the current coherent read. `selectionSequence` is component-local stale-response suppression, not a database version. `inFlight`, pending/error/confirmation flags and UTC form bounds are tab-local UI state. No new process-global mutable dictionary, scheduler, background job, provider secret or environment variable is introduced. Existing `APP_BASE_URL` must agree across web and workers for tracked proofs.

## Deployment, retention and remaining gates

Apply frozen migration 0112 and deploy compatible readers, authorization/admission and workers before exposing finalization writers. Stop/drain or exclude incompatible workers/writers from protected executions; the database fence prevents their new protected claims but does not make them suitable consumers or replace operational queue coordination. Do not roll protected plans back onto 1.22 workers. Keep v1 canonicalization, renderer interpretation, template compiler and migrations available while their receipts/plans remain usable. Unknown future versions fail closed. Any contract change requires versioned migration/reader strategy, not recomputing historical receipt bytes.

Existing 1.22 historical capability-snapshot mismatch rules remain: no destructive preview rewrite/backfill is performed; affected previews must be recreated/reviewed. Full regression, replay, builds, browser journeys and cloud CI remain release gates. Focused tests use isolated `market_me_qa_*`/`market_me_ci` fixtures with external calls denied. They prove bounded contracts and controlled races, not production provider delivery, cross-platform native acceptance, all older workflow histories or completion of the full approved specification.
