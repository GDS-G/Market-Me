# Budget-action current-state recovery

Release 1.42 implements the [bounded plan](AI_BUDGET_ACTION_RECOVERY_PLAN.md). [Releases](RELEASES.md) separates local, browser, native and cloud evidence. This feature retains alert acknowledgements, spend-exception requests and exception decisions after uncertain responses. It is not a new immutable receipt system, automatic retry, quote, spending reservation, provider call or whole-product completion.

## Semantics and transaction boundaries

Six pre-fix handler regressions reproduced lost-response pending, malformed-success refresh and same-tick duplicate submission for acknowledgement and approval. Coverage now includes all three actions. A browser action is validated and synchronously retained before transport. All budget-action controls then remain frozen, even after success. An explicit check reads current persisted state; reload does not automatically check or resubmit. Policy-save recovery is separate and keeps its own immutable-receipt/retry contract.

Existing repository semantics remain authoritative: one exception per denied reservation; the first request's explanation/author survives later calls; acknowledgement preserves the first actor/time; repeating the same terminal decision returns the original decision, while a different terminal decision fails. An overdue pending exception can become expired instead of approved. These are entity-level deduplication rules, not proof that a particular HTTP request committed. Result wording compares original actor, requested decision and explanation/note before claiming a match. A different author's or different-payload result is explicitly an existing result. Missing, open or pending state is not proof of failure; an earlier transaction could still finish.

`AiRepository.getBudgetActionState(workspaceId, kind, targetId, actorUserId, asOf)` independently checks the closed action kind and current membership in a transaction. `asOf` defaults to a fresh Date and is used for existing expiry normalization. Acknowledgement targets an alert ID; request lookup targets the denied-reservation ID; decision lookup targets the exception ID. Every lookup scopes by workspace. No result returns undefined. Expiry projection is read-only; it does not expire stored rows, consume exceptions or create reservations.

The existing private `requireWriter`/`requireApprover` helpers gain optional `lock=false`. Only these three mutation paths and their exact lookup request `lock=true`, issuing membership `FOR SHARE` before the target-row lock/read. Current authority is therefore held through commit. Concurrent demotion waits; a committed earlier demotion denies access. Other AI paths retain their previous behavior. No schema, index, environment variable, dependency or mutable global cache is added. Schema remains 121 ending at frozen 0121.

## Contracts, fields and collections

`apps/web/src/components/ai-budget-action-contract.ts` is browser-safe and imports only Zod, never database runtime. Its closed schemas reject unknown fields. UUIDs normalize to lowercase; explanations trim and require 1–1000 UTF-16 units. Timestamp strings require valid offset-aware ISO datetimes.

| Symbol | Fields / purpose |
| --- | --- |
| `BUDGET_ACTION_LIMITS` | Frozen requestBytes=8192, recoveryBytes=16384, responseBytes=16384, timeoutMs=20000. Byte limits measure UTF-8, not character count. |
| `BudgetAction` / `budgetActionSchema` | Discriminated union on kind. All variants have workspaceId/targetId. acknowledge_alert has no payload; request_exception adds justification; decide_exception adds decision approved/rejected and optional note. Actor fields are never caller authority. |
| `BudgetActionTarget` / `budgetActionTargetSchema` | Exact workspaceId/kind/targetId tuple for read-only lookup. |
| `BudgetActionScope` | Current authenticated userId and workspaceId supplied to the form. |
| `BudgetActionAttempt` / private attemptSchema | Version 1, userId and one action. Storage format version is independent of application 1.42.0. |
| `BudgetActionState` / `budgetActionStateSchema` | Alert projection: kind=alert, workspaceId, id, status=open/acknowledged, optional acknowledgedBy/acknowledgedAt. Exception projection: kind=exception, workspaceId, id, deniedReservationId, status=pending/approved/rejected/expired, justification, requestedBy, expiresAt and optional resolvedBy/decisionNote/resolvedAt/consumedAt. |
| private envelopeSchema | Exactly data containing the state union; extra metadata is rejected. |

`budgetActionStorageKey(scope)` returns `market-me:ai-budget-action:v1:<userId>:<workspaceId>`. `makeBudgetActionAttempt` parses/copies, checks workspace and recovery size, and freezes both envelope and action. `restoreBudgetActionAttempt` distinguishes absent null from invalid/oversized JSON, checks version/account and reuses scope validation. `persistBudgetActionAttempt` requires the same normalized bytes if a copy exists, writes synchronously, verifies exact readback and refuses replacement. `StorageAccess` is only getItem/setItem; deletion is confined to the guarded UI reset.

`budgetActionEndpoint` maps each union member to the existing method/path/body; path-owned IDs and actor fields cannot be overridden in the body. `readBudgetActionJson` requires JSON content type, checks advertised and streamed bytes, collects a bounded Uint8Array chunk list, cancels oversized streams, concatenates once, decodes fatal UTF-8, parses JSON and releases the reader lock in finally. Its length/offset/chunks/buffer are request-local, not shared caches.

`verifyBudgetActionState` binds workspace, entity kind and exact target. Acknowledged alerts and approved/rejected exceptions need original actor/time; open alerts cannot carry acknowledgement metadata; pending exceptions cannot carry resolution/consumption data. Consumption is valid only for approved/expired state. It freezes the validated projection. `runBudgetActionAttempt` revalidates/persists before either one mutation or explicit GET, bounds the request/response, uses no-store and a 20-second abort signal, accepts only 201 for exception request and 200 otherwise, and validates the closed envelope. Abort does not cancel a server commit. Error explanations are constant; arbitrary server text is not rendered.

`budgetActionResultText` uses the action union and original account to distinguish matched state, another actor/payload, pending, expiry and already-consumed state. It explicitly labels the result as current entity state, never an immutable action receipt or new execution authorization. No new status dictionary is stored: Zod enums and explicit branches define the allowed sets; existing domain enums remain unchanged.

## HTTP and compatibility

`apps/web/src/server/ai-budget-actions-api.ts` centralizes the following routes:

| Method/path | Input and current ability | Success |
| --- | --- | --- |
| PATCH /api/v1/ai-budget-alerts/:id/acknowledge | Body workspaceId; path alert ID; write | 200/data alert projection |
| POST /api/v1/ai-spend-exceptions | Body workspaceId, deniedReservationId, justification; write | 201/data exception projection, including an existing first request |
| PATCH /api/v1/ai-spend-exceptions/:id/decision | Body workspaceId, decision, optional note; path exception ID; approve | 200/data exception projection; expiry is not approval |
| GET /api/v1/ai-budget-actions/state | Exactly one each workspaceId, kind, targetId; write for acknowledgement/request, approve for decision | 200/data projection or 404 with in-flight uncertainty |

The first three existing endpoints now return a minimized closed projection with `kind`, not their former entire domain DTO. Deploy web UI and routes together; consumers relying on removed fields must adapt. Current-state lookup is not original-actor private: authorized workspace writers/approvers already share these entities. Original actor IDs are included to avoid misattribution. No new listing or actor override is exposed.

`mutateBudgetAction` enforces configured same Origin, no query fields, JSON content type, advertised size and bounded valid UTF-8 JSON, then closed action input and current authenticated role. The repository repeats authority independently. Private requestSchema/acknowledgeSchema/decisionSchema prohibit path-ID and actor injection. `projectState` deliberately minimizes fields and validates persisted output; a corrupt projection fails as unavailable, never success or user-input error.

All responses set Cache-Control no-store. `BudgetTransportError` holds a safe code/status/message. Authentication is 401, authorization/origin 403, missing 404, advertised oversized body 413, content type 415, invalid fields/streamed body/domain eligibility 422, unknown failure 503 with uncertainty. Unknown errors log one constant minimized message, not explanations, SQL or secrets. The browser never interprets an unexpected 2xx as confirmation.

## React state, refs and lifetimes

`useBudgetActionRecovery` receives scope, recoveryReady and canAcknowledge/canRequest/canDecide. The existing hydration gate prevents pre-hydration storage reads. The form remount key now includes both exception permissions as well as user, workspace, edit permission, loaded policy revision and hydration. A retained action never crosses that scope. Client permission checks supplement but cannot replace server authorization.

- `restored`: one mount's original raw bytes, parsed attempt or safe storage error; raw undefined means no successful read and cannot authorize deleting a later unknown copy.
- `attempt`: retained validated action rendered to the operator. `pending`, `error`, `storageError`, `result` and `confirmed` drive progress, safe feedback, current-state display and explicit clearing acknowledgement. confirmed is a UI consent flag, not proof of success.
- `inFlight`: synchronous ref fence before the first await, blocking same-tick duplicate handlers. `exact`: original action ref, also preventing a second handler from substituting changed input before rerender. `retained`: verified exact raw storage bytes. `mounted`: prevents async completion from updating a disposed form. The mount effect performs no network work.
- `allowed(kind)` selects the current permission. `frozen` covers pre-hydration, pending, retained attempt or unsafe storage; per-action controls also enforce their own ability. `recoveryAllowed` checks the retained kind's current permission.
- `run(action?)`: with an action, validate/retain/send once; without one, explicitly read current state. Set the fence before asynchronous work, reset result/consent, preserve uncertainty and always release pending in finally. No automatic retry, lookup, refresh or clearing occurs.
- `reset`: require explicit acknowledgement, no active request, hydration, applicable permission and identical current storage bytes; remove/read back, then full reload for fresh state. Changed/unreadable storage fails closed. No server data or in-flight action is canceled.

The form's pendingAlertId and pendingSpendExceptionAction are derived from this hook, not independent mutation lifecycles. Request handlers verify that the chosen estimate remains in the loaded eligible list. Retained explanations remain visible and are not automatically emptied. `BudgetActionRecovery` renders the saved action, explicit check, guarded clear, current-state caveat and reload link. Alert/exception sections use scoped budgetPanel spacing, wrapping, 44-pixel minimum button targets and visible keyboard focus. Policy-save controls retain their independent state/receipt semantics.

## Recovery, rollout and acceptance limits

Keep the local copy after uncertain outcomes. Check current saved state before choosing whether to clear. There is intentionally no retry action for these entity-level operations. Clearing removes only this tab's copy, requires explicit acknowledgement and reloads; it does not cancel or erase anything on the server. A closed tab, browser cleanup, account switch or failed storage may make the recovery key unavailable. Explanation text is not a credential, but sessionStorage is not encrypted and same-origin scripts can access it. Current-role revocation blocks lookup; expiry, consumption, workspace erasure or database restore can change the observable entity. Never treat the local key or result as authorization.

New tests: 27 contract, 15 handler, 26 route and eight live database cases. Handler evidence includes all three action kinds under lost/malformed responses and duplicate submissions, restore without automatic I/O, exact retention, storage failure, role denial and clearing races. Database cases prove read-only row equality, scope/current-role checks, existing actor/payload semantics, expiry without mutation, concurrency/deduplication and three role-demotion races. Race barriers observe actual PostgreSQL lock waits before release, not timing-only parallel calls. Fixtures require market_me_ci or market_me_qa_142_* and clean only their own exact synthetic rows.

Ignored QA helpers target only loopback market_me_qa_142_budget_v1: seed once, then read-only status snapshots. Browser QA intentionally submits one synthetic request, one acknowledgement and one rejection in three separate workspaces; it does not approve spending, invoke a provider or repeat any write. Reload and explicit lookup preserve workspace separation. Database comparison permits only those entity changes and three audits, preserves all six original reservations and 138 of 141 measured tables, and finds no usage/invocations/provider execution. In-memory handler tests cover response loss; browser acceptance does not simulate a dropped network response. Production snapshots must equal the complete post-browser snapshot.

No migration or new configuration is required. Keep frozen migration0121 and all policy-save receipts intact. Deploy matching UI/API together; older clients may not understand the minimized projection and do not have this recovery UX. Do not infer cloud/native/browser/provider acceptance from unit results: [Releases](RELEASES.md) records each gate independently. Broader product functionality, hosted production and real provider acceptance remain open.
