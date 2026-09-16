# Source-bound draft preparation

Status: Release 1.25 is the verified public source checkpoint; Release 1.26 adds a locally verified candidate exact approval-receipt handoff without changing persistent semantics. Its full local workspace, migration, build, browser, production-smoke and native/package gates plus Google development-document readback pass; exact implementation commit `8d23c4bafc852ded456eef54b49af3f476a72f0c` also passed feature run 35045757711 with both audits clean. Reviewed documentation feature CI, `main` publication and identical `main` CI remain pending. Release readiness still expects 116 migrations ending at `0116_source_preparation_recovery_hardening.sql`. Exact verified and candidate evidence is separated in [Releases](RELEASES.md); this document is the source contract and operational boundary.

## Outcome and safety boundary

An authorized writer can attach the built-in `general_announcement` template version `1` to a Smart Source. A later, explicit exact Content Package approval atomically creates one durable preparation command. The ingestion worker consumes that command through the existing `CampaignPreparationRepository.prepare()` transaction and creates a planning Campaign plus governed draft variants.

The result remains **Prepared—not activated**. This feature does not approve a Draft, finalize a preparation, select a channel account or credential, create a Campaign instance, enqueue a workflow command, activate a Campaign, create a `publication_action`, call a provider, or schedule a send. Preparation internally publishes an immutable `draft_only` planning version because governed draft generation requires a stable Campaign-version ancestor; that database transition is not an external publication.

The binding is a separate control from `smart_source.enabled`. Pausing a source stops synchronization, while an enabled preparation binding still applies to a later explicit approval of an already-created package. Disabling or editing a binding affects only approval transitions after that change commits. It never rewrites or cancels an already-enqueued command.

There is deliberately no migration-time or binding-time backfill. Existing approved packages remain unchanged. To request preparation, a person must make a later explicit exact approval while the binding is enabled.

## Release 1.26 receipt visibility

`getSourcePreparationCommandForApproval(workspaceId, contentPackageId, approvalId, actorUserId)` reads the one command associated with an exact approval. The method validates all identifiers, requires current membership and filters exact workspace/package/approval in one query. It deliberately does not call `listSourcePreparationCommands()`: that recent-history operation is bounded and may omit an older receipt.

The immutable approval page loads and validates the receipt first, then maps any returned server summary through `sourcePreparationCommandView()`. Visible state is limited to status, binding/package revision, attempts, optional retry time and bounded safe failure, optional immutable preparation receipt ID and queue time. Command ID, approval/fingerprint, writer, lease, Campaign ID, idempotency key and JSON snapshots do not enter browser props. A same-page link explicitly refreshes current operational state.

Command absence is definitive for the exact receipt because enqueue and approval commit atomically. It is displayed as “No preparation command recorded,” never as waiting work, and later binding configuration does not backfill it. The warning before approval is always shown and intentionally conditional: the binding may be enabled or disabled after the page loads, while the approval receipt reports commit-time truth. Release 1.26 adds no command mutation, retry, requeue, template change, automatic finalization, activation or provider operation.

## End-to-end sequence

1. An owner, administrator or editor saves one source binding. The authenticated saver becomes the binding's configured writer; no browser field can nominate or impersonate a different user.
2. The repository validates the source scope, template fields, timezone and current published Brand/Audience/Destination references. Ordered Audience IDs retain authored order. The only stale-reference exception is an otherwise unchanged transition from enabled to disabled, which preserves the saved configuration so an operator can stop future enqueue; creating, editing or re-enabling a binding revalidates its applicable references.
3. A person with approval authority records an exact package approval. Approval and binding authority are independent: an approver-only user may approve, but is never reused as the Campaign writer.
4. Migration `0115_source_bound_draft_preparation.sql` introduces the `content_package.current_approval_id` outbox trigger and base schema. Additive migration `0116_source_preparation_recovery_hardening.sql` makes the enabled-binding observation commit-order-safe. In the approval transaction the trigger holds the observed binding `FOR SHARE` and inserts one command containing relational identity columns and immutable configuration/binding JSON snapshots. If disable commits first, no command is admitted; if approval observes enabled first, disable waits and the queued intent is retained.
5. `SourcePreparationRepository.claimSourcePreparationCommands()` claims eligible rows with `FOR UPDATE SKIP LOCKED`, increments the attempt fence and sets a bounded lease.
6. `SourcePreparationService` calls `CampaignPreparationRepository.prepare()` outside the claim transaction. Dedicated command columns override identity fields in JSON. It passes the command UUID as the preparation idempotency key, the configured writer, exact package version, exact review fingerprint and exact triggering approval ID.
7. The preparation repository rechecks current writer membership, the package's exact current approval ID/fingerprint/version and all current published references under its normal locks. Success atomically creates one Campaign, its immutable `draft_only` planning version, governed drafts, a completed preparation receipt and audit.
8. The command completes only when its attempt still owns the processing row and the database guard proves exact receipt/Campaign/package/version/configuration/writer/approval lineage. A stale attempt changes nothing.

Claiming and preparation intentionally use separate transactions. A crash after preparation commits but before command completion is recovered by reclaiming the command and calling `prepare()` with the same UUID. The existing receipt replays; a second Campaign is not created.

## Authority model

| Operation | Required current workspace role | Durable actor/identity rule |
| --- | --- | --- |
| Read binding or command status | Any current workspace member | Query joins or transaction checks current membership. |
| Create/update/enable/disable binding | `owner`, `admin`, or `editor` | Server passes authenticated user; saver becomes `writer_user_id` and `updated_by`. |
| Approve Content Package | `owner`, `admin`, or `approver` | Existing exact-review receipt retains its actual approval actor. |
| Execute queued preparation | No browser session | Worker uses snapshotted binding writer, then `prepare()` rechecks that user is still an owner/admin/editor. |

The same owner/admin may legitimately save the binding and approve the package. Separation of duties is supported but not forced. The security requirement is that the worker uses the configured writer identity rather than blindly using whoever approved.

If the configured writer is removed or downgraded after enqueue, or a selected profile/Destination is no longer current, the already-visible command fails closed and becomes terminal. The approval trigger does not silently discard the intent merely because mutable eligibility changed between configuration and execution.

## Migrations 0115–0116 and persistent data

Migration `packages/database/migrations/0115_source_bound_draft_preparation.sql` is the base binding/outbox schema, frozen at SHA-256 `a8a0acc7e43700a591ca75904dc2737ce7cac88bb418ad72719208ce06d793c6`. Forward migration `packages/database/migrations/0116_source_preparation_recovery_hardening.sql`, frozen at SHA-256 `3e756bccfde1d6b7836f6ddb71b3b0c4861d6c6afb1bfa87dfb5a20094b3c652`, adds safe disable/re-enable validation, command-key reservation, approval/binding-creation/disable commit ordering, exact completion lineage and capped recovery guards without rewriting 0115. Both are forward-only. Never edit either; add migration 0117 or later for any correction.

### `smart_source_preparation_binding`

One mutable row exists per Smart Source (`smart_source_id` is unique).

| Column | Meaning |
| --- | --- |
| `id`, `workspace_id`, `smart_source_id` | Binding identity and tenant/source scope. Identity cannot move during an update. |
| `writer_user_id` | Authenticated writer who most recently saved or toggled the binding and whose current writer authority is rechecked during execution. |
| `template_key`, `template_version` | Fixed to `general_announcement` / `1`; a semantic template change requires a new version. |
| `name`, `description` | Campaign planning text, bounded to 200 and 5,000 characters. |
| `brand_profile_version_id`, `destination_id` | Optional current published references. New, changed or enabled configuration validates them and execution rechecks them. An exact otherwise-unchanged disable may retain stale saved references so future enqueue can be stopped safely. |
| `information_depth`, `promotional_strength`, `timezone` | Existing normalized Campaign copy controls. Profile ceilings remain authoritative. |
| `enabled` | Controls only future exact-approval enqueue. |
| `revision` | Starts at one and advances exactly once per mutation. Every command pins the revision that produced it. |
| `created_by`, `updated_by`, `created_at`, `updated_at` | Authenticated audit metadata and database times. |

### `smart_source_preparation_binding_audience`

Audiences are normalized rather than stored only in JSON. `(binding_id, audience_profile_version_id)` prevents duplicates; `(binding_id, sort_order)` preserves one authored position; `sort_order` is limited to `0..19`. An empty collection means one general-audience draft. The binding repository locks profiles in stable database order while retaining this authored order for generated variants. Child insert/delete requires transaction-local admission metadata **and** parent `xmin` proof that the same transaction inserted or revised the authenticated parent; copying a visible revision into `set_config` cannot independently mutate ordered children. Migration 0116's deferred constraint trigger validates every retained Audience at the transaction's final state whenever the binding is enabled; an unchanged disable may preserve stale Audience rows, but re-enable cannot commit until all retained Audiences are current and published.

### `source_preparation_command`

This table is both durable outbox and operational receipt. It is not `campaign_workflow_command`: a source command exists before a Campaign instance and grants no execution authority.

| Column / collection | Meaning and invariant |
| --- | --- |
| `id` | Fresh database UUID for one approval-triggered intent. It is also a reserved internal preparation-idempotency key and is omitted from browser views. |
| `workspace_id`, `binding_id`, `binding_revision`, `smart_source_id` | Exact origin and binding revision. |
| `content_package_id`, `content_package_version` | Exact approved package root/revision. |
| `expected_approval_id` | Exact immutable approval receipt that triggered the command; globally unique across commands. |
| `expected_review_fingerprint` | Exact `mm-package-review-v1:sha256:...` content fingerprint. Approval ID prevents a byte-identical later reapproval from satisfying an older unstarted command. |
| `preparation_idempotency_key` | Constrained equal to `id`. The worker uses `id` directly. |
| `writer_user_id` | Configured binding writer, never inferred from the approval actor. |
| `configuration_snapshot` | Normalized preparation dictionary ready for the template compiler. Relational identity columns override its workspace/package/version fields at execution. Receipt reservation, recovery and completion require exact JSONB equality to this snapshot. |
| `binding_snapshot` | Human/audit context including original binding identity, revision, controls and ordered audiences. It is not live authority. |
| `status`, `attempt_count`, `next_attempt_at` | Durable lifecycle and bounded exponential-retry state. |
| `claimed_at`, `lease_expires_at` | Processing lease. The incremented attempt number is the completion/failure fence; there is no process-local owner map. |
| `last_error_code`, `safe_error` | Bounded sanitized operational category/message. Raw database messages, SQL, provider details and credentials are never persisted here. |
| `preparation_id`, `campaign_id` | Present together only after successful guarded completion. Other lineage is read from the immutable preparation receipt. |
| `created_at`, `updated_at`, `completed_at` | Database clocks for ordering, status display and terminal evidence. |

Command authority/configuration fields are immutable after insertion. Terminal `completed` and `dead_letter` rows are immutable. A `campaign_preparation` insert whose key matches a source command is accepted only while that command is `processing` and only for its exact writer, package version, configuration snapshot, approval ID and review fingerprint. The database reservation trigger holds the command `FOR SHARE`, while the preparation repository performs the same check before replay/insert; manual or browser-visible key reuse cannot preempt the outbox. Workspace/organization aggregate deletion remains possible through deferred command references; ordinary deletion of retained lineage is restricted.

## State machine, retry and races

| State | Eligible transition | Meaning |
| --- | --- | --- |
| `pending` | claim → `processing` | Newly enqueued, immediately eligible. |
| `processing` | complete → `completed`; failure → `failed`/`dead_letter`; an expired attempt below eight → new `processing` attempt; an expired eighth attempt → reconciliation | One attempt owns the current fence. |
| `failed` | due retry → `processing` | Sanitized retryable failure with bounded `next_attempt_at`. |
| `completed` | none | Guarded preparation/Campaign lineage is retained. |
| `dead_letter` | none | Permanent failure or retry cap reached; requires a newly reviewed/configured future approval rather than mutation of history. |

`SOURCE_PREPARATION_MAX_ATTEMPTS = 8` is the shared database constant for claim and failure settlement. Only attempts below eight can be claimed. Retryable failures after attempts 1–7 use exact delays of 5, 10, 20, 40, 80, 160 and 320 seconds; an eighth failure is terminal, so the general one-hour formula cap is never reached by this eight-attempt policy. Database guards reject a claim time in the future, a lease longer than one hour, and a `failed` state at attempt eight or higher. An expired eighth attempt is never claimed a ninth time: cap cleanup first takes `FOR UPDATE SKIP LOCKED`; an in-flight receipt's `FOR SHARE` therefore defers cleanup. After the lock is held, an exact committed preparation receipt wins and reconciles directly to `completed`; otherwise the row becomes `dead_letter` with `attempt_limit_exhausted`. A retryable settlement locks first and performs the same exact-receipt reconciliation before recording failure. The repository returns `completed`, `failed`, `dead_letter` or a lost-fence result so worker counters describe the persisted outcome.

Completion returning `false` means only that the `(processing, attempt)` fence was lost. Invalid current-attempt lineage—including a configuration snapshot mismatch—raises database check `23514`; the service classifies it as permanent and records a dead letter unless an exact committed receipt is first recovered. This distinction avoids an immortal poison command without orphaning work that committed before response or settlement loss.

Every explicit reapproval creates a different approval ID and therefore a different command, even if the review bytes/fingerprint are identical. This is intentional and must be visible in the approval UI:

- If an older command has not prepared yet, its exact-ID recheck fails after a newer approval replaces it.
- If it already holds the package lock and commits first, the later approval waits, then legitimately creates a second command/preparation.
- If preparation committed but command settlement was interrupted, replay of that command's UUID returns its original receipt even if a later approval now exists.

## Runtime modules, variables and collections

`packages/database/src/source-preparation-repository.ts` owns binding validation/CRUD, minimized status reads, command claim/fencing, receipt-first retry/expiry recovery, retry settlement and terminal audits. Public browser summaries never include the command UUID, `configuration_snapshot`, `binding_snapshot`, lease-owner internals or unrestricted exceptions.

`packages/ingestion/src/source-preparation-service.ts` is a small command processor. Important local variables are deliberately per-call:

- `SourcePreparationClaimBatch`: `{commands, recovered, deadLettered}`. `commands` is the immutable claimed-command array; the numeric cleanup fields report expired-cap rows reconciled from exact receipts or terminalized before ordinary claims.
- `handled`: private loop budget counting claimed work plus recovery/dead-letter cleanup. Cleanup-only batches consume the same public `limit` and may continue only while that bound remains.
- `claimed`, `completed`, `retried`, `deadLettered`, `lost`, `settlementFailed`: batch counters returned for structured worker logging; `completed` includes receipt recovery and `deadLettered` includes cap cleanup. None grants authority or survives the sweep.
- `failure`: a sanitized `{errorCode, retryable, safeError}` dictionary. Known domain/configuration errors and SQL data/integrity classes are terminal; connection, serialization, deadlock, lock and bounded-timeout classes are retryable; unknown internal errors are bounded retries.
- `configurationSnapshot`: authored template choices. The service creates a new object and overwrites `workspaceId`, `contentPackageId` and `expectedPackageVersion` with relational command columns before calling `prepare()`.
- the ordered audience list: at most 20 version UUIDs. Order controls variant order and is never replaced by lock-acquisition order.

There is no mutable process-global command cache, authorization cache, retry dictionary or idempotency map. PostgreSQL rows and constraints are the durable source of truth. Module constants are immutable limits/status definitions only.

`apps/worker/src/index.ts` constructs one repository/service pair for the process and invokes it in the existing ingestion sweep. Its source-preparation stage catches storage failure locally, emits only a fixed error code and allows later ingestion/alert sweeps to continue. Per-command settlement-store failure leaves the processing lease to expire safely; it does not print a raw driver error.

### Environment variables

| Variable | Default and bounds | Intent |
| --- | --- | --- |
| `SOURCE_PREPARATION_BATCH_SIZE` | `10`; integer `1..100` | Maximum claimed or cap-cleanup items handled in one ingestion-worker sweep. |
| `SOURCE_PREPARATION_LEASE_SECONDS` | `300`; integer `30..3600` | Attempt lease. Choose longer than expected preparation time; expiry is safe because UUID replay is idempotent. |

These variables contain no secrets. The repository primitive accepts a shorter lease for controlled integration testing, but the service/operator boundary intentionally requires at least 30 seconds. Existing `DATABASE_URL` remains server-only. The feature introduces no provider key, model key, credential scope or outbound network requirement.

## Web API and user interface

Binding configuration uses a separate endpoint rather than expanding the legacy full Smart Source replacement body:

- `GET /api/v1/smart-sources/:id/preparation-binding?workspaceId=...` returns only the minimized binding view to a current member, or a bounded `binding_unavailable` 404.
- `PUT /api/v1/smart-sources/:id/preparation-binding` saves normalized configuration for an authenticated writer and requires `expectedRevision` for every existing binding, preventing a stale browser save from overwriting a newer revision.

The server-rendered Smart Source pages separately call membership-scoped `listSourcePreparationCommands(...)` and convert those rows through `sourcePreparationCommandView`. There is no browser-writable command/status endpoint. The view omits the command UUID, approval IDs, fingerprints, writer IDs, idempotency keys, leases, Campaign ID and immutable snapshots even though the internal repository summary carries fields needed by server operations.

The mutation boundary requires the configured application Origin, a bounded JSON body, a strict unknown-key-free schema, canonical source/workspace identity and current writer access. Actor/writer IDs, command state, approval IDs, snapshots, leases, errors and result lineage are never accepted as writable browser fields.

The Smart Source edit surface states:

- this uses General Announcement template v1;
- it applies only to the next explicit exact approval and has no backfill;
- preparation creates governed drafts but does not activate or send;
- editing/disabling cannot cancel a queued command;
- pausing source synchronization is separate from the binding switch.

If saved references have become unavailable, the UI may submit an otherwise unchanged disable to stop future enqueue. That safe-stop path retains the unavailable selections for audit/history. Any edit, creation, enable or re-enable must use currently eligible references; a disabled binding with stale retained references cannot be re-enabled until they are replaced or republished.

Recent command status is rendered as pending, processing, failed/retryable, completed or stopped/dead-lettered. Completed rows link to the existing immutable preparation receipt. Errors show only `safe_error` plus bounded remediation. Content Package approval warns that recording another explicit approval queues another draft-only preparation when the source binding is enabled.

## Rollout and recovery

Release 1.25 is an additive coordinated writer deployment:

1. Stop/drain 1.24 web approval mutations and ingestion workers.
2. Back up the database and verify the frozen 0113/0114 checksums.
3. Apply migration 0115 and then additive hardening migration 0116 once with the repository migration runner.
4. Deploy matching web/database/ingestion-worker code and synchronized package versions.
5. Validate readiness, binding save/read, no-backfill behavior, exact approval enqueue, worker completion and command/preparation status.
6. Reopen writers.

Old 1.24 approval code does not know the new UI, but the database trigger would still enqueue for a preconfigured binding. Do not intentionally run mixed web/worker versions: an old ingestion worker will not consume the new commands, and operational status will accumulate. A code-only rollback leaves additive tables/trigger present; keep new binding creation/approval traffic stopped and prefer a forward repair. Never delete or rewrite completed commands/preparation receipts to force a retry. Correct configuration and make a new explicit approval when new work is intended.

## Required acceptance evidence

The exact local release source passed the frozen 116-migration replay/checksum gate, 14 live repository cases, 18 service cases, 95 focused web cases, the complete 2,015-test/118-file workspace suite, all 12 typechecks, lint, frontend builds, authenticated browser acceptance, production smoke and Windows native/package checks. Google development-document synchronization and native connector readback are complete. Local npm audits remain unverified because registry metadata transmission was blocked. Reviewed release commit `d9ff270d15bfe143c839e17c007fc558658eb62b` passed feature run 35041096710 and identical main run 35041414004 with both zero-vulnerability audits and is published on `main`. Exact counts and artifact hashes are maintained in [Releases](RELEASES.md).

Release acceptance proves:

- migrations 0115 then 0116 apply after frozen 0114, replay unchanged, and support whole-workspace cleanup;
- one enabled binding plus one exact approval transition atomically yields one command; absent/disabled binding yields none; approval replay yields no duplicate;
- same-person writer/approver is allowed, while approver-only identity is never used as writer;
- a later explicit byte-identical approval gets a new command and cannot satisfy the older unstarted command;
- binding edit/disable after enqueue cannot change the command snapshot; concurrent approval/disable follows commit order without losing an observed enabled intent;
- an otherwise unchanged disable can retain stale saved references, while creation/edit/re-enable validates every applicable Brand/Audience/Destination reference, including the deferred final Audience set;
- ordered audiences reach generated variants in authored order;
- revoked writer, stale package approval, stale Brand/Audience/Destination and invalid communication policy create no partial preparation and reach a visible terminal state;
- concurrent SKIP LOCKED claims, due/lease claim guards, attempt fencing, the exact seven retry delays, no ninth claim and current-attempt lineage rejection behave exactly as documented;
- crash or response/settlement loss after preparation commit reconciles one exact receipt, one Campaign and one generation, including at attempt eight; an expired eighth attempt without that receipt dead-letters;
- a manual preparation cannot reserve a source-command UUID before claim or substitute a different writer, configuration, package approval or fingerprint;
- web Origin/size/schema/actor/tenant/role boundaries fail before unauthorized repository work;
- status rendering, receipt links, no-backfill text and reapproval warning are accessible;
- successful and failed paths create zero Campaign instances, workflow commands, finalizations, Draft approvals, Campaign approvals, activations, publication actions and provider calls;
- all workspace tests, typechecks, lint, production builds, dependency audits, browser acceptance, production smoke and native regression gates pass.

Focused success is not the same as whole-product completion or production certification. Provider/OIDC deployment acceptance, signing/distribution and later end-to-end activation remain separately controlled work.
