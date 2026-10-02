# Exact AI-policy save recovery

Status: release 1.41 is locally accepted after verified 1.40; not included in 1.40 runtime or test totals. The three pre-fix handler failures are reproduced and fixed; the complete local gate passes 3,247 tests/174 files plus 44/44 quality cases. Browser/mobile/production recovery, historical-value preservation and unsigned packaging pass. [Implementation and variable reference](AI_POLICY_SAVE_RECOVERY.md) records the completed contract; exact-source cloud publication and Google synchronization remain pending in [Releases](RELEASES.md).

## Observed problem

The pre-1.41 AI-policy form left pending true when fetch rejected, treated malformed successful responses as success, and had no synchronous duplicate-submit fence. Its PUT route had no exact request key or expected policy revision. The repository upserted last-writer-wins, then read policy after committing, so a concurrent writer could replace the value returned as the first writer's result. Simply clearing pending or retrying could overwrite a newer privacy/budget policy and append another audit.

## Bounded implementation

Add revision metadata to workspace_ai_policy without reinterpreting any stored policy value. A database trigger must advance the revision for every policy update, including existing trusted repository/SQL writers. Default unsaved policy uses expected revision zero; existing saved rows begin at one. Add an immutable, actor-private exact-save receipt that binds the canonical request, expected revision and committed policy snapshot in the same transaction as the existing audit.

The guarded save must lock current writer authority, serialize identical request keys, return an existing receipt only for the same actor and exact request, compare current revision under row locking, and safely handle absent-row creation races. Replaying a request must never reapply an old policy, grant new authority or append another audit. Recovery lookup must recheck current writer access and reveal only the original actor's matching workspace receipt. Legacy internal policy writers remain supported but must advance the database revision; unguarded browser PUT must not remain as a bypass.

Retain an exact account/workspace-scoped browser attempt before sending. If storage is unavailable or changed, do not send. Keep the attempt after success, failure, response loss or malformed responses; provide read-only lookup and explicit same-request retry, not an automatic retry. Lock policy editing while recovery is outstanding, bound and validate request/response envelopes, use a synchronous in-flight fence, and clear pending in finally. Clearing the local attempt requires acknowledgment and a fresh current-policy/authority read; it does not cancel an earlier server operation.

Policy edits are separate from budget-alert acknowledgments, spend-exception decisions, provider execution and paid actions. This increment does not change their financial semantics or automatically exercise them. Existing hundredths-based policy display versus exponent-bearing rate quotes is a separate audit; no currency amounts are reinterpreted. Real provider credentials, model calls and spending are not required for acceptance.

## Acceptance

Reproduce current response-loss and overwrite behavior. Test strict closed contracts, absent/current/stale revisions, concurrent first saves and later saves, identical/different request-key races, original-actor privacy, current role revocation, trusted-writer revision advancement, immutable receipt enforcement and unchanged historical monetary values. Verify lookup/mutations enforce origin, auth, byte bounds and safe errors without exposing canonical requests in logs.

Browser-contract tests must cover storage failure/corruption/scope mismatch, exact retries, bounded streamed JSON, malformed or foreign receipts, lock/finally behavior and no automatic requests on mount. Use an isolated synthetic database for desktop/mobile/reload recovery and stale-policy acceptance, without provider execution or paid operations. Run full regression/static/build/native/cloud gates and migration checksum/replay checks. Document every new field, constant, collection, function, lifetime, lock and rollback/deployment dependency in the repository and existing six Google development tabs.
