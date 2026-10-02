# Self-service account display name

Status: implemented,verified and published as1.50. Final local and independent exact-source feature/main cloud4065-test gates,isolated desktop/mobile/production,unsigned packaging and final Google readback pass. The design below records the original bounded scope; [ACCOUNT_PROFILE.md](ACCOUNT_PROFILE.md) is the implemented contract and [RELEASES.md](RELEASES.md) the evidence authority. This is a narrow self-service Market Me display-name editor without provider identity,verified email,password,role or account-link changes; broader user-profile requirements remain incomplete.

## Intended experience

Settings should distinguish an application's display name from its sign-in-provider identity. Any authenticated user can review and change their own display name across their Market Me workspaces. Names are not unique identity or proof of ownership;keep verified email/account ID as the authority. Show the current name and saved revision,explicit save result and conflict/recovery guidance. Do not offer administrators another person's name editor or alter provider credentials/profile. Correct the adjacent stale Settings explanation that says existing member roles cannot be changed: the Team page already supports governed non-owner role changes.

## Data and concurrency design

Add a forward-only migration with positive app_user profile revision and an immutable account-owned save receipt. Use bounded NFC/plain display names and strict ordinary JSON containing only accountId (a self-scope hint),requestId,expectedRevision,displayName. The independently authenticated actor must equal accountId before reading or writing;it is never supplied actor authority. This prevents a stale form from one signed-in account renaming a different later session's account.

Lock the actor's user row,compare the current revision and atomically save the new display name,incremented revision,immutable canonical-request receipt and account-scoped audit. Exact retries return the original receipt without reapplying a later name;different payload/key reuse fails. Concurrent different requests at one revision permit one winner. No-op names should have an explicit stable outcome rather than incrementing revisions invisibly. Preserve existing identity/email/session/membership fields and never insert a new account through this endpoint.

Existing production OIDC identity reuse preserves stored display_name. Development bootstrap currently overwrites names on repeat login;change that narrow conflict path to preserve an existing account's chosen name,with a regression proving both development and OIDC reauthentication do not undo a saved name. Do not weaken login or identity-link checks. Inspect existing direct app_user writes/tests before finalizing any database guard to avoid breaking unrelated lifecycle operations.

## API and form contract

Use authenticated same-origin bounded JSON POST and private,no-store GET for the current account profile and exact request receipt. Reject extra/duplicate scope and foreign account hints before work. Apply fixed public errors;never return other accounts' existence,receipts,email or provider fields. Match request/response account IDs and canonical intent on the client;identity/abort/busy fences prevent duplicate,late or superseded results from changing current form state.

An uncertain response must not trigger automatic resend. Keep the original request identity while the form is open and offer explicit read-only outcome lookup;after reload require review of current saved state before another intent. Any persistence beyond form memory needs an explicit privacy/lifetime justification. Successful save refreshes server-rendered navigation/account labels without implying provider profile modification. Leave all preexisting workspace authority checks intact.

## Acceptance and delivery

Cover self-scope across all workspace roles,foreign/stale account hints,strict name/request bounds,exact replay and payload conflicts,revision races,both commit orderings,no-op semantics,unchanged identity/session/membership,receipt retention/canonical integrity,audit provenance and rollback. Test provider/development reauthentication preservation,private route headers/status/errors,form duplicate/abort/uncertain recovery,Settings copy,keyboard/mobile and actual isolated save/reload/conflict workflow. Update schema readiness and frozen migration expectations without modifying historical migrations. Document every column,DTO,constant,normalizer,variable,receipt/lifetime and rollout boundary in repository and the existing Google development sections.

This does not add email/credential changes,avatars,account deletion,owner transfer,organization administration or provider profile editing. No production account should be renamed during development acceptance;use isolated synthetic accounts only.
