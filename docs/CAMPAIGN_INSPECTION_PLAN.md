# Read-only campaign inspection and role-aware editor access

Status: verified 1.55 runtime `42c2eb81daf0912b54f08d00484bc0a0c3701503` is public on main. Local and independent exact-source feature/main CI 37007972549/37008632859 pass 4,885 tests/235 files and 44 quality cases. Development/production desktop/mobile, read-only fingerprint preservation, clean audits, unsigned native packaging and final Google preservation are verified separately. [Releases](RELEASES.md) records exact evidence and distinguishes this accepted increment from independent authoring-safety work. Whole-product completion is not claimed.

## Observed gap and intended result

Actual QA154 viewer navigation exposes the unprotected advanced editor and its save/publish affordances. The HTTP endpoints check writer roles, and the new activation boundary separately locks current membership, so visible controls are not authority. However, readers should not be invited to edit a plan they cannot save, and members should be able to inspect published versus draft versions without navigating JSON editors. The specification's Campaign Workflow Engine requires reviewable versioned workflows and clear validation/activation distinctions.

Add a member-readable Campaign detail surface that separates the observed published plan from any unpublished draft. Present objective, autonomy, timezone, copy controls, version lineage, planned steps/dependencies/timing/execution preferences and explicit approval settings in plain text. Describe stored plans as observations, not capability/rights/approval validation or promises that unsupported schedules execute. Omit arbitrary input/output/context payloads and credentials. Keep exact published activation review separate; retain protected finalization provenance and current run inspection.

## Scope and boundaries

Use current authenticated workspace membership and validated route/query hints. Reject foreign Campaign/version lineage. A new detail page performs reads only and offers no mutation handlers. List entries lead to inspection; current writers may explicitly open the existing editor or activation review. Read-only members visiting the old edit route receive the read-only view or a scoped redirect before loading editor pickers. Direct new-Campaign navigation by a nonwriter shows an explanation without loading candidate package/profile/connection data.

Do not change Campaign creation, draft-save, publish, activation, provider execution, approval, scheduling or workflow semantics in this UI increment. Existing advanced draft-save/publish transaction authorization and optimistic-concurrency limitations require a separate audit rather than an implied guarantee from hidden controls. Preserve protected finalization routing for writers and readers. No new migration, environment/dependency, global cache, worker marker, session storage or background operation is planned.

## Acceptance

Unit/server-rendered tests must cover every workspace role, anonymous/no-workspace/foreign/malformed identities, published-only/draft-only/both/no-plan states, version lineage mismatch, escaped labels, unsupported schedule wording, bounded detail coverage and absence of mutation controls for readers. Page tests must prove editor candidates are not fetched before writer checks. Browser checks cover the list/detail/editor journey, direct reader edit/new routes, keyboard/mobile layout and protected-plan preservation. Use an isolated synthetic fixture and compare database fingerprints for read-only behavior, allowing session bookkeeping only. Complete regression/build/native/audit/cloud and Google documentation gates remain distinct from implementation.
