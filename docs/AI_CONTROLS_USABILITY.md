# AI controls: preferences, saved boundaries and optional technical detail

Implemented in the 1.37 candidate from [the scoped plan](AI_CONTROLS_USABILITY_PLAN.md). This reorganizes `/ai-settings` and corrects presentation/state lifetime; it does not grant execution, connect a provider, reserve money or change monetary/storage semantics. [Releases](RELEASES.md) distinguishes candidate, local, cloud and publication evidence.

## Page topology and authority

The authenticated Server Component still resolves the current user and active workspace before any AI read. Missing identity/workspace redirects to login. Existing repositories and explicit workspace/actor arguments remain the authority boundary. Failed reads propagate; they are not converted into empty/healthy results. This release adds no route, query, schema, cache, provider call or automatic action. Collapsing a panel does **not** defer its server queries or remove its serialized Client Component props.

The initial page shows a practical introduction and execution/attention summary, the safety disclosure, six mode choices, privacy/budget settings, recorded usage/holds, budget alerts and spend-exception review. Three later disclosures contain the existing technical panels:

| Native disclosure ID | Preserved contents | Default open rule |
| --- | --- | --- |
| `ai-safety` | `AiExecutionControl`, `AiOperationalIncidents`, including existing alert-delivery/recovery controls | Effective workspace `executionAllowed`, any loaded active incident, or any open provider circuit |
| `ai-configuration` | Assistant assignments, routing preferences, provider connections, adapter candidates, registrations, rate bindings, invocation bindings | Closed |
| `ai-requests` | Text intents/attempts/output/reconciliation/resolution/proposals and cost quote ledger | Closed |
| `ai-diagnostics` | Adapter registry, rate-card evidence, cache metadata and capability routing | Closed |

`AiPolicyForm` remains outside those disclosures; its mode section has `id="ai-policy"`. Its pre-existing Advanced usage details disclosure remains separate. Native `details/summary` supplies keyboard activation and browser-managed temporary state; there is no click handler, API call, local storage or saved expansion preference. CSS preserves the disclosure marker, visible focus, wrapping and narrow layouts. The summary's loaded incident/circuit counts are observations, not a complete health or launch-readiness certification. Deployment stop takes precedence over workspace-window text; even an open window requires independent request eligibility/spend checks.

| Current workspace roles | Policy modes/save and budget-alert acknowledgement | Spend-exception request | Spend-exception review | Execution/incident-policy management |
| --- | --- | --- | --- | --- |
| Owner, admin | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | No | No |
| Approver | No | No | Yes | No |
| Analyst, viewer | No | No | No | No |

These existing server-derived capabilities remain independent. `canEdit` supplies new `canEditPolicy` plus existing request/configuration flags; `canApprove` still supplies exception/incident review; `canManageExecution` supplies owner/admin controls. Hidden/disabled buttons are usability, never API authorization. Non-writers see disabled mode cards, a read-only definition list and a role handoff instead of the policy form. An open alert stays visibly open without an acknowledgement button; it is not mislabeled acknowledged. Each mode button uses `aria-pressed` for its selected state and `disabled` for pending/non-writer state.

## New variables, props, helpers and lifetimes

`savedPolicy` is the request-local repository result, possibly undefined. `policy` is that object or `defaultWorkspaceAiPolicy(workspaceId)`; default creation does not persist a policy. Required `hasSavedPolicy` is `savedPolicy !== undefined`, not a guess based on matching defaults. Required `canEditPolicy` gates mode/edit/acknowledgement affordances and early returns in those two existing handlers. Other independent capabilities and every existing advanced component's inputs are preserved.

`ai-policy-presentation.ts` is a pure, browser-safe module with a type-only database import. It contains:

- `aiPolicyValues(policy)`: creates a new nine-field form object. `mode`, `maximumPrivacyClass`, `failoverMode`, `capBehavior` and `currency` copy policy values; `dailyBudget`, `campaignBudget` and `monthlyBudget` preserve legacy integer-hundredths-to-two-decimal strings, with undefined mapped to empty; `alerts` joins thresholds with comma/space. The local `budget` formatter is not persisted or exported.
- `AiPolicyFormValues`: return type of that mapping, describing editable browser state, not a new domain/storage model.
- `AI_POLICY_VALUE_KEYS`: frozen typed nine-key tuple used for complete dirty comparison. Tests assert it covers the mapping exactly. It holds only field names, not per-user values or authority.
- `aiPolicyChoiceLabel(values, policy, hasSavedPolicy)`: creates a fresh `saved` mapping and compares every listed field by exact value. Any difference yields “Selected preference — not saved”; otherwise a persisted policy yields “Saved preference”, and application defaults yield “Default preference — not yet saved”. Formatting-only edits can conservatively count as unsaved. This is not validation, semantic equality or confirmation of a successful API write.

Existing Client Component `values` starts with `useState(() => aiPolicyValues(policy))`. The Server Component supplies `key={JSON.stringify([workspace.workspaceId, workspace.role, savedPolicy])}` so workspace, role, savedness or policy changes remount the editor and discard stale unsaved values/pending selections. An identical refresh preserves state. The key contains only already-present policy/scope data, never credentials. The browser never invents a saved revision. A successful existing save still requests `router.refresh`; this UI work does not add optimistic persistence or conflict/idempotency semantics to the legacy policy API.

Existing `pending`, `pendingAlertId`, `pendingSpendExceptionAction`, `exceptionJustification`, `selectedDeniedReservationId` and `error` remain component-local state. Error feedback renders outside the writer-only form so an approver still sees a failed spend decision; hiding the editor must not hide reviewer feedback. `eligibleDeniedReservations` still filters denied require-approval estimates with no existing request; `capResponses` remains a request-local projection. `selectedIndicators` looks up the current `values.mode` in the existing static `modeIndicators` dictionary. Static descriptors express preferences, not measured quality, verified model availability, guaranteed privacy or price quotes. Selecting a card alone sends nothing.

Existing request-local arrays/maps (`providerAdapters`, `providerModelInventories`, `assistantByAction`, `routeByAction`, assistant selections/work/cost previews, `capabilities`, editable drafts/proposals, incident/circuit arrays and quote presentation) keep their original authority, data shape and scope. No global, cross-request dictionary, environment variable or dependency is added.

## Money and observation boundaries

`monthlyBudgetMinor` now comes from **`budgetStatus.monthly.capMinor`**, never the unsaved editor string. `budgetPercent` uses loaded settled spend plus active holds divided by that loaded cap, capped visually at 100. It displays the budget snapshot's currency. Editing a cap cannot change the saved-cap progress display; absence of a loaded cap remains explicit. Settled usage, held estimates, cost quotes, reservations, caps and approved exceptions remain distinct. No forecast or per-package estimate is invented.

Known pre-existing limitation: policy/usage formatting and input conversion assume hundredths, while exact rate-card/quote records carry `minorUnitExponent`. Policy validation currently accepts three uppercase letters. This increment deliberately does not reinterpret stored history, widen currency support or certify arbitrary-currency accounting. Audit and repair that contract separately before making broad monetary-correctness claims.

## Acceptance and operational guidance

The three focused suites contain 39 cases: twelve pure presentation cases, eleven rendered policy/role cases and sixteen page/scope/disclosure cases. They cover every role, independent reviewer rights/error feedback, no fake alert acknowledgement, defaults versus saved/dirty fields, loaded-cap progress, preserved technical panels, all safety-opening reasons, deployment/workspace gating, current actor/scope reads, initialization-key changes and failed-read propagation. Policy-render tests install a fetch spy and require zero calls. A real-hook wrapper injects only the third initially-empty string (error, after justification/selected ID) to prove reviewer feedback remains visible without a policy form; if hook ordering changes, update that explicit test seam. Page tests stub only reads; real generation helpers run on synthetic empty inventory. The initial page-test harness required explicit alias mocks and matching mocked component import identity; those harness errors were corrected, not suppressed. Final review moved error feedback outside the conditional form and the entire release gate was repeated on that corrected source.

Synthetic browser checks use the existing isolated journey QA database, never live provider credentials. Reader inspection, four native disclosure open/close operations, keyboard Enter/Space, desktop/narrow layouts, owner unsaved-mode/cap editing and return to reader were checked without submitting policy, granting execution or approving spend. All 36 AI/audit table row counts/fingerprints and the prior journey domain counts remain unchanged during those interactions. Workspace selection changes only existing active-scope session state. See [Releases](RELEASES.md) for final production, full-suite, package, cloud and document verification; initial candidate evidence is not final acceptance.

Deploy matching web code with normal process replacement and the existing 120-migration ledger. No new service or configuration is required. A browser reload resets temporary disclosure/input state. Rollback reverts presentation/state fixes, not records; never delete budgets, quotes, approvals or attempts to repair a UI. Mobile shell navigation and legacy monetary/async-form limitations are independent follow-up concerns, not claimed solved by this page reorganization.
