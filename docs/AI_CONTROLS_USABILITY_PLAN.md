# Outcome-first AI controls

Status: implemented in the 1.37 candidate; final gates remain separate from focused tests/browser checks. [Programmer reference](AI_CONTROLS_USABILITY.md) inventories the delivered controls, state and boundaries. Specification sections 01/19 require ordinary users to choose practical outcomes and see cost/privacy boundaries without starting with provider internals.

## Observed gap and intended result

The existing AI & Cost page puts execution/incident machinery before the six-mode policy form and renders many provider, adapter, rate-card, invocation and cache panels in one long primary page. Policy/alert controls also appear editable to readers even though their APIs reject non-writers. Make the primary experience outcome-first and role-honest, while preserving every existing advanced control, current API guard, private recovery record and execution boundary.

Keep essential saved mode, privacy/budget boundaries, execution-stop status and actionable attention visible. Group technical configuration and usage behind clearly named native keyboard-accessible disclosures or a clearly linked existing-control section; do not hide urgent unresolved incidents without a visible summary. Make unsaved selections distinguishable from the saved policy. Non-writers should inspect saved policy without enabled save/mode/acknowledgement controls; writer/reviewer/admin capabilities remain independently assigned by existing server rules.

This is presentation and truthful navigation, not a new provider connection, spend authorization, execution grant, automatic fallback or policy schema. Opening a disclosure must never verify a credential, discover remote models, reserve spend or invoke a model. All existing consequential buttons remain explicit and independently guarded. Static mode indicators describe preferences, not measured quality, proven privacy or available model capability. Preserve truthful no-provider/default/unconfigured states; do not invent monthly projections or per-package estimates.

## Engineering and acceptance

Inspect the existing component tree and installed Next guidance first. Keep current monetary/ledger semantics unchanged in this UI increment and explicitly distinguish recorded spend, holds, quotes and configured caps. Separately audit legacy two-decimal policy/usage formatting versus exponent-bearing provider quote records before extending currency support; never silently reinterpret historical values or claim arbitrary-currency accounting correctness from this reorganization.

Cover all six roles, saved versus unsaved labeling, writer-only policy/alert affordances, independently authorized spend-exception review, preserved advanced components/links, keyboard disclosure, desktop/mobile layouts, unauthenticated access and production rendering. Verify browser navigation/disclosure/read-only inspection creates no domain/provider writes; do not enable execution or send data as QA. Existing database queries are not made cheaper merely by hiding panels, and no new result cache should be introduced.

Document section ordering, role flags, UI state/labels, every changed prop/helper/collection, information versus authority limits and all release evidence in repository and the existing Google development parent/five children. Continue broader semantic understanding, grounded output evaluation and end-to-end workflow work afterward.
