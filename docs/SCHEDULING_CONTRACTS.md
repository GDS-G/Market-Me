# Bounded scheduling engineering contracts

Status: implemented and locally verified in 1.20. Activation explicitly enables bounded scheduling; legacy pure-policy callers remain closed by default. See [the scheduling plan](SCHEDULING_PLAN.md) and [release evidence](RELEASES.md) for scope and exact verification/publication status. This is not a production-readiness claim.

## Time, identity and durable state

`CampaignStep.dependencyDelaySeconds` is optional in source-compatible callers and normalizes to zero on persistence. It is a safe integer in `[0, 31536000]`; a positive value requires dependencies. `campaign_step.dependency_delay_seconds` is an integer with database checks. Every saved version, form projection, workflow definition and approval snapshot must retain it. Do not use a newer campaign draft to change a running instance.

`evaluateStepSchedule(step, predecessors, now)` is pure. `now` is a finite epoch-millisecond value, not a browser clock. `StepSchedulePredecessor` identifies one required same-instance, same-version predecessor with its status and first durable successful/partial-success `completedAt`. Duplicate or missing evidence does not satisfy a dependency. Optional skipped/partially-successful steps retain existing dependency-satisfaction semantics.

`StepScheduleState.state` is `waiting_dependencies`, `waiting_until`, `ready` or `expired`. Optional `notBefore` and `deadline` are absolute ISO instants. `expired.reason` distinguishes `deadline_reached` from `no_legal_time` when the computed lower bound is already at or beyond the exclusive end. `StoredStepScheduleState` adds exact workspace, campaign, instance, version, step-run and step-key identities, predecessor evidence and database `evaluatedAt`. Lower bounds/completions from historical sub-millisecond timestamps are rounded up; upper bounds are rounded down. Never round a window outward.

Migration `0109_campaign_schedule_bounds.sql` also adds `schedule_blocked`. A missed request-start window is not proof of non-delivery and is not interchangeable with `manual_resolution`. Terminal step writes retain the first completion timestamp, output and attempt count; a stale activity cannot move a delay anchor or regress a completed run. A blocked run may transition to canceled while preserving its schedule evidence.

## Recovery before new execution

`CampaignScheduledStepExecutionInput` carries immutable stored IDs and context, but no caller deadline. Activity evidence must match all those IDs. `recoverScheduledExecution` is read-only and runs before timing or current active-state checks:

- `succeeded`: return the exact stored action's provider identity/URL and original tracked-link metadata. Do not test credentials, create a link, load media or contact the provider.
- `dispatching` / `ambiguous`: require reconciliation, even after the window expires. Never infer that no request happened from a missing success acknowledgement.
- Known `failed` / no matching action: no outcome to recover; current authority and timing still govern any new dispatch.

The database recovery query joins the publication through the exact workspace, campaign, pinned version, instance, run and step, and derives the idempotency key `campaign:{instanceId}:step:{stepKey}:publish`. It does not require the connection still to be active to read its historical outcome.

Provider acceptance and outcome persistence are separate failure domains. If recording accepted success has an uncertain commit result, the router does not overwrite it with `failed` or send again. Preserve the dispatching/succeeded record for reconciliation. In contrast, a claim owned by this invocation may be closed as failed after a provable pre-I/O cutoff; if that cleanup commit cannot be confirmed, require reconciliation instead of claiming clean expiry.

## Request budget and clock assumptions

`ChannelDispatchOptions` is trusted server-only data. `dispatchDeadlineAt` is the pinned UTC upper bound. `dispatchMonotonicDeadlineAt` is a same-process `performance.now()` cutoff, never persisted, serialized to another host, or supplied by campaign/browser context. The worker records the monotonic instant before reading database schedule evidence and computes:

`monotonic cutoff = read-start + floor(UTC deadline - database evaluatedAt - 1 ms)`

Charging the entire database round trip and one truncated timestamp millisecond makes this conservative. It prevents a slow/backwards-moving worker wall clock from extending the remaining database-approved interval. A clock discrepancy can reject early; it cannot authorize extra time. Keep host clocks synchronized operationally, but do not use a browser or one previously sampled worker timestamp as authority.

`createChannelRequestBudget` takes the minimum of the ordinary provider timeout, remaining UTC interval and remaining monotonic interval. It checks before constructing the timeout and again before the first actual request. `ChannelDispatchDeadlineExceededError` means no request started and must remain distinct from ambiguous transport failure. The same abort signal bounds response headers and body consumption. Once a request starts, do not reapply expiry to discard a valid acknowledgement; timeout or unconfirmed acknowledgement remains ambiguous.

Preferred-window routing is initially limited to single-write text-only Discord, Slack and Mastodon with exactly `official_api`, no media or fallback method. Recheck the stored route at activation and dispatch. Multi-stage Mailchimp/media and companion deadlines are separate work. Any campaign with a window or positive dependency delay rejects any `user_assisted` step, even an immediate companion predecessor, until its enqueue/claim path supports the new whole-definition authority checks.

## Workflow compatibility and controls

`patched("bounded-scheduling-v1")` separates the new scheduler from the frozen 1.19 workflow and pure command-affecting policy modules. Do not remove the legacy branch or change its command/timer sequence while unmarked histories remain in retention. Replay tests must cover recorded legacy histories, not only new workflows run through a renamed helper.

New workflow branches use persisted predecessor completion evidence independently: an unrelated slow sibling must not delay an eligible successor. Approval, pause and dependency waits wake for finite window expiry and refresh evidence. No expiry observer may overwrite an in-flight write or an unresolved manual provider outcome. Approval snapshots include the exact version/run/window/delay/methods.

`schedule_blocked` pauses the instance. Initial recovery is cancellation and a newly published/reviewed plan, never silent extension. Resume and all manual completions are blocked at UI, API, locked command-queue and workflow-signal boundaries once an instance has a blocked run. Ordinary manual completion requires the exact run to be `manual_resolution` and the instance active/paused. The public API re-resolves authorized workspace/instance/run; a UI-disabled button is not authorization.

## Publication admission and workflow maps

`PublishingRepository.admitPublication` is the shared initial/retry transaction. Its lock order is instance, pinned version/steps, sorted step runs, approvals, connection, content approval/draft/version/preview, relevant asset/source, destination and tracked link. Re-derive current rendered content and exact original request identity under those locks. A final fresh database schedule check follows lock and insert-conflict waits. A failed retry returns dispatch permission only to its atomic winner; an observer must not overwrite that winner. `APP_BASE_URL` is required only when trusted raw tracked-link rendering needs it.

`recordConnectionTest(workspaceId, id, result, expected)` rejects revoked rows and, when supplied, compares the encrypted credential and normalized complete configuration snapshot before writing success or failure. The worker supplies its exact preflight target. A false success update stops dispatch before provider POST; late health evidence is not authority to reactivate or silently replace an account.

V2 workflow context entries are `schedule.<stepKey>` (last database schedule), `schedule.blocked.<stepKey>` (closed reason and evidence), `steps.<stepKey>` (durable output), `execution.validation`, `execution.failure`, and existing `measurement.success`. Workflow-local revision counters wake waits; they are not globals or completion-time authority. The first resolved `runId` pins execution identity; duration `waitUntil` is not a predecessor-delay anchor. Requested-approval and manual-output maps accept only the exact currently eligible decisions. Cancellation wakes waits but lets already dispatched activities settle before closing the workflow, retaining accepted/ambiguous outcomes.

## Verified scope and operational gates

See [the acceptance checklist](SCHEDULING_PLAN.md#acceptance-before-enabling-support) and current Releases for integrated no-skip tests, live PostgreSQL races, real Temporal replays, browser checks and build/security evidence. Deploy the new worker before the web activation change. Do not remove the patch/legacy handlers while unmarked histories remain in retention or roll back active V2 executions to binaries that cannot interpret them. Live provider credentials, production operation and wider media/companion scheduling remain separate gates.
