# Self-service sign-in session controls

Status: implemented, verified and published as 1.51. Final local/native, unsigned packaging, isolated browser/production, both independent exact-source cloud gates and final Google readback pass; [Releases](RELEASES.md) records runtime identity and separate evidence. [Implementation reference](ACCOUNT_SESSIONS.md) records the actual design and every important variable. The original plan below explains the bounded scope: the signed-in user's own Market Me sessions, not organization-wide administration or identity-provider management. All 1.51 work remains excluded from the earlier accepted 1.50 runtime and totals.

## Intended experience

Add a Settings section showing active Market Me sign-in sessions with current-session identification, exact creation/last-seen/expiry times and an explicit sign-out control for one other selected session. Retain the existing Sign out action for the current session. Do not invent device, browser, IP or location identity: app_session currently stores no such trustworthy metadata. Explain that last seen reflects server requests, not human attention, and that ending a Market Me session does not sign out of the OIDC provider, revoke connected providers or disable companion/service credentials.

The API must work only for the independently authenticated account. Account/session hints never supply authority. Do not add an administrator's ability to enumerate or revoke other people's sessions. Display names remain labels, not identity proof. Avoid device fingerprinting or collecting new personal metadata merely to decorate a session list.

## Persistence and authority design

Inspect the existing app_session token-hash primary key, auth/session lifecycle and logout before finalizing migration. Add a random public session UUID separate from the secret bearer token and its hash; never expose either token or token hash in URLs, HTML, JSON, logs, audits or screenshots. Existing sessions retain their current token validity, expiry and identity through migration.

List only current unexpired sessions for the authenticated account, with exact total and a bounded deterministic page/explicit coverage. Mark the current session from server-validated cookie context, never a client-provided current flag. Do not cache current-session authority or infer it from possession of a public session UUID.

For explicit revocation, serialize account actions, then revalidate and lock the current unexpired session before locking/removing the exact other session. Deterministically order locks so two sessions trying to revoke each other cannot both operate on stale authority or deadlock. Revoke only the selected same-account target; do not turn a stale list into a bulk operation. Existing in-flight already-authorized requests are not promised cancelled, but later authenticated requests must fail after revocation commits.

Use a bounded exact request identifier plus immutable account-owned receipt and minimized account-scoped audit, committed atomically with deletion. An exact replay returns the historical original outcome only to a currently signed-in same-account caller; changed intent/key reuse conflicts. A missing target without a matching receipt must not fabricate a successful original revocation. Decide receipt retention explicitly around account deletion and backups without leaking session secrets or preserving needless device metadata. Test rollback if receipt/audit persistence fails.

## Transport and browser behavior

Use same-origin bounded JSON POST and actor-private no-store GET for current list/exact receipt. Validate stale account hints, duplicate/unknown fields, public UUIDs and response binding. Fixed public errors must not reveal foreign-session existence or private persistence detail. Derive current session context server-side from the existing HttpOnly cookie; do not make browser JavaScript read or store it.

Show an explicit target summary and local confirmation before revocation. Use duplicate/busy/abort/identity fences and memory-only exact intent recovery; no automatic resend after an uncertain response. A read-only check looks up the original receipt without another deletion. Label receipts as historical, refresh the current list after success, and explain that an expired/revoked current session requires signing in again. Keep the account display-name editor independent.

## Acceptance and exclusions

Test migration preservation, token/hash minimization, current/foreign/expired/revoked callers, selected target isolation, exact retries/conflicts, request ordering and both mutual-revocation races, logout/deletion concurrency, audit rollback, stale browser-account hints, list bounds/counts, no-op/absent-target semantics and real synthetic browser sessions. Do not revoke any real user's session during development acceptance. Update repository references, readiness/migration expectations and the existing Google development sections with every DTO, constant, SQL column, collection, timer, global lifetime and operational limitation.

This increment does not add provider logout, token rotation, credentials/password editing, device attestations, organization-admin session management, service/companion revocation, anomaly detection, MFA or global emergency stop. Those remain separate requirements, not implied by a session table and buttons.
