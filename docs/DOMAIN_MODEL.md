# Domain Model and Important Variables

## Current implementation: 1.22 preparation and retry identities

`compileGeneralAnnouncementPreparation(input: unknown)` returns frozen normalized settings, fixed-order canonical JSON and an ordinary non-executable `CampaignDraftWrite`. `GENERAL_ANNOUNCEMENT_TEMPLATE_KEY = general_announcement`, template version `1`, are server-owned semantics, not an execution grant. Ordered audience IDs (maximum 20), exact package revision, optional current published profile pins, optional unversioned Destination, contextual/informational/UTC defaults and bounded normalized text are documented with every limit in [Campaign preparation contracts](CAMPAIGN_PREPARATION.md).

`CampaignPreparationRepository.prepare(input, idempotencyKey, actorUserId)` returns `{ preparation, replayed }`; the actor is authenticated server identity, and the UUID key is separate from canonical settings. Migration 0111 stores `campaign_preparation`: workspace/key uniqueness, template/revision, full canonical bytes, SHA-256, normalized/reference snapshots, exact Campaign/planning/generation IDs, ordered initial `{draftId, versionId}` references, actor and database timestamp. Immutable receipts persist across later source/profile/draft changes; they are not current approval. No expiration or deletion API exists.

Transaction-local profile Maps separate sorted lock order from user-authored variant order. New helper return values contain exact created IDs and never hydrate through mutable current pointers. `publishExactCampaignDraftInTransaction` only compares identity: an existing mutable draft requires additional content-revision safeguards before future finalization. The shared `CommunicationPolicyInput` now explicitly allows SQL-null settings; both most-specific selection and least-permissive-ceiling selection ignore null/undefined without ignoring a real lower ceiling.

## 1.21 historical evidence contracts

`content_draft_claim_evidence.evidence_item_id` retains a historical UUID from the owning draft generation's `evidence_snapshot`; migration 0110 removes its live-evidence foreign key, not the claim-owned lifecycle. A current live row may no longer exist or may describe a newer revision. Historical reads must use the captured snapshot.

`draft_claim_snapshot_reference_valid(claim_id uuid, evidence_id uuid) -> boolean` validates exact lineage, nonnegative contiguous whole-version factual order, unique snapshot IDs, matching captured claim text/provenance and server-created `presentation_choices.factOrder`. `enforce_draft_claim_snapshot_reference()` guards new/revised link rows and forbids identity replacement. Backfill is limited to entirely unlinked, provable claims; inconsistent surviving data is not rewritten or augmented with guesses.

Writer-local `{claimId, sortOrder, claim}` arrays permit complete claim insertion before link validation within one transaction. Revision `evidenceValid` query fields are derived proof results, not persisted mutable approval state. `describeDraftClaimTrace` returns a display-only `linked | unavailable | presentation` status and text; it grants no authority. There is no new environment variable, secret or mutable global. [Evidence retention](EVIDENCE_RETENTION.md) documents collection lifetimes, gaps and acceptance.

## 1.20 scheduling contracts

The following additions govern implemented bounded scheduling. They do not make every value in the schedule/action enums executable. See [Scheduling contracts](SCHEDULING_CONTRACTS.md) for the detailed authority and clock contract; 1.19 and earlier records below remain historical context.

| Type, field or constant | Purpose and invariant |
| --- | --- |
| `CampaignStep.dependencyDelaySeconds`; `MAX_DEPENDENCY_DELAY_SECONDS = 31536000` | Optional at source-compatible call sites, normalized to zero on persistence; a safe integer in `[0,31536000]`. Positive delay requires at least one dependency. `campaign_step.dependency_delay_seconds` has matching integer/database constraints. Save/read/form/approval projections preserve it. |
| `StepScheduleInput` | The pinned step's dependencies, schedule type, exact time, preferred bounds and delay. Exact time supplies only a lower bound. Preferred bounds are finite ordered absolute instants with an exclusive end. |
| `StepSchedulePredecessor[]` | `{stepKey,status,completedAt?}` evidence for the same instance and pinned version. Exactly one matching successful/partially-successful record with its first durable completion is required per dependency. Duplicate/missing evidence cannot unlock work. Optional skipped/partial success retains the existing dependency-satisfaction rule. |
| `StepScheduleState` | Discriminated union: `waiting_dependencies` includes `missingDependencies[]`; `waiting_until` requires `notBefore`; `ready` may carry bounds; `expired` carries `deadline` and `reason: deadline_reached \| no_legal_time`. Bounds are ISO UTC strings. |
| `StoredStepScheduleState` | Adds `workspaceId,campaignId,campaignInstanceId,campaignVersionId,campaignStepRunId,stepKey,evaluatedAt,predecessors`. `evaluatedAt` is the database clock sampled with the stored evidence, not a client timestamp. Historical sub-millisecond lower bounds/completions round up and deadlines round down. |
| `evaluateStepSchedule(step, predecessors, now)` | Pure earliest-legal-start evaluation. Effective lower bound is the maximum of the authored lower bound and every required completion plus delay. A lower bound at/after the deadline produces `no_legal_time`; equality with the deadline is never eligible. It does not reserve a slot or predict provider completion. |
| `CampaignScheduleNotReadyError.schedule` | Exact stored no-admission evidence. Expired state uses issue code `execution_schedule_expired`; waiting states use `execution_schedule_not_ready`. A typed expiry may become blocked only after exact outcome recovery rules are satisfied. |
| `CampaignScheduledStepExecutionInput` | Legacy instance/step/context input plus mandatory workspace, campaign, version and step-run IDs. Contains **no caller deadline**. `assertScheduleEvidence` compares every identity before accepting evidence/recovery. |
| `CampaignSchedulingActivities` | Adds `getStepScheduleState` and `executeScheduledStep` to existing activities. The scheduled path opts into `allowBoundedScheduling:true`; the pure validator/legacy authority default remains false. This option permits implemented structure, not provider or approval bypass. |
| `CampaignStepExecution` | `succeeded + output`, `manual_required + reason`, or `schedule_blocked + reason + expired StoredStepScheduleState`. Uncertain in-flight outcomes are manual-required, never inferred safe expiry. |
| `recoverScheduledExecution(input)` | Read-only exact-lineage recovery. Returns prior success or unresolved manual-required; `undefined` means no matching prior action/known failed action, so new dispatch still needs authority. The publication key is `campaign:{instanceId}:step:{stepKey}:publish`, not caller-chosen recovery identity. |
| `ChannelDispatchOptions` | Server-only `dispatchDeadlineAt` (UTC epoch milliseconds) and optional `dispatchMonotonicDeadlineAt` (same-process `performance.now()` cutoff). Never serialize the monotonic value across hosts or persist it as plan data. |
| `ChannelRequestBudget` | One `signal`, integer `timeoutMs` and `run(operation)` wrapper for request plus body. Timeout is the minimum of ordinary timeout and UTC/monotonic time remaining. `ChannelDispatchDeadlineExceededError.reason` is `invalid \| expired` and means no request started. |
| `recordConnectionTest(..., expected): Promise<boolean>` | Optional expected ciphertext/configuration snapshot protects a preflight result from overwriting a changed or revoked connection. The locked comparison returns false on mismatch; runtime callers stop. Neither snapshot nor ciphertext belongs in browser/telemetry output. |
| `schedule_blocked` | Added step-run status with closed reason/evidence. Cannot return to waiting/running/manual/success; cancellation preserves the first evidence. Terminal success/partial-success writes preserve first completion/output/attempt count, keeping dependency-delay anchors stable. |

### V2 deterministic workflow collections and context

These values are per workflow execution, reconstructed from Temporal history. They are not cross-workspace mutable globals or substitutes for repository authorization.

| Local state | Intent |
| --- | --- |
| `states: Record<stepKey,state>` | Query-visible branch state, including `manual_resolution` and `schedule_blocked`. Success wakes dependents only after its durable state write. |
| `revision: number` | Wake counter changed by accepted signals and durable completion. Captured before schedule reads so a concurrent signal cannot be missed while awaiting an activity. |
| `decisions: Map`; `requestedApprovals: Set` | Pending decisions and already-requested keys. Ignore stale/direct approval signals for unrequested keys. Whole-campaign scope remains reserved `__campaign__`. |
| `manualOutputs: Map<stepKey,Record<string,unknown>>` | Only accepts current manual-resolution targets in a nonterminal/nonblocked workflow; early completion signals are not buffered for future execution. |
| `paused,canceled,blocked,campaignApproved,failure` | Workflow control state. A block cannot be resumed; cancellation wakes pending branches but permits already-dispatched activities to settle without replacing accepted/uncertain results. |
| Branch `runId,approved,waitUntil` | First resolved immutable step-run ID, consumed review state, and optional workflow-wait duration deadline. `waitUntil` uses deterministic workflow time only for the wait operation, never as a predecessor completion anchor. |
| `context["schedule.<stepKey>"]` | Last stored scheduling evidence read for the branch. |
| `context["schedule.blocked.<stepKey>"]` | First blocked `{reason,schedule}` evidence; persisted step output also carries `scheduleBlocked`. |
| `context["steps.<stepKey>"]` | Step result output; dependents wake only after the successful database state write. `execution.validation` contains graph/policy issues; `execution.failure` contains the workflow failure message. `measurement.success` remains unchanged. |

The static patch marker is `bounded-scheduling-v1`; frozen legacy source/policy digests protect recorded 1.19 replay. Exact step-review snapshots add version/run/key, window bounds, dependencies and normalized delay to the existing content/capability/method/autonomy fields. Campaign-wide review still pins the complete version/step snapshot. The form's delay value and calendar labels are presentation state only.

Window-route checks require one official-API text publication through Discord, Slack or Mastodon with zero attachments. Raw stored capability JSON uses `supportedActions.publish_content`; the database client can expose that as `publishContent`, so authority reads handle the normalized form without treating missing/false permission as enabled. Any bounded plan containing `user_assisted` receives `bounded_companion_unsupported`, even when that companion step itself is immediate. Recurring, evergreen, conditional and follow-up values remain preserved authoring vocabulary, not execution support.

## 1.19 implementation contracts (historical)

The following contracts describe the 1.19.0 implementation. See [Releases](RELEASES.md) for verification evidence and [Implementation status](IMPLEMENTATION_STATUS.md) for limits rather than inferring support from enum values or saved fields.

| Contract or field | Purpose and invariant |
| --- | --- |
| `ACTIVE_WORKSPACE_COOKIE = "mm_active_workspace"`; `ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS = 604800` | Browser selection hint, HttpOnly, SameSite=Lax, path `/`, Secure in production. It conveys no role or permission and is cleared on logout. |
| `getActiveWorkspaceSelection(userId)` | Request-scoped `{ workspace: WorkspaceAccess \| undefined, workspaces: readonly WorkspaceAccess[] }`, read from current membership. `getActiveWorkspace(userId)` returns only the selected membership. Call with the authenticated session's user ID. |
| `WorkspaceAccess` | `{workspaceId, organizationId, workspaceName, role}` from the repository. The picker sends only an ID; the server re-reads authority. |
| `WorkspaceSwitchState.error` | Optional bounded application-authored UI failure text. Form inputs are one `workspaceId` UUID and an optional `returnPath`; `WORKSPACE_SECTION_PATHS` is the closed set of safe section roots. Detail/query values fall back to `/`. |
| `StepDraft` | Editable projection of step identity/name/type, `capability`, comma-separated dependencies, `approvalRequired`, schedule type/timestamps, condition JSON, execution-method list, `optional`, `maxAttempts`, `timeoutSeconds`, and input/output JSON. `serializeStepDraft` restores `CampaignStep` without dropping advanced fields. |
| `toUtcDateTimeInput` / `fromUtcDateTimeInput` | Convert ISO instants to explicit UTC `datetime-local` text and back to ISO `Z`. Preserve second/millisecond precision; reject malformed or normalized impossible dates. `condition`, `inputs`, and `outputs` must decode to JSON objects, never arrays or scalar values. |
| `CampaignAgendaEntry` | `{id,campaignId,campaignName,stepName,href,origin,status,runStatus?,scheduledAt?,timezone,timing,warnings,finished}`. `origin` is `run`, `draft`, or `published_plan`; a plan is never labeled queued. Entries from a run use its exact `campaignVersionId`. |
| Dashboard transient sets/maps | `OPEN_RUN_STATUSES` contains awaiting approval, scheduled, active, and paused. `FINISHED_STEP_STATUSES` classifies terminal steps. Campaign-name and definition-by-instance maps join only authorized workspace reads; they are render-local projections, not stored business state. |
| `CampaignExecutionIssue` | Closed policy codes: `autonomy_execution_disabled`, `reserved_step`, `unsupported_schedule`, `unsupported_condition`, `invalid_schedule`. Authoring preserves future plan fields; execution refuses unsupported meaning. |
| `campaignStepRequiresApproval` | Explicit step approvals and `request_approval` always require review; pure waits do not acquire an implicit review. Approval-required, uncertain, first-occurrence, and confidence modes conservatively require step review. Fully autonomous/custom modes honor explicit step gates; campaign-approval mode adds the whole-campaign gate. Provider-specific human-review constraints still apply. |
| `__campaign__` | Reserved workflow approval signal key, forbidden as a normal authored step ID. Whole-campaign approval has `campaign_step_run_id = NULL` and `request_snapshot.campaignVersionId` matching the instance's immutable version; `approvalScope`, timezone, and steps explain the decision. |
| `humanApprovalGranted` | Execution-target projection of an approved exact step or, for campaign-approval mode only, a matching approved campaign-version snapshot. A mode label by itself does not create approval. |
| `retryPublicationAction(id, target, request): Promise<boolean>` | `request` carries the actual rendered `content` and optional `subject`, which must equal the original action snapshot. Rechecks the exact original target and current authority, then atomically claims only a failed action. `true` means this caller owns the dispatch; `false` means no dispatch permission. Callers must stop without sending or overwriting the active row on `false`. Missing/partial historical provider identity is not safe retry evidence. |
| `expectedAttemptCount` | Positive integer fencing token carried from a claimed Mastodon collection target into snapshot and completion writes. A replaced claim cannot overwrite current schedule or aggregate state. Omitted only for the existing explicit manual snapshot path. |
| `MastodonReportCollectionResult` | `{claimed,succeeded,failed,superseded,alertsActive,alertsResolved,alertReconciliationFailed}`. All counts are aggregate operational data. A reconciliation failure sets the Boolean and zero placeholder alert counts; do not interpret those zeros as proof of health. |

`mastodon_status_report_collection_alert` (migration 0108) stores `id`, `workspace_id`, `alert_type` (`overdue|abandoned`), `status` (`active|resolved`), positive `affected_count`, `oldest_at`, `first_detected_at`, `last_detected_at`, and optional `resolved_at`. A partial unique index allows one active row per workspace/type. Resolution retains history; a later incident creates a new row. List reads return at most 100 rows, active first. No account identity, provider URL, token, interacting person, or provider response is copied into incident rows.

`reconcileMastodonStatusReportCollectionAlerts(maxAgeSeconds)` accepts 3,600–2,592,000 seconds and returns `{active,resolved}` for the reconciliation pass. `active` counts inserted/refreshed active groups. A competing observer that cannot take advisory lock `(129691,119)` returns zero counts without observing; it does not declare fleet health. The all-schedule operations summary and alert eligibility intentionally have different horizons/grace semantics.

The executable definitions live in `packages/domain/src/index.ts` and `packages/domain/src/policies.ts`. This document explains their intent; code remains authoritative when details differ.

## Core entities

- **Workspace** — tenant boundary for membership, defaults, budgets, permissions, and audit scope.
- **SmartSource** — explicitly selected external locations plus filters, readiness rules, stabilization, context bindings, and autonomy. A Smart Source never scans beyond its selected locations.
- **ContextPack** — versioned collection of approved source references, selected sections, structured facts, instructions, and authority rules.
- **ContentPackage** — normalized bundle of source assets, evidence-backed facts, derivatives, audience variants, destination recommendations, confidence, and review state.
- **BrandProfile** — voice, identity, terminology, claims, prohibited language, accessibility, and compliance rules.
- **AudienceProfile** — audience needs, channels, relationship constraints, and communication preferences.
- **Destination** — registry entry for any location a marketing action may reference, with exact external identifiers and semantic metadata.
- **Campaign** — stateful graph of ordered/parallel actions, dependencies, conditions, waits, schedules, approvals, retries, budgets, experiments, and stop conditions.
- **ConnectorCapability** — live statement of what an adapter can currently do and through which execution method.
- **Conversation** — continuity, participants, prior messages/actions, ownership, consent/contact constraints, and handoff status.
- **AuditEvent** — immutable trace of decisions and changes joined by correlation/causation IDs.

## Important constant tuples and derived unions

The exported `as const` tuples are the canonical ordered value sets. TypeScript union types are derived from them so UI options, validation, storage mappings, and policy functions share one vocabulary.

- `INFORMATION_DEPTHS`: `minimal`, `teaser`, `contextual`, `detailed`, `comprehensive`, `custom`.
- `PROMOTIONAL_STRENGTHS`: `informational`, `subtle`, `light`, `standard`, `strong`, `campaign_push`, `custom`.
- `READINESS_MODES`: `immediate`, `related_files`, `ready_marker`, `ai_recommended`.
- `AUTONOMY_MODES`: `draft_only`, `approval_required`, `approve_uncertain`, `approve_first_occurrence`, `campaign_approval`, `confidence_based`, `fully_autonomous`, `custom`.
- `PACKAGE_STATUSES`: lifecycle from `detecting` through `completed`, including `needs_review`, `approved`, and `failed`.
- `EXECUTION_METHODS`: `official_api`, `local_browser`, `user_assisted`, `manual_handoff`.
- `CONTEXT_PACK_STATUSES`: `draft`, `published`, `archived` for the stable pack lifecycle; version rows additionally use `superseded`.
- `CONTEXT_SOURCE_KINDS`: `source_item`, `manual_text`, `url`.
- `CONTEXT_FACT_STATUSES`: `proposed`, `accepted`, `conflicted`, `unresolved`.

Do not reorder persisted enum values merely for display. Add a database migration and compatibility mapping when values change.

## Important arrays and maps

- `SmartSource.locations[]` is an allow-list of provider folder/location IDs. The ID, not a display path, is authoritative.
- `SmartSource.allowedMimeTypes[]` and `ignorePatterns[]` bound detection before expensive work occurs.
- `SmartSource.contextPackIds[]` binds explicit knowledge to a source without copying or silently rewriting it.
- `ContentPackage.assets[]` keeps originals and derivatives related through `sourceAssetId` and content hashes.
- `ContentPackage.evidence[]` stores claim text, provenance kind, source references, and confidence separately from generated copy.
- `Campaign.steps[]` forms a directed graph using `dependsOn[]`; validate acyclicity before activation.
- `CampaignStep.inputs` and `outputs` are string-keyed JSON dictionaries for data passed between steps. Keys must be namespaced and versioned when they cross workflow boundaries.
- `PolicyOverrideSet` is a partial map keyed by scope: `workspace`, `brand`, `smartSource`, `audience`, `platform`, `campaign`, `post`. The most specific defined value wins.
- `ContextPackVersion.sources[]`, `facts[]`, and `authorityRules[]` form one immutable published snapshot. Facts retain structured values rather than display-only strings.
- `EvidenceItem.sourceReferences[]` records provider items, Context Pack versions, or Learning Review records. `supersededByEvidenceId` preserves corrected history.

## Readiness evaluation

`evaluateReadiness(source, candidate)` returns a discriminated result with `ready`, `reason`, and optional `missingRequirements`. It always checks stabilization first.

1. `immediate` — ready after stabilization.
2. `related_files` — ready when the configured companion-file count is met.
3. `ready_marker` — ready when the configured marker is present.
4. `ai_recommended` — ready only when a recommendation exists, recommends readiness, and meets the configured confidence threshold.

AI cannot waive stabilization. Unknown or incomplete input remains not ready and includes a human-readable reason.

## Override precedence

`resolveScopedValue(overrides)` scans content-control scopes from most specific to broadest: post/action, campaign, platform/destination account, audience, Smart Source, brand, workspace. `undefined` means inherit; explicit falsy values must not be collapsed with `||`. Other policy families may define a narrower scope set, but must preserve the approved campaign-above-destination ordering when those scopes intersect.

## Identifier and time conventions

- IDs are opaque strings at domain boundaries; production adapters should generate UUIDv7 values.
- API JSON uses ISO 8601 UTC strings. Database timestamps use timezone-aware columns.
- Durations use explicit units in variable names, such as `stabilizationWindowSeconds`.
- Money is stored as integer minor units plus ISO currency code; never as binary floating point.
- Confidence is a number in `[0, 1]` and must state what decision it qualifies.

## Persisted account and connector records

- `organization` owns workspaces; `organization_membership` assigns `owner`, `admin`, `member`, or `viewer`.
- `workspace_membership` assigns `owner`, `admin`, `editor`, `approver`, `analyst`, or `viewer`. Only owner/admin/editor currently mutate Smart Sources.
- `app_session.token_hash` is the SHA-256 base64url digest of the browser bearer token. `expires_at` is authoritative.
- `storage_connection` holds provider identity, scopes, token expiries, status, and encrypted token envelopes. Domain objects reference its opaque UUID.
- `oauth_state` binds a state hash to one user, workspace, provider, PKCE verifier, return path, and expiry. Successful consumption deletes it.
- `smart_source.version` increments on edits; location rows are replaced transactionally so a version describes one coherent allow-list.
- `smart_source_test_run.diagnostics` is a JSON list of stable `code`, human-readable `message`, and `severity` values.
- `audit_event.data` is a small JSON dictionary for non-secret event metadata. It must not contain credentials or source content.

## Storage ingestion records

- `connector_cursor` stores one authoritative provider cursor per connection and Smart Source location scope.
- `connector_sync_run` records bounded attempts and discovered/changed/deleted counts without content bodies.
- `source_item` is the active normalized metadata index. `(smart_source_id, provider_item_id)` is unique; `deleted_at` preserves tombstones.
- `ingestion_event` is the replay-safe bridge to stabilization and Content Package construction. Its `idempotency_key` combines provider item, event kind, and content/version evidence.
- `NormalizedStorageEntry` is the provider boundary dictionary: provider, provider/parent IDs, name, MIME type, folder flag, size, modified time, content hash, etag, and web URL.

## Webhook and reconciliation records

- `WebhookSubscriptionTarget` is the desired tuple of workspace, storage connection, provider, and canonical provider resource. Targets are derived from enabled remote Smart Sources, not accepted from public requests.
- `webhook_subscription.provider_subscription_id` is the provider channel/subscription identifier; `provider_resource_id` is required to stop Google channels. `client_state_hash` stores only the verification digest.
- `webhook_event.provider_event_id` is `google:<messageNumber>` for Drive channels and `microsoft:<notificationId-or-hash>` for Graph. The subscription/event pair is the idempotency boundary.
- `webhook_event.status` is `pending`, `processing`, `completed`, `failed`, or `dead_letter`. `attempt_count`, `next_attempt_at`, `claimed_at`, and `last_error` make retries inspectable and bounded; a five-minute stale claim is recoverable after worker termination.
- `GoogleNotificationInput` contains only bounded `X-Goog-*` routing metadata. `MicrosoftNotificationInput` retains basic change/lifecycle metadata but never treats it as authoritative resource content.

## Context Pack records and authority resolution

- `context_pack` is the stable identity and points at its current published version.
- `context_pack_version` carries `version_number`, lifecycle status, instructions, authority-rule JSON, creator, and publication time. Published content is never mutated.
- `context_pack_source` identifies a manual excerpt, HTTPS reference, or workspace-owned source item, plus selected sections, authority rank, optional text, and hash.
- `context_pack_fact` stores `fact_key`, structured `value_json`, source identity, confidence, fact status, and reviewer notes.
- `resolveContextFacts` groups candidates by fact key and canonical structured value. One value is resolved only when all candidates agree or an explicit rule identifies preferred sources that agree. Competing values produce a conflict; absent authority produces unresolved evidence.

## Content Package and Learning Review records

- `content_package` stores the source trigger, lifecycle status, confidence, exact `context_pack_version_ids`, and package version.
- `content_asset` stores the original/supporting/derivative role, file identity, MIME type, content hash, bounded extracted text, extraction outcome, and source metadata.
- `evidence_item` stores a claim separately from output copy with `observed`, `authoritative_context`, `inferred`, or `unresolved` provenance.
- `evidence_conflict.candidate_evidence_ids[]` names the admissible choices. Open conflicts and active unresolved evidence are hard approval blockers.
- `learning_review` records the actor and `conflict_resolved`, `corrected`, or `package_approved` action. Corrections append authoritative evidence and supersede the unresolved row without deleting it.

## Destination and campaign records

- `destination` is the workspace-owned canonical target. `canonical_url` is unique per workspace; `(provider, external_id)` is also unique when an external ID exists. `known_redirects[]`, `identifiers`, `topics[]`, `audiences[]`, `geography[]`, `language`, and `tracking` support resolution and measurement without changing identity.
- `DESTINATION_STATUSES` is `draft`, `published`, `unavailable`, `expired`, `replaced`, `archived`. Only `published` destinations may be activated. `replacement_destination_id` links a superseding target without deleting history.
- `campaign` is the stable authoring identity. `current_version_id` identifies the published version; at most one draft and one published version exist per Campaign.
- `campaign_version.content_package_ids[]` contains exact approved package UUIDs. `destination_id`, `objective`, `information_depth`, `promotional_strength`, `autonomy_mode`, `timezone`, and `context` are frozen at publication.
- `CAMPAIGN_OBJECTIVES` is the canonical persisted objective vocabulary. `CAMPAIGN_VERSION_STATUSES` is `draft`, `published`, `superseded`; `CAMPAIGN_STATUSES` covers authoring and execution lifecycle from `draft` through terminal or archived state.
- `campaign_step.step_key` is stable within one version and must match `[a-z][a-z0-9_-]*`. `depends_on[]` references sibling keys. `validateCampaignGraph` rejects duplicates, missing/self dependencies, cycles, invalid schedule windows, and retry/timeout bounds, and returns a deterministic topological order.
- `CAMPAIGN_STEP_TYPES` is the provider-neutral desired-action vocabulary: destination creation, publishing, notification, discovery, outreach, monitoring, response, lead collection, system update, approval, wait, analysis, evaluation, follow-up scheduling, and manual handoff.
- `SCHEDULE_TYPES` is `immediate`, `exact_time`, `preferred_window`, `recurring`, `evergreen_queue`, `dependency`, `conditional`, `follow_up`. Release 0.4 introduced immediate/dependency, exact-time and duration-wait behavior; 1.20 adds the bounded windows/dependency delays described above. Recurrence, evergreen, conditions and follow-up execution remain planned.
- `campaign_instance` binds one activation to an immutable version. `temporal_workflow_id` is globally unique, `context` contains runtime handoffs, and `requested_by` preserves the activating actor.
- `campaign_step_run` is the current observable state for one version step. `idempotency_key` is `campaign:<instanceId>:step:<stepKey>`. `attempt_count` increments only on a transition into `running`; duplicate activity delivery while already running is a no-op.
- `campaign_step_attempt` is append-only attempt history keyed by `(campaign_step_run_id, attempt_number)`. It captures the input snapshot, terminal output/error, and start/completion timestamps. A duplicate `running` write cannot add another attempt.
- `CAMPAIGN_STEP_STATUSES` is `planned`, `waiting`, `running`, `succeeded`, `partially_succeeded`, `temporarily_failed`, `permanently_failed`, `canceled`, `rolled_back`, `manual_resolution`, `schedule_blocked`. Optional rejected work uses `partially_succeeded`; required rejection uses `permanently_failed`. A missed bounded request-start window has its own blocked evidence rather than a fabricated provider outcome.
- `campaign_approval` snapshots the requested action and supports `pending`, `approved`, `rejected`, `changes_requested`, or `canceled`. A partial unique index permits only one pending approval for an instance/step pair.
- `campaign_workflow_command` is the transactional outbox. `command_type` is `start`, `pause`, `resume`, `cancel`, `approval_decision`, or `manual_step_completed`; `payload` is a bounded JSON dictionary; `idempotency_key` suppresses duplicate user/API delivery.

## Legacy workflow in-memory collections (through 1.19)

- `stepStates: Record<stepKey, state>` is deterministic workflow state reconstructed from Temporal history. It is not an independent database authority; activities mirror externally observable transitions to `campaign_step_run`.
- `approvalDecisions: Map<stepKey, decision>` holds signal values until the matching approval wait consumes them.
- `manualOutputs: Map<stepKey, Record<string, unknown>>` holds verified operator output until the matching manual step consumes it.
- `context: Record<string, unknown>` begins with the published version context. Completed output is added at the namespaced key `steps.<stepKey>` and returned in the final workflow result.
- `activeStepScopes: Set<CancellationScope>` contains only currently executing dependency-batch scopes. The cancel signal cancels every member so timers and waits stop promptly; scopes are removed in `finally` blocks.

## Publishing and measurement records

- `CHANNEL_PROVIDERS` initially contains `discord_webhook`. `NORMALIZED_CHANNEL_ACTIONS` is `publish_content`, `read_metrics`, and `monitor_events`; the Discord manifest supports only `publish_content` through `official_api` or `manual_handoff`.
- `ChannelCapabilityManifest` contains provider, version, observedAt, authentication methods, supported-actions dictionary, execution-method list, numeric limits, and feature flags. Capabilities are stored per connection so UI and workflow decisions use observed data rather than provider-wide assumptions.
- `channel_connection.encrypted_credentials` is an AES-256-GCM envelope. `configuration` holds non-secret provider identity; `capabilities` holds the observed manifest; status is `active`, `error`, or `revoked`.
- `publication_action` is the external side-effect ledger. Status is `dispatching`, `succeeded`, `failed`, or `ambiguous`; its stable key is `campaign:<instanceId>:step:<stepKey>:publish`. `request_snapshot` excludes credentials, while provider ID/URL and bounded response metadata prove confirmed delivery.
- `CampaignStepExecution` is a discriminated result: `succeeded` with output, or `manual_required` with a reason. Workflows never interpret a missing adapter as success.
- `tracked_link` separates random slug, canonical Destination URL, UTM dictionary, lifecycle, and Campaign/step association. One automated step has at most one tracked link, so activity retry reuses it.
- `measurement_ingest_key.key_hash` is the SHA-256 base64url digest of a high-entropy bearer secret; `key_prefix` is display-only. Status is `active` or `revoked`.
- `MeasurementEventType` covers activity signals, visits, leads/applications/registrations/subscriptions/purchases/bookings/donations/revenue, negative outcomes, and custom events. Availability and source remain explicit.
- `measurement_event.event_key` is unique within a workspace. Optional Campaign, instance, step, Destination, tracked-link, and publication IDs form the attribution chain and must belong to the ingest-key workspace. `value` is decimal and `currency` is an optional three-letter ISO code.
- `MeasurementSummary.totals` is `Record<eventType, {count, value}>`. It reports observed normalized events only; zero or absent provider metrics are not fabricated.

## Desktop companion records and protocol collections

- `COMPANION_PLATFORMS` is `windows`, `macos`, `linux`; `COMPANION_ARCHITECTURES` is `x86_64`, `aarch64`. The preview is built and runtime-verified on Windows x86_64; the other values reserve one compatible contract for later release validation.
- `COMPANION_ACTIONS` currently contains only `open_url`. `COMPANION_ACTION_MODES` is `confirm_before_submit` and `assisted`; automatic submission is deliberately absent from the preview.
- `COMPANION_WORKER_STATUSES` is `active`, `paused`, `revoked`. Health is a separate coarse state: `healthy`, `working`, `needs_attention`, or a derived `disconnected` when no heartbeat has arrived for 90 seconds.
- `companion_pairing_code` stores workspace, creator, SHA-256 `code_hash`, ten-minute expiry, use timestamp, and creation timestamp. The normalized display code is never persisted, and atomic `UPDATE ... RETURNING` consumption makes it one-use.
- `browser_worker` is the stable local-worker identity. It stores workspace, display name, platform, architecture, application version, status, coarse health, token prefix/hash, `capabilities: Record<string, boolean>`, bounded `health_details`, and heartbeat/revocation timestamps. Plaintext worker tokens never enter this record.
- `browser_job` is the local-action ledger. It stores one worker, action, action mode, credential-free HTTPS target, exact expected origin, `allowed_domains[]`, bounded instructions, status, globally unique idempotency key, claim-token hash, lease expiry, attempt count, result/error, actor, and lifecycle timestamps.
- `COMPANION_JOB_STATUSES` is `queued`, `claimed`, `succeeded`, `failed`, `canceled`, `expired`. The current repository reclaims a `claimed` job only after its lease expires; `expired` is reserved for later retention processing.
- `CompanionJobEnvelope` schema version 1 contains job/worker/workspace IDs, action/mode, target and expected origin, exact domain allowlist, instructions, idempotency key, plaintext claim token, issue time, and expiry. It is returned only to the authenticated worker with an HMAC-SHA-256 signature.
- `LocalConfiguration` is a local Rust structure, not a database row. It contains non-secret server URL, worker ID/name, emergency-pause flag, approved folder path, and at most 100 executed job IDs. The worker token is retrieved separately from the operating-system credential store.
- The companion capability dictionary currently uses `signedJobs`, `assistedOpenUrl`, `localFolderSelection`, and `osCredentialStore`. Keys are bounded to 32 entries and 80 characters; values are booleans so capability reporting cannot become an unbounded telemetry channel.

## Media and accessibility records

`content_asset` remains the authoritative asset metadata row. Release 0.7 adds:

- `source_asset_id`: derivative-to-original UUID relationship; deleting an original cascades its derivative metadata.
- `object_key`: opaque object-store locator. It is not a public URL and must never be accepted from a client as an arbitrary filesystem path.
- `byte_size`: verified byte count. The repository casts the PostgreSQL `bigint` to a JavaScript number because the configured source limit is below the safe-integer boundary.
- `processing_version`: invalidates cached work when algorithms or security controls change. Images use `image-v1`; PDF/OOXML text extraction uses `document-v1`.
- `recipe`: JSON dictionary containing the non-destructive transform: name, target dimensions, fit, quality, format, auto-orientation, and background.
- `media_status`: `stored`, `processed`, `unsupported`, or `failed`.
- `scan_status`: `clean`, `infected`, `not_configured`, or `failed`. `not_configured` is an explicit development state, never an alias for clean.
- `rights_status`: `unchecked`, `cleared`, `restricted`, or `expired`. Release 0.7 records the state; campaign-time rights enforcement remains required.
- `alt_text`, `alt_text_status`, and `accessibility_notes`: editable accessibility output and reviewer disposition. Status is `not_applicable`, `needs_review`, `approved`, or `decorative`.

`ProcessedMediaAsset` is the in-process dictionary returned by `MediaProcessor`. `clientKey` is unique only within one package transaction; `sourceAssetClientKey` resolves derivative lineage to the newly assigned asset UUID, and neither client key is persisted. `metadata` stores neutral inspection output such as detected MIME, extension, dimensions, format, color space, orientation, alpha, page count, scan engine, and source-provider references. Do not place bytes, credentials, prompts, or public URLs in this dictionary.

`IMAGE_DERIVATIVE_RECIPES` is the canonical ordered tuple:

- `thumbnail`: 320 by 320, cover, WebP quality 80.
- `web_preview`: at most 1200 by 1200, inside/no enlargement, WebP quality 82.
- `square_preview`: 1080 by 1080, contain on white, WebP quality 82.

Recipe order is deterministic but has no semantic priority. Change recipe values only with a new processing version so stored objects and audit records remain reproducible.

### Document extraction dictionaries and limits

`SUPPORTED_DOCUMENT_MIME_TYPES` is the exact MIME-to-kind dictionary: `application/pdf` to `pdf`, Word OOXML to `docx`, PowerPoint OOXML to `pptx`, and Excel OOXML to `xlsx`. `UNSUPPORTED_OFFICE_MIME_TYPES` explicitly covers legacy `.doc`/`.ppt`/`.xls` and macro-enabled `.docm`/`.pptm`/`.xlsm` families. File extensions are only companion-side MIME hints; server magic and OOXML package validation remain authoritative.

`DocumentExtractionResult` contains `kind`, `state`, optional `text`, `parser`, `parserVersion`, and neutral `metadata`. State is `completed`, `truncated`, or `requires_ocr`. Parser failures use `DocumentExtractionError.code`: `encrypted`, `malformed`, `resource_limit`, or `timeout`. Stored failures map to existing asset `extraction_status=failed`; truncation remains `completed` text plus an explicit review blocker so useful partial text is retained without being treated as complete.

`DEFAULT_DOCUMENT_EXTRACTION_LIMITS` is a frozen dictionary: `maxPages=250`, `maxTextCharacters=250000`, `maxArchiveEntries=1000`, `maxArchiveUncompressedBytes=67108864`, `maxXmlPartBytes=8388608`, `maxCompressionRatio=100`, and `maxDurationMs=30000`. Options may lower or deliberately override these positive finite values for a controlled worker deployment. Metadata records applicable ceilings, counts, parser identity, and result state; it never stores document bytes or secrets.

OOXML extraction reads Word main/header/footer/note/comment parts, PowerPoint slides in numeric order, and Excel shared strings plus worksheet rows/cells. Formulas, macros, external relationships, embedded objects, and executable content are not evaluated. `LocalManifestEntry.mimeType` now maps `.docx`, `.pptx`, and `.xlsx` to the exact supported MIME values.

## Campaign-bound companion records

Migration `0014_campaign_companion_routing.sql` adds nullable `browser_job.campaign_instance_id` and `browser_job.campaign_step_run_id`. They are either both null for an operator test job or both present for a Campaign job. Both references cascade with their Campaign records, the step run must belong to the instance and workspace, and one Campaign step run may own at most one companion job.

An assisted Campaign step uses this authoring dictionary:

- `desiredCapability`: exactly `open_url`.
- `executionMethods`: contains `user_assisted`; `manual_handoff` should remain as the visible fallback.
- `inputs.targetUrl`: optional credential-free HTTPS URL. When absent, the published Campaign Destination is used.
- `inputs.instructions`: trimmed user-facing text from 1 through 2,000 characters. `inputs.content` is the fallback; otherwise the router produces a bounded default.
- `inputs.companionWorkerId`: optional worker UUID and required when multiple eligible workers are online.
- `inputs.allowedDomains`: optional authoring-time validation list. The persisted job is always narrowed to the exact final target hostname.

An eligible worker has `status=active`, a heartbeat no older than 90 seconds, health `healthy` or `working`, and `capabilities.assistedOpenUrl=true`. `needs_attention`, derived `disconnected`, paused, and revoked workers are never selected. `StoredCompanionJob.campaignInstanceId` and `.campaignStepRunId` expose the trace in repository/API/UI read models.

Successful job completion appends a `campaign_workflow_command` with `command_type=manual_step_completed`, idempotency key `companion-job:<jobId>:completed`, and payload `{ stepKey, output }`. `output` preserves the bounded companion result and adds `companionJobId`. Failed completion records the job result/error but does not advance the Campaign.

## Local Smart Source manifest and byte state

A local Smart Source uses `smart_source.provider=local`, has no storage connection, and stores its assigned worker UUID as `smart_source_location.provider_location_id`. `display_path` is a non-sensitive label, not a device path. The assigned worker must be active, seen within 90 seconds, healthy/working, and report `capabilities.localFolderIngestion=true`.

`LocalManifestEntry` contains `providerItemId`, optional `providerParentId`, `name`, `relativePath`, `mimeType`, `isFolder`, `sizeBytes`, `modifiedAt`, and `contentHash`. Limits are 5,000 entries per manifest, 1,000 characters per relative path, 255 per name, and 10 MiB per uploaded file. The current companion skips empty, oversized, symlink, and non-regular entries.

`providerItemId` is `local:` plus lowercase SHA-256 of the normalized forward-slash relative path. `providerParentId` uses the same rule for the relative parent and is absent at the root. `contentHash` is `sha256:` plus SHA-256 of the bytes. Path identity detects rename/move separately from content deduplication.

Migration `0015_local_source_ingestion.sql` adds nullable `source_item.object_key`. A manifest change clears the key only when the content hash changes. A successful content upload sets it to `originals/<64-hex-content-sha256>/source` using immutable write semantics. `SourceItemRecord.objectKey` is an opaque server locator and is never accepted from the companion.

## Foreground local monitoring state

`LocalConfiguration.local_sync_interval_seconds` persists `0` (off) or 60 through 3,600 seconds and defaults to 60 for new and upgraded configuration. `last_local_sync_at` is an optional RFC 3339 UTC timestamp written only after all assigned-source manifests/uploads complete. Both values are non-secret local configuration; heartbeat exposes them as bounded health detail. `LOCAL_SYNC_ACTIVE` is process-only atomic state and is never serialized.

## Brand and Audience Profile records

- `PROFILE_STATUSES` is `draft`, `published`, `archived`; root rows use this lifecycle. `PROFILE_VERSION_STATUSES` is `draft`, `published`, `superseded`; at most one draft and one published version exist per root.
- `AUDIENCE_TYPES` is the closed tuple `consumer`, `business`, `professional`, `community`, `media`, `donor`, `applicant`, `partner`, `mixed`.
- `brand_profile` contains `id`, `workspace_id`, unique workspace/name, description, lifecycle, `current_version_id`, creator, and timestamps. It is versioned communication guidance, not the older foundation `brand` identity referenced by Destinations.
- `brand_profile_version.profile: BrandProfileData` contains `officialName`, optional `shortName`, description, `products[]`, `services[]`, `valuePropositions[]`, `voice`, `terminology`, `style`, CTA guidance, `claims[]`, evidence requirements, disclosures, attribution/competitor rules, visual guidance, and `channelPersonas: Record<string,string>`.
- `audience_profile` mirrors the Brand Profile root. `audience_profile_version` additionally stores one `audience_type` and `profile: AudienceProfileData` containing purpose, industries, roles, interests, locations, languages, knowledge level, needs, motivations, objections, questions, preferred channels/formats, relationship stage, familiarity, and exclusions.
- Lists accept at most 100 non-empty entries of at most 300 characters. Names are at most 200 characters; long guidance fields are bounded by the API schema. `channelPersonas` keys are at most 100 characters and values at most 2,000 characters.
- Both version tables expose optional `information_depth_default`, `information_depth_ceiling`, `promotional_strength_default`, and `promotional_strength_ceiling`. Defaults may be `custom`; ceilings deliberately cannot because a hard ceiling must be ordinal.
- `campaign_version.brand_profile_version_id` pins zero or one exact version. `campaign_version_audience_profile` pins zero to 20 exact Audience Profile versions with stable `sort_order`; the composite primary key forbids duplicates.

### Communication policy resolution

- `COMMUNICATION_POLICY_LEVELS` is the ordered tuple `workspace`, `brand`, `audience`, `destination`, `campaign`, `action`.
- `CommunicationPolicyInput` contains `source`, `level`, optional explicit information/promotional values, and optional ceilings. `source` is a human-readable trace label, never authorization.
- `resolveCommunicationPolicy(inputs)` returns effective values, their sources, the strictest ceilings, and typed `information_depth_ceiling` / `promotional_strength_ceiling` issues.
- At one level, multiple Audience defaults reduce to the least-intensive value. Across levels, the most-specific explicit value wins. Across all levels, the lowest ordinal ceiling wins. `custom` violates any active ordinal ceiling because it cannot be compared safely.
- Release 0.12 Campaigns always supply explicit information depth and promotional strength. Brand/Audience defaults are stored for generation and future inheritance UI; selected Brand/Audience ceilings are enforced during every Campaign draft write.

## Governed Draft dictionaries and records (Release 0.14)

- `DRAFT_STATUSES`: `working`, `pending_review`, `approved`, `rejected`, `changes_requested`, `archived`.
- `DRAFT_VERSION_STATUSES`: `working`, `pending_review`, `approved`, `rejected`, `changes_requested`, `superseded`.
- `DRAFT_CLAIM_KINDS`: `fact`, `call_to_action`. A `fact` requires one or more evidence IDs from the generation snapshot. `call_to_action` is presentation-only and has no evidence IDs.
- `DRAFT_FORMATS`: `channel_neutral`, `social_short`, `social_standard`, `email`, `article_intro`, `community_reply`, `direct_message`.
- `DRAFT_FORMAT_CHARACTER_LIMITS` is a read-only format-to-ceiling dictionary: `channel_neutral=unbounded`, `social_short=280`, `social_standard=1000`, `email=4000`, `article_intro=5000`, `community_reply=2000`, and `direct_message=1000` characters.
- `draft_generation`: immutable group-level inputs: workspace, exact Campaign version, Content Package ID plus captured numeric version, optional exact Brand Profile version, information depth, promotional strength, `draft_format`, evidence snapshot, generator provider/model/version, prompt version, actor, and timestamp.
- `content_draft`: one audience-specific root in a generation group, with optional exact Audience Profile version, lifecycle status, and exact current version pointer. The repository emits one general Draft when the Campaign has no Audience Profile pins.
- `content_draft_version`: immutable copy payload (`headline`, `body`, optional `callToAction`, `hashtags[]`, optional `altText`), generator `rationale`, structured `presentationChoices`, optional predecessor `sourceVersionId`, optional `changeNote`, actor, and timestamp.
- `content_draft_claim`: ordered typed statement owned by one Draft version. `content_draft_claim_evidence` records zero-to-many exact evidence IDs; zero is allowed only for `call_to_action`.
- `content_draft_approval`: workspace, Draft root, exact submitted Draft version, status, immutable request snapshot, requester/reviewer/decision actors, notes, and timestamps. A partial unique index permits at most one pending approval per Draft.

The initial depth dictionary maps to factual claim limits: `minimal=1`, `teaser=1`, `contextual=2`, `detailed=4`, `comprehensive=all`, and `custom=2` until a custom policy contract exists. Evidence orders `authoritative_context`, `observed`, then `inferred`; active unresolved or superseded evidence is excluded. Promotional strength maps only to a presentation call to action and never changes the selected fact set.

`presentationChoices` records audience name (or `general`), brand name (or `workspace default`), first configured brand tone (or `clear`), audience knowledge level (or `general`), ordered `factOrder[]`, `format`, optional `characterLimit`, `characterCount`, and optional safe `leadIn`. These fields explain presentation intent; they are not new authoritative facts.

A successor revision is legal only while the current version is `working` or `changes_requested`. `leadIn` is trimmed and may not contain `.`, `?`, or `!`, so it cannot carry a new factual sentence. Hashtags must be unique and match `#[A-Za-z0-9_]+`. The repository copies every predecessor fact and evidence binding exactly, requires at least one fact, rebuilds the body, verifies the format ceiling including the call to action, supersedes the predecessor, and writes `sourceVersionId` plus the required change note.

## Channel preview records (Release 0.15)

- `DRAFT_CHANNEL_PREVIEW_STATUSES` is the closed tuple `ready`, `blocked`.
- `ChannelPreviewInput` contains exact Draft `body`, optional `callToAction`, ordered `hashtags[]`, and optional canonical `destinationUrl`. It contains no credential, provider request, fact editing, or arbitrary template.
- `ChannelPreviewResult` contains untruncated `content`, `characterCount`, optional `characterLimit`, and ordered validation `issues[]` with codes `publish_unsupported`, `content_empty`, or `content_limit`.
- Composition order is body, call to action, hashtags, Destination; non-empty sections are separated by two newline characters. Character count is JavaScript string length of the exact stored content.
- `draft_channel_preview` binds exact `content_draft_version_id`, active `channel_connection_id`, optional published `destination_id`, provider, capability version/observation time/snapshot, readiness status, rendered content, counts/limit, issues, actor, and time.
- `isStale` is derived when the current connection capability observation timestamp differs from the snapshot or the connection is no longer active. It is not persisted status because freshness depends on live connection state.
- `UNIQUE NULLS NOT DISTINCT (content_draft_version_id, channel_connection_id, destination_id)` permits one current snapshot per exact combination, including the no-Destination case. Every replacement emits a separate audit event.

## Exact-preview Campaign input contract (Release 0.16)

- `campaign_step.inputs.draftChannelPreviewId` is an optional UUID string used only by `publish_content` execution.
- The preview's `channel_connection_id` becomes the execution connection when `channelConnectionId` is absent. If both are present, they must match.
- The preview Destination must be exactly identical to the Campaign version Destination, including both being absent. `appendDestination=true` and `useTrackedLink=true` are invalid with an exact preview.
- Activation requires preview `ready`, exact Draft version `approved` and still current, active connection with unchanged `capabilities_observed_at`, same workspace, and a generation whose Campaign version belongs to the same Campaign root.
- `CampaignExecutionTarget.draftPreviewContent`, `draftPreviewVersionId`, and `draftPreviewEligible` are runtime read-model fields. They are derived, never client authority.
- Publication `request_snapshot` records `draftChannelPreviewId` and `draftVersionId` beside exact content/provider/Destination data.

## Guided Campaign preview read model (Release 0.17)

`StoredCampaignPreviewOption` extends `StoredDraftChannelPreview` with authoring-only context:

- `campaignId`, `sourceCampaignVersionId`, and `sourceCampaignVersionNumber` prove and explain the originating Campaign lineage;
- `draftHeadline` and optional `audienceName` identify the human-reviewed variant;
- `isCurrentApprovedVersion` is derived from both the Draft's current-version pointer/status and the exact version's approved status;
- inherited `status`, `validationIssues[]`, `isStale`, Channel Connection identity, Destination identity, provider/capability fields, exact content, and character counts explain delivery readiness.

`PreviewEligibility` contains `eligible: boolean` and ordered human-readable `reasons[]`. Eligibility requires current exact approval, `ready`, not stale, and `(option.destinationId ?? "") === campaignDestinationId`. It is a presentation model only; it never becomes saved authority.

`writeDraftChannelPreviewId(inputJson, previewId)` accepts only a JSON object. Selecting a preview sets `draftChannelPreviewId`, removes `appendDestination`, `useTrackedLink`, `channelConnectionId`, and `channel_connection_id`, and preserves all other keys. Clearing the selection removes only `draftChannelPreviewId`. Invalid JSON or an array cannot be mutated through the picker.

## Approved tracked-preview contract (Release 0.18)

- `linkMode` is `canonical` or `tracked`; tracked requires a published Destination and configured HTTP(S) `APP_BASE_URL` origin.
- `trackedLinkId`, `trackedLinkSlug`, and `trackedLinkStatus` expose lifecycle/readiness, not credentials.
- One preview exists per exact Draft version, Channel Connection, Destination, and link mode. One tracked link belongs to one preview through `draft_channel_preview_id`.
- Tracked UTM fields are fixed to `utm_source`, `utm_medium`, `utm_campaign`, and `utm_content`; redirect reads preserve these snake-case dictionary keys exactly.
- `draftPreviewTrackedLinkId` enters the publication request snapshot/measurement ledger while exact stored content remains byte-for-byte unchanged.

## Exact preview attachment contract (Release 0.19)

- `StoredDraftChannelPreview.assets` is an ordered readonly list of `StoredDraftPreviewAsset`; an empty list preserves text-only behavior.
- Each item contains `contentAssetId`, `sortOrder`, optional `sourceAssetId`, `objectKey`, `contentHash`, `fileName`, `mimeType`, `byteSize`, optional `altText`, `altTextStatus`, `scanStatus`, and `rightsStatus`.
- Allowed MIME values are the closed union `image/jpeg | image/png | image/webp | image/gif`. `sortOrder` is 0–9, byte size is 1–10 MiB, and one content asset may appear only once per preview.
- `altTextStatus` is `approved` or `decorative`. Approved requires non-empty text within the provider description limit; decorative intentionally has no provider description. A derivative inherits these fields from `sourceAssetId`.
- Current development safety states are `scanStatus: clean | not_configured` and `rightsStatus: cleared | unchecked`; infected/failed/restricted/expired assets are rejected. The non-production states stay visible to the operator and are immutable in the preview record.
- `PublishAttachmentInput` contains safe `fileName`, closed `mimeType`, optional `description`, and runtime-only `Uint8Array data`. Raw bytes never enter the database model, API response, audit metadata, or publication request snapshot.
- `CampaignExecutionTarget.draftPreviewAssets` carries exact snapshot metadata from the server repository. Clients cannot author it.

## Provider preflight contract (Release 0.20)

- `PublishingRepository.getPublicationActionByIdempotencyKey(key)` returns the one stable side-effect-ledger row before media, credential, or network work begins.
- Existing `succeeded` returns its stored provider output. Existing `dispatching` or `ambiguous` is never resent automatically and transitions the workflow to manual resolution. Existing `failed` may be retried only after a new successful provider preflight.
- `DiscordWebhookConnector.testConnection()` returns a non-secret `providerIdentity` dictionary. The currently enforced keys are `webhookId`, `guildId`, and `channelId`.
- `sameProviderTarget(expected, observed)` compares only provider identity keys already stored as strings. A missing or changed observed value for a stored key is drift; an older connection with no stored keys may adopt the first successful observed identity.
- `providerPreflight` in `publication_action.request_snapshot` is `{ checked: true, targetIdentity: Record<string, string> }`. It records the live observed identity for audit correlation and never contains the webhook URL/token.
- A successful connection-test record refreshes `lastTestedAt`, status, and provider identity but intentionally leaves `capabilitiesObservedAt` unchanged. Provider identity health and the exact approved capability snapshot remain separate clocks.
- Any preflight failure sets connection status to `error`. Existing previews then fail current readiness until the connection is successfully tested and the governed preview is rendered again where capability freshness requires it.

## Campaign success-criteria contract (Release 0.21)

- `MEASUREMENT_EVENT_TYPES` is the closed 24-value tuple used by both `MeasurementEventType` and Campaign goal validation.
- `CampaignSuccessCriterion` is `{ id: string; eventType: MeasurementEventType; targetCount: number }`.
- `id` matches `^[a-z][a-z0-9_-]*$`, is unique within one version, and remains the stable human/audit key. One version may contain at most 20 criteria.
- `targetCount` is an integer from 1 through 1,000,000,000. Release 0.21 deliberately models counts, not currency/value sums.
- `CampaignVersion.successCriteria` is a readonly ordered list persisted as `campaign_version.success_criteria`; `CampaignDraftWrite.successCriteria` is optional for backward-compatible internal callers and normalizes to an empty list.
- `CampaignSuccessEvaluation` extends one criterion with `currentCount` and `met`. `evaluateCampaignSuccess(criteria, totals)` treats a missing event total as zero and returns `allCriteriaMet=false` for an empty criterion list.
- `MeasurementSummary.criteria` evaluates the exact version pinned by `campaign_instance.campaign_version_id`; successor Campaign drafts cannot change a running or historical instance's goal definition.

## Measurement ingest-key lifecycle (Release 0.22)

- Stored key fields are `id`, `workspaceId`, `name`, `keyPrefix`, `keyHash`, `status`, `createdBy`, `createdAt`, optional `lastUsedAt`, and optional `revokedAt`.
- `status` is the closed union `active | revoked`. There is no transition back to active and no plaintext-secret field.
- Creation returns `{ id, secret, prefix }` once. List/read models return prefix and lifecycle timestamps only.
- `revokeMeasurementKey(workspaceId, id, actorUserId): Promise<boolean>` returns true only for the first authorized active-to-revoked transition.
- Audit dictionaries contain only `{ name, keyPrefix }`; the events are `measurement.key.created` and `measurement.key.revoked`, subject type `measurement_ingest_key`, and the stable key ID.
- Authentication hashes the presented bearer value and updates `last_used_at` only when both the hash matches and status is active. Revoked attempts reveal no key metadata.

## Currency-safe Campaign criteria (Release 0.23)

- `CampaignSuccessCriterion` is `CampaignCountCriterion | CampaignValueCriterion`. Shared fields are stable `id` and closed `MeasurementEventType` `eventType`.
- `CampaignCountCriterion` is `{ metric?: "count"; targetCount: number }`; optional `metric` is a read-compatibility concession for Release 0.21 JSON and is normalized to explicit `"count"` at the web boundary and in evaluation output.
- `CampaignValueCriterion` is `{ metric: "value"; targetValue: number; currency: string }`; `targetValue` is positive and finite up to 1,000,000,000,000, and `currency` matches `^[A-Z]{3}$`.
- `CampaignSuccessEvaluation` is likewise discriminated. Count output adds `currentCount`; value output adds `currentValue` and retains exact `currency`; both add `met`.
- `MeasurementSummary.totals[eventType]` contains event `count` and only currency-null `value`. `currencyTotals[eventType][currency]` contains the independent sum for each populated currency.
- `evaluateCampaignSuccess(criteria, totals, currencyTotals)` maps missing buckets to zero, compares one exact bucket to each target, preserves criterion order, and reports `allCriteriaMet=false` for an empty list.
- These dictionaries are sparse by design: absent event types and currencies are not materialized, and clients must use zero as the semantic default.

## Scoped measurement key contract (Release 0.24)

- `StoredMeasurementKey.status` is the derived closed union `active | expired | revoked`; the persisted transition state remains `active | revoked`, while expiry is computed from database time.
- `allowedEventTypes` is a non-empty, unique ordered list of one to 24 `MeasurementEventType` values. Migration defaults existing rows to all values; API/repository defaults preserve older creation callers.
- `expiresAt` is an optional absolute timestamp. Absence means no automatic expiration; a timestamp at or before database `now()` makes authentication fail and list status become `expired`.
- `MeasurementKeyPrincipal` is `{ id, workspaceId, allowedEventTypes }`. It contains no name, prefix, hash, expiry, or secret and exists only after active/unexpired hash authentication.
- Scope authorization is exact membership: `principal.allowedEventTypes.includes(event.eventType)`. It does not imply Campaign, source, Destination, currency, or property permissions.
- Creation audit data is the non-secret dictionary `{ name, keyPrefix, allowedEventTypes, expiresAt }`; revocation retains the existing minimal name/prefix record.

## Campaign success-transition contract (Release 0.25)

- `CampaignWorkflowCommand.commandType` adds the closed value `success_criteria_met`; its stable idempotency key is `campaign:{campaignInstanceId}:success-criteria-met`.
- `CampaignSuccessSignal` is `{ criteria: readonly CampaignSuccessEvaluation[]; measuredAt: string; triggerEventKey: string }`. `criteria` is the evaluated shape of the immutable version pinned to the instance, not a client-supplied rule set.
- Threshold detection runs only after a newly inserted event. A replay whose workspace/event key already exists returns false and cannot create or replace the signal payload.
- The exact Campaign instance row is the serialization lock. Different accepted events may run concurrently, but each later transaction evaluates after the earlier commit, so only one transaction first observes all criteria met.
- `context["measurement.success"]` is the workflow's idempotent first-signal value. Later deliveries cannot overwrite its original criterion snapshot, measurement time, or trigger event key.
- `CampaignSuccessTransition` contains `status`, `queuedAt`, and optional `deliveredAt`. Status is `pending | processing | completed | failed | dead_letter` and reflects the database outbox, not Campaign completion.
- `MeasurementSummary.successTransition` is optional for compatibility with historical all-met runs. Its absence must not be represented as queued or delivered.

## Campaign success-action contract (Release 0.26)

- `CAMPAIGN_SUCCESS_ACTIONS` is the readonly tuple `['notify_only', 'pause']`; `CampaignSuccessAction` is its derived union.
- `CampaignVersion.successAction` is required in the read model and persisted as constrained `campaign_version.success_action`. `CampaignDraftWrite.successAction` is optional only for backward-compatible callers and defaults to `notify_only`.
- `notify_only` records the first success signal without changing workflow state. `pause` records the same signal and sets workflow plus Campaign instance state to paused.
- `CampaignSuccessSignal.action` is optional for pending Release 0.25 commands; the workflow normalizes a missing field to `notify_only` before storing `context['measurement.success']`.
- The selected action comes from the exact Campaign version pinned to the instance, never the current draft, a measurement property, or a client-authored signal payload.
- Pause is resumable and gates future workflow scheduling. It does not cancel an active step scope, change criterion results, create another success command, or represent completion.

## Campaign-scoped measurement key contract (Release 0.27)

- `MeasurementCampaignScopeMode` is the closed union `all | restricted`; `StoredMeasurementKey` and `MeasurementKeyPrincipal` expose it as `campaignScopeMode`.
- `allowedCampaignIds` is a unique sorted list of workspace-owned Campaign UUIDs. Creation accepts zero through 100 IDs: zero selects `all`, while one or more selects `restricted`.
- Persisted scope is relational in `measurement_ingest_key_campaign_scope(measurement_ingest_key_id, campaign_id)`. The compound primary key prevents duplicates, and both foreign keys cascade on authorized parent deletion.
- `restricted` is authoritative even when `allowedCampaignIds` becomes empty after Campaign deletion. Consumers must treat that state as deny-all and must never infer `all` from an empty list.
- `isMeasurementCampaignAllowed(principal, references)` resolves root Campaign IDs from `campaignId`, `campaignInstanceId`, `campaignStepRunId`, `trackedLinkId`, and `publicationActionId`. Indirect tracked/publication roots flow through their Campaign instance.
- A restricted request is allowed only when its supplied Campaign-bearing references resolve to exactly one distinct root and that root is present in the principal allowlist. No root, an unresolved root, conflicting roots, or an unlisted root is forbidden.
- Event-type membership is authorized before Campaign scope. Campaign authorization precedes the existing full reference-integrity insert path; either scope failure returns 403 and persists no event.
- Creation audit data adds the non-secret dictionary fields `campaignScopeMode` and `allowedCampaignIds`; no key hash or plaintext secret enters the principal, list model, audit, or error response.

## Relationship and contact-safety contract (Release 0.28)

- `RELATIONSHIP_STAGES` is the readonly tuple `unknown | discovered | new_contact | engaged | active_conversation | lead | customer | partner | collaborator | community_member | inactive`; `RelationshipStage` is its derived union.
- `CONTACT_PERMISSIONS` is the readonly tuple `allowed | suppressed`. Permission is orthogonal to stage and is the authoritative future-outreach gate; a lead, customer, or partner may remain suppressed without losing its business context.
- `RELATIONSHIP_IDENTITY_STATUSES` is `reported | verified`. A `RelationshipIdentity` contains stable row ID, provider, provider subject ID, optional display handle/profile URL, status, and optional confidence from zero through one.
- `RelationshipRecord` contains identity/name, optional organization and assigned owner, stage, contact permission, readonly `observedInterests`, readonly `sharedTopics`, optional preferred tone, internal notes, optional suppression evidence, readonly identities, and timestamps.
- `RelationshipWrite.identities` is bounded to 20 and unique by exact provider plus provider subject. The other text arrays are bounded to 50 entries of at most 200 characters; internal notes are bounded to 10,000 characters.
- `relationship_contact` enforces the closed values and suppression-state invariant. Allowed rows have no suppression fields; suppressed rows require a trimmed reason and timestamp. The actor may later become null only through authorized user deletion.
- `relationship_identity` carries workspace ID and a composite foreign key to `(relationship_contact_id, workspace_id)`. `UNIQUE(workspace_id, provider, provider_subject_id)` prevents one provider identity from representing multiple workspace relationships.
- Create/update audit dictionaries are `{ stage, contactPermission, identityProviders }`. They intentionally omit internal notes, provider subject IDs, handles, profile URLs, confidence, and suppression text.

## Conversation inbox contract (Release 0.29)

- `CONVERSATION_STATUSES` is the readonly tuple `new | unassigned | ai_managed | assigned | waiting_internal_information | waiting_contact | scheduled_follow_up | resolved | archived`; `ConversationStatus` is its derived union.
- `CONVERSATION_MESSAGE_KINDS` is the readonly tuple `inbound | outbound_observed | internal_note | system`; `ConversationMessageKind` is its derived union. `outbound_observed` records an action that happened elsewhere and is not an authorization to send.
- `ConversationThread` contains workspace/relationship IDs, provider, optional exact provider thread ID, subject, status, optional assigned owner/activity time, and timestamps. `StoredConversationThread` adds the relationship display name, current contact permission, total `messageCount`, optional `latestMessage`, readonly chronological `messages`, and creator.
- `ConversationMessage` contains stable row/thread IDs, optional provider message ID, kind, body, optional author display, occurrence time, readonly metadata dictionary, optional creator, and creation time. Provider message IDs are unique within one thread when present.
- `ConversationThreadWrite` carries the mutable identity/state fields. `ConversationMessageWrite` is the ingestion contract; `addInternalNote` intentionally accepts only workspace/thread/body/actor so a caller cannot disguise a note as an outbound kind.
- Assigned threads require an owner and unassigned threads forbid one. Owners and relationships must belong to the same workspace. Suppressed relationships may retain inbound history and notes, but their permission remains the future outbound deny boundary.
- Thread audits contain provider, status, relationship ID, and an assignment boolean. Internal-note audits contain only `{ messageId }`; body, author display, provider subject, and message metadata remain outside audit dictionaries.

## Human handoff contract (Release 0.30)

- `CONVERSATION_HANDOFF_STATUSES` is the readonly tuple `open | resolved | cancelled`; `ConversationHandoffStatus` is its derived union.
- `ConversationHandoffBrief` contains stable brief/thread IDs, status, required contact/importance/request-or-offer text, optional-content prior-response/context/suggested-response strings, optional due time, requester, optional closer/time, and timestamps.
- `ConversationHandoffWrite` carries workspace/thread identity plus the seven brief inputs. Required text is bounded to 2,000 or 5,000 characters; optional context fields are bounded to 10,000 or 20,000 characters.
- `ConversationThread.responseDueAt` and `followUpAt` are optional ISO timestamps. `StoredConversationThread.handoffs` is the readonly chronological history; `activeHandoff` is the sole open member when present.
- `conversation_handoff_brief` enforces the closed status and open/closed timestamp invariant. A partial unique index permits only one open row for each conversation thread.
- Handoff audits are `{ handoffId, hasDueAt }` for creation and `{ handoffId }` for closure. Brief text and deadline values are intentionally excluded from audit dictionaries.

## Inbox query contract (Release 0.31)

- `ConversationThreadQuery` is an optional-field interface containing `search`, `provider`, `status`, nullable `assignedOwnerId`, `handoff`, `deadline`, `activityFrom`, `activityTo`, and `limit`.
- `assignedOwnerId=undefined` means any owner, `null` means unassigned, and a UUID means that exact workspace member. `handoff` is `open | none`; `deadline` is `overdue | upcoming | none`.
- `conversationThreadQuerySchema` accepts URL-facing `owner=me | unassigned`, closed status/filter values, ISO calendar dates, trimmed search/provider strings, and an integer limit from 1 through 200 (default 100).
- Activity uses `lastMessageAt` when present and otherwise `updatedAt`. Date-only API inputs become inclusive UTC day bounds before the repository receives them.
- Text matching covers subject, relationship display name, organization name, and message body. Handoff content, internal audit data, and provider metadata dictionaries are excluded.

## Conversation read-state contract (Release 0.32)

- `ConversationReadState` is the domain record `{ conversationThreadId, userId, lastReadAt, createdAt, updatedAt }`. The persisted row also carries `workspaceId` to enforce composite tenant references.
- `conversation_read_state` has primary key `(conversation_thread_id, user_id)`. Its composite foreign keys require both a same-workspace thread and an existing `(workspace_id, user_id)` membership; both parent deletions cascade the dependent cursor.
- `ConversationThreadQuery.unread` is optional: `undefined` means no read-state predicate, `true` means at least one unread message, and `false` means none for the authenticated viewer. Supplying it without a viewer is a repository validation error.
- `StoredConversationThread.unreadCount` is always a number and `lastReadAt` is an optional normalized ISO string. Calls without viewer context hydrate zero/undefined for backward-compatible internal writers; user-facing list/detail calls always supply the user ID.
- A message is unread when `message.createdAt > lastReadAt` and `message.createdBy IS DISTINCT FROM viewerUserId`. `occurredAt` remains provider chronology and never controls unread state.
- `ConversationRepository.markRead(workspaceId, conversationThreadId, userId)` returns the normalized database timestamp or `undefined` when thread/membership scope does not exist. Its UPSERT uses `GREATEST(existing, excluded)` to prevent cursor regression.
- `conversationThreadQuerySchema.read` is the closed URL value `unread | read`; `conversationReadSchema` accepts only a workspace UUID. `POST /api/v1/conversations/[id]/read` is the sole web mutation and no GET marks a thread read.

## Workspace-member assignment contract (Release 0.33)

- `WorkspaceMember` is `{ userId, displayName, role, assignableToConversations }`. It deliberately excludes email, session state, organization role, and unrelated account metadata.
- `assignableToConversations` is true only for workspace roles `owner | admin | editor`. The repository write guard repeats the same closed role set and rejects an ineligible or cross-workspace `assignedOwnerId`.
- `StoredConversationThread.assignedOwnerDisplayName` is optional because unassigned threads and deleted nullable user references have no current display value. The UUID remains the stable assignment identity.
- `ConversationThreadQuery.assignedOwnerId` still distinguishes any (`undefined`), unassigned (`null`), and exact UUID. URL `owner` additionally accepts an exact UUID after the existing `me | unassigned` aliases.
- `conversation.assignment_changed` represents a same-status assignee transition. Audit data adds `assignedOwnerId` as a UUID or null and continues to exclude email, message bodies, provider subjects, and handoff content.

## Conversation classification contract (Release 0.34)

- `CONVERSATION_SENTIMENTS` is the readonly tuple `unknown | positive | neutral | negative | mixed`; `ConversationSentiment` is its derived union.
- `CONVERSATION_INTENTS` is `unknown | praise | question | support | availability | sales | complaint | collaboration | media_inquiry | other`; `ConversationIntent` is its derived union.
- `CONVERSATION_URGENCIES` is `unknown | low | normal | high | critical`; `ConversationUrgency` is its derived union. `unknown` is the safe no-review state for every dimension.
- `ConversationThread` requires `sentiment`, `intent`, and `urgency`, plus optional `classificationUpdatedBy` and `classificationUpdatedAt`. `ConversationThreadWrite` keeps the three inputs optional for compatibility; the repository preserves omitted update values and defaults new rows.
- `ConversationThreadQuery` exposes optional exact classification predicates. URL query names match the domain fields and are validated by the same shared tuples.
- `conversation_thread_classification_evidence_check` requires reviewer and timestamp to be both null or both present. Any actual value change assigns the authenticated actor and database time.
- `conversation.classification_changed` audit data contains the three closed values and stable actor envelope. It does not contain messages, provider metadata, model confidence, or inferred traits.

## Conversation context contract (Release 0.35)

- `ConversationThread.campaignId` and `.destinationId` are optional stable UUID references. They represent reviewed thread-level relevance, not proof that a Campaign or Destination caused every message.
- `ConversationThreadWrite.campaignId` and `.destinationId` accept `string | null | undefined`: a UUID sets/replaces context, null explicitly clears it, and undefined preserves an existing value or means no association for a new row.
- `StoredConversationThread.campaignName` and `.destinationTitle` are optional hydrated presentation fields. Names/titles remain authoritative in their source registries and are not duplicated into `conversation_thread`.
- `ConversationThreadQuery.campaignId` and `.destinationId` are optional exact predicates. The URL schema exposes them as `campaign` and `destination` UUIDs after authenticated workspace resolution.
- Text search additionally matches Campaign name/description and Destination title/description/topics; provider dictionaries, destination URLs, Campaign step inputs, and audit data are excluded.
- `conversation_thread_campaign_workspace_fk` and `conversation_thread_destination_workspace_fk` require `(reference_id, workspace_id)` ownership and use delete restriction. Context must be explicitly cleared or reassigned before a referenced root can be deleted.
- `conversation.context_changed` is emitted for an existing thread only when either resolved reference changes. Its audit dictionary uses UUID-or-null values and excludes copied labels or content.

## Conversation account/publication context contract (Release 0.36)

- `ConversationThread.channelConnectionId` and `.publicationActionId` are optional stable UUID references. A publication reference requires the exact account that dispatched it.
- Write semantics match other context fields: UUID sets/replaces, null clears, and undefined preserves an existing value or means none on creation.
- `StoredConversationThread.channelConnectionName`, `.channelProvider`, `.publicationExternalId`, and `.publicationStatus` are optional hydrated fields; credentials, provider URL, snapshots, response metadata, and errors are never part of this read model.
- `ConversationChannelOption` is `{ id, name, provider, status }`. `ConversationPublicationOption` is `{ id, channelConnectionId, channelConnectionName, provider, providerExternalId?, status, startedAt }`.
- `ConversationContextDirectory` contains readonly `channels` and `publications` collections, each bounded to 200 records and scoped to one workspace.
- `ConversationThreadQuery.channelConnectionId` and `.publicationActionId` are exact optional predicates. URL names are `account` and `publication`.
- Search covers account name/provider and the non-secret publication external ID. It excludes encrypted credentials, configuration, capabilities, provider URL, idempotency key, request snapshot, response metadata, and last error.
- `conversation_thread_publication_context_fk` binds `(publication_action_id, channel_connection_id, workspace_id)` and delete-restricts referenced evidence. `conversation.context_changed` adds UUID-or-null values only.

## Conversation Brand context contract (Release 0.37)

- `ConversationThread.brandProfileId` is an optional stable reference to the mutable Brand Profile root. It records reviewed thread-level relevance, not an immutable generation input or proof that the Brand caused a message.
- `ConversationThreadWrite.brandProfileId` is `string | null | undefined`: a UUID sets/replaces context, null explicitly clears it, and undefined preserves an existing value or means no association on creation.
- `StoredConversationThread.brandProfileName` and `.brandProfileStatus` are optional hydrated presentation fields. Full Brand profile dictionaries and Brand version content never enter the conversation read model.
- `ConversationBrandOption` is exactly `{ id, name, status }`. `ConversationContextDirectory.brands` is a readonly, same-workspace collection bounded to 200 records.
- `ConversationThreadQuery.brandProfileId` is an optional exact predicate; the URL-facing query name is `brand`. Bounded text search additionally matches Brand name and description.
- `conversation_thread_brand_workspace_fk` binds `(brand_profile_id, workspace_id)` to `brand_profile(id, workspace_id)` with delete restriction. Context must be cleared or reassigned before the Brand root is deleted.
- `conversation.context_changed` adds `brandProfileId` as a UUID or null. It excludes Brand labels, description, profile/version dictionaries, Campaign definitions, messages, and provider payloads.
- Brand context is independent of `campaignId`. Campaign versions retain their exact immutable `brandProfileVersionId`; no automatic equality or compatibility claim is made.

## Relationship history summary contract (Release 0.38)

- `StoredConversationThread.relationshipStage` is the current closed `RelationshipStage` from the authorized `relationship_contact` root.
- `priorThreadCount` is a non-negative integer count of other same-workspace threads for the same relationship whose database `createdAt` is strictly earlier than the current thread's `createdAt`.
- `priorMessageCount` counts messages belonging to those qualifying prior threads only when the message database `createdAt` is also strictly earlier than the current thread. Provider `occurredAt` does not control this boundary.
- `lastPriorInteractionAt` is optional and equals the latest qualifying prior thread/message database creation timestamp. It is undefined when both prior counts are zero.
- The summary contains no prior message body, message metadata, internal note text, relationship notes, provider identities, organization value, confidence, or inferred customer classification.
- These fields are derived read-model values only. They are not persisted on `conversation_thread`, accepted by write schemas, filter predicates, or included in audit dictionaries.
- The stage and counts provide operator context only; they do not override `contactPermission`, authorize a response, prove identity, or select an owner/routing policy.

## Observed shared-resource contract (Release 0.39)

- `CONVERSATION_SHARED_RESOURCE_KINDS` is the readonly tuple `destination | publication`; `ConversationSharedResourceKind` is its derived union.
- `ConversationSharedResource` contains ID, source thread ID, kind, optional target IDs, `observedAt`, `recordedBy`, and immutable `createdAt`.
- `ConversationSharedResourceWrite` always contains workspace/thread UUIDs, a UUID `idempotencyKey`, and offset-aware `observedAt`, plus exactly one branch: `{ kind: destination, destinationId }` or `{ kind: publication, publicationActionId }`.
- Publication account identity is derived server-side and stored as `channelConnectionId`; clients cannot choose an inconsistent account/publication pair.
- `StoredConversationSharedResource` hydrates safe Destination title/canonical URL or account name/publication external ID/status, source thread subject, and `isCurrentThread`. It excludes Destination description/tracking/identifiers and Publication request/response/provider URL/error data.
- `StoredConversationThread.sharedResourceHistoryCount` is the total eligible relationship-history count. `recentSharedResources` is bounded to three for list reads and twenty for detail reads.
- Eligible history includes evidence on the current thread plus evidence on earlier relationship threads only when both source-thread and evidence database creation times precede the current thread.
- `conversation_shared_resource_target_check` enforces exactly one target family. Composite foreign keys enforce same-workspace thread, target, Publication/account, and recorder membership.

## Conversation suggested-routing contract (Release 0.40)

- `ConversationRoutingRuleWrite` contains workspace ID, a trimmed unique name, `enabled`, integer `priority` from zero through 1,000, optional exact match fields, and one suggested target. At least one matcher is required.
- Matchers are limited to `brandProfileId`, `channelConnectionId`, `relationshipStage`, `intent`, and `urgency`. They compare equality against reviewed thread fields; message bodies, search text, notes, sentiment, inferred traits, and provider payloads are not matcher inputs.
- `targetStatus === assigned` requires `targetOwnerId`. Every other status forbids an owner. Target owners must be current same-workspace members whose role is `owner | admin | editor`.
- `StoredConversationRoutingRule` adds stable ID, creator, and timestamps. Names are unique case-insensitively per workspace. Brand/account/owner references use composite tenant foreign keys and deletion restriction.
- Rule ordering is `priority DESC`, number of non-null matchers `DESC`, `updatedAt DESC`, then `id`. This total order makes one winning suggestion reproducible.
- `ConversationRoutingSuggestion` contains rule ID/name/priority, readonly `matchedOn`, target status, and optional safe owner ID/display name. It contains no message/contact content or private rule evaluation trace.
- `StoredConversationThread.routingSuggestion` is optional and read-only. It never changes `status`, `assignedOwnerId`, read state, handoffs, contact permission, or any provider record.
- `conversation.routing_rule_saved` audit data stores only enabled/priority, closed match fields, stable reference IDs, and target values. Enable/disable events store only the new boolean state; rule names and conversation content are omitted.

## Conversation service-level contract (Release 0.41)

`conversation_service_level_policy` stores at most one policy per workspace. `businessDaysMask` uses Sunday = 1, Monday = 2, Tuesday = 4, Wednesday = 8, Thursday = 16, Friday = 32, and Saturday = 64; configured business days are combined with bitwise OR. `businessStartTime` must be earlier than `businessEndTime`, the timezone must be a valid IANA identifier, and each urgency target plus `atRiskBeforeMinutes` is a bounded positive minute count.

`ConversationServiceLevelPolicyWrite` is the reviewed write dictionary. `StoredConversationServiceLevelPolicy` adds stable IDs, author membership, and timestamps. `ConversationServiceLevelSummary` is a derived read dictionary containing `state`, `dueAt`, and `source`, where source is `manual` or `workspace_policy`. `CONVERSATION_SERVICE_LEVEL_STATES` is the closed tuple `on_track | at_risk | overdue`.

The clock starts at the most recent inbound message's Market Me creation time, falling back to thread creation. `conversation_add_business_minutes(start, minutes, timezone, daysMask, startTime, endTime)` moves through configured local windows and returns UTC. A non-null thread `responseDueAt` overrides the policy result. Resolved and archived threads return no active summary. Evaluation is read-only and does not send reminders, change status or ownership, create a handoff, or write an audit event.

## Conversation review-request and mention contract (Release 0.42)

`CONVERSATION_REVIEW_REQUEST_STATUSES` is the closed tuple `open | resolved | cancelled`; `ConversationReviewRequestStatus` is derived from it. `ConversationReviewRequest` contains the stable request/thread/source-note/requester/reviewer/closer IDs, request text, optional due and closure timestamps, status, audit timestamps, hydrated member names, optional cited-note excerpt, and `mentions`.

`ConversationReviewRequestWrite` is the repository command dictionary: `workspaceId`, `threadId`, optional `sourceMessageId`, `requestText`, optional `dueAt`, `requestedByUserId`, `requestedReviewerUserId`, and a deduplicated `mentionedUserIds` list. `ConversationReviewMention` is the compact `{ userId, displayName }` projection. `StoredConversationReviewRequest` is the persistence/read model. `StoredConversationThread.reviewRequests` contains complete retained history only on detail reads; list reads intentionally leave it empty and expose the integer `openReviewRequestCount`.

The requested reviewer must be a current workspace owner, administrator, or editor and must differ from the requester. Up to twenty additional mentioned users must be current workspace members and must differ from both requester and reviewer. A cited source must be an `internal_note` message in the same workspace and thread. Only the requested reviewer can move an open request to `resolved`; only the requester can move it to `cancelled`. Closing is terminal in this release.

Review requests are collaboration state, not conversation messages, approvals, handoffs, notifications, or provider actions. Creating or closing one does not modify thread status, assignment, contact permission, read state, service-level state, workflow state, or provider state. Audit dictionaries omit `requestText`, cited-note body/excerpt, and all conversation content.

## Relationship identity-resolution contract (Release 0.43)

`RELATIONSHIP_IDENTITY_LINK_STATUSES` is the closed tuple `suggested | confirmed | dismissed`. `RELATIONSHIP_IDENTITY_EVIDENCE_KINDS` is `verified_link | exact_address | strong_identifier | user_confirmation`; similar names, organization resemblance, free-form model output, and speculative inference are intentionally absent.

`RelationshipIdentityLink` contains a canonical same-workspace relationship pair, status, evidence kind, numeric confidence from zero through one, suggester/reviewer IDs, review time, and audit timestamps. `RelationshipIdentityLinkWrite` adds the current root, candidate root, and `initialStatus` of suggested or confirmed. `RelationshipIdentityLinkDecision` permits only confirmed or dismissed. `StoredRelationshipIdentityLink` hydrates the two relationship names and actor display names without copying provider subjects into audit evidence.

`RelationshipIdentityGroupMember` contains one preserved relationship root's name, organization, stage, local contact permission, and provider identities. `StoredRelationshipIdentityResolution` contains the current relationship ID, suppression-first `effectiveContactPermission`, the recursively connected confirmed `members`, and relevant link history. `StoredRelationship.effectiveContactPermission` is distinct from its editable local `contactPermission`.

Suggestions do not join groups. Confirmed edges form an undirected transitive component; dismissed edges do not. Reconfirming or dismissing an edge changes only link state. It never reparents or deletes a relationship, provider identity, conversation, message, note, handoff, review request, or audit record. If any confirmed member is locally suppressed, the component's effective contact permission is suppressed.

## Relationship identity-candidate discovery contract (Release 0.44)

`RELATIONSHIP_IDENTITY_LINK_ORIGINS` is the readonly tuple `manual_review | deterministic_scan`. `RelationshipIdentityLink.origin` distinguishes operator-entered evidence from a scanner suggestion; origin is descriptive provenance and never grants confirmation authority. Manual saves set `manual_review` and clear any scanner fingerprint.

`RelationshipIdentityCandidateScanResult` contains integer `scannedIdentityCount`, `matchedPairCount`, `createdSuggestionCount`, `skippedExistingPairCount`, and `ignoredAmbiguousSignalCount`. These are bounded operational counts, not a disclosure of the underlying addresses, URLs, or identifiers.

The scanner accepts signals from `verified` relationship identities only:

- `exact_address`: a trimmed, lowercase email address with a conventional domain form; confidence `0.99`;
- `verified_link`: an HTTPS URL normalized by lowercase host, fragment removal, trailing-slash removal, and sorted query parameters; confidence `0.97`;
- `strong_identifier`: a trimmed, lowercase UUID, URN, or namespaced identifier; confidence `0.95`.

For deterministic suggestions, `evidenceFingerprint` is a lowercase 64-character SHA-256 digest of the normalized signal and `origin` is `deterministic_scan`. The raw signal does not enter the link or audit dictionary. A signal shared by more than five distinct relationship roots is ignored. Scans consider at most 5,000 verified identities and propose at most 100 new canonical pairs.

Names, organizations, free-form handles, notes, conversation content, and model results are not signals. A direct pair already present in any state is skipped; therefore a dismissed pair is not automatically reopened. Suggestions do not join the confirmed component and cannot change effective contact permission until a human confirms the edge through the existing decision contract.

## Conversation Assistant response-suggestion contract (Release 0.45)

`CONVERSATION_RESPONSE_SUGGESTION_STATUSES` is `active | dismissed | superseded`. At most one active suggestion exists per workspace/thread. Regeneration changes the prior active row to superseded and inserts a new immutable active row; an explicit reviewer action changes active to dismissed.

`CONVERSATION_RESPONSE_RECOMMENDATIONS` is `respond | clarify | no_response | human_review`. Respond and clarify require non-empty `responseText`; no-response and human-review forbid response text. A proposed Destination is allowed only for respond and must be a same-workspace published Destination.

`CONVERSATION_RESPONSE_CITATION_KINDS` is `message | relationship | brand | campaign | destination`. `ConversationResponseCitation` contains kind, stable source ID, label, and optional bounded excerpt. `ConversationResponseClaim` contains exact claim text plus one or more zero-based indexes into the stored citation array. The UI presents those indexes as one-based references.

`ConversationAssistantContextSnapshot` contains at most twenty chronological `inbound | outbound_observed` message records with ID/body/time, suppression-first relationship stage/safety/preferred tone, and optional published Brand version, published Campaign version/objective/promotional strength, and published Destination title/canonical URL/status. Internal notes, system messages, provider metadata, credentials, and client-authored prompts are absent.

`ConversationResponseSuggestion` stores summary, at most five identified questions, optional response, uncertainty from zero through one, one through ten uncertainty reasons, recommended `PromotionalStrength`, optional Destination ID, immutable snapshot, citations, claims, 64-hex SHA-256 `inputFingerprint`, generator/prompt identity, actor, lifecycle, and timestamps.

The provider constants are `CONVERSATION_ASSISTANT_PROVIDER=market-me`, `CONVERSATION_ASSISTANT_MODEL=grounded-conversation-template`, `CONVERSATION_ASSISTANT_VERSION=1.0.0`, and `CONVERSATION_ASSISTANT_PROMPT_VERSION=grounded-conversation-assistant-v1`. Suppression, no inbound message, or an observed outbound message after the latest inbound yields no-response. High/critical urgency or complaint, sales, collaboration, or media-inquiry intent yields human-review. A question without an approved Destination yields clarify; other safe input yields respond. Only a cited published Destination may add a factual business claim.

## Conversation response-composer contract (Release 0.46)

`CONVERSATION_DRAFTING_ACTOR_KINDS` is the readonly tuple `human | assistant`; `ConversationDraftingActorKind` is derived from it. Actor kind is presence metadata only and never grants delivery, ownership, approval, or assignment authority.

`ConversationResponseDraft` contains `id`, `workspaceId`, `conversationThreadId`, mutable `body`, optional `sourceSuggestionId`, `createdBy`, `updatedBy`, hydrated `updatedByDisplayName`, `createdAt`, and `updatedAt`. `ConversationResponseDraftWrite` is the command dictionary containing workspace/thread IDs, a nonblank body of 1 through 20,000 characters, and an optional source suggestion ID. One `(workspaceId, conversationThreadId)` pair has at most one draft.

`ConversationDraftingPresence` contains the thread ID, actor kind, actor user ID/display name, `expiresAt`, and `updatedAt`. Its composite primary key is workspace, thread, actor kind, and actor user. Leases last two minutes and the schema forbids expiry beyond five minutes from an update. Reads exclude expired rows and return at most twenty active actors.

`StoredConversationComposerState` is `{ draft?: ConversationResponseDraft, presences: readonly ConversationDraftingPresence[] }`. A source suggestion must belong to the same workspace and thread; deleting it clears only `sourceSuggestionId`. Draft creation/update and all human presence writes require an owner, administrator, or editor membership. Assistant presence uses the requesting writer as its attributed actor and is cleared when generation exits.

The draft is internal collaboration text. Saving, adopting a suggestion, presence renewal, clearing presence, and discarding never create a `conversation_message`, change contact safety, assignment/status, approve content, call a connector/model network service, or create workflow/publication work.

## Conversation attention contract (Release 0.47)

`CONVERSATION_ATTENTION_REASONS` is the readonly tuple `response_at_risk | response_overdue | response_escalation_due | follow_up_due | review_request_due | handoff_due`; `ConversationAttentionReason` is derived from it. Response reasons are mutually exclusive for one evaluation, while deadline reasons may coexist.

`ConversationServiceLevelPolicyWrite.escalationAfterMinutes` is an integer from zero through 10,080. It measures elapsed minutes after the derived/manual response deadline, not business minutes, before the response reason becomes `response_escalation_due`. The existing `atRiskBeforeMinutes` remains the lead window before the response due time.

`ConversationAttentionItem` contains thread ID, subject, relationship display name, status, optional owner ID/name, readonly reasons, `primaryDueAt`, and optional service-level, follow-up, review-request, and handoff due timestamps. `primaryDueAt` is the earliest populated source deadline and supplies stable chronological ordering inside a severity class.

The queue includes active threads only, returns at most 200 items, and orders response-escalation first, then response-overdue, then due follow-up/review/handoff work, then response-at-risk; due time and UUID break ties. Resolved and archived threads never appear. The queue is derived and creates no notification record, audit event, state transition, ownership change, handoff, workflow command, connector call, or message.

## Conversation retention-preview contract (Release 0.48)

`CONVERSATION_RETENTION_CLASSES` is the readonly tuple `standard | personal_message | imported_email | legal_hold`; `ConversationRetentionClass` is derived from it. `ConversationThread.retentionClass` defaults to standard and exposes optional `retentionClassUpdatedBy` and `retentionClassUpdatedAt` review evidence.

`ConversationRetentionPolicyWrite` contains `workspaceId`, boolean `enabled`, and integer `standardDays`, `personalMessageDays`, and `importedEmailDays`; every window is one through 3,650 days. `StoredConversationRetentionPolicy` adds creator/updater IDs and timestamps. There is at most one policy per workspace.

`ConversationRetentionCandidate` contains thread ID, subject, relationship display name, closed status, non-hold retention class, `lastActivityAt`, and `eligibleAfter`. Candidates are limited to resolved or archived threads when policy is enabled. `lastActivityAt` is the latest stored message timestamp, otherwise thread creation; `eligibleAfter` adds the selected class's whole-day window.

Legal hold has no retention window and never enters the preview. Class selection is explicit; provider strings, message text, identities, contact attributes, sensitive-trait inference, and model output are not classification inputs. The preview returns at most 200 rows ordered by eligibility and UUID and has no deletion, anonymization, export, approval, notification, workflow, connector, or provider side effect.

## AI model gateway and cost-control contract (Release 0.49)

- `AI_MODES` is the readonly tuple `recommended | lower_cost | highest_quality | faster | private_local | custom`; `AiMode` is its derived union. `AI_MODE_INDICATORS` maps every mode to closed quality, speed, privacy, and estimated-cost indicators for ordinary setup.
- `AI_CAPABILITIES` is `generate_text | generate_structured_output | analyze_image | transcribe | embed | rerank | moderate | use_tools`. Product services request these capabilities rather than provider-specific endpoints.
- `AI_PRIVACY_CLASSES` is `cloud | private_cloud | local`. `maximumPrivacyClass` is the greatest permitted exposure: cloud permits any class, private cloud permits private-cloud/local, and local permits local only. Privacy filtering is a hard constraint, not a ranking preference.
- `AI_FAILOVER_MODES` is `automatic_approved | ask_before_switching | no_external_fallback`; `AI_CAP_BEHAVIORS` is `pause_ai_work | lower_cost_fallback | limited_drafts | require_approval`. Release 0.49 persists these decisions but does not yet run a cap-enforcement worker or provider failover executor.
- `AiProviderAdapterDescriptor` contains provider/model/display identity, capabilities, privacy/quality/speed/cost classes, positive context limit, availability, and explicit approval. `AiProviderAdapter` adds one typed `invoke` boundary. OpenAI-compatible transport does not imply behavioral compatibility; future adapters must normalize their own request/response behavior.
- `AiRoutingRequest` contains capability, mode, maximum privacy, optional input-unit estimate, and optional tool requirement. `AiRoutingDecision` is `selected | unavailable`, includes bounded reasons and considered count, and may expose the chosen descriptor. It cannot authorize external data exposure, spend beyond policy, publishing, or workflow execution.
- `BUILT_IN_AI_ADAPTERS` currently contains only `market-me / grounded-template`, approved and local, with `generate_text` and `generate_structured_output`. It describes the existing deterministic generators and does not claim that a local LLM, Ollama, vLLM, or hosted provider is installed.
- `WorkspaceAiPolicyWrite` owns workspace ID, mode, privacy, failover, cap behavior, uppercase three-letter currency, optional positive minor-unit caps, and one to five unique ascending integer alert percentages. `StoredWorkspaceAiPolicy` adds creator/updater membership and timestamps.
- `AiUsageEventWrite` and `StoredAiUsageEvent` record capability, feature, provider/model/privacy, non-negative input/output/cached units, request count, latency, estimated minor-unit cost, currency, optional Campaign, prompt version, context revision, content hash, and timestamps. They intentionally contain no prompt, response, asset, message, contact, or secret field.
- `AiUsageSummary` reports current-month same-currency cost, requests, units, optional average latency, and per-feature cost/request totals. Month boundaries are UTC. Currency totals are never mixed.

## AI spend-authorization contract (Release 0.50)

- `AI_SPEND_RESERVATION_STATUSES` is the closed tuple `reserved | denied | settled | released | expired`. `AI_BUDGET_SCOPES` is `daily | campaign | monthly`. Additions require synchronized domain, migration, repository, UI, and compatibility review.
- `AiSpendReservation` identifies one tenant-bound attempt by UUID idempotency key, capability, bounded feature label, exact currency, estimated/actual integer minor-unit cost, optional Campaign root, captured cap behavior, exceeded scopes, requester/resolver, and creation/expiry/resolution timestamps.
- A `reserved` row has a positive estimate, no actual cost, no exceeded scopes, and a future 15-minute lease. A `denied` row records one or more exceeded scopes and no usage. `settled` requires an actual cost no greater than its estimate; `released` and `expired` never create usage.
- `AiBudgetScopeStatus` reports an optional cap plus settled, reserved, and available minor units. `AiBudgetStatus` exposes exact currency, daily/monthly and optional Campaign scopes, active holds, recent decisions, and the evaluation timestamp. Availability is `max(cap - settled - reserved, 0)` and is absent when that scope is uncapped.
- Campaign limits are all-time for the exact Campaign root; daily and monthly limits use UTC boundaries. Every currently active reservation counts against the current daily/monthly calculation even when it was created before a boundary.
- `ai_usage_event.spend_reservation_id` provides same-workspace referential integrity and is unique when present. This defines one settled usage event per reservation and keeps the metadata-only usage contract from Release 0.49.

## AI budget-alert contract (Release 0.51)

- `AI_BUDGET_ALERT_STATUSES` is the readonly tuple `open | acknowledged`; `AiBudgetAlertStatus` is derived from it. Acknowledgment is shared workspace state, not per-user read state.
- `AiBudgetAlert` contains stable alert/workspace IDs, optional Campaign and source-reservation IDs, closed scope/status, deterministic `windowKey`, threshold percentage, committed/cap integer minor-unit snapshots, exact currency, optional acknowledger/time, and creation/update timestamps.
- Daily `windowKey` is a UTC `YYYY-MM-DD`; monthly is UTC `YYYY-MM`; Campaign is the exact Campaign UUID and requires the same tenant-bound Campaign reference. The database allows only Campaign alerts to carry `campaignId`.
- Alert uniqueness is `(workspaceId, scope, windowKey, thresholdPercentage, capMinor, currency)`. A cap change may produce a new alert; release/re-reserve and idempotent reservation replay under the same cap/window cannot duplicate one.
- An `open` alert has no acknowledgement fields. An `acknowledged` alert requires both an eligible workspace member and timestamp. Source reservation is optional at the type boundary but every Release 0.51 reservation-time alert records it.
- `committedCostMinor` is the accepted-reservation snapshot of settled usage plus active estimates, including the new estimate. Alerts are evidence of a threshold reached at that time; later release, expiry, or lower settlement never rewrites the snapshot.

## AI spend-exception contract (Release 0.52)

- `AI_SPEND_EXCEPTION_STATUSES` is `pending | approved | rejected | expired`; `AiSpendExceptionStatus` is derived. `approved` plus `consumedAt` represents the consumed terminal condition without rewriting the approval decision.
- `AiSpendExceptionRequest` contains request/workspace/denied-reservation IDs; inherited optional Campaign, capability, feature, currency, estimate, exceeded scopes, and cap behavior; status; sensitive justification; requester; optional resolver/decision note; 24-hour expiry; optional resolution/consumption; and timestamps.
- `AiSpendExceptionRequestWrite` accepts only workspace ID, denied reservation ID, and a trimmed 1-to-1,000-character justification. Amount, scope, Campaign, capability, feature, currency, and cap behavior are server-hydrated from the denial.
- `AiSpendReservation.spendExceptionRequestId` is optional and unique when populated. Same-workspace foreign-key integrity makes one approved exception the authority for at most one override reservation.
- Pending requests forbid resolution/consumption fields. Approved/rejected require resolver and time; rejected/expired forbid consumption. Consumption is allowed only after approval resolution and never changes the stored approved decision.
- Reads derive unconsumed pending/approved rows as expired after `expiresAt`; a late decision persists expired state. Every consumed reservation retains the original estimate and still obeys actual-cost-at-or-below-estimate settlement.

## AI cap-response plan contract (Release 0.53)

- `AI_CAP_RESPONSE_ACTIONS` is the readonly tuple `pause | use_lower_cost_adapter | create_limited_draft | request_approval | manual`; `AiCapResponseAction` is its derived union.
- `AiCapResponsePlan` contains the denied reservation ID, capability, captured cap behavior, `ready | unavailable` status, one action, optional adapter descriptor, approval requirement, fixed `requiresPaidReservation: false`, and bounded human-readable limitations/reasons.
- `planAiCapResponse({ reservation, maximumPrivacyClass }, noPaidAdapters?)` is a pure generation-layer function. It accepts only adapter descriptors the caller already knows require no paid reservation and never calls `invoke`.
- A non-denied reservation produces unavailable/manual. `pause_ai_work` produces ready/pause. `require_approval` produces ready/request-approval while preserving the exact denied estimate through the existing exception contract.
- `lower_cost_fallback` chooses only an approved, available, privacy-compatible no-paid adapter. `limited_drafts` additionally requires text or structured-output capability and records grounded-template, no-premium-reasoning, and human-review limitations.
- The current no-paid registry is `BUILT_IN_AI_ADAPTERS`: Market Me's local grounded template for text and structured output. Unsupported capabilities produce unavailable/manual; no plan may imply provider execution, paid authority, usage, or approval consumption.

## AI assistant-profile contract (Release 0.54)

- `AI_ASSISTANT_PROFILE_IDS` is the readonly tuple `content_analyst | copy_assistant | campaign_planner | discovery_assistant | conversation_assistant | compliance_reviewer | performance_analyst`; `AiAssistantProfileId` is derived from it.
- `AI_ASSISTANT_ACTIONS` is `understand_content | prepare_copy | plan_campaign | discover_profiles_and_content | draft_eligible_interaction | review_rules_rights_and_claims | evaluate_results_and_experiments`; `AiAssistantAction` is derived.
- `AI_ASSISTANT_OUTPUT_KINDS` is `analysis | draft | recommendation | proposed_action`; outputs describe reviewable artifact classes and never imply execution.
- `AiAssistantProfile` stores a closed ID, user-facing name/purpose, readonly actions, readonly gateway capabilities, readonly output kinds, and literal `executionAuthority: false`.
- `AI_ASSISTANT_PROFILES` is the immutable seven-profile catalog. `automaticAssistantByAction` is an exhaustive internal dictionary mapping every action to exactly one profile ID and required `AiCapability`.
- `AiAssistantSelection` contains action, full profile, required capability, selected status, literal `automatic: true`, literal `executionAuthority: false`, and reasons. `selectAiAssistant` is pure and has no workspace, provider, model, credential, spend, approval, workflow, connector, or mutation input.

## AI assistant-assignment contract (Release 0.55)

- `AiAssistantSelection.automatic` is boolean: true for the default map and false for one validated explicit workspace choice. `executionAuthority` remains literal false in both cases.
- `AiAssistantAssignment` contains workspace ID, closed action, closed profile ID, creator/updater membership IDs, and creation/update timestamps. There is no provider, model, prompt, credential, privacy override, price, tool, or execution field.
- `WorkspaceAiAssistantAssignmentsWrite` is `{ workspaceId, assignments }`, where assignments is a zero-to-seven array of unique `{ action, profileId }` pairs. Absence of an action means Automatic; an empty array restores all defaults.
- `isAiAssistantCompatible(action, profileId)` requires both `profile.actions.includes(action)` and `profile.capabilities.includes(requiredCapability)`. `selectAiAssistant(action, profileId?)` rejects incompatible explicit roles.
- Compatible alternatives are intentionally bounded: related content/compliance/discovery roles may understand content; copy/conversation roles may prepare copy or interactions; campaign/performance roles may plan or evaluate; discovery/performance roles may discover where rerank is supported.
- Persistence uniqueness is `(workspaceId, action)`. The replace operation is atomic and the effective seven selections are derived from explicit rows plus the immutable automatic map.

## AI analysis-cache contract (Release 0.56)

- `AiAnalysisCacheKey` is workspace ID, closed `AiCapability`, trimmed 1-to-100-character feature, lowercase 64-hex content SHA-256, trimmed 1-to-100 model family, trimmed 1-to-100 prompt version, and trimmed 1-to-200 context revision.
- `AiAnalysisCacheEntry<TResult>` adds server-held JSON result, canonical result SHA-256, UTF-8 bytes, non-negative hit count, creator membership, optional last hit, expiry, and creation/update timestamps.
- `AiAnalysisCacheWrite<TResult>` adds integer `ttlSeconds` from 60 through 2,592,000. Results must be finite, acyclic JSON using null/boolean/number/string/array/plain-object values; canonicalization recursively sorts object keys.
- The composite primary key is every key field. Active conflicts are first-write-wins. An expired conflict may replace result/hash/bytes/creator/times and resets hit metadata.
- `AiAnalysisCacheSummary` contains evaluation time, active entry count, total result bytes, total hits, and optional oldest/newest/last-hit times. It contains no key or result payload.
- Lookup is an exact tuple match with `expiresAt > asOf`; a hit increments count/time atomically. Any workspace, capability, feature, content, model-family, prompt-version, or context-revision difference is a miss.

## AI assistant work-plan contract (Release 0.57)

- `AiAssistantWorkPlan` contains the effective `AiAssistantSelection`, ordinary `AiRoutingDecision`, `ready | unavailable` status, optional `AiCostLevel`, literal `currencyEstimateAvailable: false`, literal `execution: false`, and reasons.
- `planAiAssistantWork` accepts closed action, optional compatible profile ID, `AiMode`, maximum privacy class, and a server-owned adapter-descriptor list. It first resolves the assistant, then routes the unchanged required capability.
- Unavailable routing omits `estimatedCost` and explains that the required capability is not configured within current policy boundaries.
- Ready routing copies only the selected descriptor's `low | medium | high` cost class and explains that the value is qualitative rather than a currency quote, reservation, or provider call.
- The built-in grounded-template descriptor makes text and structured-output actions Ready/Low. Discovery remains unavailable because rerank is unsupported; the profile is not silently switched to a different action/capability.
- A work plan does not contain quantity, price, currency, token/unit forecast, package/Campaign total, reservation ID, approval, output, or execution result.

## AI provider rate-card contract (Release 0.58)

- `AI_RATE_CARD_STATUSES` is the closed tuple `draft | approved | retired`. Only approved cards can be selected; retired versions remain representable for historical evidence.
- `AI_RATE_COMPONENT_KINDS` is `input | cached_input | output | request`; `AI_RATE_UNITS` is `token | character | second | image | request`.
- `AiProviderRateComponent` stores one kind/unit pair, positive integer unit quantity through 1,000,000,000, and bounded non-negative `priceMicros`, where one micro is one-millionth of the card's major currency unit.
- `AiProviderRateCard` stores provider, model family/version, uppercase currency, components, half-open effective window, HTTPS or internal source reference, lowercase source SHA-256, verification/approval evidence, and creation time.
- Approved windows for the same provider/model-family/currency may touch but cannot overlap. Selection requires `effectiveFrom <= asOf < effectiveTo`; an absent upper bound is open-ended.
- `AiProviderRateCardSummary` contains evaluation time, active-card count, sorted currencies, optional latest verification time, and literal `monetaryEstimateAvailable: false`. It contains no rate component, model, source reference, hash, or write authority.

## AI cost-quote contract (Release 0.59)

- `AiProviderRateCard.minorUnitExponent` is an explicit integer 0 through 4; it defines how stored integer minor costs map to the card currency and removes the unsafe universal two-decimal assumption.
- `AiUsageQuantityForecast` binds one non-request component kind/unit to ordered integer minimum/maximum units from 0 through 1,000,000,000.
- `AiCostQuoteLine` preserves kind, unit, forecast bounds, and conservatively ceiling-rounded component cost in major-currency micros.
- `AiCostQuote` binds the exact card/provider/model version, currency/exponent, lines, minor-unit cost range, quote/expiry time, `ceil_to_minor_unit`, reservation requirement, literal false reservation authorization, and literal false execution.
- `quoteAiCost` requires an approved currently effective card, every required forecast exactly once, no unused forecasts, integer component prices, and a 30-through-900-second lifetime. Default lifetime is 300 seconds and never crosses the card boundary.
- Zero provider charge produces zero minor units and no reservation requirement. Any positive upper bound requires reservation but does not create or authorize one.

## Stored AI cost-quote and reservation contract (Release 0.60)

- `AiStoredCostQuote` extends the calculated quote with UUID identity, workspace/optional Campaign, closed capability and feature, canonical forecasts, lowercase SHA-256 `quoteHash`, creator membership, creation time, optional reservation ID, and derived `active | expired | consumed` status.
- `AiCostQuoteWrite` accepts workspace, optional Campaign, exact rate-card ID, capability, feature, and bounded forecasts. Quote time and creator are server-owned; the selected card must still be approved and effective at the transaction time.
- The canonical quote identity recursively sorts object keys and forecast order before SHA-256. It covers the exact rate card/model, capability/feature, forecasts, lines, currency/exponent, cost bounds, rounding, and quote/expiry times.
- `AiSpendReservation.costQuoteId` is optional for backward compatibility. When present, a tenant-bound foreign key and unique constraint guarantee that one stored quote links to at most one reservation, including a cap-denied reservation.
- `AiQuotedSpendReservationWrite` contains only workspace ID, quote ID, and UUID idempotency key. Campaign, capability, feature, currency, and estimated maximum cost are always derived from the stored quote.
- `getCostQuote` derives status from current time and reservation linkage; status is not mutable stored authority. Zero-cost quotes remain useful evidence but cannot be consumed into a spend reservation.

## Assistant metering-profile and cost-preview contract (Release 0.61)

- `AI_ASSISTANT_METERING_PROFILES` is a closed `Readonly<Record<AiAssistantAction, AiAssistantMeteringProfile>>`; it has exactly one entry for every action and no tenant/client registration path.
- `AiAssistantMeteringProfile` contains action, required capability, server-owned `assistant.<action>` feature, `assistant-metering-v1` version, integer input/output token bounds, and literal false execution.
- Token envelopes are: understand content 512-16,000 input/256-2,000 output; prepare copy 256-8,000/64-2,000; plan Campaign 512-12,000/256-3,000; discovery 256-4,000/128-1,000; draft interaction 128-4,000/64-1,000; review rules 512-16,000/128-2,000; evaluate results 512-12,000/256-2,500.
- `planAiAssistantCost` composes assistant selection and policy routing with effective rate cards. It accepts an optional exact target ID but selects only a card whose provider/model family matches the routed adapter.
- Input/output token meters copy the profile range. Character meters multiply each bound by four. Cached input uses zero through the input maximum. Second and image meters have no safe text-action conversion and return unavailable.
- `AiAssistantCostPreview` is a discriminated `quoted | unavailable` union. Quoted values include minimized card ID, forecasts, currency/exponent, minor-cost bounds, times, reservation requirement, and durable-quote availability; every variant fixes reservation authorization and execution false.
- `aiAssistantCostQuoteCreateSchema` accepts only workspace, optional Campaign, closed action, and rate-card UUID. The route derives capability, feature, profile version, and forecasts before calling the ordinary durable quote repository.

## AI cost-quote ledger contract (Release 0.62)

- `AiCostQuoteLedgerItem` contains quote UUID, optional Campaign, closed capability, server feature, currency/exponent, minor-unit minimum/maximum, quote/expiry time, derived status, optional reservation UUID, reservation requirement, and literal false reservation authorization/execution.
- It deliberately excludes workspace and creator IDs, provider/model/rate-card identity, forecasts, calculated lines, canonical hash, source reference/hash, audit data, credentials, prompts, outputs, and provider payloads.
- `listCostQuotes(workspaceId, actorUserId, limit, asOf)` accepts an integer limit from 1 through 100, requires same-workspace membership, orders by quote time and ID descending, and normalizes status against the supplied read time.
- `aiCostQuoteListSchema` requires workspace UUID, coerces an optional limit defaulting to 25, caps it at 100, and rejects extra query fields. The operator page requests 20 rows.
- A quote is reservable in the UI only when `reservationRequired`, status is active, no reservation ID exists, and the actor is a workspace writer. The server remains authoritative and repeats every check.
- Action quote creation and reservation are separate client commands. Creation uses the exact preview action/card; reservation sends only workspace, quote ID in the path, and a UUID idempotency key.

## AI routing-preference contract (Release 0.63)

- `AiAdapterIdentity` is the minimal exact route identity `{ provider: string; model: string }`. It intentionally excludes display name, credentials, endpoint, price, availability, policy, prompt, payload, and execution state.
- `AiRoutingRequest.preferredAdapter?: AiAdapterIdentity` is an optional planning input. Omission means ordinary deterministic automatic scoring; presence means exact selection after all hard filters.
- `AiRoutingPreference` extends the identity with `workspaceId`, one closed `AiAssistantAction`, `createdByUserId`, `updatedByUserId`, `createdAt`, and `updatedAt`. Timestamps are repository-normalized ISO strings in application projections.
- `WorkspaceAiRoutingPreferencesWrite` contains one workspace UUID and a replacement list of unique `{ action, provider, model }` values. An empty list is the canonical Automatic state for every action.
- `StoredAiRoutingPreference` is the database projection of the same tenant-bound mapping and audit attribution. The `(workspace_id, action)` primary key prevents two preferences for one action.
- `requiredAiCapabilityForAction(action)` is the single action-to-capability mapping used by validation, display, routing, and cost planning. `isAiRoutingPreferenceCompatible` requires an exact registered, approved provider/model descriptor containing that capability.
- `routeAiTask` never treats a preference as permission. Capability, privacy, approval, availability, tools, context, and local/private requirements form the eligible set first. A requested identity outside that set yields unavailable; it does not trigger automatic or provider failover.

The persisted record contains no API key, OAuth token, provider secret, endpoint, rate, budget, privacy override, approval, tool grant, content, prompt, output, reservation, or execution flag. Audit details retain only action/provider/model mappings. A route becoming unavailable after save does not mutate the row; runtime revalidation surfaces the action as unavailable until a writer chooses Automatic or another eligible route.

## AI provider-adapter registry contract (Release 0.64)

- `AiProviderAdapterDescriptor` now requires `requiresPaidReservation` beside exact provider/model, display name, closed capabilities, privacy/quality/speed/cost classes, context limit, availability, and approval.
- `AiProviderAdapterRegistryEntry` extends the routing descriptor with optional `availabilityReason`, `configurationSource` (`built_in | administrator`), and verified/created/updated timestamps.
- `AiProviderAdapterRegistrySummary` contains total, approved, available, paid-reservation adapter counts, distinct capability count, and optional latest verification time. Counts describe registry metadata and grant no authority.
- `ai_provider_adapter` uses `(provider, model)` as its primary key. Strings are trimmed/bounded, classes are closed, context is 1 through 2,000,000 units, and an unavailable row must explain why.
- `ai_provider_adapter_capability` normalizes the many-to-many closed capability set under the exact identity; its primary key prevents duplicates and deletion cascades only from the adapter record.
- `workspace_ai_routing_preference(provider, model)` has a restrictive foreign key to the registry, so a referenced adapter cannot disappear while a governed preference exists.

The built-in seed is `market-me/grounded-template`, local, standard quality, fast, low qualitative cost, 32,000-unit context, approved, available, no paid reservation, and capable of text plus structured output. Registry availability is recorded deployment state rather than real-time provider health. Records contain no secret, credential, endpoint, account, rate card, prompt, content, output, token, reservation, or invocation method.
## AI hosted-provider connection contract (Release 0.65)

- `AI_HOSTED_PROVIDER_TYPES` is the readonly tuple `openai | anthropic | google_generative_ai`; `AiHostedProviderType` is its derived union. Arbitrary and OpenAI-compatible endpoints are intentionally outside this closed contract.
- `AI_PROVIDER_CONNECTION_STATUSES` is `unverified | verified | error | revoked`; `AiProviderConnectionStatus` is derived. Release 0.65 writes only `unverified` and `revoked`; the other states are reserved for a later provider-specific verifier.
- `AiProviderConnection` is the public secret-free projection: workspace and provider identity, status, `credentialConfigured`, optional error/verification/revocation times, attribution, timestamps, and literal `execution: false`.
- `AiProviderConnectionSecretWrite` is a server-repository input containing only the authenticated encrypted envelope, lowercase SHA-256 fingerprint, and key version. `StoredAiProviderConnection` extends the safe state only inside the database layer; API and policy mappers must never serialize its credential fields.
- `workspace_ai_provider_connection` has one row per workspace/provider. Non-revoked rows require ciphertext, fingerprint, and key version; revoked rows require those fields and `verified_at` to be null plus `revoked_at` to be present. `verified_at` exists only for `verified`, and `last_error` exists only for `error`.
- The fingerprint supports rotation detection and minimized audit evidence but remains server-only because it is derived from a secret. Saving a different fingerprint is a rotation; saving always clears prior verification/error/revocation state. Revocation erases all credential material and is replay-safe.
- Connection state never implies an adapter, endpoint, model, capability, price, provider account, spend reservation, or execution authority. Those remain separate governed records and transitions.

## AI provider-verification contract (Release 0.66)

- `AI_PROVIDER_VERIFICATION_TIMEOUT_MS` is the immutable five-second network budget. It is server code, not a client or workspace setting.
- `REQUESTS` is a readonly provider dictionary whose values construct one fixed HTTPS URL and required headers. OpenAI uses `Authorization: Bearer`; Anthropic uses `x-api-key` plus the stable `anthropic-version`; Google uses `x-goog-api-key`. Credentials never appear in URLs or bodies.
- `AiProviderVerificationFailure` is the closed union `credential_rejected | rate_limited | provider_unavailable | unexpected_response`. `AiProviderVerificationResult` is either `{ status: "verified" }` or `{ status: "error", failure, lastError }` with a predetermined safe message.
- `AiProviderConnectionVerificationTarget` contains workspace/provider identity, encrypted credential, fingerprint, and `v1` key version. It is writer-authorized, server-only, and never an API projection.
- `AiProviderConnectionVerificationWrite` contains workspace/provider identity, expected fingerprint, `verified | error`, and an error message only for `error`. The expected fingerprint is the compare-and-set guard against a rotation/revocation race.
- A verified transition sets `verifiedAt` and removes `lastError`; an error transition removes `verifiedAt` and records only a trimmed 1-through-500-character safe message. Save/rotate returns to Unverified and revoke erases the credential.
- Verified means the provider accepted the key for the fixed metadata endpoint at one time. It does not mean scheduled health, account identity, model entitlement retention, adapter availability, policy eligibility, pricing, spend authority, or execution.
## Provider model-inventory contract (Release 0.67)

- Discovery constants are 10,000 ms, 1,048,576 bytes, and 1,000 records.
- `DiscoveredAiProviderModel` retains model ID and optional bounded display name, input/output token limits, and provider creation time.
- `AiProviderModelDiscoveryWrite` binds a unique nonempty list to workspace, provider, and expected fingerprint.
- `AiProviderModelInventoryItem` and summary expose safe workspace-private first/last-seen, active/retired metadata with adapter activation and execution false.

## Workspace adapter-candidate contract (Release 0.68)

- `AI_ADAPTER_CANDIDATE_STATUSES` is the readonly tuple `pending`, `approved`, `rejected`, `retired`; `AiAdapterCandidateStatus` is derived from that tuple. Do not accept arbitrary status strings.
- `AiWorkspaceAdapterCandidate` is the safe tenant projection. Important fields are exact workspace/provider/model identity, `displayName`, normalized `capabilities`, `quality`, `speed`, `cost`, `contextLimit`, fixed `privacyClass: "cloud"`, fixed `requiresPaidReservation: true`, evidence reference/hash, source credential fingerprint, submit/review identity and timestamps, and literal false `routingAvailable`, `adapterActivation`, and `execution`.
- `AiWorkspaceAdapterCandidateWrite` is the repository submission input. It must carry one unique nonempty subset of the eight-value `AI_CAPABILITIES` tuple, a 1-through-2,000,000 context limit, a trimmed 1-through-1,000-character evidence reference, and a 64-character lowercase hexadecimal SHA-256.
- `AiWorkspaceAdapterCandidateDecisionWrite` carries `workspaceId`, `candidateId`, `approved | rejected`, and a trimmed 1-through-1,000-character review note. The route derives candidate identity from the URL and rejects extra client fields.
- `workspace_ai_adapter_candidate_capability` is the normalized capability set. Its composite primary key prevents duplicates and its closed check keeps database values aligned with `AI_CAPABILITIES`.
- One workspace/provider/model may have one current row. Pending/approved blocks duplicate submission. Rejected/retired may be resubmitted by resetting the row to pending and replacing its capabilities and evidence.
- Approval is valid only while the referenced inventory model is active, its connection is Verified, and model, connection, and candidate source fingerprints match. Context limit may not exceed a discovered input-token limit when one exists.
- Credential or inventory drift retires pending/approved rows. Retired state retains the reviewing actor, bounded reason, review/retirement time, and evidence history; it cannot route or execute.
- `CAPABILITY_LABELS` in the client is a readonly `Record<AiCapability, string>` used only for presentation. `reviewNotes` is a component-local `Record<string, string>` keyed by candidate UUID; it is transient and never a source of authorization.
- The global `ai_provider_adapter` dictionary remains the only routing catalog. Candidate collections must never be concatenated with or implicitly converted into that registry.

## Workspace adapter-registration contract (Release 0.69)

- `AI_ADAPTER_REGISTRATION_STATUSES` is the readonly `registered`, `retired` tuple; `AiAdapterRegistrationStatus` is derived from it.
- `AiWorkspaceAdapterRegistration` is a safe tenant snapshot with exact candidate/provider/model lineage, normalized capabilities, display/routing classes, context limit, fixed cloud/privacy and paid-reservation values, administrator attribution, optional retirement evidence, and literal false routing/activation/execution flags.
- `AiWorkspaceAdapterRegistrationWrite` accepts only `workspaceId` and `candidateId`; every snapshot field is copied from the authoritative Approved candidate under row lock.
- `AiWorkspaceAdapterRegistrationRetirementWrite` accepts `workspaceId`, URL-derived `registrationId`, and one trimmed 1-through-500-character retirement reason.
- Registration requires current Approved candidate state, active inventory, Verified connection, and equal candidate/model/connection fingerprints. A registered duplicate fails; a retired row may be reset only after repeating those checks.
- `workspace_ai_adapter_registration_capability` snapshots the unique closed capability set. It is replaced from candidate capability rows during registration and never accepted from a browser payload.
- Registered does not mean available or active. Registrations are deliberately excluded from `AiProviderAdapterDescriptor`, `listProviderAdapters`, routing preferences, readiness, cap response, rate selection, quotation, reservation, and provider execution.
- `registeredCandidateIds` is a memoized component-local `Set<string>` used only to suppress duplicate registration choices; `retirementReasons` is transient `Record<string, string>` form state. Neither is persistence, authorization, or global mutable state.

## Workspace adapter rate-binding contract (Release 0.70)

- `AI_ADAPTER_RATE_BINDING_STATUSES` is the readonly `bound`, `retired` tuple; `AiAdapterRateBindingStatus` is derived from it so the application and database share a closed lifecycle vocabulary.
- `AiWorkspaceAdapterRateBinding` is the safe tenant projection. Important fields are registration/rate-card/provider/model identity, `currency`, `minorUnitExponent`, `modelVersion`, normalized `components`, effective/source/hash evidence, lifecycle/actor timestamps, `evidenceCurrent`, `pricingReady`, and literal-false `routingAvailable`, `adapterActivation`, and `execution` flags.
- `AiWorkspaceAdapterRateBindingWrite` accepts only `workspaceId`, `registrationId`, and `rateCardId`. `AiWorkspaceAdapterRateBindingRetirementWrite` accepts `workspaceId`, URL-derived `bindingId`, and one trimmed 1-through-500-character `retirementReason`. Strict schemas reject all extra fields.
- `workspace_ai_adapter_rate_binding` owns one row per `(registration_id, currency)`. Its status is `bound | retired`; restrictive tenant-aware foreign keys prevent cross-workspace registration references and exact rate-card/currency foreign keys prevent currency drift.
- A bind requires a Registered staging record, Approved candidate, active inventory model, Verified connection, three equal credential fingerprints, an Approved rate card effective at the server-selected time, and exact `provider` plus `model_family === registration.model_id` equality.
- A retired binding may be rebound through the same row only after all current checks pass. Manual retirement is owner/administrator only. Registration retirement automatically retires bound rows with the reason `Workspace registration retired; pricing binding retired automatically.`
- `evidenceCurrent` is derived from current lifecycle, registration state, card status, retained/current source-hash equality, and the half-open effective window. `pricingReady` equals that evidence result; neither value expresses provider availability or invocation readiness.
- `components` is an ordered readonly projection of `kind`, `unit`, `unitQuantity`, and `priceMicros`. Prices are integer micros for the exact ISO currency and exponent. Browser clients format these values but never author them.
- `formatBindingComponents`, `formatComponents`, and `formatMoney` are presentation helpers. Component-local selection strings and the UUID-keyed retirement-reason record are transient UI state, not authorization, persistence, or global variables.
- The global `ai_provider_adapter` collection remains the sole routing catalog. Bindings must not enter provider selection, routing preferences, assistant readiness, cost-quote selection, reservation, provider invocation, usage recording, or settlement until later independent contracts explicitly connect those layers.

## Invocation-contract and tenant-binding contract (Release 0.71)

- `AI_INVOCATION_CONTRACT_STATUSES` is the readonly `approved`, `retired` tuple. `AI_ADAPTER_INVOCATION_BINDING_STATUSES` is the readonly `configured`, `retired` tuple; their union types are derived rather than duplicated.
- `AiProviderInvocationContract` carries provider, contract key/version, `https_json` transport, `bearer_api_key | api_key_header` credential mode, request/response schema versions, source reference/hash, review timestamps, and literal false implementation/health/execution flags.
- `AiWorkspaceAdapterInvocationBinding` carries registration, exact pricing binding, contract/provider/model, pricing currency, contract projection, `configurationCurrent`, actor/lifecycle fields, and literal false implementation/health/routing/activation/execution flags.
- `AiWorkspaceAdapterInvocationBindingWrite` accepts only `workspaceId`, `registrationId`, `rateBindingId`, and `contractId`. The retirement write accepts `workspaceId`, URL-derived `bindingId`, and a trimmed 1-through-500-character `retirementReason`.
- One lifecycle row exists per registration. Retired rows may be reconfigured only after full registration, evidence, pricing, and contract validation. Exact registration/workspace/provider and rate/workspace/registration foreign keys prevent tenant and lineage substitution.
- `configuredRegistrationIds` is a memoized UI-only `Set<string>`. Selected pricing/contract IDs and the UUID-keyed `retirementReasons` record are transient component state, never persistence, authorization, global variables, routing input, or execution state.
- The three contract dictionary rows are `openai-hosted-json`, `anthropic-hosted-json`, and `google-generative-ai-hosted-json`, each at `contract-v1`; all are source-hashed internal descriptors with implementation unavailable.
- A current configuration is not an invocation-ready adapter. No invocation binding may enter provider selection, health, routing, reservation, networking, usage, or settlement until separate later domain contracts explicitly authorize those transitions.

## Provider reachability observation contract (Release 0.72)

- `AI_ADAPTER_HEALTH_STATUSES` is the readonly `healthy`, `unhealthy` tuple. `AI_ADAPTER_HEALTH_FAILURES` is `credential_rejected`, `rate_limited`, `provider_unavailable`, or `unexpected_response`; union types derive from both tuples.
- `AiWorkspaceAdapterHealthObservation` carries minimized status/failure, administrator/time/expiry, `evidenceCurrent`, provider-request/response-storage/generation flags, and literal false implementation/health/routing/activation/execution authority.
- `AiWorkspaceAdapterInvocationBinding` now carries optional `latestHealthObservation` and boolean `providerHealthEvidenceCurrent`; `healthReady` remains literal false.
- `AiWorkspaceAdapterHealthProbeTarget` is server-internal credential material plus binding/provider/fingerprint/contract hash. `AiWorkspaceAdapterHealthObservationWrite` accepts expected hashes and a normalized result; neither is a browser schema.
- Healthy rows forbid failure/message fields. Unhealthy rows require one closed failure and a trimmed 1-through-300-character safe message. Every row expires after five minutes and is append-only.
- Current evidence requires the latest observation to postdate configuration, remain unexpired, and match current credential and contract hashes. Healthy is additionally required for providerHealthEvidenceCurrent; status alone never grants readiness.

## Provider text-codec contract (Release 0.73)

- `AI_TEXT_CODEC_LIMITS` is a frozen limits dictionary: model ID 200 characters, system text 20,000, user text 200,000, output limit 16,384 tokens, raw response 1,048,576 bytes, normalized text 400,000 characters, and 32 response items/parts per bounded array.
- `AI_PROVIDER_TEXT_CODEC_CONSTRAINTS` is the frozen shared constraint tuple. `AI_PROVIDER_TEXT_CODEC_CONTRACTS` is the frozen three-row provider dictionary containing provider/key/version/schema/source identity and request/response shape names. These are module constants, not mutable globals or tenant configuration.
- `AiTextCodecRequest` contains provider, model ID, one user text value, optional system text, and maximum output tokens. It contains no URL, header, credential, tool, media, streaming, tenant, routing, or spend field.
- `AiProviderTextRequest` exposes provider/model/body plus literal `streaming:false`, `tools:false`, and `execution:false`. OpenAI uses `input`/optional `instructions`; Anthropic uses text-only `messages`/optional top-level `system`; Google uses text-only `contents`/optional `systemInstruction`.
- `AiProviderTextResponse` normalizes visible text, `completed|max_output|refusal|blocked|unknown`, optional safe token counts and response ID, plus literal false streaming/tools/raw-storage/execution flags. It never exposes reasoning content or raw provider payloads.
- `AiTextCodecError` carries the closed code union `invalid_request`, `unsupported_provider`, `response_too_large`, `invalid_json`, `invalid_response`, or `output_too_large`; messages are safe boundary diagnostics and contain no prompt, credential, or raw response.
- `AiProviderInvocationContract` and `AiWorkspaceAdapterInvocationBinding` add `codecAvailable` plus optional `codecVersion`. Contract v2 is codec-available, while implementation/health/routing/activation/execution remain false.

## Fixed text-transport contract (Release 0.74)

- `AI_PROVIDER_TEXT_TRANSPORT_TIMEOUT_MS` is 30,000 and `AI_PROVIDER_TEXT_TRANSPORT_MAX_TIMEOUT_MS` is 60,000. Both are immutable module constants; a supplied timeout must be a positive safe integer within the hard maximum.
- `AI_PROVIDER_TEXT_TRANSPORT_CONSTRAINTS` freezes eight rules: fixed HTTPS endpoint, header-only credential, JSON POST, redirect error, no-store, bounded timeout, bounded response, and no retry.
- `AI_PROVIDER_TEXT_TRANSPORT_CONTRACTS` is the three-row v3 dictionary containing codec/transport/schema versions, endpoint-policy name, internal source reference, and source hash.
- `AiProviderTextTransportFailure` is the closed union `credential_rejected`, `rate_limited`, `provider_unavailable`, or `unexpected_response`.
- `AiProviderTextTransportResult` is either `{status: success, response: AiProviderTextResponse}` or `{status: error, failure, safeMessage}`. It never returns the credential, request body, raw response, provider error body, headers, or URL.
- `AiProviderInvocationContract` and `AiWorkspaceAdapterInvocationBinding` add `transportAvailable`, optional `transportVersion`, and optional `endpointPolicy`. V3 carries `fixed-https-text-v1`; implementation/health/routing/activation/public execution remain false.

## Implementation and health-readiness contract (Release 0.75)

- `AI_PROVIDER_TEXT_IMPLEMENTATION_CONSTRAINTS` freezes `codec-required`, `transport-required`, `internal-only`, `no-public-route`, and `routing-disabled`.
- `AI_PROVIDER_TEXT_IMPLEMENTATION_CONTRACTS` is the three-row v4 dictionary containing provider, contract/schema/codec/transport/implementation versions, endpoint policy, source reference, and source hash.
- `AiProviderInvocationContract.implementationAvailable` is now boolean plus optional `implementationVersion`; catalog `healthReady` remains literal false because no tenant evidence is in a global row.
- `AiWorkspaceAdapterInvocationBinding.implementationAvailable` and `.healthReady` are booleans. Implementation mirrors the reviewed contract; health readiness is implementation AND current healthy tenant evidence.
- `AiWorkspaceAdapterHealthObservation` projects implementation/readiness at read time. The stored observation remains only status/failure, safe message, private hashes, actor, and times; readiness is not persisted.
- `providerHealthEvidenceCurrent` retains its strict healthy/configuration/evidence conjunction. `healthReady` adds implementation availability and never changes literal false `routingAvailable`, `adapterActivation`, or `execution`.
- `implementationVersion` is `hosted-text-implementation-v1`; it means the reviewed codec and fixed transport compose internally, not that any route, user, router, assistant, campaign, reservation, or workflow may invoke it.

## Text invocation-intent contract (Release 0.76)

- `AI_TEXT_INVOCATION_INTENT_STATUSES` is the readonly tuple `prepared`, `cancelled`; `AiTextInvocationIntentStatus` derives from it.
- `AiTextInvocationIntentWrite` carries workspace, invocation-binding, reservation, and idempotency UUIDs; required user text; optional system text; and a 1-through-16,384 maximum output-token value. Raw text exists only for validation and hashing in the server call.
- The stored row privately retains `user_text_sha256`, optional `system_text_sha256`, canonical `request_hash`, `contract_source_hash`, and `credential_fingerprint`. These are immutable evidence fields, not public projection fields or globals.
- `AiTextInvocationIntent` exposes minimized workspace/binding/reservation/quote/provider/model/feature/currency/cost/output-bound/lifecycle attribution and timestamps.
- `authorizationCurrent` is derived, never client-supplied or persisted. `promptStored`, `providerRequest`, `outputStored`, `usageRecorded`, `settlement`, `routingAvailable`, and `execution` are literal false values.
- One reservation can back only one intent. Workspace/idempotency key is unique; an exact retry returns the first row and a changed request fails.
- Cancellation requires a trimmed 1-through-500-character reason, adds actor/time evidence, and releases the linked reservation if it remains active.

## Text invocation-attempt contract (Release 0.77)

- `AI_TEXT_INVOCATION_ATTEMPT_STATUSES` is the readonly `claimed`, `succeeded`, `failed`, `ambiguous` tuple; its union type is derived.
- `AiTextInvocationAttemptClaimWrite` carries workspace/intent IDs plus original system/user text for exact private-hash verification; the prompt is not written again.
- `AiTextInvocationAttemptTarget` is server-private and contains attempt/workspace/intent/provider/model/output bound plus encrypted credential, credential fingerprint, and contract hash.
- `AiTextInvocationAttemptOutcomeWrite` is either bounded success output/response ID/stop reason/token counters or a closed failed/ambiguous code and safe message.
- Failure codes are `credential_unavailable`, `provider_outcome_unknown`, `evidence_changed`, and `claim_abandoned`.
- Safe `AiTextInvocationAttempt` exposes lifecycle, provider/model, actor/times, optional safe failure/usage metadata, and hash-presence booleans—not hash values.
- `providerRequestStatus` is `not_sent`, `sent`, or `unknown`; `retryAllowed` is always false. Raw output, provider response ID, usage recording, settlement, and routing remain unavailable.

## Text output and reconciliation contracts (Release 0.78)

- `AI_TEXT_OUTPUT_ARTIFACT_STATUSES` is the readonly tuple `pending_review`, `accepted`, `discarded`; `AiTextOutputArtifactStatus` derives from it. Review transitions are one-way from pending to either terminal value.
- `AI_TEXT_RECONCILIATION_STATUSES` is the readonly tuple `settled`, `quarantined`; `AiTextReconciliationStatus` derives from it.
- `AiTextInvocationAttemptOutcomeWrite` success carries transient `outputText`, its `encryptedOutput` v1 AES-GCM envelope, literal `encryptionKeyVersion: "v1"`, bounded latency, optional provider response ID, closed stop reason, and optional non-negative input/output token counters. Plaintext is used only for hashing/length verification inside finalization and is not a stored model field.
- `AiTextInvocationAttempt.outputStored` and `.outputEncrypted` are derived booleans. The safe attempt still returns no plaintext, ciphertext, output hash, or provider response ID.
- `AiTextOutputArtifact` exposes IDs, provider/model, status, character count, creator/reviewer attribution, optional review note, and times. Its safety flags are literal `outputEncrypted: true`, `outputReturned: false`, `outputHashReturned: false`, `publishingAuthorized: false`, and `execution: false`.
- `AiTextOutputArtifactReadTarget` is server-private and contains only artifact/workspace/status, encrypted envelope, and key version. It is never serialized by list APIs.
- `AiTextOutputArtifactReviewWrite` contains workspace/artifact IDs, decision, and a trimmed 1-through-1,000-character note.
- `AiTextInvocationReconciliation` contains attempt/reservation/rate-card lineage, currency, actor/time, optional exact cost/token/usage-event values, and derived `usageRecorded`/`reservationSettled`. `retryAllowed` is always false.
- Quarantine reasons form the closed union `missing_usage`, `unsupported_rate_card`, `cost_exceeds_authorization`. Settled rows require cost, both token counts, and one usage-event ID; quarantined rows require a reason and forbid a usage-event ID.
- `workspace_ai_text_output_artifact.attempt_id` and reconciliation `attempt_id` are unique, and `ai_usage_event.text_invocation_attempt_id` is unique when present. These collections therefore model exactly zero-or-one artifact, reconciliation, and usage event per attempt rather than mutable lists.

## Accepted text Draft proposal contract (Release 0.79)

- Release 0.79 introduced `attached` and `dismissed`; Release 0.80 extends `AI_TEXT_DRAFT_PROPOSAL_STATUSES` to the readonly tuple `attached`, `applied`, `dismissed`. `AiTextDraftProposalStatus` derives from the current tuple.
- `AiTextDraftProposal` contains artifact/attempt/Draft/source-version lineage, provider/model, character count, lifecycle actors/notes/times, and derived `sourceCurrent`.
- Safety values retain literal `outputEncrypted: true`, `outputReturned: false`, `publishingAuthorized: false`, and `execution: false`. `draftContentMutated` is derived and is true only when application created the recorded successor.
- `AiTextDraftProposalAttachWrite` carries workspace/artifact/Draft IDs. `AiTextDraftProposalDismissWrite` carries workspace/proposal IDs and a trimmed 1-through-1,000-character note.
- `AiTextDraftProposalReadTarget` is server-private and contains proposal/workspace/Draft IDs plus encrypted output/key version. Safe lists never include ciphertext or plaintext.
- Each artifact can appear in at most one proposal. The composite source-version/Draft foreign key proves the proposal references a version belonging to that exact Draft.

## Applied text Draft proposal contract (Release 0.80)

- `AiTextDraftProposalApplyWrite` contains `workspaceId`, `proposalId`, `leadIn`, optional `callToAction`, readonly `hashtags`, optional `altText`, and `changeNote`. It contains no provider output, body, headline, fact, evidence ID, version number, state, actor, timestamp, or authority field.
- Input bounds are: lead-in 0-500 trimmed characters without `.`, `!`, or `?`; optional call to action 1-1,000 trimmed characters; at most 20 case-insensitively unique hashtags matching `^#[letters/numbers/_]{1,50}$`; optional alternative text 1-2,000 trimmed characters; and a 3-1,000-character trimmed change note.
- `selectedFields` is the ordered, server-derived subset of `lead_in`, `call_to_action`, `hashtags`, and `alt_text` whose final values differ from the exact source version. At least one field must differ. It is persisted as a bounded `text[]`, never trusted from a client.
- Applied proposal metadata adds optional `appliedByUserId`, `applicationNote`, `appliedVersionId`, `selectedFields`, and `appliedAt`. These values are present together only for terminal `applied`; dismissal fields and application fields are mutually exclusive by database constraint.
- `sourceCurrent` is true only for an `attached` proposal whose source is still the current editable Draft version. Applied and dismissed records always project false.
- `DRAFT_FORMAT_CHARACTER_LIMITS` remains the immutable format-to-ceiling dictionary. Proposal application uses the source generation's `draftFormat` and rejects reconstructed body plus selected call-to-action content above that ceiling.
- The successor retains headline/rationale, source-version lineage, and every fact claim plus its sorted evidence-ID array. `presentationChoices` retains prior keys and adds the selected `leadIn` plus `aiTextDraftProposalId` lineage.
- Application is replay-safe: an exact or repeated call after `applied` returns the existing proposal and version. It cannot create another version, reopen ciphertext access, or transition to dismissal.

## AI execution-control contract (Release 0.81)

- `AI_EXECUTION_CONTROL_STATES` is the readonly tuple `stopped|enabled`; `AiExecutionControlState` derives from it.
- `AiWorkspaceExecutionControl` contains `workspaceId`, state, optional reason/window/actor/timestamps, `configured`, and derived `executionAllowed`. Absence projects `{state:"stopped", configured:false, executionAllowed:false}`.
- `AiWorkspaceExecutionControlWrite` contains workspace, state, a trimmed 3-500-character reason, and optional `enabledForMinutes`. Enabled requires an integer 1-1,440; stopped forbids a duration. `enabledUntil` is derived by the server and cannot be supplied by a client.
- `AI_PROVIDER_CIRCUIT_STATES` is `closed|open`. `AI_PROVIDER_CIRCUIT_FAILURES` is the closed union `credential_unavailable|provider_outcome_unknown|claim_abandoned`.
- `AiWorkspaceProviderCircuit` contains workspace/provider identity, state, `consecutiveUnsafeOutcomes`, optional last failure/outcome/open/reset evidence, creation/update times, and derived `executionAllowed`. It contains no prompt, credential, output, response ID, cost, or authority token.
- `AiWorkspaceProviderCircuitResetWrite` contains workspace, one `AiHostedProviderType`, and a trimmed 3-500-character reset note. Actor and time are server-derived.
- `AI_PROVIDER_CIRCUIT_FAILURE_THRESHOLD` is an internal immutable constant equal to three. Credential-unavailable bypasses the threshold; success resets the counter; `evidence_changed` is excluded because it is local authorization drift rather than provider evidence.
- `workspace_ai_execution_control` enforces stopped/no-expiry versus enabled/expiry states and membership-bound creation/update actors. `workspace_ai_provider_circuit` enforces state/open evidence, closed reset fields, supported provider values, nonnegative counters, and membership-bound reset actors.

## AI text invocation resolution contract (Release 0.82)

- `AI_TEXT_INVOCATION_RESOLUTION_DISPOSITIONS` is the readonly tuple `confirmed_no_charge|settled_provider_charge`; `AiTextInvocationResolutionDisposition` derives from it. A free-form disposition is invalid.
- `AiTextInvocationResolutionWrite` contains `attemptId`, `disposition`, optional `providerChargeMinor`, `evidenceReference`, and `note`. Evidence fields are trimmed and bounded. Charge is required only for `settled_provider_charge` and is an integer from 1 through 1,000,000,000 minor units.
- `AiTextInvocationResolution` contains immutable resolution/attempt/intent/reservation/reconciliation lineage, workspace/provider/model, disposition, optional exact charge, currency, evidence fields, previous/final reservation status, reviewer identity, and timestamps.
- Safety fields are literal `usageUnitsKnown:false`, `retryAllowed:false`, and `providerRequestRetried:false`. A reviewed charge creates no token, latency, output, retry, or provider-response evidence.
- Important transaction locals are `current`, `eligible`, `previousStatus`, `finalStatus`, and `resolutionId`; they never become globals. The returned `resolutions` list is safe history, not an authority or work-execution queue.
- A reconciliation ID exists only for quarantined success. An ambiguous attempt can resolve without one. A settled reviewed charge contributes exact cost and one request to aggregates but creates no `workspace_usage_event`.
- Database constraints enforce disposition/amount pairing, bounded text, valid hold transitions, tenant-composite foreign keys, and at most one resolution per attempt, reservation, and reconciliation. Replay returns that single immutable row.

## AI operational incident and readiness contracts (Release 0.83)

- `AI_OPERATIONAL_INCIDENT_TYPES` is the readonly tuple `provider_circuit_open|invocation_ambiguous|reconciliation_quarantined`; `AI_OPERATIONAL_INCIDENT_SEVERITIES` is `critical|high`; and `AI_OPERATIONAL_READINESS_STATES` is `ready|attention|blocked`.
- `AiOperationalIncident` contains deterministic `type:attemptId` identity, workspace, type, severity, attempt/provider, optional reconciliation, one closed reason/summary, opened time, optional acknowledgement evidence, and literal `active:true`, `providerRequestRetried:false`, and `executionAuthority:false`.
- `AiOperationalIncidentAcknowledgeWrite` contains workspace, type, attempt ID, and a trimmed 3-1,000-character note. Provider, reconciliation, severity, source time, actor, and acknowledgement time are server-derived.
- `AiOperationalReadiness` contains workspace, state, active/unacknowledged/critical counts, optional oldest time, evaluated time, `executionShouldRemainStopped`, and literal false external-alert-delivery/public-route fields.
- `ready` means no active incidents; `attention` means active incidents are all acknowledged and none critical; `blocked` means at least one unacknowledged or critical incident. Acknowledged critical incidents remain blocked until their source circuit closes.
- Important collections are the request-scoped `incidents` array and the readonly type/severity/state tuples. Important locals are `unacknowledgedIncidentCount`, `criticalIncidentCount`, `oldestActiveAt`, `incident`, `stillActive`, and `acknowledgementId`; none is global mutable state.
- The acknowledgement table requires an attempt for every type, a reconciliation only for quarantine, a tenant-bound reviewer, bounded note, and one row per workspace/type/attempt. Activity continues to come from source tables rather than an editable acknowledgement status.

## AI incident-response policy contract (Release 0.84)

- `AI_OPERATIONAL_INCIDENT_RESPONSE_STATES` is the readonly tuple `within_target|acknowledgement_overdue|acknowledgement_late|resolution_overdue`; resolution overdue takes precedence, then unacknowledged overdue, then late acknowledgement.
- `AiOperationalIncidentResponsePolicy` contains workspace, four minute targets, optional runbook, configured/attribution/timestamp metadata, literal `executionAuthority:false`, and the current Boolean `externalAlertDeliveryConfigured` projection.
- Default immutable values are critical acknowledgement 5, high acknowledgement 30, critical resolution 60, and high resolution 240 minutes. An unconfigured policy has no runbook or actor/time fields.
- `AiOperationalIncidentResponsePolicyWrite` contains workspace, all four integer targets, and one HTTPS `runbookUrl`. Critical acknowledgement is 1-60, high 1-1,440, critical resolution 5-10,080, and high 5-43,200; each resolution target must be at least its acknowledgement target.
- `AiOperationalIncident` adds acknowledgement/resolution due timestamps, acknowledgement overdue/late, resolution overdue, and response state. These are derived from source time, severity, policy, acknowledgement, and request `asOf`.
- `AiOperationalReadiness` adds acknowledgement-overdue, acknowledgement-late, resolution-overdue counts and optional `nextResponseDueAt`. The next deadline includes acknowledgement only while unacknowledged and always includes source resolution.
- Important immutable/global-safe value is `DEFAULT_AI_OPERATIONAL_INCIDENT_RESPONSE_POLICY`; important request locals are `policy`, `acknowledgementMinutes`, `resolutionMinutes`, both due times, three Boolean states, and `responseState`. No mutable global timer/list is added.

## AI operational alert contracts (Release 0.85)

- `AI_OPERATIONAL_ALERT_WEBHOOK_STATUSES` is `unverified|verified|error|disabled`; `AI_OPERATIONAL_ALERT_EVENT_TYPES` is `incident_opened|incident_acknowledged|acknowledgement_overdue|resolution_overdue|incident_resolved`; `AI_OPERATIONAL_ALERT_DELIVERY_STATUSES` is `pending|processing|failed|delivered|dead_letter`.
- `AiOperationalAlertWebhook` is the safe public projection: workspace, status, optional endpoint origin, secret/configuration/delivery Booleans, optional test/error/timestamps, and literal false execution/provider-request authority. It cannot contain the endpoint path or signing secret.
- `AiOperationalAlertDelivery` is safe history: event/incident/attempt/provider identity, status/count/schedule, optional delivery response evidence, timestamps, and literal `payloadReturned:false`, `endpointReturned:false`, `signingSecretReturned:false`, `executionAuthority:false`.
- `AiOperationalAlertWebhookWrite` carries full endpoint, encrypted secret envelope, lowercase 64-hex secret fingerprint, and `v1` encryption version inside the server boundary. `AiOperationalAlertWebhookVerificationTarget` is administrator-only and must never cross a normal read route.
- `AiOperationalAlertDeliveryTarget` is worker-only and contains endpoint, encrypted secret, fingerprint/version, safe payload, occurred time, and current claim count. `AiOperationalAlertDeliveryOutcomeWrite` accepts delivered 2xx evidence or retryable/permanent safe failure evidence for the exact claim.
- The outbox payload is a bounded object with version/event/workspace, safe incident identity/severity/provider/reason/summary/times/state, optional runbook, and literal false authority. It excludes prompts, outputs, credentials, secret fingerprints, private pricing/billing detail, and acknowledgement-note text.
- Important readonly/global values are the three closed tuples and `OPERATIONAL_ALERT_WEBHOOK_LIMITS`. Important request-scoped collections are `allowedHosts`, `incidents`, `activeKeys`, `targets`, and delivery history. No mutable global queue, secret map, or timer is introduced.

## Exact prepared-intent execution contract (Release 0.86)

- `aiTextInvocationIntentExecuteSchema` is strict and contains `workspaceId`, path-owned `intentId`, `userText`, and optional `systemText`. Text uses the provider codec ceilings; actor, provider, model, quote, reservation, credential, attempt state, retry, output, usage, settlement, and authority fields are never client-selectable.
- `ExecutePreparedTextInvocationInput` carries the exact intent/workspace/user/prompt values into the server executor. `ExecutionDependencies` supplies repository, fixed transport, credential/output cryptography, `deploymentExecutionEnabled`, and request time; clients cannot construct it.
- The executor's server-only `target` contains the claimed attempt plus current provider/model/contract/credential evidence. Decrypted `apiKey` exists only in request-scoped memory and its local reference is cleared after the single transport attempt.
- The response's attempt is the existing safe `AiTextInvocationAttempt`. Added route metadata is `providerRequestAttempted`, literal `providerRequestRetried:false`, literal `outputReturned:false`, `outputEncrypted`, `settlementComplete`, and literal `publishingAuthority:false`.
- UI state variables are request-local React state: `pending` selects the current prepare/execute action, `intentId` identifies a prepared row, and `systemText`/`userText` retain operator-entered plaintext only in the browser form. `executionAvailable` is a server-derived Boolean combining deployment flag, valid output vault, and current workspace enablement; it is presentation gating, not execution authority.
- Preparation persists prompt hashes rather than text. Executing later must resubmit the exact prompt; substituted whitespace/content fails hash authorization before provider I/O. A prepare-and-execute click performs two separate authorized operations and does not weaken either boundary.
- One intent has at most one claimed attempt, one encrypted output, one reconciliation, and one usage event. A successful attempt may progress through human output review and Draft proposal/application, but it cannot publish, route, approve, or mutate product content by itself.
- No migration, dictionary, tuple, list, or mutable global is added in 0.86. Existing closed status/failure tuples and relational uniqueness remain authoritative.

## Draft-bound revision contracts (Release 0.87)

- `AI_DRAFT_REVISION_GOALS` is the readonly tuple `clarity|concision|audience_fit|call_to_action`; `AiDraftRevisionGoal` derives from it. No client-defined goal or free-form prompt is accepted by the product APIs.
- `AiDraftRevisionIntentWrite` contains workspace/Draft, invocation binding, reservation, idempotency UUID, one closed goal, and bounded maximum output tokens. Actor, source version, prompt, context hash, provider/model, quote, credential, attempt, output, and authority are server-derived.
- `AiDraftRevisionPromptTarget` is server-private and contains workspace/Draft/version, goal, `draft-revision-v1`, context SHA-256, and reconstructed system/user text. `PreparedAiDraftRevisionIntent` pairs that transient target with the safe persisted intent for an immediate server-only handoff.
- `AiTextInvocationIntentWrite.draftRevision` is optional server context containing exact Draft/version, goal, prompt version, and context hash. The generic public schema cannot submit it. Safe intents add optional source IDs/goal/version plus `productBound` and `sourceContextHashStored`; they never return the hash or prompt.
- Product-bound output artifacts inherit safe source Draft/version/goal metadata so UI and repository attachment can constrain the target. Ciphertext/plaintext and private hashes remain absent.
- Canonical prompt context contains exact Campaign/package/audience names, Draft format, current presentation fields, ordered claims with sorted evidence IDs, and evidence records sorted by ID with sorted source references. The `context`, `claims`, and `evidence` collections are request-scoped immutable values.
- Important UI state is `invocationBindingId`, `reservationId`, `goal`, `maxOutputTokens`, `pending`, and `message`; derived `draftIntents`, `readyBindings`, and `availableReservations` are local arrays. None is global or an authority token.
- Database source columns are all-null for generic intents or all-present for Draft-bound intents. Source Draft/version foreign keys, the goal check, prompt-version bound, SHA-256 check, reservation uniqueness, and the existing one-attempt/output/reconciliation/usage constraints form the persistent contract.

## In-context Draft authorization contracts (Release 0.88)

- `AiWorkspaceAdapterInvocationBinding.rateCardId`: exact current rate-card identifier carried with the already-safe tenant binding projection. It lets the Draft UI request the server-owned action quote for that binding; it carries no price, credential, execution, routing, or budget authority.
- `authorizedReservations`: component-local readonly collection initialized from server-rendered workspace reservations. A successful in-context reservation is prepended once by ID so it is immediately usable without discarding the current Draft interaction.
- `availableReservations`: derived list restricted to `reserved`, `generate_text`, `assistant.prepare_copy` reservations not already bound to any displayed intent. It is recomputed on render and is not an authority cache.
- `readyBindings`: derived list of invocation bindings whose safe projection reports `healthReady`. Server quote, reservation, preparation, and execution repositories recheck currentness independently.
- `invocationBindingId` and `reservationId`: selected identifiers only. `authorize()` resolves the selected binding, quotes its exact `rateCardId`, reserves the returned quote maximum, then selects the returned reservation ID.
- `quoteResponse`/`quoteBody` and `reserveResponse`/`reserveBody`: short-lived HTTP results. Error handling distinguishes quote failure from reservation failure so a durable but unreserved quote is not misrepresented.
- `reservation`: typed `AiSpendReservation` returned by the authoritative reservation transaction. Its ID, status, capability, feature, amount, and currency drive display/filtering; the client never constructs a reservation.
- `pending`: closed UI operation marker (`authorize`, prepare/execute variants, intent operations) used only to suppress duplicate controls. `message` is a transient success/error notice and explicitly states that authorization made no provider request.

The workflow is intentionally sequential: one immutable quote may exist without a reservation, while a successful reservation is a separate budget hold. Both remain durable server entities and continue to appear in the full AI ledger. Release 0.88 adds no database entity, enum, global mutable variable, or migration.

## In-context Draft output review state (Release 0.89)

- `outputArtifacts`: server-provided readonly safe artifact projections. They contain identifiers, provider/model, closed status, character count, source Draft/version/goal, and literal authority flags; they contain no plaintext, ciphertext, output hash, credential, provider response, or pricing evidence.
- `draftArtifacts`: derived array restricted to `productBound` artifacts whose `sourceContentDraftId` equals the page Draft. The repository remains authoritative even if client filtering is bypassed.
- `proposals`: existing readonly proposals for the exact Draft. `attachedArtifactIds` is a component-local `Set` derived from their artifact IDs for display and duplicate-action suppression only.
- `selectedArtifactId`: exact artifact whose plaintext is temporarily open. `selectedArtifact` derives its safe metadata from `draftArtifacts`; it is not a decryption or review authority token.
- `outputText`: transient decrypted text returned only by the approver route. It is never persisted by the component and is cleared on close, review completion, or attachment completion.
- `reviewNote`: bounded human review rationale sent with closed decision `accepted|discarded`. `pending` identifies the current open/review/attach action; `message` carries safe success/error feedback.
- Per-artifact `sourceCurrent` compares `sourceContentDraftVersionId` with the exact page version, and `attached` checks `attachedArtifactIds`. Both are UI safeguards; the repository locks and rechecks all source and uniqueness constraints.
- `canApprove`, `canEdit`, and `vaultAvailable` control visible conveniences only. Every read, review, and attach route independently enforces the required workspace role and repository contract.

Release 0.89 adds no entity, enum, tuple, dictionary, mutable global variable, or migration. It composes existing `AiTextOutputArtifact` and `AiTextDraftProposal` lifecycles.

## Structured Draft revision suggestion contracts (Release 0.90)

- `AI_DRAFT_REVISION_PROMPT_VERSIONS`: readonly tuple `draft-revision-v1|draft-revision-v2`; `AI_DRAFT_REVISION_CURRENT_PROMPT_VERSION` is v2. Persisted intents choose reconstruction behavior.
- `AI_DRAFT_REVISION_SUGGESTION_VERSION`: literal `draft-revision-suggestion-v1`.
- `AiDraftRevisionPresentationSuggestion`: closed optional `leadIn`, `callToAction`, `hashtags`, `altText` plus required `rationale`; no headline/body/facts/evidence/authority field exists.
- `AiDraftRevisionSuggestionParseResult`: `valid|unavailable`, optional frozen suggestion, readonly issues, and literal false `draftContentMutated`/`publishingAuthorized`.
- `suggestionParse`: proposal API result; `selectedSuggestionFields` is a readonly local array of `leadIn|callToAction|hashtags|altText`, initially empty. `toggleSuggestionField` changes explicit selection and `useValidatedSuggestions` fills only selected controls then clears selection.
- Parser collections are closed-key `Set`, optional hashtag array, readonly issue array, and frozen suggestion object. They are request/component scoped; no mutable global or database state is introduced.

## Conversation retention erasure contracts (Release 0.91)

- `CONVERSATION_RETENTION_ERASURE_STATUSES` is the readonly tuple `pending|executed|rejected`; `ConversationRetentionErasureStatus` derives from it. Pending is the only undecided state, and execution has no application-level restore transition.
- `ConversationRetentionErasureRequest` is the safe workspace projection: request/workspace/thread IDs, non-hold class, exact `eligibleAfter`, closed status, bounded governance notes, actor display evidence, decision times, optional aggregate counts, and optional subject/relationship labels available only while the source thread still exists.
- `ConversationRetentionDeletedCounts` is the closed aggregate dictionary: literal `threads: 1` plus integer counts for messages, handoff briefs, read states, drafting presence, response suggestions, response drafts, review requests, review mentions, and shared resources. Counts are evidence, not source-content snapshots.
- `ConversationRetentionErasureRequestWrite` contains exact workspace/thread identity and `requestNote`. `ConversationRetentionErasureDecisionWrite` contains exact workspace/request identity, closed decision `execute|reject`, and `decisionNote`. Route-owned IDs override path/body ambiguity; actors, eligibility, class, status, counts, and timestamps are never client-selected.
- The request row retains no source subject, relationship ID/name, message body, internal note, identity, provider payload, connector credential, or AI output. Read projection obtains optional labels through a current live-thread join; executed rows naturally return them as absent.
- Important request-scoped collections are the bounded erasure request list (maximum 200), `pendingRequests`, component-local decision-note dictionary keyed by action/request ID, and the transaction-local deleted-count object. There is no mutable global queue, timer, scheduler, automatic batch, or restore dictionary.
- Authority is not encoded in the status tuple or UI state. Writers may request; approval roles may decide; the requester cannot decide the same row; and every execute rechecks the current enabled policy, closed state, non-hold class, exact eligibility snapshot, and tenant identity under locks.

## Conversation legal-hold contracts (Release 0.92)

- `CONVERSATION_LEGAL_HOLD_STATUSES` is the readonly tuple `active|released`; `ConversationLegalHoldStatus` derives from it. `CONVERSATION_LEGAL_HOLD_RELEASE_REQUEST_STATUSES` is `pending|approved|rejected`; its derived type has no reopen transition.
- `ConversationLegalHoldCase` contains `id`, `workspaceId`, scalar `conversationThreadId`, `previousRetentionClass`, bounded `reason`, optional `caseReference`, status, placement actor/display/time, and optional release actor/display/time/request ID. Display names are hydrated projections, not duplicated ledger columns.
- `ConversationLegalHoldReleaseRequest` contains request/hold/workspace/thread IDs, exact `targetRetentionClass`, bounded `requestNote`, status, requester display evidence/time, and optional decision actor/display/time/note. Target class excludes `legal_hold` by type and database check.
- `ConversationLegalHoldWrite` is `{workspaceId, conversationThreadId, reason, caseReference?}`. `ConversationLegalHoldReleaseRequestWrite` is `{workspaceId, legalHoldCaseId, targetRetentionClass, requestNote}`. `ConversationLegalHoldReleaseDecisionWrite` is `{workspaceId, requestId, decision: approve|reject, decisionNote}`. Actor identity and all timestamps/states are server-owned.
- `ConversationRetentionErasureRequest.threadRetentionRevision` is an integer snapshot of `conversation_thread.retention_revision`. The counter starts at zero and increments on every effective ordinary class change, hold placement, and approved hold release. It never decrements and is compared only for exact equality during erasure execution.
- Repository row aliases `ConversationLegalHoldRow` and `ConversationLegalHoldReleaseRow` represent nullable SQL/time fields before normalization. `normalizeLegalHoldCase` and `normalizeLegalHoldReleaseRequest` convert timestamps to ISO strings and SQL nulls to absent optional properties.
- Component-local `STANDARD_CLASSES` is the readonly tuple `standard|personal_message|imported_email`; `StandardRetentionClass` derives from it. `activeHold` and `releaseRequest` are derived list lookups. `canWrite` and `canApprove` improve display only; `pending` is an action string and `error` is transient feedback. None is global or authoritative.
- Important bounded collections are the per-thread hold history (maximum 100), release-request history (maximum 100), one active case, and one pending request per case. There is no automatic expiry list, custodian list, external evidence dictionary, global release queue, or scheduled worker in this release.

## Workspace legal-hold operation projections (Release 0.93)

- `ConversationLegalHoldCase.subject` and `relationshipDisplayName` are optional hydrated projection fields. `ConversationLegalHoldReleaseRequest` exposes the same optional labels. They are absent after source unavailability and are never ledger columns.
- `ConversationLegalHoldRow` and `ConversationLegalHoldReleaseRow` model SQL-null label joins before normalizers convert nulls to absent properties. Existing optional actor/time/note normalization is unchanged.
- `listActiveLegalHolds` returns active cases ordered newest first with a hard limit of 200. `listPendingLegalHoldReleaseRequests` returns pending releases oldest first with the same limit so earlier approvals remain visible first.
- `activeLegalHolds` and `legalHoldReleaseRequests` are readonly server-rendered arrays. Each card derives `releaseRequest` by `legalHoldCaseId`, `selfRequested` by user ID, and a component-local note key. These values do not persist or grant authority.
- The retention-policy response `meta` adds `activeLegalHoldCount` and `pendingLegalHoldReleaseCount`; analyst/viewer responses use zero and empty arrays. The existing `limit: 200` covers all bounded workspace projections.
- No new tuple, global variable, mutable singleton, database table, migration, or status transition is introduced. The 0.92 case/request contracts and decision transaction remain authoritative.

## Recent legal-hold decision projection (Release 0.94)

- `recentLegalHoldReleaseDecisions` is a readonly array of the existing `ConversationLegalHoldReleaseRequest` contract. It contains only rows whose closed status is `approved` or `rejected`; no new enum member, interface, or persisted decision shape is introduced.
- `listRecentLegalHoldReleaseDecisions` orders by non-null `decidedAt` newest first, then stable request ID, and returns at most 200 records. The UI intentionally derives a display-only `slice(0, 20)` without changing the API/database bound.
- Every history item retains `targetRetentionClass`, `requestNote`, requester identity/time, status, decision identity/time/note, scalar thread ID, and optional live `subject`/`relationshipDisplayName` labels. It does not contain message, note, identity, provider, credential, or AI-output content.
- The response `meta.recentLegalHoldReleaseDecisionCount` is the length of the bounded server result, not an unbounded database total. Analysts and viewers receive zero and an empty decision array.
- `request.subject` is used only to decide whether the UI renders a source-thread link. An absent label means the live source is unavailable; the scalar governance identity and decision evidence remain valid.
- Migration 0082 introduces only `conversation_legal_hold_release_decisions_idx`; the existing case/request tables, status tuples, normalization functions, tenant constraints, and release transaction remain unchanged.

## Content-asset publication-rights contracts (Release 0.95)

- `CONTENT_ASSET_RIGHTS_STATUSES` is the readonly tuple `unchecked|cleared|restricted|expired`; `ContentAssetRightsStatus` derives from it. `unchecked` means no authoritative review, `restricted` means evidence or supported-use requirements block execution, and `expired` is an effective hydrated state when a stored clearance has elapsed.
- `CONTENT_ASSET_RIGHTS_CHANNELS` is the readonly tuple containing `discord_webhook`; `ContentAssetRightsChannel` derives from it. Expansion requires a forward schema/application change plus preview, activation, and execution revalidation.
- `ContentAsset` carries owner/license owner, source/proof references, three permission Booleans, permitted-channel array, optional validity window, optional attribution/watermark/disclaimer requirements, bounded review note, reviewer identity/display/time, and integer `rightsRevision`. Derivatives expose the source original's effective fields.
- `ContentAssetRightsReviewWrite` is the repository input dictionary. Client-selected status is only `cleared|restricted`; workspace/package/asset identity is exact, while reviewer and review time are server-owned. Each accepted review increments rather than replaces the monotonic revision.
- `StoredDraftPreviewAsset` snapshots `rightsStatus`, `rightsRevision`, `rightsReviewedAt`, and optional `rightsExpiresAt` with object/media/accessibility fields. It is evidence of what was reviewed at preview time, not lasting authority; execution compares it with current original/source rights.
- `RightsDraft` is component-local state keyed by asset ID in the `rights` dictionary. It contains only editable form values: outcome, evidence text, permission Booleans, Discord selection, local datetime strings, unsupported requirements, and review note. `setRight` immutably replaces one field; it is not global state or authorization.
- Runtime validation uses request-local `assetIds`, `selected` map, `issues` list, and a current `Date`. Package approval, preview creation, preview staleness, Campaign activation, publication-target hydration, and worker execution independently fail closed.
- Audit data records asset/package IDs, closed outcome, revision, permission Booleans, permitted-channel count, and evidence-presence flags only. Owner names, source/proof values, review note, and requirement text remain in the tenant-governed asset row.

## Malware scan evidence contracts (Release 0.96)

- `MalwareScanStatus` remains the closed union `clean|infected|not_configured|failed`. Only `clean` plus complete evidence is outbound-eligible; `not_configured` is not an alias for clean.
- `ClamAvInstreamScannerOptions` contains `host`, optional `port`, `timeoutMs`, and `chunkBytes`. Constructor bounds are port 1-65535, timeout 100-120000 ms, and chunks 1 KiB-1 MiB.
- `ProcessedMediaAsset` adds optional `scanEngine`, optional ISO `scanScannedAt`, and required integer `scanRevision`. ClamAV clean results use engine `clamd`, one shared scan timestamp, and revision 1 for the ingestion result; unconfigured/failed results use revision zero.
- `ContentAsset` exposes optional `scanEngine`, `scanScannedAt`, and `scanRevision`. Stored clean rows require all evidence. Original and derivatives receive the same verdict, while execution treats the source original as effective authority.
- `StoredDraftPreviewAsset` adds required `scanRevision` and optional `scanScannedAt`. The snapshot is immutable evidence, not lasting authority; current source status/revision/time must still match.
- Environment variables are `MALWARE_SCANNER=unconfigured|clamav`, `CLAMAV_HOST`, `CLAMAV_PORT`, and `CLAMAV_TIMEOUT_MS`. These are process configuration, not application globals or tenant-editable values.
- Request-local scanner variables include bounded `response`, `settled`, socket, offset, chunk, and length buffers. `finish` is idempotent; `writeSocket` applies callback backpressure. No global scan queue, mutable result cache, quarantine map, or daemon credential exists.

## Exact publishing-account rights contracts (Release 0.97)

- `ContentAsset.rightsPermittedChannelConnectionIds` is an optional readonly string list in the provider-neutral domain projection. Hydrated stored assets expose an ordered list; derivatives inherit the source original's relation.
- `ContentAssetRightsReviewWrite.permittedChannelConnectionIds` is a required readonly list. `cleared` requires at least one ID; `restricted` may use an empty list. The repository deduplicates it and validates tenant/provider ownership before writing.
- `content_asset_rights_channel_connection` is the durable authority relation. `content_asset_id` plus `channel_connection_id` is the primary key; the reverse index supports connection lifecycle checks. It is not a client dictionary and contains no credential or provider payload.
- `StoredDraftPreviewAsset.rightsChannelConnectionId` is the scalar account authorized at preview time. It is optional in the TypeScript read model only because revoked legacy snapshots are `unchecked` with a null value; every new `cleared` snapshot requires it by database constraint.
- `RightsDraft.permittedChannelConnectionIds` is component-local mutable form state represented as a string array. `togglePermittedConnection` returns a deduplicated add or filtered remove result through `setRight`; it has no server authority.
- `channelConnections` passed to the review component contains only `id`, `name`, `provider`, and `status`. Encrypted credentials, capabilities, configuration, and provider identity are never serialized into this form.
- Runtime request-local structures are `permittedChannelConnectionIds`, `permittedConnections`, the preview `selected` map, and `issues` list. There is no global variable, singleton rights cache, tuple registry, mutable account dictionary, or automatic scope expansion.

## Exact Campaign rights contracts (Release 0.98)

- `ContentAsset.rightsPermittedCampaignIds` is an optional readonly string list on the effective provider-neutral asset projection. Hydrated originals expose an ordered list; derivatives inherit the source original's list.
- `ContentAssetRightsReviewWrite.permittedCampaignIds` is a required readonly list. Both `cleared` and `restricted` may carry an empty list because Content Package approval precedes Campaign creation; attachment preview and execution require an exact membership later.
- `content_asset_rights_campaign` is the durable authority relation. The tuple `(content_asset_id, campaign_id)` is its primary key, `created_at` is evidence time, and the reverse index supports Campaign lifecycle checks. It stores no name, status, content, credential, or provider payload.
- `StoredDraftPreviewAsset.rightsCampaignId` is the scalar Campaign authorized at preview time. It is optional in the TypeScript read model only for invalidated legacy snapshots; every newly cleared snapshot requires a Campaign ID by database constraint.
- `RightsDraft.permittedCampaignIds` is component-local string-array state. `togglePermittedCampaign(assetId, campaignId, checked)` adds without duplication or filters one ID through the existing immutable `setRight` update; it grants no server authority.
- The `campaigns` component prop is a readonly credential-free list of `{id, name, status}`. Names and statuses are display metadata; the API accepts UUIDs and the repository validates live same-workspace rows.
- Request-local repository structures are `permittedCampaignIds` and `permittedCampaigns`; preview and execution paths use their existing local `selected` maps and `issues` arrays. There is no global Campaign-rights variable, mutable authorization cache, dictionary, tuple registry, or implicit grant from package inclusion.

## Exact Brand Profile rights contracts (Release 0.99)

- `ContentAsset.rightsPermittedBrandProfileIds` is an optional readonly string list on the effective asset projection. Originals expose ordered stable Brand Profile root IDs; derivatives inherit their source original.
- `ContentAssetRightsReviewWrite.permittedBrandProfileIds` is a required readonly list. It may be empty during package approval, but an attached preview requires the Campaign version's resolved Brand root to be present.
- `content_asset_rights_brand_profile` stores only `content_asset_id`, `brand_profile_id`, and `created_at`. The composite tuple is its primary key; the reverse index supports Brand lifecycle checks. It stores no profile content, version, name, credential, or provider payload.
- `StoredDraftPreviewAsset.rightsBrandProfileId` is the scalar stable Brand root authorized at preview time. It is optional only for invalidated legacy snapshots; every new cleared snapshot requires it.
- `CampaignExecutionTarget.brandProfileId` is derived from the exact Campaign instance version, not from step input or browser state. The worker compares it to each attachment snapshot.
- `RightsDraft.permittedBrandProfileIds` is component-local string-array state. `togglePermittedBrandProfile` performs a deduplicated add or filtered remove through immutable state replacement and has no server authority.
- The `brandProfiles` prop contains readonly `{id, name, status}` values for roots with a current published version. Request-local ID arrays, resolved rows, selected maps, and issue lists replace globals; there is no mutable Brand entitlement cache, dictionary, tuple registry, or implicit Campaign-to-Brand grant.

## OIDC identity and invitation contracts (Release 1.0)

- `StoredOidcAuthState` is the consumed repository projection `{issuer, nonceHash, codeVerifier, returnTo}`. The opaque state hash is the row key; state/nonce plaintext exist only in the initiating request/cookie/provider request. Rows expire after ten minutes and are deleted atomically on successful lookup.
- `OidcSignInResult` is the closed union `authenticated|invited|bootstrapped|not_provisioned`. `authenticated`, `invited`, and `bootstrapped` carry one `AuthenticatedUser`; `not_provisioned` carries no user data. Callers must not turn the negative result into registration.
- `WorkspaceInvitationRole` excludes `owner` from `WorkspaceRole`. `WorkspaceInvitation.status` is the read union `pending|accepted|revoked|expired`; `expired` is a read-time projection for a pending row past database time, not a stored transition.
- The durable identity tuple is `(issuer, subject)`. The unique `(issuer, user_id)` constraint prevents linking two subjects from one issuer to one user. `email_at_link` is linkage evidence; future authentication does not re-key the identity from a changed email.
- `OIDC_BOOTSTRAP_EMAILS` becomes a deduplicated readonly normalized string array in `ServerConfiguration`. It is process configuration, not a tenant list or application global. `OIDC_PROVIDER_NAME` is bounded to 80 characters for presentation only.
- `LOGIN_ERRORS` is a closed, presentation-only dictionary from safe error code to user text. Provider error descriptions and token/exchange response bodies are never inserted into it or returned to the browser.
- Runtime structures—authorization `URLSearchParams`, decoded header/claims dictionaries, JWKS array, invitation arrays, and component-local `email`, `role`, `pending`, and `message` state—are request/render scoped. None grants authority without repository constraints and server-side role checks.
- `scripts/qa-oidc-provider.mjs` is a disposable development acceptance provider with an in-memory one-use code `Map` and ephemeral RSA key pair. It is never imported by the application, production rejects its HTTP issuer, and it must not be treated as an identity deployment option.

## Immutable object-store contracts (Release 1.1)

- `ObjectStore` has exactly two asynchronous operations: `putImmutable(key, bytes)` and `read(key)`. It deliberately exposes no overwrite, rename, list, delete, bucket administration, URL signing, tenant lookup, or credential method.
- `ObjectStoreConfiguration` is the closed union `filesystem|s3`. Filesystem carries one root string. S3 carries bucket, region, optional endpoint/addressing/prefix, optional complete temporary credential set, and the bounded maximum object size. Configuration is process input, not domain authority.
- `S3ObjectStoreOptions.client` accepts the minimal `S3CommandClient` test seam. The runtime client is private to one store instance; the development web singleton caches only the abstract `ObjectStore` and never stores per-tenant credentials or bytes.
- Object keys remain content-derived strings in two namespaces: `originals/<sha256>/<suffix>` and `derivatives/<sha256>/<suffix>`. An optional deployment prefix is prepended after validation. Arrays of stream chunks exist only during one bounded read; command inputs and response metadata dictionaries are request-scoped.
- The immutable-write outcome has no Boolean success shortcut. Resolution means the conditional create succeeded or an existing object's exact length/SHA-256 matched. Rejection preserves provider errors, reports a bounded-read failure, or reports `Immutable object key collision`.
- Checksums are evidence, not authorization. Tenant access still resolves a stored object key through workspace-bound PostgreSQL records, and scan, rights, preview, Campaign, Brand, and publishing-account revisions are revalidated independently.

## Recovery harness contracts (Release 1.2)

- `acknowledgedQuiesced` is true only for the exact string `true`; absence or any other value stops before Docker access. It is an operator assertion plus a source-drift check, not a database lock.
- `container`, `sourceDatabase`, and `databaseUser` are bounded identifier strings. Reserved maintenance databases are rejected as sources. They are process configuration and never become application globals or persisted rows.
- `suffix` is a random 12-character hex value. The derived restore-database and dump-path tuple scopes cleanup to one run; neither value is accepted from a request or reused as production naming.
- Table evidence is three local `Map<tableName,countString>` collections populated in sorted order. Migration evidence is one ordered version/checksum string. Archive listing and constraint count are local scalars. No tuple, list, dictionary, map, or output contains table rows or credentials.
- A successful result is a JSON event containing source/generated database names, table/migration counts, elapsed fixture milliseconds, six closed check labels, and the non-RTO qualification. The generated database/dump is removed afterward, so the event is evidence rather than a reusable backup.
- `docs/RECOVERY.md` defines operational recovery entities—recovery point, data plane, owner, protected artifact, validation result, ambiguous provider action, and drill record—but Release 1.2 adds no database table or API for them.

## Web readiness contracts (Release 1.3)

- `READINESS_CHECK_NAMES` is the readonly tuple `database_configuration`, `application_origin`, `identity_configuration`, `storage_configuration`, `secret_configuration`, `database_connection`, and `database_migrations`.
- `ReadinessCheckName` is derived from that tuple; `ReadinessCheckState` is the closed `ready|not_ready` union. `WebReadiness.status` uses the same aggregate union and contains one complete record of all seven states.
- `DatabaseReadinessEvidence` is `{migrationCount, latestMigration?}` and contains no URL, host, user, password, SQL error, checksum, table count, row, or latency.
- `configurationChecks` creates one request-local fixed record. `checkWebReadiness` mutates only that local record while evaluating the injected/default probe; no global readiness map, last-error cache, database detail dictionary, retry list, or background timer exists.
- `EXPECTED_DATABASE_MIGRATION` and `EXPECTED_DATABASE_MIGRATION_COUNT` are release constants, not database authority; the immutable migration files/ledger remain authoritative and future schema releases must advance the pair.

## Mastodon reviewed-image publication (Release 1.14)

- `MastodonMediaConfiguration` is the validated provider-derived object `{attachmentsPerMessage, attachmentBytes, attachmentPixels, attachmentDescriptionCharacters, supportedImageMimeTypes}`. The MIME list is an ordered subset of `image/jpeg`, `image/png`, and `image/webp`; numeric values are positive safe integers capped by Market Me policy.
- `ChannelCapabilityManifest.limits` carries the four generic attachment limits and `features` carries `attachments`, `imageJpeg`, `imagePng`, and `imageWebp`. Preview capability snapshots remain immutable; live runtime values must equal the approved snapshot.
- `PublishContentInput.providerAttachmentIds` is an ordered, unique list of already-uploaded provider media IDs. `PublishContentInput.attachments` is rejected by the Mastodon status method so raw bytes cannot bypass the durable upload ledger.
- `StoredMastodonPublicationMedia` is `{publicationActionId, ordinal, contentAssetId, contentHash, providerMediaId, createdAt}`. `ordinal` is 0 through 3 and means exact preview order. `contentHash` uses `sha256:<64 lowercase hex>` and `providerMediaId` is bounded non-control text.
- `mastodon_publication_media` belongs to `publication_action` with cascade delete, references `content_asset` with restricted delete, uses `(publication_action_id, ordinal)` as its primary key, and forbids the same provider ID twice within one action.
- `CONTENT_ASSET_RIGHTS_CHANNELS` now contains `discord_webhook` and `mastodon_account`. `rights_permitted_channels` authorizes a provider class; normalized Channel Connection, Campaign, and Brand Profile scope tables still provide the exact relational grants required for outbound use.
- `inspectImageDimensions(bytes,maxPixels)` decodes immutable image metadata under Sharp's input-pixel bound and returns `{width,height,pixels}`. It is a byte-derived runtime guard, not a replacement for the preview's stored metadata or content hash.
- Health/readiness timestamps are observational UTC strings and version is imported build metadata. They grant no tenant access, execution authority, provider health, object availability, or recovery certification.

## Service heartbeat contracts (Release 1.4)

- `SERVICE_NAMES` is the readonly tuple `ingestion_worker|workflow_worker`; `ServiceName` is derived from it. It is an operations vocabulary, not a tenant role, permission, workflow identity, or provider name.
- `service_heartbeat` has the composite identity `(service, instance_id)`. `instance_id` is a new random UUID per process start; `version` is trimmed and 1-through-32 characters; `started_at` and `last_seen_at` use PostgreSQL time; `stopped_at` is null only for an active lease. Checks require last-seen at or after start and stop at or after start.
- `ServiceHeartbeat` is `{service, instanceId, version}`. Callers cannot supply timestamps. `ServiceFreshness` is the fixed `{ingestionWorker:boolean, workflowWorker:boolean}` dictionary and contains no instance IDs, versions, times, errors, hosts, queue names, counts, or tenant data.
- `ServiceHeartbeatLeaseOptions` extends the heartbeat with `intervalSeconds` and an optional error callback. Its `timer`, `inFlight`, and `active` members are private process state; no global list/map/set/tuple of live workers exists.
- `READINESS_CHECK_NAMES` now has nine entries: the prior seven plus `ingestion_worker_freshness` and `workflow_worker_freshness`. `DatabaseReadinessEvidence` adds two aggregate Booleans but remains request-local and non-secret.
- Fresh means at least one active row has `last_seen_at >= now() - maxAge`; it does not mean work completed, queues are draining, dependencies are healthy, or the observed version equals the web version. Deployment compatibility remains an operator release concern.

## Mailchimp email contracts (Release 1.5)

- `CHANNEL_PROVIDERS` adds `mailchimp_email`; the derived `ChannelProvider` union is the only accepted provider vocabulary at API, repository, preview, and worker boundaries.
- `MAILCHIMP_EMAIL_CAPABILITIES` is an immutable versioned manifest: content maximum 100,000 characters, subject maximum 150 characters, zero attachments, and provider-managed consent/unsubscribe. It grants no audience-edit, contact-import, metrics, scheduling, or monitoring capability.
- Mailchimp connection input is the strict dictionary `{provider:'mailchimp_email', name, credentials:{apiKey,audienceId,fromName,replyTo}}`. Recipient arrays, mixed Discord fields, provider base URLs, and data-center overrides are rejected. Only `apiKey` is encrypted; safe config persists audience/sender and verified provider identity.
- `StoredDraftChannelPreview` adds optional `renderedSubject`, `subjectCount`, and `subjectLimit`. Database constraints require all three for Mailchimp and require `subjectCount` to equal the exact subject length. Non-email providers retain null subject fields.
- Email preview content is the exact rendered body plus CTA and canonical first-party tracked HTTPS URL. Social hashtags and assets are omitted. A ready preview is immutable approval evidence, not a mutable template or provider draft.
- `CampaignExecutionTarget.approvalRequired` and `draftPreviewSubject` let the worker fail closed before credential access. Email execution requires `approvalRequired=true`, the exact preview ID, a ready state, and a non-empty exact subject.
- `recordPublicationProviderIdentity(actionId, externalId, externalUrl?)` writes only while `dispatching` and only when the stored value is null or identical. `finishPublicationAction` preserves an already recorded provider ID/URL across failure, allowing safe resume without accepting identity replacement.
- `MailchimpEmailConnector` derives the data center only from the validated API-key suffix, caps JSON response bodies at 64 KiB, returns a bounded audience identity, and classifies failures as `authentication`, `validation`, `rate_limit`, `transient`, or `ambiguous`.
- Provider request content contains one audience ID, sender settings, escaped HTML, plain text, tracking settings, and Mailchimp's unsubscribe merge tag. No application tuple, list, map, row, request snapshot, log, or audit event contains recipient addresses.

## Mailchimp aggregate report contracts (Release 1.6)

- `MAILCHIMP_EMAIL_CAPABILITIES.supportedActions.read_metrics` is true; `monitor_events` remains false. Read capability authorizes aggregate Campaign reports only, not recipient/member detail endpoints.
- `MailchimpCampaignReport` is the closed dictionary `{campaignId,audienceId,emailsSent,opensTotal,uniqueOpens,clicksTotal,uniqueClicks,unsubscribed,hardBounces,softBounces,abuseReports,sendTime}`. Counts are safe non-negative integers; unique counts cannot exceed their totals; `sendTime` is normalized ISO UTC.
- `MailchimpCampaignReportInput` mirrors the connector contract at the database boundary without importing the connector package into persistence. `StoredMailchimpCampaignReportSnapshot` adds `id`, `workspaceId`, `publicationActionId`, `snapshotHash`, and `observedAt`; inherited `campaignId` and `audienceId` are immutable columns on the snapshot rather than projections from mutable connection configuration.
- `snapshotHash` is lowercase hexadecimal SHA-256 over one canonical property order. The unique tuple `(publication_action_id,snapshot_hash)` makes an unchanged observation idempotent; a changed aggregate creates a distinct immutable row.
- `getMailchimpCampaignReportTarget` returns the exact action plus server-only connection for a tenant-bound writer path. `recordMailchimpCampaignReportSnapshot` locks and revalidates workspace, Mailchimp provider, provider Campaign ID, and configured audience ID before mutation.
- `publicationReconciled` is true only when the exact report changes a non-succeeded action to succeeded. The response-metadata flag is minimized Boolean evidence; raw reports, subjects, recipients, email addresses, request bodies, or credentials are not stored.
- `listMailchimpCampaignReportSnapshots` returns at most 100 newest observations for one workspace Campaign instance. The UI chooses the first per action; the API may expose the bounded history for audit and comparison.

## Provider aggregate Campaign metrics (Release 1.7)

- `PROVIDER_AGGREGATE_METRIC_TYPES` is the immutable tuple `email_sent`, `email_unique_open`, `email_unique_click`, `email_unsubscribe`, `email_bounce`, and `email_complaint`; `ProviderAggregateMetricType` is derived from it.
- `CAMPAIGN_METRIC_TYPES` is the ordered concatenation of `MEASUREMENT_EVENT_TYPES` and provider aggregate types; `CampaignMetricType` is the success-criterion count vocabulary. `MeasurementEventType` remains the narrower ingest-key and normalized-event vocabulary.
- `CampaignCountCriterion.eventType` accepts `CampaignMetricType`. `CampaignValueCriterion.eventType` accepts only `MeasurementEventType`, so provider aggregates cannot acquire a client-authored currency/value meaning.
- `campaign_provider_metric_total` is keyed by `(publication_action_id,metric_type)` and stores `workspace_id`, `campaign_instance_id`, `report_snapshot_id`, non-negative `metric_total`, `observed_at`, and `updated_at`. It is a mutable latest projection with an immutable source reference, not an event log.
- Each report maps to `{email_sent:emailsSent,email_unique_open:uniqueOpens,email_unique_click:uniqueClicks,email_unsubscribe:unsubscribed,email_bounce:hardBounces+softBounces,email_complaint:abuseReports}`. Every total must remain a JavaScript safe integer before SQL.
- `MeasurementSummary.providerTotals` is `Record<string,number>` and identifies provider-derived current totals. `totals` remains `Record<string,{count,value}>` for deterministic evaluation; provider entries always have `value=0`.
- `CampaignSuccessSignal.triggerKey` and `triggerSource` identify either a normalized event or Mailchimp report snapshot. Optional `triggerEventKey` preserves compatibility with previously recorded event signals.

## Automatic Mailchimp report collection (Release 1.8)

- `MailchimpReportCollectionTarget` is `{workspaceId,publicationActionId,providerCampaignId,audienceId,encryptedCredentials,actorUserId,attemptCount}`. It is an internal, short-lived worker projection; browser/API responses never receive ciphertext or actor identity.
- `StoredMailchimpReportCollectionState` is the safe operator projection `{publicationActionId,nextAttemptAt,attemptCount,claimedAt?,lastAttemptAt?,lastSuccessAt?,lastErrorCode?}`. All times are PostgreSQL-assigned ISO timestamps. `lastErrorCode` contains only the database-enforced closed vocabulary.
- `mailchimp_report_collection_state.publication_action_id` is the primary key. `workspace_id` preserves tenant binding; `audience_id` is immutable publication identity; `next_attempt_at` drives due ordering; `claimed_at` is the recoverable lease; and `attempt_count` is monotonic retry evidence, not a delivery count.
- `MailchimpReportCollectorOptions` is `{batchSize,refreshSeconds,maxAgeSeconds}`. `MailchimpReportCollectionResult` is `{claimed,succeeded,failed}` and is safe aggregate process telemetry. Neither type contains report totals, recipients, credentials, URLs, or provider response bodies.
- `MAILCHIMP_REPORT_COLLECTION_*` values are process configuration, not domain rows or mutable globals. The enabled Boolean is parsed from the exact strings `true|false`; all numeric values are finite bounded integers before worker construction.
- The automation actor is the exact `channel_connection.created_by` user stored with the active connection. It supplies attribution to the existing report transaction only; it does not impersonate a current session, change membership, or expand authorization.
- A schedule success updates `last_success_at`, clears `last_error_code`, and advances `next_attempt_at`. A failure retains prior success, stores one closed code, clears the claim, and advances by bounded policy. Snapshot deduplication and workflow-command idempotency remain the business replay boundaries.

## Signed Mailchimp report wakeups (Release 1.9)

- `MailchimpCredentialBundle` is `{apiKey,webhookSigningSecret?}` serialized with `version:1` inside the existing AES-256-GCM connector envelope. A non-JSON legacy plaintext decodes as `{apiKey}`; unsupported JSON fails closed.
- `MailchimpWebhookWakeup` is exactly `{audienceId,providerCampaignId,deliveryHash,timestamp}`. It contains no type/status after validation and no email, member ID, IP address, merge field, subject, reason, fired-at text, or raw body.
- `deliveryHash` is lowercase SHA-256 over the already verified 32-byte HMAC signature. It is replay evidence, not a body/content fingerprint, recipient identity, measurement, provider event ID, or authentication secret.
- `last_webhook_delivery_hash`, `last_webhook_timestamp`, and `last_webhook_received_at` are an all-null or all-present tuple. `webhook_wakeup_count` is a PostgreSQL bigint exposed as a decimal string to avoid JavaScript precision loss.
- `StoredMailchimpReportCollectionState` adds optional `lastWebhookReceivedAt` and required decimal-string `webhookWakeupCount`; this is safe operator history and does not prove a report was fetched successfully.
- A wakeup update requires exact connection, provider Campaign, and immutable audience identity plus a strictly newer signed timestamp. Duplicate/same-second delivery is non-mutating; claims, attempts, results, snapshots, totals, and workflow commands keep their existing identities.
- `webhookSigningConfigured` is a non-secret Boolean in Channel Connection configuration. The actual secret is accepted only as a trimmed 16-256 character writer input, encrypted immediately, and never returned.

## Managed Mailchimp webhook lifecycle (Release 1.10)

- `MailchimpAudienceWebhook` is `{webhookId,audienceId,callbackUrl,events,sources}`. `events` and `sources` are bounded Boolean dictionaries with safe lowercase/underscore keys; the type contains no signing secret, delivery, recipient, or provider response body.
- `MailchimpCreatedAudienceWebhook` extends that identity with `signingSecret` only for the create call's request-local return. It must be 16-256 characters and is immediately encoded into `MailchimpCredentialBundle`; it is never serialized into an API response, audit, configuration JSON, health result, or log.
- The exact managed event dictionary is `{subscribe:false,unsubscribe:false,profile:false,cleaned:false,upemail:false,campaign:true,sms_subscribe:false,sms_unsubscribe:false,upsms:false,sms_campaign:false}`. The source dictionary is `{user:false,admin:true,api:true}`. Any required-key mismatch is drift.
- `MailchimpWebhookHealth` is the closed union `managed_active|managed_missing|managed_drifted|managed_secret_missing|manual_unverified|unmanaged_provider_webhook|disabled`. `MailchimpWebhookHealthResult` adds only `matchingCallbackCount:number` and `providerWebhookPresent:boolean`.
- Managed Channel Connection configuration stores safe `webhookManagement="managed"`, provider webhook ID, exact callback URL, audience ID, ISO configured time, and signing-configured Boolean. Manual compatibility stores only `webhookManagement="manual"` and the Boolean; disable removes lifecycle identity fields.
- `webhooksEligibleForReplacement` deduplicates by provider webhook ID and selects the union of exact callback matches and the one stored managed ID. No name, approximate URL, audience-wide selection, first-result assumption, or event similarity grants deletion authority.
- Audit event `mailchimp.webhook-managed` retains provider webhook ID, audience, and callback but no credential. `mailchimp.webhook-disabled` retains only `signingConfigured:false`. The legacy `mailchimp.webhook-signing-configured` event denotes manual, provider-unverified custody.
- No schema object or migration is added. The lifecycle metadata deliberately uses the existing bounded `channel_connection.configuration` JSON because it is connection-operational state; immutable publication audience, webhook wake evidence, report snapshots, and metric provenance keep their normalized identities.

## Managed webhook health-monitor data (Release 1.11)

- `mailchimp_webhook_health_state.connection_id` is the primary key and cascading Channel Connection reference; `workspace_id` is separately joined/validated on every claim/read. `audience_id`, `expected_callback_url`, and `provider_webhook_id` are the exact managed identity snapshot.
- `next_check_at` orders due work; nullable `claimed_at` is the five-minute recoverable lease; `attempt_count` is monotonic provider-check attempt evidence. `last_checked_at` advances only after a complete inventory/secret-presence health decision.
- `last_health_code` is nullable or `managed_active|managed_missing|managed_drifted|managed_secret_missing`. It describes the last completed identity/settings check, not callback delivery, Campaign health, report freshness, or provider availability.
- `consecutive_failure_count` is a nonnegative bigint exposed as a decimal string. Active health resets it to zero; unhealthy health or a closed provider/credential error increments it. It is operational prioritization, not an alert or retry count.
- `last_error_code` is nullable or `authorization|validation|rate_limit|transient|permanent|ambiguous|credential_unavailable|unknown`. An error does not overwrite the last completed health code/time; a later completed health check clears it.
- `MailchimpWebhookHealthCheckTarget` is `{workspaceId,connectionId,audienceId,expectedCallbackUrl,providerWebhookId,encryptedCredentials,attemptCount}` and is worker-internal. `StoredMailchimpWebhookHealthState` omits identity/credentials not needed by UI and exposes safe timestamps, closed codes, and decimal counts.
- `MailchimpWebhookHealthMonitorOptions` is `{batchSize,checkIntervalSeconds}`. Result is `{claimed,active,unhealthy,failed}` and contains no connection ID, URL, provider ID, credential, inventory, or provider response.
- The four `MAILCHIMP_WEBHOOK_HEALTH_MONITOR_*` values are process configuration, never database/domain globals: exact Boolean enable plus bounded loop milliseconds, batch size, and successful/unhealthy interval seconds.

## Slack channel and publication contracts (Release 1.12)

`CHANNEL_PROVIDERS` is now the immutable tuple `['discord_webhook','mailchimp_email','slack_webhook']`. Its derived `ChannelProvider` union is shared by connector manifests, database writes, Draft preview rendering, Campaign target hydration, and workflow routing; adding a string in only one layer is invalid.

`SLACK_WEBHOOK_CAPABILITIES` is a timestamped `ChannelCapabilityManifest` with these important dictionaries:

- `supportedActions = {publish_content:true,read_metrics:false,monitor_events:false}`;
- `limits = {contentCharacters:4000,attachmentsPerMessage:0,messagesPerSecondPerChannel:1}`;
- `features` declares text only and explicitly sets edit/delete/scheduling/events/attachments/provider-message-identity false.

`SlackWebhookConnector.targetIdentity()` derives the non-secret dictionary `{teamId,serviceId,host}` from the already validated URL. `teamId` and `serviceId` are 6-32 uppercase alphanumeric provider identifiers; `host` is exactly `hooks.slack.com` or `hooks.slack-gov.com`. The third identity path component is secret credential material and is never part of this dictionary.

The Slack payload dictionary is `{text,mrkdwn:false,link_names:false,unfurl_links:false,unfurl_media:false}`. `text` is the exact stored preview and contains 1-4,000 JavaScript characters after trim. No blocks, attachments, channel override, username, icon, thread, or client-selected metadata are accepted.

`PublishContentResult.externalId` is optional because provider capability differs. Discord and Mailchimp return stable IDs; Slack incoming webhooks do not. A Slack success is `{metadata:{acknowledgement:'ok',providerMessageIdAvailable:false,targetIdentity}}`. Absence of an ID is intentional domain truth, not missing data to synthesize.

Slack Campaign execution requires `draftChannelPreviewId`, `draftPreviewEligible=true`, stored preview content/version identity, and `approvalRequired=true`. Its request snapshot records `providerPreflight.mode='local_target_identity'` plus the safe identity. A successful `publication_action` keeps `provider_external_id` and `provider_url` null and remains replay-safe through the action's stable idempotency key.

## Release 1.13 Mastodon account values and records

`CHANNEL_PROVIDERS` is the readonly tuple `['discord_webhook','mailchimp_email','slack_webhook','mastodon_account']`; the derived union remains the single accepted provider vocabulary across schema, repositories, previews, UI, and worker routing. `PublishContentInput.idempotencyKey?: string` is optional at the shared interface but mandatory for `MastodonAccountConnector.publishContent`.

`mastodonCapabilities(contentCharacters,charactersReservedPerUrl)` returns a new immutable manifest dictionary with provider `mastodon_account`, official-API execution, publish-only actions, dynamic `limits={contentCharacters,charactersReservedPerUrl,attachmentsPerMessage:0}`, and feature flags for text, stable provider identity, provider idempotency, and public visibility. The live limits must be safe integers in 1–100,000 and 1–1,000 respectively.

Safe connection configuration is `{host,instanceOrigin,accountId,username,acct,profileUrl?,maxCharacters,charactersReservedPerUrl}`. Host, origin, account ID, and both limits form the execution identity/counting boundary; username, handle, and profile URL are display evidence. `mastodonStatusCharacterCount` counts Unicode code points and replaces each detected HTTP(S) URL's literal length with the live reserved value. The encrypted credential contains only the user token; `MASTODON_ALLOWED_HOSTS` is process-local readonly state.

The exact publication payload dictionary is `{status,visibility:'public',sensitive:false}`. The response requires bounded `id` plus same-instance HTTPS `url`; both become `provider_external_id` and `provider_url`. Metadata is `{host,visibility:'public',providerIdempotencyApplied:true}`. Request snapshots record `providerPreflight.mode='provider_read'` and the safe observed identity, never the token or Authorization header.

## Mastodon aggregate status reports (Release 1.15)

- `MastodonStatusReport` is the closed connector dictionary `{statusId,accountId,statusUrl,repliesCount,reblogsCount,favouritesCount,statusCreatedAt}`. Counts are safe non-negative integers; both timestamps/URLs are normalized before persistence. No status content or interacting Account data is representable by the type.
- `MastodonStatusReportInput` mirrors that connector contract at the database boundary. `StoredMastodonStatusReportSnapshot` adds `{id,workspaceId,publicationActionId,snapshotHash,observedAt}`.
- `mastodon_status_report_snapshot` stores the exact provider status/account/URL identity, three bigint totals bounded to JavaScript's safe-integer maximum, status creation time, observation time, and actor. `(publication_action_id,snapshot_hash)` deduplicates identical provider state without overwriting older states.
- Snapshot canonicalization hashes `{statusId,accountId,repliesCount,reblogsCount,favouritesCount,statusCreatedAt}`. `statusUrl` is immutable binding evidence but not a measurement input.
- `PROVIDER_AGGREGATE_METRIC_TYPES` adds `mastodon_reply`, `mastodon_reblog`, and `mastodon_favourite`. They are count-only `CampaignMetricType` values and remain excluded from `MEASUREMENT_EVENT_TYPES`, external ingest-key scope, currencies, and synthetic event history.
- `campaign_provider_metric_total` has mutually exclusive `report_snapshot_id` (Mailchimp) and `mastodon_report_snapshot_id` sources. Every email metric requires only the former; every Mastodon metric requires only the latter. Its primary key remains `(publication_action_id,metric_type)`.
- `getMastodonStatusReportTarget` accepts only a succeeded exact-workspace Mastodon action with stable provider ID/URL. It prefers immutable preflight account/origin identity. `recordMastodonStatusReportSnapshot` locks and revalidates the exact action/status/account/URL, records a minimized audit, updates all three projections, and evaluates Campaign success in one transaction.
- `listMastodonStatusReportSnapshots` returns at most 100 newest observations for one exact workspace Campaign instance. The UI uses the newest per publication and labels totals as provider aggregates.

## Durable Mastodon report collection (Release 1.16)

- `mastodon_status_report_collection_state.publication_action_id` is both the primary key and a cascading reference to one exact publication. `workspace_id` is repeated for tenant-bound joins; `provider_status_id`, `provider_account_id`, `provider_status_url`, and `instance_origin` are immutable target identity.
- `next_attempt_at` drives due order. `claimed_at` is a nullable recoverable lease, `attempt_count` is monotonic attempt evidence, `last_attempt_at` records claim time, and `last_success_at` records only a committed aggregate snapshot. None is a publication attempt or engagement count.
- `last_error_code` is null or the closed union `authorization|validation|rate_limit|transient|permanent|ambiguous|credential_unavailable|unknown`. A failure retains the previous success time and stores no provider response/body.
- `MastodonStatusReportCollectionTarget` is `{workspaceId,publicationActionId,providerStatusId,providerAccountId,providerStatusUrl,instanceOrigin,encryptedCredentials,actorUserId,attemptCount}`. It is worker-internal and must never be returned to the browser, audit metadata, or logs.
- `StoredMastodonStatusReportCollectionState` is the safe operator dictionary `{publicationActionId,nextAttemptAt,attemptCount,claimedAt?,lastAttemptAt?,lastSuccessAt?,lastErrorCode?}`. Identity and ciphertext are intentionally omitted.
- `MastodonReportCollectorOptions` is `{batchSize,refreshSeconds,maxAgeSeconds}`. `MastodonReportCollectionResult` is `{claimed,succeeded,failed}`; it is process telemetry without action IDs, counts, URLs, accounts, or errors.
- Successful action completion creates the schedule due after five minutes. A successful collection clears the lease/error and advances by `refreshSeconds`; failure clears the lease, preserves prior success, records one closed code, and advances by bounded retry policy.
- Process settings are parsed once at startup into local readonly values. They are not domain records, global mutable dictionaries, or per-workspace preferences. Manual refresh does not consume or rewrite schedule identity.

## Mastodon collection operational status (Release 1.17)

- `MastodonReportCollectionOperationalStatus` is represented by the closed literal union `pending|scheduled|retrying|overdue|collecting|abandoned` on `StoredMastodonStatusReportCollectionState.operationalStatus`.
- `abandoned` means `claimed_at` is older than five database minutes. `collecting` means a non-stale claim exists. These states take precedence over due time and previous error/success evidence.
- `overdue` means no claim exists and `next_attempt_at <= now()`. `retrying` means the row is scheduled in the future with `last_error_code`. `scheduled` means a future row has `last_success_at` and no error. `pending` is the remaining initial future state.
- The value is computed by PostgreSQL on each tenant/Campaign-scoped list read and is not persisted. It therefore has no independent identity, timestamp, migration, write method, mutable global dictionary, or audit event.
- Operational status is not report freshness, provider health, account health, publication status, engagement, retry authority, or an alert. It summarizes the current local schedule/lease evidence only.

## Workspace Mastodon collection summary (Release 1.18)

`MastodonStatusReportCollectionOperationsSummary` is `{total,pending,scheduled,retrying,overdue,collecting,abandoned,oldestOverdueAt?,oldestAbandonedClaimAt?}`. Counts are PostgreSQL integers; timestamps use the same underlying schedule fields. The dictionary deliberately cannot represent publication/provider/account/connection identity, credentials, dynamic errors, report counts, or worker IDs.
