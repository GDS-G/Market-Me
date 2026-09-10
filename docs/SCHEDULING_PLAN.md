# Bounded scheduling implementation plan

Status: **initial bounded scope implemented and locally verified in 1.20**. This design implements a bounded subset of the Preferred Window and Dependency requirements from conceptual sections 10–11. It does not replace the wider scheduler, pacing, calendar, autonomy, or approval requirements. Current supported behavior remains in [Implementation status](IMPLEMENTATION_STATUS.md).

Activation now explicitly enables the implemented bounded policy after live integration and replay acceptance. The pure validator remains closed by default for legacy callers. Source/cloud publication evidence is recorded separately in [Releases](RELEASES.md). Data, recovery and clock-budget interfaces are recorded in [Scheduling contracts](SCHEDULING_CONTRACTS.md); the requirements below remain the regression checklist.

## First useful scope

Add absolute preferred windows and delays after predecessor completion. A window is the half-open UTC interval `[start, end)`: a new provider write request may start at the lower bound but not at or after the upper bound. Provider latency makes remote completion time uncontrollable; the UI must call this a request-start window and explain uncertain in-flight outcomes.

Preserve current exact-time semantics: an exact time is a not-before target, not a new expiry. Dependency delay defaults to zero. Dates remain absolute instants; the campaign timezone controls presentation, while the existing editor explicitly accepts UTC and preserves milliseconds.

Initial preferred-window execution is limited to verified single-write text-only API routes: Discord, Slack and Mastodon. Mailchimp, media uploads, companion, browser, manual fallback and other routes remain saved-only for windows until every stage has deadline enforcement. Any campaign containing a window or positive dependency delay also rejects any companion/user-assisted step, including an immediate predecessor. This is a temporary capability restriction, not a permanent removal from the specification. Validate route restrictions both before activation and again against the current exact account/content before dispatch.

Do not add a slot-reservation table merely to run a bounded window. Quiet hours, collisions, density limits, natural pacing, recurrence, evergreen rotation, follow-up triggers and conditions remain separate tracked work. An earliest-legal-start implementation must not claim those capabilities.

## Implemented data and contracts

- `CampaignStep.dependencyDelaySeconds?: number`: default zero; a safe integer from zero through 31,536,000 seconds (an initial one-year bound); a positive value requires at least one dependency. Reject strings, fractions, negatives, non-finite values and values beyond the bound. Mirror it as `campaign_step.dependency_delay_seconds integer NOT NULL DEFAULT 0` with a database check and preserve it in every version read/write, API and form projection.
- The governing schedule is always the instance's immutable campaign version. Never take a dispatch deadline from browser parameters, arbitrary `input.context`, the campaign's newer draft, or a replacement account.
- `effectiveNotBefore` is the maximum of the schedule's lower bound and each required predecessor's first successful/partially-successful completion timestamp plus the delay. Predecessors must belong to the same instance and pinned version. Existing optional skipped/partially-successful predecessors continue to satisfy dependencies; display and document that behavior.
- Preserve the first durable successful completion timestamp on idempotent state writes. Terminal runs must not regress to waiting/running because of a stale activity. The current scheduler's batch/wave start time is not an acceptable delay anchor.
- Pure `evaluateStepSchedule` result: `waiting_dependencies`, `waiting_until` with `notBefore`/optional `deadline`, `ready` with the same bounds, or `expired` with `deadline`. Repository resolution supplies one authoritative `clock_timestamp()` and exact stored predecessor evidence. No browser clock is authority.
- `schedule_blocked` step-run status distinguishes missed windows from manual provider reconciliation. Persist a closed reason plus the governing schedule evidence; show it in the run and calendar. It must not be clearable using the ordinary manual-completion endpoint.

## Durable workflow and controls

Request approval with the exact window and delay included in the immutable review snapshot. A whole-campaign decision remains tied to the exact campaign version. Timers and approval/dependency/pause waits must all wake at a finite window deadline; recheck persisted authority after every wait and activity retry.

An expired action that has not dispatched becomes schedule-blocked and pauses its instance. Initial recovery is cancellation followed by a newly published, reviewed plan for remaining work; do not silently extend the range or permit Resume/manual completion to bypass it. Successful or ambiguous in-flight publications must settle or reconcile without being overwritten by an expiry observer. Cancellation remains available.

Dispatch dependency-ready successors independently of unrelated slow siblings. Preserve deterministic workflow state, completed work and cancellation of active branches. Introduce a compatible Temporal patch or a separately versioned workflow/dispatcher path, and prove replay of recorded 1.19 histories before enabling the new path. Do not repeat an unverified in-place workflow migration.

## Provider request boundary

The server derives a single deadline from the pinned step. A shared connector request-budget helper checks it immediately before each actual request and caps the normal abort timeout by the remaining time. An invalid or already-closed deadline must fail before I/O with a distinct no-dispatch result, outside catches that classify an in-flight request as ambiguous. Clock values sampled before a lock wait or slow preflight are insufficient.

Once a write starts, timeout, abort, malformed acknowledgement or unknown transport outcome may mean the provider accepted it. Preserve ambiguity and require reconciliation; expiry is not evidence of non-delivery. Record a valid provider success even if its response arrives after the deadline. Do not convert a database failure while recording accepted success into a safely retryable provider failure.

Publication retry requires an exact-target, reauthorized, atomic `failed -> dispatching` claim. Only the winning claimant may send; a losing observer cannot overwrite an active dispatch as ambiguous. Retain provider idempotency keys. Replaying an exact persisted success after the deadline is a read-only recovery operation and must return it without preflight, new tracked links, media work or another provider request. This exception must not authorize a new send.

The 1.20 shared begin/retry admission boundary locks exact instance/version/run, approvals, current account and content/destination resources and reads fresh database time after waits. Regression tests cover concurrent retries, revocation and current-preview changes. This does not establish an atomic boundary across every possible rights-scope writer and external HTTP. Window media remains unsupported; holding database locks across external HTTP calls is not an acceptable substitute.

Future multi-stage support must carry the cutoff through Mailchimp create/content/send and Mastodon upload/readiness/status, preserving intermediate provider IDs on interruption. A future companion extension must persist the campaign cutoff, filter expired queue/reclaims, cap signed job expiry and recheck immediately before native execution. A browser opening cannot guarantee when a user completes an external action.

## Acceptance before enabling support

These gates passed for the implemented 1.20 scope; retain them for regression and each route extension. Three real Temporal history replays cover patch-marked execution and two unmarked 1.19 histories. Exact suite/build/browser evidence is recorded in Releases; test adapters do not prove live provider acceptance.

1. Validate finite ordered ranges, exact end exclusion, millisecond preservation and every invalid delay at API, domain and database boundaries; unchanged exact-time/default-zero cases must still pass.
2. Prove no early dispatch after timers, queue delay, pause/resume, retries, worker restart and late predecessor completion. A repeated completion write must not move a delay anchor, and unrelated siblings must not delay a newly eligible successor.
3. Prove approval after expiry, pause across expiry, late dependency completion and already-expired activation never authorize a write. Resume/manual completion must reject schedule-blocked work at both API and workflow boundaries.
4. Exercise concurrent failed-action retries, ownership loss, slow preflight crossing the cutoff, timeout after request start, accepted success persistence failure and late read-only success replay. Assert provider request counts, not just returned labels.
5. Reject unsupported route/fallback/media combinations at activation and dispatch after account/content drift. Do not mark a healthy connection unhealthy merely because the campaign window expired.
6. Verify authoring round-trips and exact review/calendar/run evidence in the browser. Run live PostgreSQL tests, Temporal time-skipping/replay tests, connector loopbacks and the normal build/type/lint/security gates.

This scope requires no paid provider or production credential to implement and test with deterministic local/CI fixtures. Real provider and deployment acceptance remains a separate gate.
