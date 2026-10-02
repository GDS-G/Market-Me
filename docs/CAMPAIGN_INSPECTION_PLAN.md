# Read-only campaign inspection and role-aware editor access

Status: locally verified 1.55 on `codex/campaign-inspection`, separate from accepted 1.54 runtime `156729d3ebf909d450c095cc4ca927ea065a6a25` and final documentation `6267fc288fead4fc092e4ee9d6f7f96f9021285b`. The corrected-source full gate passes 4,885 tests/235 files and 44 quality cases. Development/production desktop/mobile, read-only fingerprint preservation, clean audits, unsigned native packaging and the Google foundation are verified. Publication, independent cloud acceptance and final Google evidence synchronization are pending. Evidence is separate from 1.54 totals and maintained in [Releases](RELEASES.md).

## Observed gap and intended result

Actual QA154 viewer navigation exposes the unprotected advanced editor and its save/publish affordances. The HTTP endpoints check writer roles, and the new activation boundary separately locks current membership, so visible controls are not authority. However, readers should not be invited to edit a plan they cannot save, and members should be able to inspect published versus draft versions without navigating JSON editors. The specification's Campaign Workflow Engine requires reviewable versioned workflows and clear validation/activation distinctions.

Add a member-readable Campaign detail surface that separates the observed published plan from any unpublished draft. Present objective, autonomy, timezone, copy controls, version lineage, planned steps/dependencies/timing/execution preferences and explicit approval settings in plain text. Describe stored plans as observations, not capability/rights/approval validation or promises that unsupported schedules execute. Omit arbitrary input/output/context payloads and credentials. Keep exact published activation review separate; retain protected finalization provenance and current run inspection.

## Scope and boundaries

Use current authenticated workspace membership and validated route/query hints. Reject foreign Campaign/version lineage. A new detail page performs reads only and offers no mutation handlers. List entries lead to inspection; current writers may explicitly open the existing editor or activation review. Read-only members visiting the old edit route receive the read-only view or a scoped redirect before loading editor pickers. Direct new-Campaign navigation by a nonwriter shows an explanation without loading candidate package/profile/connection data.

Do not change Campaign creation, draft-save, publish, activation, provider execution, approval, scheduling or workflow semantics in this UI increment. Existing advanced draft-save/publish transaction authorization and optimistic-concurrency limitations require a separate audit rather than an implied guarantee from hidden controls. Preserve protected finalization routing for writers and readers. No new migration, environment/dependency, global cache, worker marker, session storage or background operation is planned.

## Acceptance

Unit/server-rendered tests must cover every workspace role, anonymous/no-workspace/foreign/malformed identities, published-only/draft-only/both/no-plan states, version lineage mismatch, escaped labels, unsupported schedule wording, bounded detail coverage and absence of mutation controls for readers. Page tests must prove editor candidates are not fetched before writer checks. Browser checks cover the list/detail/editor journey, direct reader edit/new routes, keyboard/mobile layout and protected-plan preservation. Use an isolated synthetic fixture and compare database fingerprints for read-only behavior, allowing session bookkeeping only. Complete regression/build/native/audit/cloud and Google documentation gates remain distinct from implementation.
