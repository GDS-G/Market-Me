# Releases and Roadmap

## 1.20.0 - Bounded request-start scheduling (local preview)

**Status: integrated local acceptance; source/cloud publication pending final review.** Package/native metadata is synchronized at 1.20.0. This is not whole-product completion, hosted deployment or signed desktop distribution. Historical release records below remain unchanged in scope; see [Implementation status](IMPLEMENTATION_STATUS.md) for the full gap map.

- Added half-open UTC request-start windows `[start, end)` for text-only Discord, Slack and Mastodon with exactly `official_api`, current publish capability and exact governed content. No media, Mailchimp multistage or fallback window dispatch. A campaign mixing any window/positive dependency delay with any companion step remains saved-only.
- Added `dependencyDelaySeconds`, default zero, safe integer 0–31,536,000 and positive only with dependencies. Effective start uses each same-instance pinned predecessor's first durable success/partial success plus delay. Independent eligible branches no longer wait for unrelated slow siblings. Form, approval and calendar preserve authored bounds, UTC milliseconds, advanced objects and exact version evidence.
- Added `schedule_blocked`, closed expiry evidence and locked instance/command guards. Missed undispatched work pauses the instance; Resume and every manual completion are rejected. Cancel and a newly reviewed plan are the initial recovery. Started or uncertain writes settle/reconcile, never become presumed non-delivery because time elapsed.
- Unified initial/retry publication admission under exact identity, authority, content/account/destination locks and a fresh final database clock. One retry winner may send. Recovery returns exact stored success without credentials, new links, media or provider I/O, including after expiry/revocation. Provider acceptance and persistence failures remain separate; uncertain commits do not authorize resend.
- Added trusted UTC plus same-process monotonic request budgets, charging the whole database read and timestamp truncation conservatively. Pre-I/O cutoff is a typed no-dispatch result; in-flight timeout/malformed acknowledgement remains ambiguous. Headers and body share a bounded abort budget; a valid accepted acknowledgement is not discarded after the cutoff.
- Fixed late connection preflight writes: revoked rows cannot be reactivated, and current encrypted credentials/full normalized configuration must match the tested snapshot. A rejected success-health update stops the worker before claiming/sending.
- Temporal patch `bounded-scheduling-v1` retains frozen 1.19 workflow/policy behavior. Three actual history replays cover a marked V2 workflow, an unmarked 1.19 timer/approval/manual/dependency history, and an unmarked cancellation history. Deploy the new worker before enabling new web activation; retain legacy handlers while unmarked histories remain in retention.
- Migration `0109_campaign_schedule_bounds.sql`, SHA-256 `0d2ba917450fa559cd89de61849ed337fc9919e6ccd0fc21e977274d14f535f2`. Fresh replay applied 109 migrations into 129 public base tables; rerun skipped all 109 with matching checksums. Readiness expects exactly 109 and tests alignment with shipped migration files.
- Acceptance: **682 distinct TypeScript tests** across 81 files, plus three Rust tests. Package totals: web 178, workflow-worker 60, companion protocol 4, connectors 166, database 108, domain 61, generation 29, ingestion 11, media 24, workflows 41. Final source rerun passed the full suite without skips, workspace typecheck, lint, 91-page production web build and companion frontend build. Native packaging passed separately. Cloud evidence is recorded when complete; subset reruns are not extra cases.
- Authenticated development-browser acceptance verified precise windows/delay/UTF text/optionality, calendar timezone and pinned version, correct route limitations, and blocked run controls with Cancel available. Exact fresh production smoke passed: protected root redirects once to login, all CSS and eight JavaScript bundles return 200, development login is unavailable, and no browser/server errors occur. Own QA tabs/servers were closed. Production checks were unauthenticated; development login does not prove deployed OIDC acceptance.
- Full and production-only audits report zero vulnerabilities at verification time. Dependency versions remain the 1.19 patched baseline. No live marketing-provider credentials or paid calls were used by fixtures.
- Local unsigned Windows artifact: `Market Me Companion_1.20.0_x64-setup.exe`, **2,945,392 bytes**, SHA-256 `29cb57d2a983a7d12dfc6620dcf2b05dc9b537be2770724b186af8a110a8420b`. Nothing was installed, signed or uploaded. The existing 1.19 installer remains unchanged.

Known limits: windows govern request start, not guaranteed remote completion or a reserved slot. Recurrence, evergreen/follow-up, quiet hours, blackout/collision policy, pacing, supported conditions, media/companion window support, beginner source-to-campaign setup, provider inbox/outreach, broad AI/media, analytics and cross-platform production acceptance remain open. Publication locks do not establish atomicity across every rights-scope writer and external HTTP; window media is deliberately unsupported.

Rollback: retain migration 0109 and all first-completion, blocked, publication and approval evidence. Quiesce activations, drain/reconcile in-flight provider work and inventory Temporal histories. Do not run V2 histories on binaries without their handlers, remove the patch while unmarked histories remain, silently resume expired work or retry ambiguous outcomes. No database down-migration is provided. Full engineering contracts and limitations are in [Scheduling contracts](SCHEDULING_CONTRACTS.md).

## 1.19.0 - Integrated workspace and campaign operations (local preview)

**Status: verified local preview and Linux cloud CI; source published.** Source baseline `8e7c3dfd69b788204caf3478c0966dc41f876052` passed [cloud CI](https://github.com/GDS-G/Market-Me/actions/runs/34429425049) in 2 minutes 44 seconds, including all 400 tests without skips, clean installation, migrations, native dependency smoke, type/lint/frontend builds and both clean audits. Package/native metadata is synchronized at 1.19.0. No production-readiness or whole-product completion claim is made here. Previous release records remain historical; use [Implementation status](IMPLEMENTATION_STATUS.md) for supported behavior and outstanding specification requirements.

- Replaced the demo overview with authenticated repository data; added a read-only campaign calendar from exact run-version snapshots and clearly separated unactivated plans. Added current workspace/account Settings and membership-checked workspace switching across all application pages. The seven-day selection cookie is only a hint, Server Action selection rechecks origin and membership, and switching clears cached navigation before returning to a safe section root. Empty-membership sign-in no longer loops.
- Repaired campaign editor preservation: UTC exact/window timestamps retain seconds/milliseconds; advanced condition/input/output objects, execution methods, optionality, retries, and timeouts survive a save. Activation uses the published version and does not silently activate unsaved draft edits. Unsupported plans remain editable but cannot be treated as immediate execution.
- Added shared execution-policy validation at activation/workflow startup and conservative review semantics where confidence/history automation is incomplete. Whole-campaign approval captures the exact version and steps under reserved key `__campaign__`. Queued activities recheck live active/running state, due time, predecessor completion, and approval; provider publication creation rechecks exact lineage and target-bound idempotency. Stricter provider human-review requirements remain.
- Fixed concurrent failed-publication retries: `retryPublicationAction(id, target, {content, subject})` grants dispatch permission only to its atomic comparison-and-set winner. Rechecks include original rendered request, complete provider identity, current credentials/configuration/capabilities, exact approved preview, policy, due time and dependencies. Losing retries and observers no longer overwrite an active dispatch. Legacy failures without complete identity remain manual-only. This does not yet establish one locked authorization boundary over every mutable media-rights resource and external provider I/O.
- Added durable Mastodon overdue/abandoned incidents with five-minute grace/lease thresholds, collection-equivalent eligibility, a single reconciliation snapshot, nonblocking observer advisory locking, deduplication, and retained resolution history. Snapshot and completion writes are fenced by attempt number. Idle passes reconcile; monitor failures do not stop collection and are reported only through a closed flag.
- Migration: `0108_mastodon_collection_alerts.sql`; SHA-256 `8a121cfedd618667e138c160ab734a58d72aadad60b69bb491e869375f632a1a`. Current readiness expects 108 migrations. Fresh replay produced 129 public base tables; rerun applied none and skipped all 108 with matching checksums.
- Final integrated run: **400 distinct TypeScript tests passed with no skips**, including 47 live database, 40 workflow-worker, 128 web, 28 domain and eight workflow cases. Full workspace typecheck, web lint and the 91-page Next.js production build passed. Three Rust tests and the native Windows bundle passed. Subset reruns are not additional distinct tests.
- Browser acceptance covered workspace isolation/current roles, actual overview values, exact run-version calendar and unactivated plans, UTC millisecond preservation, conditional-plan editing, filters, cache invalidation, absent memberships and logout. Post-dependency production smoke verified login, protected-root redirects, CSS/eight JS assets, loopback-only listening and no app/browser-console or server errors. Worker readiness returned 200 then 503 for a stopped workflow heartbeat across nine checks; collector QA made one fenced aggregate-only request and reconciled idle alerts.
- Patched Next/eslint-config-next to 16.3.4, Sharp to 0.35.4, nanoid to 3.3.18, fast-uri to 3.1.7 and Vitest to 4.1.11. Full and production-only audits report zero vulnerabilities at verification time. Repaired missing platform-optional Tailwind oxide lock entries for clean Linux installation. Added read-only-permission, immutable-pin [GitHub CI](CI.md); its first cloud result is a separate gate, not inferred from Windows checks.
- Local Windows artifact: `Market Me Companion_1.19.0_x64-setup.exe`, **2,945,143 bytes**, SHA-256 `a6e784ead456daae32a38d38f79a3296b521f5c751e978bcaabaad85b0c3aeff`. It is unsigned and has not been installed or uploaded as a release asset. Native macOS/Linux support and signed distribution remain open.
- Added the disposable `scripts/qa-workspace-navigation.ts` fixture helper, which refuses non-`market_me_qa_*` databases. It is not an application seed or migration. `--no-memberships` is restricted to the synthetic account inside the isolated QA database.
- Cleanup verified no QA listeners or database sessions, then removed only the disposable fixture database. The application database and PostgreSQL volume were retained; recreating the container applied localhost-only port binding without a data reset.

Known limits: the calendar is an agenda, not recurrence/evergreen/quiet-hours/collision scheduling; overview counts are saved state, not live provider health or attributed results. Collection alerts depend on the enabled workflow collector and have no independent outage detection or external delivery. The broad connector, provider inbox/outreach, local AI, media, learning/experimentation, simple setup, and supported-OS requirements remain open.

Distribution checkpoint: public source publication to GDS-G/Market-Me is explicitly authorized. The reviewed baseline excludes private environment files, caches, runtime/test data, installer binaries, unrelated `null/`, and incomplete pnpm stubs. Git history and the first CI run identify the exact published source; a source push is not a hosted deployment, installer release, or production acceptance. Next implementation follows the [bounded scheduling plan](SCHEDULING_PLAN.md) without treating saved schedule enums as working features.

Rollback must retain migration 0108 and incident history. Stop/quiesce affected workflows and collector instances before changing worker code; older binaries lack the new queued-action checks and attempt fencing. Pre-1.19 Temporal replay compatibility is not established: inventory and reconcile completed/ambiguous provider outcomes, then cancel/recreate only remaining authorized work. Never resend uncertain delivery or resume an unsupported schedule with an older worker. The workspace cookie may be ignored by older pages, but does not convey access. No database down-migration is provided.

## 1.18.0 - Workspace Mastodon collector operations summary

Release 1.18 adds a tenant-scoped fleet view of the Release 1.17 operational states on Integrations.

- `MastodonStatusReportCollectionOperationsSummary` contains `total`, all six integer state counts, optional `oldestOverdueAt`, and optional `oldestAbandonedClaimAt`; it contains no provider/action/account/URL/credential/error identity.
- One PostgreSQL query classifies exact-workspace schedule rows with the same precedence/clock as per-action state, then aggregates counts and attention timestamps. The joined publication action must share the state workspace.
- Integrations renders the rollup only when schedules exist. Overdue or abandoned work produces `attention`; otherwise the card is `healthy`. This is local schedule posture, not provider health or a production readiness gate.
- No migration, environment variable, provider call, or worker mutation is added. Schema remains 107 migrations/128 public tables.
- Acceptance: 333 TypeScript and 3 Rust tests, all 37 live database tests, every gate, 89 pages, database rollup tests, browser Integrations QA, zero production vulnerabilities, and clean temporary state.
- Windows installer: `Market Me Companion_1.18.0_x64-setup.exe`, 2,944,526 bytes, SHA-256 `1a658790fa5b37a83e00f0a09daf6a89d37ab5448bedcf8b0c054cd33caa364e`.
- Rollback to 1.17 removes only the workspace summary; no data or migration rollback is needed.

Known limitation: the rollup is viewed on demand and does not yet deliver proactive backlog alerts.

## 1.17.0 - Mastodon collection operational states

Release 1.17 makes the durable Mastodon collector diagnosable without copying schedule truth into another mutable status column or exposing provider identity.

- `StoredMastodonStatusReportCollectionState.operationalStatus` is the closed union `pending|scheduled|retrying|overdue|collecting|abandoned`. It is derived at read time from PostgreSQL `now()`, `next_attempt_at`, `claimed_at`, `last_success_at`, `last_error_code`, and the same five-minute lease rule used by claiming.
- Precedence is deliberate: a claim older than five minutes is `abandoned`; a newer claim is `collecting`; an unclaimed due row is `overdue`; a future row with a closed error is `retrying`; a future successful row is `scheduled`; otherwise the initial future row is `pending`.
- The Campaign-run page renders `Mastodon collector: <state>` with next attempt, optional last success, optional closed result, and the existing manual refresh. The measurements API returns the same safe state dictionary.
- No migration or persisted status column is added. The 107-migration/128-table schema remains current, and there is no asynchronous status updater whose value can disagree with lease/due evidence.
- Live PostgreSQL acceptance exercises all six transitions plus abandoned-lease reclaim and monotonic attempt evidence. Browser acceptance proves the abandoned state with last success, transient result, and refresh control, then removes every disposable fixture/session/server artifact.
- Acceptance: 333 distinct TypeScript tests and 3 Rust tests; all 37 live PostgreSQL tests; every lint/type/build/native gate; 89 generated pages; clean 107-migration/128-table schema; worker/collector readiness QA; zero production dependency vulnerabilities; and clean QA ports/session/fixture/replay state.
- Windows installer: `Market Me Companion_1.17.0_x64-setup.exe`, 2,943,684 bytes, SHA-256 `8ffcd86d40b46e848be7bd91db1a20464a9b1425cca92e17edea5f3e4059fee9`.
- Rollback: deploy 1.16 code after stopping 1.17 web processes. The API field and UI label disappear, while schedule rows, claims, snapshots, collector behavior, and migration compatibility are unchanged.

Known limitation: states diagnose one schedule when it is viewed; this release does not add workspace-wide backlog alert delivery or change readiness based on provider backlog.

## 1.16.0 - Durable Mastodon aggregate-report collection

Release 1.16 turns explicit Mastodon aggregate refresh into an opt-in, restart-safe collection loop without broadening the privacy or provider authority established in 1.15.

- Every successfully completed Mastodon publication atomically receives one `mastodon_status_report_collection_state` row bound to the immutable publication action, workspace, status ID/URL, account ID, and instance origin. Migration `0107_mastodon_status_report_collection.sql` also backfills eligible historical successes; SHA-256 `840890e9581deba010e0fc25d0b011cc3d083e6d784125de278213261772f039`.
- Claims are ordered by due time and action ID, bounded to 1-50, isolated with `FOR UPDATE SKIP LOCKED`, and recover abandoned five-minute leases. Each claim revalidates the exact active Mastodon connection, `read_metrics` capability, tenant identity, immutable publication target, and maximum action age before returning encrypted credentials to the worker.
- `MastodonReportCollector` decrypts the existing connector token in process, constructs an exact-host-allowlisted connector, performs the same single aggregate-only Status read as manual refresh, rechecks the returned status URL, and records the immutable correction-aware snapshot through the existing transaction. It logs only batch counts.
- Success schedules the next read at the configured refresh interval. Authorization, validation, rate-limit, transient, permanent, ambiguous, credential-unavailable, and unknown outcomes are closed codes with bounded rate-aware/exponential delay; claim completion never fabricates a snapshot or count.
- The Campaign-run page and measurements API expose next attempt, last successful collection, and the latest closed result beside each exact Mastodon action. Manual authenticated refresh remains available and uses the same identity and snapshot boundary.
- Automatic collection is disabled by default. Enabling it requires `MASTODON_STATUS_REPORT_COLLECTION_ENABLED=true`, `CONNECTOR_TOKEN_ENCRYPTION_KEY`, and a nonempty exact `MASTODON_ALLOWED_HOSTS`; loop, batch, refresh, and maximum-age values are independently bounded.
- Acceptance: 333 distinct TypeScript tests and 3 Rust tests; all 37 live PostgreSQL tests; every lint/type/build/native gate; 90 web, 30 workflow-worker, and 81 connector tests; 89 generated pages; clean 107-migration replay with 128 public tables and no unvalidated constraints; collector/status/account/image/readiness loopbacks; browser schedule verification; and clean QA ports/session/fixture/replay state.
- Windows installer: `Market Me Companion_1.16.0_x64-setup.exe`, 2,944,514 bytes, SHA-256 `727211c73b16b3a67f6ba4fe71e986e1fc904c106b2bdb008d1cab34d995076f`.
- Rollback: disable collection, stop/drain 1.16 workflow workers, and wait for or recover five-minute claims before deploying 1.15 code. Retain migration 0107, immutable schedule identity, snapshots, totals, actions, and audits; 1.15 ignores the schedule table and its manual refresh remains valid.

Known limitations: the collector depends on the workflow worker rather than an independent service-level lease, collection success has no alert delivery, and disabled/too-old/drifted actions remain unscheduled until an operator repairs configuration or refreshes explicitly. Aggregates can decrease and never identify people, reach, attribution, sentiment, or conversions.

## 1.15.0 - Mastodon aggregate engagement reconciliation

Release 1.15 closes the first owned-social measurement loop with privacy-minimized, correction-aware aggregate metrics for statuses that Market Me successfully published.

- `MastodonAccountConnector.getStatusReport` performs one authenticated, redirect-rejecting, five-second, 64-KiB-bounded `GET /api/v1/statuses/:id`. It requires the exact local status ID, immutable publication account ID, and same-instance HTTPS URL, then returns only replies, boosts, favourites, and status creation time.
- Provider post HTML/text, interacting Account records, media, mentions, tags, and reaction identities are discarded at the connector boundary. Market Me never calls `reblogged_by` or `favourited_by`, and does not claim reach, impressions, unique people, sentiment, or attribution.
- `mastodon_status_report_snapshot` is immutable and content-addressed by exact status/account identity plus the three counts and creation time. The status URL is stored independently of mutable action/connection projections; repeated identical reads deduplicate while later provider corrections create retained successors.
- `campaign_provider_metric_total` now projects `mastodon_reply`, `mastodon_reblog`, and `mastodon_favourite` from their exact immutable Mastodon snapshot. The snapshot-source constraint prevents email and Mastodon provenance columns from being mixed. Count-only Campaign goals and existing idempotent success workflow signals use these totals without generating person-level events.
- Authenticated Campaign-run operators can refresh a succeeded Mastodon publication and see the latest bounded snapshot, observation time, and clearly labeled provider aggregate totals. The measurement API includes bounded Mastodon snapshot history beside existing Mailchimp history.
- Migration `0105_mastodon_status_reports.sql` adds the snapshot table, source-aware provider totals, closed metric vocabulary, and read-metrics capability; SHA-256 `b9a9cb949c162dfb704641b98f9f9ae66b262d0dbad394a81649ae6565f8624c`. Migration `0106_mastodon_status_report_identity_hardening.sql` immutably stores the exact provider status URL; SHA-256 `7284da6933d4a528f0b8f306c2bbeec787ef23b68829d04046e76be2b14c30c2`.
- Acceptance: 331 distinct TypeScript tests and 3 Rust tests; all 37 live PostgreSQL tests; every lint/type/build/native gate; 90 web, 28 workflow-worker, and 81 connector unit tests; 89 generated pages; clean 106-migration replay with 127 public tables and no unvalidated constraints; exact aggregate loopback/browser checks; zero production dependency vulnerabilities; and clean QA ports/session/fixture state.
- Windows installer: `Market Me Companion_1.15.0_x64-setup.exe`, 2,946,739 bytes, SHA-256 `c5fa1318c78fa2e8ea83129ef51b3f3c668a39d94f06e12890bee2329372c46f`.
- Rollback: stop 1.15 web/workflow processes before deploying 1.14 code. Retain migrations 0105/0106, immutable snapshots, provider-total projections, actions, and audits. Version 1.14 ignores the new rows; never convert aggregates into measurement events or delete snapshot history merely to roll back presentation.

Known limitations: refresh is explicit rather than scheduled. Counts are provider-reported current aggregates and may decrease; they do not identify people or prove visibility, attribution, conversion, sentiment, or causal impact. Quote counts, poll results, edit history, notifications, reply content, and interacting-account lists remain out of scope.

Official Mastodon contracts reviewed August 12, 2026: https://docs.joinmastodon.org/methods/statuses/#get, https://docs.joinmastodon.org/entities/Status/, and https://docs.joinmastodon.org/api/rate-limits/.

## 1.14.0 - Governed Mastodon reviewed-image publishing

Release 1.14 extends the owned Mastodon path with exact reviewed JPEG, PNG, and WebP attachments while preserving immutable asset evidence, live instance limits, durable ambiguity controls, and public-status idempotency.

- Connection testing now reads Mastodon `media_attachments` and `statuses.max_media_attachments` configuration. Market Me intersects advertised MIME types with JPEG/PNG/WebP and caps live values at four images, 10 MiB per image, 100 million pixels, and 1,500 alt-text characters; the saved capability manifest and safe configuration must agree exactly.
- Mastodon attachment rights reuse the existing reviewed `content_asset` model. Preview creation requires the exact Channel Connection, Campaign, Brand Profile, cleared rights revision, clean malware evidence, processed immutable asset/hash, provider-supported MIME type, verified dimensions, and approved nonempty alt text. Decorative-only images remain valid for Discord but are rejected for Mastodon.
- The connector uploads each image to `POST /api/v2/media` with multipart bytes and approved alt text, accepts bounded synchronous or asynchronous media identity, polls `GET /api/v1/media/:id`, and creates the public status only after every ordered provider media ID is ready.
- `mastodon_publication_media` binds publication action plus ordinal to the exact Content Asset UUID, SHA-256 snapshot, and provider media ID. IDs are persisted immediately after provider acceptance and reused on retry; rate/transient failures after a known upload do not re-upload. An uncertain upload or a crash before persistence forces manual reconciliation, and no automatic provider delete compensation is attempted.
- Migration `0103_mastodon_reviewed_images.sql` adds the durable media ledger and backward-compatible text-only/media capability constraint; SHA-256 `b8f1489ed94fc1d57d4ea595cc5f057c41f38b4a40428326e82d8a655a876c6b`. Migration `0104_mastodon_capability_constraint_hardening.sql` forces missing nested JSON capability fields to fail rather than pass as SQL `NULL`; SHA-256 `4fb9b04c8b7837645c3dce90f77b715cbf919e7a0e30bc065348bf37e64eb99a`.
- Acceptance: 329 distinct TypeScript tests and 3 Rust tests; all 37 live PostgreSQL tests; every lint/type/build/native gate; 90 web, 28 workflow-worker, and 79 connector unit tests; 89 generated pages; clean 104-migration replay; exact reviewed-image loopback and browser checks; zero production dependency vulnerabilities; and clean QA ports/session state.
- Windows installer: `Market Me Companion_1.14.0_x64-setup.exe`, 2,943,986 bytes, SHA-256 `254affbef9e02563dfb3a88573f2df384e834b16a73c30d83c59803e75a2f5ea`.
- Rollback: stop/drain 1.14 workers and disable Mastodon image-targeted execution before deploying 1.13. Retain migrations 0103/0104, media rows, actions, previews, rights, and audit evidence. Version 1.13 cannot execute image-bearing rows. Never rewrite them as text-only, re-upload an uncertain asset, or resend an uncertain status.

## 1.13.0 - Governed Mastodon account publishing

Release 1.13 adds the first owned social-network account adapter through Mastodon's official REST API while preserving the exact-preview, human-approval, durable-idempotency, and ambiguity-safe publication boundary.

- `CHANNEL_PROVIDERS` now includes `mastodon_account`; its live capability manifest is built from the instance's `max_characters` and `characters_reserved_per_url` status values, counts Unicode code points and provider-weighted URLs, supports text-only public status creation, claims provider IDs/idempotency, and honestly disables attachments, metrics, events, editing, deletion, and scheduling.
- `MASTODON_ALLOWED_HOSTS` is a deployment-owned comma-separated exact-host allowlist shared by the web control plane and workflow worker. Instance input must be an undecorated HTTPS origin on the default port; credentials, path, query, fragment, redirects, nonexact hosts, and arbitrary egress are rejected.
- Connection testing performs only `GET /api/v1/accounts/verify_credentials` and `GET /api/v2/instance`. The access token is encrypted alone; safe configuration stores host/origin, account ID, username/handle/profile URL, and the discovered integer limit.
- Runtime requires an exact ready preview plus human-approved Campaign step, decrypts the token, repeats both read-only checks, compares host/origin/account ID and the approved character limit, and stops before a publication action when either identity or limit drifted.
- Publication sends the exact preview once to `POST /api/v1/statuses` as explicit `{status,visibility:'public',sensitive:false}` JSON. The durable Campaign action key is supplied as Mastodon's `Idempotency-Key`; success requires a bounded status object with a stable ID and same-instance HTTPS URL.
- Network failure, redirect, 5xx, oversized/malformed success, missing identity, or cross-instance URL is ambiguous and cannot auto-resend. 401/403 are authorization failures; 429 uses `Retry-After` and then `X-RateLimit-Reset` evidence.
- Migration `0102_mastodon_account.sql` expands the closed provider constraint and requires capability-backed account identity plus exact live-limit agreement. SHA-256: `ffe22fc7b0879706e5180eb34f1c371c7049cb269a59aaf01a277df5c32653ec`.
- Acceptance: 325 distinct TypeScript tests and 3 Rust tests; all 37 live PostgreSQL tests; every lint/type/build/native gate; 90 web, 26 workflow-worker, and 77 connector unit tests; 89 generated pages; clean 102-migration replay; exact Mastodon loopback/browser checks; clean QA ports/session state; and zero production dependency vulnerabilities.
- Windows installer: `Market Me Companion_1.13.0_x64-setup.exe`, 2,942,952 bytes, SHA-256 `d260c47b6ee8caf3882cead1650e69914748d37aa67ec64633867383805f8efa`.

Known limitations: Release 1.13 supports only explicit public, non-sensitive, text-only statuses. It does not register OAuth applications, perform OAuth authorization, upload media, set content warnings/language/custom visibility, schedule/edit/delete statuses, ingest replies/metrics, support non-Mastodon ActivityPub servers by claim, or dynamically authorize an unapproved instance host. Operators must create a least-privilege user token with the provider-required status-write and account-read authority and explicitly allow the instance host.

Official Mastodon contracts reviewed August 12, 2026: https://docs.joinmastodon.org/methods/accounts/#verify_credentials, https://docs.joinmastodon.org/methods/instance/#v2, https://docs.joinmastodon.org/methods/statuses/#create, and https://docs.joinmastodon.org/api/rate-limits/.

## 1.12.0 - Governed Slack incoming-webhook distribution

Release 1.12 adds a second owned-community distribution adapter through Slack and GovSlack incoming webhooks while preserving exact-preview approval, encrypted credentials, ambiguity-safe replay suppression, and honest provider evidence.

- `CHANNEL_PROVIDERS` now includes `slack_webhook`; `SLACK_WEBHOOK_CAPABILITIES` advertises official text publishing, a conservative 4,000-character limit, one-message-per-second-per-channel guidance, no attachments, no metrics/events, and no provider message identity.
- URL validation accepts only exact HTTPS `hooks.slack.com` or `hooks.slack-gov.com` `/services/<team>/<service>/<secret>` paths with closed identifier shapes and no credentials, ports, query, or fragment. Only host/team/service identity leaves the encrypted credential boundary.
- Saving a connection posts one explicitly disclosed visible marker. Provider success requires HTTP 200 plus the exact bounded plain-text `ok` acknowledgement; the UI never describes this write as a read-only test.
- Runtime does not send a second preflight marker. It decrypts and reparses the URL, compares host/team/service with the saved target, requires an exact ready approved Draft preview plus human-approved Campaign step, begins the durable publication action, then performs one provider POST.
- Slack payloads set `mrkdwn:false`, `link_names:false`, `unfurl_links:false`, and `unfurl_media:false`; copy cannot silently become markup, expand a mass mention, or cause provider crawling. Market Me attachments are rejected before I/O.
- Incoming webhooks return no message timestamp/ID or URL. Successful evidence therefore stores `acknowledgement=ok`, `providerMessageIdAvailable=false`, and safe target identity while leaving provider external ID/URL absent. Uncertain network, 5xx, oversized, or unknown acknowledgements become ambiguous and cannot auto-resend.
- Migration `0101_slack_incoming_webhook.sql` expands the closed provider constraint and requires capability-backed safe Slack configuration. SHA-256: `c3d76ed97527abf130052af6837c8065992bbf0c7cae3a3bfcdb779ba393567e`.
- No environment variable is added; `CONNECTOR_TOKEN_ENCRYPTION_KEY` remains required. A real provider smoke test requires an operator-owned Slack app/webhook and intentionally creates visible messages.
- Acceptance: 317 TypeScript tests and 3 Rust tests; all 36 live PostgreSQL tests; every lint/type/build/native gate; 90 web, 24 workflow-worker, and 72 connector tests; 89 generated pages; clean 101-migration replay into 125 public tables; exact Slack loopback/browser/readiness checks; clean QA ports; and zero production dependency vulnerabilities.
- Installer `Market Me Companion_1.12.0_x64-setup.exe`: 2,945,935 bytes; SHA-256 `2b3091a3254f6246d2c1aaac8651908cb3696bee519fbdcd7bb3df3727edf0a2`.

Official Slack contracts reviewed August 12, 2026: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/, https://docs.slack.dev/apis/web-api/rate-limits/, and https://docs.slack.dev/messaging/formatting-message-text/.

## 1.11.0 - Durable managed-webhook health monitoring

Release 1.11 adds an opt-in workflow-worker monitor that periodically inventories managed Mailchimp webhooks and exposes durable missing, drifted, or secret-missing state without automatically changing provider configuration.

- Migration `0100_mailchimp_webhook_health_monitor.sql` adds one normalized schedule/lease/health row per managed Mailchimp connection with exact workspace, audience, callback, and provider webhook identity. SHA-256: `3018f22f2d4aea8416a2cb066172b88c9dffb48aabf5eaa70f543b74937212be`.
- Managed provision/rotation atomically upserts a due health row; manual-secret compatibility and disable delete it. Migration backfill accepts only active managed connections with strictly formatted identity and HTTPS callback metadata.
- Claims use ordered `FOR UPDATE SKIP LOCKED`, a five-minute stale-claim recovery window, exact active-connection/configuration identity joins, monotonic attempts, and bounded 1-50 batches. Concurrent workers cannot own the same check.
- `MailchimpWebhookHealthMonitor` decrypts one credential bundle in request scope. Missing local secret becomes `managed_secret_missing` without contacting Mailchimp; otherwise one five-second, 64-KiB inventory GET determines `managed_active`, `managed_missing`, or `managed_drifted`.
- The monitor never calls create, update, or delete. Provider/auth/rate/transient failures use the same closed error vocabulary and bounded rate-aware/exponential/permanent backoff. Last successful inventory health remains distinct from the latest provider-call error.
- Integrations shows the latest automatic health, last verified time, consecutive unhealthy/error count, and closed error code beside the live manual check/explicit repair controls; it exposes no key, signing secret, provider body, inventory, or unrelated webhook.
- Monitoring is disabled by default. `MAILCHIMP_WEBHOOK_HEALTH_MONITOR_ENABLED`, loop, batch, and interval variables have strict documented bounds; enabled startup requires `CONNECTOR_TOKEN_ENCRYPTION_KEY`.
- Acceptance: 309 TypeScript tests and 3 Rust tests; all 35 live PostgreSQL tests; every lint/type/build/native gate; 90 web and 22 workflow-worker tests; 89 generated pages; clean 100-migration replay into 125 public tables; exact send/report/collector/signature/lifecycle/health/readiness QA; clean ports; and zero production dependency vulnerabilities.
- Installer `Market Me Companion_1.11.0_x64-setup.exe`: 2,943,514 bytes; SHA-256 `86b7b13e0ab12bfeba10c61f4b407a91214b0405d299227731bf268988a43adc`.

## 1.10.0 - Managed Mailchimp webhook lifecycle

Release 1.10 removes the manual provider-console dependency from signed Mailchimp report acceleration: an authenticated workspace writer can create, inspect, replace, and remove the exact Campaign-only audience webhook while Market Me captures the shown-once signing secret directly into the encrypted connector vault.

- `MailchimpEmailConnector` now inventories, creates, and deletes audience webhooks through the official Marketing API. Create sends every recipient-bearing event as `false`, `campaign:true`, and only `admin:true`/`api:true`; response identity, callback, Boolean settings, audience, 64-KiB bound, and 16-256-character shown-once `signing_secret` are validated before use.
- Provider inventory is compared with the stored managed ID, exact connection callback, exact Campaign-only event/source map, and local-secret presence. The closed health vocabulary is `managed_active|managed_missing|managed_drifted|managed_secret_missing|manual_unverified|unmanaged_provider_webhook|disabled` and exposes no credential or provider body.
- Provisioning first inventories the exact audience. Existing resources require an explicit replacement confirmation; deletion is restricted to the exact callback and/or the provider webhook ID previously managed by that connection. Unrelated audience webhooks are never selected.
- Local persistence records safe provider ID, audience, callback, management mode, configured time, and Boolean signing state while the API key and shown-once secret remain together in the AES-256-GCM connector bundle. Audit data is minimized and secret-free.
- If Mailchimp creates an unexpected or secretless webhook, the connector removes it. If encrypted local persistence fails after a valid create, the route removes the new provider resource; cleanup uncertainty is surfaced explicitly instead of claiming success. Polling covers any rotation gap.
- Disable removes the stored managed provider resource when present, rewrites the encrypted bundle to API-key-only, clears managed metadata, and retains durable aggregate polling. A manual secret can still be stored through the compatibility API but is labeled unverified and cannot silently overwrite managed state.
- No migration or new environment variable is introduced. Release 1.10 retains the exact 99-migration/124-table contract and uses existing `PUBLIC_WEBHOOK_BASE_URL` plus `CONNECTOR_TOKEN_ENCRYPTION_KEY`.
- Acceptance: 306 TypeScript tests and 3 Rust tests; all 35 live PostgreSQL tests; every lint/type/build/native gate; 90 web tests and 67 connector tests; 89 generated pages; clean 99-migration replay into 124 public tables; exact send/report/collector/signature/lifecycle/readiness probes; clean QA ports; and zero production dependency vulnerabilities.
- Installer `Market Me Companion_1.10.0_x64-setup.exe`: 2,946,970 bytes; SHA-256 `721ec572c2b8295a29a00787de9cbc64939cccb2bb4293a5da9e573529ba0670`.

Official API and signing contracts reviewed August 12, 2026: https://mailchimp.com/developer/marketing/api/list-webhooks/ and https://mailchimp.com/developer/marketing/guides/sync-audience-data-webhooks/

## 1.9.0 - Signed Mailchimp report wakeups

Release 1.9 lets an authenticated Mailchimp Campaign-finished webhook make the exact aggregate-report schedule due immediately, without treating recipient-bearing webhook fields as measurements or retaining them.

- Mailchimp signing follows the current official Marketing webhook contract: HMAC-SHA256 over `{timestamp}.{raw_body}`, `X-Mailchimp-Signature: t=...,v1=...`, timing-safe comparison, and a five-minute replay window. The raw 32-KiB-bounded form body is verified before parsing.
- Only `type=campaign`, `data[status]=sent`, the configured audience, and a known provider Campaign ID can wake state. Subscribe, unsubscribe, cleaned, profile, email-change, and other recipient-bearing deliveries return no work and persist nothing.
- API keys and the one-time webhook secret share one versioned encrypted Mailchimp credential bundle; legacy API-key-only ciphertext remains readable. Browser data exposes only `webhookSigningConfigured=true`, never either secret.
- A writer-only Integrations control shows the exact public HTTPS callback and encrypts/rotates the one-time secret with a minimized audit. The callback's harmless GET returns no configuration; POST rejects wrong content type, oversized body, stale/malformed/tampered signature, inactive connection, or missing secret.
- Migration `0099_mailchimp_signed_webhook_wakeups.sql` adds only verified-signature hash/timestamp/receive time and a nonnegative wakeup count to schedule state. SHA-256: `9b7ba0079168538fa6d538414b087b5a01e5073f48c0c4da50c1748397af9dd9`.
- A newer exact delivery atomically moves `next_attempt_at` no later than now. It never clears an active claim, stores a payload, writes a metric, mutates Mailchimp, or bypasses the aggregate report adapter, snapshot hash, correction behavior, or success-command idempotency.
- Acceptance: 301 TypeScript tests and 3 Rust tests; all 35 live PostgreSQL tests; every lint/type/build/native gate; 89 generated pages; clean 99-migration replay into 124 public tables; exact send/report/collector/signature/readiness probes; clean QA ports; and zero production dependency vulnerabilities.
- Installer `Market Me Companion_1.9.0_x64-setup.exe`: 2,943,638 bytes; SHA-256 `981e87edaf74f8d358fa521fa1a0e689ecc41f01982dc657cbb137f97747b9f5`.
- Webhook provisioning remains operator-controlled in Mailchimp and requires `PUBLIC_WEBHOOK_BASE_URL`; production owners must select only Campaign sending, capture the one-time secret, monitor retries/disablement, and keep polling as completeness fallback.

Official contract reviewed August 12, 2026: https://mailchimp.com/developer/marketing/guides/sync-audience-data-webhooks/

## 1.8.0 - Automatic Mailchimp aggregate-report collection

Release 1.8 adds an opt-in, bounded report collector to the workflow worker so governed Mailchimp Campaign totals can refresh without an operator repeatedly pressing the existing read-only control.

- Migration `0097_mailchimp_report_collection.sql` adds one durable schedule/lease row per known Mailchimp publication, bounded attempts, next/claim/attempt/success times, and the closed safe failure vocabulary `authorization|validation|rate_limit|transient|permanent|ambiguous|credential_unavailable|unknown`. SHA-256: `f0a3106195ee14f634c034d2f3baca546695eb398666cb9971bd61580f2e6fc7`.
- Migration `0098_mailchimp_collection_audience_snapshot.sql` persists the exact audience captured by publication preflight, backfills legacy rows, and makes it required. Later connection edits cannot redirect collection or rewrite report provenance. SHA-256: `f0d4976f95a704204431888291a47333b68f850a949deb4c2fb4e362dd91aa2f`.
- Collection is disabled by default. `MAILCHIMP_REPORT_COLLECTION_ENABLED=true` requires `CONNECTOR_TOKEN_ENCRYPTION_KEY`; the loop, batch, refresh, and maximum-age variables have strict documented bounds.
- Due claims use `FOR UPDATE SKIP LOCKED`, a five-minute stale-claim recovery window, exact workspace/provider/active-connection joins, and an action-age ceiling. Each provider read has a five-second timeout and reuses the same 64-KiB aggregate-only adapter and transactional report/success path as manual refresh.
- Success reschedules at the configured refresh. Rate limits honor bounded `Retry-After`; transient/unknown outcomes use bounded exponential backoff; authorization, validation, permanent, and credential failures wait at least one hour. Only closed error codes reach SQL or logs.
- The Campaign-run page exposes next attempt, attempts, last success, and safe failure state without credentials. The connection creator is the automation actor for minimized audit attribution; this grants no new role or provider authority.
- Acceptance: 296 TypeScript tests and 3 Rust tests; all lint/type/build/native gates; 89 generated pages; all 35 live PostgreSQL tests; a clean 98-migration replay into 124 public tables; exact send/manual-report/automatic-collector/readiness checks; closed QA ports; and zero production dependency vulnerabilities.
- Installer `Market Me Companion_1.8.0_x64-setup.exe`: 2,945,202 bytes; SHA-256 `559de0c92a514476720d9ffb71b2bda0068900715d2db7cb36699e0c9f33b4be`.
- Provider-signed webhook acceleration, per-recipient activity, and a local suppression ledger remain out of scope. Production enablement still requires provider/network monitoring, credential rotation, and an operator-owned cadence/retention decision.

## 1.7.0 - Provider aggregate Campaign metrics

Release 1.7 integrates Mailchimp report totals into Campaign success evaluation while preserving their aggregate provider provenance and keeping external measurement ingest separate.

- `PROVIDER_AGGREGATE_METRIC_TYPES` defines six count-only signals: `email_sent`, `email_unique_open`, `email_unique_click`, `email_unsubscribe`, `email_bounce`, and `email_complaint`. `CAMPAIGN_METRIC_TYPES` combines those with normalized event types for Campaign criteria; `MEASUREMENT_EVENT_TYPES` and ingest-key authority remain unchanged.
- Migration `0096_campaign_provider_metric_totals.sql` adds one current total per publication action/metric with the exact immutable report-snapshot foreign key, Campaign instance, workspace, observation time, non-negative bigint constraint, and bounded instance lookup index. SHA-256: `5a362985855d4c4cc56fe2810aba17ec97b64ce837370aa5b5478bfb200b8a31`.
- Every report refresh atomically upserts all six totals from the same snapshot. Unique opens/clicks are used instead of raw repeated-open/click totals; bounce is the safe-integer sum of hard and soft bounces. A provider correction may decrease a current total without deleting immutable report history.
- Campaign success count criteria may use provider metrics; exact-currency value criteria remain limited to normalized measurement events. External measurement keys cannot submit provider aggregate types.
- `MeasurementSummary.providerTotals` identifies source explicitly while `totals` supplies the combined count view used by deterministic evaluation. The Campaign-run UI labels provider aggregates rather than calling them events.
- A threshold crossing queues the existing idempotent durable workflow command with `triggerSource=mailchimp_campaign_report` and a snapshot-derived `triggerKey`. A later provider correction does not erase an already-recorded workflow notification.
- Acceptance: 294 TypeScript tests and 3 Rust tests; all lint/type/build/native gates; 89 generated pages; a clean 96-migration replay into 123 public tables; exact send/report/readiness loopbacks; and zero production dependency vulnerabilities.
- Installer `Market Me Companion_1.7.0_x64-setup.exe`: 2,945,659 bytes; SHA-256 `6db3d5845b8b4e473cfd980e116d947dd2c2bf01e60e7072d301ada35a6008f5`.
- Automatic report polling and provider-signed webhook acceleration remain later work. Opens/clicks are aggregate provider observations and are not proof of a person, inbox placement, intent, or conversion.

## 1.6.0 - Recipient-free Mailchimp Campaign reports

Release 1.6 closes the first post-send visibility and reconciliation gap with a read-only, aggregate-only Mailchimp Campaign report path.

- `read_metrics` is enabled for Mailchimp. The connector requests only Campaign/list identity, send time, sent count, aggregate opens/clicks, hard/soft bounces, unsubscribes, and abuse reports; it never calls recipient, member-activity, open-detail, click-member, or email-activity endpoints.
- Report responses remain capped at 64 KiB. Every non-negative integer, timestamp, Campaign ID, audience ID, and unique-versus-total relationship is validated before persistence.
- Migration `0093_mailchimp_campaign_reports.sql` adds immutable content-addressed snapshots with exact action/workspace/Campaign binding and non-negative database constraints. Migration 0094 upgrades persisted Mailchimp capability manifests to `read_metrics=true`; migration 0095 persists the exact observed audience on every snapshot so later connection reconfiguration cannot rewrite history.
- A workspace writer can refresh one report from the Campaign-run page. Unchanged aggregates deduplicate by canonical SHA-256; changed totals create a new snapshot, preserving observation history rather than overwriting it.
- A returned sent-Campaign report can transactionally reconcile a failed, dispatching, or ambiguous publication to succeeded because it proves the known provider Campaign was sent. Reconciliation never creates, edits, or resends provider content.
- The UI and measurement API expose the latest aggregate snapshot beside the publication. Provider aggregates remain distinct from normalized Market Me measurement events and do not yet trigger Campaign success criteria.
- Acceptance: 293 TypeScript tests and 3 Rust tests; all lint/type/build/native gates; 89 generated pages; exact send/report/readiness loopbacks; a clean 95-migration replay into 122 public tables; and zero production dependency vulnerabilities.
- Migration SHA-256: 0093 `163b812bf94e59c5a741dc81c4073c6bdc94ddce288adbad065808037b0cb4f6`; 0094 `3552bc728ee4b1775bb36a38fda9b6705f1452b8c934ba4e904c773095e66dd3`; 0095 `b38c006eabe789ea33010643fd6503a7e3a548e0c79ce2c2eb2f23ef78e54568`.
- Installer `Market Me Companion_1.6.0_x64-setup.exe`: 2,944,804 bytes; SHA-256 `f5c6e53951e027c952920195f2a50ae0bb3082dab09343e6dde4121e60cb486e`.
- Automatic polling, provider-signed webhook acceleration, normalized metric deltas, and success-criteria integration remain later work. Opens/clicks are provider observations, not proof of a particular person or intent.

## 1.5.0 - Governed owned-email distribution

Release 1.5 adds the first owned email distribution path through Mailchimp Marketing while keeping audience membership, consent, unsubscribe, bounce, and complaint state provider-owned.

- `mailchimp_email` is a first-class Channel Connection with an encrypted API key and non-secret audience/sender configuration. Connection verification reads only bounded audience identity; APIs never accept a raw recipient list.
- Email previews add an exact immutable subject, provider subject/content limits, a tracked first-party HTTPS destination, and no attachments. Execution requires the exact ready preview and an approval-required Campaign step.
- The workflow performs audience preflight, Campaign creation, HTML/plain-content replacement, and immediate send. It stores the returned provider Campaign ID before content/send so a known partial attempt resumes instead of creating a duplicate.
- Unknown create/send outcomes become `ambiguous` and require manual reconciliation. Transient and rate-limit failures remain retryable only when a stable provider Campaign ID makes replay safe.
- Provider responses are capped at 64 KiB, HTML is escaped, linkification accepts only exact HTTPS lines, and every email includes Mailchimp's provider-managed unsubscribe merge tag.
- Migration `0092_mailchimp_email.sql` extends provider and preview constraints without storing addresses. SHA-256: `ec1482fce0857f03769e821b1ff29ef73ca5ba3b138c4ad49e5b83b70fd3e604`.
- Acceptance: 291 TypeScript tests and 3 Rust tests; lint, all workspace typechecks, web/companion builds, 89 generated pages, native check/test, a clean 92-migration replay into 121 public tables, exact four-request Mailchimp loopback acceptance, 200-to-503 worker-readiness degradation, and zero production dependency vulnerabilities.
- Installer `Market Me Companion_1.5.0_x64-setup.exe`: 2,945,353 bytes; SHA-256 `4c03a9b7c937ec45e497b4a1962f13caa74dee7c547f9615b89e517bf653c562`.
- A real provider smoke test still requires an operator-owned Mailchimp account, audience, sender identity, and API key. Delivery/open/click/bounce/complaint reconciliation and production webhook verification remain later work.

## 1.4.0 - Durable worker heartbeat readiness

Release 1.4 extends the web traffic gate from control-plane configuration/schema health to proof that both required background worker classes are currently alive.

- Migration `0091_service_heartbeats.sql` adds one bounded, instance-scoped `service_heartbeat` lease table for `ingestion_worker` and `workflow_worker`, plus an active-row freshness index. Its SHA-256 is `cf1bce8e99e964923d082e3242b82c3cc1b9b9afdd65f19ec46d6077a1d00d6c`.
- `OperationsRepository` writes heartbeats with database-owned time, marks a graceful stop explicitly, and computes both service freshness states in one database-clock query. `ServiceHeartbeatLease` owns a 5-through-60-second interval, prevents overlapping writes, and waits for an in-flight pulse before stop.
- Both workers generate a process-instance UUID and source their release version from package metadata. Initial heartbeat failure prevents startup; later failures are safely classified in logs and naturally make the lease stale. Shutdown marks the lease stopped before closing PostgreSQL.
- Production `/api/ready` now has nine closed checks and requires fresh ingestion and workflow leases. Development keeps both worker checks ready so a web-only development session remains usable. `SERVICE_HEARTBEAT_MAX_AGE_SECONDS` defaults to 120 and is bounded from 15 through 600; invalid production values fail closed.
- The database readiness contract advances to exactly 91 migrations ending at `0091_service_heartbeats.sql`. A stale pre-0091 schema reports migration and worker checks not ready while preserving successful connection evidence.
- Live acceptance observed both real 1.4.0 worker types writing active leases, proved graceful ingestion stop, replayed all 91 migrations into 121 public tables, and ran `qa:worker-readiness`: 200 with both fresh, then 503 after stopping workflow, with all generated rows and port 3114 removed.
- Full verification passed 282 TypeScript tests including 82 web and 35 live PostgreSQL tests, every workspace typecheck, web lint, 89-page production generation, companion/native builds, three Rust tests, and zero npm vulnerabilities.
- Installer `Market Me Companion_1.4.0_x64-setup.exe`: 2,945,441 bytes; SHA-256 `d50757ea5c009f5d46f50a9a3a4a82eb4a6e45dc4126e8a2d6df037c24325a47`.

Rollback to 1.3 only after removing the two worker checks from the deployment traffic policy. Retain migration 0091 and all heartbeat rows; they contain operational evidence, not tenant content. A 1.3 web process ignores the additive table. Stop 1.4 workers before replacing them and never forge or manually refresh rows to keep traffic flowing.

This release proves process-to-database liveness, not worker usefulness. It does not prove Temporal task-queue reachability, provider/object/ClamAV availability, queue progress, event age, backup freshness, or successful outbound work. Those require separate signals and alerts.

## 1.3.0 - Safe liveness and production readiness contracts

Release 1.3 separates “the web process can answer” from “the deployment is safe to receive traffic” and removes the stale hard-coded 1.0 version from health output.

- `/api/health` is dependency-free liveness with package-sourced version, UTC check time, `status=ok`, HTTP 200, and `Cache-Control: no-store`. It does not touch PostgreSQL or external providers and remains suitable for process restart decisions.
- `/api/ready` returns HTTP 200 only when seven closed checks are ready and HTTP 503 otherwise: database configuration, canonical application origin, production identity, production storage, production secrets, database connection, and exact migration state. Responses contain only check names/states, service/version/time, and no supplied values or raw errors.
- Production validation requires a PostgreSQL URL, canonical HTTPS `APP_BASE_URL`, HTTPS OIDC issuer/client, `MEDIA_OBJECT_STORE=s3`, complete object configuration, a 32-byte connector encryption key, a 32-character-or-longer media signing key, complete optional alert pairs, a vault key when AI execution is enabled, and HTTPS optional webhook origin.
- The database probe uses one connection, a five-second connect timeout, a one-second idle/close timeout, `SELECT 1`, and exact `schema_migration` evidence: 90 rows ending at `0090_workspace_invitations.sql`. Reachable-but-stale schema is distinct from connection failure.
- Four new tests prove complete production readiness, unsafe fail-closed behavior before probing, stale-schema distinction, hidden database error details, insecure-origin/storage/secret rejection, and closed output. Live HTTP acceptance returned 1.3.0, 200/ok liveness and 200/ready with all seven checks against the local migrated database, then stopped the server with port 3000 closed.
- Full verification passed 279 TypeScript tests including 80 web and 34 live PostgreSQL tests, all typechecks, web lint, the 89-page-generation production build including `/api/ready`, companion/native builds, three Rust tests, and zero npm vulnerabilities.
- Installer `Market Me Companion_1.3.0_x64-setup.exe`: 2,943,795 bytes; SHA-256 `a8f52bd39214434e9949ea4570f09c92cafe74c214b1eb0ea3e39de25240216e`.

Rollback to 1.2 removes `/api/ready` and restores the misleading stale health version. Configure the load balancer to stop relying on readiness before rollback, or preferably retain an external equivalent; do not use liveness as a database/schema readiness substitute.

This is web-control-plane readiness, not whole-system readiness. Ingestion/workflow worker heartbeats, Temporal connectivity, live object-provider I/O, ClamAV, provider availability, alert delivery, and infrastructure monitoring remain separate operational work.

## 1.2.0 - Executable PostgreSQL recovery proof and cross-plane runbook

Release 1.2 turns the prior backup requirement into repeatable local restore evidence and documents the production recovery boundary across PostgreSQL, immutable objects, Temporal, providers, secrets, and external logs.

- `scripts/qa-database-recovery.mjs` refuses to run unless `QA_DATABASE_RECOVERY_ACKNOWLEDGE_QUIESCED=true`, validates every operator-supplied identifier, and invokes Docker/PostgreSQL tools with argument arrays rather than a shell command string.
- The harness captures sorted public-table row counts and ordered migration checksums, creates a compressed custom-format no-owner/no-privilege dump, inspects its archive listing, proves the source did not change during backup, and restores with `pg_restore --exit-on-error` into one random `template0` database.
- Acceptance compares all restored public table names/counts, every migration version/checksum, and public constraint validation. A `finally` block force-drops only the generated database and removes only its random container `/tmp` dump, including on failure.
- Live recovery acceptance restored 120 public tables and all 90 migrations in 38,091 milliseconds, reported success without row or credential content, then verified zero generated recovery databases and dumps remained. This fixture duration is explicitly not a production RTO.
- `docs/RECOVERY.md` assigns recovery ownership and specifies PITR/WAL plus independent logical backup, encrypted immutable/off-account copies, object-version alignment, Temporal history compatibility, provider ambiguity handling, key custody, validation gates, staged service restart, failure scenarios, and drill triggers. Numeric RPO/RTO remain an explicit operator approval rather than an invented application default.
- Full verification passed 275 TypeScript tests including 34 live PostgreSQL and 24 media tests, all workspace typechecks, web lint, the 90-page-generation production build, companion/native builds, three Rust tests, fresh replay of all 90 migrations, recovery safety-interlock refusal, and zero npm vulnerabilities.
- Installer `Market Me Companion_1.2.0_x64-setup.exe`: 2,947,217 bytes; SHA-256 `8adf406b4efbaf61d80a4a6eb39d9ad4955c36439f2f5c13c42f9b7aa67689bc`.

Rollback to 1.1 changes no database schema. Preserve the recovery runbook and evidence even if the QA command is absent, retain every backup/object version/Temporal history, and never restore over the primary or resume outbound actions merely to complete an application rollback.

This release proves local logical portability but does not schedule production backups, configure PITR/WAL, provision immutable copies, back up Temporal, restore S3 versions, or choose RPO/RTO. Those controls require the selected infrastructure and responsible operators; Release 1.3+ continues deployment hardening.

## 1.1.0 - Production S3-compatible immutable object storage

Release 1.1 replaces four process-local filesystem constructions with one configuration-driven object-store boundary shared by the web server, companion upload path, ingestion worker, and workflow worker.

- `S3ObjectStore` uses AWS SDK v3, path-safe internal keys, an optional normalized deployment prefix, `If-None-Match: *` conditional creation, precomputed SHA-256 checksum headers, and an independent SHA-256 metadata value. A precondition failure succeeds only after the stored bytes match; a same-key/different-byte result is an immutable collision.
- Reads are bounded to a configured 1 KiB through 50 MiB maximum and verify any returned S3 checksum and Market Me checksum metadata. Writes above the same bound are refused so an idempotent replay can always be verified.
- `createObjectStoreFromEnvironment` is the sole runtime construction path. Development defaults to the existing ignored filesystem root. `NODE_ENV=production` fails closed unless `MEDIA_OBJECT_STORE=s3`; an explicit production-compatible endpoint must use HTTPS. Static credentials must be a complete pair, while omitted credentials use the SDK's workload identity/credential chain.
- `.env.example` documents the bucket, region, endpoint, addressing mode, prefix, optional credentials/session token, and maximum object size. No credential or object byte enters PostgreSQL, a browser bundle, an audit dictionary, or a QA artifact.
- Automated verification passed 275 TypeScript tests including 34 live PostgreSQL tests and 24 media tests, every workspace typecheck, web lint, the 90-page-generation production build, companion web/native builds, three Rust tests, and isolated replay of all 90 migrations. npm reported zero vulnerabilities.
- Live SDK acceptance used a disposable loopback S3-compatible endpoint and proved signed conditional creation, same-byte idempotent replay, checksum-verified read, and different-byte collision rejection. The endpoint held objects in memory only and was stopped with port 3102 closed.
- Installer `Market Me Companion_1.1.0_x64-setup.exe`: 2,944,030 bytes; SHA-256 `0025a9b463915c440c4eaf10864f929a642e09301a882a040b6a17eda6ea5729`.

Rollback to 1.0 changes no database schema, but 1.0 cannot access an S3 deployment. Stop writers before rollback, retain the bucket and its versions, and restore 1.1 or a forward-compatible adapter before resuming production. Never copy production objects into a repository directory or weaken conditional-write/checksum rules as a rollback shortcut.

This release supplies the application adapter, not the provider control plane or a completed recovery program. Before production, independently enforce and restore-test bucket versioning, server-side encryption (preferably KMS-backed), least-privilege bucket policy, public-access blocking, retention/lifecycle, replication or backup, access logging, alerts, and PostgreSQL/Temporal recovery.

## 1.0.0 - Production OIDC identity and workspace invitations

Release 1.0 closes the production-login dead end. A production build can now delegate authentication to one standards-compliant OpenID Connect provider while Market Me retains its existing hash-only database session and tenant-membership authorization boundary.

- Authorization uses Code plus PKCE S256, 256-bit state and nonce, a ten-minute one-use database state, and a browser-bound HttpOnly SameSite=Lax cookie. Redirects and return paths are canonicalized; production issuer/discovery/token/JWKS endpoints require HTTPS.
- ID tokens are accepted only after RS256/JWKS signature verification, exact discovery issuer, issuer/audience/authorized-party, expiry/issue/not-before, nonce, bounded subject, and verified-email checks. Provider errors are reduced to closed safe codes; credentials, codes, token bodies, state, nonce, and email never enter audit dictionaries.
- Migration `0089_oidc_authentication.sql` adds `oidc_auth_state` and immutable `(issuer, subject)` identity links. SHA-256: `aea5fc5664ae6038eaa575424abe6a0eebda7dd9b3a88940ca35c30a3f24efb5`.
- Migration `0090_workspace_invitations.sql` adds exact normalized-email, expiring, non-owner workspace grants with pending/accepted/revoked state and tenant/actor constraints. SHA-256: `804fe23da145a04bb5370dd7b200b395217b66add312b4ab75bda850aa110b25`.
- The Team surface lets owners/administrators create seven-day invitations, review status, and revoke pending grants. Acceptance atomically creates or links the account, adds organization/workspace membership, consumes matching live invitations, links the provider identity, and records minimized audit events.
- Full verification passed 269 TypeScript tests including 34 live PostgreSQL tests, every workspace typecheck, web lint, a 90-page-generation production build, companion web/native builds, three Rust tests, and isolated replay of all 90 migrations. npm's lock-only audit reported zero vulnerabilities.
- Browser acceptance completed a real cross-origin discovery/authorization/callback/token/JWKS round trip against the disposable QA provider, produced an owner session, rendered Team membership, created and revoked an editor invitation, and reported zero warning/error diagnostics. The exact QA organization, account, identity, invitation, sessions, provider, server, and temporary state were removed.
- Installer `Market Me Companion_1.0.0_x64-setup.exe`: 2,946,935 bytes; SHA-256 `dc478c23fc13d8919d9dc5b0ff14f541da2dfff4e48fc751935cf887e2c52695`.

Rollback to 0.99 retains migrations 0089-0090 but has no OIDC routes or invitation UI. Keep production access disabled until 1.0 or a forward-compatible release is restored; do not re-enable development login in production or delete identity/invitation evidence as a rollback shortcut.

This release is a production-authentication milestone, not completion of the entire original five-phase specification. The next readiness work remains production storage/backup recovery and deployment hardening, followed by the still-unimplemented distribution, discovery/outreach, cross-platform delivery, and hosted-model/evaluation outcomes documented in the roadmap.

## 0.99.0 - Exact Brand Profile asset rights

Release 0.99 closes the Brand reassignment gap left by exact Campaign grants. A Campaign may continue using a governed image across versions of the same stable Brand Profile, but changing to another Brand Profile—or removing Brand identity—invalidates preview and execution authority.

- Migration `0088_content_asset_rights_brand_profiles.sql` adds normalized `(content_asset_id, brand_profile_id)` authority and `draft_channel_preview_asset.rights_brand_profile_id`. It invalidates legacy cleared snapshots, uses deferred `NO ACTION` Brand foreign keys for safe workspace cascades plus standalone in-use deletion protection, and is immutable at SHA-256 `4f445557973ce3527267dbde3cd474f0429dd3ac7d97b25940d161f7c2a3ed2f`.
- Rights review now accepts deduplicated `permittedBrandProfileIds`, validates every stable Brand Profile root inside the writable workspace, replaces the relation transactionally, increments `rights_revision`, and audits only `permittedBrandProfileCount`. Package approval may retain an empty list; governed image preview may not.
- The Content Package UI receives only published Brand Profile ID/name/status, shows exact Brand checkboxes, persists selected roots, and hydrates selected names as rights evidence. Stable root scope allows an ordinary published Brand version upgrade without broadening identity.
- Preview creation derives Brand identity from the Draft generation's Campaign version, requires a live grant, and snapshots the root ID. Preview listings, Campaign activation, publication targeting, and the worker require the snapshot and active Campaign version Brand to agree before object storage or provider I/O.
- Integration coverage proves grant hydration, live relation removal/restoration, Campaign reassignment to an unauthorized Brand being rejected, and worker mismatch rejection before media/provider side effects. Unbranded Campaigns cannot publish governed image attachments.
- Verification passed 256 TypeScript tests including all 30 PostgreSQL tests, every workspace typecheck, web lint, 87 pages/routes, companion/native builds, three Rust tests, and a fresh replay of all 88 migrations. Health returned 200/version 0.99.0 and a schema-valid unauthenticated rights PUT returned 401.
- Browser acceptance began with both published Brands unselected and the exact Campaign already selected, persisted only `R099 Authorized Brand` at rights revision 3, excluded the other Brand, reported zero warnings/errors, and removed exact fixtures and temporary runtime artifacts.
- Installer `Market Me Companion_0.99.0_x64-setup.exe`: 2,948,079 bytes; SHA-256 `9ebb73a8ce4b0b32442337ea32e60ea6680688843f52ad9401c4969b751f394c`.

Rollback to 0.98 retains migration 0088 and its snapshot invalidation. Because 0.98 cannot author or revalidate exact Brand grants, disable outbound governed image previews and publishing until 0.99 or a forward-compatible release is restored.

## 0.98.0 - Exact Campaign asset rights

Release 0.98 closes the gap between approving reusable content and authorizing an exact outbound Campaign. A cleared image may approve its Content Package before a Campaign exists, but it cannot enter a channel preview or provider execution until the source original explicitly grants that exact Campaign.

- Migration `0087_content_asset_rights_campaigns.sql` adds normalized `(content_asset_id, campaign_id)` authority and `draft_channel_preview_asset.rights_campaign_id`. It invalidates legacy cleared preview snapshots, uses deferred `NO ACTION` Campaign foreign keys for safe workspace cascades plus standalone in-use deletion protection, and is immutable at SHA-256 `2fdde08ec2679956ea2fe02291f67c627e4639385c5748a2fb78d772bed724e4`.
- Rights review now accepts a deduplicated `permittedCampaignIds` list, validates every Campaign inside the writable workspace, replaces the relation transactionally, increments `rights_revision`, and audits only `permittedCampaignCount`. An empty list is valid so package approval can remain the first lifecycle stage.
- The Content Package UI receives only Campaign ID/name/status, shows exact Campaign checkboxes, persists selected IDs, and hydrates selected names as rights evidence. Operators approve the package, create a Campaign, then revisit the package to grant attachment use.
- Preview creation requires the draft's exact Campaign to be in the live authority relation and snapshots that Campaign ID. Preview listings, Campaign activation, publication targeting, and the workflow worker all require snapshot Campaign, current Campaign, and live grant to agree before object storage or provider I/O.
- Verification passed 255 TypeScript tests including all 30 PostgreSQL tests, every workspace typecheck, web lint, 87 pages/routes, companion/native builds, three Rust tests, and a fresh replay of all 87 migrations. Health returned 200/version 0.98.0 and a schema-valid unauthenticated rights PUT returned 401.
- Browser acceptance began with both Campaigns unselected, persisted only `R098 Authorized Campaign` at rights revision 2, excluded the unselected Campaign, reported zero warning/error diagnostics, and removed all exact fixtures and temporary runtime artifacts.
- Installer `Market Me Companion_0.98.0_x64-setup.exe`: 2,944,260 bytes; SHA-256 `3e3dc2675dbc98c53dc314b1937c746fa7a503447e39836aad86be3fc91e5ea5`.

Rollback to 0.97 retains migration 0087 and its snapshot invalidation. Because 0.97 cannot author or revalidate exact Campaign grants, disable outbound image previews and publishing until 0.98 or a forward-compatible release is restored; never delete authority rows or weaken the constraints as a rollback shortcut.

## 0.97.0 - Exact publishing-account asset rights

Release 0.97 closes the gap between provider permission and account permission. A cleared image must now name the exact workspace Channel Connection accounts on which it may be published.

- Migration `0085_content_asset_rights_channel_connections.sql` adds the normalized `(content_asset_id, channel_connection_id)` authority relation and exact account ID to preview snapshots. It revokes every provider-only legacy clearance to `restricted` and invalidates legacy cleared snapshots. SHA-256: `05b9d94bb2a8fbd10dc092d1a0041e88bdb7a96cf3925ff7a332a786283d9ff4`.
- Migration `0086_rights_channel_connection_deferred_delete.sql` preserves in-use account deletion protection while deferring the foreign-key check so a complete workspace cascade can settle atomically. SHA-256: `5addde3246477e9bcb6cf8b3a4750a236114b1ee13b515d2701f76dda1facb51`.
- Rights review accepts a deduplicated `permittedChannelConnectionIds` list, validates every ID against the writable workspace and a permitted provider, replaces the relation transactionally, increments the rights revision, and audits only the selected count.
- The Content Package UI lists workspace publishing accounts, requires at least one exact account for clearance, persists only selected IDs, displays their names as evidence, and keeps package approval disabled without account scope.
- Preview creation rejects an unselected account and snapshots the selected connection ID. Preview staleness, Campaign activation, publication targeting, and the workflow worker all revalidate both the snapshot ID and live authority relation before media or provider I/O.
- Verification passed 254 TypeScript tests including all 30 PostgreSQL tests, every workspace typecheck, web lint, 87 pages/routes, companion/native builds, three Rust tests, and fresh replay of all 86 migrations. Browser acceptance persisted one selected account, excluded an unselected account, approved the package, reported zero warnings/errors, and removed exact fixtures.
- Installer `Market Me Companion_0.97.0_x64-setup.exe`: 2,945,036 bytes; SHA-256 `4ff06eda21b86018eeccc97c24d1928730b2ede602cb71d9c567f1dfab842c37`.

Rollback to 0.96 retains migrations 0085-0086 and their revocations. Keep outbound image publishing disabled because 0.96 cannot author or revalidate exact account scopes; use only a forward migration for schema changes.

## 0.96.0 - ClamAV malware evidence and clean-only media execution

Release 0.96 replaces evidence-free malware flags with a real optional scanner integration and makes clean scan evidence mandatory across every outbound image boundary.

- `ClamAvInstreamScanner` implements the official bounded `zINSTREAM` protocol. The worker selects it through `MALWARE_SCANNER=clamav`; local compose pins ClamAV 1.5.3, persists signatures, and binds port 3310 to loopback only.
- `MediaProcessor` scans before immutable storage, rejects infected bytes, and persists status, engine, timestamp, and revision on originals/derivatives. Unconfigured, failed, malformed, oversized, disconnected, or timed-out scans never become clean.
- Migration `0084_content_asset_malware_scan_evidence.sql` revokes legacy clean flags without evidence, constrains future clean assets/snapshots, and adds a review index. SHA-256: `bec6747fd0be23fca4d43faec05dc0e65b54f1c4cb55025ee1664601c75eca47`.
- Package approval, preview selection/creation, stale detection, Campaign activation, publication targeting, and worker media loading require current clean evidence and matching revision. Rescanning invalidates old previews.
- Verification passed 253 TypeScript tests including all 30 PostgreSQL tests, every workspace typecheck, web lint, 87 pages/routes, companion/native build, three Rust tests, fresh replay of 84 migrations, live clean/EICAR scanning, live worker evidence persistence, browser/auth QA, and exact cleanup.
- Installer `Market Me Companion_0.96.0_x64-setup.exe`: 2,945,426 bytes; SHA-256 `5b2e2f0735323a4b7da86f7050cca121a88c9ec0f953c294c93a534fd74d5165`.

Rollback to 0.95 retains migration 0084 and all scan evidence. Keep outbound media disabled; do not restore legacy clean flags or treat `not_configured` as safe.

## 0.95.0 - Evidence-backed asset publication rights

Release 0.95 replaces the legacy bare image-rights flag with review evidence and makes that evidence revocable across the complete outbound path.

- Migration `0083_content_asset_rights_reviews.sql` adds owner/license/source/proof, permission Booleans, permitted channels, validity windows, unsupported obligations, reviewer/time/note, and monotonic revision. It revokes old bare clearances and adds constrained preview snapshots. SHA-256: `a2e15d31eb69b7414d85931c908bfa6f290aab5e84d2c8ad85a12001afe8c6bd`.
- Writers can record `restricted` or `cleared` through one strict PUT route and UI. Clearance requires worldwide commercial and derivative use, Discord scope, current dates, evidence, reviewer identity, and no unsupported attribution/watermark/disclaimer requirement. Derivatives inherit original-image rights.
- Package approval and preview creation require current clearance. Saved previews capture rights revision/review/expiry, become stale after withdrawal or scope/date changes, and are revalidated during Campaign activation, publication-target resolution, and worker execution before media/provider I/O.
- Verification passed 249 TypeScript tests including all 30 PostgreSQL tests, every workspace typecheck, web lint, the 87-page/route production build, companion build, native check, three Rust tests, and fresh replay of all 83 migrations. Health returned 200/version 0.95.0; a valid unauthenticated rights PUT returned 401.
- Browser acceptance proved unchecked and restricted assets cannot approve, recorded restricted revision 1, recorded complete clearance revision 2, approved the package, and produced no console errors. Exact fixtures and temporary runtime artifacts were removed and verified.
- Installer `Market Me Companion_0.95.0_x64-setup.exe`: 2,946,137 bytes; SHA-256 `274f25a984b0c809d7d70eb3f6300aadfd1085f51433f572e6883a5aced84b18`.

Rollback to 0.94 retains migration 0083 and every rights review. It must not restore legacy bare clearances or permit outbound images without 0.95 current-rights revalidation; use a forward migration for schema correction.

## 0.94.0 - Recent legal-hold decision history

Release 0.94 closes the workspace operations audit gap left when an approved release removes a case from the active queue or a rejection removes its pending request. Authorized operators now see the latest approved and rejected release decisions, including the original request rationale and independent decision evidence.

- Migration `0082_conversation_legal_hold_decision_index.sql` adds a partial B-tree index on `(workspace_id, decided_at DESC, id)` for approved/rejected requests. Applied SHA-256: `e583b92bc225d1eac6bc2bf6918d9372b171142d286fe7d0e05ec259d2336dcb`; all 82 checksums replay unchanged.
- `listRecentLegalHoldReleaseDecisions(workspaceId)` returns only `approved|rejected` request rows, newest decision first, with a hard limit of 200 and the same optional live subject/relationship labels as the active queue.
- The Conversations page and retention-policy GET load the projection only for owner, administrator, editor, or approver. Analyst and viewer clients receive an empty array and zero `recentLegalHoldReleaseDecisionCount`.
- The UI shows the newest 20 decisions with status, target class, request note, requester, decision note, decider, decision time, and a source-thread link only while the live thread still exists. It adds no action control or mutation path.
- Verification passed 248 TypeScript tests including all 30 PostgreSQL tests, every workspace typecheck, web lint, the 87-page/route production build, companion build, native check, three Rust tests, and checksum replay of all 82 migrations. Health returned 200/version 0.94.0; unauthenticated policy and valid mutation requests returned 401.
- Browser acceptance displayed one active hold plus newest-first rejected and approved history cards with complete requester/decider rationale evidence. Exact user, membership, relationship, thread, hold, and request fixtures were deleted and verified at zero.
- Installer `Market Me Companion_0.94.0_x64-setup.exe`: 2,944,021 bytes; SHA-256 `fd153a114c32544d815ed9429865e962ad7ae5e62bb6e91167dc7d4132d6b6d4`.

Rollback to 0.93 removes the new projection and UI only. Retain migration 0082, all decision rows, and all prior governance evidence; no down migration or ledger deletion is required.

## 0.93.0 - Workspace legal-hold operations queue

Release 0.93 makes the 0.92 separation-of-duties workflow operationally discoverable. Authorized writers and approvers now receive a bounded workspace projection of active legal holds and pending release requests on the Conversations retention-governance surface; a different approver can decide a pending release without already knowing the exact thread URL.

- No migration. Applied migration 0081 remains immutable at SHA-256 `71148c414791e5ecadd8869bc6a16d31a3825bf36bf7123f87f6c49532dee918` and all 81 migration checksums replay unchanged.
- `listActiveLegalHolds` and `listPendingLegalHoldReleaseRequests` return at most 200 workspace-bound records with hydrated live subject/relationship labels. Per-thread history and exact request reads now hydrate the same optional labels; no label is copied into governance storage.
- The Conversations page and retention-policy GET load these projections only for owner, administrator, editor, or approver roles. Analyst and viewer clients receive empty operations arrays, preventing a workspace-wide disclosure expansion of case reasons and references.
- The queue shows active reason/reference, placer/time, exact thread navigation, pending target/requester, and role-aware decisions. It reuses the 0.92 decision route; approval retains the explicit “retention eligibility may resume” confirmation, while self-requesters see the different-approver rule.
- Verification passed 248 TypeScript tests including all 30 live PostgreSQL tests, every workspace typecheck, web lint, the 87-page/route production build, native check, three Rust tests, and checksum replay of all 81 migrations. Health returned 200/version 0.93.0; browser QA discovered and rejected a different requester’s pending release from the workspace queue, reloaded to “No release request is pending,” and cleaned every fixed-ID fixture to zero.
- Installer `Market Me Companion_0.93.0_x64-setup.exe`: 2,946,946 bytes; SHA-256 `62caad12b01b2ebef6ccfda95c2fd10c5aacfc909c14f198a9b0cceeaf2595c9`.

Known limitations: the queue is capped at 200 and has no search, pagination cursor, assignee, per-user unread/acknowledgement, reminder, notification delivery, expiry, jurisdiction/custodian fields, external case sync, or released-history view. Exact-thread history remains the authoritative detailed record.

Rollback to 0.92 removes only the workspace queue/projection. Retain migration 0081, every hold/release/audit row, and all active case effects; exact-thread placement, requests, and decisions remain available.

## 0.92.0 - Reasoned legal-hold cases and approved release

Release 0.92 closes the direct-retention-class loophole around legal hold. A workspace approver places a reasoned case; a writer requests release to one exact non-hold class; and a different approver approves or rejects that release. Ordinary class updates can neither create nor remove a hold.

- Migration `0081_conversation_legal_hold_cases.sql` adds an immutable case/release-request ledger, tenant-consistent composite identity, one active hold per thread, one pending release per hold, closed state constraints, requester/decider separation, and monotonically increasing thread-retention revisions. SHA-256 is `71148c414791e5ecadd8869bc6a16d31a3825bf36bf7123f87f6c49532dee918` and matches the applied ledger.
- Hold placement requires owner/administrator/approver authority plus a 3-1,000 character reason and optional 1-200 character case reference. Release requests require owner/administrator/editor authority and a target of `standard`, `personal_message`, or `imported_email`; approval or rejection requires a different owner/administrator/approver.
- Placement and approved release each increment `conversation_thread.retention_revision`. Every erasure request snapshots that revision, so an approval created before a hold remains stale even after the hold is released back to the same class and eligibility timestamp.
- The hold and release-request rows intentionally retain scalar thread IDs without foreign keys to content. They preserve governance history after a later approved erasure but copy no subject, relationship label, message body, identity, provider payload, credential, or AI output. Legal-hold audits omit reason, case reference, request note, and decision note.
- APIs are POST `/api/v1/conversations/[id]/legal-holds`, POST `/api/v1/conversation-legal-holds/[id]/release-requests`, and POST `/api/v1/conversation-legal-hold-release-requests/[id]/decision`. The conversation page displays the active reason/case, hides direct hold-class controls, and confirms an approved release may resume retention eligibility.
- Verification passed 248 TypeScript tests including all 30 live PostgreSQL tests, every workspace typecheck, web lint, the 87-page/route production build, native check, all three Rust tests, and checksum replay of all 81 migrations. Health returned 200/version 0.92.0 and all three unauthenticated legal-hold mutations returned 401. Authenticated browser QA placed a reasoned hold, requested release, showed the different-approver rule, and cleaned the exact fixture to zero rows.
- Installer `Market Me Companion_0.92.0_x64-setup.exe`: 2,945,021 bytes; SHA-256 `e9d86d9c40c2248e10bfd681820bceee77ba93320bad7261fff0731363e40a36`.

Known limitations: holds do not yet include jurisdiction, custodian, legal-basis taxonomy, attachment/evidence storage, expiry/reminders, cross-aggregate scope, provider/object/workflow/backup propagation, or external case-system synchronization. Production use requires reviewed legal procedures, least-privilege administration, protected audit retention, monitoring, and explicit backup/provider handling.

Rollback may deploy 0.91 UI/repository code only after disabling all three 0.92 mutation routes. Retain migration 0081 and every hold/release/audit row. Active holds must remain effective; never downgrade them by writing `retention_class` directly, decrementing `retention_revision`, or deleting governance evidence.

## 0.91.0 - Approved conversation retention erasure

Release 0.91 converts the existing closed-thread retention preview into a deliberately approved execution boundary. A writer requests erasure for one exact eligible conversation, a different owner/administrator/approver decides it, and execution deletes only that thread plus its foreign-key-owned conversation children in one transaction.

- Migration `0080_conversation_retention_erasure.sql` adds the immutable tenant ledger, pending uniqueness, closed statuses, bounded request/decision justification, strict decision-state checks, and database-enforced requester/decider separation. SHA-256 is `cb1cc8db18c55dc7072c5895314a5ded313a68eb884b65ae7152e2abf83dbd4e` and matches the applied ledger.
- Request authorization is owner/administrator/editor; execution or rejection is owner/administrator/approver. The requester can never decide the same request, including when that requester is an owner.
- Request and execution transactions lock and rederive the policy, closed status, explicit class, last activity, and eligibility time. A disabled policy, active thread, future window, legal hold, missing thread, or changed policy/class snapshot fails closed.
- Execute counts and then removes the exact `conversation_thread`; existing tenant composite foreign keys cascade messages, handoffs, read state, drafting presence, response suggestions/drafts, review requests/mentions, and shared-resource evidence. Relationship, Campaign, Destination, Brand, account, publication, workspace, and general audit roots are not deleted.
- The retained request/decision ledger has no foreign key to the erased thread and copies no subject, relationship name, message, note, identity, provider payload, or credential. It retains IDs, explicit class/eligibility, actor/time/status, bounded governance notes, and aggregate deleted-row counts. UI joins names only while the thread still exists.
- APIs are POST `/api/v1/conversations/[id]/retention-erasure-requests` and POST `/api/v1/conversation-retention-erasure-requests/[id]/decision`; the policy GET also returns the bounded queue. The UI has no bulk or automatic purge and requires an explicit irreversible confirmation before execution.
- Verification passed 247 TypeScript tests including all 30 live PostgreSQL tests, every workspace typecheck, web lint, the 87-page/route production build, all three Rust tests, and checksum replay of all 80 migrations. Health returned 200/version 0.91.0; all three unauthenticated retention endpoints returned 401; browser QA verified eligible and requester-pending states with zero warning/error diagnostics and exact fixture cleanup.
- Installer `Market Me Companion_0.91.0_x64-setup.exe`: 2,945,317 bytes; SHA-256 `b3c807a0c50345592142b6f0a1f3b177a42622d63bdbbf2de93cb29825f1b77b`.

Known limitations: this executor covers the conversation-thread aggregate only. It does not erase relationship roots, generated assets outside the thread, Campaign/workflow/AI evidence, object storage, provider copies, Temporal history, logs, analytics, exports, or backups; it has no scheduled bulk purge, hold reason/expiry, legal-basis record, subject-access/export workflow, or backup-expiry attestation. Production deployment requires policy/legal review, protected audit storage, recovery/backups design, RLS/least-privilege database identities, monitoring, and operational ownership.

Rollback may deploy 0.90 while retaining migration 0080 and every request/decision/audit record. Disable the two 0.91 mutation routes and UI before rollback; 0.90 ignores the ledger and retains the preview. Executed erasure is intentionally irreversible from the application and rollback must never fabricate restored content or drop the ledger.

## 0.90.0 - Validated presentation suggestions with per-field opt-in

Release 0.90 makes reviewed Draft-revision output optionally useful without trusting it. New prompts request one versioned JSON presentation object; a pure parser rejects fact-bearing or malformed output; authors must check each validated field before filling the existing successor form, and must still explicitly apply it.

- No migration. `draft-revision-v2` is current while persisted v1 intents remain exactly reconstructible; unsupported prompt versions fail closed.
- Schema `draft-revision-suggestion-v1` permits only optional lead-in, CTA, hashtags, alternative text, and required rationale. Headline, body, facts, evidence, approval, publishing, extra keys, markdown/prose, and nulls are excluded.
- The bounded parser returns valid/unavailable plus literal false mutation/publishing authority and enforces field lengths, lead-in punctuation, hashtag syntax/uniqueness, closed keys, and exact schema.
- Only v2 product proposals are parsed after existing writer authorization/decryption. Invalid/legacy output remains manual reference and cannot prefill controls.
- Field checkboxes default empty. Fill copies only checked values locally; the existing explicit apply transaction and change note remain required and reconstruct evidence-bound facts into a successor.
- Verification passed 245 TypeScript tests including 29 live PostgreSQL, all typechecks/lint, 87 pages/routes, three Rust tests, and all 79 migration checksums. Health 0.90.0, unauthenticated proposal read 401, and browser QA was clean/raw-prompt-free.
- Installer `Market Me Companion_0.90.0_x64-setup.exe`: 2,944,985 bytes; SHA-256 `82499e4105ce72e3178412e062e6dfa5a7898b479d38609b4463828f633205cb`.

Known limitations: validated suggestions remain provider-authored and advisory; no field is auto-selected or automatically applied. Production use still requires managed key lifecycle, identity, provider/legal review, moderation/retention, and operational ownership.

Rollback may deploy the 0.89 UI while preserving v2 reconstruction code for prepared v2 intents. Retain all intents, encrypted output, reviews, proposals, and audits; do not reinterpret v2 hashes as v1 or delete evidence.

## 0.89.0 - In-context encrypted Draft revision output review

Release 0.89 completes the human handoff on the exact Draft page: approvers can open one source-bound encrypted output, record accept/discard review, and writers can attach accepted output only to that exact current Draft as a read-only proposal. Explicit evidence-preserving application remains the separate next step on the same page.

- No migration or API route was added. Immutable migration 0079 remains SHA-256 `64ce8e969fc49e1a4e913dfdc2c5331fc45f5006d10208dd2a5fa8c70b8c6c97`, matching the main database ledger.
- The Draft server component loads only safe `AiTextOutputArtifact` projections and existing Draft proposals. Plaintext, ciphertext, hashes, credentials, provider responses, and private pricing evidence are absent from SSR props.
- `AiDraftRevisionOutputs` filters product-bound artifacts to the exact page Draft, displays source-version currency, and derives attached state from existing proposals. Browser filtering and disabled controls are convenience only.
- Approver-only open decrypts one exact `pending_review|accepted` artifact through the AI vault; plaintext is transient component state and clears on close/review/attachment. Accept/discard uses the existing immutable noted review boundary.
- Writer-only attachment sends the fixed page Draft ID. The repository independently locks/rechecks accepted state, tenant, single attachment, source Draft, and exact current editable source version before creating a read-only proposal.
- Review and attachment do not mutate/approve/publish a Draft, call/retry a provider, change spend, route a workflow, or grant future execution. Existing explicit proposal application reconstructs evidence-bound facts into an immutable successor.
- Verification passed 241 TypeScript tests including all 29 live PostgreSQL tests, all typechecks/lint, 87 generated pages/routes, three Rust tests, and checksum replay of all 79 migrations. Health returned 200/version 0.89.0; unauthenticated read/review/attach returned 401; browser QA confirmed one encrypted empty-state panel, no raw prompts/actions without artifacts, and zero warning/errors.
- Installer `Market Me Companion_0.89.0_x64-setup.exe`: 2,946,543 bytes; SHA-256 `2d2a762c22a80e401cd4ce259d3317598a74164425c4f9634f0e25b785ed171e`.

Known limitations: model output is untrusted free text and is never automatically parsed or applied; authors must explicitly choose permitted presentation fields. Production use still requires managed key lifecycle, identity, provider/legal review, moderation/retention, and operational ownership.

Rollback may deploy 0.88 without a down migration. Remove the Draft-local artifact query/component, preserve all encrypted artifacts/reviews/proposals/audits, and continue authorized review/attachment through AI settings. Never bulk-decrypt, re-encrypt, or delete evidence as part of rollback.

## 0.88.0 - In-context Draft quote and reservation handoff

Release 0.88 lets a writer authorize the governed `assistant.prepare_copy` maximum from the exact Draft page, then immediately use that reservation for the existing Draft-bound prepare or one-shot execute flow. It composes the established quote and budget boundaries and makes no provider request during authorization.

- No migration was added. Migration 0079 remains immutable at SHA-256 `64ce8e969fc49e1a4e913dfdc2c5331fc45f5006d10208dd2a5fa8c70b8c6c97`, matching the main database ledger.
- `AiWorkspaceAdapterInvocationBinding` adds the exact safe `rateCardId` projection from its tenant-bound pricing evidence; no rate components, source evidence, credential, or authority are exposed.
- The Draft panel calls the existing action-specific assistant quote route for closed action `prepare_copy`, then the existing idempotent reserve route for the returned quote maximum. Both repositories independently reauthorize policy, routing/currentness, card, currency, budget, and workspace scope.
- Successful reservations are added to component-local `authorizedReservations`, filtered through `availableReservations`, and selected immediately. A quote that cannot be reserved remains a safe ledger record and is clearly reported as not reserved.
- The new `Quote and reserve maximum here` control is fail-closed without a selected healthy implementation. UI pending/selection state is convenience only and grants no execution or spend authority.
- Quote/reserve performs no provider I/O, decryption, attempt creation, Draft mutation, approval, publishing, workflow, retry, or future execution grant. Release 0.87 preparation and execution gates remain unchanged and authoritative.
- Verification passed 241 TypeScript tests including all 29 live PostgreSQL tests, all typechecks/lint, 87 generated pages/routes, three Rust tests, and checksum replay of all 79 migrations. Health returned 200/version 0.88.0; unauthenticated quote and reserve routes returned 401; browser QA confirmed one fail-closed in-context authorization control, four goals, no raw prompts, and zero warning/errors.
- Installer `Market Me Companion_0.88.0_x64-setup.exe`: 2,944,100 bytes; SHA-256 `c0eca4f6a7b49f04fd1019ad87332ce45b08dde68cf8edb9219fe93b1cc29222`.

Known limitations: encrypted output review, attachment, and selected presentation-field application still occur outside this focused Draft authorization panel, and no model output is automatically trusted or parsed into Draft fields. Production activation still requires managed key lifecycle, identity, policy/legal review, moderation/retention, and operational ownership.

Rollback may deploy 0.87 without a down migration. Remove the safe `rateCardId` projection and in-context control, preserve all quotes/reservations/audits, let unreserved quotes expire, and manage active maximum holds only through existing consumption/cancellation/expiry boundaries.

## 0.87.0 - Draft-bound governed AI revision requests

Release 0.87 connects one safe provider invocation to an exact governed Draft workflow. Market Me assembles and later reproduces the prompt from the immutable current Draft, claims, and evidence; the browser chooses only a closed presentation goal and cannot submit raw prompt or model authority.

- Migration 0079 adds all-or-none source Draft/version, closed goal, prompt-version, and private context-hash evidence to invocation intents with tenant/Draft/version foreign keys and source indexing; SHA-256 `64ce8e969fc49e1a4e913dfdc2c5331fc45f5006d10208dd2a5fa8c70b8c6c97` matches the main ledger.
- Closed goals are clarity, concision, audience fit, and call to action. `draft-revision-v1` canonicalizes exact presentation, ordered claims/evidence bindings, and sorted retained evidence; prompt strings remain transient and unreturned.
- Preparation is writer-only, locks/rechecks the current editable Draft/version, requires an evidence-backed fact and an active exact `assistant.prepare_copy` reservation, and stores only source/hash evidence through the existing intent lifecycle.
- Execution accepts no prompt text. It reconstructs and verifies prompt version, context SHA-256, and both prompt hashes before the existing deployment/workspace/circuit/current-provider/single-claim/no-retry executor.
- Draft UI supports prepare, prepare-and-execute-once, later exact execution, and cancel/release. Generic raw-prompt execution is hidden for product intents; accepted product output can attach only to its exact source Draft/version.
- Provider output remains encrypted review material. The model cannot change facts/evidence, mutate/approve a Draft, route workflows, publish, retry a claim, or grant later authority; selected presentation application still reconstructs facts from evidence.
- Verification passed 241 TypeScript tests including 29 live PostgreSQL, all typechecks/lint, 87 generated pages/routes, three Rust tests, and all 79 migrations rebuilt/replayed twice. Health returned 200/version 0.87.0; both new unauthenticated routes returned 401; unknown route returned 404; Draft browser QA confirmed four goals, no raw prompt fields, fail-closed execution, and zero warning/errors.
- Installer `Market Me Companion_0.87.0_x64-setup.exe`: 2,944,820 bytes; SHA-256 `4f0ba5961f3fe4dc7b6945644e133dbd55cffec0c398dddf0cd8c82294814a74`.

Known limitations: quote/reservation creation and encrypted output review/attachment still occur in AI settings, and no model output is automatically parsed into Draft fields. Production activation still requires managed key lifecycle, identity, policy/legal review, moderation/retention, and operational ownership.

Rollback may deploy 0.86 while retaining migration 0079 and every source/attempt/output/reconciliation/incident row. Disable both product routes and the Draft panel, keep execution stopped, cancel only unclaimed product intents through the existing boundary, and never substitute a raw prompt or retry a claimed/ambiguous attempt.

## 0.86.0 - One-shot exact prepared-intent execution

Release 0.86 exposes one authenticated product surface for the already-governed hosted-text executor. It executes only an exact prepared intent after rechecking every authorization layer, calls the provider at most once, encrypts successful output, and returns no model text or publishing authority.

- No migration was added. The route composes migrations 0069-0075 for intent, single attempt, encrypted output, reconciliation, reviewed output, and Draft proposal flow with the execution/incident/alert safeguards in migrations 0074-0078.
- POST `/api/v1/ai-text-invocation-intents/[id]/execute` accepts only workspace ID plus the exact original bounded system/user text. It requires a session and workspace write role; path ID overrides the body before strict validation.
- Before I/O the server rechecks deployment enablement, the valid `AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY` AI vault (separate from connector/alert keys and used for credential/output envelopes), timed workspace enablement, closed circuit, prompt hashes, active exact quote/reservation, and current adapter, credential, rate, contract, and health evidence, then inserts the intent's only attempt claim.
- Transport is fixed and no-retry. Known pre-request credential failure is safely failed/released and opens the circuit; uncertain post-call transport is ambiguous, non-retryable, retains evidence, and enters operational incident/alert/review resolution.
- Success encrypts output before atomic attempt/reconciliation/settlement. The response exposes only safe attempt state and literal no-retry/no-output/no-publishing metadata. Human artifact review and the existing Draft proposal/application/approval workflow remain mandatory.
- AI settings supports prepare-only, prepare-and-execute-once, and exact-prompt execution for an already-prepared intent. Preparation stores hashes only, so later execution requires the operator to retain or re-enter the exact prompt.
- Verification passed 240 TypeScript tests including 29 live PostgreSQL, all typechecks/lint, 87 generated pages/routes, three Rust tests, and all 78 migrations rebuilt/replayed twice. Health returned 200/version 0.86.0; unauthenticated execute returned 401; unknown route returned 404; browser QA confirmed the fail-closed disabled execution control and zero warning/error entries.
- Installer `Market Me Companion_0.86.0_x64-setup.exe`: 2,944,551 bytes; SHA-256 `54df85fa662734a4a1dad0c9bd33dd7b497230227a0715a7eb9039b867651f86`.

Known limitations: this is an operator-entered exact-text invocation, not yet a Draft-bound generation request assembled from governed content/evidence. Production activation still requires managed key lifecycle, production identity, provider/legal policy review, moderation and retention controls, and operational ownership.

Rollback may deploy 0.85 after disabling the execute route/button and keeping deployment/workspace execution stopped. Retain all attempt, encrypted-output, reconciliation, resolution, incident, and alert/outbox evidence; cancel/release only unclaimed intents through their defined path and never retry ambiguous or otherwise claimed attempts.

## 0.85.0 - Verified signed operational incident webhooks

Release 0.85 adds provider-neutral, verified-only HMAC-signed HTTPS delivery for the operational incidents and deadlines introduced in 0.83-0.84. It preserves execution isolation: alerting cannot call or retry an AI provider, resolve source evidence, or grant execution authority.

- Migration 0078 adds one encrypted webhook configuration per workspace and a tenant-bound durable outbox with five closed event types/statuses, strict state checks, five-attempt bound, stable uniqueness, lease-ready indexes, and exact attempt lineage; SHA-256 `f47de90dd6c1d60e6b65846da786e4f5b5c3a07f1aa1b6d8f04635f466d7afd9` matches the ledger.
- Deployment must configure a separate 32-byte base64 `AI_OPERATIONAL_ALERT_ENCRYPTION_KEY` and exact comma-separated `AI_OPERATIONAL_ALERT_ALLOWED_HOSTS`. URLs require HTTPS/default port and reject credentials, queries, fragments, redirects, and nonexact hosts.
- Saving creates `unverified`; a signed closed test payload must receive 2xx before status becomes `verified`. Secret-fingerprint evidence prevents stale verification after rotation; explicit disable stops new claims while retaining evidence.
- Deliveries use stable idempotency/event IDs plus timestamped `v1` HMAC-SHA-256 over exact raw JSON. The worker projects opened, acknowledged, acknowledgement-overdue, resolution-overdue, and resolved transitions idempotently.
- Retryable 408/425/429/5xx/network-uncertain outcomes reuse the event ID at 60/300/900/3,600-second backoff and dead-letter by attempt five. Redirect/most 4xx/config/secret failures are permanent. Response bodies are discarded.
- Public configuration/history reads expose only endpoint origin, safe state, attempt/response evidence, and literal redaction flags—never endpoint path, signing secret, fingerprint, or payload. Payload content omits prompts, outputs, credentials, private billing detail, and acknowledgement notes.
- APIs are GET/PUT configuration, POST verify/disable, and GET delivery history; AI settings shows deployment readiness, verification controls, and redacted recent evidence. All mutations independently enforce session, role, schema, vault, and allowlist boundaries.
- Verification passed 240 TypeScript tests including 29 live PostgreSQL, all workspace typechecks/lint, 87 generated pages/routes, three Rust tests, and all 78 migrations rebuilt/replayed twice. Live health returned 200/version 0.85.0; unauthenticated new routes returned 401, unknown route 404, and AI-settings browser warnings/errors were zero.
- Installer `Market Me Companion_0.85.0_x64-setup.exe`: 2,946,692 bytes; SHA-256 `043e52d9921801513b0704a562d264ffcaac2583eed4ca4beae33b85b46a4802`.

Known limitations: receiver credentials beyond the HMAC secret are unsupported; there is no provider-specific Slack/Teams/PagerDuty adapter, replay database on the receiver, inbound acknowledgement sync, per-event routing, or user-configurable retry policy. Production still requires managed key lifecycle, outbound egress/DNS monitoring, receiver replay-window enforcement, operational ownership, and retention/erasure policy.

Rollback may deploy 0.84 while retaining migration 0078, encrypted configuration, and outbox evidence. Disable verified webhooks, stop the alert worker, and remove the 0.85 routes/UI; keep AI execution stopped. Forward-deploy 0.85 with the same key/allowlist to resume pending/failed events under their original IDs. Never drop the outbox during rollback.

## 0.84.0 - AI incident-response targets and runbook

Release 0.84 adds configurable critical/high acknowledgement and resolution targets plus one credential-free HTTPS runbook reference. Deadlines and late/overdue evidence enrich operational readiness without changing an incident's source state or granting execution authority.

- Migration 0077 adds one response policy per workspace with bounded critical acknowledgement (1-60 min), high acknowledgement (1-1,440), critical resolution (5-10,080), high resolution (5-43,200), ordered target checks, HTTPS runbook, tenant actors, and timestamps; SHA-256 `e2462f81c0553cfcdc1ae1f898db17052d7669ee5e6c55b107ae77d0ead91a6e` matches the ledger.
- Absent policy fails to documented defaults: critical 5/60 minutes and high 30/240 minutes, with no runbook. Owner/administrator save is tenant-bound, audited, and cannot configure credentials, paging delivery, incident state, provider retry, or execution.
- Every active incident derives `acknowledgementDueAt`, `resolutionDueAt`, acknowledgement overdue/late, resolution overdue, and `within_target|acknowledgement_overdue|acknowledgement_late|resolution_overdue` from its source time, severity, policy, and explicit evaluation time.
- Readiness adds overdue/late counts and next response deadline. Any critical, unacknowledged, late, or resolution-overdue incident remains blocked; active acknowledged noncritical incidents within target remain attention. Source resolution/reset is still the only way back to ready.
- GET/PUT `/api/v1/ai-operational-incident-response-policy` use strict schemas and repository authority. The runbook must be HTTPS, at most 2,000 characters, and contain no URL username/password; Market Me stores and links it but never fetches it.
- AI settings shows target metrics, due times, response state, next/oldest guidance, runbook link, and administrator policy form. External paging remains explicitly not configured and acknowledgement remains ownership evidence only.
- Verification passed 232 TypeScript tests including 29 live PostgreSQL, all workspace typechecks/lint, 83 generated pages/routes, three Rust tests, and all 77 migrations rebuilt/replayed twice. Live health returned 200/version 0.84.0, unauthenticated policy GET/PUT 401, unknown route 404, and zero AI-settings browser warnings/errors.
- Installer `Market Me Companion_0.84.0_x64-setup.exe`: 2,943,723 bytes; SHA-256 `18b5dbd18fdcdc42ed9ec66d83588ac300ce7c95e6d01a29c779e694d993dc1a`.

Known limitations: targets produce authenticated in-app/API evidence only; they do not send email, push, webhook, or page. Production still requires external alert delivery, escalation ownership, managed KMS/HSM key lifecycle, moderation/retention policy, production identity, and an approved product execution workflow.

Rollback may deploy 0.83 while retaining migration 0077. Release 0.83 uses built-in deadlines and ignores stored policy; disable the 0.84 policy API/form and keep execution stopped. Forward-deploy 0.84 to restore configured deadlines; do not drop policy or audit evidence.

## 0.83.0 - Derived AI operational readiness

Release 0.83 adds a tenant-scoped operational incident and readiness boundary for provider circuits, overdue/ambiguous attempts, and quarantined billing. It records reviewer ownership without confusing acknowledgement with source resolution or execution authority.

- Migration 0076 adds one immutable acknowledgement per workspace/incident-type/attempt with provider, optional reconciliation, source-observed time, bounded note, reviewer, and timestamps; SHA-256 `be686882d5648063b8c3fdb49242aaad35ffedadc1bb469608537d1c0bf4ee42` matches the main database ledger.
- Active incidents are derived from retained source evidence: open provider circuits, claimed attempts past their reconciliation deadline or terminal unresolved ambiguity, and unresolved quarantined reconciliations. Resetting/resolving the source removes it from the active view without deleting acknowledgement history.
- Credential-unavailable circuit incidents are critical; all other current incident classes are high severity. The readiness projection is `ready`, `attention`, or `blocked` and reports active/unacknowledged/critical counts plus oldest age and `executionShouldRemainStopped`.
- Owner, administrator, or approver acknowledgement is idempotent and row-lock serialized with attempt resolution, reconciliation, and circuit reset. It records ownership only: incident remains active, provider retry stays false, and no stop, circuit, resolution, credential, usage, billing, or execution state changes.
- GET `/api/v1/ai-operational-incidents`, POST `/api/v1/ai-operational-incidents/acknowledge`, and GET `/api/v1/ai-operational-readiness` are authenticated tenant-scoped observation/control-plane surfaces. Metadata explicitly reports external paging not configured and no public execution route.
- AI settings presents readiness metrics, closed safe summaries, oldest incident, active acknowledgement state, and a reviewer note form. Prompt/output/credential/hash/price data is never projected; acknowledgement-note content is excluded from minimized audit.
- Verification passed 231 TypeScript tests including 29 live PostgreSQL, all workspace typechecks/lint, 82 generated pages/routes, three Rust tests, and all 76 migrations rebuilt and replayed twice. Live checks returned health 200/version 0.83.0, unauthenticated incident/readiness/acknowledgement 401, unknown route 404, and zero AI-settings browser warnings/errors.
- Installer `Market Me Companion_0.83.0_x64-setup.exe`: 2,944,125 bytes; SHA-256 `2b3394b9cac27edd4ec99b45665eaedfb71dacf158e743f299adb4b2fff63afe`.

Known limitations: alert delivery remains authenticated in-app/API only; no email, push, webhook, or paging target is configured. Production still requires managed KMS/HSM custody and rotation, alert delivery/ownership runbooks, moderation/retention policy, production identity, and an approved product workflow before any public provider execution route is introduced.

Rollback may deploy 0.82 while retaining migration 0076 and acknowledgement history. Disable the 0.83 incident/readiness API/UI because 0.82 does not project the table; keep `AI_PROVIDER_EXECUTION_ENABLED=false` and workspace execution stopped. Forward-deploy 0.83 to restore the operational view, and never drop retained acknowledgement evidence.

## 0.82.0 - Evidence-backed AI incident resolution

Release 0.82 adds an immutable operator-reviewed resolution boundary for ambiguous provider attempts and quarantined billing without retrying a provider request or inferring unknown token usage.

- Migration 0075 adds one terminal resolution per invocation attempt with exact reservation, optional reconciliation, actor, disposition, provider/model, evidence-reference, note, previous/final hold state, and timestamps; SHA-256 `d9ebadb4e73f321de60f34dd9cd189c31c009d92b4d2f558e67f32224d0cd1da` matches the main database ledger.
- The only dispositions are `confirmed_no_charge` and `settled_provider_charge`. The latter requires an exact reviewed provider-statement amount from 1 to 1,000,000,000 minor units; the former records no amount.
- Owner, administrator, or approver review can release/expire an ambiguous hold after confirming no charge, or settle it at the exact external charge. Replay returns the original resolution, and every resolution permanently reports unknown usage units, retry forbidden, and provider request not retried.
- Generic reservation release now rejects text-invocation holds. Only cancellation, a known pre-request credential failure, or this reviewed resolution boundary may release them. Credential-unavailable attempts now release automatically because no provider request was made.
- Reviewed statement charges contribute their exact amount and one request to workspace usage and budget totals with zero invented token units. A resolved quarantined reconciliation projects its reservation as settled while truthfully keeping `usageRecorded=false`.
- GET `/api/v1/ai-text-invocation-resolutions` and POST `/api/v1/ai-text-invocation-attempts/[id]/resolve` enforce tenant and reviewer authority at API and repository layers. AI settings presents eligible incidents and immutable resolution history with bounded evidence and note inputs.
- Verification passed 230 TypeScript tests including 29 live PostgreSQL, all workspace typechecks/lint, 79 generated pages, three Rust tests, and all 75 migrations rebuilt twice. Live checks returned health 200/version 0.82.0, unauthenticated resolution mutation 401, unknown route 404, and zero AI-settings browser warnings/errors.
- Installer `Market Me Companion_0.82.0_x64-setup.exe`: 2,946,650 bytes; SHA-256 `bcf3324ba709c3818c9a01bc2299b9d196844f26449e932b1e084225ffd140b1`.

Known limitations: the application still has no public provider-execution route. Production activation still requires managed KMS/HSM custody and rotation, monitoring and paging, incident runbooks, moderation/retention policy, and production identity. Reviewed external charges cannot recover token counts that the provider did not supply.

Rollback may deploy 0.81 while retaining migration 0075 and every resolution row, but disable the new resolution API/UI and any reporting that assumes reviewed charges are included. Release 0.81 does not join those charges into budgets or reconciliation projections. Keep execution stopped and forward-deploy 0.82 before restoring resolution surfaces; never drop reviewed evidence.

## 0.81.0 - Fail-closed AI execution controls

Release 0.81 adds the operational stop and provider-circuit boundary required before the internal hosted-text executor can be connected to product workflows.

- Migration 0074 adds one optional workspace execution-control row plus one persistent circuit row per workspace/provider; SHA-256 `45b24bce669eb04dd863ea977957eff0b5cc12f60c06e216820de2348807d127` matches the main database ledger.
- Missing control rows, stopped state, expired enablement, the deployment flag default, and open circuits all block new claims. Enablement lasts 1-1,440 minutes and requires an owner/administrator plus a trimmed operator reason.
- `AI_PROVIDER_EXECUTION_ENABLED` is the deployment-wide server-only switch and defaults false. The internal executor rejects before claim when it is false.
- A stop is row-lock serialized with claim and finalization. If it wins before finalization, a nominal provider success becomes non-retryable `evidence_changed` ambiguity and no output artifact, usage event, settlement, or plaintext projection is created.
- Credential-unavailable failure opens the provider circuit immediately. Unknown/abandoned outcomes open after three consecutive failures. Success resets the counter; an open circuit remains open until a reasoned owner/administrator reset.
- AI settings shows deployment, workspace, circuit, and effective states. GET/PUT `/api/v1/ai-execution-control` and POST `/api/v1/ai-provider-circuits/[provider]/reset` enforce tenant scope and administration authority at API and repository layers.
- Verification passed 229 TypeScript tests including 29 live PostgreSQL, all workspace typechecks/lint, 78 generated pages, three Rust tests, and all 74 migrations rebuilt twice. Live checks returned health 200/version 0.81.0, unauthenticated control mutation 401, unknown route 404, and zero AI-settings browser warnings/errors.
- Installer `Market Me Companion_0.81.0_x64-setup.exe`: 2,945,887 bytes; SHA-256 `3f6d81cbc58471c6ae24d5258abc7eece3182e03547f7e96518e1bb49326b2a1`.

Known limitations: no public provider-execution route or product workflow calls the executor. Production still requires managed KMS/HSM custody and rotation, monitoring/alert delivery, incident runbooks, operator ambiguity/quarantine resolution, content moderation/retention policy, and production identity.

Rollback may deploy 0.80 while retaining migration 0074. Before rollback, set every workspace control to `stopped` and keep `AI_PROVIDER_EXECUTION_ENABLED=false`; 0.80 ignores persisted circuit rows and must not expose an execution entry point. Do not drop circuit/audit evidence.

## 0.80.0 - Evidence-preserving AI proposal application

Release 0.80 lets an author apply explicitly selected presentation fields from one attached accepted AI proposal into exactly one immutable successor Draft version without accepting provider-authored facts or bypassing approval.

- Migration 0073 extends proposal lifecycle to terminal `applied`, binds one applied successor to its exact Draft, records actor/note/time and the bounded changed-field list, and enforces mutually exclusive applied/dismissed states; SHA-256 `83cb24f7eb9bee17d4e2a971867b6f4fc7f1178d73a7072d8b6a495b7f8aaea9`.
- The atomic repository operation rechecks writer, accepted artifact, attached/current proposal, editable Draft/version, and exact source lineage under locks. It reads every fact/evidence binding from the source and reconstructs copy under the existing Draft-format ceiling.
- Clients may send only lead-in, optional call to action, hashtags, optional alternative text, and a change note. They cannot submit body/claims/evidence/version/state/authority fields, and output text is never parsed automatically.
- The source becomes superseded; one working successor preserves headline/rationale/facts/evidence, records proposal lineage, and still requires normal Draft submission and approval. Publishing, routing, workflow, and execution authority remain false.
- Applied proposals are replay-safe, immutable, undecryptable, and cannot be dismissed. Safe history exposes only lineage/status/selected-field metadata and indicates Draft mutation only for applied records.
- Verification passed 227 TypeScript tests including 29 live PostgreSQL, all typechecks/lint, 77 generated pages, three Rust tests, and 73 migrations rebuilt/replayed twice. Live checks returned health 200/version 0.80.0, unauthenticated apply 401, unknown route 404, and zero Draft-page browser warnings/errors.
- Installer `Market Me Companion_0.80.0_x64-setup.exe`: 2,945,893 bytes; SHA-256 `a113a53684c56249028faa277476ac825cf40d32643a21395113f609bfed1173`.

Known limitations: authors manually interpret accepted output; no model-produced body or structured mapping is trusted. Provider execution remains internal, and ambiguity/quarantine resolution plus production key/circuit/kill/monitoring/identity controls remain future work.

Rollback may deploy 0.79 while retaining migration 0073, but proposal list/read/dismiss surfaces must be disabled because 0.79 does not project applied mutation metadata. Forward-deploy 0.80 before re-enabling those surfaces; do not drop applied successor lineage.

## 0.79.0 - Accepted output to governed Draft proposal

Release 0.79 attaches one accepted encrypted output to one exact editable Draft version as a review-only author proposal without mutating governed copy or evidence.

- Migration 0072 adds one-artifact proposal lineage and terminal dismissal; SHA-256 `7b0d77ddec9b8768cbb88f650fbf43767990abdfd1a6ad1c2833e26fa150358e`.
- Writer attachment requires accepted same-workspace output plus current working/changes-requested Draft/version evidence under locks; exact retries are idempotent and cross-Draft reuse fails.
- Safe lists expose metadata and derived source-current state only. Writer decryption fails closed after artifact, proposal, version, or Draft lifecycle drift.
- AI settings attaches accepted output; Draft detail presents review text beside the existing evidence-preserving revision form. Proposal actions cannot mutate Draft content or grant publish authority.
- Verification passed 227 TypeScript tests including 29 live PostgreSQL, all typechecks/lint, 77 generated pages, 3 Rust tests, and 72 migrations twice. Live checks returned health 200/version 0.79.0, 401 proposal/output reads, 404 generation, and zero browser warnings/errors.
- Installer `Market Me Companion_0.79.0_x64-setup.exe`: 2,944,020 bytes; SHA-256 `f634ca8f901e7d11545191fd8262bce95a0462b248453f14f1a20f679f313826`.

Known limitation: proposals remain read-only; selected evidence-preserving application into a new Draft version is the next boundary. Rollback deploys 0.78 while retaining migration 0072 and all encrypted proposal evidence.

## 0.78.0 - Encrypted text output and exact reconciliation

Release 0.78 converts successful internal provider text into one durable encrypted, review-gated artifact and reconciles actual token usage to the exact authorized rate card before atomic settlement.

- Added migration `0071_ai_text_outputs_and_reconciliation.sql` (SHA-256 `2e98c922f25106199ce6175068a05ed20dd26dbf42d406968d988192079c5b03`) with encrypted output artifacts, one-attempt usage linkage, and settled/quarantined reconciliation.
- The internal executor encrypts output before finalization and no longer returns raw success text. Provider credentials and output are decrypted only in request-scoped server memory.
- Success atomically commits attempt state, artifact, reconciliation, exact usage, reservation settlement, and minimized audits. Exact cost reuses source-hashed approved rate components and the conservative minor-unit ceiling.
- Missing usage, unsupported rate components, and cost above the authorized maximum quarantine reconciliation while preserving the encrypted artifact and leaving the hold unsettled. Automatic retry remains forbidden.
- Added safe artifact/reconciliation lists, approver-only server-side decrypt-for-review, terminal accept/discard decisions, and an AI settings review surface. Acceptance cannot publish or create a Draft.
- Blocked generic `settleSpend` for every text-intent reservation so only the exact attempt reconciliation boundary can settle it.
- Verification passed lint, 227 TypeScript tests (29 live PostgreSQL), every workspace typecheck, 76 generated pages, companion/native checks, 3 Rust tests, and a clean/idempotent 71-migration rebuild.
- Live acceptance returned health 200/version 0.78.0, unauthenticated output and attempt reads 401, absent generation 404, rendered all new ledgers, and produced zero browser warnings/errors.
- Unsigned Windows installer `Market Me Companion_0.78.0_x64-setup.exe` is 2,943,061 bytes with SHA-256 `f2bac27977dd957c2a831c84f683ce4199ac1c26954cd294c700ca30e80a799d`.

Known limitations: no product workflow invokes the executor; accepted artifacts do not yet create Draft versions; quarantined/ambiguous attempts lack operator-resolution UI. Production activation still requires output-key lifecycle, circuit/kill controls, monitoring, and incident response.

Rollback deploys 0.77 while retaining migration 0071. New output/reconciliation rows remain encrypted retained evidence and are ignored by 0.77; do not drop or rewrite them.

## 0.77.0 - Exactly-once provider attempt boundary

Implemented:

- Migration 0070 adds one attempt per intent with claimed/succeeded/failed/ambiguous invariants and a one-minute reconciliation deadline; immutable SHA-256 `b3def7a74110f40ff52b16a72c7bd066a77794f4237392c5eb10b01faee85711`.
- Claim is writer-only, prompt-hash exact, current-authorization rechecked under locks, and permanently single-use. A duplicate or substituted claim fails before provider I/O.
- The server-internal executor claims first, decrypts the current credential only in memory, performs at most one fixed transport call, clears its local key reference, and finalizes without a public execution route.
- Transport errors are conservatively ambiguous and non-retryable. Decryption failure is known pre-request failure; stale claims reconcile to ambiguous; successful output arriving after deadline or evidence drift is discarded as ambiguous.
- Successful attempts store only output and provider-response-ID SHA-256 values plus bounded token counters and stop reason. Safe reads expose no output, private hashes, provider ID, credential, prompt, usage event, or settlement.
- Gate passed 227 TypeScript tests including 29 live PostgreSQL tests, all typechecks/lint, 75 generated pages, 3 Rust tests, and all 70 migrations repeat-safe twice. Live acceptance returned health 200/version 0.77.0, unauthenticated attempt 401, generation 404, and two browser diagnostics with zero errors.
- Unsigned installer `Market Me Companion_0.77.0_x64-setup.exe`: 2,947,382 bytes; SHA-256 `391a488892c25887e3a0a71951776694fe10d52f8eedf410726343b8de2bd986`.

Known limitations: the executor is internal and has no product route or workflow caller. Output is returned only in process and not durably attached to a draft; token usage is not reconciled to provider billing, and reservation settlement, operator ambiguity resolution, circuit breaking, kill switching, monitoring, and delivery remain future boundaries.

Rollback: deploy 0.76 while retaining migration 0070. Release 0.76 ignores attempt rows, and no retained row grants public execution, output access, retry, usage, or settlement authority.

## 0.76.0 - Durable text invocation intents

Implemented:

- Migration 0069 adds `workspace_ai_text_invocation_intent` plus same-workspace composite reservation evidence; immutable SHA-256 `97d851b0081a4f37aaca549b9b341abd42e776f6088f7e4d344c974b8c476e16`.
- Preparation is writer-only and idempotent. It requires one current healthy implemented binding, its exact current rate card, one unexpired reserved `generate_text`/`assistant.*` quote at the quoted maximum, matching currency, source hashes, and credential fingerprint.
- Raw system/user text is validated only in server memory. Persistence retains separate SHA-256 values and a canonical request hash; safe projections and audits expose none of those hashes, credentials, or text.
- `authorizationCurrent` is re-derived on every read and fails closed on cancellation, expiry, reservation/quote drift, credential/contract drift, unhealthy/stale evidence, or lifecycle retirement.
- Cancellation atomically marks the intent cancelled and releases an active reservation. Provider request, output storage, usage recording, settlement, routing, and execution remain literal false; no generation route exists.
- Gate passed 224 TypeScript tests including 29 live PostgreSQL tests, all typechecks/lint, 74 generated production pages, 3 Rust tests, and all 69 migrations repeat-safe twice. Live acceptance returned health 200/version 0.76.0, unauthenticated intent 401, absent generation 404, and two browser diagnostics with zero errors.
- Unsigned installer `Market Me Companion_0.76.0_x64-setup.exe`: 2,946,107 bytes; SHA-256 `d4ccaa6baadbd0a7035b45cfba007561f4a373e740512e652abeb696c1df5670`.

Known limitations: intents are authorization evidence only. No provider call, output persistence, actual usage reconciliation, settlement, ambiguous-attempt recovery, circuit breaker, global kill switch, or workflow delivery exists.

Rollback: deploy 0.75 while retaining migration 0069. Release 0.75 ignores the intent table; retained rows grant no provider, routing, output, settlement, or execution authority. Do not edit or drop the applied migration.

## 0.75.0 - Internal implementation and tenant health readiness

Implemented:

- Migration 0068 replaces the original hard-false implementation check with a codec+transport prerequisite invariant, adds implementation versioning, retires transport-only `contract-v3`, and seeds source-hashed `contract-v4`; immutable SHA-256 `2bfc8096e84b2129b95131ab25f88e1cdbec3bff4099caf09f50b552c41a7ee8`.
- Three Approved v4 rows expose `hosted-text-implementation-v1` only when `text-codec-v1` and `fixed-https-text-v1` are both present; older contract generations remain retained and retired.
- Tenant configuration now requires an Approved same-provider contract with reviewed codec, transport, and internal implementation. Existing v3 bindings fail closed after retirement.
- `healthReady` is derived per binding only when implementation is available and provider reachability is fresh, healthy, post-configuration, unexpired, hash/fingerprint-current, and every registration/pricing/credential prerequisite remains current.
- Reconfiguration, unhealthy evidence, expiry, contract/credential drift, or registration/pricing retirement returns readiness false without rewriting observation history. Routing, activation, generation routes, and public execution remain disabled.
- Gate passed 223 TypeScript tests including 29 live PostgreSQL tests, all typechecks/lint, 73 pages/routes, 3 Rust tests, and 68 repeat-safe migrations twice; catalog/UI/API acceptance had 401/404 boundaries and zero browser errors.
- Installer `Market Me Companion_0.75.0_x64-setup.exe`: 2,945,943 bytes; SHA-256 `cd834c8828dcee2e69be5307b90a739f54897d70f29c03f48676d1668497735b`.

Known limitations: readiness is evidence, not authorization. There is no public generation route, durable invocation/idempotency record, exact quote/reservation consumption, prompt/output retention policy, provider-call audit, actual-usage reconciliation, settlement, circuit breaker state, user workflow integration, or global kill switch.

Rollback: deploy 0.74 and retain migration 0068. V1-v3 remain retired, v4 remains outside 0.74 routing/execution, and no catalog row grants public authority. Do not edit or drop the applied migration.

## 0.74.0 - Fixed provider text transport

Implemented:

- Migration 0067 adds transport availability/version/endpoint-policy metadata, retires codec-only `contract-v2`, and seeds source-hashed `contract-v3`; immutable SHA-256 `5058ad487eed6155e52b9e31670ee236ae767ee07e77d9902dca6c8c628fdb0c`.
- `invokeAiProviderText` builds its request internally and posts only to OpenAI Responses, Anthropic Messages, or model-bound Google `generateContent`; callers cannot supply URL, headers, body shape, redirect behavior, cache mode, or retry policy.
- Credentials are accepted only as bounded server-side function input and placed only in provider-required headers. Requests force JSON POST, no-store, redirect error, a 30-second default/60-second maximum timeout, and no retry.
- Success bodies require JSON content, declared and streamed one-mebibyte limits, then pass through the reviewed codecs. HTTP, timeout, network, content-type, size, and parser failures become closed safe outcomes without raw-body/key exposure.
- Catalog/UI acceptance proved v1/v2 retirement, three Approved v3 codec+transport contracts, implementation false, valid unauthenticated 401, absent generation route 404, and zero browser errors.
- Gate passed 222 TypeScript tests including 29 live PostgreSQL tests, all typechecks/lint, 73 pages/routes, 3 Rust tests, and 67 repeat-safe migrations twice.
- Installer `Market Me Companion_0.74.0_x64-setup.exe`: 2,947,948 bytes; SHA-256 `ba2a7422d381100a8e67de7dc383bb56517927a15606ce7d75f3d586859de241`.

Known limitations: the transport is internal and uncalled by product routes. There is no generation authorization route, tenant request record, exact quote/reservation binding, invocation idempotency, periodic health/circuit state, provider-call audit ledger, actual-usage reconciliation, settlement, user output workflow, or kill switch.

Rollback: deploy 0.73 and retain migration 0067. V1/v2 remain retired and v3 remains implementation-unavailable/non-routable/non-executable; 0.73 ignores transport columns. Do not edit or drop the applied migration.

## 0.73.0 - Bounded provider-native text codecs

Implemented:

- Migration 0066 adds codec availability/version metadata, retires descriptor-only `contract-v1`, and seeds source-hashed `contract-v2` rows; immutable SHA-256 `9691591122f4325d826ec2509f458728ffa16671826e38455f12edd2a98aef00`.
- Pure OpenAI Responses, Anthropic Messages, and Google `generateContent` request builders accept only one bounded text turn, optional bounded system text, a validated model ID, and a bounded output-token limit.
- Provider response parsers enforce a one-mebibyte JSON ceiling, bounded item/text counts, provider-native final envelopes, no tools/media/executable content, and normalized text, stop reason, response ID, and token usage.
- Canonical provider dictionaries expose `text-codec-v1`, `text-request-v1`, `text-response-v1`, fixed constraint tuples, and verified SHA-256 source identities. Transport URLs, headers, credentials, and network authority are deliberately absent.
- Catalog/UI acceptance proved three retired non-codec v1 rows, three Approved codec-v1 v2 rows, unauthenticated valid catalog access at 401, no generation route at 404, and zero browser errors.
- Gate passed 210 TypeScript tests including 29 live PostgreSQL tests, all typechecks/lint, 73 pages/routes, 3 Rust tests, and 66 repeat-safe migrations twice.
- Installer `Market Me Companion_0.73.0_x64-setup.exe`: 2,945,329 bytes; SHA-256 `b794f6c891ef811eac8f923a47f70ba9d3263ea1b281861e31ac439756ba06d1`.

Known limitations: codecs are pure serialization/normalization code only. There is no generation route, provider POST transport, tenant endpoint/account binding, credential injection for generation, routing/availability activation, spend-to-invocation orchestration, actual-usage reconciliation, settlement, circuit breaker, scheduler, or kill switch.

Rollback: deploy 0.72 and retain migration 0066. Version-1 contracts remain retired and version-2 rows remain implementation-unavailable/non-routable/non-executable; 0.72 ignores codec metadata. Do not edit or drop the applied migration.

## 0.72.0 - Expiring provider-reachability evidence

Implemented:

- Migration 0065 adds append-only tenant health observations; immutable SHA-256 `a540bd5f4fa32e6a363887d81b24d18c278172fba1bc8732e2b44240fe75c129`.
- Owner/administrator probes reuse fixed provider model-list endpoints with header-only auth, five-second abort, failed redirects, no cache/body, discarded responses, and no generation.
- Observations bind configuration time, credential fingerprint, contract hash, actor, five-minute expiry, closed status/failure, and safe message; no provider response is stored.
- Fresh healthy evidence can set provider reachability evidence current, while unhealthy or stale evidence fails closed and implementation health, routing, activation, and execution remain false.
- Strict API/UI acceptance proved 401/422 handling, fake-key credential rejection, current-to-stale expiry, drift retirement, registry invariance, zero browser errors, erasure, and cleanup of all 13 QA audits/data.
- Gate passed 192 TypeScript tests including 29 live PostgreSQL tests, all typechecks/lint, 73 pages/routes, 3 Rust tests, and 65 repeat-safe migrations twice.
- Installer `Market Me Companion_0.72.0_x64-setup.exe`: 2,945,471 bytes; SHA-256 `e117d89b30776f3cd3edb6c45b5eeb5e881d3936ee400d385f16531cdb0e6455`.

Known limitations: reachability is not runnable-adapter health. No invocation serializer/parser, endpoint/account binding, scheduler, periodic probe, circuit breaker, availability, routing, provider generation, usage reconciliation, or settlement exists.

Rollback: stop the probe route/UI and deploy 0.71. Retain migration 0065 and its append-only evidence; 0.71 ignores it and it grants no execution authority.

## 0.71.0 - Server-owned invocation-contract staging

Implemented:

- Additive migration 0064 creates a versioned source-hashed contract catalog plus tenant invocation bindings; immutable SHA-256 `9d8042a5a40f29aebca0fbe446f7692f66489718f60c6d3a8afd4356808346a8`.
- Three Approved internal `contract-v1` descriptors cover OpenAI, Anthropic, and Google Generative AI HTTPS/JSON wiring while a database invariant fixes implementation availability to false.
- Owners and administrators may configure only a current Registered adapter, exact current pricing binding, and same-provider contract after candidate/inventory/connection/fingerprint/effective-window/source validation.
- Manual retire/reconfigure is supported. Pricing retirement, registration retirement, credential rotation/revocation, and inventory drift automatically retire invocation staging with minimized audits.
- Safe projections expose contract/schema/source integrity and derived configuration currency while health, routing, activation, provider invocation, and execution remain literal false.
- Strict APIs return 401 for valid unauthenticated operations and 422 for empty, malformed, or extra authority fields. The UI clearly identifies implementation and health as unavailable.
- Live QA exercised every manual and automatic lifecycle, proved registry invariance and zero browser errors, cryptographically erased the fake credential, and removed all 24 QA audit/data rows without provider I/O.
- Gate passed 192 TypeScript tests including 29 live PostgreSQL tests, all typechecks/lint, 73 pages/routes, 3 Rust tests, and 64 repeat-safe migrations twice.
- Unsigned installer `Market Me Companion_0.71.0_x64-setup.exe`: 2,942,582 bytes; SHA-256 `00276b5aab64cc6e178eb30c140989d9ad96108187021e6c130381d486add4a4`.

Known limitations: contract staging contains no request/response implementation, tenant endpoint/account binding, health probe, availability, circuit breaker, routing, spend execution, provider call, actual usage, reconciliation, settlement, paging, bulk operation, notification, or delete API.

Rollback: stop the 0.71 invocation routes/panel and deploy 0.70. Retain migration 0064 and its governance rows; 0.70 ignores them and every row remains implementation-unavailable, non-routable, and non-executable.

## 0.70.0 - Tenant-scoped hosted pricing evidence

Implemented:

- Additive migration 0063 creates tenant-bound adapter/rate-card bindings with exact currency constraints and lifecycle indexes; its immutable SHA-256 is `82aa292a9e4d4bb28282942882457cc129b738de2bc167e168e25d80fcf60048`.
- Owners and administrators may bind only a currently Registered staging record to an Approved, effective card with exact provider/model-family identity after candidate, inventory, connection, and fingerprint currency is revalidated.
- Safe projections include normalized integer-micro components, currency exponent, effective/source/hash evidence, administrator attribution, and derived `evidenceCurrent`/`pricingReady` while retaining literal false routing, activation, and execution fields.
- Administrators may manually retire and re-bind pricing evidence. Manual registration retirement and automatic credential/inventory drift retire bound pricing automatically with bounded reasons and minimized aggregate audits.
- Strict list, bind, and retire APIs reject client-authored prices/authority fields. Valid unauthenticated operations return 401; empty, malformed, unknown, and extra-field mutation bodies return 422.
- The AI settings pricing panel exact-filters registered adapters and effective cards, displays component prices and source integrity, retains lifecycle history, and clearly states that pricing readiness does not configure invocation or availability.
- Live acceptance exercised submit/approve/register/bind, manual retire/re-bind, registration-cascade retirement/re-register/re-bind, and credential-drift retirement. Registry counts remained one/two; credential erasure, zero browser errors, and removal of all 16 QA audits/data were verified without provider I/O.
- Release gate: clean lint; 192 TypeScript tests including 29 live PostgreSQL tests; every workspace typecheck; 72-page/route production build; companion frontend/native checks; three Rust tests; all 63 migrations repeat-safe twice.
- Unsigned installer `Market Me Companion_0.70.0_x64-setup.exe`: 2,948,031 bytes; SHA-256 `1d2c05935ffd868e5f2f83518fd3ee0bd1cc7165768833caf294900d3e1bfbff`.

Known limitations: pricing readiness is evidence only. It does not configure an invocation adapter or tenant endpoint, expose a model to routing, establish health/availability, reserve spend, call a provider, record actual usage, reconcile, or settle cost. Trusted price synchronization, pagination, bulk operations, notifications, and deletion APIs are not implemented.

Rollback: stop the 0.70 pricing-binding routes/panel and deploy 0.69. Retain migration 0063 and its governance rows; Release 0.69 ignores them. Every retained record remains non-routable and non-executable. Never edit or remove applied migration 0063; use a successor migration.

## 0.69.0 - Tenant-scoped adapter deployment staging

Implemented:

- Additive migration 0062 creates tenant-bound adapter registration snapshots and normalized capabilities; its immutable SHA-256 is `178efb02b65482d83a22da9ed2f5883a3ade07a9b9a526fa2f478a304e1b2be9`.
- Owners and administrators may register only an Approved candidate whose Verified connection, active inventory model, and source fingerprints remain current. Editors cannot register or retire deployment staging records.
- Registration snapshots display/routing classes, context limit, paid-reservation requirement, source fingerprint, administrator attribution, and capabilities without modifying the deployment-owned global adapter registry.
- Administrators may retire and later re-register a still-current Approved candidate. Credential save/rotation/revocation and inventory disappearance automatically retire registered snapshots with bounded reasons and aggregate minimized audits.
- Strict member-list, administrator-create, and administrator-retire APIs return literal false routing, adapter-activation, and execution metadata. Empty/malformed JSON and extra fields return 422 rather than a stack-bearing server error.
- The AI settings deployment-staging panel offers approved-candidate registration, retained status, manual retirement, and explicit unavailable/no-invocation/routing-disabled guidance.
- Live acceptance registered, manually retired, re-registered, and rotation-retired a two-capability fixture through the UI; the global registry stayed at one adapter/two capabilities, 401/422 boundaries passed, browser errors were zero, revocation erased the credential, and all ten QA audit plus data rows were removed. No provider call or real verification was claimed.
- Release gate: clean lint; 192 TypeScript tests including 29 live PostgreSQL tests; every workspace typecheck; 71-route/page production build; companion frontend/native checks; three Rust tests; all 62 migrations repeat-safe twice.
- Unsigned installer `Market Me Companion_0.69.0_x64-setup.exe`: 2,945,048 bytes; SHA-256 `226afcb2f71c5dd601158db90ca30ea95a38fa6146799d8f61a6d09fb1fe6a66`.

Known limitations: registration is deployment staging only. It does not configure an invocation adapter or endpoint, expose a model to routing, create routing preferences, bind hosted rate cards, establish health/availability, reserve spend, call a provider, collect usage, or settle cost. There is no global deployment-operator workflow, bulk management, pagination, notification, or deletion API.

Rollback: stop the 0.69 registration routes/panel and deploy 0.68. Retain migration 0062 and its rows; Release 0.68 ignores them. Every retained record is non-routable and non-executable. Never edit or remove applied migration 0062; use a successor migration.

## 0.68.0 - Workspace-governed hosted-adapter candidates

Implemented:

- Additive migration 0061 creates tenant-bound adapter candidates plus normalized closed capability claims. The applied migration is immutable at SHA-256 `ed5c24988e6132e6062a0611e95fe958cf98f571cf98334b0c5941171f5dbd60`.
- Workspace editors, administrators, and owners may propose one candidate for a current active discovered model. Evidence reference, evidence SHA-256, source credential fingerprint, quality/speed/cost class, context limit, cloud privacy, paid-reservation requirement, submitter, and timestamps are retained.
- Only owners and administrators may approve or reject a pending proposal. Approval rechecks that the connection is Verified, the model is active, and both still carry the submitted credential fingerprint.
- Credential save/rotation/revocation and model disappearance retire pending or approved candidates automatically. Rejected and retired records may be resubmitted; a pending or approved duplicate fails closed.
- Strict member-list, writer-submit, and administrator-decision APIs expose literal false routing, adapter-activation, and execution metadata. Audits omit model IDs, fingerprints, evidence references, evidence hashes, and capability details.
- The AI settings page provides discovered-model proposal controls, capability checkboxes, evidence inputs, owner/administrator review, retained status, and explicit non-routable guidance. The deployment-owned adapter registry remains unchanged and read-only.
- Live acceptance used an encrypted fake QA connection, explicitly simulated Verified state and two fixture models, submitted and approved a candidate through the UI, proved the registry stayed at one adapter/two capabilities, proved rotation retirement, exercised 401/422 boundaries, revoked/erased the credential, observed zero browser errors, and removed every QA row/audit. No real provider call or successful provider verification was claimed.
- Release gate: clean lint; 192 TypeScript tests including 29 live PostgreSQL tests; all workspace typechecks; 70-route/page production build; companion frontend/native checks; three Rust tests; all 61 migrations repeat-safe twice.
- Unsigned installer `Market Me Companion_0.68.0_x64-setup.exe`: 2,946,518 bytes; SHA-256 `b706200b5699b656c23d350a4a1b3b07fbda68ba341250e74855dbad1a83f400`.

Known limitations: approval is capability-evidence governance only. There is no deployment adapter registration from a candidate, hosted rate-card binding, executable endpoint/account binding, health/staleness service, provider invocation, actual-usage settlement, evidence fetch/archival, automatic capability verification, pagination, bulk review, notification, or candidate deletion API. All hosted candidates remain cloud, paid-reservation-required, non-routable, inactive, and non-executable.

Rollback: stop the 0.68 candidate routes and UI before deploying 0.67. Retain migration 0061 and its rows; Release 0.67 ignores them. Rotation/revocation remains safe, and no candidate has execution authority. Never edit or remove the applied migration; use a successor migration for schema changes.

## 0.67.0 - Workspace-private hosted-provider model inventory

Migration 0060 (`489c339939f2922e8ef8a8ad740924677f64175b41b5840d6444039b5b4ee35e`) adds fingerprint-provenanced first/last-seen and retired model inventory. Verified-only discovery uses fixed endpoints with ten-second, one-mebibyte, and 1,000-record bounds; strict minimal parsers and fingerprint-guarded replacement preserve privacy and history. Rotation/revocation retires active records. No model becomes an adapter or executable. Gate: 192 TypeScript/29 live database/3 Rust tests, 69 pages, 60 migrations. Installer: 2,947,978 bytes; SHA-256 `0d45051e5d19a2303e992c567caff9471e100219e34b3fff5ce17441526826d2`.

Known limitations: live acceptance used simulated Verified/fixture inventory; no real-key discovery, pagination, scheduled refresh, staleness, approval, adapter registration, pricing, invocation, or settlement.

## 0.66.0 - Non-generative hosted-provider credential verification

Implemented:

- Added a strict writer-only Verify endpoint and UI control for each encrypted OpenAI, Anthropic, and Google Generative AI connection; clients submit workspace identity only.
- Verification uses one fixed official HTTPS model-list endpoint per provider, header-only authentication, no request body, redirect failure, disabled cache, and a five-second abort bound.
- Provider response bodies are canceled and never parsed or stored. HTTP/network outcomes normalize to a closed failure category and predetermined redacted message.
- Decrypted credentials remain inside the server boundary. A fingerprint compare-and-set prevents an in-flight result from overwriting a rotated or revoked key.
- Successful metadata authentication writes Verified with time; failure writes Error with a safe message. Neither state creates/enables an adapter, stores models, authorizes spend, generates content, or grants execution.
- Live acceptance used a fake QA-only key against the official OpenAI models endpoint, observed a redacted rejection, proved encrypted/secret-free persistence and audits, enforced 422/401 boundaries, revoked/erased, and restored clean state.
- Release gate: clean lint; 185 TypeScript tests including 29 live database tests; every workspace typecheck; 69-page production build; companion web/native checks; three Rust tests; all 59 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.66.0_x64-setup.exe`: 2,943,978 bytes; SHA-256 `0c31dccc6381b5f55ab3f8b75cc9d1fb6b26f2b3a742e899032a13ba3774247e`.

Known limitations: verification is manual and point-in-time, with no successful real-key live acceptance. There is no retained catalog/account/quota/region evidence, scheduled health, staleness policy, retry queue, circuit breaker, alerting, adapter linkage, hosted rate card, invocation, or settlement.

Rollback: no schema change. Stop the verify route/UI and deploy 0.65. Migration 0059 accepts retained Verified/Error state, and saving a new key returns the connection to Unverified.

## 0.65.0 - Encrypted hosted-provider connection lifecycle

Implemented:

- Additive migration 0059 creates one tenant-bound connection per workspace and closed hosted provider with strict status/credential invariants; checksum `f10ce5acb930dcc0bfe613225d960e223dea8ad02c09a818ff079b7b095f72e2`.
- OpenAI, Anthropic, and Google Generative AI keys are encrypted with AES-256-GCM under a dedicated server-only 32-byte base64 key. A server-only SHA-256 fingerprint identifies rotation without exposing secret material.
- Writer-authorized save/rotate always returns Unverified and clears prior health evidence. Membership-checked reads return a purpose-built projection without ciphertext, fingerprint, API key, token, or secret fields.
- Revocation locks the row and erases ciphertext, fingerprint, and key version. Replay returns the revoked state without a duplicate audit event.
- Three UI cards accept transient password values, clear them after mutation, never repopulate stored secrets, and distinguish Vault ready, Not configured, Unverified, and Revoked state.
- Stored credentials do not create or enable an adapter, bind a model/rate card, contact a provider, reserve spend, or grant execution authority.
- Live acceptance proved encrypted persistence, rotation, secret-free APIs/audits, strict 422/401 boundaries, responsive layout, replay-safe erasure, zero browser errors, and complete QA cleanup without a real key or provider call.
- Release gate: clean lint; 175 TypeScript tests including 29 live database tests; every workspace typecheck; 69-page production build; companion web/native checks; three Rust tests; all 59 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.65.0_x64-setup.exe`: 2,947,136 bytes; SHA-256 `67217efaa587bf784c02c970007a9e017f91de000a31d6f9b33727b45bdbb32a`.

Known limitations: there is no provider-specific verification, health/staleness monitor, adapter linkage, hosted model/capability discovery, endpoint override, rate-card association, self-hosted provider, managed KMS rotation, provider invocation, or actual-usage settlement. The local vault key is development-only custody.

Rollback: retain migration 0059 and encrypted records, stop the connection routes/UI, and deploy 0.64. The previous release ignores the additive table and performs no credential operation.

## 0.64.0 - Durable server-governed adapter registry

Implemented:

- Additive migration 0058 creates normalized provider-adapter and capability tables, seeds the existing local adapter, and restrictively binds workspace preferences to registered exact identities; checksum `4aea717120027b1a8c85f412c881878d570d7a9f5295c6bad67e09b2c84265d4`.
- Durable records capture display/routing classes, context limit, approval, availability/reason, paid-reservation requirement, configuration source, verification timestamps, and a unique closed capability set without storing credentials or endpoints.
- Preference replacement dynamically validates the server registry inside the writer-authorized transaction. Every web planner and preview now receives the same database-backed catalog.
- The strict membership-checked adapter GET route and AI policy expose safe metadata, aggregate counts, and literal false credential/mutation/execution flags. No browser registry mutation exists.
- The AI settings registry panel shows registered, approved, available, and capability counts plus safe adapter identity/status detail; cap fallback uses the explicit no-paid flag rather than qualitative cost.
- Live acceptance proved dynamic rerank registration changed routing and selector state, withheld a quote without a card, enforced 422/401/405 API boundaries, exposed no sensitive adapter keys, rendered responsively without browser errors, and cleaned to the seed-only state.
- Release gate: clean lint; 173 TypeScript tests including twenty-eight live database tests; every workspace typecheck; 68-page production build; companion web/native checks; three Rust tests; all 58 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.64.0_x64-setup.exe`: 2,944,728 bytes; SHA-256 `495c8f933c1d8ff67cfdaffc74f27466237ef411897411f5202e1836621585e0`.

Known limitations: registry changes are migration-managed and have no administrator workflow, change audit, environment scope, health probe/staleness rule, credential/endpoint/account binding, capability discovery, rate-card binding, fallback chain, or invocation. Stored availability is not a live provider guarantee.

Rollback: retain migration 0058 and both tables. Ensure preferences use the built-in seed, stop registry-backed readers, and deploy 0.63, which safely retains its static local default and ignores the additive catalog.

## 0.63.0 - Governed provider/model routing preferences

Implemented:

- Additive migration 0057 stores at most one exact provider/model preference per workspace action with closed action, length, tenant-membership, attribution, and timestamp constraints; checksum `af2ae97674b9c2ceda60702c8bcc08bdded5ea9f88d0b6c08cd14278a4fbd770`.
- Automatic remains the absence of a row. Writers atomically replace the seven-action map through a strict API; viewers can read it, while duplicate, unknown, extra, incompatible, and credential-bearing values fail closed.
- Gateway routing applies capability, privacy, approval, availability, tools, context, and local-only filters before exact preference matching. An ineligible explicit preference returns unavailable without silent fallback.
- Work-readiness plans, policy cost previews, and durable action quotes use the same stored preference, preventing displayed/quoted provider-model divergence.
- The advanced AI settings panel exposes seven action selectors from the server catalog. Six support the current local template route; discovery remains Automatic-only because rerank is not registered.
- Preferences and audits contain no credentials, endpoints, prices, content, prompts, outputs, privacy override, spend authority, or execution capability. Release 0.63 performs planning and quotation only.
- Live acceptance proved persistence, Automatic cleanup, Ready and `$0.00` planning behavior, strict 422 validation, 401 authentication, no console errors, responsive desktop/mobile layout, and zero residual QA preference/audit/quote/reservation rows.
- Release gate: clean lint; 171 TypeScript tests including twenty-seven live database tests; every workspace typecheck; 67-page production build; companion web/native checks; three Rust tests; all 57 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.63.0_x64-setup.exe`: 2,946,728 bytes; SHA-256 `387d25b5f3e2e44819ceac9c868c521e27c219bb82fee03832a19b2fa9f8dc31`.

Known limitations: the adapter catalog is static and contains only the local zero-provider-charge template route; rerank remains unavailable. There is no hosted-provider onboarding, credential/endpoint lifecycle, durable health, fallback chains, route-specific rate binding, actual invocation, or measured settlement. A stored route may become unavailable after a policy/catalog change and must then be cleared or changed.

Rollback: retain additive migration 0057. Stop the preference API and preference-aware planners before deploying 0.62; the older release ignores the table and no stored preference has an external side effect.

## 0.62.0 - Operator AI quote ledger and controls

Implemented:

- A membership-checked repository read returns 1 through 100 newest tenant-bound quotes with time-derived status and optional reservation linkage; the AI page requests the latest 20.
- `AiCostQuoteLedgerItem` is a minimized projection containing scope, currency range, times, state, and linkage while excluding forecasts, lines, hashes, provider/model/card identity, sources, creators, and payloads.
- Strict authenticated GET `/api/v1/ai-cost-quotes` supports only workspace UUID and bounded limit; oversized, extra-field, unauthenticated, and non-member reads fail closed.
- Six ready assistant cards expose writer-only durable-quote controls. The recent ledger refreshes after creation and offers Reserve maximum only for a positive active unlinked quote.
- Zero-charge, expired, consumed, and viewer-visible quotes remain non-reservable. Listing, creation, and reservation still perform no provider execution.
- Live acceptance proved six controls, empty state, button-driven creation, immediate minimized ledger readback, zero-charge no-reservation guidance, responsive layout, strict query failures, authentication, and complete cleanup.
- Release gate: clean lint; 167 TypeScript tests including twenty-six live database tests; every workspace typecheck; 66-page production build; companion web/native checks; three Rust tests; all 56 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.62.0_x64-setup.exe`: 2,946,436 bytes; SHA-256 `6b135b6ca99193ba85a7057759fc1982c9df270fc2248f812796a552e38e9f52`.

Known limitations: recent UI is fixed to 20 rows with no pagination, detail, filtering, export, Campaign-name hydration, retention purge, or deletion. No paid card is configured for live reserve-button acceptance, browser idempotency is not persisted across ambiguous reloads, and provider execution/settlement reconciliation remain future work.

Rollback: no schema change. Stop 0.62 history/operator routes and deploy 0.61; stored quote and reservation evidence remains fully compatible.

## 0.61.0 - Server-owned assistant metering profiles

Implemented:

- Seven closed `assistant-metering-v1` profiles bind every assistant action to exact capability, server feature, and bounded input/output token envelopes; no client or workspace registration path exists.
- Cost planning repeats assistant compatibility and policy routing, then accepts only an approved effective workspace-currency card whose provider/model family matches the selected adapter.
- Token components use exact profile bounds, character components use a conservative four-times conversion, cached input begins at zero, and unsupported second/image meters fail closed.
- Seven minimized policy previews show six current `$0.00` request-only action quotes and one unavailable rerank action without persistence, reservation, provider I/O, or execution.
- A strict writer-only action-quote API accepts only workspace, optional Campaign, action, and rate-card ID, derives capability/feature/forecasts server-side, and persists through the existing durable quote repository.
- Live acceptance proved 6-of-7 coverage, responsive layout, server-scoped durable creation, extra-field rejection, unavailable-action rejection, unauthenticated rejection, and complete QA cleanup.
- Release gate: clean lint; 166 TypeScript tests including twenty-six live database tests; every workspace typecheck; 66-page production build; companion web/native checks; three Rust tests; all 56 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.61.0_x64-setup.exe`: 2,945,153 bytes; SHA-256 `7bac4c621ace6413591a47bcfff1d88093e9c36f939876b3ade712232048bc3c`.

Known limitations: static profiles are not payload/tokenizer-derived and a future executor must enforce or requote their bounds. Only token/character text meters are supported. Hosted adapters/cards, profile administration, quote-history/create/reserve UI, provider execution, and measured line reconciliation remain later work.

Rollback: no schema change. Stop the action-quote route and deploy 0.60; previews disappear while any 0.61-created durable quotes remain compatible audit records.

## 0.60.0 - Durable AI quote identity and reservation binding

Implemented:

- Additive migration 0056 persists immutable tenant-bound quotes and adds a nullable, unique, tenant-bound quote link to spend reservations; final checksum: `6e676939fef74680595e081756c3e03bbc3473c139a53a0a8962ab311dd6ff10`.
- Quote records preserve exact effective rate-card/model identity, closed capability/feature, canonical forecasts and lines, bounded minor-unit cost, creator, five-minute default/15-minute maximum expiry, and a canonical SHA-256 identity.
- Writer-only creation reselects the approved/effective card and writes minimized audit evidence. Quote retrieval derives active, expired, or consumed status from time and reservation linkage.
- Paid reservation accepts only workspace, quote ID, and UUID idempotency. It locks and rehashes the quote, rejects drift/expiry/zero cost/reuse/currency mismatch, derives all spend fields server-side, and atomically applies existing caps.
- One quote links to at most one accepted or denied reservation; identical idempotency replay returns the same reservation. Quote creation and reservation still perform no provider execution.
- Strict create/reserve APIs and minimized policy quote targets expose supported identities and forecast requirements without component prices, source evidence, quote hashes, or execution authority.
- Live acceptance verified durable readiness, minimized target data, zero-charge creation and reservation rejection, strict/unauthenticated failures, responsive layout, no browser errors, and full QA cleanup.
- Release gate: clean lint; 161 TypeScript tests including twenty-six live database tests; every workspace typecheck; 65-page production build; companion web/native checks; three Rust tests; all 56 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.60.0_x64-setup.exe`: 2,946,930 bytes; SHA-256 `0095588a3b47b244b2fceb386c02018359c5e623435d6cafdaf2ead54ec859aa`.

Known limitations: no quote list/detail UI, retention purge, external signature, hosted-provider card, automatic action forecasts, provider execution, or quote-to-settlement line reconciliation. Canonical hashing protects the application-mediated boundary but does not replace production database least privilege and immutable audit storage.

Rollback: retain migration 0056, quotes, and nullable reservation links. Stop 0.60 quote/reservation APIs before deploying 0.59; the older release ignores the additive table/link.

## 0.59.0 - Conservative bounded AI cost quotation

Implemented:

- Additive migration 0055 makes each rate card declare a 0-through-4 currency minor-unit exponent; final checksum: `b5ce6791fa61a72ab90f50e452eb2de0d25d2e3cf85b3c30216b6ee8640d226e`.
- Bounded forecasts must cover every non-request price component exactly once with ordered integer minimum/maximum quantities; missing, duplicate, unused, mismatched, or unsafe inputs fail closed.
- The pure quote engine uses arbitrary-precision integer intermediates and conservative ceiling at component and currency-minor boundaries, never floating-point price arithmetic.
- Quotes bind exact rate-card/provider/model identity, line evidence, minor-unit range, rounding rule, and expiry; they last at most five minutes or until an earlier rate boundary.
- Positive upper cost requires a later reservation, while reservation authorization and execution remain literal false. The current local request-only reference quote is `$0.00` provider charge.
- Live acceptance showed one USD card, the `$0.00` minimized reference, explicit no-reservation/no-execution guidance, no overflow, and no browser errors.
- Release gate: clean lint; 160 TypeScript tests including twenty-five live database tests; every workspace typecheck; 64-page production build; companion web/native checks; three Rust tests; all 55 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.59.0_x64-setup.exe`: 2,949,509 bytes; SHA-256 `ebb862888d13e152e8d1d1d884fb3364c5b7d37bf479f4d7d6d43200c71d4e13`.

Known limitations: the UI quote covers only the fixed local request component. Hosted provider rate cards, capability-specific unit forecasts, provider synchronization, public quote preview, discounts/taxes/FX, persistence/signing, package/Campaign rollups, reservation binding, and actual-cost reconciliation remain later work.

Rollback: retain migrations 0054/0055 and rate evidence; deploy 0.58 after stopping 0.59 quote readers. The prior release ignores the exponent column and quote contract.

## 0.58.0 - Effective-dated AI provider rate-card foundation

Implemented:

- Additive migration 0054 adds server-owned provider rate-card versions and normalized price components; final checksum: `36f827aa5aeda3b7f0c10d826509ef47901fb5c9f3afa3847d1e524d90894233`.
- Approved provider/model-family/currency windows use half-open effective dates and a PostgreSQL exclusion constraint, so one request time cannot resolve two approved prices.
- Components support input, cached-input, output, and request pricing by token, character, second, image, or request in bounded millionth-currency units.
- Every card retains model version, source reference/hash, verification, approval, and lifecycle status; a Market Me grounded-template USD zero-request card proves the registry without claiming hosted-provider prices.
- Server-only reads return full cards internally. The policy API and AI & Cost page expose aggregate effective-card count, currencies, and verification freshness while keeping `monetaryEstimateAvailable` false and providing no price write endpoint.
- Live acceptance showed one effective USD card, explicit Not yet money-estimate guidance, no horizontal overflow, and only normal development console messages.
- Release gate: clean lint; 156 TypeScript tests including twenty-five live database tests; every workspace typecheck; 64-page production build; companion web/native checks; three Rust tests; all 54 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.58.0_x64-setup.exe`: 2,943,265 bytes; SHA-256 `739b681ac18e15dc601ca4855ac28018db04b20ff6fdaf6ffda8dec513a73ae1`.

Known limitations: the registry has no provider synchronization or administration UI/API. Monetary estimates still require exact adapter/model binding, bounded metering forecasts, tokenizer/meter versions, tier/cache/batch rules, minimums/rounding, quote expiry, and reservation linkage. The internal zero card does not model local infrastructure cost.

Rollback: retain additive migration 0054 and source evidence; deploy 0.57 after stopping 0.58 readers. The older release ignores the tables. Do not remove `btree_gist` if any database object still depends on it.

## 0.57.0 - Assistant readiness and qualitative cost indicators

Implemented:

- One non-executing work plan combines each effective assistant profile/action with the current mode/privacy policy and ordinary provider-neutral routing decision.
- Ready plans expose only the selected descriptor's Low/Medium/High cost class. Unavailable plans omit cost and explain which required capability is not configured.
- Every plan fixes `currencyEstimateAvailable` and `execution` false; no money is fabricated without effective-dated rate cards, unit forecasts, and provider-authentic pricing.
- The AI policy projection and assistant cards expose seven plans, status/cost labels, and plain-language reasons without putting model names in the primary UI.
- Live acceptance showed six Ready/Low actions and one Not configured Discovery/rerank action, visible qualitative-rate-card guidance, no overflow, and no current-page console errors.
- Release gate: clean lint; 155 TypeScript tests including twenty-four live database tests; every workspace typecheck; 64-page production build; companion web/native checks; three Rust tests; all 53 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.57.0_x64-setup.exe`: 2,952,328 bytes; SHA-256 `630d01d691856eca21f8840a93bff436e0c0f85be6f9592d0ded586638cfdd8f`.

Known limitations: qualitative cost is not a currency range, package/Campaign total, quote, reservation, or provider SLA. Rate cards, effective dates, provider synchronization, token/unit/output estimation, cache/batch discounts, unusual-cost explanations, quote expiry, and reservation linkage remain future work.

Rollback: no migration was introduced. Deploy 0.56 after stopping 0.57 clients; work-plan projections and card readiness labels disappear while policy, assignments, cache, reservations, and usage remain compatible.

## 0.56.0 - Privacy-bounded AI analysis cache

Implemented:

- Additive migration 0053 stores server-held JSON analysis under the exact workspace/capability/feature/content-SHA/model-family/prompt-version/context-revision key. Final checksum: `0be6beeeed83edc2ba1d1642028cd36f09be608f35f2fe73f1d2446bcba3bb06`.
- Store validates writer authority, stable key bounds, finite acyclic JSON, canonical object ordering, 256-KiB UTF-8 size, canonical SHA-256, and a 60-second-to-30-day TTL.
- Active rows are first-write-wins; expired rows may refresh and reset hits. Exact unexpired lookup atomically increments hit count/time, while any key change or expiry is a miss.
- Authenticated AI policy/page projections expose only active count, total result bytes, hits, and freshness. Cached keys/results have no browser API and result payloads remain internal.
- Live acceptance displayed one active entry, three hits, and 42 bytes without visible payload data, with no overflow or current-page console errors, then removed the exact QA row.
- Release gate: clean lint; 153 TypeScript tests including twenty-four live database tests; every workspace typecheck; 64-page production build; companion web/native checks; three Rust tests; all 53 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.56.0_x64-setup.exe`: 2,945,574 bytes; SHA-256 `a8d58bc10dc92ea698255b71575dc6941bea04ce38c7341ed57e077d5b652ba5`.

Known limitations: no generator/provider call site uses the cache yet. There is no browser payload/list/write/invalidate API, background purge, quota, encrypted result envelope, cache-hit usage linkage, distributed stampede lease, or large-scale rollup. Production retention, legal hold, deletion, backup, and access policy remain required.

Rollback: retain additive migration 0053 and cached results; stop 0.56 cache writers/readers before deploying 0.55. The older release ignores the table and rows expire naturally. No provider/workflow compensation is required.

## 0.55.0 - Governed workspace assistant assignments

Implemented:

- Additive migration 0052 stores at most one explicit closed assistant profile per workspace/action with tenant-bound creator/updater evidence; omission remains Automatic. Final checksum: `c9d2c1b896076bcf1cce4fca90c6eab40b1f0a7c3853187254e96fa3a6324a2f`.
- Compatibility requires the profile to declare the action and the action's unchanged required capability. Unknown IDs, duplicates, incompatible roles, and undeclared provider/model/execution fields fail closed.
- Writer-authorized replacement deletes the prior explicit set and inserts the validated zero-to-seven set atomically, with one minimized closed-pair audit event. Readers derive all seven effective selections from stored choices plus automatic defaults.
- A strict authenticated GET/PUT API and responsive AI & Cost controls expose Automatic plus compatible choices, workspace-selected state, persistence after refresh, and explicit no-provider/no-execution markers.
- Live acceptance covers compatible save/reload, strict 422 input, unauthenticated 401 read/write, restoration to zero rows, exact audit cleanup, seven controls, no overflow, and no current-page console errors.
- Release gate: clean lint; 152 TypeScript tests including twenty-three live database tests; every workspace typecheck; 64-page production build; companion web/native checks; three Rust tests; all 52 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.55.0_x64-setup.exe`: 2,946,324 bytes; SHA-256 `ac7b4ba577c53c086d2948b08e57364b409d14d6e7b21100a44602a83ab76116`.

Known limitations: preferences are workspace-wide and action-based, with no revision token, approval, scheduling, history UI, Brand/Campaign/member scope, availability-aware fallback, provider/model assignment, prompt configuration, or execution. Catalog compatibility changes need an explicit repair plan for retained rows.

Rollback: retain additive migration 0052, rows, and audit evidence; stop assignment writes before deploying 0.54. The older release safely ignores explicit rows and uses Automatic for every action. No provider or workflow compensation is required.

## 0.54.0 - Capability-oriented AI assistant profiles

Implemented:

- Added the seven specification-defined profiles: Content Analyst, Copy Assistant, Campaign Planner, Discovery Assistant, Conversation Assistant, Compliance Reviewer, and Performance Analyst.
- Closed tuples define profile IDs, seven product actions, and analysis/draft/recommendation/proposed-action output kinds. Each immutable profile declares its purpose, eligible action, gateway capabilities, and literal false execution authority.
- An exhaustive automatic action map and pure selector return one role plus its required capability and explicit guardrails; selection never routes or invokes an adapter.
- The authenticated AI policy projection and responsive AI & Cost page expose the full catalog and all seven automatic selections with an `assistantExecution: false` API marker.
- Authenticated browser acceptance proves every role appears once, the automatic/no-execution language is visible, a 1,280-pixel layout has no horizontal overflow, and a fresh page has no console errors.
- Release gate: clean lint; 149 TypeScript tests including twenty-two live database tests; every workspace typecheck; 63-page production build; companion web/native checks; three Rust tests; all 51 migrations remain clean/idempotent.
- Unsigned installer `Market Me Companion_0.54.0_x64-setup.exe`: 2,944,260 bytes; SHA-256 `feb435041ee8323c13f3cffcc43e58e2c461257574ec837c8edd59e71291c0e6`.

Known limitations: selection is static/automatic with no workspace override or per-action persistence. Profiles do not configure or execute adapters, and most declared capabilities have no current executable provider. Advanced profile/provider/model assignment, prompt configuration, orchestration, and hosted credentials remain later work.

Rollback: no migration was introduced. Deploy 0.53 after stopping 0.54 clients; the assistant projection and UI cards disappear while all AI policy, reservation, exception, alert, and usage data stays compatible. No provider or workflow compensation is required.

## 0.53.0 - Deterministic AI cap-response plans

Implemented:

- One closed cap-response plan translates an exact persisted denial into pause, request approval, a known no-paid lower-cost adapter, a limited draft, or a visible manual outcome without executing work.
- Pure `planAiCapResponse` logic preserves the denied capability and captured cap behavior, applies approval/availability/privacy/capability constraints, and accepts only a caller-owned no-paid adapter list.
- A strict authenticated preview route and the AI policy projection expose `execution: false`/`providerCall: false`; the AI & Cost page shows the safe next action beside recent denials.
- Text and structured-output fallback may select Market Me's deterministic local grounded templates. Unsupported image and other capabilities fail visibly to manual handling rather than silently choosing a paid or external provider.
- Live/API/browser acceptance covers 401/422 boundaries, eligible text fallback, unsupported-image handling, policy and SSR projections, responsive layout, no console errors, exact cleanup, and all 51 clean/idempotent migrations.
- Release gate: clean lint; 147 TypeScript tests including twenty-two live database tests; every workspace typecheck; 63-page production build; companion web/native checks; three Rust tests.
- Unsigned installer `Market Me Companion_0.53.0_x64-setup.exe`: 2,944,409 bytes; SHA-256 `b462a7104e4fa15e3e08ed6a4ca086a7e4642b6d694dee9c4172d5d84d0c8276`.

Known limitations: plans are advisory. They do not pause a durable AI work item, invoke a generator, create/consume approval, or call a provider. There is no general billing-class contract, and the known no-paid adapter supports only text and structured output. Hosted adapters, credentials, current price data, tokenizer-backed estimates, and automatic fallback remain future work.

Rollback: no migration was introduced. Deploy 0.52 after stopping 0.53 clients; policy/reservation data remains compatible, while the preview route and UI projection disappear. No provider compensation or workflow migration is necessary because planning has no side effect.

## 0.52.0 - One-time AI spend exception approvals

Implemented:

- Migration `0051_ai_spend_exception_approvals.sql` adds tenant-bound pending/approved/rejected/expired requests, 24-hour validity, bounded justification/decision text, one request per denial, and one exception-linked reservation. Final checksum: `e536db747f55ce96a147d3bf84f1f406bfc14067fe32f6ad719eeeb4688851b1`.
- Writers may request an exception only for an exact `denied` reservation whose captured cap behavior is `require_approval`; all cost, scope, Campaign, capability, feature, and currency fields are server-derived.
- Approval-role decisions are strict and replay safe. Internal consumption locks the workspace/request, rejects expiry and currency drift, and copies the exact estimate into one 15-minute reservation; retry returns that reservation.
- Authenticated policy reads and AI & Cost controls expose request, justification, expiry, decision, and consumed state. Browser APIs create/decide only; there is no consume, provider-call, settlement, or arbitrary override endpoint.
- Integration/live/browser acceptance covers roles/tenant boundaries, request/decision replay, conflict rejection, one-time consumption, settlement, expiry, alert creation, 401/422/201/200 contracts, SSR state, redacted audits, zero console errors/overflow, exact cleanup, and 51 clean/idempotent migrations.
- Release gate: clean lint; 142 TypeScript tests including twenty-two live database tests; every workspace typecheck; 62-page production build; companion web/native checks; three Rust tests.
- Unsigned installer `Market Me Companion_0.52.0_x64-setup.exe`: 2,944,122 bytes; SHA-256 `6423f8b00ef64716768382a88a4c734c0ef8fc95dd2b2901000f78d838bdd839`.

Known limitations: no paid provider call site consumes approvals yet. There is no enforced dual control, reviewer assignment, cancellation/revocation, reminder, optional-note UI, per-user inbox, or executor for the other three cap behaviors.

Rollback: retain additive migration 0051 and all evidence, stop exception work before deploying 0.51, and expect pending/approved requests to remain inert until 0.52 returns. Ordinary cap enforcement remains compatible.

## 0.51.0 - Durable AI budget threshold alerts

Implemented:

- Migration `0050_ai_budget_alerts.sql` adds tenant-bound open/acknowledged notices, exact scope/window/threshold/cap/currency deduplication, source-reservation evidence, acknowledgment membership, and open/recent indexes. Final checksum: `fe24b0596add753a2984f7f3541b25db3a8a87b5c4864792da13e22fbaff9c8b`.
- Accepted reservations atomically create every configured daily, Campaign, or monthly threshold notice reached by settled plus reserved cost. UTC day/month and exact Campaign windows, integer comparisons, and `ON CONFLICT DO NOTHING` make concurrent/replayed evaluation deterministic.
- Alerts are retained after release, expiry, or lower settlement and snapshot the committed amount/cap at crossing. Denied reservations never generate notices.
- Authenticated policy reads and the AI & Cost page expose bounded open-first history. A strict writer-only acknowledgment route is tenant-bound and replay safe; acknowledgment does not alter spend, policy, routing, or execution.
- Integration/live/browser acceptance covers six threshold/scope combinations, deduplication after release/re-crossing, viewer/cross-workspace rejection, acknowledgment replay, minimized audits, 401/422/200 boundaries, SSR state, zero console errors/overflow, exact cleanup, and fifty clean/idempotent migrations.
- Release gate: clean lint; 140 TypeScript tests including twenty-one live database tests; every workspace typecheck; 61-page production build; companion web/native checks; three Rust tests.
- Unsigned installer `Market Me Companion_0.51.0_x64-setup.exe`: 2,950,273 bytes; SHA-256 `413b7d44b678b2c5854813e845740719884c1bd731e3a84c028378309c4ec858`.

Known limitations: alert evaluation is reservation-triggered, not retroactive on policy edit. Acknowledgment is shared, and there is no external delivery, scheduler, per-user subscription/read state, snooze/reopen, escalation, global badge, or cap-behavior executor.

Rollback: retain additive migration 0050 and its evidence, stop 0.51 reservations before deploying 0.50, and expect the older UI to ignore notices. Transactional cap enforcement remains compatible.

## 0.50.0 - Transactional AI spend authorization

Implemented:

- Migration `0049_ai_spend_reservations.sql` adds tenant-bound, idempotent 15-minute reservation decisions plus a same-workspace one-to-one settlement link into the metadata-only usage ledger. Final checksum: `523915fa931bde33919fe4ef8490416f22a5602833a113498720ebfb6e0557f0`.
- Server-side reservation decisions serialize per workspace, expire stale holds, enforce exact currency and Campaign ownership, and evaluate settled usage plus all active estimates against UTC daily/monthly and all-time Campaign caps. Denials retain the exceeded scopes and captured cap behavior.
- Settlement is atomic, replay safe, limited to the reserved estimate, and creates exactly one usage event. Release and expiry restore headroom without usage; direct non-zero usage writes are rejected.
- `GET /api/v1/ai-policy` and the responsive AI & Cost page expose read-only settled/reserved/available totals, active authorization leases, and recent decisions. No client-facing reservation, settlement, provider-call, credential, or arbitrary-usage API was introduced.
- Audits retain minimized operational evidence only. Integration/live/browser acceptance covers authorization, idempotency, boundary-crossing holds, Campaign/daily denial, settlement/release/expiry, linked usage, bypass rejection, strict auth, SSR content, responsive layout, and zero console errors.
- Release gate: clean lint; 138 TypeScript tests including twenty live database tests; every workspace typecheck; 61-page production build; companion web/native checks; three Rust tests; clean/idempotent application of all 49 migrations.
- Unsigned installer `Market Me Companion_0.50.0_x64-setup.exe`: 2,943,197 bytes; SHA-256 `88a02f91cc4ca5319fa91b1e497549b7234a7273e1c28de0311e853817fb0718`.

Known limitations: no hosted/self-hosted paid adapter, credential vault, tokenizer-backed estimator, provider price catalog, cap approval flow, alert delivery, automatic fallback execution, model-health polling, per-request UI, or evaluation harness exists. Actual cost cannot exceed the reservation, and the UI still assumes two-decimal currencies.

Rollback: retain additive migration 0049 and its operational evidence. Stop all 0.50 AI callers and resolve or expire active holds before deploying 0.49; paid provider execution must remain disabled because 0.49 does not consult reservations.

## 0.49.0 - Provider-neutral AI gateway and cost controls

Implemented:

- Migration `0048_ai_gateway_cost_controls.sql` adds one tenant-bound workspace AI policy and an append-only metadata-only usage ledger with closed mode/capability/privacy/failover/cap behavior values, positive budgets, non-negative usage, Campaign ownership, and query indexes. Final checksum: `7d855d428d44da2d9819826543ec0dff4b179fb2b3bbc68903cad1792ac6ad78`.
- Six outcome-first modes expose quality, speed, privacy, and cost indicators without requiring ordinary users to choose model names. Eight provider-neutral capabilities define the stable application-to-model boundary.
- Deterministic routing filters approval, availability, capability, tools, context, and privacy before mode ranking. It fails closed when no adapter qualifies and never broadens exposure silently. The only current descriptor is the existing local grounded-template generator for text/structured output.
- Authenticated strict policy/preview APIs plus the responsive AI & Cost page expose privacy/failover/cap intent, optional daily/Campaign/monthly budgets, alert thresholds, same-currency monthly spend, advanced numeric usage, and capability readiness. They accept no credentials, prompts, provider URLs, arbitrary adapters, or execution commands.
- Usage records contain operational counts/cost/latency and optional hash/version references only; policy audits contain controls only. No external model call, provider fallback, budget enforcement, alert delivery, workflow, publication, or outbound action was introduced.
- Integration/live/browser acceptance covers writer/viewer policy authority, thresholds, UTC monthly/currency aggregation, 401/422 boundaries, local text selection, unavailable image routing, SSR content, zero console errors, minimized audits, exact cleanup, and a fresh/idempotent 48-migration database.
- Release gate: clean lint; 137 TypeScript tests including nineteen live database tests; every workspace typecheck; 61-page production build; companion web/native checks; three Rust tests.
- Unsigned installer `Market Me Companion_0.49.0_x64-setup.exe`: 2,944,265 bytes; SHA-256 `75e7e16122e14f2efafbf1ed297fa253dcea587f5d500b43798a85a7058609ab`.

Known limitations: no external/self-hosted provider adapter, credential vault, endpoint discovery, tokenizer, model health poller, cache executor, real call-site usage wiring, daily/Campaign cap evaluation, spend reservation/settlement, alert delivery, approval flow, automatic fallback, or evaluation harness exists yet. The current two-decimal UI needs a currency-exponent abstraction before broader currency support.

Rollback: retain additive migration 0048 and stop 0.49 policy/usage writes before deploying 0.48. The prior release ignores these tables. No external compensation is required because Release 0.49 cannot invoke an external model.

## 0.48.0 - Configurable conversation retention preview

Implemented:

- Migration `0047_conversation_retention_policy.sql` adds explicit standard/personal-message/imported-email/legal-hold thread classes, reviewer/time evidence, one workspace preview policy, class-specific 1–3,650-day windows, and a closed-thread eligibility index. Final checksum: `40ba05036225054eabb1730869169ad45fbc7bf3f195e064763a234ca879d053`.
- Retention classes are manually reviewed and never inferred from provider, body, identity, or model output. Legal hold and active threads are excluded before eligibility calculation.
- The preview uses latest stored message time or thread creation plus the exact class window, returns at most 200 resolved/archived candidates ordered by eligibility/UUID, and disappears when policy is disabled.
- Authenticated policy/class APIs and responsive inbox/detail controls expose configuration, last review, hold safety, and top eligible records. There is no delete, purge, anonymize, workflow, connector, or provider action; DELETE is unsupported.
- Integration/live acceptance covers viewer rejection, per-class dates/order, legal hold, disabled policy, 401/422/405 boundaries, SSR rendering, retained source rows, minimized audits, policy preservation, and exact cleanup.
- Release gate: clean lint; 129 TypeScript tests including eighteen live database tests; every workspace typecheck; 58-page production build; companion web/native checks; three Rust tests; clean/idempotent application of all 47 migrations.
- Unsigned installer `Market Me Companion_0.48.0_x64-setup.exe`: 2,946,562 bytes; SHA-256 `fd73e47fdb91c3504271d6d2c57cffa9c0b3ef730afd4b5043ad37091bc88821`.

Known limitations: eligibility is not deletion authorization or execution. There is no dual approval, legal basis, subject export, dependency/reference plan, anonymization, backup/object/Temporal/provider erasure, hold reason/expiry, retention exception, or pagination beyond 200. Classification is manual and workspace-local.

Rollback: retain additive migration 0047 and stop 0.48 policy/class writes before deploying 0.47. The prior release ignores retained metadata. No recovery or external compensation is required because Release 0.48 cannot delete records.

## 0.47.0 - Deterministic in-app conversation attention

Implemented:

- Migration `0046_conversation_attention_queue.sql` adds a bounded overdue-to-escalation delay to workspace service-level policy and an active-thread deadline index. Final checksum: `bfd85a8dac9c597c0f930f7c53feddd6683dba127133254e8320bf66506b83c3`.
- `ConversationAttentionItem` combines mutually exclusive response-at-risk/overdue/escalation state with simultaneous due follow-up, review-request, and handoff reasons. Active threads are ranked deterministically by severity, earliest source deadline, and UUID; resolved/archived threads are excluded.
- The policy UI/API persists zero-through-10,080 `escalationAfterMinutes`. The authenticated attention API returns at most 200 items; the Conversations panel renders the top twenty with subject, relationship, owner, reason labels, due time, and thread links.
- Evaluation is derived and refresh-driven. Reading the queue creates no audit, thread mutation, assignment, handoff, workflow command, notification, connector request, or outbound message.
- Integration/live acceptance covers four simultaneous reasons, at-risk math, severity ordering, closed-thread exclusion, 401 authorization, SSR rendering, unchanged assigned status, policy preservation, and exact cleanup.
- Release gate: clean lint; 127 TypeScript tests including seventeen live database tests; every workspace typecheck; 57-page production build; companion web/native checks; three Rust tests; clean/idempotent application of all 46 migrations.
- Unsigned installer `Market Me Companion_0.47.0_x64-setup.exe`: 2,943,708 bytes; SHA-256 `385b82c615c79472cbd6459e21599dc3eb65bb393c896fc4c578f2926806cc62`.

Known limitations: attention is recalculated on request and is not a durable delivered notification. There is no scheduler, push/email delivery, notification history, acknowledgement, snooze, subscriptions, holiday calendar, escalation recipient/action, pagination beyond 200, or global badge.

Rollback: retain additive migration 0046 and stop 0.47 policy writes before deploying 0.46. The prior release ignores the extra column/index, and the derived queue has no stored or external side effect requiring compensation.

## 0.46.0 - Shared review-only response composer

Implemented:

- Migration `0045_conversation_response_composer.sql` adds one shared response draft per thread, optional same-thread assistant-suggestion provenance, exact creator/last-editor membership, and expiring human/assistant presence leases. Final checksum: `0fb8fc5550c09a42a2e6f2fe267fd93de93b6430fbcc632981f40534137d400b`.
- `ConversationComposerRepository` provides workspace-authorized state, save, discard, heartbeat, and clear operations. Draft bodies are bounded to 20,000 characters; presence leases renew for two minutes, are capped by the database at five minutes, and are never authorization or locking state.
- The Conversation Assistant now exposes server-controlled drafting presence around generation and clears it on every success/failure path. Adopting a response preserves the immutable source suggestion ID without changing suggestion lifecycle or claiming approval.
- Authenticated draft and presence APIs plus the thread-detail shared composer support edit, adopt, save, discard, active-author labels, last-editor attribution, character count, and explicit review-only/no-send language. There is no outbound, connector, scheduling, approval, or provider action.
- Audits retain draft/source IDs and character count only. Integration/live acceptance covers two writers, provenance binding, assistant cleanup, presence renewal/clear, 401 authorization, SSR rendering, zero outbound-observed messages, raw-draft audit exclusion, and exact cleanup.
- Release gate: clean lint; 126 TypeScript tests including sixteen live database tests; every workspace typecheck; 56-page production build; companion web/native checks; three Rust tests; clean scratch application of all 45 migrations and idempotent rerun.
- Unsigned installer `Market Me Companion_0.46.0_x64-setup.exe`: 2,945,340 bytes; SHA-256 `717b66aa474d7e5cd4919a779567915fe1f768aac68db8d91c59238dfd544d6b`.

Known limitations: one shared draft is last-write-wins rather than CRDT-backed. Presence is lease-based and refresh-on-read rather than realtime-pushed. There is no autosave, version history, approval decision, reply/send adapter, attachment authoring, scheduling, inline review comments, localization, or conflict-resolution UI.

Rollback: keep additive migration 0045 and retained drafts applied. Stop composer writes before deploying 0.45; the prior release ignores the rows. No external compensation is required because Release 0.46 cannot dispatch provider work.

## 0.45.0 - Evidence-backed Conversation Assistant suggestions

Implemented:

- Migration `0044_conversation_response_suggestions.sql` adds immutable response suggestions with closed active/dismissed/superseded lifecycle, one-active-per-thread enforcement, recommendation/response/destination/uncertainty invariants, same-workspace references, context/citation/claim snapshots, generator provenance, and input fingerprints. Final checksum: `a9eb512185aa9b09c6ea0282c702077bcabffba83762dd16bf1582f3be2cc2d7`.
- The provider-neutral generation package now includes `grounded-conversation-template` 1.0.0. It deterministically summarizes the latest inbound context, extracts up to five questions, recommends respond/clarify/no-response/human-review, shows uncertainty reasons, bounds promotion, and proposes only an exact published Destination.
- Input is assembled server-side from at most twenty external messages, suppression-first relationship safety, reviewed classification, and published Brand/Campaign/Destination context. Internal notes, provider metadata, credentials, unpublished context, and arbitrary client prompts are excluded.
- Factual claims require valid citation indexes and the initial provider adds business facts only from the exact cited published Destination. Regeneration supersedes rather than rewrites history; dismissal is explicit and retained.
- Authenticated list/generate/dismiss APIs and the thread-detail Conversation Assistant panel show questions, review-only draft or no-response decision, uncertainty, citations, claims, generator identity, and prior history. No assistant action sends a response or invokes a provider.
- Integration and live acceptance cover 401 authorization, decimal-bearing question extraction, Destination citation/claim binding, fingerprint format, supersession, dismissal, suppression-first no-response, zero outbound messages, minimized audits, SSR rendering, and exact cleanup.
- Release gate: clean lint; 124 TypeScript tests including fifteen live database tests; every workspace typecheck; 56-page production build; companion web/native checks; three Rust tests; clean scratch application of all 44 migrations; and idempotent development rerun.
- Unsigned installer `Market Me Companion_0.45.0_x64-setup.exe`: 2,948,511 bytes; SHA-256 `32237b382e054feb7c01f7ae119fa3cd49d07c754477191dfbc5fcacb92ccbfb`.

Known limitations: the initial provider is a deterministic local template rather than a hosted model. There is no composer acceptance/send path, automatic handoff, approved Content Package retrieval, localization, semantic extraction, model evaluation/feedback, streaming, or autonomous response policy. Suggestions retain message-body snapshots and require production retention/erasure policy.

Rollback: keep additive migration 0044 and retained suggestions applied. Stop assistant generation before deploying 0.44; the prior release ignores these rows and no external compensation is needed because suggestion actions never dispatch work.

## 0.44.0 - Deterministic strong-evidence identity discovery

Implemented:

- Migration `0043_identity_candidate_discovery.sql` adds manual-versus-scanner provenance, SHA-256 evidence fingerprints, closed integrity checks, and a pending review-queue index. Final checksum: `d07b63a85e97bfeb4fe365e7226d41e2992d75773bfba676a894baeb05edc4b7`.
- A workspace-authorized deterministic scanner considers verified identities only and matches exact normalized email addresses, canonical HTTPS profile links, or UUID/URN/namespaced identifiers. Names, organizations, notes, messages, handles, and model output are excluded.
- Scans read at most 5,000 verified identities, ignore a signal shared by more than five relationship roots, create at most 100 suggestions, and list at most 200 pending candidates. Retries are idempotent and existing or dismissed direct pairs are never reopened automatically.
- Candidate rows retain only closed evidence kind, deterministic confidence, provenance, and a lowercase SHA-256 fingerprint. Raw matched addresses, URLs, identifiers, names, and provider subjects do not enter link audit dictionaries.
- Authenticated list/scan APIs and a Conversations review queue surface each candidate with explicit links to the existing confirm/dismiss interface. Discovery never confirms a link, changes contact permission, moves identities/conversations, starts a workflow, or calls a provider.
- Integration and live acceptance cover exact address, canonical URL, namespaced identifier, same-name exclusion, authentication, retry idempotency, dismissal non-reopening, 64-hex fingerprints, minimized audits, SSR queue controls, and exact QA cleanup at zero.
- Release gate: clean lint; 119 TypeScript tests including fourteen live database tests; every workspace typecheck; 56-page optimized web build; companion web/native checks; three Rust tests; clean all-migrations scratch database through 0043; and idempotent development migration rerun.
- Unsigned installer `Market Me Companion_0.44.0_x64-setup.exe`: 2,946,446 bytes; SHA-256 `8c75fb26369cfc5860682e78050f5fc39669ce1dd7e42df0856260635935d9fa`.

Known limitations: discovery is manually triggered, exact-match only, and bounded. There is no background/import-time scan, provider verification callback, bulk review, candidate search/filter, attached evidence artifact beyond kind/fingerprint, CRM synchronization, or approximate matching. Retention/export/erasure policy remains production work.

Rollback: keep additive migration 0043 applied and stop scans before deploying 0.43. Release 0.43 ignores provenance/fingerprints and treats retained suggestions as ordinary identity-link suggestions; reviewed link state remains compatible.

## 0.43.0 - Reviewed cross-provider identity resolution

Implemented:

- Migration `0042_relationship_identity_resolution.sql` adds canonical same-workspace relationship pairs, suggested/confirmed/dismissed lifecycle, closed evidence kinds, bounded confidence, retained reviewers, tenant constraints, query indexes, and recursive effective contact safety. Checksum: `19258eaba1b1caf0563a4e95f5019c7372274907d861b5d887e5e59ddc56551f`.
- Confirmed links create a transitive shared relationship view without moving or deleting provider identities, conversations, or root records. Suggestions remain separate and display evidence plus confidence; dismissing a confirmed edge reverses the link exactly.
- Evidence accepts only verified links, exact addresses, strong identifiers, or user confirmation. Self-links, cross-workspace candidates, already-connected groups, similar-name evidence, and out-of-range confidence fail closed.
- The shared view hydrates member roots and their preserved provider identities. A reusable recursive function makes any suppression in the confirmed component the effective do-not-contact state for relationship lists, new-thread options, and conversation reads.
- Authenticated create/read/review APIs and the relationship edit-page panel support suggestion, direct confirmation, review, separation, shared-member inspection, and retained link history. No provider or CRM mutation occurs.
- Audits contain stable IDs, closed evidence kind, and confidence only; names, addresses, handles, provider subjects, notes, messages, credentials, and provider payloads remain excluded.
- Live API acceptance proved 401/422 boundaries, suggestion/confirmation/dismissal, 1→2→1 group membership, allowed→suppressed→allowed safety, and minimized audits. Authenticated server-rendered UI acceptance proved group/safety/control rendering and registry propagation; Chrome extension visual inspection was unavailable.
- Release gate: clean lint; 118 TypeScript tests including thirteen live database tests; all workspace type checks; 55-page optimized web build; companion web/native checks; three Rust tests; clean all-migrations scratch database; idempotent rerun through 0042; and exact QA cleanup at zero.
- Unsigned installer `Market Me Companion_0.43.0_x64-setup.exe`: 2,944,357 bytes; SHA-256 `4acb182f43289efa608635503d74be7f5ce875fd482fd8ac7095c46993dddcfb`.

Known limitations: evidence entry is manual; there is no automatic candidate scanner, bulk review queue, identity-link search/filter, attached evidence artifact, approver-only policy, CRM synchronization, or provider mutation. The shared view combines roots/identities and safety but not a unified conversation timeline. Retention/export/erasure policy remains production work.

Rollback: migration 0042 is additive and should remain applied. Stop identity-link writes before deploying 0.42. Retained links are ignored by 0.42, including group-level suppression, so do not introduce relationship-targeted outbound behavior while rolled back.

## 0.42.0 - Internal review requests and teammate mentions

Implemented:

- Migration `0041_conversation_review_requests.sql` adds tenant-bound review requests, optional same-thread source-note evidence, retained open/resolved/cancelled history, bounded teammate mentions, and indexes for thread and reviewer queues. Its final checksum is `14120cefa794d042f761ab9d15d95ea9a370b1fc02b255fcab58902181ccce8d`.
- Strict create/close APIs require a different action-eligible requested reviewer, at most twenty additional current members, optional offset-aware due time, and an optional same-thread `internal_note`. Only the reviewer resolves; only the requester cancels.
- Conversation detail hydration returns request history, member names, mentions, and a cited-note excerpt. Inbox list hydration exposes only `openReviewRequestCount`, not collaboration text.
- The detail interface creates requests, cites internal notes, selects additional mentions, and exposes only role-authorized close controls. It explicitly states that nothing is sent externally; inbox cards show the open internal-review count.
- Creation and closure never change thread status/owner/read/service-level state, send notifications, issue workflow commands, create provider messages, or call connectors. Audit dictionaries omit request text, note content, message bodies, contacts, and provider data.
- Live API/database acceptance covered 401/422 boundaries, self/ineligible reviewer rejection, source-note enforcement, hydration/privacy, close authorization, membership removal, state non-mutation, and minimized audits. Browser acceptance covered create/list/detail/cancel behavior, cited-note/mention rendering, retained `new`/unassigned state, zero warnings/errors, and 1280-pixel no-overflow rendering.
- Release gate: clean lint; 116 TypeScript tests including twelve live database tests; all workspace type checks; 55-page optimized web build; companion webview/native checks; three Rust tests; clean scratch application of every migration; idempotent rerun through 0041; and exact QA cleanup verified at zero.
- Unsigned installer `Market Me Companion_0.42.0_x64-setup.exe`: 2,951,133 bytes; SHA-256 `45657d8df4499fbac392c8f896fe95618802deb48b60b551c1125b1da828c4c0`.

Known limitations: there is no email/push/in-app notification feed, request/mention unread state, review-request inbox filter, multiple requested reviewers, threaded review comments, approval decision or diff attachment, edit/reopen/delete UI, drafting presence, or AI-generated review/response. Membership removal deletes optional mention edges; core requester/reviewer attribution remains. Review requests never perform provider delivery.

Rollback: migration 0041 and the added message composite uniqueness constraint are additive and should remain applied. Stop review-request writes before deploying 0.41. Retained records can remain because 0.41 ignores them and there are no background, workflow, notification, or provider effects.

## 0.41.0 - Workspace service levels and at-risk flags

Implemented:

- Migration `0040_conversation_service_levels.sql` adds one workspace policy with an IANA timezone, seven-bit business-day mask, local hours, urgency-specific response-minute targets, an at-risk lead time, tenant/author integrity, and bounded checks.
- `conversation_add_business_minutes` derives UTC deadlines across configured local business windows and daylight-saving changes. A Friday 16:30 America/Chicago start plus 120 business minutes resolves to Monday 10:30 local time.
- Authenticated `GET` and `PUT /api/v1/conversation-service-level-policy` routes expose strict policy reads/writes. Invalid timezones and reversed business hours fail with bounded validation errors.
- Conversation reads choose manual `responseDueAt` first; otherwise the latest inbound-created timestamp or thread creation seeds the workspace target for the reviewed urgency. Resolved and archived threads have no active service clock.
- `ConversationServiceLevelSummary` returns only `on_track`, `at_risk`, or `overdue`, the derived due time, and `manual` or `workspace_policy` source. Evaluation never mutates status, owner, handoff, workflow, or provider state.
- Conversations now includes a workspace policy form plus list/detail service-level labels. Browser acceptance proved policy updates, manual precedence, at-risk/overdue rendering, unchanged state/ownership, privacy, zero warnings/errors, and no horizontal overflow at 1280 px.
- Live acceptance proved unauthenticated 401, invalid-hours/timezone 422, save/read, deterministic business-time math, policy projection, manual precedence, state non-mutation, and content-free audit evidence.
- Release gate: clean lint; 115 TypeScript tests including twelve database tests; all workspace type checks; 55-page optimized web build; companion webview/native checks; and three Rust tests. Exact QA threads, relationship, policy, audits, and sessions were removed and verified at zero. Migration rerun skipped cleanly through `0040_conversation_service_levels.sql`.
- Unsigned installer `Market Me Companion_0.41.0_x64-setup.exe`: 2,944,889 bytes; SHA-256 `ef87322308f856f36e5a9b0c7711b37936a3f318d9d9a1bc5b587634c5e51ae9`.

Known limitations: there is no scheduler or reminder delivery, holiday calendar, per-account/Brand policy, SLA inbox filter, escalation mutation, status-based clock pause, policy disable/delete UI, or audit-history UI. The displayed state is a read-time flag, not a delivery or resolution guarantee.

Rollback: migration 0040 is additive and should remain applied. Release 0.40 ignores retained policies and the helper function. Stop policy writes before rollback; policy rows can remain because they create no background, workflow, or provider action.

## 0.40.0 - Deterministic suggested conversation routing

Implemented:

- Migration `0039_conversation_routing_rules.sql` adds workspace routing rules with case-insensitive names, enabled/priority lifecycle, explicit closed matchers, consistent owner/status targets, tenant/member foreign keys, and deterministic evaluation indexing.
- Strict schemas require at least one Brand/account/relationship-stage/intent/urgency matcher. Assigned targets require an eligible owner; non-assigned targets forbid one.
- Repository APIs create/list and enable/disable rules, validate referenced roots and owner roles, and emit minimized audits that exclude rule names and conversation/contact content.
- One tenant-correlated lateral query selects a matching rule by priority, specificity, update time, and UUID. Ineligible owners cannot win; disabled rules fall out immediately.
- Inbox and detail pages render the exact winning rule, matched fields, and proposed owner/status. Suggestions are advisory: the thread remains unchanged until an operator uses the existing controls.
- The routing-rule panel creates reviewed rules and exposes their enabled state. It passes bounded Brand/account/member options and never receives credentials, full profiles, member email, message bodies, notes, or provider payloads.
- Live acceptance proved unauthenticated 401, missing matcher 422, ineligible owner 422, specificity winner, disable fallback, restore behavior, unchanged owner/status, and minimized audit evidence. Browser acceptance proved rule creation plus list/detail explanations, zero warnings/errors, and no horizontal overflow at 1280 px.
- Next.js 16.3 loopback development resources are explicitly allowed for `127.0.0.1`, restoring hydrated browser QA while keeping `localhost` as the documented local origin.
- Release gate: clean lint; 114 TypeScript tests including twelve database tests; all workspace type checks; 54-page optimized web build; companion webview/native checks; and three Rust tests. Exact QA rules, threads, relationships, audits, and sessions were removed and verified at zero.
- Unsigned installer `Market Me Companion_0.40.0_x64-setup.exe`: 2,944,690 bytes; SHA-256 `a2db331935b7310e223b65712bb8421790adee7f7cf16b39cc6cb4c8da1d6343`.

Known limitations: rules suggest but never apply state. There is no automatic assignment, team/queue target, response drafting, message-content matching, sentiment matching, SLA/calendar condition, compound OR/NOT logic, rule editing/deletion UI, simulation report, notification, provider routing, or AI inference. Brand/account/member references are deletion-restricted while retained rules depend on them.

Rollback: migration 0039 is additive and should remain applied. Release 0.39 ignores retained rules. Stop rule writes before rollback; disable or remove dependent rules under retention policy before deleting referenced Brands, accounts, or memberships.

## 0.39.0 - Reviewed Destination and Publication share history

Implemented:

- Migration `0038_conversation_shared_resources.sql` creates immutable observed-share evidence with strict Destination-or-Publication targets, same-workspace composite foreign keys, recorder-membership integrity, UUID idempotency, and bounded history indexes.
- Shared write contracts require workspace/thread, idempotency UUID, offset-aware observed time, and exactly one target branch. Publication account identity is derived server-side; future evidence is rejected.
- Repository insertion locks the thread, validates the target, replays safely under the composite idempotency key, and emits one minimized audit event only on first insert.
- Relationship-history reads include current-thread evidence and safely chronological earlier evidence. List reads expose three recent records, detail reads twenty, and the total count remains visible; retroactively recorded evidence cannot appear in a thread that already began.
- Safe hydration includes Destination title/canonical URL or account name/publication external ID/status, source subject, and current-thread indicator. Destination description/tracking/identifiers and Publication provider/request/response/error data are excluded.
- A new authenticated thread route and “Previously shared” panel record reviewed evidence, render safe links/labels, and explicitly explain that related context alone is not proof of sharing.
- Live acceptance proved 401, missing target 422, future 422, UUID replay/single audit, safe prior hydration, and no private Destination data. Browser acceptance proved prior/current records, visible canonical link, inbox history, zero warnings/errors, and no horizontal overflow at 1280 px.
- Release gate: clean lint; 113 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 53-page optimized web build; companion webview/native checks; and three Rust tests. Exact QA threads, shares, relationship, Destination, audits, and sessions were removed and verified at zero.
- Unsigned installer `Market Me Companion_0.39.0_x64-setup.exe`: 2,945,690 bytes; SHA-256 `c132650036c2f14a8a99ea21c4002140bbae9e03067b9bd050b2169ace6bb495`.

Known limitations: evidence is manually recorded and does not prove external delivery or recipient receipt. There is no edit/delete UI, free-form external URL target, message-level binding, provider permalink, delivery receipt, CRM timeline, bulk import, automatic extraction, retention rule, or automatic response/routing behavior. History is bounded to recent records in the current UI.

Rollback: migration 0038 is additive and should remain applied. Release 0.38 ignores retained evidence. Stop share writes before rollback; referenced Destinations/Publications remain deletion-restricted until dependent thread evidence is removed under retention policy.

## 0.38.0 - Relationship stage and prior-interaction summary

Implemented:

- `StoredConversationThread` adds required current `relationshipStage`, non-negative `priorThreadCount`/`priorMessageCount`, and optional `lastPriorInteractionAt`.
- `ConversationRepository.threadRows` derives history with a same-workspace lateral aggregate. Only other relationship threads created strictly before the current thread qualify; only their messages created before the current thread qualify.
- Thread count uses `count(DISTINCT ...)` to avoid message fan-out. The latest timestamp uses database creation time, not provider-controlled chronology.
- The read model returns no prior body, internal note, metadata, relationship note, provider identity, organization, confidence, or inferred customer classification.
- Inbox list and thread detail display current relationship stage plus prior thread/message counts and the latest prior timestamp. No schema migration, write field, audit event, worker, or provider action is introduced.
- Live acceptance proved unauthenticated 401, `partner` stage hydration, exactly one earlier thread/message, exclusion of a later thread/message, and absence of prior body/private relationship note. Browser acceptance proved identical list/detail summaries, zero warnings/errors, and no horizontal overflow at 1280 px.
- Release gate: clean lint; 112 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 53-page optimized web build; companion webview/native checks; and three Rust tests. Exact QA threads, relationship, audits, and sessions were removed and verified at zero.
- Unsigned installer `Market Me Companion_0.38.0_x64-setup.exe`: 2,944,199 bytes; SHA-256 `9d48731b5e057861f50fdfaae95ee4d1317317607f33174753588f565e2b4a53`.

Known limitations: this is a count/timestamp summary, not a prior-conversation browser or CRM activity timeline. It does not include links/promotions shared, external CRM events, merged identities, customer status, automatic routing, retention policy, or AI response suggestions. Threads created at exactly the same database timestamp are not ordered relative to each other.

Rollback: no schema change is required. Release 0.37 ignores the derived fields; underlying relationships, threads, messages, and chronology remain intact.

## 0.37.0 - Conversation Brand context

Implemented:

- Migration `0037_conversation_brand_context.sql` adds one optional Brand Profile root reference to each conversation, with a composite same-workspace foreign key, delete restriction, and a workspace/Brand/activity index.
- `ConversationThread`/write/query contracts add `brandProfileId`. Omission preserves, null clears, UUID replaces, and repository plus database boundaries reject missing or cross-workspace Brands.
- `ConversationBrandOption` is the client-safe `{ id, name, status }` projection. `ConversationContextDirectory.brands` is scoped to one workspace and bounded to 200; Brand description and profile/version dictionaries are excluded.
- Stored thread reads hydrate current Brand name/status without copying mutable labels into thread storage. Campaign versions continue to pin immutable `brandProfileVersionId` independently.
- Exact Brand filtering and bounded Brand name/description search compose with every prior inbox predicate. New-thread/detail controls expose explicit optional Brand selection.
- Inbox now exposes seventeen text/select/date controls and renders Brand context in list/detail views without implying Campaign-version compatibility.
- `conversation.context_changed` adds the Brand UUID or null to minimized context evidence; it never records Brand name, description, profile/version content, message/contact content, or provider material.
- Live acceptance proved unauthenticated Brand filtering 401, missing Brand 422, exact and description-search results, clear/restore hydration, and UUID-only audit evidence. Browser acceptance proved safe selected labels, create/detail/list visibility, seventeen controls, zero warning/error diagnostics, no unsafe profile text, and no horizontal overflow at 1280 px.
- Release gate: clean lint; 112 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 53-page optimized web build; companion webview/native checks; and three Rust tests. Exact QA threads, relationships, Brands, audits, and sessions were removed and verified at zero.
- Unsigned installer `Market Me Companion_0.37.0_x64-setup.exe`: 2,944,467 bytes; SHA-256 `477371b033b96d35e5340ed387875fb38ce9a9e65dd26e2f808cac183989d34d`.

Known limitations: Brand context is manual, thread-level, and limited to one Brand root. It does not automatically derive from Campaign, publication, message, provider, or relationship data; it does not pin a Brand version; and it grants no generation, approval, contact, reply, or provider authority. Bulk association, suggestions, Campaign-instance context, inbound-provider correlation, and message-level lineage remain future work.

Rollback: migration 0037 is additive and should remain applied. Release 0.36 ignores the retained column. Stop Brand-context writes before rollback and clear/reassign conversation references before deleting a referenced Brand Profile root.

## 0.36.0 - Conversation account and publication context

Implemented:

- Migration `0036_conversation_publication_context.sql` adds optional Channel Connection and Publication Action references. Composite foreign keys enforce workspace ownership and require a publication to belong to the exact selected account.
- `ConversationThread`/write/query contracts add `channelConnectionId` and `publicationActionId`. Omission preserves, null clears, UUID replaces, and a publication without its matching account is rejected.
- `ConversationContextDirectory` returns at most 200 secret-free accounts and 200 newest publications. Options contain IDs, names, provider, status, non-secret provider external ID, and start time only; encrypted credentials, configuration, capabilities, provider URL, request snapshot, response metadata, and errors are excluded.
- Stored thread reads hydrate current account name/provider plus publication external ID/status without copying them into thread storage.
- Exact account/publication filters and bounded account/provider/external-publication search compose with every prior inbox predicate. New-thread/detail controls automatically keep a selected publication paired with its account.
- Inbox now exposes sixteen text/select/date controls and renders Campaign/Destination plus account/publication context on list/detail views.
- `conversation.context_changed` includes the account/publication UUIDs or null alongside prior context IDs; it never records credentials, URLs, request/response material, or message content.
- Live acceptance proved unauthenticated filter 401, missing/mismatched account 422, exact pair and external-ID search results, clear/restore hydration, and UUID-only audit evidence. Browser acceptance proved secret-free labels, selected values, sixteen controls, zero warning/error diagnostics, and no horizontal overflow at 1265 px.
- Release gate: clean lint; 112 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 53-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.36.0_x64-setup.exe`: 2,944,959 bytes; SHA-256 `ff3871a52db576adef8d5ce213a422df537f78a6b56e4d540e307efa2f859097`.

Known limitations: context is manual and thread-level. The current provider registry supports Discord webhook publication actions only. There is no inbound-provider correlation, automatic reply threading, message-level publication lineage, provider permalink display, Campaign-instance selector, bulk association, or automatic attribution. Association never authorizes a reply or connector action.

Rollback: migration 0036 is additive and should remain applied. Release 0.35 ignores retained columns. Stop account/publication writes before rollback; clear/reassign conversation references before deleting a referenced Channel Connection or Publication Action.

## 0.35.0 - Conversation Campaign and Destination context

Implemented:

- Migration `0035_conversation_context.sql` adds optional Campaign and Destination references to each conversation. Composite `(id, workspace_id)` foreign keys enforce tenant ownership in PostgreSQL; repository validation returns bounded field errors before persistence.
- `ConversationThread` and `ConversationThreadWrite` carry optional `campaignId` and `destinationId`. Omitted update fields preserve existing context, explicit null clears it, and new threads default to no association.
- `StoredConversationThread` hydrates optional `campaignName` and `destinationTitle` without copying mutable labels into thread storage. Campaign and Destination options passed to client components contain only IDs and display labels.
- `ConversationThreadQuery` adds exact Campaign and Destination predicates. Bounded text search now covers Campaign name/description and Destination title/description/topics while preserving workspace scope and the 200-row limit.
- New-thread/detail forms expose optional context selectors. The inbox adds exact selectors, displays hydrated context, and now has fourteen text/select/date controls.
- `associationChanged` emits `conversation.context_changed` for explicit clear/restore transitions. Audit dictionaries contain stable Campaign/Destination UUIDs or null, not destination URLs, topics, messages, contact data, or provider metadata.
- Live API acceptance proved filter authentication 401, invalid context 422, exact two-reference result, Destination-topic search, explicit clear, restored hydration, and create/clear/restore audit evidence. Browser acceptance proved selected list/detail values, corrected separators, fourteen controls, no warning/error diagnostics, and no horizontal overflow at 1265 px.
- Migration applied once and the focused live repository/schema suites passed. Clean lint; 112 TypeScript tests including twelve live PostgreSQL tests; every workspace type check; 53-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.35.0_x64-setup.exe`: 2,945,558 bytes; SHA-256 `edff050299c57697b3550f73cbe9d5c17c2603c7f168df4126ba1bb89ea7a6f4`.

Known limitations: context is manual and thread-level, with at most one Campaign and one Destination. Brand, account/channel, Campaign instance, publication/post, message-level lineage, automatic provider attribution, bulk association, and context suggestions remain future releases. An association provides navigation and triage context only; it grants no execution, contact, approval, or provider authority.

Rollback: migration 0035 is additive and should remain applied. Release 0.34 ignores retained context columns. Stop context writes before rollback; referenced Campaigns and Destinations remain deletion-restricted until conversations are reassociated or cleared.

## 0.34.0 - Human-reviewed conversation classification

Implemented:

- Migration `0034_conversation_classification.sql` adds constrained sentiment, intent, and urgency values plus optional reviewer/time evidence. Existing threads receive the non-claiming `unknown` default for all three dimensions.
- `CONVERSATION_SENTIMENTS` is `unknown | positive | neutral | negative | mixed`; `CONVERSATION_INTENTS` is `unknown | praise | question | support | availability | sales | complaint | collaboration | media_inquiry | other`; `CONVERSATION_URGENCIES` is `unknown | low | normal | high | critical`.
- `ConversationThread` and `ConversationThreadWrite` carry the classifications; optional write fields preserve backward compatibility, while the repository defaults new records and preserves omitted update fields.
- Any actual classification change records `classificationUpdatedBy` and database-timestamped `classificationUpdatedAt`. The paired-column database constraint rejects partial evidence.
- `ConversationThreadQuery` and the authenticated URL schema add exact sentiment, intent, and urgency filters. A composite workspace classification index supports bounded triage queries.
- New-thread and detail controls expose the closed values. Inbox adds three filters, visible sentiment/intent context, and urgency badges without claiming a model generated them.
- `conversation.classification_changed` records the closed values and reviewer actor through the audit envelope; message bodies, provider identity, handoff text, confidence guesses, and sensitive traits are excluded.
- Live API acceptance proved unauthenticated filter 401, invalid intent 422, exact three-field results, reviewer/time evidence, old/new filter transition, and creation/classification audit order. Browser acceptance proved all twelve inbox controls, reviewed list/detail values, and no horizontal overflow at 1265 px. QA threads, relationships, and sessions were removed and verified at zero.
- Migration rerun skipped cleanly. Clean lint; 112 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 53-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.34.0_x64-setup.exe`: 2,944,773 bytes; SHA-256 `cf5d61d8e5ed60cd010f132608e4b6986391d5d822c38e01264068ac7745ae60`.

Known limitations: classifications are manual and thread-level. There is no AI inference, confidence/provenance model, language/topic/risk taxonomy, message-level classification, suggested routing, routing automation, bulk classification, or review queue. Sensitive personal traits must never be inferred into these fields.

Rollback: migration 0034 is additive and should remain applied. Release 0.33 ignores the new columns and filters; stop classification writes before rollback. Retained classifications become invisible but do not alter thread state or provider behavior.

## 0.33.0 - Workspace-member conversation assignment

Implemented:

- `WorkspaceMember` is the privacy-minimized directory record: user ID, display name, workspace role, and computed `assignableToConversations`. Email addresses, organization memberships, sessions, and other profile data are not returned.
- `MarketMeRepository.listWorkspaceMembers` reads only the authenticated workspace. `GET /api/v1/workspaces/members` requires workspace access and returns the bounded directory plus count.
- Conversation assignment eligibility is owner, administrator, or editor. Viewer, analyst, and approver memberships remain readable according to their normal permissions but cannot be selected as the responsible conversation owner.
- Repository assignment validation enforces the same role rule inside the write transaction, preventing a crafted client from assigning an ineligible or foreign user.
- `StoredConversationThread.assignedOwnerDisplayName` is hydrated by a left join. Inbox rows render the owner, create/detail controls list all eligible teammates, and the owner filter accepts one exact member UUID in addition to me/unassigned.
- Status and owner transitions remain separate concepts. A same-status owner change emits `conversation.assignment_changed`; minimized audit data records the assignee UUID but no email, message, handoff, or provider-subject content.
- Live API acceptance proved unauthenticated directory 401, editor assignability, viewer non-assignability, crafted viewer assignment 422, editor assignment hydration, and exact owner filtering. Browser acceptance proved editor visibility, viewer exclusion, selected owner state, and no horizontal overflow at 1265 px. QA threads, relationships, members, and sessions were removed and verified at zero.
- Clean lint; 112 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 53-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.33.0_x64-setup.exe`: 2,944,395 bytes; SHA-256 `bb9c0b27bb82345fe1ffebe02bfcc9f810cf638f073f09ec350c4d76d1f5e468`.

Known limitations: workspace invitation, membership administration, teams/queues, workload balancing, availability/presence, assignment notifications, bulk assignment, automatic routing rules, and assignment history UI remain later work. A member must already exist in the workspace through an administrative/provisioning path.

Rollback: no database migration is required. Release 0.32 continues to read assigned owner UUIDs but its operator controls expose only self/unassigned and do not hydrate the assignee display name. Stop 0.33 teammate assignment writes before rollback if operators depend on managing those assignments through the UI.

## 0.32.0 - Per-user conversation read state

Implemented:

- Migration `0033_conversation_read_state.sql` adds one read cursor for each workspace-member/thread pair. Composite tenant and membership foreign keys prevent cross-workspace or non-member receipts; thread/member deletion cascades only the dependent cursor.
- Unread calculations compare `conversation_message.created_at` with the viewer's `last_read_at`. This intentionally treats a newly ingested late provider event as newly observed even when its provider `occurred_at` is old.
- Messages created by the current viewer are excluded with `created_by IS DISTINCT FROM viewerUserId`; a user's own internal notes do not make their inbox unread, while they remain unread for other members.
- `ConversationThreadQuery.unread` provides a typed repository predicate. URL/API `read=unread | read` maps to that boolean only after authentication supplies the viewer identity.
- `StoredConversationThread` exposes `unreadCount` and optional `lastReadAt`. `markRead` uses a database timestamp and monotonic UPSERT, so an older request cannot move a cursor backward and a message committed later remains unread.
- The inbox adds a ninth responsive filter plus viewer-specific unread badges. Thread detail exposes an explicit mark-read control; a GET never changes read state.
- The read API returns 200 with the server timestamp, 404 for a missing/foreign thread, 422 for invalid input, and 401 without authentication. Read receipts deliberately do not create audit events because they are high-volume personal UI state, not business-authority transitions.
- Live API acceptance proved unread/read filtering, 401/422/404/200 boundaries, and the post-read transition. Browser acceptance proved the badge, nine controls, explicit mark-read transition, and no horizontal overflow at 1265 px. All QA records, read cursors, and sessions were removed and verified at zero.
- Migration rerun skipped cleanly. Clean lint; 112 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 52-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.32.0_x64-setup.exe`: 2,946,485 bytes; SHA-256 `52c79e7b9c259c38773bbf95564d10f00a815137d13702bdd58e01a8179fc59d`.

Known limitations: there is no automatic mark-on-open, bulk mark-read/unread, unread notification delivery, unread totals in global navigation, cursor pagination, retention policy, or cross-device push. Read state is deliberately not an outbound-action or contact-permission signal.

Rollback: migration 0033 is additive and should remain applied. Release 0.31 ignores read cursors and the new query/control fields; stop 0.32 read writes before rollback. Retained cursor rows become invisible without altering messages or thread lifecycle.

## 0.31.0 - Inbox search and triage filters

Implemented:

- `ConversationThreadQuery` defines bounded optional search, provider, status, owner, handoff, deadline, activity-window, and limit fields. API schema caps free text at 200 characters and results at 200 threads.
- Repository filtering remains inside the authenticated workspace query. Text search covers thread subject, relationship display/organization names, and message bodies; it does not search credentials, audit dictionaries, or handoff content.
- Exact filters support provider, closed conversation status, current user or unassigned owner, open/no-open handoff, overdue/upcoming/no deadline, and inclusive UTC activity dates.
- Migration `0032_conversation_triage_indexes.sql` adds workspace/status, provider, owner, activity, and active-handoff deadline indexes without changing persisted records.
- The Conversations page adds eight responsive GET controls with persisted URL state, matching-result counts, a clear action, deadline summaries, and open-handoff indicators.
- Live API acceptance proved one exact result for search/provider/status/me/unassigned/open-handoff/overdue/no-deadline filters, invalid limit 422, and unauthenticated search 401. Browser acceptance proved all controls, combined-state persistence, exact result rendering, clear action, and no horizontal overflow. All QA records and sessions were removed and verified at zero.
- Migration rerun skipped cleanly. Clean lint; 111 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 52-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.31.0_x64-setup.exe`: 2,945,281 bytes; SHA-256 `8282de7bf28fdf5bd3888a0a7f646383a1b3b521360840b8c4600a2765a45d11`.

Known limitations: text search uses bounded case-insensitive matching rather than language-aware full-text ranking, stemming, typo correction, saved views, pagination cursors, or relevance scores. Campaign/topic/destination/sentiment filters require future conversation link/classification data. Retention policies and per-user unread state remain later work.

Rollback: migration 0032 contains indexes only and may remain applied. Release 0.30 ignores query parameters/UI controls but continues to read the same conversation records. No data conversion or write freeze is required.

## 0.30.0 - Human handoff briefs and service deadlines

Implemented:

- Migration `0031_conversation_handoff.sql` adds optional response/follow-up timestamps to conversation threads plus durable structured handoff briefs with closed `open | resolved | cancelled` status.
- A partial unique index allows only one open handoff per thread. Composite workspace/thread foreign keys prevent cross-tenant attachment, while closed rows retain who closed them and when.
- `ConversationHandoffBrief` captures who the contact is, why the conversation matters, what was asked/offered, what has already been said, relevant business context, a suggested human response, and an optional deadline.
- Thread create/update schemas accept offset-aware response and follow-up timestamps. Inbox rows expose due/reminder context and an open-handoff indicator; detail pages provide deadline controls, the active brief, resolve/cancel actions, and expandable closed history.
- Authenticated create and close APIs provide bounded 201/200 transitions. Handoff content never invokes a provider, and the UI explicitly states that a brief does not send a response.
- Handoff audit events contain only the generated handoff ID and a due-date boolean; none of the brief text is copied into audit dictionaries.
- Live acceptance proved relationship/thread/handoff 201, simultaneous-open duplicate 422, resolve 200, second handoff 201, unauthenticated create 401, two-item history, active-open hydration, and persisted response/follow-up times. Browser acceptance proved the complete brief, prior history, deadlines, no send control, and no horizontal overflow. All QA data, audits, and sessions were removed and verified at zero.
- Migration rerun skipped cleanly. Clean lint; 110 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 52-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.30.0_x64-setup.exe`: 2,950,609 bytes; SHA-256 `05fce0da2947cc8b5a6d376d4d17e0469a22dae2d06a6700ac2d67d076574527`.

Known limitations: deadlines are explicit timestamps, not workspace business-hour/SLA policies, and no scheduler sends reminders yet. Handoffs do not notify another user, mention teammates, request review, expose the complete member roster, or generate an AI summary/response. Search, unread state, provider ingestion, and outbound replies remain later work.

Rollback: migration 0031 is additive and should remain applied. Release 0.29 ignores handoff rows and deadline columns, so stop handoff/deadline writes before deploying it; retained data becomes invisible but is not deleted. Handoff briefs never authorize delivery under either version.

## 0.29.0 - Provider-neutral conversation inbox

Implemented:

- Migration `0030_conversation_inbox.sql` adds workspace-scoped `conversation_thread` and `conversation_message` tables. Composite tenant foreign keys bind every thread to one relationship and every message to one thread; closed status/message-kind constraints reject unknown states.
- Threads carry provider identity, optional provider thread ID, subject, owner, activity time, and one of nine lifecycle states. Exact provider/thread IDs are unique per workspace and duplicate API writes return field-level 422 responses.
- Provider message IDs are idempotency keys within a thread. Replayed inbound history is ignored without duplicating content, while chronological reads expose total count and the latest message for inbox summaries.
- `internal_note` is a closed message kind that requires an authenticated actor. The API exposes a dedicated note endpoint and no outbound-send endpoint; the UI states that notes cannot be sent by a connector.
- Authenticated inbox/create/detail/update/note APIs and responsive pages expose relationship contact safety, thread state/assignment, chronological message history, and a persistent do-not-contact warning while still permitting inbound records and internal notes.
- Audit events record thread creation/state transitions and internal-note message IDs, but never message bodies. Any future external adapter must reload the linked relationship permission immediately before provider I/O and fail closed for missing or suppressed records.
- Live API acceptance proved create 201, list/detail/update 200, internal note 201, empty note 422, duplicate provider thread 422, and unauthenticated list 401. Browser acceptance proved inbox/detail rendering, suppressed-contact warning, internal-note history, no outbound send control, and no horizontal overflow. QA threads, messages, relationships, audits, and sessions were removed and verified at zero.
- Migration rerun skipped cleanly. Clean lint; 109 TypeScript tests including twelve live PostgreSQL tests; all workspace type checks; 52-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.29.0_x64-setup.exe`: 2,944,413 bytes; SHA-256 `044a29fe5ba3d1466fba76c268269b99e0f71b555a4e021fb5396c93c55930ae`.

Known limitations: this release persists threads/history and operator-only notes but does not connect a provider inbox, receive webhooks, send replies, search/filter threads, expose unread counters, support attachments/reactions/participants, or provide the complete member roster. `outbound_observed` can preserve externally observed history, but no Market Me route can originate an outbound message.

Rollback: migration 0030 is additive and should remain applied. Release 0.28 ignores conversation tables, so stop thread/note writes before deploying it; retained history becomes invisible but is not deleted. Do not deploy a relationship-targeted reply adapter until a 0.29-or-newer control plane can enforce the thread and internal-note contracts.

## 0.28.0 - Relationship registry and contact safety

Implemented:

- Migration `0029_relationship_registry.sql` adds workspace-scoped relationship contacts and provider identities with closed stage, contact-permission, and identity-status values; composite tenant foreign keys and per-workspace provider-subject uniqueness prevent cross-record or cross-workspace identity attachment.
- Relationship stage is deliberately independent from `allowed | suppressed` contact permission. Suppression requires a non-empty reason and timestamp; restoration clears suppression state without rewriting the business relationship stage.
- `RelationshipRecord`, `RelationshipIdentity`, `RelationshipWrite`, and their readonly arrays document names, organization context, assignment, interests, shared topics, tone, internal notes, provider subjects, verification state, and optional confidence. Repository reads normalize nullable columns to the optional TypeScript shape.
- Transactional create/update writes validate workspace ownership for the assigned user, replace the bounded identity set, and record `relationship.created`, `relationship.updated`, `relationship.contact_suppressed`, or `relationship.contact_restored` audit evidence without copying notes or provider subject IDs.
- Authenticated list/create/read/update APIs and responsive Conversations, new, and edit pages replace the previously missing navigation target. The UI exposes exact provider identity evidence, owner, stage, independent contact safety, required suppression reason, and visible do-not-contact counts/status.
- Live API acceptance proved create 201, list 200, suppress 200, restore 200, duplicate provider identity 422, and unauthenticated list 401. Browser acceptance proved allowed and suppressed registry states, persisted suppression reason, provider identity fields, and no horizontal overflow with clean localhost diagnostics. All QA relationships, identities, audit rows, and sessions were removed and verified at zero.
- Migration rerun skipped cleanly. Clean lint; 105 TypeScript tests including eleven live PostgreSQL tests; all workspace type checks; 50-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.28.0_x64-setup.exe`: 2,943,556 bytes; SHA-256 `b670c3d150456541d53b23f7b938e7854334379289e49ea97a2cf20b817bcd58`.

Known limitations: this release is the registry and safety foundation, not a provider inbox. It does not yet ingest messages/comments, store conversation threads or interactions, search relationships, suggest/confirm cross-platform identity links, expose the complete member roster for assignment, or enforce suppression in an outreach adapter. No discovery or relationship-targeted outbound adapter exists yet; one must consult `contactPermission` transactionally before any future external action.

Rollback: migration 0029 is additive and should remain applied. Stop relationship writes before deploying 0.27; that version ignores the new tables, so retained records and suppression evidence become invisible but are not deleted. Do not deploy relationship-targeted outreach against a 0.27 control plane because it cannot consult this safety boundary.

## 0.27.0 - Campaign-scoped measurement keys

Implemented:

- Migration `0028_measurement_key_campaign_scope.sql` adds constrained `campaign_scope_mode` (`all | restricted`) and the `measurement_ingest_key_campaign_scope` junction. Existing keys default to all Campaigns; restricted keys with no remaining rows deny all.
- Key creation accepts a unique, workspace-owned `allowedCampaignIds` list of at most 100 IDs. Creation, scope rows, and non-secret audit evidence commit together; plaintext keys remain one-time values and are still stored only as hashes.
- `MeasurementKeyPrincipal` and key history expose `campaignScopeMode` plus sorted `allowedCampaignIds`. The integrations UI supports all or selected Campaigns, disables restricted creation with zero selections, and renders exact allowed names without retaining a secret.
- Restricted ingest resolves Campaign roots through direct Campaign, Campaign instance, Campaign step run, tracked link, and publication action references. Every supplied Campaign-bearing reference must resolve to exactly one allowed root; missing, conflicting, deleted, or cross-Campaign roots return 403 before normal reference validation or persistence.
- Live API acceptance proved denied Campaign 403, allowed Campaign 202, missing Campaign 403, replay 200, and disallowed event type 403, with exactly one stored event. Browser acceptance proved history and authoring states, zero/one-selection button behavior, and no horizontal overflow. All QA data and sessions were removed and verified at zero.
- Migration rerun skipped cleanly. Clean lint; 101 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.27.0_x64-setup.exe`: 2,944,559 bytes; SHA-256 `9963971e105126d1bc13f37185f59ae69ef2be350526b4137c76e7ebaaf3ee34`.

Known limitations: Campaign scope is a root authorization boundary, not source-, Destination-, property-, rate-, or quota-level policy. A restricted event must carry a resolvable Campaign-bearing reference, and all such references must agree. Deleting an allowed Campaign intentionally leaves the key restricted and may reduce it to deny-all. There is no automatic scope inheritance for newly created Campaigns.

Rollback: migration 0028 is additive and should remain applied. Release 0.26 ignores Campaign scope and would broaden restricted keys to workspace-wide authority; stop measurement ingestion or revoke every restricted key before deploying 0.26. Do not rely on the junction rows until Release 0.27 enforcement is restored.

## 0.26.0 - Immutable Campaign success-action policy

Implemented:

- Migration `0027_campaign_success_action.sql` adds database-constrained `campaign_version.success_action` with the closed values `notify_only | pause`; existing and omitted values default to `notify_only`.
- Campaign create/edit authoring explains and persists either notification-only behavior or a durable pause before future workflow progress. The selected policy is frozen with each published Campaign version.
- Threshold detection reads `success_action` from the exact version pinned to the Campaign instance and includes the action in the one stable `success_criteria_met` outbox payload.
- `CampaignSuccessSignal.action` is optional for Release 0.25 command compatibility; the workflow normalizes absence to `notify_only`, preserves the first signal, and invokes the existing persisted pause transition only for `pause`.
- A success pause sets workflow and PostgreSQL instance state to paused and remains operator-resumable. It neither cancels in-flight work nor marks the Campaign complete.
- Browser/live Temporal acceptance proved pause selection survives publish/activation, one accepted 1-of-1 visit delivers one completed command, the workflow context contains exact pause provenance, the instance and workflow both become paused, the manual step remains waiting, and the run UI exposes completed delivery without overflow or diagnostics.
- Migration rerun skipped cleanly. Clean lint; 101 TypeScript tests including ten live PostgreSQL tests and Temporal success-pause/resume coverage; all workspace type checks; 47-page optimized web build; companion webview/native checks; and three Rust tests. All QA Campaign/run/event/command records were removed after canceling the workflow.
- Unsigned installer `Market Me Companion_0.26.0_x64-setup.exe`: 2,948,026 bytes; SHA-256 `4855006b426438f1b2cca25cf41a71b02b7b6fc1baa20e816298fd0d142d44f8`.

Known limitations: `pause` stops future workflow progress but does not preempt an already executing activity, revoke provider-side work, or imply completion. There is no automatic completion/cancellation, notification fan-out, per-goal action, delay/window, hysteresis, or action approval. Operators must resume or cancel a paused Campaign explicitly.

Rollback: migration 0027 is additive and should remain applied. Stop Release 0.26 measurement ingestion and drain every queued pause-action success command with a 0.26 worker before deploying 0.25; the older workflow accepts the extra payload field but treats every threshold as notification-only. Do not edit pause-configured Campaign drafts in 0.25 because omitted action data would be rewritten to the compatibility default.

## 0.25.0 - Durable Campaign success-threshold notification

Implemented:

- Migration `0026_campaign_success_signal.sql` extends the closed Campaign workflow-command type set with `success_criteria_met`.
- Accepted measurement events for a Campaign instance now lock that exact instance row, insert idempotently, aggregate the pinned version's count and exact-currency criteria in the same transaction, and detect the first all-met transition without a race window.
- The first threshold crossing inserts one transactional outbox command with stable key `campaign:{instanceId}:success-criteria-met`; replayed events, concurrent crossings, and later measurements cannot create another command.
- `CampaignSuccessSignal` carries the evaluated immutable criteria, measurement time, and trigger event key. Temporal records the first signal at `context["measurement.success"]`; duplicate delivery is intentionally a no-op and does not complete, stop, or otherwise control the Campaign.
- The dispatcher signals the existing workflow, records normal command delivery state, and now rejects unsupported runtime command types instead of silently completing them.
- Campaign-run reporting exposes pending, processing, completed, failed, or dead-letter notification state with queue/delivery timestamps; historical all-met runs without a recorded transition are labeled explicitly.
- Browser acceptance proved two concurrent destination visits produce 2/2 progress and one pending durable notification, with no horizontal overflow, clean diagnostics, health 0.25.0, and complete Campaign/run/event/command cleanup.
- Migration rerun skipped cleanly. Clean lint; 101 TypeScript tests including ten live PostgreSQL tests and Temporal duplicate-signal coverage; all workspace type checks; 47-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.25.0_x64-setup.exe`: 2,946,255 bytes; SHA-256 `2d341e5390029cf1fe01b5b7f6f78eb8cacbd493f5d93ff331265cb4394a856c`.

Known limitations: the signal is a durable workflow notification, not an automatic completion, pause, cancellation, or publication action. Threshold windows, ratios, attribution, spend/return policy, provider metric polling, notification fan-out, and operator-configurable success actions remain future work. A workflow must already have been started before its success signal can be delivered; normal command retry/dead-letter handling remains authoritative.

Rollback: migration 0026 is additive and should remain applied. Stop Release 0.25 measurement ingestion and the workflow dispatcher before deploying 0.24. Drain or retain every `success_criteria_met` command for replay by 0.25; do not let a 0.24 dispatcher claim one because that older dispatcher does not understand the type and could mark it complete without signaling Temporal. Release 0.24 ignores the summary field and does not create new threshold commands.

## 0.24.0 - Scoped and expiring measurement keys

Implemented:

- Migration `0025_measurement_key_scope_expiry.sql` adds a non-empty closed `allowed_event_types` array, optional `expires_at`, database constraint, and partial active-expiry index; existing keys default to all 24 normalized event types with no expiry.
- Measurement-key creation accepts one to 24 unique normalized event types and an optional future expiration. The repository repeats scope validation, stores the non-secret contract, and includes it in the atomic creation audit.
- Authentication updates/returns a principal only while the stored key is active and unexpired. List results derive `active`, `expired`, or `revoked` without rewriting historical status.
- Measurement ingestion returns `403` for an authenticated key whose allowlist excludes the submitted event type and `401` for invalid, revoked, or expired secrets; blocked requests create no measurement event.
- Integrations authoring provides select-all/clear and 24 explicit event controls, optional local datetime expiry, exact scope/expiry display, and no revoke action for already-expired history.
- Browser acceptance proved a revenue-only key receives `403` for impression, `202` for revenue, then `401` after expiry; UI scope/active/expired states, no-overflow layout, clean diagnostics, health 0.24.0, and complete event/audit/key cleanup were verified.
- Migration rerun skipped cleanly. Clean lint; 101 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.24.0_x64-setup.exe`: 2,945,357 bytes; SHA-256 `4e8a3e109bc0de8601afbd8e1fe2fdc8b7470e470fdec48dc2e858e9d7d594bd`.

Known limitations: scope is currently an event-type allowlist only; there are no Campaign/source/Destination restrictions, maximum-TTL policy, scheduled rotation, quotas/rate limits, IP restrictions, anomaly alerts, or bulk revocation. Expiration is evaluated by the database clock and requires operational clock monitoring.

Rollback: migration 0025 is additive and should remain applied. Release 0.23 ignores key scopes and expiry, so rolling back an ingestion endpoint would broaden restricted keys and reactivate expired keys. Stop measurement ingestion or revoke every affected key before any 0.23 rollback; restore 0.24 before accepting events again.

## 0.23.0 - Currency-safe Campaign value goals

Implemented:

- `CampaignSuccessCriterion` is now a backward-compatible discriminated union: count goals use `metric: "count"` and `targetCount`, while value goals use `metric: "value"`, `targetValue`, and one uppercase ISO-style three-letter `currency`.
- Existing persisted count criteria that omit `metric` normalize to `count`, so no schema migration or historical Campaign rewrite is required.
- The Campaign form authors either positive integer event-count goals or positive exact-currency value goals and freezes them with the immutable published Campaign version.
- Measurement summaries aggregate untyped values separately and build `currencyTotals[eventType][currency]`; value evaluation reads only the criterion's exact event type and currency and never combines currencies.
- Campaign-run reporting displays each currency independently and narrows progress output to count or value fields, preserving exact-instance and exact-version evaluation.
- One authoritative `MEASUREMENT_EVENT_TYPES` tuple now drives both Campaign validation and measurement-ingest validation.
- Browser acceptance proved `EUR 1000` and `USD 105` remain separate, a USD 100 goal is met, a 2-visit count goal remains in progress at 1, desktop layout has no overflow, diagnostics are clean, health reports 0.23.0, and all QA records were removed.
- Clean lint; 98 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.23.0_x64-setup.exe`: 2,941,425 bytes; SHA-256 `8b140f05b1d57d3e07865856e334a25a9fdf8b12b227b9a9c783c5b9f73a3c00`.

Known limitations: values are summed only within an exact currency; there is intentionally no foreign-exchange conversion. Ratios, time windows, attribution models, spend/return calculations, provider metric polling, exports, and automatic workflow signals or stop conditions remain future work.

Rollback: no schema change is required. Stop 0.23 web processes before deploying 0.22. Stored value criteria remain intact but 0.22 cannot author or safely evaluate them, so do not edit affected Campaign drafts or use its run summaries until 0.23 is restored.

## 0.22.0 - Measurement ingest-key lifecycle

Implemented:

- `PublishingRepository.createMeasurementKey` still generates a high-entropy `mm_live_` secret, returns it once, and stores only its SHA-256 hash; creation now writes a non-secret audit event.
- `revokeMeasurementKey(workspaceId, id, actorUserId)` performs one workspace-scoped active-to-revoked transition, stamps `revoked_at`, writes an audit event in the same transaction, and returns false for repeat/wrong-workspace requests.
- Authentication already requires `status='active'`, so a successful revocation immediately rejects the retained secret without deleting the hash or historical prefix/timestamps.
- Authenticated `DELETE /api/v1/measurement/keys/{id}` requires workspace write access and validates both workspace and key UUIDs.
- The Integrations page shows active/revoked status, last-used/revoked times, replacement-before-revocation guidance, one revoke action only for active keys, and removes the one-time secret from client state before revoking.
- Browser acceptance proved one-time secret display, active status, revocation, secret removal, retained revoked history, no repeated action, refined no-overflow desktop layout, clean diagnostics, health version, and fixture cleanup.
- Clean lint; 97 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build with the new key route; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.22.0_x64-setup.exe`: 2,943,339 bytes; SHA-256 `91b0b3419b6f017b180cadcfdd78080e3bd8dea6e81bfce1896e3656404b861f`.

Known limitations: revocation is immediate but integrations must coordinate replacement deployment themselves. There is no expiry, scheduled rotation, per-key scopes, quotas/rate limits, IP restrictions, anomaly alerting, or bulk revoke. Production identity/MFA and incident procedures remain required.

Rollback: no schema change is required. Stop 0.22 web processes before deploying 0.21. Existing active/revoked keys and audits remain valid; 0.21 authentication still rejects revoked keys but its UI cannot create the revocation transition.

## 0.21.0 - Versioned Campaign success criteria

Implemented:

- Migration 0024 adds a non-null JSON array of immutable success criteria to every Campaign version; old versions default to no criteria and the migration is idempotent.
- The provider-neutral `MEASUREMENT_EVENT_TYPES` tuple defines 24 accepted normalized event names shared by Campaign authoring and measurement ingestion.
- Each `CampaignSuccessCriterion` contains a stable unique `id`, one normalized `eventType`, and integer `targetCount`; server validation allows at most 20 criteria and targets from 1 through 1,000,000,000.
- Campaign create/edit UI adds bounded criterion controls. Publishing a version freezes the array with the rest of the Campaign definition; a successor draft may change future goals without changing an active run.
- `evaluateCampaignSuccess` deterministically maps absent events to zero, reports per-criterion `currentCount`/`met`, and reports `allCriteriaMet` only when at least one criterion exists and all are met.
- Campaign-run measurement summaries join the exact activated Campaign version and display normalized outcome totals plus goal progress. Measurement ingestion retains existing workspace/reference and idempotency checks.
- Browser acceptance proved create, persistence, publish, activation, exact run progress (`0 of 2`), no desktop overflow, clean diagnostics, fixture cleanup, and the corrected `0.21.0` health response.
- Clean lint; 97 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.21.0_x64-setup.exe`: 2,943,392 bytes; SHA-256 `f56c60108c7697f91e45a070a75810aee21e0945b96c1d80dcb2761dc36ca487`.

Known limitations: criteria are event-count thresholds only. Currency-safe value/revenue goals, ratios, time windows, provider metric polling, automatic threshold workflow signals, stop conditions, experiments, attribution models, and exports remain future work.

Rollback: stop 0.21 web processes and deploy 0.20. Retain migration 0024 and all criterion arrays; 0.20 ignores the additive column. Do not edit/publish criteria through 0.20 because its Campaign form does not preserve the field on draft updates.

## 0.20.0 - Live Discord publication preflight

Implemented:

- Publication execution reads the stable idempotency key before media, credentials, or provider access. A prior success returns its stored output; prior dispatching/ambiguous state requires manual resolution without another network attempt.
- Exact attachment byte-count and SHA-256 validation still runs before credential decryption or provider access.
- After decryption, the worker performs Discord's webhook GET preflight through the same connector that will publish and verifies any saved `webhookId`, `guildId`, and `channelId` against the live target.
- An unavailable webhook, provider error, or target-identity mismatch marks the connection unhealthy, returns manual-required, and creates neither a new publication action nor a Discord POST.
- A successful preflight refreshes connection health, last-tested time, and provider identity without changing the capability snapshot timestamp. The immutable publication request snapshot records the observed `providerPreflight.targetIdentity`, never the credential.
- Failed publication actions remain retryable through their stable ledger row after a fresh successful preflight; concurrent starts retain the existing ambiguity-safe insert/race behavior.
- Clean lint; 94 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.20.0_x64-setup.exe`: 2,945,878 bytes; SHA-256 `dfe498bdb2467f0d0feb5ca81158f0f7cc47bbda2684e77e5e1bae42f60efaf4`.

Known limitations: Discord incoming webhooks are the only live outbound provider and each first attempt now adds one provider GET before POST. Provider metrics, native scheduling, additional channel manifests, production identity/RLS, signed updates, and macOS/Linux validation remain future work.

Rollback: no schema change is required. Stop 0.20 workflow workers before deploying 0.19 workers. Existing data remains compatible, but 0.19 workers do not perform the live target preflight and must not be used where that release boundary is required.

## 0.19.0 - Exact approved image attachments

Implemented:

- Migration 0023 adds an ordered immutable media manifest to each exact Draft channel preview, snapshotting asset/source IDs, object key, content hash, safe filename, MIME, bytes, accessibility meaning, scan disposition, and rights disposition.
- Draft preview creation accepts at most ten unique same-package processed JPEG/PNG/WebP/GIF assets and validates the current connection's attachment-count, byte, description, feature, safety, rights, and accessibility limits before saving.
- Derivatives inherit approved alternative text or decorative meaning from their source original; informative Discord files receive the approved description and decorative files intentionally omit it.
- The Draft UI exposes selectable and blocked assets, warnings for `not_configured` scan/`unchecked` rights states, ordered snapshot detail, and responsive controls; the Campaign picker shows the exact attachment count.
- The workflow worker reads only snapshotted object keys from the shared `MEDIA_STORAGE_ROOT`, verifies byte count and `sha256:` content hash before credential decryption/action creation/provider I/O, and fails closed on missing or changed media.
- Discord delivery uses official `multipart/form-data` with `payload_json`, `files[n]`, stable attachment IDs, mention suppression, and the existing ambiguity-safe publication ledger. The request snapshot records metadata only, never raw bytes.
- Browser acceptance proved processed-versus-original selection, immutable media preview creation, tracked Campaign binding, desktop and 390×844 layouts, and attachment count/readiness presentation.
- Clean lint; 92 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.19.0_x64-setup.exe`: 2,942,977 bytes; SHA-256 `a3dcc6d31ab310d42046e4b2e8456a8f8c7d92874e1d5f79dba3f061960394a9`.

Known limitations: Discord webhook is the only media-capable outbound manifest. Development permits explicit `not_configured` malware-scan and `unchecked` rights states while making both visible; production must configure malware scanning and enforce documented rights evidence. Additional provider media layouts, video/audio, S3, production identity/RLS, signed updates, and macOS/Linux validation remain future work.

Rollback: stop 0.19 workflow workers before 0.18, retain migration 0023 and preview-asset rows, and do not execute previews containing attachments until 0.19 is restored. Text-only previews remain compatible.

## 0.18.0 - Approved first-party tracked previews

Implemented:

- Migration 0022 adds canonical/tracked preview modes, exact-mode uniqueness, and one cascade-owned tracked link per preview.
- Tracked preview creation validates approved/current Draft, active capability, published Destination, and HTTP(S) `APP_BASE_URL`; it reserves/reuses a random slug and renders the exact first-party URL before review.
- Fixed attribution fields bind source, medium, source Campaign, and exact Draft version; redirect reads preserve raw snake-case JSON keys.
- Draft UI selects canonical or tracked Destination mode and identifies stored tracked output; Campaign picker labels and validates tracked readiness.
- Activation/runtime require an active same-workspace/same-Destination preview link; worker ledgers the preapproved link ID and never substitutes content.
- Browser acceptance proved one reserved link, exact Draft/Campaign display, one activation/start command, UTM 302 redirect, disabled-link preflight/rejection, responsive no-overflow layout, and clean diagnostics.
- Clean lint; 88 TypeScript tests including ten live PostgreSQL tests; all type checks; 47-page optimized web build; companion/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.18.0_x64-setup.exe`: 2,945,732 bytes; SHA-256 `876344b7e0c8629c3366373db4ecb4debc8e9b818895c13a82b4cfb723c2c006`.

Known limitations: Discord webhook is the only live outbound manifest; custom per-Campaign UTM editing, vanity slugs, provider media layouts, localization, native scheduling, production identity/RLS, signed updates, and macOS/Linux validation remain future work.

Rollback: stop 0.18 processes before 0.17, retain migration 0022 and all links/previews, and do not render or execute tracked-mode previews until 0.18 is restored.

## 0.17.0 - Guided exact-preview Campaign authoring

Implemented:

- Campaign-scoped `StoredCampaignPreviewOption` read model with source Campaign version, Draft headline/audience, exact current approval, Channel Connection/provider/capability state, Destination, exact rendered content, counts, issues, and timestamps.
- `DraftRepository.listCampaignPreviewOptions` returns only previews whose generation belongs to the authorized Campaign root; it introduces no schema change or provider call.
- Guided `CampaignPreviewPicker` labels each preview by reviewed variant, Channel Connection, Destination, and current readiness instead of requiring a pasted UUID.
- Immediate `PreviewEligibility` reasons for superseded/unapproved exact Draft, blocked render, stale/inactive capability, and Campaign Destination mismatch.
- Conflict-safe step-input mutation preserves unrelated advanced keys while removing `appendDestination`, `useTrackedLink`, `channelConnectionId`, and `channel_connection_id` before setting `draftChannelPreviewId`.
- Exact rendered content, source Campaign version, provider, Destination, and character count/limit remain visible during authoring; eligibility changes use a polite accessibility live region.
- Responsive workflow subsections now collapse to one column at 520px, including the new picker and existing Campaign fields.
- Browser acceptance persisted a guided selection through reload, preserved an unrelated custom key, proved conflict removal, explained Destination mismatch and forced staleness, showed no 430px overflow, and produced no warning/error diagnostics.
- Clean lint; 88 TypeScript tests including three picker tests and ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview build; native check; and three Rust tests.
- Unsigned Windows development installer `Market Me Companion_0.17.0_x64-setup.exe`: 2,945,175 bytes; SHA-256 `e8e8e2895e6d260d5c21bcfe26200d26f1685a1cc67dd7c99a791eac16fce080`.

Known limitations:

- Preview candidates update on page refresh; no live subscription is present. Activation and runtime still catch drift after the page was loaded.
- Tracked links cannot replace the approved canonical URL. A future flow must create and approve the exact final tracking URL before activation.
- Discord incoming webhook remains the only live outbound provider manifest; acceptance used an inert connection and no live credential.
- Media layouts, threads/carousels, localization, native provider scheduling, private/test drafts, and provider-specific final preflight remain future releases.
- Production identity/RLS, malware isolation, S3 tenant storage, signed desktop updates, and macOS/Linux validation remain future work.

Rollback:

- Roll back the application to 0.16 without a database change. Existing `draftChannelPreviewId` step inputs remain compatible, but the guided picker and client preflight disappear; retain all Campaign, Draft, preview, and audit records.

## 0.16.0 - Exact-preview Campaign execution

Implemented:

- Optional `draftChannelPreviewId` contract for `publish_content` Campaign steps, with clear authoring guidance in the workflow editor.
- Activation gate proving same workspace/Campaign root, current approved Draft version, ready/fresh preview, active matching Channel Connection, and exact Campaign Destination.
- Explicit rejection of `appendDestination` and `useTrackedLink` when exact approved preview content is selected.
- Execution target inference of the preview's Channel Connection plus exact rendered content, Draft version ID, and derived eligibility.
- Workflow worker fail-closed runtime revalidation before credential/provider work, byte-for-byte preview delivery, and preview/version IDs in the publication request snapshot.
- Existing stable publication idempotency, Discord mention suppression, rate handling, external ID capture, and ambiguous-resend suppression remain intact.
- Browser acceptance activated one fresh preview-backed successor Campaign, proved one instance/one start command/no publication without a worker, then rejected stale reactivation with the named validation error; desktop/mobile layouts and logs were clean.
- Clean lint; 85 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview build; native check; and three Rust tests.
- Unsigned Windows development installer `Market Me Companion_0.16.0_x64-setup.exe`: 2,944,509 bytes; SHA-256 `96e89c0d11203db211ebd06ed9031aaf975612e84d761a58c3524740192f666e`.

Known limitations:

- Campaign authors currently paste a preview UUID into step JSON; a guided preview picker and eligibility explanation panel remain future UI work.
- Tracked links cannot replace the approved canonical URL. A future tracked-link workflow must create and approve the exact rendered tracking URL before activation.
- Discord incoming webhook remains the only live outbound provider manifest; no live credential was used for acceptance.
- Media, threads/carousels, native scheduling, private/test drafts, localization, and provider-specific final preflight remain future releases.
- Production identity/RLS, malware isolation, S3 tenant storage, signed desktop updates, and macOS/Linux validation remain future work.

Rollback:

- Stop 0.16 workflow workers before deploying 0.15. Retain all Campaign versions, instances, outbox commands, previews, and audit rows. Do not activate or dispatch preview-backed steps until 0.16 is restored; 0.15 cannot resolve their exact content.

## 0.15.0 - Capability-bound channel previews

Implemented:

- Pure `renderChannelPreview` connector boundary that composes exact approved body, call to action, hashtags, and optional canonical Destination without truncation or provider I/O.
- `ready`/`blocked` validation against a captured live Channel Capability Manifest, including publish support, empty-output, exact character count, and provider limit issues.
- Additive migration `0021_draft_channel_previews.sql` with exact approved Draft version, active Channel Connection, optional published Destination, provider capability snapshot/version/time, rendered content, counts, issues, actor, and indexes.
- Authenticated GET/POST `/api/v1/drafts/:id/previews` and responsive Draft-detail UI for selection, rendering, readiness, counts, issues, and stale warnings.
- Derived staleness when a connection capability observation changes or the connection becomes inactive; deterministic rerender replaces the exact combination while retaining audit events.
- Transactional same-workspace/lifecycle enforcement and `draft.channel_preview.created` audit records. Preview code never reads encrypted credentials or creates provider/publication side effects.
- Browser acceptance rendered one 121/2000-character Discord preview with the published canonical Destination, detected forced capability drift, refreshed it to ready, verified desktop/mobile layouts and empty diagnostics, and removed exact fixtures.
- Clean lint; 83 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview build; native check; and three Rust tests.
- Unsigned Windows development installer `Market Me Companion_0.15.0_x64-setup.exe`: 2,945,884 bytes; SHA-256 `7a83a6b5ea4990d50455b7a9e35fd28489b93adb0726249fa0596a96b767ea0a`.

Known limitations:

- A preview is side-effect free and is not yet selectable by a Campaign publish step. Release execution still uses the existing Campaign step input contract.
- Discord incoming webhook is the only live outbound Channel Capability Manifest. More provider adapters and account-specific dynamic limits remain future work.
- Destination inclusion is explicit and canonical only; AI link appropriateness, tracked-link previewing, placement choices, regional selection, and duplicate-link fatigue rules remain future work.
- Media attachments, platform card/thread/carousel rendering, localization, private/test provider drafts, and final preflight execution revalidation remain future releases.
- Production identity/RLS, malware isolation, S3 tenant storage, signed desktop updates, and macOS/Linux validation remain future work.

Rollback:

- Stop 0.15 web processes before deploying 0.14. Retain additive migration 0021 and all preview/audit rows for forward recovery. Version 0.14 ignores previews but cannot create, refresh, or display capability freshness.

## 0.14.0 - Bounded Draft formats and immutable revisions

Implemented:

- Seven closed Draft formats with server-owned character ceilings from 280 characters through 5,000 characters, plus an intentionally unbounded channel-neutral option.
- Deterministic generation that selects whole claims under both information-depth and format budgets and uses the longest Audience name for one shared budget, preserving identical facts across variants.
- Additive migration `0020_draft_formats_and_revisions.sql` for captured generation format, immutable predecessor/change-note lineage, one general variant per generation, and source-version lookup.
- Presentation-only revision API/UI for a safe lead-in, call to action, unique validated hashtags, alternative text, and required change note. Arbitrary body, fact, evidence, and generator mutation are not accepted.
- Transactional immutable successors: the predecessor becomes `superseded`; the new working version points to it and clones the exact factual claims and evidence bindings before resubmission.
- Structured 422 validation for unsafe lead-ins, invalid hashtags, illegal lifecycle state, missing facts, and format overflow.
- Live browser acceptance covering short-format generation, request changes with reviewer notes, successor version creation, exact evidence trace retention, resubmission/approval, responsive desktop/mobile rendering, empty warning/error logs, and exact fixture cleanup.
- Clean lint; 81 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview build; native check; and three Rust tests.
- Unsigned Windows development installer `Market Me Companion_0.14.0_x64-setup.exe`: 2,945,820 bytes; SHA-256 `f478ec3364a047dc4298a0f7cd092c6664ea13fbeb9f351871081ac0a7fde004`.

Known limitations:

- Formats currently constrain deterministic text but are not destination adapters or provider previews. Provider-specific validation, scheduling, media attachment placement, and live private/test delivery remain future work.
- Lead-in editing is deliberately punctuation-constrained and cannot change factual content. A factual correction requires a new approved evidence package/generation rather than an in-place Draft edit.
- Reviewer inline markup, collaborative editing, localization, experiments, multi-stage approval policy, and field-level diffs remain future releases.
- The evidence snapshot protects reproducibility, but production retention/deletion policy must define source erasure and legal/audit holds.
- Production identity/RLS, malware isolation, S3 tenant storage, signed desktop updates, and macOS/Linux validation remain future work.

Rollback:

- Stop 0.14 web processes before deploying 0.13. Retain additive migration 0020 and all lineage rows for forward recovery. Do not revise or decide successor versions while 0.13 is active because it cannot display or enforce format/lineage policy.

## 0.13.0 - Governed evidence-backed Drafts

Implemented:

- New `@market-me/generation` boundary and `generateGroundedDraft` provider contract. The initial `market-me/grounded-template` model is deterministic, local, channel-neutral, and requires no external model credential.
- Exact `draft_generation` records pin a published/superseded Campaign version, approved Content Package ID and numeric version, Brand Profile version, communication controls, complete resolved evidence snapshot, generator/model/version, and prompt version.
- One `content_draft` audience variant per pinned Audience Profile, or one general variant when none is pinned. Every variant uses the same ordered factual evidence set; audience and brand data affect only recorded presentation choices.
- Immutable `content_draft_version` output with headline, body, call to action, hashtags, alt text, rationale, and presentation choices. `content_draft_claim` plus its evidence junction distinguish factual claims from presentation-only calls to action.
- Exact-version Draft submission and `content_draft_approval` decisions for approve, reject, or request changes. Request snapshots and `draft.generated`, `draft.submitted`, and decision audit events retain reconstruction evidence.
- Authenticated Draft list/detail/generate/submit API and responsive `/drafts` pages. The unified `/approvals` screen now reviews generated content beside Campaign workflow approvals.
- Additive migrations `0017_governed_drafts.sql` through `0019_draft_evidence_binding_cascade.sql`. Evidence rows cascade only their live junction bindings during deletion; the immutable JSON evidence snapshot remains with the generation record.
- Repeatable `npm run qa:governed-drafts -- seed|clean` fixture command for live browser acceptance without retaining test content.
- Browser QA against live PostgreSQL generated two Audience Profile variants with the same evidence-backed facts, traced both claims, submitted one exact version, approved it from the queue, verified approved/working states, inspected desktop/mobile layouts, observed no console warnings/errors, and removed all fixtures.
- Clean lint; 80 TypeScript tests including ten live PostgreSQL tests; all workspace type checks; 47-page optimized web build; companion webview build; native check; and three Rust tests.
- Unsigned Windows development installer `Market Me Companion_0.13.0_x64-setup.exe`: 2,945,113 bytes; SHA-256 `8915768f2f8d0d0e1efdf023f1b690e494c5780e109c72453d7e9eb8c7e74aa7`.

Known limitations:

- The first generator copies approved evidence claims into a deterministic channel-neutral template. It does not call an external model, local model, or destination/channel adapter.
- Calls to action are explicitly presentation-only and carry no evidence binding. A future claim classifier/model gateway must continue to fail closed when generated factual language lacks evidence.
- Draft text editing, immutable successor versions after requested changes, reviewer inline edits, media attachment selection, scheduled destination previews, localization, experiments, and multi-stage approval routing remain future releases.
- The evidence snapshot protects reproducibility, but production retention/deletion policy must define when a source evidence row may be removed and how legal/audit holds apply.
- Production identity/RLS, malware isolation, S3 tenant storage, signed desktop updates, and macOS/Linux validation remain future work.

Rollback:

- Stop 0.13 web/workers before deploying 0.12. Retain additive migrations 0017-0019 and all Draft/generation/approval rows for forward recovery. Version 0.12 cannot display or decide Draft approvals; do not delete referenced Campaign, Content Package, Profile, or evidence data while rolled back.

## 0.12.0 - Immutable Brand and Audience Profiles

Implemented:

- Workspace-scoped Brand and Audience Profile roots with immutable draft/published/superseded versions, audit events, unique names, and structured identity, voice, terminology, claim, disclosure, audience, need, channel, format, relationship, and exclusion fields.
- Closed Audience type vocabulary plus explicit information-depth and promotional-strength defaults/ceilings. Defaults may be custom; hard ceilings remain ordinal.
- Exact optional Brand Profile version pin and ordered zero-to-20 Audience Profile version pins on every Campaign version, using PostgreSQL foreign keys and duplicate/order constraints.
- Deterministic `workspace < brand < audience < destination < campaign < action` resolver. Multiple same-level audiences and all active ceilings reduce to the safest value; Campaign writes above a selected ceiling return a named structured 422 error.
- Full Brand/Audience create, edit, publish, list, and Campaign-selection UI/API flows. Existing historical Campaign pins remain retained and visible when a profile successor becomes current.
- Browser QA against live PostgreSQL covering Brand/Audience publication, exact selector state, a rejected above-ceiling Campaign, a compliant saved/published Campaign, clean console state, visual empty-state review, and exact fixture cleanup.
- Clean lint; 77 TypeScript tests including nine live PostgreSQL tests; all workspace type checks; 45-page optimized web build; companion webview build; native check; and three Rust tests.
- Unsigned Windows development installer `Market Me Companion_0.12.0_x64-setup.exe`: 2,949,477 bytes; SHA-256 `0fe1114e6c077bb30764aac63c7cffcb0c6fd461007cba9b0ef967a5a4fa96df`.

Known limitations:

- Campaign authoring requires explicit controls; profile defaults are stored but automatic inheritance display/generation is not yet wired. Destination and action-level control authoring are also future slices.
- 0.12 stores guidance and enforces ceilings but does not generate localized/channel variants, run models, or automatically detect sensitive-trait inference.
- Historical Campaign pins display generically after a profile successor replaces the list's current version; a dedicated version-history/diff browser remains future work.
- Profile publication uses workspace write authority. Dedicated approver/two-person governance and per-field diff review remain production hardening.
- Production identity/RLS, malware isolation, S3 tenant storage, signed desktop updates, and macOS/Linux validation remain future work.

Rollback:

- Stop 0.12 web/workers before deploying 0.11. Retain additive migration `0016_brand_audience_profiles.sql` and all profile/Campaign binding rows for forward recovery. Do not author or republish profile-bound Campaigns under 0.11 because that code cannot retain new pins or enforce their ceilings.

## 0.11.0 - Bounded PDF and Office extraction

Implemented:

- PDF.js-based text extraction behind the immutable `MediaProcessor` boundary with `document-v1` provenance, 250-page/250,000-character ceilings, parser identity/count metadata, and no inline document rendering.
- Explicit PDF `completed`, `truncated`, `requires_ocr`, `encrypted`, `malformed`, `resource_limit`, and `timeout` result handling; incomplete/failed output remains visible and keeps the Content Package in review.
- Modern OOXML extraction for `.docx`, `.pptx`, and `.xlsx`, including Word paragraphs/supporting text parts, ordered PowerPoint slide text, and Excel shared-string/inline/numeric/boolean cell values.
- Strict OOXML package/MIME validation plus encrypted-entry, traversal-name, 1,000-entry, 64-MiB expanded, 8-MiB selected-part, and 100:1 per-entry compression-ratio rejection. Legacy binary and macro-enabled Office files remain explicitly unsupported.
- Plain-text extraction now honors the same 250,000-character default and records truncation instead of retaining unbounded decoded text.
- Content Package UI diagnostics for extraction status, parser/count state, partial text, and parser errors; truncated, OCR-required, and failed outcomes are review blockers.
- Local companion MIME mapping for `.docx`, `.pptx`, and `.xlsx`, matching default Smart Source allowlists, plus native coverage for case-insensitive extension mapping.
- Real generated PDF/OOXML fixtures covering success, page/text truncation, image-only PDF, malformed input/type mismatch, and ZIP-bomb rejection; manual rendered-PDF inspection and encrypted-PDF QA also passed.
- Verified clean lint; 73 TypeScript tests including eight live PostgreSQL tests; all workspace type checks; 40-page optimized web build; companion webview build; repeatable live local-ingestion QA; native check; and three Rust tests.
- Unsigned Windows development installer `Market Me Companion_0.11.0_x64-setup.exe`: 2,944,637 bytes; SHA-256 `3459d78fea2bc30f14d664f52ada4c05760b3a4f41657a9f07ff21183d332e44`.

Known limitations:

- Text extraction is not layout reconstruction. Complex reading order, charts, drawings, equations, speaker notes, formulas, styles, and embedded objects may require human review or future specialized adapters.
- OCR is not implemented; image-only PDFs are marked `requires_ocr`. Password-protected PDFs are rejected rather than prompting for or retaining a password.
- Legacy `.doc`/`.ppt`/`.xls`, macro-enabled OOXML, generic ZIP, and arbitrary embedded-document traversal remain unsupported by design.
- Parser limits are enforced in-process between stages. Production still requires a real malware/quarantine service and an OS/container hard CPU, memory, and wall-clock kill boundary around patched parsers.
- Rights enforcement, S3-compatible tenant storage, signed desktop updates, and macOS/Linux validation remain future work.

Rollback:

- Stop 0.11 ingestion workers before running 0.10 code. No schema rollback is required. Preserve `document-v1` asset metadata and immutable originals; 0.10 can read the rows but will not regenerate PDF/OOXML extracted text.

## 0.10.0 - Attended foreground local monitoring

Implemented:

- Persisted Off/1/5/15/60-minute local sync policy with a one-minute minimum and one-hour maximum.
- Foreground timer that runs only while paired, unpaused, open, and configured, reusing complete manifest reconciliation for reconnect safety.
- Native process-wide atomic overlap prevention across manual and timer-triggered sync calls.
- Persisted/displayed last-successful-sync timestamp and bounded heartbeat details for interval/status without absolute folder path disclosure.
- Rust stable path-identity test plus the existing cross-language signature test; coherent 0.10.0 workspace/native versions.
- Verified clean lint, 61 TypeScript tests including eight live PostgreSQL tests, all type checks, 40-page builds, repeatable live local-ingestion QA, two Rust tests, native checks, and Windows NSIS bundling.
- Windows installer `Market Me Companion_0.10.0_x64-setup.exe`: 2,943,893 bytes; SHA-256 `78295e46d4fe0415a1c412f7983ff8429c250c40df50f65889e21193b9c6328b`.

Known limitations:

- Monitoring stops when the attended companion closes. There is no background service, startup registration, offline queue, filesystem notification journal, or tray lifecycle.
- Each interval performs a bounded full manifest scan; large-tree incremental watcher optimization remains future work.
- All production storage/scanning, native signing/updaters, cross-platform validation, and Release 0.9 file/root limitations remain.

Rollback:

- Stop the 0.10 companion before installing 0.9. No schema rollback is required; local Smart Sources, source-item object keys, and immutable bytes remain compatible.

## 0.9.0 - Local-folder Smart Source ingestion

Implemented:

- Local Smart Source authoring selects one paired companion instead of accepting a device path; the absolute approved folder remains only in native local configuration.
- Rust folder scanning with canonical-root confinement, no symlink following, recursive/non-recursive behavior, 5,000-file manifest cap, 10-MiB file cap, stable relative-path identity, content SHA-256, and bounded MIME mapping.
- Authenticated manifest-first synchronization that revalidates assignment, worker health/capability, identities, parent relationships, recursion, MIME filters, ignore rules, duplicates, and deleted items.
- Server-directed upload of only missing/changed content with exact item/hash binding, content-length/hash verification, immutable `originals/<sha256>/source` storage, and race-safe source-item attachment.
- Existing ingestion worker support for local object bytes, hash recheck, stabilization, MediaProcessor, evidence, accessibility, and review; cloud credentials are not consulted for local sources.
- Companion **Sync approved folder** action, local worker selector, readiness/index diagnostics, and awaiting-content/content-received item state in the web control plane.
- Additive migration `0015_local_source_ingestion.sql`, `source_item.object_key`, `localFolderIngestion` capability, and repeatable `npm run qa:local-ingestion` live HTTP/worker verification.
- Verified clean lint; 61 TypeScript tests including eight live PostgreSQL tests; all workspace type checks; migration execution/idempotency; 40-page optimized web build; live manifest/requested-upload/Content-Package flow; native Rust check/signature test; and Windows x64 NSIS bundle.
- Windows preview installer: `apps/companion/src-tauri/target/release/bundle/nsis/Market Me Companion_0.9.0_x64-setup.exe`, 2,939,304 bytes, SHA-256 `01772083702260bd5c99e14c3d5176bb62c9a9dc704408392ab96bfa6acf4ff1`. It remains an unsigned development artifact.

Known limitations:

- Local sync is user-triggered; filesystem watching, debounce/event journals, offline queues, background service mode, automatic scheduled polling, and rename-specific events are not yet implemented.
- Files over 10 MiB, empty files, symlinks, and more than 5,000 manifest items are skipped/rejected. The current extension MIME map is deliberately small; server binary detection remains authoritative during processing.
- The development filesystem object store and unconfigured malware scanner are not production-safe. Production requires tenant-scoped encrypted/versioned storage, quarantine, rate limits/quotas, retention/deletion, and isolated parser resources.
- Local-folder UI assigns one companion/root per Smart Source. Multiple roots, selective subfolders, per-source device folder mapping, conflict UX, and failover remain future work.
- Playwright, local models, broader publishing providers, rights enforcement, expanded media/document processing, production identity, signing/notarization/updaters, and macOS/Linux release validation remain future releases.

Migration and rollback:

- `0015_local_source_ingestion.sql` is additive and checksum guarded. Stop 0.9 companions and ingestion workers and disable local Smart Sources before running 0.8 code.
- Preserve `source_item.object_key`, ingestion events, Content Packages, and immutable bytes for audit and forward recovery. Do not delete the shared content-addressed namespace during application rollback.
- Process or deliberately ignore pending local events before rollback; 0.8 cannot request absent local bytes and will otherwise retain retrying events it cannot satisfy.

## 0.8.0 - Campaign-to-companion routing

Implemented:

- Per-action Campaign routing for `desiredCapability=open_url` with `user_assisted`, preserving official-API-first routing and explicit manual fallback for unsupported work.
- Activation-time eligibility enforcement: one active companion, heartbeat within 90 seconds, `healthy` or `working`, and `assistedOpenUrl=true`; ambiguous multi-device selection requires `inputs.companionWorkerId`.
- Credential-free HTTPS validation and exact-hostname authority narrowing before dispatch, plus bounded instructions and stable `campaign:<instance>:step:<step>:open_url` idempotency.
- Campaign/step-bound browser jobs with cross-workspace ownership validation, all-or-none foreign-key binding, and one job per step-run invariant.
- Transactional companion success-to-workflow bridge: completion and one `manual_step_completed` outbox command commit together, then the existing dispatcher resumes the waiting Temporal step. Completion replay is rejected.
- Companion management traceability distinguishing Campaign jobs from operator test jobs.
- Additive migration `0014_campaign_companion_routing.sql`, coherent `0.8.0` workspace/native versions, and updated architecture/domain/build/security contracts.
- Verified clean lint; 60 TypeScript tests including eight live PostgreSQL tests; all workspace type checks; migration execution/idempotency; optimized 39-page Next.js and companion webview builds; one Rust cross-language signature test; native Rust check; and a Windows x64 NSIS bundle.
- Windows preview installer: `apps/companion/src-tauri/target/release/bundle/nsis/Market Me Companion_0.8.0_x64-setup.exe`, 2,917,658 bytes, SHA-256 `0778bcaf568da30a737c3700a89bacdb094188489f9478cfda61adc2bdc3aac8`. The ignored artifact remains unsigned and is not a public distribution build.

Known limitations:

- Assisted execution opens one approved HTTPS page in the user's default browser and waits for explicit confirmation. It does not automate navigation, account/page identity, form entry, submission, screenshots, traces, CAPTCHA handoff, or browser-profile isolation.
- Campaign authors still configure the normalized capability and input dictionary in step JSON; a guided execution-method/worker selector remains future UI work.
- Worker availability is validated at activation and again at routing, but an offline transition leaves the step for manual resolution; durable reassignment and device failover are intentionally not automatic.
- Only Windows x86_64 has been built and runtime-verified. macOS/Linux validation, code signing, notarization, signed updates, provenance, and SBOM publication remain distribution gates.
- Local-folder monitoring/ingestion, Playwright sidecars, local models, production identity, production object storage/scanning, expanded media processing, rights enforcement, and additional provider adapters remain future releases.

Migration and rollback:

- `0014_campaign_companion_routing.sql` is additive and checksum guarded. Stop the 0.8 workflow worker and companion clients before running 0.7 application processes.
- Inspect and manually resolve or cancel pending Campaign-bound jobs and waiting instances before rollback; a 0.7 process does not create or consume the new completion bridge.
- Retain browser-job bindings and workflow commands for audit/forward recovery. Do not drop the additive columns or delete completed commands as a rollback shortcut.
- The 0.8 desktop remains protocol-schema compatible with 0.7 test jobs, but distribution rollback still requires deliberate worker pause/revocation because the unsigned preview has no managed updater.

## 0.7.0 - Media derivatives and accessibility foundation

Implemented:

- New `@market-me/media` package with strict object-key containment, immutable create-if-absent filesystem storage, SHA-256 content identity, bounded source bytes, best-effort binary signature detection, declared/detected MIME validation, and explicit malware-scan state.
- Separate `originals` and `derivatives` namespaces. Derivative cache keys bind the immutable source hash, `image-v1` processing version, and canonical non-destructive recipe hash.
- Sharp/libvips image inspection for dimensions, format, color space, orientation, transparency, and pages plus auto-oriented WebP thumbnail, bounded web-preview, and square-preview recipes.
- Immutable byte storage and UTF-8 extraction for supported text-like inputs. Verified unsupported media is stored and labeled `unsupported` rather than silently decoded.
- Additive migration `0013_media_accessibility.sql` with derivative lineage, object key, byte count, processing version, recipe, media/scan/rights state, alternative text, reviewer state, accessibility notes, and targeted indexes.
- Transactional derivative-to-original client-key resolution and repository read models; PostgreSQL approval now rejects every package containing an image at `alt_text_status=needs_review`.
- Authenticated accessibility-review API/UI for meaningful alt text or explicit decorative classification, with server-side role enforcement and audit events.
- Five-minute HMAC-SHA-256 preview capability URLs bound to one asset UUID and expiry; database-owned object lookup, timing-safe verification, inline image allowlist, forced download otherwise, `nosniff`, and restrictive response CSP.
- Content Package derivative gallery and processing/scan/rights/accessibility diagnostics on responsive review pages.
- New variables `MEDIA_STORAGE_ROOT`, `MEDIA_PROCESSING_VERSION`, and `MEDIA_ACCESS_SIGNING_KEY`; local web and ingestion processes share the same ignored storage root.
- Verified clean lint, 58 TypeScript tests (including eight live PostgreSQL repository tests), one Rust cross-language signature test, all workspace type checks, migration execution/idempotency, optimized 39-page web and companion-webview builds, three live signed WebP responses, pre-review approval rejection, post-review approval, exact temporary database-fixture cleanup, and a Windows x64 NSIS bundle.
- Windows preview installer: `apps/companion/src-tauri/target/release/bundle/nsis/Market Me Companion_0.7.0_x64-setup.exe`, 2,915,430 bytes, SHA-256 `3d882e5001f7fbaa0bd5e139cbe8a773eb1a0070a7c47a1d8883df77999a5e75`. The ignored artifact remains unsigned and is not a public distribution build.

Known limitations:

- The filesystem object store is a development adapter. Production requires encrypted/versioned S3-compatible storage, tenant-scoped keys/policies, lifecycle/retention, backups, signed-access rate limits, and orphan-object garbage collection.
- The default malware scanner is intentionally `not_configured`. No untrusted production ingest or external media publish is supported until a real quarantine/scanning adapter and media-worker isolation/timeouts are deployed.
- Release 0.7 processes text-like files and raster images only. PDF/document structure extraction, SVG handling, video/audio probing and transcoding, captions, transcripts, contrast analysis, perceptual hashes, watermarks, and connector-driven variants remain future work.
- Alternative text starts from a filename/dimension suggestion and always requires human review; no model-generated description is trusted or enabled.
- Rights state is persisted but proof, territory/channel/transform permissions, embargo/expiry, attribution, watermark, and pre-execution recheck are not yet implemented. Media-capable publication remains outside this release boundary.
- Local-folder monitoring and companion-to-ingestion byte transfer are not connected. Live source-byte processing still requires configured Google/Microsoft OAuth or controlled repository fixtures.
- The signed content endpoint reads complete bounded objects into memory. Production storage should stream with backpressure and provider-signed short-lived GET URLs where policy permits.

Migration and rollback:

- `0013_media_accessibility.sql` is additive and checksum guarded. Stop `apps/worker` before rolling back so a 0.6 process does not create packages that omit new object/accessibility states.
- Preserve all new asset metadata and object bytes for forward recovery. Rolling the application back does not safely garbage-collect content-addressed objects; run a separately reviewed reference-aware cleanup only after retention requirements are satisfied.
- Existing 0.6 asset rows default to `unsupported`, `not_configured`, `unchecked`, and `not_applicable`; no historical success is fabricated. A rollback may ignore the new columns without dropping them.
- `image-v1` objects are reproducible from retained originals. Do not overwrite or rename original keys; disable the media worker and preview-signing key if immediate containment is required.

## 0.6.0 - Desktop companion preview

Implemented:

- Tauri v2 desktop shell with a React/Vite webview and Rust-only privileged commands; the webview receives no worker bearer credential and has no generic shell or filesystem authority.
- Authenticated ten-minute one-use pairing-code creation, atomic hash-only consumption, one-time high-entropy worker-token delivery, operating-system credential storage, and workspace worker inventory.
- Bounded heartbeats with platform/version/capability/health reporting, 90-second disconnected derivation, administrator pause/resume/revoke, local emergency pause, and revoked-job cancellation.
- `open_url` attended job contract for `assisted` and `confirm_before_submit` modes with credential-free HTTPS targets, exact hostname/origin binding, bounded instructions, and stable idempotency keys.
- Transactional `FOR UPDATE SKIP LOCKED` claims, five-minute random lease tokens stored by hash, canonical JSON HMAC-SHA-256 envelopes, Rust-side verification, replay-rejected completion, and a bounded local executed-job guard.
- User-selected local folder approval with canonical directory validation and local-only path storage; heartbeat reports only whether a folder is configured.
- Authenticated responsive Companion management page for pairing, worker health/controls, test-job creation, and recent job state.
- Cross-platform credential backends selected at compile time: Windows Credential Manager, macOS Keychain, and Linux Secret Service. Remote control planes require HTTPS; localhost HTTP is development-only.
- Additive migration `0012_desktop_companion.sql`, shared `@market-me/companion-protocol`, coherent `0.6.0` workspace/native versions, generated desktop icon set, Rust/Cargo lockfile, and documented build/security contracts.
- Verified clean lint, 54 TypeScript tests plus a Rust cross-language signature test, all TypeScript checks, companion Vite build, Rust native check, migration idempotency, live pair/heartbeat/signed-claim/complete/pause/resume API flow, desktop/mobile browser QA, compiled native-window QA, a 39-page Next.js build, and a successful Windows x64 NSIS bundle.

Known limitations:

- The preview opens an approved HTTPS page in the default browser after an explicit user click. It does not include the separately packaged Playwright worker, account/page-identity automation, screenshots/traces, CAPTCHA resume, autonomous submission, or browser-profile management yet.
- Local folder selection is implemented, but folder monitoring and Smart Source ingestion are not. Local models and self-hosted Model Gateway routing are also not present.
- Companion jobs are operator-created tests and are not yet selected by the Campaign execution router. Capability-aware API/browser/assisted/manual mixing remains the next integration slice.
- Windows x86_64 is the only platform built and visually exercised in this release. macOS Intel/Apple Silicon, Ubuntu LTS, and CentOS Stream/RHEL-compatible install/runtime checks require target CI machines and release signing identities.
- The generated Windows installer is an unsigned development artifact. Native code signing, macOS notarization, signed updater keys/endpoints, staged rollout, rollback, provenance, and SBOM publishing are required before distribution.
- Pairing and worker endpoints need production rate limits, security audit events, expired-record cleanup, disconnect/unpair UX, credential rotation, and abuse monitoring.
- The local app runs interactively only. Background user-service mode, offline job/result queues, multi-account profile isolation, and server/worker compatibility negotiation remain future work.

Migration and rollback:

- `0012_desktop_companion.sql` is additive and checksum guarded. Rolling the web app back to 0.5.0 should first pause or revoke paired workers and stop distributing the companion so old servers do not leave clients polling unsupported routes.
- Preserve pairing/worker/job records for audit and forward recovery. A rollback cannot remove a worker token already stored on a device; revoke affected workers server-side and provide an explicit client unpair/credential-removal procedure.
- The 0.6 companion does not change Temporal workflow history. Existing 0.5 publishing workflows remain compatible with the 0.6 worker bundle.
- Native installer rollback must use a separately signed prior artifact once signing exists. The unsigned local preview has no updater channel and must be removed or replaced manually.

## 0.5.0 - Publishing and measurement foundation

Implemented:

- Versioned, timestamped per-action `ChannelCapabilityManifest` contracts with normalized publish/read-metrics/monitor-events actions, execution methods, limits, and feature flags.
- Discord incoming-webhook connection UI/API with strict endpoint validation, immediate provider identity test, AES-256-GCM credential storage, non-secret capability/configuration records, and no credential readback.
- Hardened Discord text publishing with provider confirmation (`wait=true`), 2,000-character validation, all mention parsing disabled, optional notification suppression, dynamic rate-limit classification, and provider message ID/URL capture.
- Capability-aware Campaign execution activity that automates supported `publish_content` steps and returns unsupported or unsafe work to explicit manual resolution.
- `publication_action` external-effect ledger with stable idempotency keys and ambiguity-safe retry: confirmed rate limits may retry, while an unproven prior dispatch is never automatically resent.
- Random first-party tracked links that preserve canonical Destination identity, reuse one link per Campaign step, append allow-listed UTM fields, record cookie-free visits, and continue redirecting if measurement storage is unavailable.
- One-time high-entropy measurement ingest keys with hash-only storage, replay-safe normalized event ingestion, cross-tenant reference validation, bounded properties, and Campaign-instance publication/measurement APIs and UI.
- Additive migration `0011_publishing_measurement.sql`, coherent `0.5.0` workspace versions, and updated operations/security documentation.
- 49 passing automated tests, including connector request/security behavior, ambiguity-safe execution routing, PostgreSQL measurement/idempotency integration, and Temporal workflows; all type checks, clean lint, migration execution, authenticated browser QA, and a successful 33-page production build.

Known limitations:

- Discord incoming webhooks are the only automated outbound channel. Live publication requires a user-provided webhook URL; no customer credential was available for a real external post, so provider-shaped HTTP and execution-router tests cover the adapter.
- Discord webhook metrics and inbound events are unavailable. Additional social/email/community providers require their own approved access, capability manifests, policy checks, and end-to-end consent testing.
- Campaign authors currently place `channelConnectionId` and message options in step input JSON; a richer per-provider Campaign editor will replace this developer-oriented configuration.
- Measurement keys cannot yet be revoked in the UI, and public ingestion needs production rate limiting, quotas, retention/aggregation jobs, and operations alerting.
- Attribution currently reports direct Campaign-instance associations and tracked-link visits. First/last/linear/position-based views, provider metric polling, experiments, spend, and revenue dashboards remain future releases.
- Production identity, RLS, CSRF-origin enforcement, KMS, object storage, media processing, and hardened Temporal/measurement infrastructure remain required before untrusted production traffic.

Migration and rollback:

- `0011_publishing_measurement.sql` is additive and checksum guarded. Stop the workflow worker before rolling back to 0.4.0 so the old activity set does not consume new publishing histories.
- Preserve channel connections, publication actions, tracked links, ingest-key hashes, and events for audit/forward recovery. Revoking/deleting an external Discord webhook is a provider-side action and is not performed by an application rollback.
- Existing 0.5 Temporal histories call `executeStep`; do not run them on a 0.4 worker bundle. Leave them on a compatible task queue or cancel them deliberately before rollback.

## 0.4.0 - Durable campaigns and approvals

Implemented:

- Destination Registry APIs and responsive create/edit/list UI with canonical provider identity, redirects, classifications, lifecycle, replacement, and tracking metadata.
- Campaign authoring APIs/UI with immutable publishable versions, objectives and content controls, approved Content Package selection, published Destination selection, timezone/context, and directed-acyclic step graphs.
- Deterministic graph validation for duplicate/missing/self dependencies, cycles, exact/preferred schedule requirements, stable topological ordering, and retry/timeout limits.
- PostgreSQL migration `0010_campaign_workflows.sql` for Destinations, Campaign definitions/versions/steps, instances, step runs, append-only attempts, approvals, and transactional workflow commands.
- Activation-time enforcement that binds only the current published version and rejects unapproved packages or unpublished/unavailable Destinations.
- Temporal TypeScript workflow/worker with dependency-batch parallelism, exact-time and duration timers, approval and manual-completion signals, context handoff, pause/resume persistence, prompt cancellation, activity retries, and terminal state mirroring.
- Explicit `manual_resolution` for every external operation until publishing connectors exist; optional rejected steps become `partially_succeeded` and required rejection fails the instance.
- Transactional command dispatch for start/pause/resume/cancel/approval/manual signals, stable workflow IDs, duplicate suppression, stale-claim recovery, capped exponential retry, and six-attempt dead lettering.
- Authenticated pending-approval and Campaign-instance control surfaces, including structured manual output completion.
- Isolated Temporal development services, workflow environment variables, root operations scripts, and coherent `0.4.0` workspace versions.
- 44 passing automated tests (including PostgreSQL integration and time-skipping Temporal execution), all workspace type checks, lint, migration execution, a real local Temporal end-to-end Campaign, authenticated browser checks, and a successful 30-page Next.js production build.

Known limitations:

- External provider actions are intentionally manual handoffs. Release 0.5 adds capability-routed publishing only where an authenticated adapter and policy allow it.
- Recurring, preferred-window, evergreen, and conditional schedules are represented in the durable schema but do not yet have complete scheduler semantics; exact-time, dependency, immediate, and duration waits are executable.
- Temporal development uses local plaintext gRPC and a development namespace. Production requires authenticated/mTLS access, namespace isolation, retention controls, payload encryption/codecs, backups, and worker identity.
- Approval conditions are stored as JSON but advanced condition evaluation and campaign-level preapproval policy remain future work.
- Production identity, RLS, CSRF-origin enforcement, rate limiting, KMS, object storage, retention, malware scanning, and workflow operations alerting remain required before untrusted production traffic.

Migration and rollback:

- `0010_campaign_workflows.sql` is additive and checksum guarded. Stop `apps/workflow-worker` before rolling the web/ingestion processes back to 0.3.0; retain all Campaign, approval, command, and attempt rows for audit and forward recovery.
- Paused or waiting Temporal executions are code-history sensitive. Before a production rollback, cancel or intentionally leave them on a compatible worker build; never point an incompatible old worker at the 0.4 task queue.
- The local Temporal metadata database is separate from application PostgreSQL. `npm run workflow:stop` preserves both volumes; do not delete them as an application rollback step.

## 0.3.0 - Evidence-backed Content Packages

Implemented:

- Versioned Context Packs with manual, HTTPS-reference, and indexed-source inputs; selected sections; structured JSON facts; explicit authority rules; draft editing; and immutable published snapshots.
- Same-workspace published-pack validation on Smart Sources and exact Context Pack version capture on every Content Package.
- Google Drive media download and Workspace text/CSV export; Microsoft Graph content download with HTTPS redirect validation and no bearer-token forwarding to pre-authenticated download hosts.
- Bounded text-like extraction, SHA-256 content identity, original asset records, observed/authoritative/unresolved evidence, and deterministic conflict detection.
- Durable ingestion claims with stabilization deferral, stale-claim recovery, retry/backoff, and inspectable failures.
- Content Package list/detail APIs and review UI showing assets, extracted text, evidence, and conflicts.
- Learning Review conflict selection, unresolved-claim correction, immutable evidence supersession, approver authorization, audited actions, and repository-enforced approval blockers.
- Additive migrations `0005_context_packs.sql` through `0009_evidence_resolution.sql`.
- 37 passing automated tests, all workspace type checks, lint, migration idempotency, authenticated runtime checks, browser review, and a successful 21-page Next.js production build.

Known limitations:

- Live provider extraction requires Google/Microsoft OAuth credentials and consent; provider-shaped connector tests and local database integration are complete.
- Extraction is text-like only. PDFs, images, audio, and video currently remain metadata/skipped inputs; large bytes and derivatives must move to object storage before production scale.
- HTTPS Context Pack URLs are validated stored references, not fetched content. Local-folder ingestion waits for the Tauri companion.
- Model Gateway inference is not enabled. Evidence is deterministic observed/context evidence; absent AI readiness becomes explicit review work instead of an invented recommendation.
- Production identity, RLS, CSRF-origin enforcement, rate limiting, KMS, retention, and malware-scanning controls remain required before untrusted production traffic.

Migration and rollback:

- Migrations `0005` through `0009` are additive and checksum guarded. Roll back the app to 0.2.2 while retaining new rows for forward recovery; do not drop review history or published Context Pack versions.
- Disable the content worker before rollback so a 0.2.2 process does not leave newly claimed ingestion work in progress. Stale claims remain recoverable on upgrade.

## 0.2.2 - Webhooks and authoritative reconciliation

Implemented:

- Google Drive `changes.watch` channel creation with unique channel IDs, hashed channel tokens, six-day requested lifetime, replacement-before-expiry, and old-channel stop operations.
- Microsoft Graph root-drive subscription creation, validation endpoint support, hashed `clientState`, 55-minute requested lifetime, renewal, deletion, and lifecycle notification intake.
- Canonical subscription targets derived from enabled Smart Sources: one Google changes channel per connection, one OneDrive root target, and one target per selected SharePoint drive.
- Revision-safe `0003_webhook_reconciliation.sql` and `0004_webhook_claim_recovery.sql` with subscription resource/renewal state, a durable deduplicating queue, and stale-worker claim recovery.
- Fast bounded public webhook receivers, transactional queue claims, cursor-authoritative reconciliation, exponential retries, six-attempt dead-lettering, and continued polling recovery.
- Integration readiness UI now distinguishes public webhook delivery from the polling fallback.
- Connector, service, repository integration, migration idempotency, type, lint, production build, route, and worker smoke verification.

Known limitations:

- Live delivery requires provider OAuth credentials, consent, and a publicly reachable HTTPS `PUBLIC_WEBHOOK_BASE_URL`; these deployment-specific values are intentionally absent from the repository.
- Microsoft basic notifications are authenticated with `clientState`. Rich encrypted resource notifications and their JWT/certificate validation are not enabled because reconciliation fetches authoritative delta data.
- Polling continues for recovery and local development. Provider quota-aware scheduling and stale-cursor full rescan automation will be hardened with production telemetry.
- Content bytes are not downloaded yet; the source index still contains normalized metadata and replay-safe ingestion events.

Migration and rollback:

- `0003_webhook_reconciliation.sql` is additive. Roll back the app to 0.2.1 while preserving subscriptions/events for audit; disable public routes and the worker to stop local processing.
- Provider subscriptions have external state. Before permanently decommissioning a deployment, run channel/subscription revocation while credentials remain valid or allow short-lived subscriptions to expire.

## 0.2.1 - Storage discovery and normalized ingestion

Implemented:

- Google Drive folder listing, shared-drive compatible options, start-page tokens, and paginated change feeds.
- OneDrive/SharePoint children listing and delta traversal with trusted continuation URL enforcement.
- Normalized provider entries for IDs, parents, names, MIME types, folders, size, modification time, content hashes, etags, and web URLs.
- Recursive Google folder discovery; Microsoft delta initial enumeration; MIME and glob filtering; 10,000-item bounded sync runs.
- Cursor, sync-run, source-item, ingestion-event, and webhook-subscription schema in `0002_storage_ingestion.sql`.
- Idempotent source-item upserts, resurrection, deletion marking, replay-safe ingestion events, content-hash index, and last-scan tracking.
- Automatic OAuth access-token refresh with encrypted token replacement.
- Authenticated read-only folder preview, provider-backed Smart Source test, manual sync, normalized item API/UI, and a configurable polling worker.
- OneDrive scope narrowed from `Files.Read.All` to least-privilege `Files.Read`; SharePoint uses `Sites.Read.All`.

Known limitations:

- Live provider activation and provider-backed end-to-end testing require Google/Microsoft client credentials and consent.
- Webhook subscription creation/renewal and notification queueing remain for 0.2.2; the polling worker provides current change detection.
- Google change feeds are account-wide and filtered through the stored folder hierarchy; reconciliation scans remain necessary for permission/path edge cases.
- Content bytes are not downloaded yet. This release persists normalized metadata and ingestion events only.

Migration and rollback:

- `0002_storage_ingestion.sql` is additive. Roll back the app to 0.2.0 while preserving cursor, source-item, and event tables.
- Replaying a page is safe: unique source/item and source/idempotency constraints suppress duplicates.

## 0.2.0 - Persistent workspace and Smart Source setup

Implemented:

- PostgreSQL 18 plus pgvector development container and repeatable checksum-guarded SQL migration.
- Organizations, users, memberships, workspaces, brands, database sessions, storage connections, OAuth state, versioned Smart Sources, source locations, test runs, and audit events.
- Opaque 256-bit session tokens stored only in an HttpOnly, SameSite=Lax cookie; only SHA-256 hashes are persisted.
- Server-side workspace read/write authorization in the data-access boundary and each mutable Route Handler.
- Authenticated create, list, read, edit, and configuration-test Smart Source APIs and responsive UI.
- Provider-neutral capability manifests for Google Drive, OneDrive, and SharePoint.
- Google and Microsoft authorization-code flows with state, PKCE S256, expiring single-use state, offline access, and AES-256-GCM token envelopes.
- Connector readiness UI that fails visibly when credentials or encryption configuration are absent.
- Unit, connector security, PostgreSQL integration, API authorization, migration idempotency, production build, and browser checks.

Known limitations:

- Development login is local-only and unavailable in production. A production identity provider is not configured.
- OAuth client IDs and secrets are unavailable, so live storage authorization was not activated.
- Provider folder discovery, polling/webhooks, change cursors, reconciliation, ingestion, stabilization jobs, and deduplication are scheduled for 0.2.1.
- No workflow engine, model calls, media processing, or external publishing exists yet.

Migration and rollback:

- New installations run `0001_foundation.sql`; it is forward-only and checksum guarded.
- PostgreSQL 18 containers mount `/var/lib/postgresql`, not `/var/lib/postgresql/data`.
- Roll back the app to 0.1.0 while leaving the additive schema in place. Do not drop tenant data as an application rollback.

## 0.1.0 - Control-plane foundation

Implemented the Next.js/React dashboard, universal domain types, deterministic readiness and override policies, representative fixtures, and initial documentation.

## 0.5.x - Publishing and measurement expansion

- Expanded social/email/community adapters, provider metric polling, richer Campaign connection authoring, and channel-specific test/private-draft flows.
- Attribution models, experiments, success targets, spend/return reporting, retention aggregation, and export.

## 0.6.x - Desktop companion expansion

- Playwright sidecar, browser account/page identity, traces and screenshots, challenges, rapid workflow disable, attended submission, and Campaign execution-router selection.
- Local-folder monitoring, local models, background service mode, offline result synchronization, signed updates, and validated Windows/macOS/Ubuntu/CentOS Stream installers.

## Release discipline

Use semantic versioning before 1.0. Each release records schema/workflow compatibility, changed variables, security impact, rollback steps, and verified platform/browser coverage.
