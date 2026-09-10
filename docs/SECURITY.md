# Security and Integration Controls

## Current checkpoint: 1.21 immutable evidence boundaries

Historical evidence is not a current approval or publishing grant. Removing the live-evidence foreign key prevents source refresh from cascading away recorded claim links, but new links must satisfy exact generation-snapshot/workspace/version proof. The validator rejects ambiguous IDs, incomplete factual order, invalid metadata and mismatched captured claims. The backfill restores only provable missing identity; unavailable history remains explicitly unavailable.

Ordinary and AI revisions retain every fact and fail closed for missing/invalid proof rather than silently dropping facts through inner joins. Paid AI revision context checks the proof before preparing an invocation, not merely at eventual proposal application. A shared package lock makes generation's approval/version/evidence read consistent with replacement. Old approval stays with the old version; refreshed packages require review.

Snapshot JSON, `factOrder` and claim records are server-created immutable application data; a database owner who directly rewrites them is outside this authority model. The trigger is not a general tamper-proof ledger or complete historical repair. UI trace describes captured references, marks gaps/conflicts, and never labels an ungrounded factual claim as a presentation-only call to action. No new provider permission, credential, network operation or automatic activation is added. See [Evidence retention](EVIDENCE_RETENTION.md) for rollout and limitations.

## 1.20 bounded execution boundaries

Bounded scheduling is implemented with independent time, identity, approval and publication-ownership checks. This is not whole-product acceptance, production certification, permission for automated cold outreach, or proof of atomicity across every existing media/rights mutation. [Scheduling contracts](SCHEDULING_CONTRACTS.md), [Development](DEVELOPMENT.md) and [Implementation status](IMPLEMENTATION_STATUS.md) define the intended deployment and remaining limits.

- **The deadline is not user-supplied execution authority.** Authoring accepts validated finite absolute instants and bounded integer dependency delays; the execution deadline is derived only from the instance's immutable version. The stored schedule projection binds workspace, Campaign, instance, version, run, step and predecessor evidence using database time. New context fields and calendar/form values cannot override that evidence. Historical fractional milliseconds are rounded inward, and exact end equality refuses a new write.
- **Timing does not waive permission.** Activation checks current selected account/provider/capability, method list and expired windows; runtime repeats exact identity, active instance/running step, no blocked sibling, completed dependencies and actual relevant approvals. The structural `allowBoundedScheduling` option is internal and default-closed for legacy callers; it does not authorize a provider or bypass policy. Draft-only/unknown modes and unsupported executable conditions remain closed.
- **Recovery is narrowly read-only.** An exact persisted success can be replayed after expiry or connection revocation without credentials, new links, media work or provider I/O. Dispatching/ambiguous actions remain manual reconciliation even after expiry. No action/known failed action still requires fresh authorization and a new claim. An arbitrary output/context object, caller idempotency key or same-workspace but different Campaign/version/run is never recovery proof.
- **Begin and retry share a locking boundary.** `admitPublication` acquires the exact instance first, then pinned version/steps/runs/approvals, selected connection, exact Draft approval/draft/version/preview, relevant asset/source rows, Destination and tracked link. Ordered row locks and a post-lock eligibility read bind current account/ciphertext/capabilities, input, reviewed content/subject, provider preflight identity and link rendering to the claim transaction. A final schedule read follows all lock and unique-index waits. Only the failed-to-dispatching winner may send; a losing claimant must not overwrite another invocation.
- **Preflight cannot revive revoked or replaced credentials.** `recordConnectionTest` locks the connection, excludes revoked rows and optionally compares the exact expected encrypted credentials and configuration before recording the result. Runtime supplies that expected snapshot; false means stop. A stale successful preflight cannot reactivate a revoked connection or overwrite a reconfigured target. Current capability/preview comparisons are independently repeated at publication admission.
- **SQL locks end before HTTP.** The admitted request is outside the database transaction. Authority changes committed before the locked re-read are observed; changes after admission cannot recall a request already starting/in flight. Window routes exclude attachments and multi-stage delivery, so the release must not be described as full-media atomicity or universal revocation-at-the-instant-of-network-write. Quiesce affected work for higher-assurance revocation procedures.
- **Clock budget is conservative and process-local.** The worker captures `performance.now()` before its fresh DB schedule read and derives a monotonic cutoff charging that round trip plus one millisecond. The connector uses the minimum of ordinary timeout, remaining UTC interval and remaining monotonic interval; it checks immediately before first I/O and keeps one abort budget through headers/body. Neither monotonic cutoffs nor secrets belong in stored Campaign context, signals, URLs or browser input. A clock discrepancy may refuse early, never extend the database-approved window.
- **No-dispatch errors cannot erase delivery uncertainty.** Only typed, exact DB-confirmed expiry with no prior accepted/unresolved action can become `schedule_blocked`. The activity repeats read-only recovery if expiry occurs after preflight/admission because another worker may have claimed the action. Connector `ChannelDispatchDeadlineExceededError` guarantees no request started; network timeout/abort or an unconfirmed acknowledgement after start remains potentially accepted delivery. Preserve valid late provider acknowledgements. If accepted-success persistence or owned no-dispatch cleanup cannot be confirmed, keep reconciliation rather than inventing a safely retryable failure.
- **Blocked controls are enforced below the UI.** A blocked run retains first evidence and pauses its instance. Resume and manual-completion commands fail at authenticated API, locked repository queue and V2 signal boundaries. Persisted status writes cannot reactivate an instance with a pinned blocked run; this also defeats a stale resume activity completing after expiry. Ordinary manual completion requires the exact current manual-resolution run and a nonterminal eligible instance. Recovery is cancellation followed by a newly published/reviewed remaining plan.
- **Cancellation preserves evidence.** Pending conditions/timers wake promptly, but already-dispatched activities settle before final workflow completion. A late success or unresolved outcome survives cancellation and sibling expiry. Force-killing a worker is not evidence of non-delivery and cannot authorize another send.

Preferred windows currently require exactly one official-API text write through Discord, Slack or Mastodon, zero attachments and no fallback methods; Slack/Mastodon still need an exact approved Draft preview and human approval. Mailchimp/media/browser/manual windows remain saved-only. Any Campaign combining a window or positive delay with a `user_assisted` companion step is refused, even if that companion step is immediate. Quiet hours, pacing/collision allocation, recurrence, evergreen, conditional/follow-up and source-ready Campaign automation are not supplied by these controls.

The Temporal marker `bounded-scheduling-v1` retains the frozen 1.19 command/policy branch for unmarked replay. Recorded 1.19 completion and timer-cancellation histories, plus marked V2 history, are replay-tested; arbitrary pre-1.19 history compatibility is not implied. Deploy the compatible worker before new activation admission and retain both branches until their history lifecycle permits removal. Never roll back to an incompatible worker to bypass new checks. Temporal history includes Campaign inputs/schedule/approval/output evidence and must retain the application's payload encryption, access-control and retention protections.

## 1.19 implementation boundaries (historical)

The 1.19 implementation adds the controls below; local verification does not establish production rollout safety. [Implementation status](IMPLEMENTATION_STATUS.md) lists the broader work still required.

- `mm_active_workspace` is an untrusted tenant-selection hint, not a bearer credential. Each request resolves it against the authenticated user's current memberships; stale/foreign hints cannot create access. Server Actions re-read membership when switching. APIs with an explicit workspace ID still authorize that exact ID and required role independently of selected UI state.
- Workspace selection accepts exactly one UUID field, requires the configured `APP_BASE_URL` origin, and retains Next's built-in Server Action Origin/Host check. The cookie is HttpOnly, SameSite=Lax, Secure in production, path `/`, with a seven-day maximum age. Logout removes it. Successful switching invalidates the client/layout cache and redirects only to a closed section-root allowlist; previous detail IDs, filters, external URLs, and protocol-relative URLs are discarded. No-membership accounts see an explicit no-access screen rather than a login loop.
- Authoring future schedule/condition fields cannot grant execution. Activation and workflow startup reject unsupported schedule semantics, nonempty executable conditions, draft-only/unknown autonomy, and reserved step IDs. Confidence/first-occurrence/uncertainty labels currently retain human review until reviewed waiver evidence exists. Fully autonomous/custom settings do not bypass explicit step reviews or stricter connector constraints.
- `campaign_approval` requests an actual whole-campaign decision against the instance's immutable version, using `__campaign__` as a reserved signal and a null step-run reference. Ordinary steps cannot impersonate that key. Queued activities re-read current active/running state, due time, predecessor completion, and exact relevant approvals immediately before execution. Publication creation also verifies the exact workspace/campaign/step/active connection and refuses an idempotency key from another execution target. Slack/Mailchimp/Mastodon human-approval and approved-preview requirements remain enforced.
- Mastodon collection attempt numbers fence both aggregate snapshots and schedule completion after stale-lease recovery. A superseded worker cannot clear the replacement claim or overwrite its result. `MastodonReportCollectionClaimLostError` is a closed control signal; completion failure is not retried as a second failure completion. Collector logs expose counts and closed flags only, including idle alert changes and fixed `collection_unavailable` failures.
- Migration 0108 incidents retain workspace/type/count/time evidence only. Eligible overdue backlog has five minutes of grace; abandoned claims are older than five minutes. The observer shares the collection age/identity/connection/capability constraints and serializes reconciliation using a transaction advisory lock. Resolved history remains available. Monitoring depends on the opt-in collector process and adds no separate pager, webhook, email, or disabled-worker detector; zero counts after observer contention/failure are not proof of health.

The navigation QA helper is intentionally destructive only inside a disposable `market_me_qa_*` database: its no-membership mode removes a synthetic user's test memberships. Keep that fixture environment isolated, never document emitted session/account IDs, and verify exact cleanup. These code-level safeguards do not replace provider authorization, infrastructure hardening, signing, cross-platform acceptance, or the wider controls required by the specification.

### Pre-1.19 worker rollout limitation

Temporal replay compatibility with pre-1.19 histories has not been established. Pause/drain old workers, inventory completed and ambiguous provider actions, and cancel/recreate only the remaining authorized work after reconciling outcomes. Never resend an uncertain publication or run an older worker to bypass the new checks. A provider request already in flight in an old process cannot be retroactively stopped by this release. Keep migration 0108 and retained incident history during rollback; do not down-migrate production data.

At 1.19, retry ownership was an atomic `failed -> dispatching` comparison-and-set, but mutable eligibility reads did not all share the claim transaction/lock hierarchy. The 1.20 shared admission boundary is described above. Missing/partial historical provider identity still fails closed; no version can recall a provider request already in flight, and the broader media/rights hardening limitations remain explicit.

### Dependency security checkpoint

The development Compose PostgreSQL and Temporal ports bind to `127.0.0.1`, not all host interfaces. The example database credentials are local-development fixtures, not production secrets. Recreate containers after changing a prior port mapping; editing Compose alone does not change a running container. Production services need deployment-specific secrets and private network policy.

The 1.19 dependency patch updates Next.js and its ESLint configuration to 16.3.4, Sharp to 0.35.4 (libheif 1.23.2), nanoid to 3.3.18, and fast-uri to 3.1.7. The [Next Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Next AVIF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [Sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), [nanoid release](https://github.com/ai/nanoid/releases/tag/3.3.18), and [fast-uri security release](https://github.com/fastify/fast-uri/releases/tag/v3.1.7) document the upstream fixes. Vitest and its matched development packages use 4.1.11 for the [development-server disclosure fix](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9). Do not expose development/test servers publicly. Audit results are point-in-time evidence, not a claim that the application has no vulnerabilities; rerun both full and production-only audits during release preparation.

## Sessions and identity

The development session uses a 256-bit random bearer token in `mm_session`. The cookie is HttpOnly, SameSite=Lax, path `/`, seven-day expiry, and Secure in production. PostgreSQL stores only a SHA-256 base64url hash. Logout removes both the row and cookie.

Development sign-in is gated by `MARKET_ME_DEV_LOGIN_ENABLED` and `NODE_ENV !== 'production'`; it is not a production authentication mechanism. Production sign-in uses one configured OpenID Connect issuer and Authorization Code with PKCE. State and nonce are random 256-bit values stored only as hashes, state is browser-bound by a scoped HttpOnly SameSite=Lax cookie, and the database consumes it once within ten minutes. Discovery issuer, HTTPS endpoints, RS256 signature/JWKS key, issuer, audience, optional authorized party, expiry, issue/not-before times, nonce, subject, and verified email are checked before account lookup.

An unseen provider subject cannot register freely. It must match an existing normalized-email account, an unexpired exact-email workspace invitation, or the deployment's explicit `OIDC_BOOTSTRAP_EMAILS` first-owner allowlist. Invitation roles exclude owner, creation/revocation requires owner or administrator membership, acceptance is transactional, and identity linkage uses immutable `(issuer, subject)` authority rather than a mutable email claim after first link. Production should obtain MFA, recovery, device/session administration, and risk controls from the chosen identity provider; Market Me still needs its own administrator session-revocation/device view before higher-assurance deployment.

## Authorization

Authentication proves the user; membership proves workspace access. Every protected API resolves the session in PostgreSQL, then validates a membership for the requested workspace. Owner, admin, and editor can mutate Smart Sources, Context Packs, Destinations, Campaigns, and Campaign instances; owner, admin, and approver can resolve evidence, approve packages, and decide Campaign approvals. UI visibility never substitutes for Route Handler and repository authorization.

The current schema provides tenant-scoped foreign keys and queries. PostgreSQL row-level security is a defense-in-depth item before untrusted multi-tenant production traffic.

## OAuth and connector tokens

- Google Drive and Microsoft storage use authorization-code flow with random state and PKCE S256.
- State is stored by hash, expires after ten minutes, and is deleted atomically on consumption.
- Google requests read-only Drive access and offline access.
- OneDrive requests `offline_access`, `User.Read`, and least-privilege `Files.Read`. SharePoint requests `Sites.Read.All` because document-library traversal crosses site storage.
- Microsoft next/delta URLs are accepted only when HTTPS and hosted by `graph.microsoft.com`, preventing a provider response from redirecting bearer tokens to an arbitrary host.
- Access and refresh tokens are encrypted independently with AES-256-GCM. Envelopes contain version, random 96-bit IV, authentication tag, and ciphertext.
- `CONNECTOR_TOKEN_ENCRYPTION_KEY` must decode to exactly 32 bytes. It must be stored separately from PostgreSQL; production should replace the static local key with KMS envelope encryption and key version metadata.

Never log tokens, authorization codes, raw provider errors containing secrets, browser sessions, database URLs, or encryption keys.

## Webhook trust boundary

- `PUBLIC_WEBHOOK_BASE_URL` must be HTTPS. Provider notification endpoints do not use browser sessions and are intentionally separate from workspace APIs.
- Google notifications must match an active, unexpired channel ID and the SHA-256 hash of `X-Goog-Channel-Token`; message numbers form the replay key.
- Microsoft Graph endpoint validation echoes only the bounded opaque `validationToken` as plain text. Change and lifecycle notifications must match an active subscription ID and hashed `clientState`.
- Request headers, tokens, IDs, and bodies have explicit size/count limits. Invalid notification secrets are acknowledged without queueing work, reducing spoofing and retry amplification.
- Notification bodies are hints only. Workers query authoritative provider change/delta feeds before mutating source items.
- Queue claims are transactional and idempotent. Retry delay is exponential and capped; six failed attempts move a hint to `dead_letter` for operations review.

## Source content and review boundary

- Connector downloads are bounded by `MAX_SOURCE_DOWNLOAD_BYTES`; supported Google Workspace documents are exported to text or CSV and ordinary files use media download.
- Microsoft content requests handle the provider pre-authenticated redirect explicitly. The Graph bearer token is not forwarded to the redirected download host, and the redirect must remain HTTPS.
- Context Pack URL sources accept HTTPS references only. Release 0.3 stores the reference but does not server-fetch arbitrary URLs.
- Manual Context Pack text is bounded to 50,000 characters. Release 0.11 processes verified text, raster images, PDF, and modern OOXML; video, audio, legacy/macro-enabled Office, SVG, generic archives, and other unsupported bytes remain explicitly unsupported rather than interpreted unsafely.
- Content Packages validate all Context Pack and source-item references against the workspace. Repository queries enforce review blockers and approver roles even if a client bypasses the UI.
- Extracted text remains bounded in PostgreSQL. Original and derivative bytes live behind the `ObjectStore` boundary; production requires the S3-compatible adapter plus encrypted, versioned, least-privilege storage with lifecycle, retention, backup, restore, and deletion controls.
- No model call is implemented through 0.4. Source bodies and Context Pack content therefore do not leave the application boundary for inference.

## Campaign execution boundary

- Campaign authoring accepts structured JSON only through authenticated, tenant-scoped routes and Zod schemas. Repository validation repeats graph and cross-workspace reference checks before persistence.
- Activation requires a published immutable Campaign version, every referenced Content Package to be approved, and any referenced Destination to be `published`. These are server-side transitions, not client-side warnings.
- Campaign start and signal delivery use a transactional database outbox. Idempotency keys prevent duplicate pause, resume, cancel, approval, and manual-completion commands; stale claims are recoverable and six failures become visible dead letters.
- Temporal workflow IDs contain internal instance UUIDs but no credentials or customer content. Workflow history can contain Campaign inputs, approval snapshots, and manual output, so production Temporal retention, encryption, namespace access, and payload-codec policy must match PostgreSQL sensitivity.
- Release 0.4 does not execute external publishing actions. It records explicit `manual_resolution` work and requires a human to provide the real result. Provider credentials are therefore never passed through Temporal workflow code or stored in workflow command payloads.
- Activity input/output and error records must remain bounded and secret-free. External tokens are resolved inside future activities from opaque connection IDs and may not be returned as step output, written to `context`, or logged.
- The legacy workflow path cancels active cancellation scopes and performs cleanup in a non-cancellable scope. V2 instead wakes pending branches and awaits already-dispatched activity settlement so accepted success/ambiguity is retained; see the current boundary above.

## Publishing and measurement boundary

- Discord webhook URLs are bearer credentials. Input is restricted to HTTPS `discord.com/api/webhooks/<numeric-id>/<token>` with no alternate host, port, query, fragment, or embedded basic credentials, preventing the connector from becoming an SSRF primitive.
- The webhook is tested before storage and encrypted with the existing AES-256-GCM connector vault key. API/UI responses overwrite the encrypted field with `undefined`; logs, workflow history, publication snapshots, and measurement events never receive the URL or token.
- Discord messages use `wait=true` so success requires a returned message ID. `allowed_mentions.parse=[]` prevents user-provided `@everyone`, role, or user text from generating notifications. Optional suppressed-notification flags are explicit step input.
- Provider rate limits are dynamic and classified from response headers. Authorization/404 failures stop automatic execution. Server/transport uncertainty is `ambiguous`, and automatic resend is suppressed because Discord webhooks have no client idempotency key.
- Measurement ingest secrets contain 256 bits of random material and are displayed once. PostgreSQL stores only SHA-256 hashes and a short prefix. Every event reference is revalidated against the key’s workspace before insert, and `(workspace_id, event_key)` suppresses replay.
- Measurement properties are limited to 50 keys and 32 KiB JSON. Currency must be a three-letter uppercase code. No raw IP address, user-agent fingerprint, cookie, or personal identifier is stored by the tracked-link redirect.
- Redirect targets come only from a stored, published workspace Destination; request parameters cannot select an arbitrary target. Only stored keys matching `utm_[a-z_]+` are appended.

## Desktop companion boundary

- Pairing codes use eight characters from an unambiguous 32-character alphabet, expire after ten minutes, and are consumed once. PostgreSQL stores only a SHA-256 base64url hash; an authenticated owner/admin/editor must create the code.
- Pairing returns an `mm_worker_...` high-entropy bearer credential exactly once. PostgreSQL stores its hash and display prefix. The Tauri Rust core stores plaintext through the operating-system credential manager; the webview, local JSON settings, logs, and job records never receive it.
- The pair and worker routes accept bounded strict JSON. Worker bearer parsing requires the exact prefix and maximum length. Revocation makes authentication fail and cancels queued or claimed jobs; pause keeps heartbeat/result reporting available but blocks new claims.
- Remote control-plane origins must use HTTPS. Plain HTTP is accepted only for localhost loopback development. Redirect following is disabled for companion HTTP calls so authorization cannot be forwarded to another host.
- Job claims use `FOR UPDATE SKIP LOCKED`, a random claim-token hash, and a five-minute lease. A completion must match job, worker, active lease, status, and claim-token hash; replay after completion is rejected.
- Every returned job envelope is HMAC-SHA-256 signed over recursively key-sorted canonical JSON. Rust verifies signature, schema version, issue/expiry time, worker ID, allowed action/mode, credential-free HTTPS URL, exact hostname allowlist, and exact expected origin immediately before execution.
- Release 0.6 exposes no generic shell or filesystem API to the webview. `open_url` uses the OS default browser only after a visible user click. Folder access begins with a native user-selected directory, validates its canonical path, and sends no path or contents to the server.
- The local emergency pause stops polling and execution. A bounded local `executed_job_ids` list prevents the same page-open action from repeating when result reporting must be retried after local execution.
- The compiled webview uses a restrictive CSP, no remote content, and a single Tauri main-window capability. Custom Rust commands perform their own scope checks; Tauri ACLs do not make unsafe Rust logic safe.

## Media and accessibility boundary

- Provider downloads remain worker-only and are bounded before processing. `file-type` magic-number checks are a best-effort validation layer, not a malware scanner or proof that a parser-safe file is benign.
- A detected binary type must match the declared provider MIME type, except that a generic `application/octet-stream` declaration may narrow to the detected type. Undetectable binary input is rejected. SVG is not rendered inline or passed through the image pipeline in this release.
- Sharp runs with warning failures and a 100-million-pixel input limit. Recipes auto-orient into newly encoded WebP output; originals remain byte-for-byte immutable. A production worker still needs process/container resource ceilings, timeouts, patched codecs, and decompression-bomb monitoring.
- Object keys follow a strict namespace grammar, forbid traversal/double separators, resolve beneath `MEDIA_STORAGE_ROOT` in development, and use a validated optional prefix in S3. Keys are generated only from SHA-256 identities and internal recipe versions; client requests never supply object keys, bucket names, prefixes, endpoints, or filesystem paths.
- `putImmutable` uses exclusive filesystem creation or S3 `If-None-Match: *`. If a content-addressed key already exists, bounded bytes must hash identically before reuse. S3 writes carry a precomputed SHA-256 and checksum metadata; reads verify returned checksums and enforce the configured 50 MiB-or-lower bound.
- Production refuses filesystem mode and rejects non-HTTPS custom endpoints. Static access credentials must be complete and remain server-only; prefer short-lived workload identity. Bucket encryption, public-access blocking, least-privilege policy, versioning, lifecycle, replication/backup, deletion governance, access logging, and restore testing remain deployment responsibilities.
- `MEDIA_ACCESS_SIGNING_KEY` is independent from OAuth/token encryption and companion credentials. Preview signatures bind one random asset UUID and expiry, use timing-safe comparison, expire within five minutes, and carry no object key. Rotate this key to invalidate outstanding preview URLs.
- The content endpoint looks up the object key in PostgreSQL only after signature validation. It sets `X-Content-Type-Options: nosniff`; only a small image MIME allowlist renders inline, and other bytes force download with a sandboxed response policy.
- Alternative text suggestions based on filenames/dimensions are explicitly `needs_review`, not approved descriptions. Only workspace writers may approve text or classify an image decorative, the change is audited, and repository approval blocks unresolved accessibility state.
- The default malware scanner reports `not_configured`. This state is visible and must never be promoted to `clean` by configuration, UI, or migration. Production ingest and external execution require a real scanner policy and quarantine behavior.
- Rights state begins `unchecked`. Release 0.7 stores the vocabulary but does not yet provide proof-of-rights review or pre-publish enforcement; publishing media before that gate is outside the supported security boundary.

## Document parser boundary

- Original bytes are stored immutably and malware scan disposition is recorded before document parsing. The development scanner is still `not_configured`; parser support does not make untrusted production uploads safe.
- PDF parsing receives bytes, not a URL, disables WebAssembly/system-font fallback, stops at parser errors, and never renders annotations, JavaScript, forms, links, or embedded objects. It caps pages, text, and elapsed stage time; encrypted, malformed, truncated, and no-text/OCR-required outcomes are explicit review states.
- OOXML is treated as a constrained ZIP container. Strict entry-name validation rejects traversal/backslash names; encrypted entries, entry-count/expanded-size/XML-part/compression-ratio violations, package-type mismatches, and missing main parts fail before evidence is accepted.
- Extractors read only allow-listed XML parts and text/cell values. Macros, formulas, external relationships, ActiveX, OLE, and embedded documents are not evaluated. Legacy binary and macro-enabled Office MIME families remain unsupported.
- In-process limits reduce exposure but are not a production sandbox. Production must run patched parsers in a memory/CPU-limited worker or container, enforce a hard wall-clock kill boundary, quarantine scan failures, monitor decompression/parser faults, and preserve the immutable original for safe reprocessing.

## Local-folder ingestion boundary

- Native folder selection canonicalizes a user-chosen directory. Enumeration never follows symlinks, never escapes the canonical root, caps the manifest at 5,000 files, and skips empty or over-10-MiB files.
- The device's absolute approved path remains only in local configuration. The server receives normalized relative paths because filenames/relationships are Content Package metadata; documentation and UI must not imply that relative names are secret.
- Local source access requires the worker bearer credential plus an explicit enabled Smart Source assignment to that worker, active state, a recent healthy/working heartbeat, and `localFolderIngestion=true`.
- The server recomputes every path-derived item/parent identity, rejects duplicates and invalid recursion, reapplies MIME and ignore filters, and never accepts an object key or absolute path from the client.
- Content upload is requested only for an indexed current item, limited to 10 MiB, checked against `Content-Length`, recomputed SHA-256, and attached only if the source-item manifest hash still matches. Immutable object collision checks remain active.
- The ingestion worker re-reads through `ObjectStore` and rechecks the manifest hash before parsing. Production still requires malware quarantine, isolated parsers, encrypted/versioned tenant-scoped storage, quotas/rate limits, retention, and audit/alert policy.

## Campaign-to-companion routing boundary

- Campaign activation is not authorization to control any desktop. It selects only an already paired, active, recently seen worker that explicitly reports `assistedOpenUrl`; multiple eligible devices require an exact `companionWorkerId`.
- The router accepts only credential-free HTTPS URLs that pass the existing companion URL validator. It persists the exact expected origin and narrows the job allowlist to one hostname even when the Campaign author supplied a broader validation list.
- Authority is bound to workspace, worker, Campaign instance, Campaign step run, `open_url`, confirmation mode, one URL, bounded instructions, one idempotency key, and a short claim lease. The Campaign bridge adds no cookies, browser profiles, passwords, arbitrary scripts, shell commands, or filesystem paths.
- Job completion must match the worker, live lease, and claim-token hash. PostgreSQL changes the job state and inserts the outbox command together; replay cannot generate a second workflow signal.
- A failed job never reports Campaign success. Disconnects, pause, revocation, lease expiry, user refusal, and validation errors leave the durable workflow at an explicit manual-resolution boundary.
- Campaign IDs are visible in the authenticated operator view for traceability. They are opaque identifiers, not bearer authority, and are never included in the signed action URL.

## Foreground-monitoring security boundary

- The timer grants no new authority: every run reauthenticates and revalidates assignment, health, capability, manifest, filters, item identity, and requested uploads.
- A native atomic guard rejects overlap between timer and manual invocations, bounding simultaneous disk traversal and transfer from one companion process.
- Emergency pause and administrator pause suppress timer work. Closing the attended app stops monitoring; 0.10 does not create persistence, startup tasks, services, or hidden tray execution.
- Only last successful time and interval enter heartbeat health details. Folder path, manifest bytes, local errors, and filenames are not added to heartbeat telemetry.

## Communication-profile boundary

- Profile routes require an authenticated workspace membership and write authority. Repository queries repeat workspace ownership checks before every draft or publish transition.
- Published profile versions are immutable. Campaigns accept only published or superseded versions from the same workspace, reject duplicate Audience pins, and persist real foreign keys so cross-tenant or dangling bindings cannot be smuggled through client JSON.
- Profile text is bounded by Zod schemas and stored as neutral JSON/arrays. It is guidance, not executable code, authorization, or a model prompt by itself. Channel persona keys/values and list counts are bounded to prevent unbounded metadata growth.
- Audience Profiles describe intended groups. The UI and schema provide exclusions, but 0.12 does not implement automated sensitive-trait inference detection. A future generator/model gateway must enforce prohibited-trait and privacy policies before using these fields.
- Communication ceilings are deterministic server-side controls. The strictest selected Brand/Audience ceiling wins; `custom` cannot bypass an ordinal ceiling. Client selector state and labels are never trusted as enforcement.
- Campaign error handling uses a structural Campaign-validation guard at the Next.js boundary because bundled modules may duplicate class identities. The guard requires the exact error name, a string message, and an issues array; arbitrary errors still return the generic 500 response.
- Profile publishing currently follows the workspace writer boundary used by Context Packs. Production governance may require dedicated approver roles, two-person publication, reason capture, and profile-field diff review for regulated workspaces.

## Governed Draft boundary

- Draft generation accepts only an authenticated workspace writer, a current published Campaign version, and an approved Content Package already pinned to that version. The repository repeats workspace and lifecycle checks inside the generation transaction; client JSON cannot supply evidence, profile text, claims, generator identity, or communication controls.
- The initial generator never executes Profile text as code or a prompt. It reads bounded structured fields only for recorded presentation choices and copies factual sentences from active resolved package evidence. Unresolved and superseded evidence is excluded before generation.
- Every factual Draft claim stores exact evidence IDs and the generation stores a complete immutable evidence snapshot with provenance, source references, confidence, and captured package version. A call to action has no evidence IDs and is explicitly labeled presentation-only.
- Draft submission captures one exact immutable version. Only workspace owner/admin/approver roles may decide the resulting approval; decisions and notes are audited. A partial unique index prevents parallel pending approvals for the same Draft.
- Format character ceilings are server-owned policy. Generation selects complete facts that fit; it never truncates evidence text, and format overflow returns a structured 422 before persistence.
- Revision input cannot supply facts, evidence IDs, generator state, or arbitrary body text. A punctuation-free lead-in, bounded call to action, valid unique hashtags, alternative text, and change note are the only editable fields; the repository reconstructs the successor and clones exact fact/evidence rows.
- Revision is allowed only after a requested-change decision or while the current version remains working. The predecessor becomes `superseded`, the successor records its exact source version, and a new approval is required.
- Channel preview creation requires a workspace writer, one exact approved Draft/current version, an active same-workspace Channel Connection, and an optional published same-workspace Destination. Every constraint is repeated inside the transaction.
- Previewing reads only the non-secret capability manifest. It never selects/decrypts `encrypted_credentials`, performs network I/O, creates a tracked link, or records an external publication action.
- Rendered content is never truncated to fit. Unsupported publishing, empty output, and capability limit overflow produce stored blocked issues so corrective work remains visible rather than silently changing approved text.
- Connection capability changes or deactivation make prior snapshots stale. A later execution bridge must require fresh/ready state and immediately revalidate the live provider before any side effect.
- Preview-backed Campaign activation requires the same Campaign root, current approved Draft version, ready/fresh snapshot, exact Channel Connection, and exact Campaign Destination. Cross-workspace/cross-Campaign preview reuse fails before an instance is created.
- Exact-preview steps prohibit Destination append and tracked-link substitution; approved text cannot be recomposed after review.
- The workflow worker revalidates freshness/current approval before credential decryption or provider I/O. Drift returns manual-required and creates neither a provider request nor a publication action.
- Successful execution records preview ID, Draft version ID, exact content, provider, and Destination in the existing side-effect ledger while retaining ambiguity-safe resend suppression.
- Release 0.17 preview options are queried by both authorized workspace and exact Campaign root. Cross-Campaign and cross-workspace preview metadata is never serialized to the form.
- Picker eligibility and disabled options are defense-in-depth only. Client state, labels, `isCurrentApprovedVersion`, and `PreviewEligibility` are never accepted as authorization or execution proof.
- Conflict-safe input mutation removes both supported Channel Connection override spellings plus Destination append and tracked-link substitution before writing an exact preview reference; unrelated input keys remain explicit in the advanced editor.
- Invalid JSON and non-object values cannot be mutated through the picker. Server request validation and the Release 0.16 activation/runtime gates still handle crafted requests and stale browsers.
- The Campaign preview-option query selects only non-secret capability/identity/readiness data. It does not select encrypted credentials, create tracked links, invoke providers, or create publication actions.
- Release 0.18 creates tracked identity only through an explicit tracked-preview request after exact Draft approval and published-Destination validation; no provider credential or outbound publication occurs.
- Release 0.19 accepts only unique same-generation-package processed image IDs, snapshots governance and exact object identity, and rejects unsupported count/type/size/accessibility/scan/rights state before preview creation.
- Derivative accessibility meaning is read from its original source asset; callers cannot substitute alternate text in the preview request. Decorative assets omit Discord descriptions intentionally.
- The workflow worker verifies stored byte length and SHA-256 against the approved snapshot before credential decryption, action creation, or provider I/O. Missing or modified objects fail closed.
- Multipart requests preserve mention suppression. Publication ledgers and audits contain attachment metadata but never binary content or provider credentials.
- Release 0.20 resolves prior succeeded/dispatching/ambiguous publication state before credentials or network access, preventing a live preflight from weakening existing resend suppression.
- The workflow worker performs a Discord webhook GET after exact-media verification and compares the live webhook/guild/channel identity with stored non-secret connection identity immediately before action creation or retry.
- Provider unavailability, malformed preflight output, or target drift marks the connection `error`, returns manual-required, and performs neither a provider POST nor new publication-action creation.
- Successful preflight stores only observed provider identity and health timestamps. The webhook URL/token is never written to the publication request snapshot, audit metadata, or logs by this contract.
- Release 0.21 accepts only closed normalized measurement event types and bounded, unique Campaign criterion keys/counts; crafted JSON cannot create arbitrary SQL metrics or expressions.
- Success evaluation reads events through both workspace and exact Campaign-instance scope, then reads the Campaign version pinned to that instance. A successor draft cannot rewrite historical goals.
- Missing events evaluate to zero and an empty criterion list is never reported as successful, preventing absent telemetry from becoming an invented positive result.
- Criteria contain no customer identifiers or credential material. Existing measurement-key authentication, cross-workspace reference validation, event-key idempotency, and bounded properties remain authoritative for incoming events.
- Release 0.22 returns each measurement secret once and stores only its SHA-256 hash; list, revoke, audit, and error responses expose only the short prefix and non-secret lifecycle metadata.
- Revocation requires an authenticated workspace writer and scopes the update by workspace, UUID, and active status. Cross-workspace and repeated requests cannot change state or create audit entries.
- Key mutation and audit history commit in one transaction. Revocation retains hash/prefix/use timestamps for incident evidence while active-only authentication rejects the old bearer immediately.
- The client clears the one-time secret before a revoke request and provides no un-revoke action. Production still requires per-key rate limits/quotas, expiry/rotation policy, anomaly detection, and incident response.
- Release 0.23 validates value goals as a closed discriminated shape with a normalized event type, bounded finite positive target, and uppercase three-letter currency; arbitrary metric expressions and dictionary paths are rejected.
- Monetary aggregation remains scoped by workspace, exact Campaign instance, event type, and exact currency. Currency-null and other-currency events cannot satisfy a currency goal, preventing silent mixed-currency inflation.
- The application performs no inferred FX conversion and stores no exchange-rate authority. Introducing conversion requires an auditable rate source, effective timestamp, base/quote pair, rounding policy, and immutable calculation evidence.
- Release 0.24 binds each measurement bearer to a database-constrained non-empty normalized event allowlist and optional expiry; existing keys receive the explicit compatibility default of all events/no expiry.
- Authentication requires active status and database time before expiry, returns only workspace/key identity plus allowed event types, and never returns hash, prefix, name, or secret.
- Event scope is enforced after schema parsing and before reference validation/insertion. A forbidden event returns 403 and creates no measurement row; expired credentials return the same generic 401 class as invalid/revoked values.
- Scope and expiry are non-secret audit evidence. Database-clock monitoring is part of the authorization boundary, and rollback to Release 0.23 is prohibited while these restrictions are relied upon because that code ignores both columns.
- Release 0.25 creates success signals only from accepted, workspace-authorized measurement events and the server-loaded Campaign instance/version. External callers cannot submit a workflow signal payload or choose its actor, criteria, command key, or delivery status.
- Instance-row locking plus the unique stable command key prevents concurrent events from manufacturing multiple threshold transitions; replayed event keys cannot change the first provenance payload.
- The signal contains normalized criteria/progress, an event key, and timestamps but no measurement bearer, hash, connector credential, raw customer content, or provider secret. Workflow history retention must nevertheless follow Campaign-data retention policy.
- Success notification has no automatic control authority in Release 0.25. It cannot publish, complete, pause, cancel, or expand connector capabilities; any future action policy requires a separate reviewed authorization contract.
- Mixed-version dispatch is fail-closed in 0.25 through unsupported-command errors. Operators must stop 0.24 dispatchers during rollback so they cannot falsely complete a command type they do not implement.
- Release 0.26 constrains success action at the database, schema, domain, and UI boundaries to `notify_only | pause`; arbitrary command names, connector capabilities, or executable expressions are not accepted.
- Action authority comes only from the immutable Campaign version pinned to the authorized instance. Measurement properties and external event senders cannot choose, elevate, or replace it.
- Historical/missing actions normalize to notification-only. This fail-safe default prevents an old queued command or pre-migration Campaign from gaining control authority after upgrade.
- Pause uses the existing workspace-scoped Temporal workflow and persisted instance-state boundary. It creates no provider request, credential access, publication action, or completion claim.
- Pause does not revoke an already-dispatched provider action. Operators must use provider-specific incident controls when work has crossed an external side-effect boundary.
- Release 0.27 binds optional Campaign-root scope to the authenticated key principal. Selected Campaign IDs are validated inside the key-creation transaction against the same workspace, preventing cross-tenant authorization rows.
- Restricted authorization resolves every supplied Campaign-bearing reference, including instance, step-run, tracked-link, and publication-action indirection. It requires exactly one distinct allowed root so a permitted direct ID cannot mask a conflicting unlisted indirect reference.
- A restricted event with no Campaign root, an unresolved/deleted root, multiple roots, or an unlisted root returns 403 before normal insertion. Event-type authorization remains first; neither denial path creates measurement evidence.
- Campaign deletion cascades only the junction row and cannot rewrite `campaign_scope_mode`. An empty restricted scope therefore denies all instead of silently widening the credential.
- Campaign IDs and scope mode are non-secret audit metadata. The plaintext key remains one-time, hash-only storage remains authoritative, and principal/list/error responses still exclude the hash and full secret.
- Release 0.28 separates contact permission from relationship stage so a later lifecycle update cannot silently erase an opt-out. Suppression requires a reason and timestamp; restoration is a distinct audited transition.
- Provider identities are exact provider/subject records, not name-based merges. A workspace uniqueness constraint plus composite tenant foreign key prevents one provider subject from being attached to multiple local relationships or a cross-workspace parent.
- Assigned owners must already hold workspace membership. Relationship reads and mutations remain authenticated and workspace-scoped; unauthenticated list access returns 401 and cross-workspace repository reads return no record.
- Audit data records only stage, contact permission, and provider names. Internal notes, suppression reason, provider subject IDs, handles, profile URLs, and confidence values remain outside audit dictionaries to reduce unnecessary personal-data replication.
- The registry does not yet authorize external outreach because no relationship-targeted adapter exists. Every future discovery, message, reply, follow-up, or autonomous response boundary must reload contact permission immediately before provider I/O and fail closed when missing or suppressed.
- Release 0.29 makes internal notes a database-constrained message kind that requires an authenticated creator. Only the dedicated notes route accepts them, and the application exposes no outbound-send route or connector command.
- Provider thread IDs are unique per workspace and provider message IDs are unique per thread, limiting retry-driven duplicate history. The repository converts duplicate thread registration into bounded validation rather than exposing a database error.
- Conversation reads/writes repeat workspace membership and composite tenant relationships. A suppressed contact still permits inbound history and internal notes, but that state grants no delivery authority; future outbound code must reload permission at the last side-effect boundary.
- Conversation audit dictionaries omit message bodies, author displays, and metadata. Internal-note evidence contains only its generated message ID, reducing replication of potentially sensitive operator context.
- Release 0.30 stores handoff briefs outside conversation messages, so collaboration context cannot be mistaken for provider history or selected as an outbound message kind.
- One active handoff per thread is enforced by both a locked repository check and a partial unique index. Close transitions are workspace/thread/brief scoped and accept only resolved or cancelled.
- Handoff audit data contains only the generated handoff ID and whether a deadline exists. Contact summaries, importance, requests/offers, prior responses, relevant context, suggested responses, and timestamp values remain outside audit dictionaries.
- Response, follow-up, and handoff deadlines are informational operator inputs in this release. They do not trigger notifications, escalate privileges, bypass suppression, or authorize connector I/O.
- Release 0.31 validates and bounds every inbox query before database access, caps results at 200, and parameterizes all dynamic values.
- Root thread queries and correlated message/handoff predicates repeat workspace identity, preventing a matching body or handoff in another tenant from influencing results.
- Search excludes connector credentials, provider metadata dictionaries, handoff brief content, and audit dictionaries. URL query state may still contain operator-entered search text, so production access logs and analytics must apply appropriate redaction/retention policy.
- Release 0.32 binds every read cursor to both a workspace-scoped thread and an existing workspace membership. Authenticated list/detail requests supply the viewer identity server-side; clients cannot request another user's unread count.
- Unread predicates repeat workspace/thread identity and exclude only the exact authenticated user's authored messages. Database `created_at`, rather than manipulable provider chronology, decides whether newly observed data is unread.
- Mark-read is an explicit authenticated POST and its UPSERT advances only with database time. Missing/foreign threads share the same 404 shape, and a read cursor grants no contact, approval, or provider-delivery authority.
- Read cursors are intentionally absent from the business audit stream to avoid high-volume personal activity replication. `last_read_at` remains privacy-relevant activity metadata and must be covered by production retention, export, access, and deletion policy.
- Release 0.33 exposes only user ID, display name, workspace role, and conversation-assignability through the authenticated member directory. It omits email, session, organization-role, and unrelated profile data.
- Conversation assignees must be same-workspace owners, administrators, or editors. UI filtering is convenience only; the repository repeats eligibility inside the mutation transaction and rejects crafted viewer/analyst/approver or cross-workspace UUIDs.
- Exact-owner inbox filters remain within the authorized workspace and reveal only threads already readable to that user. Hydrated names come from the current account record and are not duplicated in thread storage.
- Assignment audit evidence stores the stable assignee UUID or null so ownership transitions remain accountable without copying email, messages, provider identity, or handoff text.
- Release 0.34 accepts only closed sentiment, intent, and urgency values. The database repeats the constraints and pairs reviewer UUID with database timestamp so crafted clients cannot persist arbitrary labels or partial review evidence.
- `unknown` is the default for historical and unreviewed threads; the system does not silently label absent review as neutral sentiment, normal urgency, or likely intent.
- Classifications are human-reviewed operational metadata in this release. No model runs, no confidence is fabricated, and protected/sensitive traits must not be inferred or stored in these fields.
- Exact classification filters repeat workspace scope. Classification audits contain only closed values plus the normal actor envelope and exclude message bodies, provider metadata, handoff text, and speculative personal data.
- Negative sentiment, complaint intent, or critical urgency never changes contact permission, grants approval, or bypasses provider-delivery controls.
- `APP_BASE_URL` is parsed as an HTTP(S) origin and rejects credentials/invalid schemes before a first-party URL is rendered.
- Random base64url slugs are reused per preview; preview deletion cascades the link and disabled/expired/missing link state fails activation/runtime closed.
- UTM dictionary keys are parsed from raw JSON text so the redirect whitelist receives the stored `utm_*` spelling rather than camel-transformed keys.
- Evidence-binding junctions use `ON DELETE CASCADE` so an authorized source/tenant deletion can complete. This removes the live navigation link, not the immutable generation snapshot. Production retention, legal hold, and erasure policy must define whether the retained snapshot must be deleted, anonymized, or preserved.
- `DraftValidationError` uses the same structural Next.js boundary defense as Campaign validation so duplicated server bundle class identity cannot turn a known 422 into a generic 500. Unknown error shapes remain generic and do not disclose SQL or internal state.
- Release 0.14 does not send content to an external model. A future provider must enforce sensitive-trait/privacy rules, typed structured output validation, prompt-injection separation, per-claim evidence validation, budget routing, secret isolation, and evaluation replay before activation.

- Release 0.35 binds optional conversation Campaign and Destination references to the thread workspace with composite database foreign keys and repeats ownership validation inside the mutation transaction. Crafted cross-workspace UUIDs fail with bounded validation before persistence.
- Client option projections contain only stable IDs and display labels. Destination URLs/tracking, Campaign versions/steps/context, credentials, and provider metadata are not passed to conversation controls.
- Exact filters and expanded Campaign/Destination/topic search remain rooted in the authenticated workspace query. Joined labels cannot make a foreign thread visible, and the query remains parameterized and bounded.
- Context-change audit evidence contains UUID-or-null values only. Association does not grant Campaign execution, contact, approval, tracked-link, provider, or data-access authority.
- Delete restriction preserves live context evidence. Operators must explicitly clear or reassign conversation context before deleting a referenced Campaign or Destination; rollback does not remove these constraints.

- Release 0.36 never passes `StoredChannelConnection` or `StoredPublicationAction` to conversation client components. The bounded directory excludes encrypted credentials, configuration/capabilities, provider URL, idempotency key, request snapshot, response metadata, and last error.
- A publication requires its exact Channel Connection and workspace at schema, transactional repository, and composite foreign-key boundaries. Missing, mismatched, or cross-workspace references fail closed.
- Account/provider/external-publication search is authenticated, tenant rooted, parameterized, and bounded. External IDs are non-secret identity, not bearer authority.
- Audit evidence contains account/publication UUIDs or null only. It excludes labels, URLs, credentials, provider payloads, contact/message content, and errors.
- Association never authorizes credential decryption, provider I/O, reply, deletion, Campaign execution, contact, or approval. Every side-effect path must use its existing exact authorization and lifecycle checks.
- Delete restriction preserves a live lineage pointer; operators must explicitly clear or reassign conversation context before deleting a referenced account or publication action.

- Release 0.37 exposes only Brand root ID, name, and status to conversation clients. Brand descriptions are searchable server-side but are not rendered in option labels; profile/version dictionaries, voice, terminology, claims, disclosures, and Campaign inputs remain server-only.
- Brand ownership is checked inside the locked repository transaction and repeated by a composite same-workspace foreign key. Crafted missing or cross-workspace UUIDs fail closed with a bounded field error.
- Exact Brand filtering and name/description search remain authenticated, parameterized, workspace rooted, and limited to 200 threads. A joined Brand can never expand thread visibility.
- Brand-context audit evidence contains the UUID or null only. It excludes Brand labels, description/profile content, Campaign definitions, contact/messages, and provider material.
- Association never authorizes Brand editing, Campaign generation/execution, approval, contact, credential access, reply, or provider I/O. Campaign Brand-version pins remain the only immutable Brand inputs for governed Campaign/Draft behavior.
- Delete restriction protects the live reference; operators must explicitly clear or reassign conversation Brand context before deleting a referenced Brand Profile root.

- Release 0.38 derives relationship history only inside the already authorized workspace/thread query. Both prior threads and messages repeat workspace identity, so a shared or guessed relationship UUID cannot cross tenant boundaries.
- The projection returns the current closed stage, two integer counts, and one optional database timestamp. It never selects or serializes prior bodies, internal notes, metadata, relationship notes, provider identities, email/addresses, confidence, or organization details.
- Database `created_at` supplies the strict chronological boundary; provider-controlled `occurred_at` cannot make a later-ingested record appear prior. Threads and messages created after the current thread are excluded.
- Relationship stage and history counts are contextual facts, not identity proof, customer classification, consent, or authority. They never override contact suppression or authorize assignment, response, Campaign, approval, credential, or provider actions.
- Read-time derivation creates no audit event because it is not a mutation. Production retention/erasure policy still governs the underlying messages and relationships from which counts are derived.

- Release 0.39 accepts only a strict Destination-or-Publication union. Repository and composite database constraints repeat workspace/target/account integrity and bind `recorded_by` to a current workspace membership.
- UUID idempotency is scoped to workspace/thread. Replay returns the original evidence and does not duplicate the audit transition; a new key is required to record another observed share.
- Future observed timestamps beyond a five-minute clock-skew allowance fail closed. Relationship history uses immutable database `created_at`, so a later operator cannot backdate new evidence into a thread that had already begun.
- Client projections expose Destination title/canonical URL or account name/publication external ID/status only. Destination description/tracking/identifiers, Publication URLs/request/response/error, message content, credentials, and provider payloads remain excluded.
- Audit evidence contains the share UUID, kind, stable target/account IDs, and observed time. It stores no URL, label, message, contact, provider payload, credential, or error material.
- Recording observed evidence never sends content, proves provider delivery, changes contact permission, or grants reply, Campaign, approval, credential, or provider authority. Canonical links may still be sensitive business data and remain workspace-authorized.

- Release 0.40 rule creation and lifecycle changes require authenticated workspace write access. Rule evaluation occurs only inside the already authorized workspace/thread query.
- Brand, account, creator, and suggested-owner references are workspace bound in both repository checks and composite database foreign keys. Suggested owners must remain action-eligible; a disabled or ineligible-owner rule cannot win.
- Matchers use only explicit closed thread fields. Message bodies, internal notes, search text, provider identities/payloads, relationship notes, sentiment, protected traits, and model output are not routing inputs.
- Evaluation has a deterministic total order and returns one minimized suggestion. It never writes owner/status, bypasses contact suppression, starts a handoff, marks content read, or invokes a connector.
- Rule audit dictionaries omit the rule name and all conversation/contact content. They contain only closed match values, stable IDs, priority/enabled state, and suggested target values.
- Client option projections remain bounded and secret-free. Channel credentials/configuration, full Brand profiles, member email/session state, and provider request/response material never enter routing controls.

- Release 0.41 policy reads and writes are workspace-authorized; only writers may replace policy configuration. The author reference is bound to the same workspace in PostgreSQL.
- Timezones are validated against the runtime IANA database, business times and minute targets are bounded, and the database repeats structural checks. No client-supplied SQL interval or timezone expression is interpolated.
- Service-level projection uses only urgency, thread/message database timestamps, an explicit deadline, and workspace policy. It does not inspect message bodies, notes, contact identity, provider payloads, Brand content, or inferred sensitive traits.
- `conversation.service_level_policy_saved` audit data contains timezone, day mask, local hours, numeric targets, and lead time only. It excludes messages, contacts, credentials, session data, and provider request/response material.
- Evaluation is advisory and read-only. It cannot bypass contact suppression, assign an owner, change status, start a handoff, send a notification, issue a workflow command, or invoke a connector.

- Release 0.42 review-request creation requires authenticated workspace write access. The requested reviewer must be a current owner, administrator, or editor; mentioned users must be current workspace members; the actor, reviewer, and mention sets are mutually separated and bounded.
- An optional cited message is protected by a composite same-workspace/thread foreign key and repository validation that requires `kind = internal_note`. An inbound/outbound message, foreign-thread note, or cross-workspace UUID cannot be cited.
- Only the exact requested reviewer may resolve an open request and only the exact requester may cancel it. Closing does not grant approval, contact, assignment, workflow, credential, or provider authority.
- List queries expose only an integer open-request count. Full request text, cited-note excerpt, and member names are restricted to the already authorized detail view; they never enter connector payloads or external messages.
- Review audit events contain stable IDs and bounded structural metadata only. Request text, cited internal-note content, message bodies, contacts, credentials, session data, and provider request/response material are excluded.
- Membership deletion cascades only optional mention edges so access removal is immediate without destroying core requester/reviewer attribution. Production retention, erasure, legal-hold, and subject-access policy must still govern stored collaboration text.

- Release 0.43 identity-link mutations require authenticated workspace write access and repeat current owner/admin/editor membership checks inside the transaction. Both relationship roots are locked and protected by same-workspace composite foreign keys.
- Canonical UUID ordering plus a workspace/pair uniqueness constraint prevents duplicate directional links and self-link checks reject the same root. Cross-workspace candidates fail before persistence.
- The allowed evidence tuple excludes similar names, organization resemblance, message-body similarity, sensitive traits, and model output. Confidence is bounded but is not identity proof; only explicit confirmed state joins the shared view.
- Confirmation never reparents or deletes provider identities, conversations, messages, notes, or audits. Dismissal is reversible separation. Provider subjects remain on their original relationship roots.
- `relationship_effective_contact_permission` applies the safest state across the confirmed component. Any local suppression makes the shared view and associated conversation reads do-not-contact; a link can never weaken suppression or authorize outreach.
- Link audit dictionaries contain stable relationship/link IDs, closed evidence kind, and numeric confidence only. They exclude names, addresses, handles, provider subjects, profile URLs, relationship notes, messages, credentials, and provider payloads.
- Identity-resolution views remain workspace-authorized and do not call connectors or expose data cross-tenant. Production retention, legal-hold, erasure, subject-access, and evidence-review policy must be defined before importing real CRM or personal-message identities.

- Release 0.44 scanning requires current workspace authoring permission and operates only on verified provider identities in the authorized workspace. Reported identities and cross-workspace records are excluded before signal construction.
- Candidate signals are limited to exact normalized email addresses, canonical HTTPS profile links, and UUID/URN/namespaced identifiers. Names, organizations, notes, messages, free-form handles, sensitive traits, and model output are never matching inputs.
- Deterministic links store a SHA-256 evidence fingerprint, closed evidence kind, fixed confidence, and stable relationship IDs. Raw addresses, URLs, identifiers, names, and provider subjects are absent from link audit dictionaries.
- A signal shared by more than five relationship roots is treated as non-discriminating. Identity reads, new suggestions, and queue output are bounded to limit accidental enumeration and resource exhaustion.
- Scanning creates suggestions only and never reopens an existing direct pair, including a dismissed pair. It cannot confirm a graph edge, weaken suppression, move an identity or conversation, send outreach, start a workflow, or invoke a provider.
- SHA-256 fingerprints minimize disclosure but may remain linkable for low-entropy inputs. Production retention, deletion, subject-access, rate limiting, scan scheduling, and evidence-review policies must be defined before importing real identity datasets.

- Release 0.45 generation requires current workspace authoring permission and repeats the owner/administrator/editor check inside the locked transaction. Thread, relationship, Brand, Campaign, Destination, and actor references remain tenant bound.
- Assistant input is server assembled. Clients cannot submit prompt text, message history, response text, context, confidence, citations, claims, Destination, model identity, or promotional strength through the generation route.
- The immutable snapshot contains up to twenty external message bodies and may contain personal or confidential content. It excludes internal notes, system messages, provider metadata, credentials, sessions, relationship notes, and unpublished Brand/Campaign/Destination content; production retention, erasure, export, and legal-hold rules must cover snapshots explicitly.
- Suppression-first effective contact permission is evaluated before generation. A suppressed contact always produces `no_response`, no response text, and no proposed Destination. High-risk reviewed intent/urgency produces `human_review` without response text.
- Every factual claim must reference a valid citation index. The deterministic provider adds factual business language only from an exact published Destination snapshot; uncited provider output fails closed at the repository boundary.
- Audit dictionaries contain stable IDs, closed recommendation, uncertainty, counts, citation kinds, generator/prompt identity, promotion, and input fingerprint only. They exclude message bodies, response text, question text, excerpts, names, URLs, provider data, and the context snapshot.
- Suggestion generation, regeneration, and dismissal never create an outbound message, call a connector/model network service, modify contact permission, alter assignment/status, start a handoff/workflow, or create a publication action. A future model or reply adapter requires a separate reviewed threat model and authorization contract.

- Release 0.46 draft reads require authenticated workspace access; save, discard, and presence mutations require owner, administrator, or editor access both at the route and repository boundary. Thread, source suggestion, actor, and editor references are tenant bound.
- Draft bodies are sensitive collaboration content and may contain personal or confidential material. They never enter audit dictionaries, logs, connector payloads, or provider messages. Production retention, erasure, export, legal-hold, and access-review policy must cover draft rows explicitly.
- Clients cannot set actor kind, actor user, editor identity, lease expiry, or audit actor. Human presence is bound to the authenticated user; assistant presence is server-controlled and cleared in a `finally` block. Database checks cap a lease at five minutes even if repository code changes.
- Source provenance requires the exact suggestion to share both workspace and thread. Deleting a suggestion nulls provenance without deleting the draft; editing a draft never changes immutable suggestion evidence.
- Presence is advisory and expires. It must not be used as a lock, authorization signal, assignment, approval, or evidence that an actor saw content. Reads omit expired rows and cap enumeration at twenty.
- Save/discard audits contain stable IDs and character count only. The composer has no send/provider/account/schedule action and cannot create outbound-observed messages, workflow commands, publications, handoffs, or approvals.

- Release 0.47 attention reads require authenticated same-workspace access. The service-level policy mutation continues to require owner, administrator, or editor authorization and repeats tenant/member constraints in persistence.
- Queue inputs are server-owned timestamps and closed status/policy fields. Clients cannot supply `asOf`, reasons, severity, relationship/owner labels, or deadline results through the public GET route.
- The queue returns subject and relationship/owner display names already available in the authorized inbox plus closed reason codes and timestamps. It excludes message bodies, notes, review text, handoff brief text, provider metadata, credentials, sessions, and connector payloads.
- The 200-row repository cap and twenty-row initial UI projection bound enumeration and rendering. Resolved/archived threads are excluded; tie-breaking is deterministic.
- Attention reads create no audit event because they are derived and non-mutating. An escalation label is not authority to contact, assign, change status, create a handoff, start a workflow, notify a user, or call a provider.

- Release 0.48 policy and class mutations require authenticated owner, administrator, or editor access at the route and repository boundary. Reads require same-workspace access; cross-workspace thread IDs return no record.
- Retention classes are explicit closed values. No provider name, subject, message body, identity, relationship attribute, sensitive trait, or model output is used to infer personal-message or imported-email status.
- Legal hold is fail-safe: held threads have no configured window and are excluded in SQL before preview. Active threads are also excluded regardless of age.
- Candidate projections contain subject/relationship labels already visible in the authorized inbox, closed status/class, and two timestamps. They exclude bodies, notes, review/handoff text, snapshots, provider metadata, credentials, sessions, and connector payloads; repository and UI caps bound enumeration.
- Policy/class audit dictionaries contain only enabled/window values or prior/new class. Preview reads create no audit and no deletion. A candidate is not authorization to erase, anonymize, export, alter backups, remove provider data, or bypass legal/approval review.
- Release 0.48 intentionally deferred execution pending a separate threat model. Release 0.91 implements only the reviewed conversation-thread aggregate; every broader data class and production environment still requires tenant/legal authority, subject export, holds/exceptions, object/Temporal/backup/provider scope, recovery, and evidence design.

## Release 0.91 conversation-retention erasure controls

- Request and decision routes require authenticated same-workspace access and repeat role checks in persistence. Only owner/admin/editor may request; only owner/admin/approver may decide; the requester cannot decide that request even when they hold both role classes.
- Request/execute lock the enabled policy and exact tenant thread. Resolved/archived status, explicit non-hold class, last activity, class window, and current time are rederived server-side. Execute also requires the current class and eligibility timestamp to equal the request snapshot, preventing approval reuse after policy/class drift.
- Legal hold is rechecked at execution, not merely at preview/request time. Disabling policy, reopening a thread, moving eligibility into the future, applying legal hold, changing the class/window, deleting the thread elsewhere, or changing tenant scope aborts without partial deletion.
- Execution is one PostgreSQL transaction: count owned children, delete one exact `(workspace_id,id)` thread, rely on composite foreign-key cascades, update the durable request, and append minimized audit evidence. Transaction rollback restores all database rows if any step fails before commit.
- Cascade scope is conversation messages, handoffs, read state, drafting presence, response suggestions/drafts, review requests/mentions, and shared resources. Relationship/contact roots and their identities/notes/suppression, Campaigns, Destinations, Brands, accounts, publications, AI/workflow evidence, users, and workspaces remain.
- The ledger has no thread foreign key and copies no source content. Governance notes are retained and must contain justification only—never paste message text, personal data, provider payloads, credentials, secrets, AI output, or unrelated case evidence. Audit dictionaries omit both governance notes and all source content.
- The UI requires an explicit decision note and irreversible confirmation, exposes no automatic/bulk purge, and withholds decision buttons from the requester. These are defense-in-depth; direct calls remain bound by route, repository, row-lock, tenant, role, snapshot, and database checks.
- Application rollback cannot recover executed data. Production requires protected/immutable audit storage, authorized backup-recovery and backup-expiry procedures, RLS/least-privilege identities, alerting, legal/policy review, subject-access/export, hold administration, broader data-class dependency maps, and provider/object/Temporal/log/analytics deletion or anonymization procedures.

## Release 0.49 AI gateway controls

- AI policy reads require authenticated same-workspace access; writes require owner, administrator, or editor access at both route and repository boundaries. Clients cannot register adapters or submit provider URLs, credentials, prompts, outputs, prices, or execution commands through these APIs.
- Privacy class, adapter approval, availability, capability, tools, and context are fail-closed filters. Ranking runs only afterward. `private_local` requires a local descriptor, and no unavailable route may silently expand to cloud or an unapproved provider.
- `automatic_approved` means only a future separately approved adapter may be considered; it never overrides `maximumPrivacyClass`. Release 0.49 does not implement fallback execution, so persisted failover/cap behavior is governance intent rather than active provider authority.
- `ai_usage_event` stores numeric units, request count, latency, estimated minor-unit cost, closed capability/privacy, feature/provider/model labels, and optional hash/version references. It has no prompt, completion, message, asset, contact, credential, token secret, or provider payload column. Do not place raw content in feature/model/version/hash fields.
- Policy audits contain only closed controls, currency, optional caps, and alert percentages. Usage is not copied to audit. Reads and routing previews create no audit event and no provider/workflow/publication/outbound side effect.
- The built-in descriptor represents deterministic local grounded templates only. It does not prove that an arbitrary local model runtime is installed. Any hosted, OpenAI-compatible, Ollama-style, vLLM-compatible, or self-hosted adapter requires server-side secret storage, SSRF/egress restrictions, certificate policy, normalized behavior tests, data-processing review, cost authenticity, rate limits, telemetry redaction, health/failover rules, and incident controls before enablement.
- Budget controls use integer minor units and exact currency. Release 0.49 does not enforce caps or deliver alerts; callers must not treat saved limits, the usage summary, or `requiresApproval` as an enforcement guarantee until a transactional reservation/settlement design exists.

## Release 0.50 AI spend-authorization controls

- Reservation, settlement, and release are server-side repository boundaries requiring owner, administrator, or editor membership. The browser receives budget status only; it cannot create holds, select the audit actor, forge provider usage, or attest an external charge.
- Reservation decisions lock the workspace row before calculating settled usage plus every unexpired hold. UUID idempotency is workspace-scoped; reusing a key with different capability, feature, currency, estimate, or Campaign is rejected rather than reinterpreted.
- Daily and monthly boundaries are UTC. Active holds continue to count after crossing a boundary, preventing a long-running request from regaining spend headroom. Campaign caps are evaluated all-time against the exact tenant-bound Campaign root.
- Settlement locks the reservation, requires an active unexpired lease, caps actual cost at the reserved estimate, and writes one same-workspace linked usage row in the same transaction. Direct non-zero usage insertion is blocked at the repository boundary.
- Released, expired, and denied attempts cannot produce usage. Stale leases are treated as expired on reads and persisted as expired by the next reservation path; a late settlement fails closed.
- Spend audits contain stable IDs, closed values, integer amounts, currency, optional Campaign ID, and timing only. Feature labels, prompts, completions, messages, assets, identities, provider requests/responses, tokens, credentials, URLs, and arbitrary metadata are excluded.
- Release 0.50 provides cap-enforcement primitives, not provider authority. A future adapter still requires reviewed credentials, egress/SSRF controls, cost authenticity, safe estimation, retry/ambiguity rules, redacted telemetry, cancellation behavior, and incident response before any paid model I/O is enabled.

## Release 0.51 AI budget-alert controls

- Alert creation occurs only inside the server-owned accepted-reservation transaction. Clients cannot submit scope, percentage, committed amount, cap, currency, Campaign, source reservation, status, or creation time.
- Workspace locking plus the database composite uniqueness constraint prevents concurrent or replayed reservations from creating duplicate notices for the same scope/window/threshold/cap/currency.
- Daily and monthly keys are derived from server UTC time; Campaign keys require the exact same-workspace Campaign UUID. Same-workspace composite foreign keys prevent attaching an alert to another tenant's Campaign or reservation.
- Authenticated workspace members may read bounded alerts through the AI policy response. Acknowledgment requires owner, administrator, or editor access at route and repository boundaries; viewer and cross-workspace attempts fail closed.
- Acknowledgment is idempotent shared state and is not approval for additional spend, permission to contact a provider, evidence that every member saw the notice, or a change to the reservation/cap calculation.
- Alert and audit records store integer money snapshots, closed values, stable IDs, and timing only. They exclude feature labels, prompts, completions, messages, assets, identities, provider payloads, credentials, tokens, URLs, and arbitrary client metadata.
- Release 0.51 has no external notification channel. Email, push, webhook, scheduler, escalation, subscription, and delivery tracking require separate authentication, destination authorization, rate limiting, idempotency, retry, privacy, and incident designs.

## Release 0.52 AI spend-exception controls

- Request clients supply only workspace, exact denied-reservation UUID, and bounded justification. Capability, feature, Campaign, currency, estimated cost, exceeded scopes, and cap behavior are loaded from immutable server denial evidence.
- Requests require owner/admin/editor authority; decisions require owner/admin/approver authority at route and repository boundaries. The current release permits a user holding both role classes to decide their own request and therefore is approval gating, not enforced dual control.
- A 24-hour approval lease bounds stale authority. Internal consumption locks the workspace and request, rejects currency drift, and creates one unique linked 15-minute reservation; replay returns the same reservation.
- Browser routes cannot consume approval, choose override inputs, record usage, settle a charge, or call a provider. Approved state alone does not cause cost or data egress.
- Justification and decision note may contain confidential business context. They remain in the tenant-bound request/UI and are excluded from audit dictionaries, which retain stable IDs, closed state/scope/cap behavior, integer estimate, currency, Campaign, and consumed boolean only.
- One-time consumption cannot be reused after release/expiry. The override reservation still requires actual cost not above estimate and the ordinary transactional settlement/release path.
- Production use requires explicit self-approval/dual-control policy, assignment/delegation, revocation, notification, retention/export/erasure handling for justification text, provider-call ambiguity rules, and incident review.

## Release 0.53 AI cap-response controls

- The preview accepts only workspace and denied-reservation UUIDs. Same-workspace membership is checked before authoritative reservation loading; clients cannot submit capability, amount, Campaign, behavior, adapter, provider, model, privacy, or execution flags.
- Planning is pure and read-only. The route and server-rendered UI do not create a reservation, exception, alert, audit, workflow command, usage record, connector request, provider request, or external side effect.
- The planner receives only a server-owned `noPaidAdapters` set. Do not pass a general registry into this parameter: a descriptor's lower estimated-cost class does not prove that execution is free or that cap enforcement can be bypassed.
- Privacy, approval, availability, and capability remain hard filters inside routing. An unsupported or ineligible fallback is `unavailable/manual`; it never broadens exposure, switches to an unapproved provider, or reinterprets a denial as authority.
- `request_approval` is an instruction to use the governed Release 0.52 workflow. It does not create, approve, consume, or settle an exception. `requiresPaidReservation` remains false for every plan because paid actions are outside this contract.
- Preview output contains closed values, known descriptor metadata, stable reservation identity, limitations, and reasons. It excludes prompts, outputs, messages, assets, justification/decision text, credentials, provider payloads, and arbitrary client metadata.
- Before any fallback executor is added, define an enforced adapter billing class, cost-estimation authenticity, reservation/exception linkage, retry and ambiguous-outcome rules, egress/SSRF policy, telemetry redaction, cancellation, and incident response.

## Release 0.54 AI assistant-profile controls

- Assistant IDs, actions, capabilities, and output kinds are closed server-owned constants. Clients cannot register an agent, submit a provider/model, add tools, alter the automatic map, or grant execution authority through the AI policy API.
- Every profile and selection has literal `executionAuthority: false`. A name such as Campaign Planner or Compliance Reviewer is presentation metadata, not a user, membership, service identity, approval role, credential holder, legal determination, or autonomous worker.
- Selection is pure and does not inspect prompt/content bodies, contact identities, sensitive traits, provider payloads, credentials, or arbitrary client metadata. It emits only catalog metadata and deterministic reasons.
- The required capability must still pass gateway privacy/approval/availability/context filtering. Any paid execution must separately reserve spend or consume an approved exact exception; connector, publication, contact-safety, rights, evidence, and human-approval checks remain unchanged.
- `proposed_action` is a reviewable output kind, never permission to mutate data, start a workflow, contact a person, publish content, call a connector, or invoke a tool.
- Advanced profile/provider/model assignment requires same-workspace authorization, compatibility checks, provider allowlists, privacy and billing enforcement, audit design, safe defaults, rollback semantics, and clear separation between preference and execution authority before it may be added.

## Release 0.55 AI assistant-assignment controls

- Reads require same-workspace membership; replacement requires owner, administrator, or editor access at route and repository boundaries. Viewer and cross-workspace actors cannot change role preferences.
- The strict input contains only workspace ID and up to seven unique closed action/profile pairs. Unknown/duplicate/incompatible pairs and undeclared provider/model/execution fields fail closed.
- Compatibility requires both declared action and required capability. This prevents a profile label from changing the requested gateway capability or introducing undeclared tool use.
- Replacement is one transaction, so readers never observe a partially updated set. Same-workspace membership foreign keys preserve actor attribution; the primary key prevents duplicate action rows.
- Audit data contains only closed action/profile pairs. It excludes prompts, outputs, content, contacts, sensitive traits, provider payloads, credentials, prices, arbitrary metadata, and model/provider choices.
- Omission restores Automatic and cannot weaken privacy, spend, approval, evidence, rights, connector, publishing, contact-safety, or workflow gates. Every resolved selection still has false execution authority.
- Provider/model overrides require a separate threat model and contract for allowlists, privacy/data processing, billing/reservations, credentials, health/fallback, audit, availability drift, and incident response; they are not smuggled through assistant assignments.

## Release 0.56 AI analysis-cache controls

- The workspace ID is the first cache-key component and database foreign-key boundary. Cross-workspace content hashes can never collide into one row or summary.
- Capability, feature, content hash, model family, prompt version, and context revision are all mandatory. A partial or near key is a miss; callers must not substitute mutable display names for stable version/revision identity.
- Store requires writer authority and accepts finite acyclic JSON only. Canonical result size is capped at 256 KiB, lifetime at 30 days, hashes are lowercase SHA-256, and database checks repeat the critical bounds.
- Active first-write-wins prevents a concurrent caller from replacing a result already served under the same identity. Expiry is required before refresh; exact hit count/time update atomically.
- Cached result JSON may contain confidential derived customer data. It has no browser list/read/write API and is absent from the policy/page projection, audits, logs, and aggregate summary. Never copy result/key strings into audit or telemetry by default.
- Production requires encrypted storage/backups, result-class retention and legal hold, workspace quotas, safe purge/invalidation, incident access logging, database least privilege/RLS, and per-feature data-minimization review before caching sensitive analyses.
- Cache reuse does not authorize provider access, spend, publication, contact, workflow execution, evidence claims, or approval bypass. The caller remains responsible for every deterministic gate that would apply to a fresh result.

## Release 0.57 AI assistant work-plan controls

- Work planning consumes only server-owned profiles, assignments, policy, and adapter descriptors. Clients cannot inject provider/model URLs, prices, availability, approval, privacy, cost class, or execution flags through this projection.
- Routing repeats hard capability, privacy, approval, availability, tools, and context filters. An unavailable result stays visible and cannot broaden data exposure or switch capability/profile silently.
- Low/Medium/High is relative descriptor metadata, not a currency quote, cap preauthorization, approval, invoice, provider price, or guarantee. The API fixes currency-estimate availability false.
- Every plan fixes execution false and creates no provider/network call, cache entry, reservation, usage, approval, workflow command, connector action, publication, message, or audit event.
- A future monetary estimator requires authenticated/effective-dated rate cards, provider/model version identity, bounded input/output units, tokenizer/version handling, batch/cache discounts, rounding/minimums, currency semantics, quote expiry, and reservation linkage before users may rely on it.

## Release 0.58 AI provider rate-card controls

- Rate cards are global server-owned configuration, not tenant-authored content. No browser write route exists; workspace roles cannot approve, retire, backdate, overlap, or replace price evidence.
- PostgreSQL repeats closed status/kind/unit, uppercase currency, bounded monetary/unit integers, URL scheme, SHA-256, approval-state, effective-window, request-unit, foreign-key, and uniqueness constraints.
- Approved windows use an exclusion constraint on provider/model-family/currency plus half-open time range, preventing ambiguous current price selection while allowing exact boundary succession. Draft overlaps are never returned.
- Source references and hashes support verification but are not digital signatures. Production ingestion needs authenticated provider sources, protected administrator identity, two-person approval where appropriate, signed change evidence, immutable history, and alerts for stale/missing rates.
- Browser/API projections contain only aggregate active count, currencies, latest verification time, and false monetary-estimate availability. Components, model versions, source references, hashes, contract prices, drafts, and retired records remain server-side.
- A selected card grants no provider credential, invocation, privacy/failover override, spend reservation, approval, workflow, publication, message, connector, cache, or contact authority. Rate availability is not provider-health evidence.

## Release 0.59 AI cost-quote controls

- Currency minor-unit exponent is mandatory and database-bounded; callers cannot silently assume two decimal places for currencies whose accounting unit differs.
- Every billed non-request component requires one exact matching bounded forecast. Missing, duplicate, unused, negative, inverted, overlarge, or mismatched quantities fail the whole quote.
- Arbitrary-precision intermediate arithmetic and conservative ceiling prevent fractional component or final minor-unit truncation. Unsafe final integer ranges are rejected.
- Quotes expire quickly and never beyond their exact rate-card window. The minimized browser projection omits line prices, card/model identity, source references/hashes, drafts, and retired versions.
- `reservationRequired` is advisory when upper cost is positive. `reservationAuthorized` and `execution` are literal false; a quote cannot bypass transactional caps, spend exceptions, provider credentials, privacy/routing, approvals, evidence, rights, contact safety, or workflow gates.
- The `$0.00` local provider quote describes the registered provider charge only. UI and documentation must not represent it as zero infrastructure, labor, electricity, hosting, tax, or total operating cost.

## Release 0.60 durable quote-reservation controls

- Quote creation and reservation require owner, administrator, or editor access at both route and repository boundaries. Viewer, unauthenticated, unknown, duplicate, extra, or cross-workspace fields fail closed.
- The stored lowercase SHA-256 is recomputed from canonical security-relevant quote fields immediately before reservation. Any changed cost, forecast, line, rate identity, capability, feature, currency, or lifetime rejects the operation.
- Reservation locks the quote and workspace in one transaction. A tenant-bound foreign key and unique `cost_quote_id` prevent cross-tenant attachment and second use; same-idempotency replay returns the same reservation.
- The client cannot choose the reserved Campaign, capability, feature, currency, or amount. The server copies these from the verified quote and reserves its conservative maximum before applying existing cap and alert behavior.
- An expired or zero-cost quote cannot reserve. A denied cap decision still consumes the quote through its unique reservation row so it cannot be replayed against changed headroom.
- Policy/API projections omit rate components, unit prices, source references/hashes, canonical quote hash, credentials, and provider payloads. Quote creation/reservation never invokes a provider or grants execution, approval, publication, connector, contact, or workflow authority.
- Canonical hashing is tamper evidence, not a digital signature or defense against a database administrator who can rewrite both row and hash. Production requires least-privilege database identities, protected audit storage/backups, retention, incident review, and eventual signed evidence if quotes cross trust boundaries.

## Release 0.61 assistant metering-profile controls

- The action-quote schema accepts no capability, feature, forecast, price, provider, model, currency, execution, or reservation field. Unknown and extra inputs fail strict validation before repository access.
- Writer authorization is enforced before policy, assignment, and rate-card use. Optional Campaign tenancy is revalidated by the durable quote repository in the same way as generic quote creation.
- The server repeats ordinary assistant compatibility, capability, privacy, approval, availability, tools, context, and routing checks before considering price. A profile never broadens exposure or makes an unavailable action quotable.
- An eligible rate card must be approved/effective, use the workspace policy currency, and exactly match the routed adapter provider/model family. The repository reselects it at the quote time, closing the planning-to-persistence race.
- Token/character transformations are closed and bounded. Cached-input minimum is zero; seconds and images fail closed. Client forecasts cannot enlarge, shrink, omit, or replace the server envelope.
- Policy/UI previews and durable quote creation make no provider call and grant no reservation, approval, connector, publication, contact, workflow, or execution authority. Positive quotes still require the one-use Release 0.60 reservation boundary.
- Static planning envelopes are safe only if a future executor constrains request/output size or requotes before invocation. Production hosted execution must bind tokenizer/meter versions, actual payload bounds, provider maximum-output controls, retry semantics, and measured settlement.

## Release 0.62 quote-ledger and operator controls

- Recent reads require authenticated same-workspace membership at both route and repository boundaries. The repository filters by workspace before ordering or limiting, preventing global recent-row leakage.
- The list query is strict and bounded from 1 through 100; extra fields, invalid UUIDs, oversized limits, unauthenticated calls, and non-member reads fail closed.
- The browser projection excludes quote hash, forecasts, lines, card/provider/model identity, source evidence, creator/workspace identifiers, audit dictionaries, credentials, prompts, outputs, and provider payloads.
- Create controls exist only for quoted server-owned previews and writer roles. Reserve controls exist only for positive active unlinked quotes and writer roles; server routes repeat authorization, expiry, tamper, currency, cap, and one-use checks.
- A zero-charge quote never displays a reserve button. Expired or consumed quotes remain visible evidence but cannot be made actionable by client status changes.
- The reservation command uses a browser-generated UUID and disables concurrent clicks. Before paid production use, persist idempotency across navigation/retry so an ambiguous response can replay the same command key rather than creating user uncertainty.
- Ledger visibility and quote/reservation commands still do not grant provider, connector, publication, contact, approval, workflow, or execution authority.

## Release 0.63 routing-preference security controls

- Preference reads require same-workspace membership; replacement requires owner, administrator, or editor authorization at route and repository boundaries. Tenant-bound membership foreign keys protect creator/updater attribution.
- The strict schema accepts only workspace, one closed action, and trimmed provider/model identity. Unknown fields, duplicate actions, unknown adapters, incompatible capabilities, and client-supplied credentials, endpoints, prices, budgets, policy, or execution fields fail closed.
- Save-time validation permits only a registered approved capability-compatible exact identity. Runtime validation repeats capability, privacy, approval, availability, tools, context, and private-local constraints because stored preference is not ongoing health or policy evidence.
- Preference matching runs after hard filters. If an explicit route is no longer eligible, the action becomes unavailable; the gateway never silently falls back or broadens privacy exposure.
- Atomic replace prevents a partially updated action map. Database primary/check/length constraints and tenant-bound foreign keys repeat application invariants. Audits contain action/provider/model only and exclude secrets, prompts, outputs, content, prices, and credentials.
- UI option visibility and disabled state are presentation controls only. Server authorization, catalog compatibility, routing policy, quote authorization, and future provider-execution boundaries remain authoritative.
- A preference grants no credential access, provider call, network endpoint, spend reservation, budget exception, approval, tool access, cache payload, connector, publication, contact, message, workflow command, or execution authority.

Production provider onboarding still requires encrypted secret storage, KMS-backed rotation, protected administrator workflows, credential-to-workspace/provider binding, egress allowlists, provider health and rate-limit telemetry, deployment-aware availability, audit retention, revocation, and incident response. None is implied by the Release 0.63 preference table.

## Release 0.64 adapter-registry security controls

- The registry is global server configuration with no browser write endpoint. Workspace members can read only the safe projection after membership authorization; extra query fields fail strict validation.
- PostgreSQL closes privacy, quality, speed, cost, source, and eight capability vocabularies; bounds identity/display/context/reason fields; requires a reason for unavailable records; and prevents duplicate identities or capabilities.
- A restrictive exact provider/model foreign key prevents deletion of an adapter referenced by a workspace preference. Dynamic writer validation repeats approval and required-capability checks inside the replacement transaction.
- Every web planning path receives durable records. Cap-response fallback receives only records explicitly marked `requiresPaidReservation = false`; qualitative low cost is never treated as proof that spend authorization is unnecessary.
- API/UI projections contain routing metadata and timestamps only. They omit API keys, OAuth tokens, secrets, endpoints, account IDs, request/response bodies, rate components, source evidence, prompts, content, outputs, cache payloads, and invocation methods.
- Approval and availability are necessary routing filters but not credentials, health guarantees, privacy overrides, spend reservations, workflow permissions, or execution authority. A record alone cannot call a provider.
- The seeded local adapter is explicitly built-in and no-paid; migration-managed administrator records remain metadata-only until separate credential, health, pricing, and executor boundaries exist.

Production registry administration needs protected global roles, two-person approval where appropriate, append-only change audits, signed configuration provenance, environment/deployment scope, health-check identity and staleness rules, emergency disable, credential/account binding, egress policy, and rollback history before hosted-provider activation.

## Hosted-provider credential controls (Release 0.65)

- Credentials are encrypted at rest with AES-256-GCM authenticated `v1` envelopes under `AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY`, a dedicated server-only 32-byte base64 key. A lowercase SHA-256 fingerprint supports rotation detection but is also secret-derived and never public.
- Strict schemas accept only OpenAI, Anthropic, or Google Generative AI and a bounded API-key string. Workspace membership protects reads; writer authorization protects save, rotate, and revoke operations.
- List, policy, UI, and audit projections exclude ciphertext, fingerprint, API key, token, and secret values. Inputs clear after mutations. Audit evidence records only provider, state, rotation/erasure facts, and literal false execution/credential-return flags.
- Saved and rotated keys remain `unverified`. A configured connection does not register or enable an adapter, identify an account, discover capabilities, authorize spend, or permit a provider call.
- Revocation row-locks the connection and erases ciphertext, fingerprint, and key version before committing the `revoked` state. Replay is idempotent and cannot create duplicate revocation audit evidence.
- Live acceptance used fake QA-only values, confirmed ciphertext/plaintext separation and safe response shapes, and removed all QA rows. No real provider credential was used and no provider request occurred.

Before production credential onboarding, add managed KMS/HSM custody and envelope-key rotation/re-encryption, least-privilege administrative access and monitoring, secret scanning, CSRF and abuse-rate controls, provider-specific verification with strict timeouts and redacted errors, egress allowlists, data-residency review, and a documented incident/revocation procedure. A verifier must never log keys or provider response bodies and must not perform billable generation merely to establish health.

## Provider-verification security controls (Release 0.66)

- Verification is writer-triggered and accepts only workspace identity plus a closed provider path. Clients cannot submit a key, URL, header, model, timeout, claimed status, or provider response.
- Egress is fixed to the official HTTPS model-list URL for OpenAI, Anthropic, or Google. Credentials use headers only; requests have no body, redirects fail, caching is disabled, and an abort signal enforces a five-second bound.
- The server cancels every response body and never parses, logs, returns, audits, or persists provider catalog/error content. HTTP and network outcomes map to predetermined messages that cannot echo a key or upstream response.
- The encrypted target is writer-only. Decryption occurs immediately before fetch, and the local plaintext variable is cleared after the verifier returns. APIs and audits retain only the safe connection projection and false credential/provider-response/generation/execution flags.
- Result persistence uses the original server-only fingerprint in the update predicate. Rotation or revocation during the request causes a 422 stale-result failure rather than letting old evidence overwrite the new credential state.
- A Verified state proves only point-in-time acceptance by the metadata endpoint. Adapter availability, capability, pricing, privacy policy, spend, and execution remain independent and false.

Production hardening still needs KMS/HSM-backed decrypt authorization, strict DNS/egress enforcement resilient to resolution changes, per-workspace/provider rate limiting, retry/backoff and circuit breaking, health staleness/expiry, security telemetry without secrets, provider-status correlation, and provider-specific incident/revocation runbooks. Provider verification must remain non-generative.

## Known security work

- Select and integrate the production identity provider.
- Add CSRF-origin enforcement for cookie-authenticated JSON mutations and rate limits for login/OAuth endpoints.
- Add KMS-backed credential re-encryption and rotation.
- Add RLS policies and automated cross-tenant tests.
- Restrict webhook ingress to published provider network ranges where operationally practical and add Microsoft rich-notification JWT validation if encrypted resource data is enabled.
- Add dependency, secret, SAST, migration, and container scanning in CI.
- Configure production Temporal mTLS/API authentication, namespace isolation, encrypted payload codecs, retention, and worker identity before sending customer Campaign data.
- Add measurement-key TTL policy, source/Destination scopes, per-key rate limits/quotas, signed provider webhook validation, retention aggregation, and abuse alerting before public conversion ingestion at scale.
- Add IP/device/workspace rate limits and abuse alerting to pairing and worker endpoints; add pairing-attempt audit events and automatic expired-code/job cleanup.
- Add production native code signing, protected updater keys, signed update manifests, staged rollout/rollback, build provenance/SBOM, and macOS notarization before desktop distribution.
- Add Playwright only as a separately packaged, versioned sidecar with domain/action/account policy, visible traces, screenshot retention, rapid disable, challenge handoff, and per-workflow capability manifests. Never expand the current command into generic shell execution.
- Add secure local credential migration/rotation, disconnect/unpair UX, local configuration integrity handling, background-service identity, and cross-platform keyring failure recovery.
- Add a production malware-scanning/quarantine adapter, encrypted/versioned S3-compatible storage, tenant prefixes/policies, signed-download rate limits, object garbage collection, media-worker isolation/timeouts, and dependency/codec patch monitoring.
- Add rights evidence, transformation permissions, expiry/embargo checks, and immediate pre-execution validation before any media-capable connector may publish an asset.
- Define retention, deletion, export, legal hold, and incident-response procedures before production data.
- Define relationship/contact consent sources, suppression retention, subject-access/export, identity-link review, and deletion/anonymization policy before importing real inbox or CRM identities.
## Provider model-inventory controls (Release 0.67)

Discovery is explicit, writer-only, Verified-only, fixed-egress, header-authenticated, and size/count/time bounded. Streaming enforcement and strict parsers reject unsafe or partial data. Stored IDs are workspace-private; fingerprints and raw responses remain server-only/discarded; audits contain counts only. Fingerprint comparison plus row locking prevents stale replacement, and rotation/revocation retires active records. Inventory grants no adapter, capability, price, spend, generation, or execution authority.

## Adapter-candidate governance controls (Release 0.68)

- Tenant isolation is structural: every candidate references an exact workspace/provider/model inventory key, and submitter/reviewer references include the same workspace. Repository reads and writes repeat membership checks inside database transactions.
- Submission requires writer authority; approval/rejection requires `owner` or `admin`. The decision route checks the explicit role and the repository repeats authorization, preventing a client/UI-only privilege boundary.
- Approval is fail-closed on credential drift. The connection must remain Verified, the model active, and all current/source fingerprints equal. Credential save/rotate/revoke and inventory disappearance retire pending/approved candidates automatically.
- Capability input is a unique subset of the closed eight-value gateway vocabulary. Quality, speed, cost, status, privacy, paid-reservation behavior, context limit, evidence length, review-note length, and SHA-256 syntax are enforced in both schemas and database checks where applicable.
- Evidence references are workspace-private text, displayed without automatic navigation. Evidence hashes permit later integrity comparison but do not prove publisher authenticity or content correctness; administrators remain responsible for review.
- Candidate list/submit/decision responses carry literal false routing, adapter-activation, and execution flags. No candidate write touches the global adapter registry, rate cards, routing preferences, credentials, spend reservations, provider endpoints, or invocation code.
- Audit events deliberately omit model identifiers, evidence references/hashes, capabilities, and credential fingerprints. They retain provider, transition, aggregate retirement count/reason, and explicit false authority flags.
- Rejected/retired resubmission cannot bypass current-evidence validation. Pending/approved duplicates are rejected, and decision updates require pending state, preventing replayed approval/rejection transitions.
- Live acceptance used only a fake encrypted credential and fixture models. Verified state was simulated directly for QA; no real provider authentication, catalog discovery, generation request, or billing event occurred. Revocation erased credential material and cleanup removed all fixture and audit rows.

Production follow-up requires trusted evidence retrieval/archival, malware/content scanning for retained evidence, evidence-source allowlists, reviewer separation-of-duty policy, approval notifications, candidate retention/deletion policy, deployment registration with independent authorization, hosted rate-card binding, health/staleness enforcement, KMS-backed credential custody, and end-to-end provider invocation/settlement controls before any hosted candidate can execute.

## Deployment-staging security controls (Release 0.69)

- Registration is tenant-bound by candidate, workspace/provider/model, and administrator-membership foreign keys. Member reads and administrator mutations repeat authorization inside repository transactions.
- Only owners and administrators can register or retire. Editors may propose candidates but cannot cross the deployment-staging boundary; route checks are backed by repository checks.
- Registration repeats Approved state, active inventory, Verified connection, and three-way fingerprint continuity under row lock. It never trusts client-supplied provider/model/capability/routing fields.
- Credential change/revocation and inventory disappearance retire affected registrations automatically. Retirement carries actor, bounded reason, time, and aggregate audit evidence, preventing stale snapshots from appearing current.
- Safe projections exclude source fingerprints. Audits exclude model IDs, capabilities, and fingerprints and carry literal false routing/activation/execution fields.
- Registrations never enter the global adapter registry or routing pipeline and cannot bind rates, create preferences, reserve spend, invoke providers, publish, message, mutate workflows, or settle usage.
- Strict schemas reject extra fields and unknown IDs. Malformed or empty JSON is normalized to 422 without logging parser stack traces; unauthenticated valid reads return 401.
- Live acceptance used only a fake encrypted credential, simulated Verified state, and fixture inventory. It proved manual and automatic retirement, registry invariance, cryptographic erasure, zero browser errors, and complete cleanup without provider I/O.

Before activation, add independent deployment-operator authorization, invocation-adapter configuration and code review, tenant-specific endpoint/account binding, hosted rate-card evidence, scheduled health/staleness/circuit breaking, spend preauthorization, response bounds/redaction, usage reconciliation, incident controls, and a kill switch.

## Hosted pricing-evidence security controls (Release 0.70)

- Bindings are tenant-bound through registration/workspace and rate-card/currency constraints. Member reads and owner/administrator mutations repeat authorization in repository transactions; editors and viewers cannot bind or retire.
- The browser submits only registration and rate-card UUIDs. The server derives provider, model family, currency, exponent, components, effective window, source reference/hash, and actor evidence from authoritative rows.
- Binding repeats Registered, Approved-candidate, active-inventory, Verified-connection, three-way fingerprint, exact provider/model, Approved-card, effective-window, and source-integrity checks. A presentation filter cannot bypass repository enforcement.
- Pricing projections never expose credentials or fingerprints. Audits omit model IDs, rate-card IDs, source references/hashes, components, and credential fingerprints while retaining provider/currency, lifecycle, aggregate counts, and explicit false-authority flags.
- Manual registration retirement and automatic credential/inventory drift retire bound pricing atomically. A later re-bind must repeat every current check; stale evidence cannot regain readiness merely because the old row remains retained.
- Source links and hashes are evidence for administrator review, not proof of publisher identity or price correctness. Production price ingestion still requires trusted retrieval, allowlists, archival, integrity verification, and change-review policy.
- `pricingReady` cannot grant routing, adapter activation, availability, invocation, reservation, provider network access, usage recording, publishing, messaging, workflow mutation, or settlement. Those values remain literal false in API/domain projections.
- Strict schemas reject extra authority-shaped fields; malformed/empty JSON becomes 422 without parser stack output, and valid unauthenticated operations return 401. Live acceptance used only fake credentials and fixtures, observed zero browser errors, proved erasure, and removed all scoped test/audit rows.

Before hosted execution, require separately reviewed invocation code, tenant endpoint/account binding, scheduled health and staleness, circuit breakers, deployment/operator separation of duties, KMS custody, spend preauthorization, bounded/redacted responses, actual-usage reconciliation, settlement idempotency, monitoring, incident response, and a global kill switch.

## Invocation-contract staging security controls (Release 0.71)

- Contract descriptors are seeded server-owned rows; clients cannot create or mutate keys, versions, transport, credential mode, schemas, source hashes, or implementation state. A database check fixes implementation availability to false.
- Tenant configuration is owner/administrator only, repeats authorization in the repository, and requires current registration, candidate, inventory, connection, fingerprint, pricing, effective-window, source-hash, and exact-provider contract evidence under lock.
- Restrictive composite foreign keys bind configuration to the same workspace/provider registration and the exact pricing row for that registration. A browser UUID cannot substitute cross-tenant or cross-provider lineage.
- Safe projections and audits exclude credentials/fingerprints and minimize model, contract, pricing, and source identifiers. All response surfaces retain literal false implementation, health, routing, activation, and execution fields.
- Pricing retirement retires invocation configuration. Registration, credential, and inventory drift cascade automatically; reconfiguration repeats every prerequisite check, so retained history cannot silently become current.
- Contract source hashes protect internal descriptor integrity but do not prove external API compatibility. No provider endpoint, request body, response body, network call, health result, usage event, or billing event exists in this release.
- Strict schemas reject extra authority-shaped fields, malformed/empty JSON returns 422 without parser stacks, and valid unauthenticated operations return 401. Live QA used only fake credentials and fixtures, proved erasure, logged zero browser errors, and removed all scoped rows.

Before implementation availability can change, require reviewed serializers/parsers against primary provider specifications, tenant endpoint/account controls, KMS credential injection, bounded requests/responses, non-generative health probes, staleness and circuit breakers, deployment approval, spend reservation, reconciliation, observability, incident controls, and kill switch.

## Provider-reachability security controls (Release 0.72)

- Only owners/administrators may probe, and repository checks require current invocation, registration, candidate, inventory, Verified connection, fingerprint, pricing, effective window, and contract evidence both before and after the request.
- Credentials are decrypted only server-side, passed in provider-required headers to fixed HTTPS model-list URLs, cleared from the local reference, and never returned, logged, or persisted in observations.
- Requests are GET-only, bodyless, no-cache, redirect-failing, five-second bounded, and response bodies are cancelled/discarded. No generation endpoint or model prompt is used.
- Observations store only closed status/failure, safe message, private comparison hashes, actor, and times. Safe projections/audits omit fingerprints, model/contract/pricing IDs, and provider responses.
- Five-minute expiry plus configuration-time/fingerprint/hash comparisons makes evidence stale after reconfiguration or drift. Healthy reachability cannot change literal false implementation health, routing, activation, or execution.
- Live QA intentionally used a fake key and recorded only `credential_rejected`; erasure and scoped cleanup were verified. Production still needs KMS/HSM custody, scheduled jittered probes, rate-limit protection, circuit breakers, telemetry/redaction review, incident response, and kill switch.

## Provider text-codec security controls (Release 0.73)

- Request builders accept no endpoint, header, credential, tool, media, stream, tenant, or authority field. Provider and model are validated against closed/syntactic bounds, text lengths are capped, and output tokens must be a positive safe integer no greater than 16,384.
- OpenAI requests force `store:false` and `stream:false`; Anthropic requests force non-streaming text blocks; Google requests contain only text parts and generation bounds. No codec performs I/O or logging.
- Raw responses are limited to one mebibyte before JSON parsing. Item counts and aggregate visible text are bounded; token counts must be non-negative safe integers; response IDs are optional and length-bounded.
- Parsers reject provider error/non-final envelopes, tool/function/executable blocks, Anthropic continuation/tool stops, Google multi-candidate output, Google thought parts, and mixed OpenAI refusal/text. OpenAI reasoning items are ignored and never exposed.
- Canonical contract hashes are verified in tests. Migration 0066 retires v1, requires codec state consistency, and keeps the original database invariant that `implementation_available=false`. Old bindings fail current-contract checks.
- Safe normalized results explicitly state no raw-response storage, tool use, streaming, or execution. The UI distinguishes reviewed codec availability from transport implementation and continues to show health readiness, routing, activation, and execution as false.
- Live acceptance made no provider request, used no credential, wrote no QA row/audit, found no generation route, and recorded zero browser errors.

Before provider generation, add fixed allowlisted endpoints and headers, KMS/HSM credential custody, tenant endpoint/account controls, reservation-before-request transaction design, timeout/retry/idempotency/circuit-breaker policy, content and logging redaction, response retention rules, actual-token reconciliation, settlement idempotency, monitoring, incident response, and a global kill switch.

## Fixed provider text-transport security controls (Release 0.74)

- Endpoint and header selection is a closed provider switch. Callers cannot supply or override a URL, query key, header, HTTP method, redirect mode, cache mode, request body shape, or retry count.
- Credentials must be trimmed, non-empty, and at most 4,096 characters; they are placed only in `Authorization`, `x-api-key`, or `x-goog-api-key`. Tests prove the key is absent from URL and JSON body.
- The transport performs exactly one POST with redirect error and no-store, using a 30-second default timeout and 60-second hard maximum. Network and abort details are replaced with safe closed messages.
- Non-success bodies are cancelled/discarded. Success requires JSON content type, declared and streamed one-mebibyte ceilings, fatal UTF-8 decoding, and the provider-native codec's structural/text bounds.
- Raw bodies, headers, keys, provider error details, prompts, and URLs are never returned or logged. Parser/content/size failures collapse to `unexpected_response`; status classes use only the closed failure vocabulary.
- Migration 0067 retires v2 and requires transport state consistency on v3. Source hashes are test-verified, and implementation availability remains database-fixed false.
- No route imports the transport; live acceptance performed no provider call and wrote no QA/audit data. The absence of a generation route was verified at 404.

Before route activation, require server-only KMS/HSM decryption, tenant/account checks, post-await drift validation, durable invocation idempotency, reservation-before-I/O, ambiguity handling, health/circuit policy, minimized audit/telemetry, actual usage reconciliation, settlement, incident response, and a global kill switch.

## Internal implementation and health-readiness security controls (Release 0.75)

- Database implementation availability may be true only when codec and transport are true and a bounded implementation version is present. V4 is Approved; all older generations are retired and cannot silently inherit readiness.
- Configuration requires current tenant deployment/pricing/credential evidence plus Approved same-provider codec, transport, and implementation metadata under row lock. Browser IDs cannot bypass the repository conjunction.
- Health probing and observation recording repeat implementation/codec/transport and all existing tenant/hash/fingerprint prerequisites before and after provider I/O.
- `healthReady` is never accepted from a client or stored. It is computed only from reviewed implementation plus fresh healthy current evidence; unhealthy, stale, pre-configuration, mismatched, or retired evidence fails closed.
- Internal implementation availability grants no route, router membership, adapter activation, spend reservation, provider-call permission, output storage, usage event, settlement, publishing, messaging, or workflow mutation.
- Safe audits distinguish implementation true from health state but omit model/contract/pricing IDs, source hashes, credential fingerprints, request/response bodies, and keys. Routing/activation/execution remain false.
- Live acceptance made no generation request, used no real key, created no QA/audit data, verified absent generation route 404, and had zero browser errors.

Before public invocation, require a durable idempotent intent/attempt ledger, explicit authorization and assistant/action binding, exact reservation-before-I/O, KMS/HSM key handoff, post-await drift checks, ambiguous-outcome handling, output retention/redaction rules, actual usage reconciliation, atomic settlement/release, circuit/kill controls, and incident response.

## Durable text invocation-intent security controls (Release 0.76)

- Preparation requires workspace writer authority and a same-tenant chain of current registration, candidate, inventory, credential, pricing, implementation, health, quote, and reservation evidence under row locks.
- Composite foreign keys bind the invocation provider and exact reservation/quote to the workspace. Unique reservation and idempotency constraints prevent double intent creation and quote substitution.
- System and user text are bounded using the provider codec limits, hashed in server memory, and never persisted. Safe projections and audits omit prompt text, prompt hashes, request hash, contract hash, and credential fingerprint.
- The stored credential fingerprint and contract hash are comparison evidence only. Any drift makes `authorizationCurrent=false`; neither value is returned to a browser.
- Cancellation records a bounded reason and workspace actor, and releases an active reservation in the same transaction. It cannot settle spend or create usage.
- Routes do not import or call the provider transport. There is no generation endpoint; live acceptance confirmed 404, no QA rows, and zero browser errors.
- `providerRequest`, `outputStored`, `usageRecorded`, `settlement`, `routingAvailable`, and `execution` remain literal false in every public intent projection and minimized audit.

Before provider I/O, add a durable one-billable-attempt state machine, encrypted server-only credential handoff, post-await evidence revalidation, ambiguous outcome handling, response minimization/retention policy, actual usage reconciliation, settlement idempotency, circuit breaker, global kill switch, monitoring, and incident response.

## Exactly-once provider-attempt security controls (Release 0.77)

- A unique intent foreign key enforces at most one attempt. Claim commits before I/O and repeats every current authorization and exact prompt-hash prerequisite under row locks.
- Credentials remain encrypted in persistence, are returned only by the server-private claim target, decrypted only in the internal executor, passed only to fixed header transport, and cleared from the local reference in `finally`.
- No retry exists. Transport errors, timeouts, unsafe responses, post-call evidence drift, late success, and abandoned claims become ambiguous because provider receipt cannot be disproved.
- One-minute claim expiry supports reconciliation without pretending a crash was safe. Ambiguous reservations remain held until normal expiry or later explicit operator policy.
- Success stores only SHA-256 output/provider-ID evidence, closed stop reason, and bounded counters. Raw prompt/output, provider ID, key, source hashes, fingerprints, or bodies never enter safe records.
- The executor has no public route. The only new route is strict membership-checked safe reading; unauthenticated access returned 401 and generation remained 404.
- Usage events and settlement are intentionally absent, so token counters cannot yet create charges or release money.

Before workflow use, add governed output-artifact persistence/redaction, exact provider-billing reconciliation, atomic reservation settlement/release, operator ambiguity resolution, circuit breaker, global kill switch, monitoring, and incident response.

## Encrypted output and reconciliation security controls (Release 0.78)

- Successful text is encrypted before repository finalization and stored only as a versioned AES-256-GCM envelope. Plaintext is present only in request-scoped server memory for encryption, length, and SHA-256 calculation; the executor no longer returns it.
- Attempt completion, encrypted artifact insertion, usage insertion, reservation settlement, reconciliation, and minimized audits share one transaction. Partial success cannot expose output without its attempt evidence or charge usage without its reconciliation row.
- Member list projections omit plaintext, ciphertext, output hashes, provider response identifiers, source hashes, and credential fingerprints. Output decryption requires both API-level and repository-level owner/administrator/approver checks.
- Review decisions require a bounded note, are terminal, and grant no publishing, Draft, connector, routing, workflow, or execution authority. Discarded artifacts are unavailable from the decrypt route.
- Exact cost reuses approved effective source-hashed rate evidence and conservative integer ceiling. Missing usage, unsupported pricing units, or cost above authorization fails closed to quarantine and leaves the reservation unsettled.
- One-attempt unique constraints cover output, reconciliation, and usage. Generic settlement explicitly rejects a reservation attached to a text intent, closing an alternate settlement path.
- Audits contain lifecycle, provider, status/reason, and Boolean settlement evidence only. They exclude output, ciphertext, hashes, prompts, credentials, model identifiers, and private pricing lineage.
- Strict schemas reject extra authority-shaped fields. Live acceptance proved unauthenticated output/attempt reads return 401, absent generation returns 404, and the UI produces no console warning or error.

Before product workflow activation, add separate KMS/HSM keys and rotation/re-encryption policy for output, content moderation and retention/erasure policy, accepted-artifact-to-Draft lineage, operator quarantine/ambiguity resolution, circuit breaker, global kill switch, monitoring, and incident response.

## Accepted-output Draft proposal security controls (Release 0.79)

- Attachment requires writer authority, an accepted artifact, one same-workspace editable Draft, and its exact current working/changes-requested version under locks.
- One artifact can bind to only one proposal. Composite foreign keys enforce same-workspace artifact/Draft and exact source-version ownership.
- Safe proposal lists exclude plaintext, ciphertext, hashes, credentials, pricing, and evidence payloads. Writer decrypt requires the proposal, artifact acceptance, source version, and editable Draft to remain current.
- Attaching, reading, or dismissing never changes Draft content, claim arrays, status, approvals, previews, publishing, routing, or execution.
- Dismissal is terminal, reasoned, attributed, and audited without output or private lineage. A stale source automatically fails closed for decryption.

Before proposal application, require field-level selection, evidence-claim comparison, deterministic reconstruction, immutable successor lineage, explicit author confirmation, and the existing Draft approval path.

## Evidence-preserving proposal application controls (Release 0.80)

- Application requires workspace writer authority and locks the proposal, accepted artifact, Draft, and exact source version in one transaction. Dismissed, stale, non-accepted, non-current, and non-editable records fail before any Draft write.
- The client cannot submit a replacement body, claim list, evidence mapping, version identity, lifecycle state, actor, time, provider output, publishing flag, or execution flag. Strict schemas reject extra keys.
- Provider output remains visible only through the existing request-scoped decrypt route while the proposal is attached and current. Application never parses, stores again, or copies that plaintext; after application the decrypt target is unavailable.
- The server selects factual claims exclusively from `content_draft_claim` rows with evidence bindings on the exact source version. It reconstructs normalized punctuation deterministically and inserts new claim/evidence rows under the successor in the same transaction.
- At least one author-entered presentation field must differ. Selected fields are derived server-side and constrained to `lead_in`, `call_to_action`, `hashtags`, and `alt_text`; all values and the required change note are bounded.
- The source version becomes superseded and the new version working atomically with the Draft pointer and terminal proposal record. Transaction rollback prevents partial lineage, orphaned claims, or an applied marker without a successor.
- Applied and dismissed states are mutually exclusive. Applied proposals are replay-safe, immutable, undecryptable, and cannot be dismissed; a retry returns the original successor rather than creating a second one.
- Application does not submit for approval, approve, create a channel preview, publish, send, route, invoke a provider, settle spend, or mutate a workflow. Normal Draft approval remains mandatory and `publishingAuthorized`/`execution` remain false.
- Audit data contains provider, terminal status, and minimized Boolean mutation evidence. It excludes output, ciphertext, prompt, body, claims, evidence IDs, hashes, credentials, pricing lineage, and selected presentation content.

Remaining production controls include output-key KMS/HSM rotation, moderation and retention policy, ambiguity/quarantine operator resolution, circuit breaker, global kill switch, monitoring, incident response, and real identity-provider deployment.

## AI execution stop and provider circuit controls (Release 0.81)

- Provider calls require the deployment flag, an unexpired workspace enablement, and a closed provider circuit. Every missing/unknown/expired state fails closed.
- `AI_PROVIDER_EXECUTION_ENABLED` is server-only and defaults false. The internal executor checks it before claim, so deployment stop cannot create a claimed attempt or decrypt a credential.
- Workspace enable/stop and circuit reset require owner/administrator authorization at both route and repository boundaries. Every action requires a bounded reason/note and emits a tenant-bound audit event.
- Enablement is time-limited to at most 24 hours. Expiry is checked against the repository `asOf` time on claim and completion; stale enabled labels do not imply `executionAllowed`.
- Control-row locks serialize stop with claim and completion. If stop wins before finalization, returned provider text is discarded into `evidence_changed`; no encrypted artifact, hash, billing record, settlement, or output projection is stored.
- A known credential decryption failure opens the circuit immediately. Three consecutive unknown/abandoned outcomes open it. Success resets the counter. Local evidence drift is not counted against provider health.
- Open circuits are persistent and have no automatic half-open request. Human review plus a reasoned administrator reset is required, preventing unattended request bursts after a cooldown.
- Circuit records contain only provider, closed failure codes, counts, attempt lineage, and timestamps/reset attribution. Audits exclude prompts, plaintext, ciphertext, credentials, fingerprints, provider response IDs, token counts, pricing, and outputs.
- Strict database checks bind states to their required fields, actors to workspace membership, and providers/failure codes to closed vocabularies. New claims recheck the full existing credential/model/contract/health/spend evidence in addition to the new control gates.
- The UI displays only safe operational state. A green effective state requires all gates; workspace enablement cannot override a deployment stop or open circuit.

Remaining controls before product activation include managed KMS/HSM custody and rotation, production monitoring and paging, incident runbooks and ownership, moderation and erasure policy, operator ambiguity/quarantine resolution, and real identity-provider deployment.

## Reviewed ambiguity and quarantine resolution controls (Release 0.82)

- Resolution never invokes or retries a provider. Every record permanently projects `providerRequestRetried=false` and `retryAllowed=false`; an ambiguous attempt remains single-use.
- Only owner, administrator, or approver roles may resolve, with independent API and repository authorization. Members may view the safe ledger but cannot mutate it.
- Eligibility is limited to ambiguous attempts and succeeded attempts with quarantined reconciliation. Known failures, normally reconciled successes, and attempts with a usage event fail closed.
- `confirmed_no_charge` requires explicit operator evidence and stores no amount. `settled_provider_charge` requires an exact positive provider-statement amount. Money is never derived from missing tokens, and tokens are never derived from money.
- One immutable row per attempt/reservation/reconciliation makes replay safe and conflicting reconsideration non-mutating. Composite foreign keys bind every record and actor to the workspace.
- Hold transitions share the resolution transaction. Generic release of text holds is blocked. A known credential decryption failure releases only because it occurs before provider I/O.
- Usage and budget projections include exact reviewed charges but expose zero known token units and null latency. Quarantine can become financially settled without falsely claiming a usage event.
- Safe audits record disposition, provider, state transition, exact-charge presence, and usage/retry Booleans. They exclude evidence/note content, prompts, output, ciphertext, credentials, provider response IDs, hashes, token estimates, and private pricing lineage.
- Resolution does not reset an open provider circuit or override deployment/workspace execution stops. Incident accounting and provider-health recovery remain separate decisions.
- Strict schemas reject extra authority-shaped fields. Live acceptance proved unauthenticated mutation 401, unknown route 404, and no reviewed-incident UI browser warning or error.

Remaining production controls are managed KMS/HSM custody and rotation, monitoring and alert delivery, incident runbooks and ownership, moderation/retention/erasure policy, and production identity. Public execution remains absent.

## AI operational observation and acknowledgement controls (Release 0.83)

- Active incidents derive only from authoritative open circuits, overdue or terminal ambiguous attempts without resolution, and quarantined reconciliations without resolution. Clients cannot create, close, reprioritize, or relabel an incident.
- Claimed attempts become visible once their reconciliation deadline passes even before recovery mutation. They use the same attempt/type identity after terminal `claim_abandoned`, preventing an observation gap.
- Severity and summaries are closed server mappings. Prompt, plaintext, ciphertext, credential, fingerprint, provider response, output hash, token estimate, price lineage, and arbitrary failure text are absent.
- Incident reads require workspace membership. Acknowledgement requires owner, administrator, or approver at both route and repository layers and a trimmed 3-1,000-character note.
- Attempt plus reconciliation/circuit locks serialize acknowledgement with resolution/reset. The active set is re-derived after locks, so a concurrently closed condition cannot receive a stale acknowledgement.
- Unique workspace/type/attempt storage makes acknowledgement immutable and replay-safe. A reopened circuit must name its new opening attempt and cannot inherit ownership evidence from an earlier incident.
- Acknowledgement means ownership only. It does not resolve ambiguity/quarantine, reset a circuit, enable execution, decrypt a credential/output, release/settle spend, create usage, retry a provider request, or authorize publishing/workflow behavior.
- Readiness stays blocked for any critical or unacknowledged condition and recommends execution remain stopped for every active condition. This is observation metadata; Release 0.81 controls remain the enforced provider gate.
- Audit includes type, severity, provider, note-presence, active state, retry false, and authority false. It excludes acknowledgement-note content and all private provider/content/billing evidence.
- External alert delivery and public execution are literal false in API/readiness metadata. Live acceptance confirmed 401 without a session, 404 for unknown route, and zero UI browser warnings/errors.

Production still requires managed KMS/HSM key lifecycle, actual paging delivery and escalation ownership, incident runbooks, moderation/retention/erasure policy, production identity, and a separately reviewed product execution route.

## AI incident-response target and runbook controls (Release 0.84)

- Only owner/administrator may save policy; all members may read effective targets/runbook alongside active incident evidence. Repository authorization remains independent of route checks.
- Database, repository, and API enforce bounded integer targets and require resolution not precede acknowledgement. Missing policy projects conservative documented defaults rather than disabling deadlines.
- Runbook input must use HTTPS, contain no URL username/password, be trimmed, and fit 2,000 characters. The server never fetches it, so configuration cannot trigger SSRF or secret transmission.
- Audit omits the runbook URL and records only numeric targets plus presence. Policy contains no pager token, webhook secret, credential, prompt, output, provider response, billing evidence, or execution flag.
- Deadlines derive from immutable incident source time and explicit request time. No browser clock decides readiness and no background mutable timer can silently close or escalate a source record.
- Late acknowledgement remains visible even after ownership is recorded. Resolution-overdue takes precedence until circuit reset or reviewed incident resolution removes source activity.
- Policy save cannot create/close/acknowledge an incident, reset a circuit, retry a provider, enable execution, decrypt content/credentials, release/settle spend, create usage, or publish.
- Readiness remains blocked for critical, unacknowledged, late, or resolution-overdue evidence. Acknowledged noncritical work within target remains attention; only source closure yields ready.
- API metadata keeps `executionAuthority=false` and `externalAlertDeliveryConfigured=false`. Live acceptance confirmed unauthenticated GET/PUT 401, unknown route 404, and zero UI browser warnings/errors.

Production still requires actual alert/paging delivery and escalation ownership, managed KMS/HSM key lifecycle, moderation/retention/erasure policy, production identity, and a separately reviewed product execution route.

## Signed AI operational alert controls (Release 0.85)

- Outbound delivery is deployment opt-in. `AI_OPERATIONAL_ALERT_ENCRYPTION_KEY` must be a separate 32-byte base64 key and `AI_OPERATIONAL_ALERT_ALLOWED_HOSTS` must list exact approved receiver hostnames; an empty allowlist prevents configuration and delivery.
- Endpoint validation rejects HTTP, credentials, custom ports, query strings, fragments, and subdomain/wildcard assumptions. Transport uses manual redirect mode, so a receiver cannot redirect Market Me to an internal or newly chosen destination.
- Signing secrets are encrypted before persistence, never returned, fingerprinted only for optimistic evidence, and decrypted only for administrator verification or a claimed worker delivery. Audit records origin/status and presence—not path, secret, fingerprint, or payload.
- Every body is signed as `HMAC-SHA-256(timestamp + "." + rawBody)` and sent with versioned signature, timestamp, stable event ID, and identical idempotency key. Receivers should verify the raw bytes, reject stale timestamps, and deduplicate the event ID before side effects.
- Verification sends a closed test payload and only 2xx enables delivery. Saving/rotating resets unverified; a stale fingerprint cannot enable newer configuration. Explicit disable prevents claims while retaining queued evidence.
- The outbox is tenant-bound, payload-limited to 32 KiB, lease-claimed with row locks, retried at most five times, and uses the same event ID after uncertain outcomes. 3xx/most 4xx/config/secret failures dead-letter; 408/425/429/5xx/network uncertainty retry safely.
- Alert payloads contain safe incident summaries and deadlines only. They exclude prompts, outputs, credentials, secret hashes, raw provider responses, acknowledgement notes, private pricing evidence, and any execution token or authority.
- Member-facing reads expose origin only and literal redaction flags. Configuration mutation/verification/disable require owner/administrator; history requires membership. All new routes return 401 without a session.
- Webhook delivery never invokes/retries an AI provider, resets a circuit, acknowledges/resolves an incident, changes spend, or enables execution. Release 0.81 deployment/workspace/circuit gates remain authoritative.

Production still requires KMS/HSM-backed rotation and revocation procedures, receiver replay-window enforcement, outbound network egress controls/DNS monitoring, operational ownership, retention/erasure policy, and production identity. The current exact host allowlist is a deployment trust decision, not a general-purpose arbitrary webhook proxy.

## Exact prepared-intent execution controls (Release 0.86)

- The execute surface is authenticated, same-workspace, and writer-only. The route overwrites any body ID with the path ID before strict validation, preventing path/body substitution and rejecting unknown client fields.
- Execution is fail-closed unless the server has a valid 32-byte base64 `AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY` (the AI vault key, isolated from connector and alert keys), deployment execution is enabled, the workspace's time-limited control is active, the provider circuit is closed, and every stored intent/quote/reservation/adapter/credential/rate/health fingerprint remains current. The AI vault key encrypts both provider credentials and output envelopes in this release.
- The client supplies only the original bounded prompt and intent identity. Prompt plaintext is used transiently to reproduce hashes and is not persisted, audited, or returned. Credentials decrypt only after the durable single-attempt claim and remain in a request-local `apiKey` reference.
- Exactly one fixed provider call is permitted. There is no retry flag, generic provider URL, client-selected header, model, credential, price, timeout, or provider-request body. Duplicate/substituted intent execution fails before I/O because the attempt and prompt authorization are single-use and exact.
- A credential-open failure known to occur before transport is safely failed/released and opens the circuit. After transport starts, network uncertainty or an in-flight authorization stop becomes ambiguous and non-retryable; retained hold/evidence drives the existing incident, acknowledgement, alert, and reviewed-resolution flow.
- Successful plaintext is encrypted before finalization. Normal responses contain neither plaintext nor ciphertext, output/provider hashes, credential material, provider response ID, nor private quote/rate data. Only approver review can decrypt through the existing artifact boundary.
- `executionAvailable` disables convenience controls when server-rendered gates are absent, but it grants no authority. The execute handler and repository recheck every control independently; browser state cannot enable execution.
- Success grants no publishing, Draft mutation, approval, workflow, routing, or future execution authority. Human review, accepted attachment, explicit evidence-preserving application, submission, approval, and publication remain separate steps.

Production use still requires managed KMS/HSM custody and rotation, production identity, provider-specific policy/legal review, content moderation and retention/erasure procedures, audited incident ownership, and receiver/network controls. Rollback to 0.85 must leave execution stopped and must preserve ambiguous, output, reconciliation, resolution, and alert evidence.

## Draft-bound AI revision controls (Release 0.87)

- The browser submits only workspace/Draft identity, healthy binding, existing reservation, idempotency key, one closed presentation goal, output bound, and whether to execute immediately. Raw system/user prompts, source version, context hash, provider/model, quote evidence, credential, and authority fields are not accepted.
- Both product routes are authenticated and writer-only. Path-owned Draft/intent IDs overwrite body values before strict schema validation. Immediate execution checks deployment flag and AI vault before preparation so a deployment stop does not unnecessarily consume a reservation.
- Prompt assembly occurs only on the server from the exact current editable Draft/version and its immutable claims/evidence. Deterministic ordering plus `draft-revision-v1` prevents browser substitution; the private context SHA-256 and both prompt hashes prove reconstruction without storing prompt text.
- Preparation reconstructs under Draft/version locks, requires at least one evidence-backed factual claim, and requires the exact reservation feature `assistant.prepare_copy`. Generic API schemas cannot inject the optional internal `draftRevision` context.
- Execution reconstructs the prompt again and compares prompt version, context hash, user hash, and system hash before claim. The claim independently requires current editable source/version, active exact reservation/evidence, deployment/workspace/circuit gates, and its existing permanent one-attempt constraint.
- Product instructions permit presentation suggestions only and explicitly forbid invented facts, evidence changes, approval claims, publishing, routing, and action execution. The model's result remains untrusted encrypted review material.
- Public intent/output/audit projections disclose safe source IDs, closed goal, and presence Booleans but not context hash, prompt, credential, ciphertext, plaintext, or private provider/pricing evidence.
- Product-bound accepted output can attach only to its source Draft while the exact source version remains current. Even then, Release 0.80 application reconstructs factual body from retained claims/evidence and accepts only selected presentation fields before ordinary Draft review.
- UI `executionAvailable` remains a convenience gate. Routes and repository transactions reauthorize independently, and no browser variable or product-bound record grants Draft mutation, approval, workflow, routing, publishing, retry, or future execution authority.

Production still requires managed key lifecycle, production identity, provider/legal review, moderation and retention/erasure policy, and incident ownership. Rollback to 0.86 preserves all source/attempt evidence, keeps execution stopped, and forbids raw-prompt substitution for product-bound intents.

## In-context Draft authorization controls (Release 0.88)

- The Draft browser receives only the exact rate-card ID already bound to a tenant-scoped healthy implementation. It does not receive rate components, private source evidence, provider credentials, card hashes, or authority tokens.
- `rateCardId` is input to a strict action quote request, not trusted pricing authority. The assistant quote route and repository independently require an authenticated writer and re-evaluate workspace policy, assistant assignment, action envelope, routing compatibility, current binding, effective approved card, currency, and normalized component bounds.
- Reservation is a second authenticated transaction. It rechecks quote workspace, expiry/currentness, budget policy, exception evidence, uniqueness, and UUID idempotency before creating the maximum hold. Browser state cannot manufacture or enlarge a reservation.
- If reservation fails after quote creation, the UI reports the exact safe condition: the quote was recorded but not reserved. It does not retry silently, claim that funds are held, delete the quote, or advance to preparation.
- A returned reservation is selected locally for convenience, but Release 0.87 preparation still validates exact workspace, feature `assistant.prepare_copy`, capability, status, unused binding, and all current Draft/provider evidence under lock.
- Quote and reservation requests make no provider call, decrypt no credential or output, create no invocation attempt, and grant no Draft mutation, approval, publishing, workflow, routing, retry, or future execution authority.
- `pending`, button disabled state, and locally filtered lists are usability controls only. Every quote, reserve, prepare, and execute route retains independent route and repository authorization.
- Live acceptance verified unauthenticated quote/reserve mutations return 401, the no-binding Draft state fails closed, and browser diagnostics contain no warnings/errors.

Rollback to 0.87 must preserve all durable quote, reservation, denial, exception, usage, and audit evidence. Unreserved quotes may expire; an active maximum hold must be consumed, cancelled, or expired by its established authoritative lifecycle rather than direct data deletion.

## In-context Draft encrypted output controls (Release 0.89)

- Server rendering receives only safe artifact metadata. Plaintext, ciphertext, output hashes, credential material, raw provider responses, and private quote/rate evidence never enter Draft-page props or HTML.
- Opening output requires the existing authenticated workspace `approve` permission and a valid 32-byte base64 AI vault. The repository accepts only tenant artifacts in `pending_review|accepted`; decryption occurs after authorization and remains request-local.
- The component stores returned plaintext only in transient React state and clears it on close, review, or attachment. It never writes plaintext to persistence, URL/query state, browser storage, audit, logs, or a subsequent mutation body.
- Accept/discard requires the existing approver boundary, closed decision enum, bounded note, row lock, and pending-review status. Review grants no Draft mutation, attachment, publishing, workflow, routing, retry, or future execution authority.
- Attachment requires separate workspace `write` permission. The client submits the exact page Draft ID, while the repository rechecks accepted status, tenant scope, single attachment, product source Draft equality, exact current editable source version, and existing proposal constraints under lock.
- A stale source version disables the convenience button and remains repository-blocked. An attached proposal is read-only; the existing application transaction permits only explicit presentation fields and reconstructs facts/evidence before creating a successor that still needs ordinary review.
- `canApprove`, `canEdit`, `vaultAvailable`, `sourceCurrent`, disabled buttons, filters, and the local `Set` are not authority. Direct API calls receive the same route and repository checks.
- Live acceptance verified artifact read/review/attach return 401 without a session, the no-artifact state exposes no action button, and browser diagnostics contain no warnings/errors.

Rollback to 0.88 preserves encrypted artifacts, review decisions/notes, proposals, attempts, reconciliation, usage, reservations, and audits. Continue authorized operations through AI settings; never decrypt in bulk, downgrade encryption, or delete retained evidence to remove the contextual UI.

## Structured presentation-suggestion controls (Release 0.90)

- v2 provider instructions allow only presentation fields and rationale in one exact versioned JSON object. They explicitly forbid body/headline/facts/evidence/approval/publishing and prose outside JSON.
- The deterministic parser distrusts provider compliance: it rejects parse errors, surrounding prose, arrays, unknown keys, wrong schema, nulls, excessive size/length, punctuated lead-ins, malformed/duplicate hashtags, and unsupported authority/factual fields.
- Parsing occurs only after existing writer authorization and AI-vault decryption of an accepted attached proposal. Parser results expose no new plaintext beyond the already-authorized proposal response and persist nothing.
- Zero fields are selected automatically. Authors must check each validated field, click fill, review/edit ordinary inputs, enter a change note, and separately invoke apply. Filling alone makes no request or mutation.
- Application still validates every field, locks current source/proposal/artifact, reconstructs fact claims/evidence, checks format ceiling, creates an immutable successor, and grants no approval/publishing/workflow authority.
- v1/v2 prompt reconstruction is version-bound; hash evidence cannot be reinterpreted across versions. Unsupported versions fail closed.

## Legal-hold placement and release controls (Release 0.92)

- Direct retention-class writes cannot place or remove `legal_hold`. Placement requires approval authority and a bounded reason; release requires a writer request and a different approval-role decision. Route authorization is repeated in repository transactions.
- Hold placement, release request, and decision lock exact tenant rows. Database checks enforce same-workspace actors, valid closed states, requester/decider separation, one active case, one pending release, and tenant-consistent request-to-case identity.
- Placement and approved release increment a monotonic retention revision. Erasure execution rechecks that revision plus class and eligibility, preventing a pre-hold request from regaining authority after a temporary hold lifecycle.
- Eligibility refuses both an explicit `legal_hold` class and any active hold row. This duplicate check is intentional defense in depth against administrative drift; operators must repair inconsistency through a reviewed forward migration or procedure, never by bypassing the workflow.
- General audit events omit hold reason, case reference, request note, and decision note. They record only identifiers, target/previous closed classes, a case-reference presence Boolean, and event type. The access-controlled case ledger contains the bounded legal narrative and copies no conversation content.
- Governance rows survive later conversation erasure because their thread IDs are scalar. Never add a cascading thread foreign key, copy content into the ledger, delete active cases to unblock erasure, decrement revisions, or alter applied migration 0081.
- The UI confirmation, role-based visibility, disabled buttons, and local state do not grant authority. No hold is automatically released and no retention erasure is automatically retried after release.

## Workspace legal-hold queue disclosure controls (Release 0.93)

- The workspace-wide active-hold and pending-release projections are loaded only for owner, administrator, editor, or approver roles. Analyst and viewer page props and retention-policy GET responses contain empty arrays and zero queue counts.
- Hydrated subject and relationship labels come only from live tenant-bound joins. They are optional, not copied into hold/release rows, and disappear when source content is unavailable. Queries cannot join across workspace boundaries.
- Workspace cards expose the already-authorized bounded reason/reference and requester/placer evidence needed to operate the hold. They expose no message body, internal note, identity, provider payload, credential, AI output, or audit-internal dictionary.
- Queue decision buttons call the existing strict authenticated route. Direct calls still require approval access, prohibit self-decision, and lock/revalidate request, case, and thread. Local merge/filter state is not authorization.
- Approval repeats the visible eligibility-resumption warning. Rejection closes only the exact pending request; active hold state remains. Browser refresh delay or stale props cannot change repository state or enable a second decision.
- The 200-record bounds reduce accidental bulk disclosure and query load but are not pagination. Production needs explicit access-policy review, audit monitoring, protected transport, and operational ownership before expanding scope or notification delivery.

## Recent legal-hold decision disclosure controls (Release 0.94)

- Recent decision history uses the same explicit owner/administrator/editor/approver disclosure allowlist as the active queue. Analyst and viewer page/API projections are empty and expose a zero count.
- The history is server-filtered to closed release requests and workspace ID before ordering or limiting. Migration 0082 improves access-path performance but grants no permission and changes no row-level constraint.
- History cards expose only the already-governed bounded request/decision notes, target class, actors, times, status, scalar thread identity, and optional live labels. No message body, internal note, provider payload, credential, identity signal, or AI output is joined.
- The component adds no button, form, endpoint, replay action, bulk export, notification, or automatic release. Existing decision authorization, requester/approver separation, row locks, and audit behavior remain authoritative.
- A source link is omitted when the live thread label is unavailable, avoiding a knowingly dead navigation target after approved retention erasure. Governance evidence remains readable without recreating deleted content.
- The database/API bound is 200 and the visible page bound is 20. These are disclosure and operability bounds, not pagination or a promise of complete legal export; formal discovery/export remains separately reviewed future work.

## Publication-rights execution controls (Release 0.95)

- A legacy status flag is not authority. Migration 0083 resets prior `cleared` rows to `unchecked`; only an authenticated writer can record a new reviewed decision, and database constraints independently enforce the evidence required for `cleared`.
- Clearance requires an owner, controlled source and proof references, worldwide commercial and derivative permission, an explicit supported channel, reviewer/time, note, and positive revision. Future, expired, missing, changed, or channel-incompatible rights fail closed.
- Derivatives inherit their original's authority. They cannot carry a separate clearance that outlives or contradicts the source. A preview snapshot cannot freeze permission: activation and execution compare its revision against the current source decision.
- Attribution, watermark, and disclaimer requirements cannot be silently dropped. Because the current publisher cannot verify these obligations, any non-empty requirement is restricted and blocked from package approval/preview execution.
- Route `write` authorization, repository membership checks, tenant-bound joins, row locks, and database foreign/check constraints are cumulative. UI enablement is not authority. A schema-valid unauthenticated PUT returns 401.
- Rights audits are minimized: owner, license owner, source/proof references, review note, and requirement text are excluded. They remain in the access-controlled asset record; audit rows retain outcome/revision and non-sensitive presence/count evidence.
- Provider I/O is downstream of all checks. The workflow worker refuses non-cleared, revision-zero, unreviewed, or expired snapshots before object-store reads, channel lookup, publication-action creation, or provider calls.

## Malware scan enforcement (Release 0.96)

- Only an exact ClamAV `OK` verdict becomes `clean`; signature matches become `infected`, and every transport/protocol/timeout error becomes `failed`. Unknown text is never interpreted as success.
- Infected source bytes are rejected before immutable object storage. Unconfigured or failed scans can remain visible for operator diagnosis but cannot approve a package or enter a publishable preview.
- Database constraints require engine, timestamp, and positive revision for every clean asset. Migration 0084 revokes legacy clean flags that lack this evidence. UI state cannot recreate authority.
- Preview snapshots carry scan revision/time and are compared with the current original. A later failure, withdrawal, or rescan makes old previews stale and blocks activation/execution. The worker checks before reading the object store.
- clamd TCP is unauthenticated and unencrypted. Local compose binds it only to `127.0.0.1`; production must use private network policy/firewalls, must not expose 3310 publicly, and must monitor FreshClam, daemon health, memory, and scan limits.
- Inputs are already bounded to 50 MiB; scanner chunk size, timeout, response size, and configuration ranges add independent resource limits. ClamAV `StreamMaxLength` must remain at least the application maximum.
- EICAR is used only as the industry-standard non-malicious scanner test payload. Live QA confirmed it is detected and no fixture is written to application storage.

## Exact publishing-account rights enforcement (Release 0.97)

- A provider-wide clearance is no longer sufficient. Migration 0085 revokes all such legacy `cleared` rows to `restricted` and clears old preview authority; a writer must record a new revision with exact account IDs.
- The repository validates each selected Channel Connection against the authenticated workspace and selected permitted provider inside the same transaction that replaces the authority relation. Cross-workspace or provider-mismatched IDs fail closed.
- Foreign keys bind rights scope and snapshots to real Channel Connections. The connection constraints are deferred `NO ACTION`: a standalone deletion remains blocked while referenced, but tenant deletion can atomically cascade all related rows without order-dependent failure.
- UI checkboxes and account names are convenience and evidence display only. The strict API schema requires UUIDs, repository membership checks are authoritative, and package approval independently requires at least one persisted exact-account relation.
- Preview creation requires the exact selected connection. The immutable snapshot stores that ID; later account substitution, relation removal, rights revision change, expiry, provider mismatch, connection revocation/error, or capability change makes execution stale or blocked.
- Campaign activation and publication targeting repeat live relation checks. The worker additionally compares snapshot account ID with the resolved target account before immutable-media reads, action creation, credential decryption, preflight, or provider I/O.
- Audit events contain selected-account count, not account names, credentials, source/proof references, or review narrative. Publication request snapshots include the exact account UUID solely to prove the outbound decision boundary.

## Exact Campaign rights enforcement (Release 0.98)

- Content Package inclusion is not attachment authority. An image may be generally approved before a Campaign exists, but preview creation requires an explicit live `(source original, Campaign)` grant.
- The strict rights PUT requires `permittedCampaignIds`. Route authentication and workspace write authorization precede repository checks; every supplied UUID must resolve to the same workspace inside the replacing transaction. Cross-workspace, missing, or deleted Campaigns fail closed.
- Campaign identity is server-derived from the draft, Campaign activation input, publishing target, and workflow target. Clients cannot substitute a Campaign ID at the attachment boundary.
- A preview snapshots the exact Campaign plus rights revision, reviewer/time, expiry, publishing account, and malware evidence. Relation removal, revision change, Campaign mismatch, expiry, account drift, or scan drift makes it stale or blocks execution.
- Campaign activation and publishing-target hydration repeat the live relation check. The worker compares `rightsCampaignId` with `target.campaignId` before object-store access, action-ledger creation, credential decryption, preflight, or provider I/O.
- Foreign keys prevent dangling grants. Deferred `NO ACTION` permits complete tenant deletion but blocks standalone deletion while a Campaign remains in use; application code must not bypass this with unordered administrative deletes.
- Audit events record only `permittedCampaignCount`. Campaign names, rights evidence text, credentials, and provider payloads are excluded. The publication request snapshot retains the exact UUID solely as execution-boundary evidence.

## Exact Brand Profile rights enforcement (Release 0.99)

- Exact Campaign authority cannot survive an identity change. Every governed image preview now requires an explicit relation to the stable Brand Profile root selected by its Campaign version.
- The strict rights API requires `permittedBrandProfileIds`; authenticated workspace write authorization and transactional same-workspace root validation prevent cross-tenant or invented IDs.
- Brand identity is server-derived through `campaign_version.brand_profile_version_id` and `brand_profile_version.brand_profile_id`. Browser checkboxes, names, Campaign step input, and provider payloads cannot select or substitute it.
- Root-level scope is intentionally stable across published versions of the same Brand. A different root, a null Brand, deleted relation, rights revision change, account/Campaign mismatch, expiry, or malware drift makes the preview stale or ineligible.
- Activation compares the preview snapshot to the current published Campaign version, closing post-preview Brand reassignment. Publication targeting repeats the live relation check, and the worker compares `rightsBrandProfileId` with `target.brandProfileId` before object-store reads, action creation, credentials, preflight, or provider calls.
- Deferred foreign keys preserve standalone in-use deletion protection without making full tenant teardown order-dependent. Administrative code must not bypass this with unordered deletes or constraint weakening.
- Audit stores only `permittedBrandProfileCount`; Brand names/profile data, rights evidence, credentials, and provider payloads remain outside general audit events. Request snapshots retain the exact root UUID only as outbound decision evidence.

## Production OIDC identity enforcement (Release 1.0)

- Authorization state and nonce use independent 256-bit entropy. Only their SHA-256 base64url hashes enter PostgreSQL; the state cookie is HttpOnly, SameSite=Lax, scoped to `/api/auth/oidc`, Secure in production, and expires with the ten-minute state row.
- PKCE S256 is mandatory even for a confidential client. A configured client secret is submitted only to the exact discovered token endpoint over HTTPS and is never serialized to a browser, database row, audit event, log, or returned error.
- Discovery must return the configured issuer exactly. Fetches reject redirects, use `no-store`, time out after ten seconds, and cap JSON at one MiB. Production requires HTTPS for issuer, authorization, token, and JWKS URLs.
- ID-token acceptance is RS256-only and verifies the selected RSA signing key, signature, issuer, audience, authorized party when present/multi-audience, expiry, issue time, optional not-before time, nonce, bounded subject, and a verified syntactically bounded email.
- New subjects require an existing normalized-email account, an exact unexpired invitation, or an explicit bootstrap email. Invitation roles cannot be owner; repository authorization limits invitation creation/revocation to owners and administrators; acceptance is transactional.
- Audit dictionaries for invitation creation/acceptance contain only role and stable IDs; revocation data is empty. Emails, provider subjects, issuer URLs, token material, and display names remain outside general audit data.
- Remaining production controls include provider MFA/recovery policy, Market Me session/device administration and global revocation, PostgreSQL RLS/least-privilege identities, rate limits, abuse monitoring, and security-event alerting. OIDC support does not by itself certify an untrusted multi-tenant deployment.

## Production object-storage enforcement (Release 1.1)

- The production selector accepts only `MEDIA_OBJECT_STORE=s3`; unset, misspelled, or explicit filesystem mode fails closed. No runtime may silently write to an instance-local directory after deployment.
- Custom endpoints are absolute HTTP(S) URLs without embedded credentials, query, or fragment, and production requires HTTPS. Endpoint configuration is trusted operator input; network egress policy should still restrict the runtime to approved object-storage hosts.
- Access key ID and secret must appear together; a session token cannot stand alone. Omitting all three delegates resolution to the AWS SDK credential chain, enabling short-lived workload identity. Never place keys in `MEDIA_S3_ENDPOINT`, a client variable, source file, log, audit row, or Google documentation.
- Conditional creation protects against application overwrite races, while bucket versioning protects against authorized or administrative replacement/deletion. Both are required defenses. Deny public access and broad list/delete permissions; scope runtime roles to the selected bucket/prefix and separate backup administration.
- A provider returning checksum headers or metadata is verified, but their absence does not grant trust. Content addressing, existing-byte verification, database hashes, and downstream scan/rights revisions remain cumulative controls.
- `scripts/qa-s3-server.mjs` intentionally ignores AWS signatures and stores bytes only in memory. It is protocol acceptance scaffolding on loopback, not an emulator to expose, deploy, benchmark, or use for persistent development data.
- Release 1.1 does not implement object deletion, retention execution, legal discovery export, bucket provisioning, database backup, Temporal visibility backup, or disaster-recovery orchestration. Production approval requires separately owned recovery objectives and successful restore evidence.

## PostgreSQL recovery safety (Release 1.2)

- The QA harness cannot run without an exact quiescence acknowledgement and separately proves source table counts did not change around the dump. This reduces false evidence but is not a production fencing mechanism; production must block all write ingress and confirm sessions/jobs.
- Operator identifiers are bounded and every subprocess uses an argument array. Random restore/database paths are generated internally; cleanup is limited to that tuple. The source database is never dropped, restored over, migrated, or otherwise changed.
- Archive and validation output excludes rows, secrets, SQL dumps, encryption keys, provider payloads, and object bytes. A local custom-format dump remains sensitive while it exists inside the container and is removed in `finally`.
- A row-count/checksum/constraint match proves logical fixture consistency, not authorization, semantic correctness, malware/rights validity, object availability, Temporal history, provider state, encryption-key recoverability, scale, RPO, or RTO.
- Production backup credentials must be dedicated and least-privilege; archives need encrypted transport/storage, recoverable separate key custody, immutable/off-account copies, alerting, legal retention/hold alignment, and scheduled isolated restores.
- Restore into a new target first. Keep outbound AI, publishing, workflow dispatch, webhooks, companion execution, and measurement ingress disabled until PostgreSQL, object versions, Temporal histories, provider ambiguity, secrets, sessions, legal holds, and audits are reconciled.
- Restoring data can resurrect revoked credentials/sessions or already-erased content from an older point. Apply incident authentication decisions and approved backup-expiry/legal-hold policy before traffic; never use recovery as a shortcut around erasure governance.

## Public readiness disclosure (Release 1.3)

- Both probes are unauthenticated by design and therefore expose only service name, package version, UTC time, aggregate state, and seven closed check names/states. They never expose hostnames, URLs, database names, users, credentials, key presence, provider errors, migration checksums, or response bodies.
- Liveness performs no dependency access, preventing a database outage from creating a process restart storm. Readiness uses one bounded database connection and no write, object operation, OIDC discovery, provider call, credential decryption, or audit event.
- Production configuration validation is fail-closed for HTTPS app/OIDC/webhook origins, S3 storage, required key lengths/pairs, and conditional AI/alert keys. It does not assert that an external endpoint is trustworthy or reachable; network policy and live service monitoring remain required.
- Database exceptions are caught and reduced to `database_connection=not_ready`; a successful connection with a non-exact migration count/latest version becomes `database_migrations=not_ready`. Raw errors must remain absent from responses and ordinary access logs.
- Probe endpoints use `no-store`. Edge/CDN/load-balancer configuration must honor this, rate-limit abusive public probing, and avoid treating response time as customer or infrastructure detail.
- `/api/ready` covers only the web control plane. It must not be presented as proof of object availability, Temporal/worker health, ClamAV freshness, provider connectivity, alert delivery, backup freshness, or disaster recovery.

## Worker heartbeat security controls (Release 1.4)

- Production public readiness adds only the two closed aggregate names/states `ingestion_worker_freshness` and `workflow_worker_freshness`. Instance UUIDs, versions, start/last-seen/stop times, row counts, cadence, database errors, host identity, queue details, and logs never enter the response.
- Worker timestamps are assigned and compared by PostgreSQL, preventing a compromised or skewed host clock from directly extending freshness. The process supplies only closed service, random instance UUID, and bounded package version.
- The composite key prevents one service instance from overwriting another. Graceful stop closes the exact row; crash/kill recovery depends on bounded expiry and never on deletion or a client-reported healthy flag.
- `SERVICE_HEARTBEAT_INTERVAL_SECONDS` accepts only integer 5-through-60 values. `SERVICE_HEARTBEAT_MAX_AGE_SECONDS` accepts only integer 15-through-600 values, defaults to 120, and an invalid production value keeps both worker checks not ready.
- Heartbeat write failure after startup logs only the safe event name, closed service, and exception class. Initial failure aborts startup. No credential, SQL string, URL, response body, instance ID, or tenant data is logged by this boundary.
- Database write access remains infrastructure authority. Operators must not expose `service_heartbeat` to browsers, let workers use tenant-superuser credentials, or manually forge rows during an incident; route removal and incident declaration are safer than false readiness.

## Governed Mailchimp email controls (Release 1.5)

- Distribution is audience-bound. Market Me accepts and stores a provider audience ID, never a recipient list or raw subscriber address. Consent, unsubscribe, suppression, bounce, and complaint enforcement remains provider-owned; do not bypass it with an alternate send path.
- API keys are server-only encrypted connector credentials. Browser responses expose only safe connection identity/configuration. Never put an API key in Campaign JSON, a preview, log, audit details, provider URL, documentation, test fixture, or client environment variable.
- The data-center hostname is derived from a validated key suffix and fixed to `https://{dc}.api.mailchimp.com/3.0`; callers cannot supply an arbitrary base URL. Production egress policy should independently restrict DNS/network access to approved Mailchimp hosts.
- Provider JSON is read through a 64 KiB bound. Authentication and validation failures expose closed safe errors. Request/response bodies, credentials, provider detail text, recipient data, and HTML are excluded from logs and audit output.
- Email execution requires an approval-required step and one exact ready preview. The subject, body, destination, tracking parameters, audience, capability version, and provider connection are revalidated at the outbound boundary; direct mutable content and cross-audience substitution fail closed.
- HTML content is escaped before minimal HTTPS-only linkification. Plain text is sent separately. Every provider Campaign contains the Mailchimp unsubscribe merge tag; Market Me does not render a fake local unsubscribe control.
- The external Campaign ID is persisted before content/send. Known IDs can resume safely, but an unknown create/send result becomes `ambiguous` and requires provider-side inspection. Operators must never clear the ID or force automatic resend to make an incident disappear.
- Release 1.5 does not verify Mailchimp webhooks or ingest outcomes. Opens are not proof of a person, clicks are security-sensitive redirects, and all future bounce/complaint/unsubscribe handling must be signature-verified, replay-safe, minimized, and suppression-first.

## Recipient-free Mailchimp report controls (Release 1.6)

- The connector uses the aggregate Campaign report only and supplies an allowlisted field projection. It must never call recipient, sent-to, member activity, open-detail, click-member, unsubscribe-member, or email-activity endpoints for this feature.
- Every response is bounded to 64 KiB and validated before SQL. Campaign/list identity must equal the exact publication/connection; all counts are safe non-negative integers and unique counts cannot exceed totals.
- The route is authenticated and tenant-bound, requires write access, decrypts credentials only server-side, and refuses inactive connections or actions without a known provider Campaign ID. Provider authorization/rate/transient errors become closed safe responses.
- Snapshots contain aggregate counts, provider Campaign ID, exact observed audience ID, timestamps, and a SHA-256 content identity only. Historical audience identity is retained on the immutable row and is never rewritten from later connection configuration. Snapshots contain no recipient address, subscriber hash, merge field, IP address, user agent, geographic detail, individual open/click, raw provider body, or credential.
- A report proves the known Campaign has a sent report; it does not prove inbox placement, human readership, intent, identity, conversion, or legal compliance. Apple/privacy proxies and automated scanners can affect open/click observations.
- Reconciliation may resolve only the exact locked action/provider Campaign/audience tuple and never sends or edits content. A mismatch fails closed; an unchanged report creates no duplicate row or audit noise.
- Aggregate unsubscribe, bounce, and complaint counts are warning evidence, not a local suppression system. Provider-owned audience status remains authoritative and must be honored before all future sends.

## Provider aggregate metric security (Release 1.7)

- Provider aggregates have a separate closed type tuple and SQL table. `MEASUREMENT_EVENT_TYPES`, measurement-key scopes, and the external ingest route do not accept any `email_*` provider aggregate type, preventing client fabrication of provider totals.
- Every current total retains its exact tenant, Campaign instance, publication action, and immutable report snapshot. The report transaction locks those identities before metric update and success evaluation.
- Only unique opens and unique clicks enter the current metric projection; they remain provider estimates, not people. No address, subscriber hash, recipient activity, IP, user agent, or raw response is introduced.
- Count-only authoring prevents aggregate totals from acquiring client-selected currency/value semantics. Harm indicators such as unsubscribe, bounce, or complaint may be used as pause/notification thresholds but never as local suppression authority.
- A provider correction may lower a current total. The latest summary follows that correction, while an already queued workflow notification remains immutable and visible; operators must review rather than erase or replay the transition.
- Release 1.7 itself added no automatic collector. Release 1.8 retains the same server-only credential decryption, bounded response, exact identity, and no-provider-mutation controls when opt-in collection is enabled.

## Automatic Mailchimp report-collection security (Release 1.8)

- Collection is disabled unless the exact `true` flag is present, and enabled startup fails without the connector encryption key. Configuration bounds prevent zero-delay polling, unbounded batches, or indefinite historical scans.
- Each claim is tenant-bound and accepts only an active exact-workspace Mailchimp connection, a known provider Campaign, a due schedule, and a recent publication. PostgreSQL locking prevents concurrent workers from owning the same state; abandoned claims become recoverable after five minutes.
- The immutable audience stored at publication is authoritative for reports. A later connection audience change cannot redirect collection, rewrite prior evidence, or pass a mismatched report into SQL.
- Credential plaintext exists only for one request. The adapter derives the fixed Mailchimp host from the validated key suffix, enforces a five-second timeout and 64-KiB response bound, and requests aggregate fields only. No recipient/member endpoint or provider mutation is introduced.
- SQL/log/UI failure evidence uses only `authorization`, `validation`, `rate_limit`, `transient`, `permanent`, `ambiguous`, `credential_unavailable`, or `unknown`. Provider bodies, keys, URLs, SQL errors, recipient data, and raw exception messages remain excluded.
- Rate-aware and exponential backoff reduce repeated provider/credential pressure. Permanent-looking failures are still retained for later review rather than deleting schedules or silently treating missing reports as zero.
- The connection creator is used only for audit attribution in the existing transaction. Deployment database credentials remain the worker's true authority; production must use least privilege, managed key rotation, restricted egress, provider monitoring, and an approved polling retention/cadence.

## Signed Mailchimp webhook security (Release 1.9)

- Signature verification implements the official Marketing API scheme exactly: HMAC-SHA256 over timestamp, dot, and untouched body bytes; strict header grammar; 300-second absolute skew limit; and constant-time byte comparison. Parsing before verification is prohibited.
- The callback accepts only URL-encoded POST bodies up to 32 KiB. Invalid content type, size, connection, vault state, signature, timestamp, audience, Campaign, or sent status cannot wake collection. Responses and logs contain no request body or verification detail.
- Recipient-bearing signed events are deliberately ignored. Even for the accepted Campaign event, email, subscriber/member identifier, IP, merge values, subject, reason, and raw form are request-local and discarded. No payload or raw-body hash reaches SQL.
- Stored delivery evidence is a hash of the verified secret-keyed signature plus provider timestamp, server receive time, and aggregate count. This supports replay suppression without a contact/event ledger and grants no measurement meaning.
- The signing secret is shown once by Mailchimp, accepted only by an authenticated workspace writer, encrypted with the connector vault, and omitted from public projections/audits. Rotation overwrites ciphertext and records only `signingConfigured=true`.
- Exact immutable audience plus known provider Campaign binding limits a stolen secret to bounded wake attempts on existing records. It cannot create a Campaign, select recipients, publish, change totals, bypass the aggregate adapter, or clear a lease.
- The empty GET exists solely for provider callback validation and exposes no connection/configuration state. Production edge controls should require HTTPS, rate-limit both methods, cap request bodies before application execution, restrict abusive sources where operationally safe, and monitor 401/413/503 rates.
- Polling remains the completeness fallback because Mailchimp may retry or disable unhealthy callbacks. Operators must monitor provider webhook state and coordinate provider/app secret rotation without logging the old or new value.

## Managed Mailchimp webhook-lifecycle security (Release 1.10)

- Every lifecycle method is authenticated and workspace-bound; GET requires read access, while create/replace/manual configuration/disable require write access. Provider credentials are decrypted only after exact active Mailchimp connection and audience resolution.
- The provider host remains derived from the validated API-key data-center suffix. Callback creation accepts only public HTTPS without credentials or fragments, and the server supplies the connection-scoped callback; browsers cannot choose an arbitrary provider or callback URL.
- Creation explicitly disables subscribe, unsubscribe, profile, cleaned, email-change, SMS-recipient, and SMS-Campaign events. Only Campaign sending and admin/API sources are enabled. Returned settings are revalidated, and an unexpected webhook is removed rather than stored.
- Replacement is destructive and therefore two-step when provider state exists. Inventory is bounded; selection is exact callback and/or previously stored managed ID; IDs are deduplicated. Unrelated audience webhooks, approximate URLs, event-similar hooks, and provider ordering never grant deletion scope.
- The shown-once secret exists in provider response memory only until encrypted. Safe configuration and audit contain provider ID, audience, callback, mode, time, and Boolean state only. API/UI/QA output, logs, errors, tests, and health never include the secret or raw provider body.
- Cross-system compensation fails closed. A secretless or unexpected create is deleted; local persistence failure deletes the new resource; cleanup uncertainty is reported as ambiguity and must be reconciled from inventory. The system never marks such a path active.
- Live health compares provider identity, exact callback/settings, and local secret presence. Manual secrets are always `manual_unverified` because provider-secret agreement cannot be retrieved or proven. A Boolean alone is not provider-health evidence.
- Edge rate limiting, provider audit/alerts, API-key least privilege and rotation, vault-key custody, egress restrictions, and periodic health checks remain production responsibilities. Durable aggregate polling stays enabled through create/delete gaps, Mailchimp retries, disablement, and provider outages.

## Managed webhook health-monitor security (Release 1.11)

- Monitoring is disabled by default and enabled startup fails without the connector vault key. Strict loop/batch/interval bounds prevent unbounded inventory scanning or zero-delay credential pressure.
- Claims require an active exact-workspace Mailchimp connection in managed mode whose provider ID, callback, and audience still equal the schedule snapshot. `SKIP LOCKED` plus stale recovery prevents concurrent ownership without trusting worker clocks.
- Credential plaintext exists only during one check. Missing secret closes locally without provider I/O; otherwise the connector derives the fixed Mailchimp host, enforces a five-second timeout and 64-KiB response, and accepts only bounded Boolean inventory identity/settings.
- The monitor has no provider mutation path. It cannot create, update, delete, rotate, adopt, or repair a webhook; an attacker with worker database/credential authority still cannot use this class to broaden configured event categories.
- SQL/log/UI contain closed health/error codes, counts, and times only. Worker logs emit aggregate claimed/active/unhealthy/failed counts and Error names; they omit connection/audience/provider IDs, callback URLs, credentials, inventory, bodies, and secret presence per target.
- Health state does not prove signed delivery, report freshness, Campaign completion, provider availability after check time, or polling health. It must not gate outbound email, overwrite webhook wake evidence, fabricate measurement, or replace provider alerts.
- Production must use least-privilege worker database credentials, managed vault rotation, restricted Mailchimp egress, sensible interval ownership, alerting on sustained unhealthy/error counts, and explicit operator repair. Report polling remains the independent completeness control.

## Slack incoming-webhook security (Release 1.12)

- The complete Slack URL is a bearer secret. Zod bounds it before construction; the connector accepts only HTTPS `hooks.slack.com` or `hooks.slack-gov.com`, exact `/services/<team>/<service>/<secret>` structure, closed identifier shapes, and no port/query/fragment/embedded credentials. This prevents arbitrary-host SSRF and decorated-target confusion.
- Only `{teamId,serviceId,host}` is safe configuration. The URL is encrypted with the connector vault and removed from every browser response. It must never enter capability JSON, request snapshots, publication metadata, audits, logs, QA output, screenshots, or documentation.
- Connection testing is an external write, not a harmless GET. The fixed content is disclosed in the UI and contains no user/Campaign data. A valid save requires authenticated workspace write authority, configured vault encryption, provider acknowledgement, and local persistence.
- Slack cannot provide a read-only target check through incoming webhooks. Runtime therefore reparses the decrypted URL and compares safe identity locally; it does not emit a second test message. A rotated URL with different team/service/host fails before durable provider I/O.
- Slack execution requires an exact approved Draft preview and a human-approved Campaign step. Raw legacy step copy cannot reach the adapter. The payload contains only exact preview text and four false parser/unfurl switches; blocks, attachments, channel/identity override, thread IDs, and arbitrary metadata are absent.
- `mrkdwn:false` and `link_names:false` prevent Slack control syntax and automatic names from silently expanding approved text into mentions; both unfurl flags prevent Slack from crawling approved destinations. These controls do not make linked content safe for users and do not revoke a message after posting.
- Response reads are capped at 256 bytes. Only exact `ok` on HTTP success is accepted. 401/403/404/410 are closed authorization/disabled states, 429 honors bounded retry evidence, other client failures are permanent, and network/5xx/unknown success responses are ambiguous.
- Slack returns no message identity for incoming webhooks. Persisting a fabricated timestamp/URL would create false reconciliation evidence, so external identity remains null and metadata says `providerMessageIdAvailable=false`. Ambiguous sends cannot auto-resend under the existing publication idempotency boundary.
- Production must use provider app governance, minimal channel selection, secret rotation after exposure, restricted DNS/HTTPS egress, edge/provider monitoring, and one-message-per-second-per-channel pacing. Incoming webhooks cannot prove later visibility, retention, edits/deletion by users, channel membership, or Slack workspace policy compliance.

## Mastodon account security (Release 1.13)

- User input cannot select arbitrary egress. Both tiers require an undecorated HTTPS default-port origin and exact lowercase membership in operator-owned `MASTODON_ALLOWED_HOSTS`; wildcard/subdomain inference, redirects, credentials, paths, queries, fragments, alternate ports, and loopback/private exceptions are absent.
- The user access token is bounded, encrypted with `CONNECTOR_TOKEN_ENCRYPTION_KEY`, decrypted only for provider calls, and never stored in configuration/capabilities/actions/audits/logs/QA/browser output. Production must provision least-privilege scopes, restrict vault access, and rotate after suspected exposure.
- Connection testing is read-only: one authenticated account verification plus one public instance-discovery read. Each request has a five-second timeout, redirect rejection, and 64-KiB bounded object response. Safe identity is validated before persistence.
- Runtime repeats the reads and requires exact host/origin/account ID plus unchanged approved maximum and reserved-per-URL character limits. Account/token swaps and instance counting-policy drift stop before `publication_action` creation and require a fresh connection test and preview.
- Mastodon publication accepts no browser-selected endpoint, visibility, sensitive flag, media, reply, poll, schedule, language, content warning, or arbitrary JSON. It sends only the exact approved text with explicit public/non-sensitive fields and a server-derived bounded idempotency key.
- Success requires a bounded provider status ID and same-instance HTTPS status URL. Redirect/network/5xx/malformed/oversized/missing/cross-instance success is ambiguous and cannot auto-resend. Rate-limit evidence comes from `Retry-After` or `X-RateLimit-Reset`; authorization failures close the connection path.
- Public visibility is an intentional product constraint and is disclosed in the UI; it is not inferred from provider defaults. Operators/reviewers remain responsible for public-content suitability, instance policy, moderation, account security, link safety, and later provider/user deletion or visibility changes.

## Mastodon reviewed-image security (Release 1.14)

- Media remains inside the existing governed asset boundary. Only immutable stored bytes whose SHA-256, clean scan revision/time, cleared rights revision/time, exact Channel Connection, Campaign, Brand Profile, supported MIME, decoded dimensions, and approved alt text still match the preview may reach provider I/O.
- Live instance media values are untrusted input. Positive safe-integer ceilings and Market Me caps prevent oversized provider claims; supported MIME types are intersected with JPEG/PNG/WebP. Capability/configuration equality is enforced in application code and hardened SQL whose entire nested expression is `COALESCE(...,false)` so missing JSON cannot pass as `NULL`.
- Multipart upload has a ten-second timeout, redirect rejection, exact allowlisted origin, bounded credential, and bounded 64-KiB JSON response. The connector does not accept browser-selected endpoints, arbitrary multipart fields, content warnings, sensitivity changes, or non-image media.
- Alt text is required and sent as Mastodon's `description`; decorative status alone is rejected. Reviewers remain responsible for semantic quality, privacy, faces/locations, embedded text, and rights. Pixel/format checks do not detect sensitive or misleading imagery.
- The durable media ledger contains provider IDs and hashes, never bytes, alt text, tokens, or response bodies. IDs are persisted before the public status write. Exact ordinal/asset/hash SQL binding prevents cross-action substitution.
- Upload network/5xx uncertainty is ambiguous because retry could create another provider media object. A known 202/200 ID can be polled and reused; transient readiness/rate failures do not re-upload. A crash before local persistence suppresses automatic continuation. Operators may need to remove orphaned private provider media manually.
- Final status creation retains explicit public/non-sensitive fields and provider idempotency. Ordered `media_ids` are bounded to four unique IDs. A malformed status success, uncertain status write, or cross-instance URL remains manual-only and is never automatically resent.

## Mastodon aggregate-report security (Release 1.15)

- Refresh requires an authenticated workspace writer and a succeeded exact-workspace Mastodon publication with stable provider status ID/URL. The connector token never reaches the browser and is decrypted only after tenant/action/connection resolution.
- The egress origin comes from immutable publication preflight identity when present and still passes the deployment-owned exact-host allowlist. Redirects, decorated origins, alternate ports, arbitrary paths, browser-selected endpoints, and cross-instance returned URLs are rejected.
- The provider read is bounded to five seconds and 64 KiB. Status ID, author account ID, URL, creation time, and three safe non-negative integer counts must all validate. 401/403, 404, 429, 5xx, network, malformed, and oversized responses remain closed typed failures.
- Market Me deliberately does not call `reblogged_by`, `favourited_by`, notifications, context, search, or timeline APIs. Provider content HTML/text, interacting accounts, media, mentions, tags, client application, and arbitrary response fields are discarded before repository access and never logged/audited.
- Stored data is aggregate and publication-bound, not anonymous person-level telemetry. Counts may reflect public provider state and can be corrected downward. They must not be described as unique people, reach, impressions, sentiment, conversions, or attributable relationships.
- Snapshot and projection writes are tenant-bound and transactional. The source constraint prevents a Mastodon metric from citing a Mailchimp report or vice versa. Audits retain only status ID, snapshot hash, actor, and normal audit identity.
- Production should use a least-privilege Mastodon token with the read authority required by the instance, restricted HTTPS/DNS egress, vault rotation, route/provider rate monitoring, and explicit refresh cadence. A restored or exposed token must be rotated; historical aggregate rows do not restore credential trust.

## Durable Mastodon collector security (Release 1.16)

- The collector is disabled unless the exact enable flag is true. Enabled startup fails closed without the connector AES-GCM key and a nonempty parsed exact-host allowlist; no browser, database row, Campaign, or provider response may extend that egress set.
- Due claims revalidate action/workspace/connection joins, succeeded state, Mastodon provider, active connection, `read_metrics`, immutable status/account/origin identity, and maximum age before releasing ciphertext to worker memory. `SKIP LOCKED` and a five-minute lease prevent concurrent duplicate work while permitting crash recovery.
- Decryption occurs only inside the workflow-worker attempt. The token, encrypted envelope, Authorization header, exact target, provider response, per-status aggregate values, and error text are excluded from collector results/logging. Worker logs contain only claimed/succeeded/failed batch counts.
- The worker has read authority only through `getStatusReport`; no publish, media upload, edit/delete, context, notification, timeline, search, reaction-account, or reply-content method is reachable from the collector. It cannot create a publication action or resend content.
- Returned status ID/account/URL are revalidated against immutable claim identity before snapshot persistence. Mutable Channel Connection reconfiguration cannot redirect an old action's collection target. The deployment host allowlist remains an independent SSRF boundary.
- Failure storage uses a closed code and bounded delay. It cannot persist provider bodies, content, people, dynamic error messages, or a zero count. Rate-limit evidence affects only scheduling; it is not engagement or account-health evidence.
- Operators must monitor worker readiness, due-age/closed-result state, provider rate limits, and vault/allowlist configuration. Automatic collection increases recurring credential use, so least privilege, egress restriction, key rotation, provider audit review, and prompt disable capability are required.

## Mastodon collection-state disclosure security (Release 1.17)

- Operational status is returned only through the existing authenticated tenant/Campaign collection-state read. It adds no public endpoint, write authority, provider call, credential decryption, or cross-workspace aggregate.
- The closed labels disclose local scheduling posture only. The projection omits immutable provider status/account/URL/origin identity, ciphertext, actor identity, dynamic error text, provider response, per-status counts, and worker/process identifiers.
- The database clock and fixed lease threshold prevent a browser-controlled timestamp from manipulating classification. Query joins retain exact workspace and Campaign-action binding.
- `abandoned` does not prove worker failure or provider impact; `overdue` does not prove an outage; `scheduled` does not prove provider availability or current counts. UI/caller wording must not convert these labels into provider or security claims.
- Because no persisted duplicate state exists, there is no extra mutation/audit/retention surface. Access logs and monitoring should use aggregate route latency/error rates rather than recording per-action status IDs or schedule values.

## Workspace collector-summary security (Release 1.18)

The authenticated Integrations view aggregates only exact-workspace rows and returns counts plus oldest attention timestamps. It omits provider/action/account/URL/connection identity, ciphertext, actor, errors, counts, and worker identifiers. `attention` is local backlog posture and must not be logged or presented as provider compromise/outage evidence.
