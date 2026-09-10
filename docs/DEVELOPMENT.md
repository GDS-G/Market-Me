# Developer Guide

## Current checkpoint: 1.21 evidence retention implementation

Apply `0110_immutable_draft_claim_evidence.sql` only with compatible draft/AI writers. Its SHA-256 is `249e7ab29f1158e9092548530b731c8648c9e9e6c3581d8968a02c6bc536cdff`; readiness requires exactly 110 migrations and that latest filename. No new environment variable or dependency upgrade is required. The snapshot reference function is now called by ordinary/AI revisions and AI context construction, so code and schema must be deployed together.

Stop/drain generation and revision writers before migrating, then start compatible binaries. Old interleaved claim/link insertion can fail the new whole-version trigger on multi-fact drafts. Retain historical links/snapshots on rollback; restoring the live-evidence deletion cascade would reintroduce data loss. Existing V2 Temporal compatibility and worker-first scheduling rollout rules still apply independently.

The new live `draft-evidence-refresh.integration.test.ts` refuses non-QA/non-CI database URLs and exercises real package replacement, historical revision, invalid proof, tenant separation and lock-wait behavior. AI integration tests also reject invalid proof before context/intent creation and apply. The 109-to-110 historical migration rehearsal uses synthetic legacy data and verifies backfill/rerun checksums; final counts and native artifacts belong in [Releases](RELEASES.md). See [Evidence retention](EVIDENCE_RETENTION.md) for all engineering invariants and [Campaign preparation](CAMPAIGN_PREPARATION_PLAN.md) for work not yet implemented.

## 1.20 bounded scheduler implementation

Preferred request-start windows and positive dependency delays are implemented for the bounded routes below. This section is an implementation/runbook update, not a package-version, installer, production-readiness or whole-product acceptance attestation. Use [Implementation status](IMPLEMENTATION_STATUS.md), [Scheduling contracts](SCHEDULING_CONTRACTS.md) and [cloud CI](CI.md) with the current source; historical evidence below remains labeled by its release.

### Implementation map and operator controls

- Apply the repository's full forward migration set, including `0109_campaign_schedule_bounds.sql`, before running the new application/worker. It adds the checked delay column, finite ordered schedule bounds and `schedule_blocked` status. Do not edit an already applied migration or down-migrate retained workflow/publication evidence.
- `packages/domain/src/schedule.ts` owns absolute-instant parsing, delay limits and pure earliest-start evaluation. `campaign-repository.ts` owns the pinned evidence projection, activation route/capability/expiry checks, first-completion preservation and blocked-instance control guards. `campaign-route-policy.ts` is shared structural route validation, not authorization.
- `packages/workflows/src/workflows.ts` is the Temporal patch wrapper; `scheduled-workflow.ts` owns new independent branches, finite expiry wakes and signals. `legacy-workflow.ts` and `legacy-policies.ts` freeze 1.19 command-affecting logic. `activities.ts` validates exact IDs and recovers prior outcomes before bounded authority. Never route V2 through the unchanged legacy `executeStep` activity.
- `PublishingRepository.admitPublication` is the shared short transaction for initial/retry admission. Preserve its lock order and post-wait clock check. Construct this repository with the deployment's `appBaseUrl` when raw Discord content renders a tracked Destination link; the repository recomputes and checks the real content/subject instead of trusting a request snapshot.
- `apps/workflow-worker/src/execution.ts` performs exact read-only recovery, guarded preflight, post-preflight/admission schedule reads and owned no-dispatch-claim cleanup. `packages/connectors/src/request-budget.ts` owns the trusted UTC/monotonic budget through request and body consumption. No new scheduler environment variable, secret or cross-tenant mutable global is introduced.
- Campaign inputs remain explicit UTC instants, preserving seconds/milliseconds; timezone controls presentation only. Preserve `dependencyDelaySeconds`, both window bounds, condition/input/output objects and execution methods on every save. Calendar/run screens show the pinned plan and block reason, not a reserved slot or provider completion guarantee.
- Initial preferred-window routes are text-only Discord, Slack and Mastodon with exactly `official_api`, current active publishing capability and zero attachments/fallback methods. Slack/Mastodon require an exact approved preview and actual human approval. Workflow-only wait/request-approval delays and normal publication predecessors are allowed. **Any** bounded Campaign containing `user_assisted` is rejected, including an immediate companion predecessor; do not manually remove the guard to work around queue timing.
- Recurring/evergreen/conditional/follow-up execution, pacing/quiet hours/collision planning and source-ready-to-template Campaign automation remain separate work. Mailchimp, media, local-browser, companion and manual-fallback preferred windows are saved-only. Existing non-window routes are not a claim that those routes can enforce a deadline.

### Deployment order and rollback

1. Keep new activations unavailable during a mixed-version rollout using deployment maintenance controls; there is no new scheduler enable environment flag. Inventory old Temporal histories and unresolved provider actions before switching workers.
2. Apply forward migrations, deploy the compatible workflow worker/activity router first, then deploy/admit the new web/API plans. A 1.19 worker cannot execute the new activity names or safely interpret the new history path.
3. Retain `patched("bounded-scheduling-v1")`, frozen legacy modules and their digest/replay tests while unmarked 1.19 histories remain in retention. The suite captures actual legacy completion and cancellation histories and replays them through the patched wrapper; it also replays a marked V2 history. Arbitrary pre-1.19 histories still need separate compatibility/reconciliation review. Follow the [Temporal patch lifecycle](https://docs.temporal.io/develop/typescript/workflows/versioning), not an unverified in-place rewrite.
4. After V2 histories exist, do not roll back to a worker lacking their workflow/activity implementation. Keep a compatible worker available for retained histories, stop new activations if necessary, reconcile accepted/ambiguous actions, and preserve database migrations/history.
5. A blocked window is recovered by canceling and publishing/reviewing a new plan for remaining work. Resume and manual completion are refused for the blocked instance. Cancellation wakes pending timers/branches immediately but waits for dispatched activities to settle; this can delay final workflow completion and must not be replaced with a forced resend or deletion of publication state.

Keep host clocks synchronized. Sample monotonic `readStart` before the database read, then compute the cutoff from `readStart + floor(deadline - evaluatedAt - 1ms)` when the evidence returns; do not persist/copy it across processes, extend it after preflight, or accept a browser deadline. A conservative clock disagreement may prevent a send early and require review. Once provider I/O has started, an abort/unknown acknowledgement is potentially accepted delivery, not proof of a missed unsent window.

### Focused verification

Run these against synthetic fixtures with `DATABASE_URL` pointing to an isolated QA database, never the application database. Ordinary database tests do not themselves guarantee that the supplied URL is disposable. The activation suite creates separate workspace rows and cleans its owned rows; it does not need real provider credentials or a live outbound send.

```powershell
npm run test --workspace=@market-me/domain -- src/schedule.test.ts
npm run test --workspace=@market-me/database -- src/campaign-schedule.integration.test.ts src/campaign-bounded-activation.integration.test.ts src/publishing-repository.integration.test.ts src/campaign-route-policy.test.ts
npm run test --workspace=@market-me/workflows
npm run test --workspace=@market-me/connectors
npm run test --workspace=@market-me/workflow-worker
```

Temporal tests need the SDK's local test server/cache and use time-skipping plus replay. Deliberately held external activities can inhibit automatic skipping; use short bounded fixture windows rather than minutes of real waiting. Preserve checks for independent successors, late approvals/dependencies, pause across expiry, stale resume/manual signals, late in-flight success, ambiguous recovery, one retry claimant, lock-wait expiry, preflight revocation/configuration drift and exact request counts. Then run the full migration/type/lint/test/build/audit/browser gates; isolated passing suites are not release totals. Bounded attachment rejection has shared route-policy coverage, while full governed media fixtures remain separate; do not claim a new end-to-end media-deadline proof.

## 1.19.0 local preview (historical checkpoint)

At the 1.19 checkpoint, package/native versions were synchronized at 1.19.0. Start with [Implementation status](IMPLEMENTATION_STATUS.md) and [cloud CI](CI.md); the historical sections below describe prior increments and are not a whole-product completion claim. npm and package-lock.json are authoritative; the unrelated incomplete pnpm stubs are not part of the source baseline. On a clean checkout, install with `npm ci --ignore-scripts --no-fund`, then generate web types with `npm exec --workspace=@market-me/web -- next typegen` before type-checking.

`.gitattributes` keeps text files LF on Windows and Linux, including migration bytes used for SHA-256 checksums. Do not convert applied SQL files to CRLF or modify their bytes. Markdown two-space line breaks are intentional. `null/` directories created by misconfigured local runtime tooling are ignored at every level and never part of the application source.

- Apply all **108 migrations**, ending at `0108_mastodon_collection_alerts.sql`, before starting this web build. Readiness now requires that exact migration count/name. Migration SHA-256: `8a121cfedd618667e138c160ab734a58d72aadad60b69bb491e869375f632a1a`. The fresh replay and 39 live database tests have passed in the current integration run; this does not validate live third-party credentials or production deployment.
- Every page must resolve its tenant through `getActiveWorkspace(sessionUser.id)` and handle no membership. The shared shell obtains the same request-scoped selection. Do not reinstate `listWorkspaceAccess(user.id)[0]` or authorize from the cookie. Explicit API `workspaceId` inputs continue through exact membership and role checks.
- Set `APP_BASE_URL` to the actual browser origin, including a local development port, when testing workspace switching. The Server Action checks that configured origin in addition to Next's Origin/Host protection. A successful switch writes the seven-day selection hint, clears cached navigation, and replaces the route with a safe section root. Logout clears both session and selection cookies. An authenticated account with no memberships now has a stable no-access view.
- Campaign form timestamps are **UTC inputs** even if a campaign has another presentation timezone. `2026-09-15T15:30:42.125Z` must survive an unchanged edit/save as that same instant. Preserve `preferredWindowStart`, `preferredWindowEnd`, condition JSON, optionality, execution methods, outputs, retry count, and timeout during ordinary editing. At 1.19, recurring/window/conditional/evergreen fields were saved plans; 1.20 adds only the bounded window/delay support specified above.
- Do not bypass `assertStepExecutionAuthorized` for a queued activity or `beginPublicationAction` for a provider publication. The former rechecks active/running state, exact approval, due time, and dependencies; the latter re-reads target lineage and guards idempotency reuse. A whole-campaign review is a real version-bound approval, not an implied permission from choosing `campaign_approval`.
- Automatic collector variables remain `MASTODON_STATUS_REPORT_COLLECTION_ENABLED`, `..._LOOP_MS`, `..._BATCH_SIZE`, `..._REFRESH_SECONDS`, and `..._MAX_AGE_SECONDS`; no new secret or alert endpoint is introduced. Default values remain false, 30000, 10, 900, and 604800. Reconciliation uses the same configured age horizon as claiming, runs before even an empty claim pass, and sets `alertReconciliationFailed` if it fails. Fence every automatic snapshot/completion with the claimed attempt number.

Useful commands from the repository root:

```powershell
npm run typecheck
npm run test --workspace @market-me/web
npm run test --workspace @market-me/workflow-worker
npm run test --workspace @market-me/domain
npm run test --workspace @market-me/workflows
npm run qa:mastodon-status-report-collector
npm run check
```

Integration evidence totals **400 distinct TypeScript cases** and three Rust tests. The database suite has 47 cases (including two unit cases counted in the general suite), workflow-worker 40, web 128, domain 28 and workflows eight. Retrying the same case is not an additional distinct test. Full workspace typecheck, web lint and the production web build have passed; the build generates 91 pages. Local browser acceptance covered two-workspace isolation/navigation, real counts, versioned calendar plans, UTC edit preservation, no-membership/logout behavior, and filter state. A post-dependency production smoke verified login, protected-root redirect, CSS/eight JS assets and no application console/server errors on loopback.

Worker-readiness QA observed 200 with current heartbeats and 503 after workflow-heartbeat shutdown across nine checks. Collector QA performed one exact aggregate-only request with fenced claims and idle alert reconciliation. Fixture guards verified no-membership behavior, duplicate-seed refusal and rejection of a non-QA database before connection. Invoke fixture scripts directly with `node --import tsx` so their flags reach the script; do not treat accidental argument swallowing as a successful no-access test.

The final isolated QA database was removed after verifying zero sessions; its synthetic contents are reproducible, not a backup of application data. QA servers/tabs were stopped/closed. The existing `market_me` application database and `market-me_market_me_postgres` volume were preserved. The PostgreSQL container was recreated only to apply the `127.0.0.1:5432` binding; no application migration or volume reset was performed during cleanup.

The local unsigned Windows installer is `apps/companion/src-tauri/target/release/bundle/nsis/Market Me Companion_1.19.0_x64-setup.exe`, 2,945,143 bytes, SHA-256 `a6e784ead456daae32a38d38f79a3296b521f5c751e978bcaabaad85b0c3aeff`. It was rebuilt after runtime dependency fixes, not installed or uploaded as a release asset. Next/eslint-config-next 16.3.4, Sharp 0.35.4, nanoid 3.3.18, fast-uri 3.1.7 and Vitest 4.1.11 are the security-patched baseline; both full and production-only audits report zero vulnerabilities at verification time. See Security for the limitations of that statement. Linux CI and native cross-platform acceptance are separate evidence.

`retryPublicationAction(id, target, {content, subject})` rechecks the original rendered request and exact account/preview authority before atomically claiming a failed action. Only `true` grants this caller dispatch ownership. A losing retry or observer must not send or overwrite an active publication. Failed legacy actions with missing/partial identity need manual reconciliation. These checks do not yet serialize every mutable rights read with external dispatch; quiesce authority changes and follow the rollout limitations in Security.

`node scripts/bump-version.mjs 1.19.0` synchronizes the explicit version in the root and 12 workspace manifests, internal `@market-me/*` dependency references, package-lock workspace entries, and Tauri/Cargo metadata. It does not resolve dependencies, modify Git history, or publish anything. Review the resulting files and rerun appropriate gates when preparing another release; a version bump alone is not acceptance.

### Disposable workspace-navigation fixtures

`scripts/qa-workspace-navigation.ts` is a fixture writer, **not** an application seed command. It refuses a `DATABASE_URL` whose database pathname does not match `/market_me_qa_[a-z0-9_]+`. Provision an isolated database, apply its migrations, supply its URL securely through the environment, then run:

```powershell
node --import tsx scripts/qa-workspace-navigation.ts
# Only after normal navigation acceptance, to test the synthetic no-access state:
node --import tsx scripts/qa-workspace-navigation.ts --no-memberships
```

The helper creates neutral QA Alpha/Beta memberships, one local source, an exact-time campaign approval, and an unactivated conditional plan. `--no-memberships` removes the synthetic test account's memberships inside that disposable database. Never point it at a user/application database or copy its output into documentation. Browser acceptance should inspect workspace changes, own-workspace records, exact timestamp preservation, plan/run labels, rejected return targets, the no-membership view, and cleanup of the isolated database/session/server after completion.

## Repository layout

```text
apps/web/                    Next.js control plane and Route Handlers
apps/web/src/server/         Server-only config, auth, validation, and composition
apps/worker/                 Subscription, reconciliation, and polling process
apps/workflow-worker/        Temporal worker and transactional command dispatcher
apps/companion/              React/Vite desktop webview and Rust/Tauri native shell
packages/domain/             Provider-neutral entities and deterministic policies
packages/companion/          Pairing, worker, signed-job, URL, and validation protocol
packages/database/           PostgreSQL client, migrations, models, and repositories
packages/connectors/         Storage, OAuth, webhook, PKCE, and token encryption adapters
packages/ingestion/          Discovery, cursor sync, webhook queue, refresh, and reconciliation
packages/media/              Immutable object storage, MIME validation, image recipes, and signed access
packages/workflows/          Deterministic Temporal workflows, signals, and database activities
docs/                        Version-controlled engineering documentation
compose.yaml                 Application PostgreSQL plus isolated Temporal/PostgreSQL services
.env.example                 Configuration contract without secrets
```

## Local workflow

```powershell
npm install
npm run db:up
$env:DATABASE_URL='postgres://market_me:market_me_local@localhost:5432/market_me'
npm run db:migrate
npm run workflow:up
npm run dev
# second terminal when provider credentials are configured
npm run worker
# third terminal for campaign orchestration
npm run workflow-worker
```

The web app loads runtime variables from `apps/web/.env.local`. The migration CLI reads `DATABASE_URL` from the process environment. The local development sign-in creates a user, organization, workspace, owner memberships, and default brand on first use. It reuses the existing workspace for the configured email on later use.

Commands:

- `npm run db:up` / `npm run db:down` - start or stop the development database.
- `npm run db:migrate` - apply forward-only SQL files in filename order and reject changed checksums.
- `npm run dev` - run the Next.js development server.
- `npm run worker` - poll all enabled remote Smart Sources; set run-once mode for jobs/tests.
- `npm run workflow:up` / `npm run workflow:stop` - start or stop the isolated Temporal development server and its metadata database without stopping application PostgreSQL.
- `npm run workflow-worker` - run the Temporal campaign worker and database-command dispatcher; this process requires both PostgreSQL and Temporal.
- `npm run companion:dev` - run the Tauri companion in development mode after installing the target operating system's Tauri prerequisites.
- `npm run companion:native:check` - compile-check the Rust authority boundary without creating an installer.
- `npm run companion:native:test` - run Rust-side protocol fixtures, including the cross-language canonical-HMAC vector.
- `npm run companion:bundle` - build an optimized Windows x64 executable and NSIS installer on a configured Windows host.
- `npm run qa:database-recovery` - after explicitly acknowledging stopped writers, dump and restore the local application database into a random isolated database and compare all tables, migrations, and constraint validation.
- `npm run lint` - lint the web workspace.
- `npm run test` - run tests in every workspace; DB integration tests skip unless `DATABASE_URL` is set.
- `npm run typecheck` - TypeScript checks across workspaces.
- `npm run build` - optimized production web control plane and companion webview bundles.
- `npm run check` - lint, all workspace tests and type checks, both web builds, and the native Rust check.

The complete backup/recovery ownership model, production controls, validation gates, and incident sequence are in `docs/RECOVERY.md`. The QA command is local logical-restore evidence only; it does not provision scheduled backups or establish production RPO/RTO.

## Environment variables

| Variable                            | Required                           | Scope and intent                                                                                                                                       |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                      | Runtime                            | Server/CLI PostgreSQL connection. Never expose to the browser.                                                                                         |
| `APP_BASE_URL`                      | OAuth                              | Canonical origin used to form exact callback and logout URLs.                                                                                          |
| `MARKET_ME_DEV_LOGIN_ENABLED`       | Local only                         | Enables one-click bootstrap only when `NODE_ENV` is not production.                                                                                    |
| `MARKET_ME_DEV_USER_EMAIL`          | Local only                         | Stable bootstrap identity and workspace lookup key.                                                                                                    |
| `MARKET_ME_DEV_USER_NAME`           | Local only                         | Display name for the bootstrap identity.                                                                                                               |
| `OIDC_ISSUER`                       | Production identity                | Exact OpenID Connect issuer. HTTPS is mandatory in production; development permits loopback HTTP for disposable QA only.                               |
| `OIDC_CLIENT_ID`                    | Production identity                | Server-side relying-party client identifier. Must be configured with the issuer.                                                                        |
| `OIDC_CLIENT_SECRET`                | Provider-dependent identity        | Optional server-only confidential-client secret. Public clients may omit it when the provider permits PKCE-only exchange.                              |
| `OIDC_PROVIDER_NAME`                | Production identity                | Bounded human-readable label shown on the login button; default `Organization account`.                                                                 |
| `OIDC_BOOTSTRAP_EMAILS`             | Initial provisioning only          | Comma-separated normalized verified emails allowed to create an owner workspace. Empty it after initial provisioning; use Team invitations thereafter. |
| `CONNECTOR_TOKEN_ENCRYPTION_KEY`    | OAuth                              | Base64-encoded 32-byte AES key. Production should use managed KMS envelope encryption.                                                                 |
| `GOOGLE_DRIVE_CLIENT_ID`            | Google OAuth                       | Server-only web application client ID.                                                                                                                 |
| `GOOGLE_DRIVE_CLIENT_SECRET`        | Google OAuth                       | Server-only web application client secret.                                                                                                             |
| `MICROSOFT_CLIENT_ID`               | Microsoft OAuth                    | Server-only Entra web application client ID.                                                                                                           |
| `MICROSOFT_CLIENT_SECRET`           | Microsoft OAuth                    | Server-only Entra web application client secret.                                                                                                       |
| `MICROSOFT_TENANT_ID`               | Microsoft OAuth                    | Tenant identifier; defaults to `common` for development.                                                                                               |
| `PUBLIC_WEBHOOK_BASE_URL`           | Webhook deployment                 | Public HTTPS origin used to build provider callback URLs. Optional locally; polling remains active when absent.                                        |
| `CONNECTOR_POLL_INTERVAL_SECONDS`   | Worker                             | Poll and queue-processing interval; minimum 15 seconds, default 60.                                                                                    |
| `CONNECTOR_WORKER_RUN_ONCE`         | Worker/job                         | Run one sweep and exit instead of looping.                                                                                                             |
| `WEBHOOK_BATCH_SIZE`                | Worker                             | Ready notification hints claimed per sweep; integer from 1 through 100, default 25.                                                                    |
| `CONTENT_INGESTION_BATCH_SIZE`      | Worker                             | Ready source-change events claimed per sweep; integer from 1 through 100, default 10.                                                                  |
| `MAX_SOURCE_DOWNLOAD_BYTES`         | Worker                             | Hard byte limit for one provider download; integer from 1 KiB through 50 MiB, default 10 MiB.                                                          |
| `MEDIA_OBJECT_STORE`                | All media processes                | `filesystem` for development or `s3`; production requires `s3`.                                                                                        |
| `MEDIA_STORAGE_ROOT`                | Local media processes              | Shared filesystem-development root. All processes must resolve the same absolute directory; default `../../.market-me/media`.                         |
| `MEDIA_S3_BUCKET`                   | S3 media storage                   | Required bucket name when `MEDIA_OBJECT_STORE=s3`.                                                                                                     |
| `MEDIA_S3_REGION`                   | S3 media storage                   | Required signing region, including for compatible endpoints.                                                                                           |
| `MEDIA_S3_ENDPOINT`                 | Compatible S3 only                 | Optional absolute endpoint; omit for AWS S3. Production endpoints must use HTTPS and cannot contain credentials, query, or fragment.                   |
| `MEDIA_S3_FORCE_PATH_STYLE`         | Compatible S3 only                 | Exact `true`/`false`; enable only when the selected provider requires path-style addressing.                                                            |
| `MEDIA_S3_PREFIX`                   | Optional deployment scope          | Normalized safe key prefix shared by all processes; do not use it as an authorization boundary.                                                        |
| `MEDIA_S3_ACCESS_KEY_ID`            | Optional S3 credential             | Must be paired with the secret key. Prefer an SDK-supported workload identity and leave static variables unset.                                        |
| `MEDIA_S3_SECRET_ACCESS_KEY`        | Optional S3 credential             | Server-only secret paired with the access-key ID.                                                                                                      |
| `MEDIA_S3_SESSION_TOKEN`            | Optional temporary credential      | Allowed only with the complete access-key pair.                                                                                                        |
| `MEDIA_OBJECT_MAX_READ_BYTES`       | S3 media storage                   | Shared read/write verification bound; integer from 1 KiB through 50 MiB, default 50 MiB.                                                               |
| `MEDIA_PROCESSING_VERSION`          | Ingestion worker                   | Cache/version key for media algorithms and security behavior; current default is `image-v1`. Bump when a recipe or validation rule changes output.     |
| `MEDIA_ACCESS_SIGNING_KEY`          | Web only                           | Separate HMAC key of at least 32 random bytes for five-minute preview URLs. Never reuse the connector encryption key.                                  |
| `TEMPORAL_ADDRESS`                  | Workflow worker                    | Temporal gRPC address; local default is `localhost:7233`.                                                                                              |
| `TEMPORAL_NAMESPACE`                | Workflow worker                    | Temporal namespace containing Market Me executions; local default is `default`.                                                                        |
| `TEMPORAL_CAMPAIGN_TASK_QUEUE`      | Workflow worker                    | Stable task-queue name shared by campaign starts and the worker; default `market-me-campaigns`.                                                        |
| `CAMPAIGN_COMMAND_BATCH_SIZE`       | Workflow worker                    | Ready outbox commands claimed per sweep; integer from 1 through 100, default 25.                                                                       |
| `CAMPAIGN_COMMAND_POLL_INTERVAL_MS` | Workflow worker                    | Delay between command-dispatch sweeps; minimum 100 ms, default 2,000 ms.                                                                               |

No current variable should use `NEXT_PUBLIC_`. Provider secrets, database URLs, encryption keys, session tokens, and authorization codes must never enter client props, browser bundles, logs, or model prompts.

## Campaign workflow operations

Run migration `0010_campaign_workflows.sql` before starting the workflow worker. The worker runs two coordinated loops: a Temporal activity worker on `TEMPORAL_CAMPAIGN_TASK_QUEUE`, and a dispatcher that claims `campaign_workflow_command` records. Start, pause, resume, cancel, approval-decision, and manual-completion commands use unique idempotency keys. Processing claims older than five minutes can be reclaimed; errors retry exponentially up to 15 minutes and become `dead_letter` after six claims.

Temporal workflow IDs are `campaign-<campaignInstanceId>`. Do not change this format without a migration/compatibility plan because command dispatch uses it to find running workflows. Workflow code must remain deterministic: time comes from Temporal, waits use workflow timers, and all PostgreSQL or provider I/O belongs in activities. Deploy incompatible workflow changes with Temporal versioning or patch markers before production histories exist.

Every non-wait, non-approval operation in 0.4 enters `manual_resolution`. Complete it from the campaign-instance UI/API with a JSON object containing the real external IDs, URLs, or other output. The output is persisted on the run/attempt and handed forward as `context["steps.<stepKey>"]`. Release 0.5 activities will replace selected manual handoffs only after capability and policy checks.

## Publishing and measurement operations

Migration `0011_publishing_measurement.sql` adds encrypted channel connections, publication actions, tracked links, measurement ingest keys, and normalized events. Release 0.5 reuses `CONNECTOR_TOKEN_ENCRYPTION_KEY` for Discord webhook URLs and `APP_BASE_URL` to form first-party tracking URLs; no new process variable is required. The workflow worker must receive both variables to execute publishing and tracked-link generation. If either is absent, the router returns a manual handoff instead of exposing or guessing credentials.

Create a Discord incoming webhook in the intended channel, then use Integrations → Publishing channels. Market Me accepts only `https://discord.com/api/webhooks/<id>/<token>` with no port, query, fragment, or embedded credentials; it immediately tests the endpoint and stores the URL as an AES-256-GCM envelope. The non-secret connection UUID shown in Integrations is supplied as `channelConnectionId` in a `publish_content` step’s input JSON. `content` is required; optional fields are `username`, `suppressNotifications`, `useTrackedLink`, and `appendDestination`. The template token `{{destinationUrl}}` is replaced with the tracked or canonical URL.

Discord execution uses `wait=true`, a 2,000-character content limit, and `allowed_mentions.parse=[]`. Rate-limit responses use provider retry timing; authorization/permanent failures become manual work; an unconfirmed server/transport outcome becomes `ambiguous` and is never resent automatically. Inspect publication status and the returned provider message link on the Campaign-instance page.

Create measurement keys under Integrations. The plaintext `mm_live_…` secret is shown exactly once; only its SHA-256 hash and display prefix persist. Send events to `POST /api/v1/measurement/events` with `Authorization: Bearer <secret>` and JSON fields `eventKey`, `eventType`, `source`, `occurredAt`, optional Campaign/Destination/publication IDs, optional numeric `value`/ISO currency, and bounded `properties`. `eventKey` is the caller’s replay key. Every referenced ID is validated against the key’s workspace.

Tracked redirects are `GET /r/<slug>`. They preserve the stored canonical URL, append only keys matching `utm_[a-z_]+`, record one aggregate visit event per request, set no cookie, and still redirect if measurement insertion fails. The Campaign-instance measurement endpoint/UI groups each normalized event type into count and numeric value; it does not claim cross-provider metric comparability.

## Desktop companion operations

Run migration `0012_desktop_companion.sql` before using Companion APIs. No new server environment variable is required: high-entropy pairing codes, worker tokens, lease tokens, and HMAC signatures are generated per operation. The worker bearer token itself is the symmetric job-signing key for that authenticated claim and is never stored in plaintext by the server.

Tauri v2 desktop development requires Rust plus the platform system dependencies. Windows uses the stable MSVC toolchain, Microsoft C++ Build Tools, and WebView2; this release was built with Rust 1.97.1 and Tauri 2.11.x. macOS requires current Xcode command-line tools. Linux requires the Tauri WebKitGTK/system packages for the target distribution and a Secret Service-compatible credential backend. The repository intentionally does not include signing certificates, private updater keys, or store credentials.

Use `/companion` in the authenticated web control plane to create a ten-minute one-time code. In the native app enter the control-plane origin, pairing code, and device name. Only HTTPS remote origins are accepted; `http://localhost` is allowed for development. The pair endpoint returns an `mm_worker_...` credential exactly once. Rust stores it under service `com.marketme.companion` and the worker UUID in Windows Credential Manager, macOS Keychain, or Linux Secret Service.

The native app heartbeats every 30 seconds and polls for work every 10 seconds while paired and unpaused. The server derives `disconnected` after 90 seconds. The local emergency-pause flag is stored in the Tauri application-data JSON file; workspace pause/resume/revoke is server state. Approved local folder selection validates one user-chosen canonical directory and stores only the local path. Heartbeat sends only `approvedFolderConfigured`, never the path or directory contents.

The preview accepts only `open_url` jobs in `assisted` or `confirm_before_submit` mode. Each claim lasts five minutes. The Rust executor verifies canonical HMAC, expiry, addressed worker, action/mode, credential-free HTTPS URL, exact hostname allowlist, and expected origin before opening the operating-system default browser. It records the job ID locally before opening so a completion-report retry does not repeat the action. There is no generic shell command, arbitrary filesystem read, Playwright sidecar, automatic browser submission, or background service in 0.6.0.

Release build outputs are beneath `apps/companion/src-tauri/target/release/`; `target/` is ignored. The verified Windows installer name is `Market Me Companion_0.6.0_x64-setup.exe`. Generate production artifacts in CI, sign the native package and updater metadata with protected release keys, and publish checksums. Do not distribute the local unsigned preview as a production build.

## Important globals and collections

- `globalThis.marketMeRepository` is a development-only hot-reload cache for one connection pool. Production does not assign it.
- `STORAGE_PROVIDERS` is the canonical connector tuple: Google Drive, OneDrive, SharePoint.
- `ORGANIZATION_ROLES` and `WORKSPACE_ROLES` are ordered immutable role vocabularies. `owner`, `admin`, and `editor` can mutate Smart Sources; all workspace roles can read.
- `GOOGLE_SCOPES` and `MICROSOFT_SCOPES` are private immutable least-privilege scope lists in the OAuth module.
- `SmartSourceWrite.locations[]` is an allow-list. Provider item IDs are authoritative; display paths are presentation only.
- SharePoint location IDs use `driveId:itemId`; OneDrive and Google Drive use the provider item ID. `root` is supported for Microsoft drive roots.
- Webhook target resources are canonical strings: `changes`, `me/drive/root`, or `drives/<driveId>/root`. Connector validation rejects other Microsoft Graph resource paths.
- Provider client-state/channel tokens are random 256-bit values. Only their SHA-256 base64url hashes are stored.
- `CONTEXT_PACK_STATUSES`, `CONTEXT_SOURCE_KINDS`, and `CONTEXT_FACT_STATUSES` are the canonical pack/source/fact vocabularies. Published version rows are immutable even though the stable pack can later be archived.
- `ContextPackDraftWrite.sources[]` uses stable client UUIDs so facts and authority rules can reference sources before rows are persisted.
- `ContextPackDraftWrite.authorityRules[]` maps a `factKey` to ordered preferred source IDs. A rule is applied only when it identifies an agreeing authoritative value; otherwise the fact remains conflicted.
- `ContentPackageWrite.contextPackVersionIds[]` captures published version UUIDs, never mutable pack IDs.
- Active unresolved evidence has `provenance = 'unresolved'` and no `supersededByEvidenceId`. A correction appends new evidence and points the historical row at it.
- Companion protocol constants are `COMPANION_PLATFORMS`, `COMPANION_ARCHITECTURES`, `COMPANION_ACTIONS`, `COMPANION_ACTION_MODES`, `COMPANION_JOB_STATUSES`, `COMPANION_WORKER_STATUSES`, and `COMPANION_HEALTH_STATES`. TypeScript unions derive from these tuples.
- `LocalConfiguration.executedJobIds[]` is a bounded local replay guard capped at 100 UUIDs. It is not server authority; the database job state and claim-token hash remain authoritative for completion.
- `CompanionJobEnvelope.schemaVersion` is currently `1`. Canonical JSON sorts every object key recursively before HMAC so TypeScript and Rust produce identical bytes.
- JSON API responses use `{ data, meta? }` on success and `{ error: { code, message, fields? } }` on failure.

Avoid other mutable module globals. Inject repositories, clocks, ID generators, connectors, and model clients into services as later releases add them.

## Data and migration rules

- All tenant queries resolve membership before data access; client-supplied workspace IDs are never authorization proof.
- Mutable Smart Sources increment `version`; configuration changes and creation append audit events.
- Session and OAuth state store token hashes, not bearer values. OAuth state is consumed by `DELETE ... RETURNING`, making it single-use.
- `connector_cursor.scope_key` is `smart-source:<sourceId>:<providerLocationId>`. Google stores page tokens; Microsoft stores full trusted Graph delta links.
- `source_item` is the normalized metadata index. `ingestion_event` uses stable source-scoped idempotency keys so page replay is safe.
- `webhook_subscription` stores provider channel identity, resource identity, hashed client state, expiry, renewal attempts, and last delivery/error state.
- `webhook_event` is a durable hint queue. `(webhook_subscription_id, provider_event_id)` is unique; workers claim ready rows with `FOR UPDATE SKIP LOCKED`, reclaim abandoned processing rows after five minutes, reconcile through cursors, and exponentially retry up to six attempts before dead-lettering.
- `context_pack_version` is updated only while `draft`; publish supersedes the prior version and later edits create the next draft by cloning the published snapshot.
- `content_package`, `content_asset`, `evidence_item`, and `evidence_conflict` are written together after extraction. Package status remains `needs_review` while an open conflict or active unresolved evidence exists.
- `learning_review` is append-only. Conflict selection, corrected claims, and package approval record the actor and source package; historical evidence is retained.
- Migrations `0005` through `0009` add Context Packs, package/extraction persistence, processing status, Learning Review, and evidence supersession respectively.
- Migration `0012_desktop_companion.sql` adds pairing codes, browser workers, and local jobs; `(workspace_id, worker_id)` is enforced by a composite foreign key and worker deletion cascades its jobs.
- Migration filenames are immutable after application. Add a new migration instead of editing an applied file.
- PostgreSQL 18 stores its versioned data directory beneath the mounted `/var/lib/postgresql` volume.

## Release 0.7 media operations

The ingestion worker, web server, and workflow worker must share `MEDIA_STORAGE_ROOT`. npm workspace scripts execute with an app workspace as the current directory, so the repository development value is `../../.market-me/media`, which resolves to the root ignored directory from `apps/worker`, `apps/web`, and `apps/workflow-worker`. Use an absolute mounted path in containers and production. Do not point this variable at a repository source directory, a user home directory, or a broad shared volume.

The local directory has two namespaces:

```text
originals/<64-character-source-sha256>/source
derivatives/<64-character-source-sha256>/<processing-version>/<recipe-sha256>.webp
```

`FileSystemObjectStore` validates this grammar, resolves the final path beneath the configured root, creates parent directories, and writes with exclusive-create mode. An existing key is reused only when its bytes hash identically. Runtime objects are ignored by Git. Production should replace this adapter with encrypted/versioned S3-compatible storage while preserving key and immutability semantics.

`MediaProcessor.process()` performs these bounded stages: non-empty/size validation, best-effort magic-number detection, declared/detected MIME comparison, SHA-256 identity, immutable original write, malware-scanner call, supported text extraction or Sharp image inspection, and deterministic derivative creation. The default `UnconfiguredMalwareScanner` deliberately returns `not_configured`; it is appropriate only for development fixtures. Install a real scanning adapter before accepting untrusted production uploads.

Preview access is server-generated. `createAssetPreviewUrl()` signs `<assetId>.<expiry>` with HMAC-SHA-256. `/api/v1/assets/[id]/content` accepts only a valid signature that is unexpired and no more than five minutes in the future. It retrieves the object key from PostgreSQL, never from request input. Inline rendering is limited to JPEG, PNG, WebP, AVIF, and GIF; other MIME types download as `application/octet-stream` with `nosniff` and a restrictive content security policy.

Image review uses `PATCH /api/v1/content-packages/[packageId]/assets/[assetId]` with `workspaceId`, optional `altText`, `decorative`, and optional `notes`. Only workspace writers may change an original image. Informative images require non-empty reviewed text; decorative images store no alt text. `approveContentPackage` rechecks `alt_text_status` in PostgreSQL and fails while any asset is `needs_review`.

Migration `0013_media_accessibility.sql` is additive. It adds asset lineage, object, byte, processing, recipe, scan, rights, and accessibility columns plus targeted indexes. Existing rows default to explicit unsupported/not-configured/unchecked/not-applicable states. Do not backfill them to success states without reprocessing and evidence.

## Release 0.8 Campaign-to-companion operations

Author an attended Campaign step with `desiredCapability: "open_url"` and `executionMethods: ["user_assisted", "manual_handoff"]`. Provide `inputs.targetUrl` or select a published Destination, provide short `inputs.instructions`, and set `inputs.companionWorkerId` when more than one compatible desktop is online. Activation fails early if the selected companion is absent, paused, stale, attention-required, or lacks `assistedOpenUrl`.

The workflow worker must run with the same PostgreSQL and Temporal configuration as earlier Campaign releases. No new environment variable is introduced in 0.8. `CampaignExecutionRouter` creates an idempotent Campaign-bound `browser_job`; the companion claims it through the existing signed five-minute lease. On success, `CompanionRepository.completeJob` writes the `manual_step_completed` outbox command. Keep the workflow-command dispatcher running so that command can signal the waiting Temporal execution.

Migration `0014_campaign_companion_routing.sql` is additive and checksum guarded. It adds two Campaign foreign keys, an all-or-none binding check, a unique step-run index, and lookup indexes. Do not edit it after application. Before rollback, stop the 0.8 workflow worker and companion polling, allow claimed jobs to finish or expire, and inspect pending Campaign-bound jobs/commands. A 0.7 server can retain the additive columns but cannot automatically resume a Campaign from companion completion; manually resolve or cancel affected instances before running 0.7 workers.

Release verification must cover: activation with one healthy worker; rejection with zero or ambiguous workers; stable job idempotency; exact hostname narrowing; Campaign/step ownership validation; signed claim; successful completion creating exactly one workflow command; replay rejection; and the existing Temporal manual-completion signal path. The Companion operator page labels Campaign-bound and test jobs separately.

## Release 0.9 local-source operations

Pair and heartbeat a 0.9 companion, choose an approved folder in the native dialog, then create a local Smart Source and select that companion. The server-visible label is fixed; do not enter or copy the local path into the web UI. Use the companion's **Sync approved folder** action to send a manifest and requested changed content. The Smart Source test reports worker readiness and indexed file count; its discovered-item list distinguishes awaiting content from content received.

The web server and ingestion worker must share `MEDIA_STORAGE_ROOT`. Local uploads are limited to 10 MiB and manifests to 5,000 regular files; the native scanner skips symlinks, empty files, and larger files. The companion does not continuously watch in 0.9: run sync deliberately after changes. The normal worker must run after upload to apply stabilization and create Content Packages.

Run `npm run qa:local-ingestion` with local PostgreSQL and the web environment configured. It creates a disposable workspace/worker/local source, starts the web control plane, sends an authenticated manifest, uploads the requested text bytes, runs the ingestion worker once, verifies exact extracted text and object-key persistence, and deletes the exact database fixture. Content-addressed QA bytes remain in the ignored development cache.

Migration `0015_local_source_ingestion.sql` is additive and checksum guarded. Before rollback, stop 0.9 companions and the ingestion worker, process or explicitly ignore pending local events, and preserve source-item keys and immutable objects. A 0.8 process cannot request local bytes or read `source_item.object_key`; retain rows for forward recovery and disable affected local Smart Sources before running it.

## Release 0.10 foreground-monitoring operations

Choose Off, Every minute, Every 5 minutes, Every 15 minutes, or Every hour in the attended companion. Monitoring runs only while the companion window/process is open, paired, unpaused, and configured with an approved folder. Manual sync remains available. The UI displays the last successful sync time; failures remain visible and do not advance that timestamp.

No migration or environment variable is introduced. Existing 0.9 server APIs and object data are compatible. Rollback to 0.9 removes the timer/status controls but leaves local-source state intact. Stop the 0.10 companion before replacing it so no foreground sync is active.

## Release 0.11 document-extraction operations

No migration or new environment variable is introduced. Install dependencies through the root workspace lockfile; `@market-me/media` owns PDF.js 6 and Yauzl 3. The worker continues to use `MAX_SOURCE_DOWNLOAD_BYTES`/the local 10-MiB upload cap before the parser-specific limits. Do not increase parser ceilings without measuring worst-case CPU/memory and updating security/release documentation.

Supported server MIME values are `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. Add them to a Smart Source allowlist as needed; new Smart Sources include them by default. The companion maps only `.docx`, `.pptx`, and `.xlsx`, while the server verifies OOXML structure and internal content type.

Run `npm run test --workspace=@market-me/media` for real generated PDF/OOXML fixtures, page/text truncation, no-text PDF, malformed MIME/package, and ZIP-bomb coverage. Run `npm run test --workspace=@market-me/ingestion` for review propagation, then the full `npm run check`. For manual PDF QA, use the bundled ReportLab/PDF.js fixture path, render with Poppler, visually inspect the PNG, and remove `tmp/pdfs` after the check.

Rollback to 0.10 requires stopping 0.11 ingestion workers before replacing code. Existing `document-v1` asset rows and immutable originals remain readable, but 0.10 will not regenerate their text. Do not delete content-addressed originals; keep incomplete/failed parser states for audit and future reprocessing.

## Testing and release checks

1. Unit-test domain policies and connector cryptographic/URL contracts.
2. Run repository integration tests with a disposable development database and exact fixture cleanup.
3. Exercise unauthenticated, authenticated, foreign-workspace, create, update, and test APIs.
4. Inspect authenticated UI routes in a browser and verify console errors, overflow, and form states.
5. Run `npm run check` before each release milestone.
6. With a public HTTPS test deployment, verify Google sync/change headers and Microsoft validation-token/client-state flows; local tests use redacted provider-shaped fixtures.
7. Verify published Context Pack immutability, captured version IDs, conflict/correction blockers, and approval transitions with PostgreSQL integration tests.
8. Verify one-use pairing, hash-only worker authentication, heartbeat, signed lease, idempotent job creation, completion replay rejection, pause-blocked claims, and the shared TypeScript/Rust HMAC vector with PostgreSQL and native tests.
9. On each supported desktop target, run the native compile, render the bundled UI, pair a disposable worker, execute the approved test action, select a disposable local folder, and validate installer/signature/update behavior. Release 0.6.0 completed the Windows x86_64 subset; macOS and Linux remain release-expansion gates.
10. Verify media magic-number mismatch rejection, maximum byte limits, immutable retry behavior, deterministic recipe/object keys, signed-link expiry and asset binding, derivative lineage, and accessibility approval blocking. Browser QA must load each preview through the signed route and confirm no horizontal overflow or alert state.
11. Verify PDF/OOXML extraction with real fixtures, encrypted/malformed/no-text/resource-limit states, internal OOXML type validation, review blocking for truncated output, and companion MIME mapping.

Live Google/Microsoft activation additionally requires registering the exact callback URLs documented in `.env.example` and completing provider consent in a test tenant/account.

## Documentation rule

Every schema, environment variable, controlled vocabulary, connector scope/capability, API contract, security behavior, or release behavior change must update the relevant `docs` file in the same change. Synchronize stakeholder-significant milestones into the Google Doc development tabs.

## Release 0.12 profile operations

Run migration `0016_brand_audience_profiles.sql` before starting 0.12 web processes. It adds the two profile root/version pairs, exact Campaign profile bindings, indexes, uniqueness constraints, and foreign keys. The migration is additive and checksum guarded.

Operator flow:

1. Open **Audience** and create a Brand Profile and/or Audience Profile.
2. Save a draft, review the structured identity/audience fields and optional communication controls, then publish the version.
3. Open a Campaign draft and select the exact published Brand/Audience versions. Historical Campaign pins remain visible as a generic pinned historical version after a profile successor is published.
4. Choose Campaign information depth and promotional strength. A value above any selected profile ceiling returns HTTP 422 with the named profile source; lower the setting or publish an authorized successor profile.
5. Publish the Campaign. The exact UUID bindings remain attached to that Campaign version even if profile successors are later published.

Important implementation surfaces are `packages/database/src/profile-repository.ts`, `packages/domain/src/policies.ts`, `apps/web/src/server/profile-schema.ts`, the `/api/v1/brand-profiles` and `/api/v1/audience-profiles` routes, and the `/audience` operator pages. Repository writes emit `brand_profile.*` and `audience_profile.*` audit events.

Verification uses `profile-repository.integration.test.ts` for immutable publication, cross-workspace rejection, exact Campaign retention, ceiling enforcement, and audit events. The browser QA path creates/publishes both profile types, confirms exact Campaign selectors, observes the named 422 ceiling error, publishes a compliant Campaign, and then deletes the exact QA records.

Rollback to 0.11 is application-only: stop 0.12 web/workers, deploy 0.11, and retain migration 0016/profile rows for forward recovery. Do not edit profile-bound Campaigns under 0.11 because that code cannot preserve new pins or enforce their ceilings. Resume profile/Campaign authoring only after 0.12 is restored.

## Release 0.13 Draft-generation operations

Run migrations `0017_governed_drafts.sql`, `0018_draft_evidence_delete_semantics.sql`, and `0019_draft_evidence_binding_cascade.sql` before starting 0.13 web processes. They add immutable generation/Draft/version/claim/approval storage and finalize deletion semantics so evidence linkage remains navigable while tenant-wide cascading cleanup remains possible. Migrations are additive and checksum guarded.

Operator flow:

1. Approve a Content Package with at least one active resolved evidence item.
2. Bind it to a Campaign, optionally pin Brand/Audience Profile versions, choose information depth/promotional strength, and publish the Campaign version.
3. Open **Drafts**, select the published Campaign and one of its approved bound packages, then generate. One variant appears per pinned Audience Profile; a Campaign without audience pins creates one general variant.
4. Open a variant to inspect exact claims, evidence provenance/source references, presentation-only call to action, generator/prompt identity, and captured package version.
5. Submit the exact immutable version. An owner/admin/approver decides it in **Approvals**. Approval, rejection, and requested changes are audited.

Important implementation surfaces are `packages/generation/src/index.ts`, `packages/database/src/draft-repository.ts`, migrations 0017-0019, `/api/v1/drafts`, `/api/v1/draft-approvals`, `/drafts`, and the unified `/approvals` page. Generator constants and every structured dictionary are documented in `DOMAIN_MODEL.md`; do not silently change them without a new generator/prompt version and evaluation fixture.

Live acceptance fixtures use the development workspace and exact `QA ... 0.13` names. Run `$env:DATABASE_URL=...; npm run qa:governed-drafts -- seed`, complete browser checks, then run `npm run qa:governed-drafts -- clean`. The clean path deletes Drafts/generations before their restricted Campaign/Package/Profile references and verifies no fixture retention manually or in the calling QA job.

Verification covers generation unit tests, a live PostgreSQL integration test for exact snapshot retention and approval/audit transitions, authenticated browser generation/trace/submit/approve flow, desktop and 430-pixel mobile layouts, console logs, the full `npm run check`, and the Windows companion bundle. Rollback to 0.12 is application-only: retain all new tables/rows and do not delete referenced Campaign, package, profile, or evidence records until 0.13 is restored.

## Release 0.14 Draft-format and revision operations

Run additive, checksum-guarded migration `0020_draft_formats_and_revisions.sql` before starting 0.14 web processes. It adds `draft_generation.draft_format`, predecessor/change-note fields on immutable Draft versions, one-general-variant uniqueness, and the source-version lookup index.

Operator flow:

1. Choose one of the seven Draft formats during governed generation. The server selects whole evidence claims under the format character ceiling; it never clips factual text.
2. Submit version 1. If a reviewer requests changes, include actionable decision notes.
3. Open the Draft and edit only the lead-in, call to action, hashtags, alternative text, and required change note. The lead-in cannot contain sentence-ending punctuation because it is presentation framing, not a factual assertion.
4. Create the successor. The server supersedes the predecessor and clones its exact factual claims/evidence into a new working version with an explicit predecessor pointer.
5. Inspect, submit, and approve the exact successor version. Historical versions remain immutable and auditable.

The format constants and character-limit dictionary live in `packages/generation/src/index.ts`; the closed tuple and types live in `packages/domain`; repository enforcement lives in `packages/database/src/draft-repository.ts`; request schemas live beside the Draft Route Handlers. `DraftValidationError` is the structured HTTP 422 contract for unsafe framing, invalid hashtags, illegal state, missing facts, and character overflow.

Verification covers complete-claim selection under the short-format ceiling, a live PostgreSQL request-changes/revise/resubmit/approve sequence, unsafe lead rejection, exact predecessor fact/evidence equality, authenticated desktop/mobile browser QA, empty console diagnostics, the full `npm run check`, and the Windows installer. Use the 0.13-named governed-Draft fixture command until its stable fixture contract is versioned separately; always run `clean` after acceptance.

Rollback to 0.13 is application-only: stop 0.14 web processes, preserve migration 0020 and all predecessor/successor rows, and do not create or decide successors until 0.14 is restored. Version 0.13 can read the older core columns but cannot enforce or display the new format and revision lineage.

## Release 0.15 channel-preview operations

Run additive checksum-guarded migration `0021_draft_channel_previews.sql` before starting 0.15 web processes. It adds immutable exact-version preview snapshots plus Draft and Channel Connection indexes.

Operator flow:

1. Generate, review, and approve an exact Draft version.
2. Keep at least one tested active Channel Connection; optionally publish a canonical Destination in the registry.
3. Open the approved Draft, select the Channel Connection and optional Destination, and create an exact preview. No provider request is made.
4. Inspect rendered sections, provider capability version, character count/limit, validation issues, and ready/blocked state.
5. If connection capabilities are retested or changed, the preview becomes stale. Rerender it before any later delivery workflow consumes it.

Important surfaces are `packages/connectors/src/channels.ts`, `DraftRepository.createChannelPreview/listChannelPreviews`, migration 0021, `/api/v1/drafts/:id/previews`, and `DraftChannelPreviews`. Stored `capability_snapshot` is non-secret manifest data; encrypted connection credentials are never selected into, passed to, or stored by this flow.

Verification covers pure renderer composition/overflow tests, live PostgreSQL approval/preview/audit/staleness behavior, authenticated browser rendering with a canonical Destination, stale-to-refreshed transition, database proof that no credential field leaked, desktop/mobile layouts, empty browser diagnostics, full `npm run check`, and native bundling. The governed-Draft QA command also creates an inert non-delivery preview fixture connection and removes it during `clean`.

Rollback to 0.14 is application-only: stop 0.15 web processes, retain migration 0021 and preview/audit rows, and do not create or consume previews until 0.15 is restored. Channel connections, Destinations, and Draft approvals remain otherwise compatible.

## Release 0.16 exact-preview execution operations

No schema migration is required. Author a successor Campaign version after creating the approved channel preview, select the same published Destination, configure a `publish_content` step, and set `inputs` to `{ "draftChannelPreviewId": "<uuid>" }`. Do not combine it with `appendDestination` or `useTrackedLink`; the Channel Connection is inferred from the preview unless an identical explicit ID is supplied.

Activation validates workspace, originating Campaign root, current approved Draft version, ready/fresh capability snapshot, connection, and exact Destination before creating the Campaign instance/start outbox command. The workflow worker repeats freshness and approved-version validation immediately before provider handling. A drifted preview returns manual-required without provider I/O or a publication action.

Verification covers successful successor-Campaign activation, one instance/one start command, exact target content/version/connection resolution, stale activation rejection without a second instance, exact worker request snapshots, stale runtime no-I/O behavior, browser authoring guidance and named validation, desktop/mobile layouts, empty diagnostics, full release checks, and native bundle.

Rollback to 0.15 is application-only. Stop 0.16 workflow workers first, retain Campaign versions/instances/commands, and do not activate preview-backed steps under 0.15 because that worker cannot resolve their content. Existing plain `inputs.content` publication steps remain schema-compatible.

## Release 0.17 guided-preview authoring operations

No migration is required. Create the exact approved channel preview first, open the same Campaign, select the matching Campaign Destination, set the step operation to `publish_content`, and choose the preview by audience, headline, Channel Connection, Destination, and readiness label. The panel displays exact rendered content, source Campaign version, provider, character count/limit, and any reason the option is unavailable.

Important code surfaces:

- `DraftRepository.listCampaignPreviewOptions(workspaceId, campaignId)` supplies the same-Campaign server read model;
- `StoredCampaignPreviewOption` documents the serialized field contract;
- `assessCampaignPreview(option, destinationId)` returns deterministic `eligible` and `reasons` values for unsaved form state;
- `readDraftChannelPreviewId` and `writeDraftChannelPreviewId` parse/update the advanced-input object without hiding non-conflicting keys;
- `CampaignPreviewPicker` renders the select, eligibility state, exact content, and polite accessibility updates;
- `CampaignForm.previewOptions` is optional for new Campaigns and populated by the edit page after workspace authorization.

Selecting a preview automatically removes post-approval Destination/tracked-link mutation and Channel Connection override fields. The advanced JSON editor remains visible for unrelated connector inputs. Save and publish normally; activation/runtime validation remains unchanged and authoritative.

Verification covers three pure picker tests, the live Campaign-scoped PostgreSQL read model, persisted browser selection, preservation of an unrelated `custom` field, automatic conflict removal, Destination mismatch and forced-capability-staleness explanations, desktop and 430px mobile layout, no horizontal overflow, clean browser diagnostics, 88 TypeScript tests, 47-page web build, native checks, and three Rust tests.

Rollback to 0.16 is application-only. No data conversion is required: `draftChannelPreviewId` remains the same stored step-input contract. Operators lose the guided picker and must not hand-edit preview IDs without independently checking exact Destination and freshness.

## Release 0.18 approved tracked-preview operations

Apply additive migration `0022_approved_tracked_previews.sql`. Configure `APP_BASE_URL` to the externally reachable first-party origin. On an approved Draft, select a published Destination and “First-party tracked URL,” render, inspect the exact `/r/{slug}` content/count, then choose that tracked option in the Campaign picker. Do not set `useTrackedLink`; the preview already contains the approved URL.

Important fields are `linkMode`, `trackedLinkId`, `trackedLinkSlug`, `trackedLinkStatus`, `draftChannelPreviewId`, and runtime `draftPreviewTrackedLinkId`. Refresh reuses the slug. Preview deletion cascades its reserved link. Disabled/expired/missing links make the option ineligible and block activation/runtime before provider I/O.

Verification covers canonical/tracked coexistence, slug reuse, fixed attribution, exact worker ledger content, active-link activation, disabled-link rejection without a second instance, 302 redirect with UTM query, desktop/mobile UI, 88 TypeScript tests including ten live PostgreSQL tests, 47-page build, native checks, and three Rust tests.

Rollback to 0.17 is data-preserving: stop 0.18 web/workflow workers, retain migration/link rows, and do not render or execute tracked-mode previews until 0.18 is restored.

## Release 0.19 exact image-attachment operations

Apply additive migration `0023_draft_preview_assets.sql`. Configure the web, ingestion worker, and workflow worker with the same `MEDIA_STORAGE_ROOT`; npm workspace processes use `../../.market-me/media`, which resolves to the repository's ignored `.market-me/media` directory. Use an absolute mounted path in deployment. Do not copy object bytes into environment variables or PostgreSQL.

Important fields and collections:

- preview POST `assetIds: string[]` is ordered, unique, and limited to ten;
- `StoredDraftPreviewAsset[]` is the immutable serialized delivery manifest;
- capability `limits.attachmentsPerMessage`, `attachmentBytes`, and `attachmentDescriptionCharacters` plus `features.attachments` are server authority;
- `PublishContentInput.attachments` contains runtime-only byte arrays;
- `publication_action.request_snapshot.attachments[]` contains IDs/hashes/filenames/MIME/size and governance states, never bytes;
- `MEDIA_STORAGE_ROOT` is the only new workflow-worker runtime dependency and must reference the same immutable object namespace used during ingestion.

The Draft page lists processed channel-compatible images from the exact generation package. Originals remain visible but blocked when only a processed derivative is publishable. `not_configured` scan and `unchecked` rights are visibly labeled development dispositions; production rollout must replace them with configured scanner and rights policy gates.

Verification covers migration/application, unique/count/type/size/accessibility/safety/rights checks, derivative alt-text inheritance, multipart field construction, exact byte/hash worker validation, missing-object no-I/O behavior, live PostgreSQL Campaign resolution, desktop/mobile browser acceptance, 92 TypeScript tests, 47-page build, native checks, three Rust tests, and the NSIS hash recorded in `RELEASES.md`.

Rollback to 0.18 is data-preserving. Stop 0.19 workflow workers first, retain migration 0023 and object data, and block attachment-bearing previews until 0.19 returns. Do not delete shared immutable objects as part of application rollback.

## Release 0.20 live Discord preflight operations

No schema migration or new environment variable is required. A Discord Channel Connection should be explicitly tested so its non-secret `webhookId`, `guildId`, and `channelId` are saved. Older connections without identity keys adopt them after their first successful Release 0.20 preflight.

Worker order is operationally significant: resolve exact target; inspect the idempotency ledger; validate immutable media bytes/hashes; decrypt the webhook; GET and verify the live provider target; refresh connection health; begin/retry the action; then POST. Do not move provider preflight ahead of prior succeeded/ambiguous handling, and do not move credential/network access ahead of exact media validation.

Important code surfaces are `PublishingRepository.getPublicationActionByIdempotencyKey`, `executePublication`, `sameProviderTarget`, `DiscordWebhookConnector.testConnection`, and the `providerPreflight.targetIdentity` request-snapshot field. The target dictionary is non-secret; the webhook credential remains encrypted at rest and transient in worker memory only.

Verification includes successful-preflight multipart delivery, provider 404/no-action behavior, guild/channel drift/no-action behavior, prior-success and ambiguity no-network behavior, full lint/test/typecheck/build/native checks, the 47-page production web build, and three Rust tests. The unsigned installer and SHA-256 are recorded in `RELEASES.md`.

Rollback is application-only. Stop Release 0.20 workflow workers before starting 0.19 workers; retain every connection, preview, and publication ledger row. Release 0.19 remains schema-compatible but lacks the immediate webhook identity check.

## Release 0.21 Campaign success-criteria operations

Apply additive migration `0024_campaign_success_criteria.sql`; it adds `campaign_version.success_criteria jsonb NOT NULL DEFAULT '[]'` plus an array-shape constraint. No environment variable or worker deployment change is required. Rerunning the migration must skip cleanly.

Important constants, values, and collections:

- `MEASUREMENT_EVENT_TYPES` is the authoritative 24-value tuple;
- `CampaignSuccessCriterion[]` is ordered, contains at most 20 items, and is immutable after Campaign publication;
- `id` is a stable lowercase key, `eventType` chooses one normalized event, and `targetCount` is a positive bounded integer;
- `evaluateCampaignSuccess` returns `{ criteria, allCriteriaMet }`, where every result adds `currentCount` and `met`;
- `MeasurementSummary` retains `totals`, `firstEventAt`, and `lastEventAt` and adds exact-version `criteria` plus `allCriteriaMet`.

Use the Campaign create/edit form to add goals before publishing. Existing measurement ingest keys and `/api/v1/measurement/events` populate progress; no new endpoint is needed. A successor draft may revise future criteria, but an activated instance always evaluates its pinned published version.

Verification covers schema defaults/duplicates/bounds, pure missing/partial/met evaluation, live PostgreSQL version persistence and exact-instance aggregation, create/edit/publish/activate browser acceptance, desktop no-overflow layout, clean browser diagnostics, 97 TypeScript tests, 47-page build, native checks, three Rust tests, migration idempotency, and the NSIS artifact recorded in `RELEASES.md`.

Rollback to 0.20 is data-preserving: stop 0.21 web processes, retain migration 0024, and avoid saving Campaign drafts in 0.20 when their success criteria must be preserved because the older form does not round-trip that field.

## Release 0.22 measurement-key lifecycle operations

No migration or environment variable is required; migration 0011 already includes `status` and `revoked_at`. Create a replacement key on Integrations, copy/deploy its one-time secret, verify the external integration, then revoke the retired key. Plaintext recovery and un-revocation are intentionally impossible.

Important functions and fields:

- `createMeasurementKey` writes the hash-only key plus `measurement.key.created` audit transaction;
- `revokeMeasurementKey` scopes by workspace/id/active status, stamps `revokedAt`, and writes `measurement.key.revoked` atomically;
- `authenticateMeasurementKey` accepts only active hashes and updates `lastUsedAt` on success;
- `DELETE /api/v1/measurement/keys/[id]` requires workspace write access;
- `MeasurementKeyForm.keys` renders active/revoked history and keeps the one-time `secret` only in transient component state.

Verification covers successful authentication before revoke, immediate rejection after revoke, idempotent second-revoke failure, lifecycle timestamps, both audit events, full 97-test/live-database gate, 47-page build/new route, browser create/revoke/history/no-overflow acceptance, clean diagnostics, fixture cleanup, native checks, three Rust tests, and the NSIS hash in `RELEASES.md`.

Rollback to 0.21 is application-only. Retain all key/audit rows; 0.21 continues to reject revoked keys because authentication already filters active status, but operators lose revocation UI/API until 0.22 returns.

## Release 0.23 currency-safe goal operations

No migration or environment variable is required. Release 0.23 extends the JSON contract already stored in `campaign_version.success_criteria`; historical objects without `metric` remain count criteria.

Important values and collections:

- `CampaignSuccessCriterion[]` contains at most 20 ordered count/value union members;
- `metric` is `count` or `value`; count uses bounded integer `targetCount`, while value uses positive finite `targetValue` plus uppercase three-letter `currency`;
- `MeasurementSummary.totals` includes counts and currency-null values only;
- `MeasurementSummary.currencyTotals` is a sparse nested dictionary keyed first by event type and then exact currency;
- `evaluateCampaignSuccess` returns a discriminated `CampaignSuccessEvaluation[]`, so consumers must narrow `metric` before reading current/target fields.

Use measurement event `value` and `currency` together for monetary goals. Never omit currency for money, pre-convert values without an explicit upstream accounting rule, or add `totals` and `currencyTotals`. Currency-null values are retained for non-monetary/unit telemetry and cannot satisfy a currency criterion.

Verification covers legacy normalization, schema bounds/currency casing, pure USD/EUR isolation, live PostgreSQL exact-instance aggregation, count/value Campaign authoring, published-version activation, separate browser totals/progress, no-overflow and clean diagnostics, 98 TypeScript tests, 47-page build, native checks, three Rust tests, QA cleanup, and the NSIS artifact recorded in `RELEASES.md`.

Rollback to 0.22 is application-only, but 0.22 must not edit Campaign drafts containing value criteria or be trusted to report their progress. Preserve the JSON and restore 0.23 before authoring or evaluating those Campaigns.

## Release 0.24 scoped measurement-key operations

Apply and checksum `0025_measurement_key_scope_expiry.sql`. It adds `allowed_event_types text[] NOT NULL`, optional `expires_at`, a closed-membership/cardinality constraint, and an active-expiry partial index. Rerunning migrations must skip it without change.

Important functions and fields:

- `createMeasurementKey(..., { allowedEventTypes, expiresAt })` deduplicates/revalidates scope, requires future expiry, and atomically stores the key/audit;
- `StoredMeasurementKey.status` derives expired without mutating the persisted active/revoked transition;
- `authenticateMeasurementKey` returns `MeasurementKeyPrincipal` only for an active/unexpired hash and includes its event allowlist;
- `/api/v1/measurement/events` parses the event and returns 403 before repository insertion when the principal does not include that event type;
- `MeasurementKeyForm` resets to all 24 event types/no expiry after creation and never retains a prior secret during later lifecycle actions.

Operationally, create narrowly scoped replacements, copy/deploy the one-time value, exercise an allowed event, confirm a disallowed event fails, then revoke the old key. Monitor database clock health because expiration uses PostgreSQL `now()`.

Verification covers legacy defaults, unique/closed scopes, future/past expiry validation, live principal/list/expiry behavior, migration idempotency, browser 403/202/401 enforcement, scope/expiry/derived-status UI, no-overflow and clean diagnostics, 101 TypeScript tests, 47-page build, native checks, three Rust tests, cleanup, and the NSIS hash in `RELEASES.md`.

Rollback is not authorization-compatible: 0.23 ignores both columns. Stop ingestion or revoke every restricted/expired key before deploying it; never run a 0.23 ingestion endpoint against keys whose scope or expiry is relied upon.

## Release 0.25 durable success-threshold operations

Apply and checksum `0026_campaign_success_signal.sql`; it extends the existing workflow-command check constraint with `success_criteria_met`. No environment variable or new service is required, but the Release 0.25 web/ingestion process and workflow worker must be deployed as a compatible set. Rerunning migrations must skip cleanly.

Important functions, fields, and collections:

- `PublishingRepository.recordMeasurementEvent` locks the exact instance, inserts the event, evaluates pinned criteria, and writes the stable transition command in one transaction;
- `CampaignSuccessSignal.criteria` is a readonly `CampaignSuccessEvaluation[]`; `measuredAt` is the accepted event time and `triggerEventKey` identifies the event that first observed the transition;
- `campaignSuccessReached` writes only the first value to `context["measurement.success"]` and deliberately does not change workflow status;
- `CampaignCommandDispatcher` sends the signal through the existing Temporal handle and throws for unknown command types;
- `MeasurementSummary.successTransition` reports the outbox status and timestamps separately from `allCriteriaMet`.

Operationally, keep the workflow worker running and monitor pending/processing age plus failed/dead-letter commands. A pending transition is durable and safe to retry; manually changing command status or its stable idempotency key can lose or duplicate operator-visible evidence. Do not infer Campaign completion from successful signal delivery.

Verification covers two distinct concurrent threshold events, event replay, one stable outbox row, exact trigger provenance, Temporal duplicate-signal idempotency, migration rerun, full 101-test/live-database gate, 47-page build, browser 2/2/pending/no-overflow acceptance, clean diagnostics, complete fixture cleanup, native checks, three Rust tests, and the NSIS hash in `RELEASES.md`.

Rollback requires stopping Release 0.25 ingestion and dispatch before starting 0.24. Retain migration 0026 and every success command. Drain them with 0.25 or leave them pending for a later 0.25 deployment; a 0.24 dispatcher must not claim them because it lacks the signal branch and could record false completion.

## Release 0.26 immutable success-action operations

Apply and checksum `0027_campaign_success_action.sql`; it adds non-null `campaign_version.success_action`, compatibility default `notify_only`, and a check constraint allowing only `notify_only` or `pause`. No environment variable or new service is required. Rerunning migrations must skip cleanly.

Important constants, values, and behavior:

- `CAMPAIGN_SUCCESS_ACTIONS` is the shared authoring/domain allowlist and `CampaignSuccessAction` is its union;
- `CampaignDraftWrite.successAction?` defaults at both schema and repository boundaries, while `CampaignVersion.successAction` is always explicit;
- the outbox payload copies the pinned action and never accepts it from measurement properties;
- `CampaignSuccessSignal.action?` permits Release 0.25 queue replay, normalizing absence to `notify_only`;
- explicit `pause` reuses `setInstanceState({ status: 'paused' })`, preserves first-signal idempotency, and remains compatible with the existing resume command.

Deploy web/ingestion and workflow workers as one Release 0.26 set. Monitor command delivery and paused Campaign age; notification completion and Campaign state are deliberately separate. An operator must explicitly resume or cancel. Do not use pause as provider cancellation because already-running activity boundaries are not preempted.

Verification covers schema default/closed values, published-version persistence, action-bearing concurrent threshold command, missing-action compatibility, Temporal success pause/query/resume, migration rerun, full 101-test/live-database gate, 47-page build, browser publish/activate/1-of-1/completed-delivery acceptance, direct Temporal context query, no-overflow/clean diagnostics, workflow cancellation, fixture cleanup, native checks, three Rust tests, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0027 but requires draining pause-action commands with 0.26 first. Release 0.25 treats the extra payload field as notification-only and its authoring path does not preserve `success_action`; do not run it against pause-configured drafts that may be saved.

## Release 0.27 Campaign-scoped measurement-key operations

Apply and checksum `0028_measurement_key_campaign_scope.sql`; it adds `measurement_ingest_key.campaign_scope_mode` and `measurement_ingest_key_campaign_scope`. No environment variable or new service is required. Rerunning migrations must skip cleanly.

Important fields, collections, and functions:

- `campaignScopeMode` is always `all` or `restricted`; the database defaults historical keys to `all` and constrains the stored value;
- `allowedCampaignIds` is a sorted `string[]` on stored/principal read models and a unique UUID array of at most 100 values on the creation schema;
- `createMeasurementKey(..., { allowedCampaignIds })` derives the mode, validates workspace ownership, inserts scope rows, and records non-secret audit data in one transaction;
- `isMeasurementCampaignAllowed(principal, references)` resolves every direct and indirect Campaign root and requires exactly one allowed result for restricted keys;
- `MeasurementKeyForm` stores selected IDs in component state, renders all/selected radio controls plus Campaign checkboxes, prevents a zero-selection restricted submission, and resets to all Campaigns after creation;
- `/api/v1/measurement/events` keeps the authorization order schema, event allowlist, Campaign scope, then complete reference validation/idempotent persistence.

Operationally, prefer one restricted key per external Campaign integration, deploy the one-time value, prove an allowed event, prove another Campaign and a missing-root event fail, then revoke the predecessor. Campaign deletion removes matching scope rows but intentionally leaves the key restricted; monitor and replace deny-all keys rather than changing their mode implicitly.

Verification covers unique/max/workspace scope validation, principal/list/audit hydration, allowed same-root multi-reference events, unlisted/no-root/conflicting-root denial, legacy all-Campaign compatibility, migration rerun, live 403/202/403/200/403 API behavior with exactly one event, browser history/authoring/disabled-state/no-overflow acceptance, full 101-test live-database gate, 47-page build, native checks, three Rust tests, complete fixture cleanup, and the NSIS hash in `RELEASES.md`.

Rollback is authorization-incompatible: Release 0.26 ignores both the mode and junction. Stop measurement ingress or revoke all restricted keys before deploying it. Preserve migration 0028 and restore Release 0.27 before re-enabling scoped integrations.

## Release 0.28 relationship-registry operations

Apply and checksum `0029_relationship_registry.sql`; it creates `relationship_contact` and `relationship_identity`. No environment variable, connector credential, worker, or background service is required. Rerunning migrations must skip cleanly.

Important constants, records, arrays, and functions:

- `RELATIONSHIP_STAGES`, `CONTACT_PERMISSIONS`, and `RELATIONSHIP_IDENTITY_STATUSES` are the shared closed runtime tuples; their TypeScript unions are derived, not duplicated;
- `RelationshipWrite` carries the writable contact fields and readonly identity/list collections; `StoredRelationship` adds generated IDs, suppression evidence, creator, and timestamps;
- `RelationshipRepository.listRelationships` and `getRelationship` attach provider identities and normalize nullable database fields to documented optional values;
- `saveRelationship(input, actorUserId, id?)` validates assigned-owner workspace membership and provider identity uniqueness, replaces the bounded identity set, persists suppression/restoration, and audits in one transaction;
- `relationshipWriteSchema` enforces UUIDs, closed values, HTTPS profile URLs, 0–1 confidence, unique provider/subject pairs, list/text bounds, and a required suppression reason;
- `/api/v1/relationships` supports authenticated list/create, `/api/v1/relationships/[id]` supports workspace-scoped read/update, and the Conversations/new/edit pages are server-rendered shells around the interactive relationship form.

Operationally, treat `contactPermission='suppressed'` as a hard future-outreach deny independently of stage. Do not infer identity linkage from similar names, handles, organizations, interests, or model output. Store only reviewed business context and use verified status only for evidence strong enough to support the exact provider subject.

Verification covers schema defaults and unsafe cases, owner tenant validation, duplicate identity denial, cross-workspace reads, create/suppress/restore audit order and data minimization, live 201/200/200/200/422/401 API behavior, browser allowed/suppressed/reason/provider/no-overflow rendering, clean diagnostics, migration rerun, 105 TypeScript tests including eleven live database tests, every type check, a 50-page build, native checks, three Rust tests, complete fixture cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0029. Stop relationship writes before deploying 0.27; records remain intact but invisible. Any future relationship-targeted execution must remain disabled until a 0.28-or-newer control plane can enforce contact permission.

## Release 0.29 conversation-inbox operations

Apply and checksum `0030_conversation_inbox.sql`; it creates `conversation_thread` and `conversation_message`. No provider credential, webhook, worker, or background service is required for manual threads and internal notes. Rerunning migrations must skip cleanly.

Important constants, records, collections, and functions:

- `CONVERSATION_STATUSES` and `CONVERSATION_MESSAGE_KINDS` are shared readonly runtime tuples; their TypeScript unions are derived rather than duplicated;
- `ConversationThreadWrite` carries relationship/provider/subject/state/owner input, while `StoredConversationThread.messages` is the readonly chronological detail collection and `latestMessage`/`messageCount` support bounded inbox summaries;
- `ConversationMessageWrite.metadata` is a readonly provider-neutral dictionary for bounded adapter metadata. Do not place credentials, access tokens, or unnecessary personal data in it;
- `ConversationRepository.saveThread` validates tenant relationship/owner references and exact provider/thread uniqueness, then writes non-sensitive audit evidence transactionally;
- `recordMessage` uses optional `providerMessageId` as an idempotency key and returns `undefined` for a replay; `addInternalNote` fixes the kind to `internal_note` and requires the authenticated actor;
- `conversationThreadWriteSchema` enforces UUIDs, closed status, assignment invariants, and provider/subject bounds; `internalNoteSchema` trims and bounds the body to 50,000 characters;
- `/api/v1/conversations` supports authenticated list/create, `/api/v1/conversations/[id]` supports read/update, and only `/api/v1/conversations/[id]/notes` creates a message from the web application. There is intentionally no send endpoint.

Operationally, adapter ingestion should supply stable provider thread/message IDs and treat a replay result as successful idempotent completion. Before adding any reply path, introduce a separate outbound-command/ledger contract and re-read the linked relationship's `contactPermission` immediately before provider I/O.

Verification covers schema assignment/body cases, tenant relationship/owner validation, duplicate provider-thread denial, provider-message replay, cross-workspace reads, internal-note actor enforcement/audit minimization, live 201/200/201/200/422/422/401 API behavior, browser inbox/detail/suppression/no-send/no-overflow acceptance, migration rerun, 109 TypeScript tests including twelve live database tests, every type check, a 52-page build, native checks, three Rust tests, complete fixture cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0030. Stop conversation and note writes before deploying 0.28; records remain intact but invisible. Keep outbound provider actions disabled until Release 0.29 or newer is restored.

## Release 0.30 handoff and deadline operations

Apply and checksum `0031_conversation_handoff.sql`; it adds `conversation_thread.response_due_at`, `follow_up_at`, and `conversation_handoff_brief`. No provider credentials, scheduler, worker, or external notification service is required. Rerunning migrations must skip cleanly.

Important constants, records, collections, and functions:

- `CONVERSATION_HANDOFF_STATUSES` is the shared closed runtime tuple and `ConversationHandoffStatus` its derived union;
- `ConversationHandoffWrite` is the bounded create contract; `ConversationHandoffBrief` adds lifecycle/actor/timestamp evidence;
- `StoredConversationThread.handoffs` is full chronological history on detail reads, while `activeHandoff` is hydrated on both list and detail reads for inbox triage;
- `responseDueAt`, `followUpAt`, and handoff `dueAt` are offset-aware ISO strings at API boundaries and optional timestamptz columns in PostgreSQL;
- `createHandoff` locks the same-workspace thread, rejects an existing open brief, inserts content, and writes minimized audit evidence in one transaction;
- `closeHandoff` accepts only `resolved | cancelled`, updates only the matching open workspace/thread/brief row, and records closer/time plus a minimized audit event;
- `/api/v1/conversations/[id]/handoffs` creates a brief and `/api/v1/conversations/[id]/handoffs/[handoffId]` closes it. Neither route creates a conversation message or external action.

Operationally, treat deadlines as explicit operator data until a later scheduler/business-hours policy exists. Monitor overdue rows directly if needed, but do not claim notifications are being sent. Handoff text may contain sensitive business context; keep it out of logs, audit dictionaries, analytics, and provider payloads.

Verification covers required/bounded brief text, ISO dates, close status, one-open enforcement, tenant thread scope, active/history hydration, resolve evidence, audit minimization, live 201/201/422/200/201/401 behavior, browser brief/history/deadline/no-send/no-overflow acceptance, migration rerun, 110 TypeScript tests including twelve live database tests, every type check, a 52-page build, native checks, three Rust tests, complete fixture cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0031. Stop deadline/handoff writes before deploying 0.29; rows and columns remain intact but invisible. No handoff record authorizes external delivery.

## Release 0.31 inbox-search operations

Apply and checksum `0032_conversation_triage_indexes.sql`; it adds only workspace-scoped status/provider/owner/activity and open-handoff due indexes. Rerunning migrations must skip cleanly and no data backfill is required.

Important query variables and behavior:

- `ConversationThreadQuery.search` and `provider` are optional bounded strings; `status` is a closed `ConversationStatus`;
- nullable `assignedOwnerId` distinguishes any owner (`undefined`), unassigned (`null`), and one exact user UUID;
- `handoff` is `open | none`, `deadline` is `overdue | upcoming | none`, activity bounds are ISO timestamps, and `limit` defaults to 100 with a hard maximum of 200;
- `conversationThreadQuerySchema` is the URL/API authority. The page and GET endpoint map owner aliases and inclusive date-only values before calling `listThreads(workspaceId, query)`;
- all dynamic SQL values are parameterized. Correlated message/handoff searches repeat workspace and thread identity, and returned threads still pass through the normal hydration boundary.

Operationally, use exact filters to narrow before broad message text on large workspaces. This release provides no relevance ranking, cursor pagination, saved search, or retention deletion. Do not advertise Campaign/topic/Destination/sentiment search until those concepts have explicit conversation links/classifications.

Verification covers query defaults/bounds, invalid dates/limits, message text, provider, status, exact owner/unassigned, handoff, deadline, activity, and empty-result behavior; live one-result filters plus 422/401; browser eight-control/URL-state/clear/no-overflow acceptance; migration rerun; 111 TypeScript tests including twelve live database tests; every type check; a 52-page build; native checks; three Rust tests; complete QA cleanup; and the NSIS hash in `RELEASES.md`.

Rollback leaves migration 0032 indexes in place. Release 0.30 ignores the new GET controls while using the same stored records.

## Release 0.32 conversation read-state operations

Apply and checksum `0033_conversation_read_state.sql`; it creates the membership-bound cursor table plus viewer and unread lookup indexes. It does not backfill rows: no cursor correctly means every non-self-authored message is unread. Rerunning migrations must skip cleanly.

Important records, variables, and functions:

- `ConversationReadState` documents one viewer/thread cursor; `StoredConversationThread.unreadCount` and optional `lastReadAt` are the hydrated read model;
- `ConversationThreadQuery.unread` is the repository boolean. The URL/API surface uses the closed string `read=unread | read`, then maps it only after `requireWorkspaceAccess` supplies `user.id`;
- `viewerUserId` is required whenever an unread predicate is requested. List/detail hydration uses it to exclude self-authored rows and read the correct cursor;
- `createdAt` is the unread clock because it represents database observation. `occurredAt` remains provider chronology and may legitimately predate the read cursor;
- `readStats` is the per-request collection of `{ conversationThreadId, lastReadAt, unreadCount }` produced only for the returned bounded thread IDs;
- `markRead` performs one membership/thread-scoped UPSERT with `now()` and `GREATEST`; it returns `undefined` rather than revealing a foreign or missing thread;
- `/api/v1/conversations/[id]/read` is an authenticated POST. The detail button invokes it explicitly and refreshes server state; page/detail GETs are side-effect free.

Read receipts create no `audit_event`: they are frequent per-user UI cursors and do not grant authority, change contact permission, or send data. Treat `lastReadAt` as activity metadata in retention/export/privacy policy and never reuse it as proof that a human understood or approved content.

Verification covers schema bounds, viewer-required filters, two-user isolation, self-authored-note exclusion, late provider chronology, monotonic read transition, new-message reappearance, tenant denial, live 401/422/404/200 behavior, browser badge/nine-control/explicit-read/no-overflow acceptance, migration rerun, 112 TypeScript tests including twelve live database tests, every type check, a 52-page build, native checks, three Rust tests, complete QA cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0033. Stop read-state writes before deploying 0.31; the prior release ignores cursor rows and continues to read the same message/thread data.

## Release 0.33 workspace-member assignment operations

No migration is required. The existing workspace membership and nullable conversation owner foreign key remain authoritative.

Important records, variables, collections, and functions:

- `WorkspaceMember` is the safe directory projection; `assignableToConversations` is computed in SQL from the closed owner/admin/editor role set;
- `listWorkspaceMembers(workspaceId)` orders by case-insensitive display name and stable user ID, and returns no email or session data;
- `assignedOwnerDisplayName` is hydrated from `app_user` on list/detail reads and is not copied into the conversation row;
- `members` is passed to the new-thread and detail components. Both filter the collection by `assignableToConversations`; the current user receives only a `(me)` presentation suffix;
- the URL `owner` value may be `me`, `unassigned`, or an exact UUID. The API maps it to `ConversationThreadQuery.assignedOwnerId` before the workspace-scoped repository query;
- `validateOwner` is the final transactional guard and accepts only same-workspace owner/admin/editor memberships;
- `conversation.assignment_changed` is selected when status is unchanged but the assignee UUID differs; its audit dictionary contains the stable assignee UUID rather than copied display/email data.

Verification covers safe directory shape/order, role eligibility, crafted viewer rejection, editor assignment and name hydration, exact member filtering, audit evidence, authenticated directory 401, browser option visibility/exclusion/selection/no-overflow, 112 TypeScript tests including twelve live database tests, every type check, a 53-page build, native checks, three Rust tests, complete QA cleanup, and the NSIS hash in `RELEASES.md`.

Rollback requires no schema change. Stop teammate assignment writes before deploying 0.32 if operators need UI access to those owners; stored UUIDs remain intact.

## Release 0.34 conversation-classification operations

Apply and checksum `0034_conversation_classification.sql`. Existing rows receive `unknown` for all dimensions and null review evidence. The migration adds four checks/index elements without deleting or rewriting messages; reruns must skip cleanly.

Important constants, variables, collections, and functions:

- `CONVERSATION_SENTIMENTS`, `CONVERSATION_INTENTS`, and `CONVERSATION_URGENCIES` are shared readonly tuples; all TypeScript unions and Zod enums derive from them;
- `sentiment`, `intent`, and `urgency` are required stored/read values but optional write inputs. `saveThread` resolves each as input, then existing value, then `unknown`;
- `classificationChanged` compares the resolved three-value tuple with the locked existing row. It controls reviewer/time evidence and the `conversation.classification_changed` event;
- `classificationUpdatedBy` is the authenticated writer UUID; `classificationUpdatedAt` is database `now()`. The database requires both or neither;
- `ConversationThreadQuery.sentiment`, `.intent`, and `.urgency` are optional exact predicates and compose with every prior tenant-scoped filter;
- create/detail forms use the shared tuples; the inbox filter now has twelve text/select/date controls and renders urgency plus sentiment/intent summaries.

Treat these values as reviewed operational labels, not objective facts or model output. Do not infer protected or sensitive traits, do not translate complaint/negative into contact permission, and do not let critical urgency bypass approvals or provider safety controls.

Verification covers closed schema values, invalid intent, safe defaults, evidence pairing, reviewer/database time, classification-specific audit transition, exact combined filters, preservation of omitted values, live 401/422/update/filter/audit behavior, browser twelve-control/list/detail/no-overflow acceptance, idempotent migration rerun, 112 TypeScript tests including twelve live database tests, every type check, a 53-page build, native checks, three Rust tests, cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0034 and stops classification writes before deploying 0.33; prior code ignores retained columns.

## Release 0.35 conversation-context operations

Apply and checksum `0035_conversation_context.sql`. It adds composite unique indexes on Campaign/Destination identity plus optional thread references, composite workspace foreign keys, and two workspace/reference/activity indexes. Reruns must skip cleanly; do not edit the applied migration.

Important variables, collections, and functions:

- `campaignId` and `destinationId` are optional domain reads and nullable optional write inputs. In `saveThread`, `undefined` preserves the locked existing value, null clears it, and a UUID replaces it;
- `campaignName` and `destinationTitle` are read-only hydrated labels in `StoredConversationThread`; no trigger or update path copies them into thread storage;
- `validateContext(transaction, workspaceId, campaignId, destinationId)` repeats same-workspace ownership inside the write transaction and returns `ConversationValidationError` fields rather than raw foreign-key errors;
- `associationChanged` compares both resolved references against the locked row and selects `conversation.context_changed` when no higher-priority status, assignment, or classification transition occurred;
- `ConversationThreadQuery.campaignId` and `.destinationId` are exact predicates. URL-facing `campaign` and `destination` values are UUID-validated before mapping;
- Campaign and Destination option collections passed to client components are minimized to `{ id, name }` and `{ id, title }`. Do not pass full Campaign versions, Destination URLs/tracking, credentials, or internal context dictionaries;
- text search joins Campaign/Destination within the same workspace and covers names, descriptions, and Destination topics. It remains parameterized, activity ordered, and capped at 200.

An association is informational. Never use it alone to authorize a Campaign command, provider send, tracked link, contact action, approval, or access to another object. Those boundaries must reload their own exact workspace and lifecycle authority.

Verification covers nullable/UUID schemas, preservation and explicit clear, same-workspace validation, database foreign keys, label hydration, exact combined filters, Destination-topic search, minimized audit evidence, live 401/422/clear/restore behavior, browser fourteen-control/list/detail/no-overflow acceptance, 112 TypeScript tests including twelve live database tests, every type check, a 53-page build, native checks, three Rust tests, complete QA cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0035 and stops context writes before deploying 0.34. Prior code ignores the columns. Clear or reassociate threads before deleting a referenced Campaign or Destination.

## Release 0.36 account/publication-context operations

Apply and checksum `0036_conversation_publication_context.sql`. It creates composite account/publication identity indexes, optional thread columns, workspace/account/publication foreign keys, a publication-requires-account check, and two activity indexes. Reruns must skip cleanly.

Important records, variables, collections, and functions:

- `channelConnectionId` and `publicationActionId` use the established UUID/null/undefined context semantics. A non-null publication requires a non-null matching account;
- `ConversationContextDirectory.channels` and `.publications` are the only account/publication collections intended for conversation client controls. Both are capped at 200 and exclude all secret or provider-payload fields;
- `listContextDirectory(workspaceId)` selects account ID/name/provider/status and publication ID/account/display/provider/external-ID/status/start time. Do not replace it with `listChannelConnections` or raw publication rows;
- `validateContext` first checks account workspace ownership, then publication workspace ownership, then exact publication/account identity;
- `associationChanged` now compares Campaign, Destination, Channel Connection, and Publication Action IDs; the existing minimized `conversation.context_changed` event carries all four UUID-or-null values;
- `ConversationThreadQuery.channelConnectionId` and `.publicationActionId` map from URL `account` and `publication`. Search joins only safe account/provider/external-publication identity;
- client publication selection assigns its `channelConnectionId`; changing the account clears a publication whose stored account differs;
- hydrated `channelConnectionName`, `channelProvider`, `publicationExternalId`, and `publicationStatus` are presentation fields only and must never authorize connector use.

Verification covers secret-free directory shape, bounds, account/publication pairing, cross-workspace and mismatch rejection, database constraints, hydration, exact filters, external-ID search, nullable clear/restore, UUID-only audit data, live 401/422 acceptance, sixteen browser controls, selected values, diagnostics, no overflow, 112 TypeScript tests including twelve live database tests, every type check, a 53-page build, native checks, three Rust tests, cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0036 and stops account/publication writes before deploying 0.35. Clear or reassociate threads before deleting a referenced account or publication ledger.

## Release 0.37 Brand-context operations

Apply and checksum `0037_conversation_brand_context.sql`. It adds the composite Brand identity index, optional thread root reference, same-workspace delete-restricting foreign key, and workspace/Brand/activity index. Reruns must skip cleanly; never edit an applied migration.

Important records, variables, collections, and functions:

- `brandProfileId` is an optional domain read and nullable optional write input. `saveThread` resolves it as input, then the locked existing value, then null; this makes undefined preserve, null clear, and UUID replace;
- `brandProfileName` and `brandProfileStatus` are hydrated read-only fields. They follow the current Brand root and are never copied into `conversation_thread`;
- `ConversationBrandOption` is `{ id, name, status }`; `ConversationContextDirectory.brands` is capped at 200 and is the only Brand collection intended for conversation client controls;
- `listContextDirectory(workspaceId)` queries Brand roots independently of Campaign versions. Do not replace it with full `StoredBrandProfile` records or pass profile/version dictionaries to client components;
- `validateContext` checks Brand workspace ownership inside the same locked transaction as all other context validation, before persistence;
- `associationChanged` compares Brand alongside Campaign, Destination, Channel Connection, and Publication Action and selects the existing minimized `conversation.context_changed` event when appropriate;
- `ConversationThreadQuery.brandProfileId` maps from URL `brand`. Search joins Brand in the same workspace and covers only name/description in addition to prior safe fields;
- Campaign `brandProfileVersionId` remains a separate immutable execution/generation pin. Never infer it from the conversation Brand root or use the root association to authorize a Campaign action.

Verification covers UUID/null/undefined schemas, safe bounded directory shape, same-workspace validation, composite database enforcement, delete restriction, hydration, exact filtering, Brand-description search, clear/restore behavior, UUID-only audits, live 401/422 acceptance, seventeen browser controls, safe labels, diagnostics, no overflow, 112 TypeScript tests including twelve live database tests, every type check, a 53-page build, native checks, three Rust tests, exact QA cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0037 and stops Brand-context writes before deploying 0.36. Release 0.36 ignores the retained column. Clear or reassign threads before deleting a referenced Brand Profile root.

## Release 0.38 relationship-history operations

No database migration is required. The feature is a read-time projection over the existing relationship/thread/message schema and indexes.

Important records, variables, collections, and query behavior:

- `StoredConversationThread.relationshipStage` is required; `priorThreadCount` and `priorMessageCount` are required non-negative numbers; `lastPriorInteractionAt` is optional;
- `relationship_history` is the tenant-correlated lateral aggregate inside `ConversationRepository.threadRows`. Keep workspace and relationship predicates inside the aggregate;
- `prior_thread.created_at < thread.created_at` defines an earlier conversation. `prior_message.created_at < thread.created_at` prevents a later-arriving message in an old thread from being reported as prior to the current thread;
- `count(DISTINCT prior_thread.id)::integer` avoids message fan-out inflating the thread count. `count(prior_message.id)::integer` is the qualifying message total;
- `last_prior_interaction_at` is the maximum of qualifying prior thread/message creation times and is normalized during hydration;
- do not select or serialize prior body, metadata, author/provider identity, internal note text, relationship notes, organization, or speculative customer labels in this projection;
- inbox and thread detail render the same stage/count/timestamp summary. No form input, API mutation, audit event, worker, or external provider action is added.

Verification covers zero-history hydration, one-earlier-thread/message aggregation, strict later-thread exclusion, current stage hydration, absence of prior body/relationship notes, authenticated API 401 boundary, list/detail rendering, no diagnostics, no overflow, 112 TypeScript tests including twelve live database tests, all type checks, lint, a 53-page build, native checks, three Rust tests, exact QA cleanup, and the installer hash in `RELEASES.md`.

Rollback requires no schema change. Deploy 0.37 to stop selecting/rendering the derived fields; stored conversations and relationships remain unchanged.

## Release 0.39 observed-share operations

Apply and checksum `0038_conversation_shared_resources.sql`. It creates the evidence table, target/check constraints, UUID idempotency uniqueness, thread/target/membership foreign keys, and thread/Destination/Publication indexes. Reruns must skip cleanly; never edit an applied migration.

Important records, variables, collections, and functions:

- `idempotencyKey` is a client-generated UUID scoped by workspace and thread. Replay returns the original record and emits no duplicate audit event; a new key permits a legitimate repeated share;
- `kind` is the strict `destination | publication` discriminator. Destination input supplies `destinationId`; Publication input supplies `publicationActionId`, and the repository derives `channelConnectionId`;
- `observedAt` is operator evidence time and must be offset-aware and no more than five minutes ahead of server time. `createdAt` is the immutable database chronology boundary;
- `recordSharedResource` locks the authorized thread, validates the exact same-workspace target, inserts idempotently, and emits `conversation.shared_resource_recorded` only on first insert;
- `sharedResourceHistoryCount` and `recentSharedResources` are attached by one ranked tenant query. List reads retain three recent records; detail reads retain twenty while exposing the total count;
- current-thread evidence is eligible. Earlier-thread evidence is eligible only when its source thread and record were both created before the viewed thread; later or retroactively recorded evidence is excluded;
- client-safe hydration includes Destination title/canonical URL or account name/publication external ID/status. Do not add Destination description/tracking/identifiers, Publication URL/request/response/error, message text, or credentials;
- `ConversationSharedResources` records evidence and renders history; it does not send a message, publish content, mutate thread context, or imply that a provider confirmed delivery.

Verification covers strict schemas, tenant/target constraints, future rejection, exact Publication/account derivation, repeated-share support, UUID replay, single-audit behavior, safe hydration, bounded current/prior history, retroactive exclusion, live 401/422/privacy checks, browser record/list/detail/link/no-overflow/no-diagnostics acceptance, 113 TypeScript tests including twelve live database tests, all type checks, lint, a 53-page build, native checks, three Rust tests, cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0038 and stops writes before deploying 0.38. Release 0.38 ignores the table. Referenced targets remain deletion-restricted until dependent threads/evidence are removed under policy.

## Release 0.40 suggested-routing operations

Apply and checksum `0039_conversation_routing_rules.sql`. It creates the rule table, case-insensitive workspace name uniqueness, evaluation index, composite tenant/member references, closed-value checks, the at-least-one-matcher invariant, and target assignment consistency. Reruns must skip cleanly; never edit an applied migration.

Important records, variables, collections, and functions:

- `CONVERSATION_ROUTING_RULE_MATCH_FIELDS` is conceptually the closed matcher set Brand, account, relationship stage, intent, and urgency; implementation fields are `brandProfileId`, `channelConnectionId`, `relationshipStage`, `intent`, and `urgency`;
- `priority` ranges from 0 through 1,000. Higher wins. Ties use matcher specificity, `updatedAt`, and stable rule UUID so database evaluation has a total order;
- `routingSuggestion` is an optional read projection. Its `matchedOn` list contains only the matching field names and must remain aligned with the non-null winning-rule predicates;
- `saveRoutingRule` validates Brand/account workspace ownership and calls `validateRoutingOwner` for assigned suggestions. The role set must remain identical to conversation assignment eligibility;
- `setRoutingRuleEnabled` is the supported lifecycle mutation. Disabling a rule removes it from evaluation without deleting audit or configuration history;
- the lateral winner query belongs inside `ConversationRepository.threadRows`; retain workspace correlation and eligible-owner checks if extending it;
- `ConversationRoutingRules` manages configuration. Inbox/detail views display the suggestion, but operators must use `ConversationStateForm` to apply owner/status changes;
- `allowedDevOrigins: ['127.0.0.1']` in `apps/web/next.config.ts` permits local browser QA through the loopback address under Next.js 16.3 while `localhost` remains the documented development URL.

Verification covers strict matcher/target schemas, tenant references, role eligibility, case-insensitive names, deterministic specificity fallback, enable/disable behavior, non-mutating suggestions, minimized audits, live 401/422/API checks, browser create/list/detail/no-overflow/no-diagnostics acceptance, 114 TypeScript tests including twelve database tests, every type check, lint, a 54-page production build, native checks, three Rust tests, exact QA cleanup, and the NSIS hash in `RELEASES.md`.

Rollback retains migration 0039 and stops routing-rule writes before deploying 0.39. Release 0.39 ignores the table. Rule Brand/account/owner references remain deletion-restricted; disable or remove retained rules under data-retention policy before deleting those referenced roots.

## Release 0.41 workspace service-level operations

- Migration `0040_conversation_service_levels.sql` creates `conversation_service_level_policy`, its tenant/author constraints, validation checks, timestamps, and `conversation_add_business_minutes`. The migration is additive and idempotent through the normal migration ledger.
- `GET` and `PUT /api/v1/conversation-service-level-policy` read and replace the authenticated workspace policy. Writes require workspace authoring permission. The API validates the IANA timezone, seven-bit day mask, `HH:mm` business times, start-before-end ordering, urgency target bounds, and at-risk lead bounds.
- The repository derives deadlines inside tenant-scoped conversation reads. Manual `responseDueAt` has precedence; otherwise the latest inbound-created timestamp or thread creation seeds the configured business-minute calculation. Resolved and archived threads omit the active state.
- The Conversations policy form edits timezone, business days, hours, urgency targets, and lead time. Inbox/detail surfaces identify manual versus workspace-policy deadlines. The feature has no scheduler, worker, Temporal command, connector call, or provider side effect.
- Live API/database acceptance covered authentication, invalid hours/timezone, save/read, Friday-to-Monday Chicago arithmetic, policy projection, manual precedence, state non-mutation, and minimized audit dictionaries. Browser acceptance covered form update, list/detail state/source, privacy, no warnings/errors, and 1280-pixel no-overflow rendering.
- Release gate: clean lint; 115 TypeScript tests including twelve database tests; every workspace type check; 55-page optimized web build; companion webview/native checks; and three Rust tests.
- Unsigned installer `Market Me Companion_0.41.0_x64-setup.exe`: 2,944,889 bytes; SHA-256 `ef87322308f856f36e5a9b0c7711b37936a3f318d9d9a1bc5b587634c5e51ae9`.

Known limitations: there is no scheduler or reminder delivery, holiday calendar, per-account/Brand policy, SLA inbox filter, escalation mutation, status-based clock pause, policy disable/delete UI, or audit-history UI.

Rollback keeps additive migration `0040_conversation_service_levels.sql`, its table, and function applied. Release 0.40 ignores retained policies. Stop policy writes before rollback; retained rows can remain because they cause no background or provider action.

## Release 0.42 internal review-request operations

- Migration `0041_conversation_review_requests.sql` adds `conversation_review_request`, `conversation_review_request_mention`, indexes for thread/status and reviewer/due queries, and the composite message key required by the same-workspace/thread source-note foreign key. The final migration checksum is `14120cefa794d042f761ab9d15d95ea9a370b1fc02b255fcab58902181ccce8d`.
- `POST /api/v1/conversations/[id]/review-requests` creates a request. `PATCH /api/v1/conversations/[id]/review-requests/[reviewRequestId]` accepts only `resolved` or `cancelled`. Request text is limited to 10,000 characters; mention IDs are deduplicated and limited to twenty; due times require an offset-aware timestamp.
- `createReviewRequest` validates the locked thread, action-eligible requested reviewer, current-member mentions, actor/reviewer/mention separation, and optional same-thread `internal_note` citation. `closeReviewRequest` enforces reviewer-only resolution and requester-only cancellation. Neither function mutates conversation state or dispatches work.
- `ConversationReviewRequestWrite` is the write dictionary. `ConversationReviewMention[]` is the hydrated mention list. `StoredConversationThread.reviewRequests` carries full detail history, while `openReviewRequestCount` is the privacy-minimized list projection.
- `ConversationReviewRequests` renders the detail form and history. Reviewer choices exclude the actor and viewer-only members; selecting a reviewer removes that user from optional mentions. The interface states that the request is internal and sends nothing externally. Inbox cards display only the open count.
- Audit event dictionaries for `conversation.review_requested`, `conversation.review_resolved`, and `conversation.review_cancelled` contain stable IDs, booleans, timestamps, and mention IDs only. They must never receive request text, internal-note content, message bodies, contact data, or provider material.
- Live API/database acceptance covered unauthenticated access, self/ineligible reviewer rejection, valid internal-note citation, reviewer/name/mention hydration, list/detail privacy, unauthorized resolution rejection, reviewer resolution, requester cancellation, membership removal after historical review, and minimized audits.
- Browser acceptance created and cancelled a real request with a cited internal note and viewer mention, confirmed the open-count list projection, retained `new`/unassigned state, no private relationship-note leakage, zero warnings/errors, and no horizontal overflow at 1280 by 900 pixels. Exact QA threads, relationships, review requests, users, audits, and sessions were deleted and verified at zero.
- Release gate: clean lint; 116 TypeScript tests including twelve live PostgreSQL integration tests; every workspace type check; a 55-page optimized Next.js build; companion webview/native checks; three Rust tests; a clean all-migrations scratch database; and an idempotent development migration rerun through `0041_conversation_review_requests.sql`.
- Unsigned installer `Market Me Companion_0.42.0_x64-setup.exe`: 2,951,133 bytes; SHA-256 `45657d8df4499fbac392c8f896fe95618802deb48b60b551c1125b1da828c4c0`.

Known limitations: there is no email, push, or in-app notification feed; request/mention unread state; review-request inbox filter; more than one requested reviewer; threaded review comments; approval decision/diff attachment; edit, reopen, or deletion UI; drafting presence; or AI review/response generation. Removing a membership removes its optional mention edge, while core requester/reviewer attribution remains. No review action performs provider delivery.

Rollback keeps additive migration `0041_conversation_review_requests.sql` and the message composite uniqueness constraint applied. Stop review-request writes before deploying release 0.41; retained rows can remain because 0.41 ignores them and there are no background, workflow, notification, or provider effects.

## Release 0.43 reviewed identity-resolution operations

- Migration `0042_relationship_identity_resolution.sql` adds canonical pairwise identity links, same-workspace composite foreign keys, closed status/evidence checks, bounded confidence, review-state consistency, lookup indexes, and the stable recursive `relationship_effective_contact_permission` function. Final SHA-256 checksum: `19258eaba1b1caf0563a4e95f5019c7372274907d861b5d887e5e59ddc56551f`.
- `GET` and `POST /api/v1/relationships/[id]/identity-links` read the shared view or create/reopen evidence. `PATCH /api/v1/relationships/[id]/identity-links/[linkId]` confirms or dismisses one edge. All mutations require workspace authoring access.
- `saveIdentityLink` sorts the relationship UUIDs into `relationshipAId < relationshipBId`, locks both roots, repeats writer and tenant checks, rejects self/cross-workspace/already-connected records, and stores one row per pair. `reviewIdentityLink` is the reversible decision mutation. Neither function moves source rows.
- `getIdentityResolution` uses a recursive CTE with deduplicating `UNION` to hydrate the confirmed connected component, all preserved provider identities, and touching link history. Suggestions display evidence kind and confidence but remain separate.
- `effectiveContactPermission` is a derived suppression-first field. Relationship editing continues to use the local `contactPermission`; relationship lists, new-thread options, and conversation thread reads use the effective value.
- `RelationshipIdentityResolution` owns the edit-page evidence form, shared-member cards, suggestions/history, confirm/dismiss controls, and explicit warning that name similarity or speculative inference is not evidence.
- Audit events are `relationship.identity_link_suggested`, `relationship.identity_link_confirmed`, and `relationship.identity_link_dismissed`. Their dictionaries contain link/candidate UUIDs and, on suggestion, closed evidence kind plus confidence; they exclude relationship names, provider subjects/handles, addresses, notes, messages, and connector material.
- Live API acceptance proved 401 authentication, 422 self-link and name-similarity rejection, suggestion/confirmation/dismissal, 1-to-2-to-1 group transitions, allowed-to-suppressed-to-allowed safety, and minimized audits. Authenticated server-rendered UI acceptance proved shared safety, current/confirmed roots, the separation control, registry effective safety, and the post-dismissal view. Chrome extension visual/no-overflow inspection was unavailable in this release run.
- Release gate: clean lint; 118 TypeScript tests including thirteen live PostgreSQL integration tests; every workspace type check; a 55-page optimized Next.js build; companion webview/native checks; three Rust tests; clean scratch application of all migrations; idempotent development rerun through 0042; and exact QA cleanup verified at zero.
- Unsigned installer `Market Me Companion_0.43.0_x64-setup.exe`: 2,944,357 bytes; SHA-256 `4acb182f43289efa608635503d74be7f5ce875fd482fd8ac7095c46993dddcfb`.

Known limitations: candidate evidence is entered manually; there is no automatic exact-address/verified-link scanner, bulk review queue, link search/filter, attached evidence artifact, approver-only workflow, or CRM reconciliation. The shared view aggregates relationship roots and provider identities but conversations remain on their original roots and there is no unified timeline. Link state is workspace-local and does not modify providers. Retention/export/erasure policy for identity evidence remains production work.

Rollback keeps additive migration `0042_relationship_identity_resolution.sql`, the link rows, indexes, and helper function applied. Stop identity-link writes before deploying release 0.42. Release 0.42 ignores retained links and will not surface group-level suppression, so no relationship-targeted outbound capability may be introduced while rolled back.

## Release 0.44 deterministic identity-candidate operations

- Migration `0043_identity_candidate_discovery.sql` adds `origin`, `evidence_fingerprint`, closed provenance/fingerprint checks, and the pending scanner-queue index to `relationship_identity_link`. Final SHA-256 checksum: `d07b63a85e97bfeb4fe365e7226d41e2992d75773bfba676a894baeb05edc4b7`.
- `GET /api/v1/relationship-identity-candidates` lists at most 200 pending deterministic suggestions. `POST` starts one bounded scan and returns `RelationshipIdentityCandidateScanResult`. Both routes require an authenticated workspace; scanning additionally requires authoring access.
- `scanIdentityCandidates` performs the transactional membership check, relationship lock, verified-identity bound, existing-pair read, deterministic discovery, conflict-safe inserts, and minimized audits. Keep `discoverIdentityCandidates`, `strongIdentitySignals`, the normalization helpers, evidence ranking, and confidence constants deterministic and free of network/model calls.
- Scan caps are 5,000 verified identities, five relationship roots per reusable signal, 100 new candidate links, and 200 listed queue items. These are safety and latency boundaries; changes require tests and documentation updates.
- `RelationshipIdentityCandidates` renders the Conversations review queue and scan result counts. It links to `RelationshipIdentityResolution` on each relationship edit page, where the Release 0.43 confirm/dismiss authorization and graph rules remain authoritative.
- Focused integration coverage proves exact email, canonical profile URL, namespaced strong identifier, same-name exclusion, repeat idempotency, dismissal non-reopening, hash-only persistence, and audit minimization. Live acceptance additionally proved unauthenticated rejection, exact-address/profile discovery, same-name exclusion, SSR queue/review links, 64-hex fingerprints, no raw QA signals in audits, and exact cleanup at zero.
- Release gate: clean lint; 119 TypeScript tests including fourteen live PostgreSQL integration tests; every workspace typecheck; a 56-page optimized Next.js build; companion web/native checks; three Rust tests; clean all-migrations scratch application through 0043; idempotent development rerun; and zero QA residue.
- Unsigned installer `Market Me Companion_0.44.0_x64-setup.exe`: 2,946,446 bytes; SHA-256 `8c75fb26369cfc5860682e78050f5fc39669ce1dd7e42df0856260635935d9fa`.

Known limitations: scans are manually triggered and exact-match only. There is no import-time/background schedule, provider-issued verification callback, bulk decision control, candidate search/filter, evidence artifact/source reference beyond kind and fingerprint, cross-workspace or CRM synchronization, or approximate matching. The caps intentionally defer oversized work for a future paged job design.

Rollback keeps additive migration `0043_identity_candidate_discovery.sql` applied and stops scans before deploying release 0.43. Release 0.43 ignores origin/fingerprint/queue behavior; retained suggested rows remain ordinary reviewable suggestions and reviewed rows continue to work because their additional columns are ignored.

## Release 0.45 Conversation Assistant operations

- Migration `0044_conversation_response_suggestions.sql` creates immutable response suggestions, one-active-per-thread enforcement, closed lifecycle/recommendation checks, response/destination/uncertainty invariants, same-workspace thread/Destination/member references, JSON shape checks, and bounded history indexes. Final SHA-256: `a9eb512185aa9b09c6ea0282c702077bcabffba83762dd16bf1582f3be2cc2d7`.
- `ConversationAssistantRepository.listSuggestions`, `.generateSuggestion`, and `.dismissSuggestion` own the read/generate/review lifecycle. Generation repeats write authorization, locks the thread, reads twenty external messages, resolves suppression-first safety plus published context, validates provider output, fingerprints the input, supersedes the prior active row, inserts the immutable result, and audits minimized metadata transactionally.
- Generator constants and `generateGroundedConversationResponse` live in `packages/generation/src/index.ts`. Keep question extraction, recommendation rules, promotion bounding, uncertainty, response construction, citations, and claims pure and deterministic. Any new provider must return the same typed contract and pass repository claim/citation validation.
- `GET` and `POST /api/v1/conversations/[id]/response-suggestions` list history or generate; `PATCH /api/v1/conversations/[id]/response-suggestions/[suggestionId]` dismisses an active suggestion. Client JSON can supply only workspace identity and the closed dismissal command, never response, prompt, context, confidence, or citations.
- `ConversationAssistant` renders the thread-detail panel, current suggestion, question list, review-only draft or no-response explanation, uncertainty reasons, supporting citations, factual claims, generator identity, regeneration, dismissal, and retained history. It contains no send/accept/provider action.
- Integration/live acceptance proves authentication, exact decimal-bearing question extraction, published-Destination citation, claim indexing, 64-hex fingerprint, regeneration supersession, dismissal, suppression-first no-response, zero outbound messages, minimized audits, SSR rendering, and exact QA cleanup.
- Release gate: clean lint; 124 TypeScript tests including fifteen live PostgreSQL tests; every workspace typecheck; 56-page optimized Next.js build; companion web/native checks; three Rust tests; clean scratch application of all 44 migrations; idempotent development rerun; and zero QA residue.
- Unsigned installer `Market Me Companion_0.45.0_x64-setup.exe`: 2,948,511 bytes; SHA-256 `32237b382e054feb7c01f7ae119fa3cd49d07c754477191dfbc5fcacb92ccbfb`.

Known limitations: the provider is a deterministic local template, not a hosted language model. It summarizes only the latest inbound excerpt, identifies punctuation-delimited questions, and adds no factual business language except an exact cited published Destination. There is no accept/copy-to-composer workflow, outbound reply adapter, automatic handoff creation, retrieval from approved Content Package evidence, localization, semantic question extraction, model evaluation harness, feedback learning, streaming, or autonomous response policy.

Rollback retains additive migration `0044_conversation_response_suggestions.sql` and its rows. Stop suggestion generation before deploying 0.44. Release 0.44 ignores retained assistant records; because they never emit provider work, no compensating external action is required.

## Release 0.46 shared response-composer operations

- Migration `0045_conversation_response_composer.sql` creates `conversation_response_draft` and `conversation_drafting_presence`, adds the suggestion composite key required for tenant/thread provenance, and enforces one shared draft, same-workspace member/thread references, closed actor kinds, bounded bodies, and bounded presence leases. Final SHA-256: `0fb8fc5550c09a42a2e6f2fe267fd93de93b6430fbcc632981f40534137d400b`.
- `ConversationComposerRepository.getState`, `.saveDraft`, `.discardDraft`, `.heartbeatPresence`, and `.clearPresence` own persistence. `saveDraft` validates the source suggestion before upsert, records the exact last editor, renews a two-minute human lease, and writes only minimized audit metadata. State reads ignore expired leases and cap the active list at twenty.
- `GET`, `PUT`, and `DELETE /api/v1/conversations/[id]/response-draft` load, save, and discard. `POST` and `DELETE /api/v1/conversations/[id]/response-draft/presence` renew or clear the authenticated human actor. JSON schemas are strict; callers cannot choose another actor, actor kind, expiry, editor, or thread body provenance.
- `ConversationResponseComposer` is a Client Component embedded after `ConversationAssistant`. It supports local editing, copying the active suggestion, save/discard, one-minute heartbeat renewal, best-effort blur/unmount clearing, active-author labels, source provenance, last-editor time, and an explicit no-send notice. It intentionally has no provider/account/send/schedule/approve action.
- `CONVERSATION_DRAFTING_ACTOR_KINDS`, `ConversationResponseDraft`, `ConversationDraftingPresence`, `ConversationResponseDraftWrite`, and `StoredConversationComposerState` are the authoritative tuples/interfaces. Keep the 20,000-character body limit, two-minute repository lease, five-minute database ceiling, and twenty-presence read cap aligned across code, schema, tests, and documentation.
- Audit events are `conversation.response_draft_saved` and `conversation.response_draft_discarded`. Saved metadata contains draft/source IDs and character count; discarded metadata contains IDs only. Never add body text, assistant response text, message content, contact data, credentials, or provider payloads.
- Integration and live acceptance prove two-writer shared revision, last-editor attribution, assistant-source tenant/thread binding, assistant `finally` cleanup, human presence renew/clear, discard, strict 401/422 boundaries, SSR rendering, zero outbound-observed messages, minimized audits, and exact QA cleanup.
- Release gate: clean lint; 126 TypeScript tests including sixteen live PostgreSQL tests; every workspace typecheck; 56-page optimized Next.js build; companion web/native checks; three Rust tests; clean application and idempotent rerun of all 45 migrations.
- Unsigned installer `Market Me Companion_0.46.0_x64-setup.exe`: 2,945,340 bytes; SHA-256 `717b66aa474d7e5cd4919a779567915fe1f768aac68db8d91c59238dfd544d6b`.

Known limitations: the composer is one shared last-write-wins text buffer, not a CRDT. Presence is refresh-on-read rather than pushed live, and interrupted clients rely on lease expiry. There is no autosave, revision history, inline comments, approval transition, send adapter, scheduling, attachment composer, localization, or conflict dialog.

Rollback retains additive migration `0045_conversation_response_composer.sql` and stored rows. Stop composer writes before deploying 0.45; Release 0.45 ignores retained draft/presence state and no external compensation is required because the composer never dispatches work.

## Release 0.47 conversation-attention operations

- Migration `0046_conversation_attention_queue.sql` adds required `escalation_after_minutes` with a zero-through-10,080 constraint and an active-thread deadline index. Final SHA-256: `bfd85a8dac9c597c0f930f7c53feddd6683dba127133254e8320bf66506b83c3`.
- `ConversationServiceLevelPolicyWrite` and the strict route schema add `escalationAfterMinutes`; the policy form defaults to sixty minutes. Policy repository reads, writes, upserts, and minimized audit metadata include the field.
- `ConversationRepository.listAttentionItems(workspaceId, asOf?)` computes service deadlines with the established IANA business-calendar function, joins explicit follow-up and earliest open review/handoff deadlines, excludes closed threads, returns at most 200 items, and deterministically ranks severity/time/UUID. The injectable `asOf` exists for deterministic tests; production callers use current time.
- `CONVERSATION_ATTENTION_REASONS`, `ConversationAttentionReason`, and `ConversationAttentionItem` are the authoritative tuple/type/interface. Keep reason ordering, optional due timestamp fields, the 200-item cap, and escalation bounds synchronized across domain, SQL, UI, tests, and documentation.
- `GET /api/v1/conversation-attention?workspaceId=...` requires authenticated workspace read access and returns `{ data, meta: { count, limit: 200 } }`. `ConversationAttentionQueue` renders up to twenty highest-priority links on the Conversations page and states that it never changes ownership or sends notifications.
- Integration/live acceptance proves four simultaneous reasons, at-risk calculation, severity ordering, closed-thread exclusion, unchanged status, 401 authorization, SSR rendering, workspace-policy restoration, and exact cleanup.
- Release gate: clean lint; 127 TypeScript tests including seventeen live PostgreSQL tests; every workspace typecheck; 57-page optimized Next.js build; companion web/native checks; three Rust tests; clean and idempotent application of all 46 migrations.
- Unsigned installer `Market Me Companion_0.47.0_x64-setup.exe`: 2,943,708 bytes; SHA-256 `385b82c615c79472cbd6459e21599dc3eb65bb393c896fc4c578f2926806cc62`.

Known limitations: evaluation occurs on API/page refresh and does not create a durable notification. There is no scheduler, push/email/in-app delivery history, acknowledgement, snooze, per-user subscription, holiday calendar, escalation recipient/action, pagination beyond the 200-item safety cap, or global-navigation badge.

Rollback retains additive migration `0046_conversation_attention_queue.sql` and the new policy value. Stop 0.47 policy writes before deploying 0.46; Release 0.46 ignores the extra column and index. The derived queue has no durable rows or external effects to compensate.

## Release 0.48 conversation retention-preview operations

- Migration `0047_conversation_retention_policy.sql` adds closed thread classes and reviewer/time fields, one workspace policy with enabled state plus three bounded day windows, tenant/member constraints, legal-hold exclusion, and a closed-thread preview index. Final SHA-256: `40ba05036225054eabb1730869169ad45fbc7bf3f195e064763a234ca879d053`.
- `CONVERSATION_RETENTION_CLASSES`, `ConversationRetentionClass`, `ConversationRetentionCandidate`, `ConversationRetentionPolicyWrite`, and `StoredConversationRetentionPolicy` are authoritative. Keep the four classes, 1–3,650-day bounds, closed-status requirement, legal-hold exclusion, activity anchor, and 200-result cap aligned across schema, repository, UI, tests, and docs.
- `getRetentionPolicy`, `saveRetentionPolicy`, `setRetentionClass`, and `listRetentionCandidates(workspaceId, asOf?)` repeat writer/tenant validation, persist minimized governance state, and calculate deterministic preview rows. `asOf` is injectable only in repository tests; public clients cannot choose it.
- `GET/PUT /api/v1/conversation-retention-policy` read policy/candidates or save policy. `PATCH /api/v1/conversations/[id]/retention-class` changes one reviewed class. There is intentionally no DELETE/purge/anonymize endpoint; unsupported DELETE returns 405.
- `ConversationRetentionPolicy` renders enabled state, three day windows, safety language, and the top twenty eligible closed threads. `ConversationRetentionClassControl` renders the per-thread class, legal-hold explanation, and last-review time.
- Audits are `conversation.retention_policy_saved` with enabled state/windows and `conversation.retention_class_changed` with prior/new closed class only. They exclude subject, relationship, messages, notes, identities, provider data, and candidate lists.
- Integration/live acceptance proves viewer rejection, class-specific dates/order, closed-only eligibility, legal-hold exclusion, disabled-policy empty state, strict 401/422/405 boundaries, SSR configuration/class/preview, retained source thread, policy restoration, minimized audits, and exact cleanup.
- Release gate: clean lint; 129 TypeScript tests including eighteen live PostgreSQL tests; every workspace typecheck; 58-page optimized Next.js build; companion web/native checks; three Rust tests; clean/idempotent application of all 47 migrations.
- Unsigned installer `Market Me Companion_0.48.0_x64-setup.exe`: 2,946,562 bytes; SHA-256 `fd73e47fdb91c3504271d6d2c57cffa9c0b3ef730afd4b5043ad37091bc88821`.

Known limitations: preview is not erasure. There is no deletion/anonymization executor, approval or dual control, dependency graph, export-before-delete, legal-basis/consent record, subject-access workflow, backup/object/Temporal/provider cleanup, retention exception, candidate pagination beyond 200, or hold reason/expiry. Thread classes are manual and workspace-local.

Rollback retains additive migration `0047_conversation_retention_policy.sql`, policy rows, and class metadata. Stop 0.48 policy/class writes before deploying 0.47. Release 0.47 ignores the new data; because 0.48 never deletes anything, no restoration or external compensation is required.

## Release 0.49 AI gateway and cost-control operations

- Migration `0048_ai_gateway_cost_controls.sql` creates one `workspace_ai_policy` and an append-only `ai_usage_event` ledger with closed modes/capabilities/privacy/failover/cap behavior, member and Campaign tenant references, non-negative numeric checks, and workspace/time/feature indexes. Final SHA-256: `7d855d428d44da2d9819826543ec0dff4b179fb2b3bbc68903cad1792ac6ad78`.
- `packages/domain/src/ai.ts` owns every AI tuple, union, descriptor, routing request/decision, indicators, and usage-summary dictionary. Add or rename a value only with synchronized migration, schema, gateway, UI, test, and documentation changes.
- `packages/generation/src/gateway.ts` owns `AiProviderAdapter`, `BUILT_IN_AI_ADAPTERS`, `AI_MODE_INDICATORS`, and pure `routeAiTask`. Keep capability/privacy/context/approval filters ahead of scoring. Never convert an unavailable decision into a broader provider call.
- `AiRepository.getPolicy`, `.savePolicy`, `.recordUsage`, and `.getCurrentMonthUsage` own persistence. Policy writes repeat owner/admin/editor membership, validate budgets/thresholds, and audit only the configured controls. Usage events are operational metadata, not authorization or audit evidence.
- `GET/PUT /api/v1/ai-policy` return or save the workspace policy; GET also returns current-month usage, mode indicators, and the currently registered safe descriptors. `POST /api/v1/ai-routing-preview` evaluates the saved mode/privacy against server-owned descriptors. Both schemas are strict; neither endpoint accepts credentials, prompts, responses, arbitrary adapters, execution commands, or provider URLs.
- `/ai-settings` and `AiPolicyForm` present outcome-first modes, four simple indicators, privacy/failover/cap behavior, optional currency caps, alert percentages, spend progress, advanced numeric usage, and capability readiness. The interface states when work is not configured rather than implying an automatic cloud fallback.
- Budget values are stored as positive integer minor currency units. The current UI formats amounts with two fractional digits and therefore needs a currency-exponent abstraction before supporting zero- or three-decimal currencies. Monthly aggregation uses UTC boundaries and exact currency equality.
- Live acceptance proved 401 authentication, default recommended policy, one local descriptor, strict 422 invalid/extra input, successful private-local save, local text selection, unavailable image analysis, server-rendered control/readiness content, no browser console errors, exact policy/audit cleanup, and a clear port after QA.
- Release gate: clean lint; 137 TypeScript tests including nineteen live PostgreSQL integration tests; every workspace typecheck; 61-page optimized Next.js build; companion web/native checks; three Rust tests; clean/idempotent application of all 48 migrations.
- Unsigned installer `Market Me Companion_0.49.0_x64-setup.exe`: 2,944,265 bytes; SHA-256 `75e7e16122e14f2efafbf1ed297fa253dcea587f5d500b43798a85a7058609ab`.

Known limitations: no external provider adapter, API-key vault, self-hosted endpoint discovery, real tokenizer/cost estimator, cache executor, per-Campaign usage UI, daily/Campaign cap evaluation, alert delivery, spend approval, automatic fallback, evaluation harness, or model health polling exists yet. `recordUsage` is an internal repository boundary and is not wired into the current deterministic draft/assistant paths in this release.

Rollback retains additive migration `0048_ai_gateway_cost_controls.sql`, policies, and usage metadata. Stop 0.49 policy/usage writes before deploying 0.48; Release 0.48 ignores the tables. No provider compensation is required because 0.49 adds no external model execution.

## Release 0.50 transactional AI spend-authorization operations

- Migration `0049_ai_spend_reservations.sql` adds `ai_spend_reservation`, active/recent indexes, and nullable unique `ai_usage_event.spend_reservation_id` with a same-workspace foreign key. Final SHA-256: `523915fa931bde33919fe4ef8490416f22a5602833a113498720ebfb6e0557f0`.
- `packages/domain/src/ai.ts` owns `AI_SPEND_RESERVATION_STATUSES`, `AI_BUDGET_SCOPES`, `AiSpendReservation`, `AiBudgetScopeStatus`, and `AiBudgetStatus`. These are closed public contracts; never accept arbitrary status/scope strings from a caller.
- `AiRepository.reserveSpend(input, actor, asOf?)` validates tenant/writer authority, locks the workspace row, expires stale holds, enforces UUID idempotency, verifies Campaign ownership and exact policy currency, then records `reserved` or `denied`. `asOf` is injectable for integration tests only.
- `settleSpend` locks one active reservation, rejects actual cost above estimate, atomically inserts exactly one linked metadata-only usage event, and resolves the reservation. `releaseSpend` ends a hold without usage. `getBudgetStatus` returns settled/reserved/available figures and bounded active/recent rows. Retried identical reservation and settlement calls return the existing result.
- Non-zero direct `recordUsage` is rejected. A future paid adapter must reserve a safe upper bound before provider I/O, preserve the returned reservation ID, settle the exact charge on confirmed completion, and release on every known no-charge terminal path. It must not expose these mutations directly to browsers.
- `GET /api/v1/ai-policy` now includes read-only `budgetStatus`; PUT remains policy-only. `/ai-settings` renders settled/reserved/available daily and monthly amounts, active 15-minute leases, recent decisions, and explicit persistence-enforcement language. No public reservation/settlement route exists.
- Audits are `ai.spend_reserved`, `ai.spend_denied`, `ai.spend_settled`, and `ai.spend_released`. Dictionaries contain IDs, closed capability/status/scopes, integer costs, currency, Campaign ID, and timing only; they exclude prompts, outputs, message/content text, provider payloads, credentials, and feature text.
- Local database execution still uses `DATABASE_URL=postgresql://market_me:market_me_local@localhost:5432/market_me`; no new environment variable or key is required. Reservation timestamps use database UTC semantics and a fixed 15-minute lease.
- Acceptance covers writer/viewer authorization, cross-boundary active holds, idempotency mismatch, Campaign/daily denial, settlement/retry, paid-ledger bypass rejection, release, expiry, one linked usage row, budget projections, minimized audit evidence, 401/API/SSR behavior, responsive layout, no overflow, and zero browser console errors.
- Release gate: clean lint; 138 TypeScript tests including twenty live PostgreSQL integration tests; every workspace typecheck; 61-page optimized Next.js build; companion web/native checks; three Rust tests; clean/idempotent application of all 49 migrations.
- Unsigned installer `Market Me Companion_0.50.0_x64-setup.exe`: 2,943,197 bytes; SHA-256 `88a02f91cc4ca5319fa91b1e497549b7234a7273e1c28de0311e853817fb0718`.

Known limitations: there is still no paid/hosted provider adapter, credential vault, tokenizer-backed estimator, actual provider price catalog, approval workflow, alert delivery, automatic fallback executor, model-health poller, per-request UI, or scheduler. Actual cost may not exceed the reserved estimate, so future adapters must use conservative estimates. The budget UI still assumes two-decimal currencies.

Rollback retains additive migration `0049_ai_spend_reservations.sql`, reservation decisions, and linked usage metadata. Stop every 0.50 AI caller and resolve or allow active holds to expire before deploying 0.49. Release 0.49 ignores reservations and does not enforce their headroom, so paid provider execution must remain disabled while rolled back.

## Release 0.51 AI budget-alert operations

- Migration `0050_ai_budget_alerts.sql` adds `ai_budget_alert`, same-workspace Campaign/reservation/member references, scope/acknowledgment state checks, one composite deduplication constraint, and open/recent indexes. Final SHA-256: `fe24b0596add753a2984f7f3541b25db3a8a87b5c4864792da13e22fbaff9c8b`.
- `AI_BUDGET_ALERT_STATUSES`, `AiBudgetAlertStatus`, and `AiBudgetAlert` live in `packages/domain/src/ai.ts`. `StoredAiBudgetAlert` is the database alias. Keep the tuple, SQL checks, normalizer, UI labels, tests, and docs synchronized.
- `createBudgetAlerts` runs only after an accepted reservation inside its transaction and workspace lock. For each configured capped scope it compares committed cost by integer cross-multiplication, inserts every reached threshold with `ON CONFLICT DO NOTHING`, and creates minimized `ai.budget_alert_created` audits.
- Window keys are UTC day `YYYY-MM-DD`, UTC month `YYYY-MM`, and exact Campaign UUID. Deduplication also includes threshold, exact cap, and currency. At most fifteen candidate alerts can be considered per reservation because policy permits five thresholds across three scopes.
- `AiRepository.listBudgetAlerts(workspaceId, currency)` returns at most fifty, open first then newest. `acknowledgeBudgetAlert` repeats writer authorization, tenant-binds and locks the alert, is idempotent after acknowledgment, and audits the closed transition.
- `GET /api/v1/ai-policy` includes `budgetAlerts`. `PATCH /api/v1/ai-budget-alerts/[id]/acknowledge` accepts only `{ workspaceId }` plus the UUID path ID; viewer, cross-tenant, malformed UUID, and undeclared-field requests fail closed.
- `/ai-settings` shows open count, threshold/scope, committed versus cap snapshots, a non-technical window label, retained acknowledged state, and a writer acknowledgment control. Alert actions do not change policy, reservations, usage, routing, provider work, or Campaign execution.
- Live acceptance proved 401 unauthenticated rejection, 422 strict input, 200 creation/list/acknowledgment/replay, SSR alert content, acknowledged state, no overflow or console errors, zero retained QA records, and a clear port.
- Release gate: clean lint; 140 TypeScript tests including twenty-one live PostgreSQL tests; every workspace typecheck; 61-page optimized Next.js build; companion web/native checks; three Rust tests; clean/idempotent application of all 50 migrations.
- Unsigned installer `Market Me Companion_0.51.0_x64-setup.exe`: 2,950,273 bytes; SHA-256 `413b7d44b678b2c5854813e845740719884c1bd731e3a84c028378309c4ec858`.

Known limitations: alerts are generated only by a newly accepted reservation and are not retroactively reconciled when a cap or threshold is edited. Acknowledgment is shared rather than per-user. There is no email, push, webhook, scheduler, subscription, escalation, snooze, reopen, global badge, pagination beyond fifty, or external delivery history. Alerts do not implement the configured cap behavior after denial.

Rollback retains additive migration `0050_ai_budget_alerts.sql`, alert/audit history, and acknowledgment evidence. Stop 0.51 reservation writes before deploying 0.50 so new threshold crossings are not silently missed. Release 0.50 ignores retained alerts; spend reservation and enforcement remain compatible.

## Release 0.52 AI spend-exception approval operations

- Migration `0051_ai_spend_exception_approvals.sql` adds `ai_spend_exception_request`, state/consumption checks, tenant-bound denied-reservation/requester/resolver references, pending/recent indexes, and unique nullable `ai_spend_reservation.spend_exception_request_id`. Final SHA-256: `e536db747f55ce96a147d3bf84f1f406bfc14067fe32f6ad719eeeb4688851b1`.
- `AI_SPEND_EXCEPTION_STATUSES`, `AiSpendExceptionStatus`, and `AiSpendExceptionRequest` define the public state. `AiSpendExceptionRequestWrite` is deliberately limited to workspace, denial ID, and justification; never add client-owned amount/scope/provider fields.
- `requestSpendException(input, actor, asOf?)` repeats writer authorization, locks and validates one `denied`/`require_approval` reservation, trims 1-to-1,000-character justification, and returns the existing request on replay. The lease is exactly 24 hours.
- `decideSpendException` repeats owner/admin/approver authorization, accepts only approved/rejected plus an optional 1-to-1,000-character note, persists expiry on a late pending decision, returns identical decision replay, and rejects conflicting terminal state.
- `authorizeApprovedSpend` is server-only. It locks workspace/request, rejects unapproved/expired/currency-drifted work, returns the linked reservation after replay, otherwise copies the exact denied estimate into one 15-minute exception-linked hold, stamps consumption, audits, and evaluates normal budget alerts atomically.
- `listSpendExceptions(workspaceId, currency, asOf?)` returns at most fifty pending-first records and derives expiry for reads. Public clients cannot select `asOf`.
- `POST /api/v1/ai-spend-exceptions` accepts strict workspace/denial/justification input with writer access. `PATCH /api/v1/ai-spend-exceptions/[id]/decision` accepts strict workspace/approved-or-rejected/optional-note input with approval access. There is intentionally no consume endpoint.
- `/ai-settings` exposes eligible recent denials, bounded justification, pending/open state, approval actions by role, expiry, and consumed state. Justification and decision notes are authorized UI data but never enter audits.
- Live acceptance proved 401 and strict 422 boundaries, 201 request, 200 approval/replay, policy listing, SSR states, internal consumption/replay, exact exception linkage, no console errors/overflow, zero QA residue, and a clear port.
- Release gate: clean lint; 142 TypeScript tests including twenty-two live PostgreSQL tests; every workspace typecheck; 62-page optimized Next.js build; companion web/native checks; three Rust tests; clean/idempotent application of all 51 migrations.
- Unsigned installer `Market Me Companion_0.52.0_x64-setup.exe`: 2,944,122 bytes; SHA-256 `6423f8b00ef64716768382a88a4c734c0ef8fc95dd2b2901000f78d838bdd839`.

Known limitations: consumption is an internal repository method and is not yet wired to a paid provider call site. Approval is workspace-shared with no assignment, second approver, self-decision restriction, cancellation, revocation, reminder, or per-user inbox. The UI does not collect optional decision notes. `pause_ai_work`, `lower_cost_fallback`, and `limited_drafts` remain denial outcomes without executors.

Rollback retains migration `0051_ai_spend_exception_approvals.sql`, requests, decisions, audits, and reservation links. Stop exception creation/decision/consumption before deploying 0.51. The older release ignores the table/link and continues enforcing ordinary reservations, but pending/approved requests cannot be consumed until 0.52 returns.

## Release 0.53 deterministic AI cap-response operations

- Release 0.53 has no database migration or new environment variable. It reads the existing Release 0.50 denial and Release 0.49 policy records; all 51 migrations remain checksum-guarded and idempotent.
- `AI_CAP_RESPONSE_ACTIONS`, `AiCapResponseAction`, and `AiCapResponsePlan` live in `packages/domain/src/ai.ts`. Keep the closed tuple, UI labels, planner branches, schemas, tests, and documentation synchronized.
- `planAiCapResponse` lives in `packages/generation/src/gateway.ts`. Its third-party-looking input is deliberately named `noPaidAdapters`: callers must supply only descriptors whose execution path is known not to require a paid reservation. Never pass the general provider registry until adapter billing class is an enforced contract.
- `AiRepository.getSpendReservation(workspaceId, reservationId, asOf?)` is a tenant-bound read used to obtain authoritative denial state. `asOf` exists for tests/internal evaluation and must not become client input.
- `POST /api/v1/ai-cap-response-preview` accepts exactly `{ workspaceId, deniedReservationId }`, requires same-workspace read access and a persisted denial, and returns `{ data, meta: { execution: false, providerCall: false } }`. Unknown fields and non-denied rows fail with 422; the route is read-only.
- `GET /api/v1/ai-policy` includes plans for bounded recent denials as `capResponses`. `/ai-settings` derives the same plans server-side and labels the next safe outcome beneath each denial. Rendering does not invoke the preview route or mutate state.
- Live acceptance proved unauthenticated 401, undeclared-field 422, safe text fallback, unsupported-image manual outcome, two policy projections, SSR labels/reasons, responsive 1,280-pixel layout, no console errors, exact QA cleanup, and a clear port.
- Release gate: clean lint; 147 TypeScript tests including twenty-two live PostgreSQL tests; every workspace typecheck; 63-page optimized Next.js build; companion web/native checks; three Rust tests; clean/idempotent application of all 51 migrations.
- Unsigned installer `Market Me Companion_0.53.0_x64-setup.exe`: 2,944,409 bytes; SHA-256 `b462a7104e4fa15e3e08ed6a4ca086a7e4642b6d694dee9c4172d5d84d0c8276`.

Known limitations: plans are advisory and do not automatically pause queued work, invoke the local grounded-template generator, create an exception request, consume an approval, or call a provider. No general adapter billing-class metadata exists. Only text and structured output have a known no-paid fallback; image, transcription, embedding, reranking, moderation, and tool use become visible manual outcomes. Hosted-provider credentials, current pricing, tokenizers, fallback execution, and cost authenticity remain future work.

Rollback requires no schema change. Deploy 0.52 after stopping 0.53 clients; retained policy and reservation rows remain compatible, while the cap-response projection/API and UI labels disappear. No provider compensation or workflow-history migration is required because planning creates no external or durable side effect.

## Release 0.54 capability-oriented AI assistant operations

- Release 0.54 has no migration, key, environment variable, provider credential, or durable assistant state. All 51 migrations remain checksum-guarded and idempotent.
- `AI_ASSISTANT_PROFILE_IDS`, `AI_ASSISTANT_ACTIONS`, `AI_ASSISTANT_OUTPUT_KINDS`, `AiAssistantProfile`, and `AiAssistantSelection` live in `packages/domain/src/ai.ts`. Treat the tuples as closed public contracts and update tests/docs/UI together.
- `AI_ASSISTANT_PROFILES`, the exhaustive `automaticAssistantByAction` dictionary, and `selectAiAssistant` live in `packages/generation/src/gateway.ts`. Every mapped required capability must appear in its profile's capabilities.
- The seven automatic mappings are understand-content/content-analyst, prepare-copy/copy-assistant, plan-campaign/campaign-planner, discovery/discovery-assistant, eligible-interaction/conversation-assistant, rules-rights-claims/compliance-reviewer, and results-experiments/performance-analyst.
- `GET /api/v1/ai-policy` returns `{ assistants: { selectionMode: "automatic", profiles, selections } }` and `meta.assistantExecution: false`. No assistant mutation route exists in this release.
- `/ai-settings` displays seven responsive role cards with action, purpose, required capability, and output kinds, plus a persistent explanation that deterministic services retain execution validation.
- Acceptance proved all seven roles render exactly once, automatic state and the guardrail text are visible, 1,280-pixel viewport/document widths have no horizontal overflow, and a fresh page has no console errors.
- Release gate: clean lint; 149 TypeScript tests including twenty-two live PostgreSQL tests; every workspace typecheck; 63-page optimized Next.js build; companion web/native checks; three Rust tests; all 51 migrations remain clean/idempotent.
- Unsigned installer `Market Me Companion_0.54.0_x64-setup.exe`: 2,944,260 bytes; SHA-256 `feb435041ee8323c13f3cffcc43e58e2c461257574ec837c8edd59e71291c0e6`.

Known limitations: selection is automatic and static; there is no workspace override, per-action persistence, profile/provider/model assignment, profile availability state, assistant-specific prompt configuration, orchestration runtime, or assistant execution. Profiles declare intended gateway capabilities but do not prove an adapter exists; most remain unavailable through the current local adapter. The existing deterministic Conversation Assistant generator is presented consistently but is not invoked from this catalog.

Rollback requires no schema, workflow, or provider compensation. Deploy 0.53 after stopping 0.54 clients; the assistant API projection and UI cards disappear while AI policy, spend, and usage data remain compatible.

## Release 0.55 governed assistant-assignment operations

- Migration `0052_ai_assistant_assignments.sql` adds `workspace_ai_assistant_assignment`, closed action/profile checks, one row per workspace/action, tenant-bound creator/updater membership references, and a recent-update index. Final SHA-256: `c9d2c1b896076bcf1cce4fca90c6eab40b1f0a7c3853187254e96fa3a6324a2f`.
- `AiAssistantAssignment` is the domain projection. `WorkspaceAiAssistantAssignmentsWrite` and `StoredAiAssistantAssignment` live in database models. Automatic is represented by row omission, never a sentinel profile string.
- `isAiAssistantCompatible` checks declared action plus the action's required capability. `selectAiAssistant(action, profileId?)` emits automatic false for a validated workspace choice and throws on role drift.
- `AiRepository.listAssistantAssignments` returns tenant-scoped rows. `replaceAssistantAssignments` validates zero-to-seven unique compatible pairs, repeats owner/admin/editor authorization, replaces all rows atomically, and writes `ai.assistant_assignments_saved` with only closed pairs.
- `GET /api/v1/ai-assistant-assignments` requires same-workspace read access. `PUT` uses a strict schema and writer access, then returns explicit rows plus all seven effective selections with `execution: false` and `providerSelection: false`.
- `GET /api/v1/ai-policy` now includes assignment rows, `automatic | workspace` selection mode, and resolved profiles. `/ai-settings` offers Automatic plus only compatible roles, disables controls for non-writers, saves the replacement set, and preserves the choice after refresh.
- Live acceptance proved seven controls/defaults, compatible Conversation Assistant selection for copy preparation, persistence after reload, strict 422 extra-field rejection, unauthenticated 401 GET/PUT, restoration to zero rows, zero current-page console errors, no overflow, and exact audit/row cleanup.
- Release gate: clean lint; 152 TypeScript tests including twenty-three live PostgreSQL tests; every workspace typecheck; 64-page optimized Next.js build; companion web/native checks; three Rust tests; clean/idempotent application of all 52 migrations.
- Unsigned installer `Market Me Companion_0.55.0_x64-setup.exe`: 2,946,324 bytes; SHA-256 `ac7b4ba577c53c086d2948b08e57364b409d14d6e7b21100a44602a83ab76116`.

Known limitations: preferences are workspace-wide and action-based, not Brand/Campaign/user scoped. Replacement has no optimistic revision token, approval flow, scheduled activation, history UI, or restore button beyond choosing Automatic and saving. Provider/model selection, prompt configuration, availability-aware preference fallback, and assistant execution remain out of scope. Removing future profile compatibility requires a migration/repair plan before deploying the catalog change.

Rollback retains additive migration `0052_ai_assistant_assignments.sql`, assignment rows, and audits. Stop 0.55 assignment writes before deploying 0.54; the older release ignores explicit rows and resolves every action automatically. No provider/workflow compensation is required because preferences have no execution side effect.

## Release 0.56 privacy-bounded AI analysis-cache operations

- Migration `0053_ai_analysis_cache.sql` adds `ai_analysis_cache_entry`, exact seven-part primary key, closed capability and bounded-string/hash/byte/hit/TTL checks, tenant-bound creator membership, and active/recent-hit indexes. Final SHA-256: `0be6beeeed83edc2ba1d1642028cd36f09be608f35f2fe73f1d2446bcba3bb06`.
- `AiAnalysisCacheKey`, generic `AiAnalysisCacheEntry`, and `AiAnalysisCacheSummary` live in `packages/domain/src/ai.ts`; generic `AiAnalysisCacheWrite` and `StoredAiAnalysisCacheEntry` live in database models.
- `storeCachedAnalysis(input, actor, asOf?)` repeats writer authorization, validates key/60-second-to-30-day TTL, canonicalizes finite acyclic JSON, enforces 256-KiB UTF-8 size, hashes the canonical result, retains an active first writer, and refreshes only an expired row. `asOf` is test/internal only.
- `getCachedAnalysis(key, asOf?)` is server-only and atomically increments hit count/time only for an exact unexpired tuple. It exposes the payload to the internal caller; no browser route wraps it.
- `getAnalysisCacheSummary(workspaceId, asOf?)` aggregates active count, result bytes, hits, and dates. `GET /api/v1/ai-policy` and `/ai-settings` expose only this metadata, with explicit server-only-payload language.
- Live acceptance projected one active entry, three hits, and 42 bytes without placing the seeded result in visible page data; responsive width was 1,265 within a 1,280 viewport, no current-page console errors occurred, and the exact row was removed.
- Release gate: clean lint; 153 TypeScript tests including twenty-four live PostgreSQL tests; every workspace typecheck; 64-page optimized Next.js build; companion web/native checks; three Rust tests; clean/idempotent application of all 53 migrations.
- Unsigned installer `Market Me Companion_0.56.0_x64-setup.exe`: 2,945,574 bytes; SHA-256 `a8d58bc10dc92ea698255b71575dc6941bea04ce38c7341ed57e077d5b652ba5`.

Known limitations: no production generator/provider is wired through the cache, so reuse requires an explicit internal caller. There is no list/read-payload/browser-write/invalidate/purge endpoint, background expired-row cleanup, per-feature TTL policy, quota, encryption envelope, cache-hit usage-ledger linkage, Campaign/Brand scope beyond context revision, or distributed stampede lease. Summary totals scan active tenant rows and may require rollups at scale.

Rollback retains additive migration `0053_ai_analysis_cache.sql` and cached results. Stop 0.56 cache writers/readers before deploying 0.55; the older release ignores the table. Existing rows expire naturally but should remain subject to retention/security policy; no provider or workflow compensation is required.

## Release 0.57 assistant readiness and qualitative-cost operations

- Release 0.57 has no migration, key, provider credential, environment variable, price catalog, tokenizer, or execution path; all 53 migrations remain clean/idempotent.
- `AiAssistantWorkPlan` lives in `packages/domain/src/ai.ts`. `planAiAssistantWork` lives in `packages/generation/src/gateway.ts` and composes `selectAiAssistant` with `routeAiTask`; keep those boundaries separate from provider invocation.
- `estimatedCost` is the selected descriptor's `AiCostLevel` only. `currencyEstimateAvailable` and `execution` are fixed false. Never convert Low/Medium/High into money without a versioned server-owned rate card and bounded unit forecast.
- `GET /api/v1/ai-policy` includes seven `assistants.workPlans` derived from stored assignment rows plus current policy. `/ai-settings` shows Ready/Not configured, qualitative cost, and the first reason on each assistant card.
- Current automatic results are six Ready/Low actions through Market Me grounded text/structured output and one Not configured Discovery action because no approved rerank adapter exists.
- Live acceptance proved six ready labels, one unavailable label, seven reasons, visible qualitative-rate-card guidance, 1,265-pixel document width in a 1,280 viewport, and no current-page console errors.
- Release gate: clean lint; 155 TypeScript tests including twenty-four live PostgreSQL tests; every workspace typecheck; 64-page optimized Next.js build; companion web/native checks; three Rust tests; all 53 migrations remain clean/idempotent.
- Unsigned installer `Market Me Companion_0.57.0_x64-setup.exe`: 2,952,328 bytes; SHA-256 `630d01d691856eca21f8840a93bff436e0c0f85be6f9592d0ded586638cfdd8f`.

Known limitations: cost is a qualitative descriptor class, not a currency range or package/Campaign total. There is no rate-card persistence, effective dating, provider price synchronization, token/unit estimator, output range, batch/cache discount calculation, taxes/rounding, unusual-cost explanation, quote expiry, or reservation linkage. Readiness is request-time policy/descriptor projection and not a health SLA.

Rollback requires no schema, workflow, provider, or cache compensation. Deploy 0.56 after stopping 0.57 clients; the policy `workPlans` projection and card readiness labels disappear while assistant assignments, cache, spend, and usage remain compatible.

## Release 0.58 effective-dated provider rate-card operations

- Migration `0054_ai_provider_rate_cards.sql` enables `btree_gist`, adds parent `ai_provider_rate_card` and child `ai_provider_rate_component`, and seeds the approved Market Me grounded-template 1.0.0 USD zero-request card. Final SHA-256: `36f827aa5aeda3b7f0c10d826509ef47901fb5c9f3afa3847d1e524d90894233`.
- The parent uses UUID identity, bounded provider/model strings, closed status, uppercase currency, half-open effective dates, HTTPS or `market-me://` source reference, lowercase SHA-256, and verification/approval timestamps. The child primary key is `(rateCardId, kind, unit)`.
- `priceMicros` is an integer from 0 through 1,000,000,000,000 in millionths of the major currency unit; `unitQuantity` is 1 through 1,000,000,000. Request components must use request units with quantity one.
- A partial GiST exclusion constraint rejects overlapping approved windows for the same provider/model-family/currency. Before approving a successor, end or retire the prior open window at the successor's exact start; do not edit historical prices in place.
- `AiRepository.listEffectiveProviderRateCards(asOf?, currency?)` is server-only and returns approved exact-time cards plus normalized components. `getProviderRateCardSummary(asOf?)` publishes aggregate count/currencies/latest verification with monetary estimates fixed false.
- `GET /api/v1/ai-policy` and `/ai-settings` expose the aggregate summary only. There is deliberately no browser create/update/delete endpoint and no workspace member can submit prices, source hashes, status, or effective dates.
- Live acceptance showed one effective USD card, explicit Money estimates: Not yet guidance, 1,265-pixel document width in a 1,280 viewport, and only normal React/HMR development console messages.
- Release gate: clean lint; 156 TypeScript tests including twenty-five live PostgreSQL tests; every workspace typecheck; 64-page optimized Next.js build; companion web/native checks; three Rust tests; all 54 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.58.0_x64-setup.exe`: 2,943,265 bytes; SHA-256 `739b681ac18e15dc601ca4855ac28018db04b20ff6fdaf6ffda8dec513a73ae1`.

Known limitations: Release 0.58 has no provider price synchronizer, privileged rate-card administration service, signing authority, foreign-exchange conversion, tokenizer/meter adapter, bounded input/output forecast, tier/batch/cache discount rule, tax, rounding/minimum calculator, quote expiry, package/Campaign rollup, unusual-cost explanation, reservation binding, or historical invoice reconciliation. The seeded zero card covers the deterministic local template only and is not evidence that local infrastructure has zero operating cost.

Rollback retains additive migration `0054` and its source evidence. Stop 0.58 readers before deploying 0.57; the older release ignores both tables and the rate-card summary disappears. Do not drop `btree_gist` because another application or future migration may depend on it. No provider, spend, workflow, cache, or connector compensation is required.

## Release 0.59 bounded AI cost-quote operations

- Migration `0055_ai_rate_card_currency_units.sql` adds required `minor_unit_exponent` 0 through 4, backfills existing cards with 2, then removes the default so every future writer must choose currency semantics explicitly. Final SHA-256: `b5ce6791fa61a72ab90f50e452eb2de0d25d2e3cf85b3c30216b6ee8640d226e`.
- `AiUsageQuantityForecast`, `AiCostQuoteLine`, and `AiCostQuote` live in `packages/domain/src/ai.ts`. `AiCostQuoteError` and pure `quoteAiCost` live in `packages/generation/src/rate-card.ts`; do not move provider invocation or reservation writes into this calculator.
- Forecasts are unique by non-request kind/unit, ordered integer bounds from 0 through 1,000,000,000, and mandatory for every non-request card component. Missing, duplicate, unused, inverted, unsafe, or unit-mismatched data fails closed.
- Calculation uses arbitrary-precision integer multiply and ceiling division for each component, then ceiling-converts total micros to the declared currency minor unit. It rejects results beyond JavaScript's safe integer range rather than truncating.
- Quotes live 30 through 900 seconds, default 300, and are shortened to an earlier rate-card boundary. Positive upper cost sets `reservationRequired`; `reservationAuthorized` and `execution` always remain false.
- The policy response includes a minimized current request-only reference quote. `/ai-settings` displays `$0.00` provider charge for the local deterministic template with explicit no-reservation/no-execution guidance; it does not expose line prices or source data.
- Live acceptance proved one effective USD card, `$0.00` reference provider charge, explicit non-authority wording, 1,265-pixel width in a 1,280 viewport, and no browser errors.
- Release gate: clean lint; 160 TypeScript tests including twenty-five live PostgreSQL tests; every workspace typecheck; 64-page optimized Next.js build; companion web/native checks; three Rust tests; all 55 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.59.0_x64-setup.exe`: 2,949,509 bytes; SHA-256 `ebb862888d13e152e8d1d1d884fb3364c5b7d37bf479f4d7d6d43200c71d4e13`.

Known limitations: only the fixed request-only local reference is wired into the policy/page. There is no hosted provider/card, capability-specific metering forecast, tokenizer/meter version, public quote request route, tier/batch/cache discount, taxes, foreign exchange, quote persistence/signature, package/Campaign rollup, unusual-cost explanation, reservation linkage, or quote-to-settlement reconciliation.

Rollback retains migrations 0054/0055 and rate evidence. Stop 0.59 quote readers before deploying 0.58; the prior release ignores `minor_unit_exponent` and does not calculate quotes. Existing spend, cache, workflow, and provider state need no compensation because quotes authorize nothing.

## Release 0.60 durable AI cost-quote operations

- Migration `0056_ai_cost_quote_reservation_binding.sql` adds immutable `ai_cost_quote` records and nullable `ai_spend_reservation.cost_quote_id`, with tenant-bound foreign keys, campaign/member validation, 15-minute maximum lifetime, canonical hash shape, lookup indexes, and one-use uniqueness. Final SHA-256: `6e676939fef74680595e081756c3e03bbc3473c139a53a0a8962ab311dd6ff10`.
- `AiRepository.createCostQuote` authorizes a workspace writer, validates Campaign tenancy, reselects the exact approved/effective card inside the transaction, calculates with `quoteAiCost`, canonicalizes recursively sorted JSON, hashes with SHA-256, and writes a minimized `ai.cost_quote_created` audit event.
- `AiRepository.reserveQuotedSpend` accepts only workspace, quote ID, and UUID idempotency. It locks the quote and workspace, recomputes the hash, rejects expiry/tampering/zero cost/reuse/currency drift, derives every reservation field server-side, evaluates caps, and inserts the quote link atomically. Identical replay returns the existing row.
- `POST /api/v1/ai-cost-quotes` creates a durable quote; `POST /api/v1/ai-cost-quotes/[id]/reserve` consumes a positive quote once. Both use strict Zod schemas and writer authorization. `GET /api/v1/ai-policy` exposes minimized quote targets and requirement kinds/units, never prices, source references, hashes, or authority.
- `/ai-settings` shows Quote ledger ready and explains that durable quote identity does not reserve or execute work. Live acceptance verified the minimized target, durable metadata, zero-charge creation, zero-charge reservation rejection, strict extra-field rejection, unauthenticated rejection, responsive layout, and no browser errors.
- Release gate: clean lint; 161 TypeScript tests including twenty-six live PostgreSQL tests; every workspace typecheck; 65-page optimized Next.js build; companion web/native checks; three Rust tests; all 56 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.60.0_x64-setup.exe`: 2,946,930 bytes; SHA-256 `0095588a3b47b244b2fceb386c02018359c5e623435d6cafdaf2ead54ec859aa`.

Known limitations: there is no quote list/detail UI, retention purge, signature for external trust, hosted-provider card, automatic action forecast, provider execution, or quote-to-settlement line reconciliation. The reservation path deliberately duplicates part of ordinary reservation logic and should later share one internal transaction helper. The hash detects application-mediated drift; a database superuser able to rewrite both data and hash still requires database ACLs, immutable audit, and protected backups.

Rollback retains migration 0056, stored quotes, and nullable reservation links. Stop the 0.60 quote/reservation APIs before deploying 0.59; that release safely ignores the quote table and link. Do not remove quote rows that already support reservation audit history.

## Release 0.61 assistant metering-profile operations

- Release 0.61 adds no migration or environment variable. `packages/generation/src/metering.ts` owns `AI_ASSISTANT_METERING_PROFILES` and pure `planAiAssistantCost`; keep provider invocation, persistence, and client configuration out of this module.
- Every action profile uses `assistant-metering-v1`, a server-owned `assistant.<action>` feature, exact capability, and bounded input/output token envelope. Character-card components multiply token bounds by four; cached input is zero through the input maximum; request components need no forecast.
- Unsupported second/image meters, unavailable routing, capability/profile drift, missing cards, and provider/model-family mismatch return an unavailable preview. Do not add a conversion without a reviewed per-capability meter contract.
- `POST /api/v1/ai-assistant-cost-quotes` accepts only workspace ID, optional same-workspace Campaign ID, closed action, and effective rate-card UUID. It loads policy and assistant assignments, constructs the server-owned preview, then calls `createCostQuote` with derived capability, feature, and forecasts.
- `GET /api/v1/ai-policy` includes seven minimized `assistants.costPreviews` and two true metadata flags. `/ai-settings` displays six current `$0.00` local planning quotes, one unavailable rerank action, and 6-of-7 action quote coverage without creating a quote.
- Live acceptance verified the action profile status, 6-of-7 coverage, 1,265-pixel document width in a 1,280 viewport, authenticated durable creation, server-owned `assistant.prepare_copy`, strict extra-field rejection, unavailable-action rejection, unauthenticated rejection, and complete QA cleanup.
- Release gate: clean lint; 166 TypeScript tests including twenty-six live PostgreSQL tests; every workspace typecheck; 66-page optimized Next.js build; companion web/native checks; three Rust tests; all 56 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.61.0_x64-setup.exe`: 2,945,153 bytes; SHA-256 `7bac4c621ace6413591a47bcfff1d88093e9c36f939876b3ade712232048bc3c`.

Known limitations: profiles are static planning envelopes, not payload/tokenizer-derived forecasts, and no provider executor currently enforces their maximum output. Only token and character text meters are supported. There is no hosted adapter/card, workspace profile customization, action-quote history UI, create/reserve button, provider execution, or quote-to-settlement line reconciliation. The local request-only card produces `$0.00` provider charge and does not represent infrastructure or labor cost.

Rollback has no schema step. Stop the 0.61 action-quote route and deploy 0.60; the cost-preview projection and UI labels disappear. Durable quotes created through 0.61 use the unchanged Release 0.60 table/contract and remain valid audit evidence.

## Release 0.62 quote-ledger operations

- Release 0.62 adds no migration or environment variable. `AiRepository.listCostQuotes` validates a 1-through-100 limit, checks membership inside the read transaction, filters by exact workspace, joins an optional linked reservation, and sorts newest first.
- `GET /api/v1/ai-cost-quotes?workspaceId=<uuid>&limit=<1-100>` returns only `AiCostQuoteLedgerItem` projections. It shares the route with strict generic quote POST but never returns forecasts, lines, hashes, provider/model identity, rate evidence, creator IDs, or provider payloads.
- `/ai-settings` loads 20 recent items. `AiQuoteLedger` renders scope, formatted cost range, derived state, quote/expiry time, and reservation linkage. Empty state is explicit and no opening/read action mutates data.
- Each quoted assistant card now has a writer-only Create durable quote button using its exact server preview action/card. The ledger offers Reserve maximum only for active positive unlinked quotes; it generates a UUID command key and refreshes after success.
- Live acceptance verified six create controls, the empty state, durable creation through the actual button, immediate active ledger readback, no-reservation guidance for the zero card, 1,265-pixel document width in a 1,280 viewport, minimized API fields, bounded/extra-query rejection, and unauthenticated rejection.
- Release gate: clean lint; 167 TypeScript tests including twenty-six live PostgreSQL tests; every workspace typecheck; 66-page optimized Next.js build; companion web/native checks; three Rust tests; all 56 migrations clean/idempotent.
- Unsigned installer `Market Me Companion_0.62.0_x64-setup.exe`: 2,946,436 bytes; SHA-256 `6b135b6ca99193ba85a7057759fc1982c9df270fc2248f812796a552e38e9f52`.

Known limitations: the UI shows only the latest 20 quotes and has no pagination, detail view, Campaign-name hydration, filtering, export, retention purge, or deletion. The local card is zero-charge, so live UI acceptance cannot exercise a positive reservation. Browser-generated idempotency keys survive one in-flight click but not an ambiguous page reload; production command UX should persist a stable key before transmission. There is still no hosted provider execution or measured line reconciliation.

Rollback has no schema step. Stop the 0.62 history/read and operator controls before deploying 0.61. The earlier release continues to understand every stored quote/reservation and safely ignores the ledger projection.

## Release 0.63 governed routing-preference operations

- Additive migration `0057_ai_routing_preferences.sql` creates `workspace_ai_routing_preference`; immutable release checksum: `af2ae97674b9c2ceda60702c8bcc08bdded5ea9f88d0b6c08cd14278a4fbd770`. Never edit an applied migration; add a successor migration instead.
- No environment variable or global mutable variable is added. `BUILT_IN_AI_ADAPTERS` remains the server-owned registered adapter list. `AI_ASSISTANT_ACTIONS` and `requiredAiCapabilityForAction` define the closed seven-action vocabulary and its required capability.
- `AiAdapterIdentity` carries only `provider` and `model`. `AiRoutingRequest.preferredAdapter` is optional. `AiRoutingPreference` adds workspace/action/audit timestamps. `WorkspaceAiRoutingPreferencesWrite.preferences` is the atomic replacement list, where `[]` means Automatic everywhere.
- `isAiRoutingPreferenceCompatible(action, identity, adapters)` performs exact provider/model lookup plus approved/capability checks. `routeAiTask` applies hard eligibility filters before exact preference selection; never move preference matching ahead of privacy, approval, availability, tools, context, or local-only filters.
- `AiRepository.listRoutingPreferences(workspaceId)` performs a tenant-authorized read. `replaceRoutingPreferences(input, actorUserId)` requires writer access, rejects duplicate/unknown/incompatible records, replaces the workspace mapping transactionally, and emits `ai.routing_preferences_saved` with minimized action/provider/model details.
- `GET /api/v1/ai-routing-preferences?workspaceId=<uuid>` returns tenant-bound records and `{ automaticByOmission: true, execution: false }`. Strict PUT accepts only `{ workspaceId, preferences: [{ action, provider, model }] }`; client API keys, endpoints, prices, policy overrides, and extra fields return 422.
- `/api/v1/ai-policy` includes preferences in `assistants.routingPreferences` and applies them to readiness and preview planning. `/api/v1/ai-assistant-cost-quotes` applies the same stored preference before durable quote persistence, preventing plan/quote route divergence.
- `AiRoutingPreferences` is an advanced writer form. It renders seven action selectors from registered approved capability-compatible descriptors, marks registered unavailable choices, and keeps Automatic as the default. Discovery currently has no explicit option because the built-in local adapter does not support rerank.
- Release gate: clean lint; 171 TypeScript tests including twenty-seven live PostgreSQL tests; all workspace typechecks; 67-page optimized Next.js build; companion web/native checks; three Rust tests; all 57 migrations clean and idempotent.
- Live acceptance: seven selectors rendered; six actions offered the local exact route and rerank remained Automatic-only; explicit Prepare copy persisted after refresh; work stayed Ready with a `$0.00` server quote; desktop widths 1,280 and 1,265 and mobile widths 620 and 619 had no horizontal overflow; extra-field and incompatible writes returned 422; unauthenticated write returned 401; browser console had no errors; QA rows/audits/quotes/reservations were restored to zero.
- Unsigned installer `Market Me Companion_0.63.0_x64-setup.exe`: 2,946,728 bytes; SHA-256 `387d25b5f3e2e44819ceac9c868c521e27c219bb82fee03832a19b2fa9f8dc31`.

Known limitations: the catalog is static and in-process; there is no hosted-provider registration, administrator onboarding, credential lifecycle, endpoint configuration, durable health observation, fallback chain, deployment-specific availability, or provider invocation. A preference stores no rate-card identity, and a policy/catalog change can deliberately make the action unavailable. The only registered route is the zero-provider-charge local template adapter, and it does not support rerank.

Rollback: retain additive migration 0057 and its data. Stop the 0.63 preference route and preference-aware readers before deploying 0.62. Release 0.62 ignores the table; stored preferences cause no provider or external side effect and can be cleared before or after rollback.

## Release 0.64 durable adapter-registry operations

- Additive migration `0058_ai_provider_adapter_registry.sql` is applied and immutable with SHA-256 `4aea717120027b1a8c85f412c881878d570d7a9f5295c6bad67e09b2c84265d4`. It creates the adapter and normalized capability tables, status/capability indexes, the local seed, and a restrictive preference-to-adapter foreign key.
- No environment variable or mutable global is added. `BUILT_IN_AI_ADAPTERS` remains a pure-function/test default for non-database consumers; every web runtime route now passes records returned by `AiRepository.listProviderAdapters`.
- `AiProviderAdapterDescriptor.requiresPaidReservation` is mandatory. `AiProviderAdapterRegistryEntry` adds source and timestamps; `AiProviderAdapterRegistrySummary` holds aggregate counts. Do not infer no-paid eligibility from qualitative `cost`; cap planning filters the explicit boolean.
- `listProviderAdapters()` joins normalized capabilities, orders exact identities, removes null availability reasons, and normalizes timestamps. `getProviderAdapterRegistrySummary()` derives safe totals and distinct-capability count from the same projection.
- `replaceRoutingPreferences` now checks writer authority and then validates against catalog rows within the replacement transaction. HTTP schema validation remains structural; repository validation is the authoritative dynamic identity/approval/capability check and maps to 422.
- Strict membership-checked `GET /api/v1/ai-provider-adapters?workspaceId=<uuid>` returns adapters, summary, and literal `{ serverGoverned: true, credentials: false, mutation: false, execution: false }`. Extra query fields return 422, unauthenticated reads return 401, and POST is 405.
- The AI policy, routing preview, cap-response preview, cost-quote, and AI settings paths all use the durable list. The settings registry panel is informational and exposes no administrator mutation or secret input.
- Release gate: clean lint; 173 TypeScript tests including twenty-eight live PostgreSQL tests; all workspace typechecks; 68-page optimized Next.js build; companion web/native checks; three Rust tests; all 58 migrations clean and idempotent.
- Live acceptance inserted a temporary approved rerank record, observed registry count 2, dynamic selector presence, rerank Ready/Medium routing, and no monetary quote without a matching card. API metadata was secret-free/read-only, desktop/mobile layouts had no overflow, and cleanup restored one adapter, two capabilities, zero preferences/quotes/reservations, and no browser errors.
- Unsigned installer `Market Me Companion_0.64.0_x64-setup.exe`: 2,944,728 bytes; SHA-256 `495c8f933c1d8ff67cfdaffc74f27466237ef411897411f5202e1836621585e0`.

Known limitations: registry mutation is migration-managed only; there is no administrator API/UI, change audit, approval workflow, retirement history, deployment scope, scheduled health probe, staleness policy, provider credential/endpoint/account binding, capability discovery, rate-card foreign key, fallback chain, or provider invocation. `is_available` is stored metadata and must not be represented as a live service-level guarantee.

Rollback: do not remove migration 0058. Before deploying 0.63, ensure every retained preference points to the seeded built-in identity, then stop 0.64 registry reads and deploy 0.63, whose static default can continue routing the built-in adapter. Retain both registry tables and the preference foreign key; they have no external side effect.
## Release 0.65 build and operations

### Credential-vault configuration

- Set `AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY` to a cryptographically random 32-byte value encoded as base64. It is a separate server-only key domain; never reuse an authentication, session, connector, database, provider, or signing secret.
- Local development has an ignored `.env.local` value. `.env.example` documents the variable without a secret. Never print, return, commit, place in client-prefixed configuration, or include this key in audit evidence.
- The current `v1` envelope uses AES-256-GCM through the shared authenticated encryption helper. Production requires managed KMS/HSM custody, rotation, re-encryption, access monitoring, backup/restore policy, and incident procedures before customer credentials are stored.

### Implementation map

- `packages/database/migrations/0059_ai_provider_connections.sql` owns the connection schema. Its immutable SHA-256 checksum is `f10ce5acb930dcc0bfe613225d960e223dea8ad02c09a818ff079b7b095f72e2`.
- `packages/domain/src/ai.ts` owns the closed provider/status constants and safe connection projection. The database models distinguish encrypted write/storage values from public connection state.
- `GET` and `POST /api/v1/ai-provider-connections` list safe state and save/rotate an encrypted credential. `POST /api/v1/ai-provider-connections/[provider]/revoke` performs replay-safe cryptographic erasure. Strict schemas reject extra fields, unknown providers, and keys outside 20-through-4,096 characters.
- `apps/web/src/components/ai-provider-connections.tsx` renders three closed provider cards. Password inputs are controlled transiently, clear after mutation, are never repopulated, and do not expose stored values.
- Saving always reports Unverified. There is deliberately no provider verifier, health probe, adapter-availability mutation, hosted model record, endpoint override, capability discovery, price synchronization, rate-card binding, provider invocation, self-hosted connection, or actual-usage settlement in this release.

### Verification and release artifact

- Release gate: clean lint; every workspace typecheck; 175 TypeScript tests including 29 live PostgreSQL tests; 69-page Next.js production build; companion web/native checks; three Rust tests; all 59 migrations applied and repeat-safe twice.
- Live acceptance saved and rotated a fake QA-only value through the UI, proved authenticated ciphertext did not contain the plaintext, proved API/policy projections excluded encrypted/fingerprint/key/token fields, enforced 422 and 401 boundaries, and rendered without overflow at 1,280, 1,265, 620, and 619 pixels.
- Revocation erased ciphertext, fingerprint, and key version. A replay preserved the three-event audit count. Cleanup left zero provider connections, connection audit events, preferences, quotes, and reservations; no real provider key, provider network request, or provider API was used.
- Unsigned installer `Market Me Companion_0.65.0_x64-setup.exe` is 2,947,136 bytes with SHA-256 `67217efaa587bf784c02c970007a9e017f91de000a31d6f9b33727b45bdbb32a`.

Rollback retains migration 0059 and its table, stops the 0.65 routes and UI, and deploys 0.64. The older release safely ignores the additive connection data. Do not drop encrypted records as part of an application rollback.

## Release 0.66 build and operations

### Provider-verification implementation map

- `apps/web/src/server/ai-provider-verification.ts` owns the closed request dictionary, `AI_PROVIDER_VERIFICATION_TIMEOUT_MS = 5000`, normalized failure union, response-body disposal, and injectable fetch boundary used by unit tests.
- Official contracts: OpenAI Models (`https://platform.openai.com/docs/api-reference/models`), Claude List Models (`https://platform.claude.com/docs/en/api/models/list`), and Gemini Models/authentication (`https://ai.google.dev/api/models` and `https://ai.google.dev/api`). Reconfirm these primary sources before changing URLs, versions, or headers.
- `getProviderConnectionVerificationTarget` requires writer authority and returns encrypted material only inside server code. `recordProviderConnectionVerification` applies a fingerprint-guarded state change and minimized audit event after network I/O; it never holds a database transaction open during the provider call.
- `POST /api/v1/ai-provider-connections/[provider]/verify` accepts only `{ workspaceId }`, decrypts with `AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY`, makes the fixed request, clears its local plaintext variable, and returns the safe connection projection plus literal false generation/adapter/execution metadata.
- The provider cards add Verify credential/Verify again controls and render only safe status, time, or normalized error. Verification is explicit and is not triggered by page load, key save, background work, routing, or quotation.
- This release adds no migration. Migration 0059 remains immutable at SHA-256 `f10ce5acb930dcc0bfe613225d960e223dea8ad02c09a818ff079b7b095f72e2`.

### Verification and release artifact

- Release gate: clean lint; every workspace typecheck; 185 TypeScript tests including 29 live PostgreSQL tests; 69-page Next.js production build; companion web/native checks; three Rust tests; all 59 migrations repeat-safe twice.
- Unit tests prove exact fixed URLs/headers for all three providers, no key in URL/body, redirect rejection configuration, stable Anthropic version, redacted 400/401/429/5xx/network outcomes, and bounded timeout. Database acceptance proves writer-only secret access, verified/error transitions, stale-fingerprint rejection, safe audits, and revocation.
- Live acceptance used one fake QA-only key against the official OpenAI models endpoint, observed a redacted credential rejection, verified encrypted persistence and secret-free audits, enforced extra-field/unknown-provider 422 and unauthenticated 401 responses, then revoked and erased the credential.
- Cleanup restored zero provider connections, connection audits, preferences, quotes, and reservations; the registry retained one seed adapter and two capabilities. Browser console errors were zero and port 3000 was stopped.
- Unsigned installer `Market Me Companion_0.66.0_x64-setup.exe` is 2,943,978 bytes with SHA-256 `0c31dccc6381b5f55ab3f8b75cc9d1fb6b26f2b3a742e899032a13ba3774247e`.

Known limitations: verification is manual and point-in-time. It does not retain model catalogs, account identity, quotas, regions, billing state, capability evidence, scheduled health, staleness/expiry, retry scheduling, per-provider observability, administrator alerts, adapter linkage, invocation, or settlement. A successful real-key live check awaits an operator-provided provider credential.

Rollback has no schema step. Stop the 0.66 verify route and controls and deploy 0.65; stored Verified or Error rows remain valid under migration 0059, and a later key save returns either row to Unverified.
## Release 0.67 build and operations

- Migration 0060 checksum: `489c339939f2922e8ef8a8ad740924677f64175b41b5840d6444039b5b4ee35e`. It stores normalized workspace-private model inventory and retirement history.
- Discovery is writer-only and Verified-only, bounded to ten seconds/one mebibyte/1,000 records, and fails closed on malformed, duplicate, empty, oversized, or incomplete paginated responses.
- Gate: 192 TypeScript tests, 29 live PostgreSQL tests, 69 pages, 3 Rust tests, and 60 migrations twice. Installer `Market Me Companion_0.67.0_x64-setup.exe`: 2,947,978 bytes; SHA-256 `0d45051e5d19a2303e992c567caff9471e100219e34b3fff5ce17441526826d2`.
- Live QA used a simulated Verified connection and two fixture models, proved UI rendering and rotation retirement, then cleaned all rows. No provider call or real verification was claimed.

## Release 0.68 build and operations

### Candidate-governance implementation map

- Migration `packages/database/migrations/0061_ai_workspace_adapter_candidates.sql` is applied and immutable at SHA-256 `ed5c24988e6132e6062a0611e95fe958cf98f571cf98334b0c5941171f5dbd60`. Add a successor migration for every schema change; never edit 0061.
- `packages/domain/src/ai.ts` owns `AI_ADAPTER_CANDIDATE_STATUSES`, `AiAdapterCandidateStatus`, and `AiWorkspaceAdapterCandidate`. `packages/database/src/models.ts` owns submission/decision write shapes; these server inputs are distinct from the safe public projection.
- `packages/database/src/ai-repository.ts` owns `listWorkspaceAdapterCandidates`, `submitWorkspaceAdapterCandidate`, `decideWorkspaceAdapterCandidate`, validation, administrator authorization, safe selection, minimized audit helpers, and automatic retirement from credential/inventory lifecycle methods.
- `apps/web/src/server/ai-schema.ts` owns strict list/submit/decision schemas. `GET/POST /api/v1/ai-adapter-candidates` handles member reads and writer submissions; `POST /api/v1/ai-adapter-candidates/[id]/decision` handles owner/administrator decisions.
- `apps/web/src/components/ai-adapter-candidates.tsx` owns the transient candidate form. `CAPABILITY_LABELS` is a readonly presentation dictionary; `reviewNotes` is a local UUID-keyed dictionary; `activeModels` is a memoized flattened list of non-retired inventory. None is global mutable state or an authorization source.
- The settings page loads candidates separately from `providerAdapters`. Preserve this separation: an approved candidate must never appear in routing choices, assistant readiness, cap response, pricing, or invocation until a later deployment-governed registration release explicitly implements that transition.
- No environment variable or provider endpoint was added. Release 0.68 reuses the encrypted connection and model inventory boundaries from 0.65-0.67.

### Verification and release artifact

- Gate: clean lint; every workspace typecheck; 192 TypeScript tests including 29 live PostgreSQL tests; 70-route/page Next.js production build; companion frontend/native checks; three Rust tests; all 61 migrations repeat-safe twice.
- Live acceptance created an encrypted fake OpenAI connection through the actual UI, directly simulated Verified state plus two fixture inventory models, submitted and approved one two-capability candidate, and confirmed the global registry remained one adapter/two capabilities with routing/activation/execution false.
- Rotating the fake key through the UI retired both inventory and the approved candidate. Unauthenticated list returned 401; an extra query field returned 422. Browser diagnostics contained ten informational/development entries and zero errors.
- Revocation returned cryptographic erasure. Cleanup deleted the restrictive candidate before the connection/model rows, removed six QA audit events, left zero QA connections/models/candidates/audits, and stopped port 3000. No real provider request or successful provider verification was claimed.
- Unsigned installer `Market Me Companion_0.68.0_x64-setup.exe`: 2,946,518 bytes; SHA-256 `b706200b5699b656c23d350a4a1b3b07fbda68ba341250e74855dbad1a83f400`.

Known limitations: no automatic evidence verification, deployment adapter-registration mutation, hosted rate-card linkage, endpoint/account binding, health/staleness service, provider invocation, measured usage, settlement, bulk review, paging, notification, or candidate deletion endpoint exists. Approved remains evidence-reviewed only.

Rollback retains migration 0061 and its rows. Stop the candidate routes/component and deploy 0.67; the older application ignores the additive tables. Do not delete rows solely for application rollback because they contain governance history and have no external side effect.

## Release 0.69 build and operations

### Deployment-staging implementation map

- Migration `packages/database/migrations/0062_ai_workspace_adapter_registrations.sql` is applied and immutable at SHA-256 `178efb02b65482d83a22da9ed2f5883a3ade07a9b9a526fa2f478a304e1b2be9`. Never edit it; add a successor migration.
- `packages/domain/src/ai.ts` owns registration status/type projections. `packages/database/src/models.ts` owns the narrow create/retire write shapes. No registration write accepts provider, model, capabilities, rates, endpoints, availability, or execution state from clients.
- `AiRepository.listWorkspaceAdapterRegistrations`, `registerWorkspaceAdapter`, and `retireWorkspaceAdapterRegistration` own tenant reads and administrator lifecycle. `retireWorkspaceAdapterRegistrations` is the shared automatic drift helper called by credential and inventory transitions.
- `selectWorkspaceAdapterRegistrations` is the only safe database projection. `auditAdapterRegistration` and aggregate retirement auditing exclude model, capability, and fingerprint details.
- `GET/POST /api/v1/ai-adapter-registrations` provides member list and administrator registration. `POST /api/v1/ai-adapter-registrations/[id]/retire` provides administrator retirement. Both mutations normalize malformed JSON to strict 422 responses.
- `AiAdapterRegistrations` owns transient selection and retirement form state. The page passes candidates/registrations separately from `providerAdapters`; preserve that separation until a future activation design explicitly changes routing.
- No environment variable, provider endpoint, mutable global, provider request, or new credential surface was added.

### Verification and release artifact

- Gate: clean lint; every workspace typecheck; 192 TypeScript tests including 29 live PostgreSQL tests; 71-route/page Next.js build; companion frontend/native checks; three Rust tests; all 62 migrations repeat-safe twice.
- Live acceptance created an encrypted fake connection, simulated Verified state and two models, submitted/approved a two-capability candidate, registered it, manually retired it, re-registered it, and proved rotation retired candidate, inventory, and registration together.
- Global registry counts remained one adapter/two capabilities. Unauthenticated list returned 401; extra-field and empty/malformed mutation bodies returned 422 without parser stack traces. Browser diagnostics had sixteen development/informational entries and zero errors.
- Revocation erased ciphertext/fingerprint. Cleanup deleted registration before candidate and connection rows, removed ten QA audits, left zero QA connections/models/candidates/registrations/audits, and stopped port 3000. No provider call or real verification was claimed.
- Unsigned installer `Market Me Companion_0.69.0_x64-setup.exe`: 2,945,048 bytes; SHA-256 `226afcb2f71c5dd601158db90ca30ea95a38fa6146799d8f61a6d09fb1fe6a66`.

Known limitations: deployment staging has no invocation implementation, endpoint/account binding, routing visibility, hosted rate card, health probe, availability state, spend reservation, provider call, actual usage, settlement, paging, bulk operation, notification, or delete endpoint.

Rollback retains migration 0062 and its rows. Stop the registration routes/panel and deploy 0.68; every retained record remains outside routing and execution. Do not drop governance history during application rollback.

## Release 0.70 build and operations

### Hosted pricing-evidence implementation map

- Migration `packages/database/migrations/0063_ai_workspace_adapter_rate_bindings.sql` is applied and immutable at SHA-256 `82aa292a9e4d4bb28282942882457cc129b738de2bc167e168e25d80fcf60048`. It adds tenant/currency uniqueness and the restrictive pricing-binding table and indexes. Never edit it; add a successor migration.
- `packages/domain/src/ai.ts` owns the closed status tuple and safe projection. `packages/database/src/models.ts` owns the narrow bind/retire inputs. No write accepts prices, components, provider/model identity, source evidence, fingerprints, availability, routing, or execution fields.
- `AiRepository.listWorkspaceAdapterRateBindings`, `bindWorkspaceAdapterRateCard`, and `retireWorkspaceAdapterRateBinding` own authorized lifecycle operations. The shared `retireWorkspaceAdapterRateBindings` helper is called whenever a registration is retired manually or by credential/inventory drift.
- `selectWorkspaceAdapterRateBindings` is the authoritative safe projection and derives evidence currency at read time. `auditAdapterRateBinding` and aggregate retirement auditing deliberately minimize model, rate-card, evidence, component, and fingerprint data.
- `GET/POST /api/v1/ai-adapter-rate-bindings` provides member reads and owner/administrator binding. `POST /api/v1/ai-adapter-rate-bindings/[id]/retire` provides administrator retirement. Empty, malformed, unknown, and extra-field bodies normalize to strict 422 responses.
- `AiAdapterRateBindings` owns presentation-only selection and retirement form state. `ai-settings/page.tsx` supplies a single request-time `pricingAsOf` to effective cards and bindings so the page cannot present mismatched time slices.
- No new environment variable, provider endpoint, credential field, mutable global, background job, network request, routing adapter, or invocation implementation was added.

### Verification and release artifact

- Gate: clean lint; every workspace typecheck; 192 TypeScript tests including 29 live PostgreSQL tests; 72-page/route Next.js production build; companion frontend/native checks; three Rust tests; all 63 migrations repeat-safe twice.
- Live acceptance created a fake encrypted OpenAI connection through the UI, simulated Verified state and two inventory models, inserted one exact Approved fixture rate card with input/output components, then submitted, approved, registered, and bound the candidate through the UI.
- Manual binding retirement/re-bind, registration retirement with automatic binding retirement, re-registration/re-bind, and credential-rotation retirement all passed. The deployment registry remained one adapter/two capabilities and every pricing projection retained false routing/activation/execution authority.
- Valid unauthenticated reads and mutations returned 401. Empty, malformed, and extra-field authenticated mutation bodies returned 422. Browser diagnostics contained ten informational/development entries and zero errors.
- Revocation erased ciphertext/fingerprint. Cleanup removed the binding, registration, candidate, connection/models, fixture rate card/components, and all 16 QA audit events; every scoped count returned zero, port 3000 stopped, and temporary logs were removed. No provider call or real verification was claimed.
- Unsigned installer `Market Me Companion_0.70.0_x64-setup.exe`: 2,948,031 bytes; SHA-256 `1d2c05935ffd868e5f2f83518fd3ee0bd1cc7165768833caf294900d3e1bfbff`.

Known limitations: pricing readiness is evidence only. There is no invocation adapter, tenant endpoint/account configuration, health probe, availability state, routing exposure, spend reservation triggered by a hosted registration, provider call, actual usage, reconciliation, settlement, paging, bulk operation, notification, deletion API, or automatic provider-price synchronization.

Rollback retains migration 0063 and its rows. Stop the pricing-binding routes/panel and deploy 0.69; Release 0.69 ignores the additive table. Every retained record remains non-routable and non-executable. Do not edit or drop the applied migration or governance history.

## Release 0.71 build and operations

### Invocation-contract implementation map

- Migration `packages/database/migrations/0064_ai_workspace_invocation_bindings.sql` is applied and immutable at SHA-256 `9d8042a5a40f29aebca0fbe446f7692f66489718f60c6d3a8afd4356808346a8`. It adds three server-owned contract descriptors, exact tenant/provider/rate constraints, binding lifecycle tables, and indexes. Never edit it; add a successor migration.
- `packages/domain/src/ai.ts` owns contract/binding status tuples and safe projections. `packages/database/src/models.ts` owns narrow configure/retire inputs. No write accepts transport, credential mode, schema versions, source evidence, provider/model, implementation, health, routing, or execution fields.
- Repository methods list contracts/configurations, configure, retire, safely project, audit, and cascade retirement. Pricing retirement and registration/credential/inventory drift share automatic invocation-retirement logic.
- `GET/POST /api/v1/ai-adapter-invocation-bindings` provides member catalog/list and owner/administrator configure. `POST /api/v1/ai-adapter-invocation-bindings/[id]/retire` provides administrator retirement; strict schemas normalize empty/malformed/extra input to 422.
- `AiAdapterInvocationBindings` owns transient UI state and exact-filters current pricing plus provider contracts for operator clarity. No new environment variable, public endpoint, provider request, credential field, health job, mutable global, or execution path was added.

### Verification and release artifact

- Gate: clean lint; every workspace typecheck; 192 TypeScript tests including 29 live PostgreSQL tests; 73-page/route production build; companion frontend/native checks; three Rust tests; all 64 migrations repeat-safe twice.
- Live QA configured, manually retired/reconfigured, pricing-retired/rebound/reconfigured, registration-retired/re-registered/rebound/reconfigured, and credential-drift-retired an OpenAI fixture contract while the global registry remained one adapter/two capabilities.
- Valid unauthenticated list/create returned 401; empty, malformed, and extra-field authenticated create returned 422. The authorized list returned three contracts, one retained binding, and false implementation/health/routing/execution metadata. Browser diagnostics contained ten entries and zero errors.
- Revocation erased ciphertext/fingerprint. Cleanup removed invocation, pricing, registration, candidate, connection/models, fixture card/components, and all 24 QA audits; all scoped counts returned zero, port 3000 stopped, and exact temporary logs were removed. No provider I/O or real verification occurred.
- Unsigned installer `Market Me Companion_0.71.0_x64-setup.exe`: 2,942,582 bytes; SHA-256 `00276b5aab64cc6e178eb30c140989d9ad96108187021e6c130381d486add4a4`.

Known limitations: contracts are non-executable internal descriptors. There is no request serializer/parser implementation, tenant endpoint/account binding, health probe, staleness, availability, circuit breaker, routing exposure, hosted spend execution, provider call, actual usage, reconciliation, settlement, paging, bulk operation, notification, or delete endpoint.

Rollback retains migration 0064, catalog rows, and tenant lifecycle evidence. Stop the invocation-binding routes/panel and deploy 0.70; Release 0.70 ignores the additive tables. Every row is implementation-unavailable, non-routable, and non-executable.

## Release 0.72 build and operations

- Migration `0065_ai_workspace_invocation_health.sql` is immutable at SHA-256 `a540bd5f4fa32e6a363887d81b24d18c278172fba1bc8732e2b44240fe75c129`; it adds append-only tenant observations plus latest/expiry indexes. Use a successor migration.
- `AI_ADAPTER_HEALTH_TTL_MS` is the server-only five-minute expiry constant. Repository target/record methods revalidate administrator authority and every configuration/pricing/credential/hash prerequisite before and after network I/O.
- `POST /api/v1/ai-adapter-invocation-bindings/[id]/probe` accepts only `workspaceId`, uses the configured vault, calls the existing bounded verifier, and stores no provider body. Empty/malformed/extra input returns 422.
- The UI displays not-checked, healthy/unhealthy current evidence, or stale evidence plus checked/expiry time and safe message. It continues to state implementation unavailable, health readiness false, routing disabled, and execution disabled.
- Gate: clean lint; 192 TypeScript tests including 29 live PostgreSQL tests; every typecheck; 73 pages/routes; companion/native checks; 3 Rust tests; all 65 migrations repeat-safe twice.
- Live QA made one real non-generative model-list request with a fake encrypted key, recorded safe credential rejection, proved five-minute expiry/staleness, 401/422 boundaries, drift retirement, zero browser errors, erasure, and zero-row cleanup of 13 audits/data.
- Unsigned installer `Market Me Companion_0.72.0_x64-setup.exe`: 2,945,471 bytes; SHA-256 `e117d89b30776f3cd3edb6c45b5eeb5e881d3936ee400d385f16531cdb0e6455`.

Known limitations: reachability is not implementation health. There is no serializer/parser, tenant endpoint/account binding, scheduler, automatic periodic probe, circuit breaker, availability/routing activation, provider generation, usage reconciliation, settlement, paging, bulk operation, notification, or delete API.

Rollback stops the probe route/UI and deploys 0.71 while retaining migration 0065 observations. They are ignored by 0.71 and have no routing/execution authority.

## Release 0.73 build and operations

- Migration `0066_ai_provider_text_codecs.sql` is applied and immutable at SHA-256 `9691591122f4325d826ec2509f458728ffa16671826e38455f12edd2a98aef00`. It adds `codec_available`/`codec_version`, retires v1 descriptors, and seeds three Approved v2 codec contracts. Use a successor migration for every change.
- `packages/connectors/src/ai-provider-codecs.ts` owns all request builders, response parsers, frozen limits, error codes, and canonical contract dictionaries. `packages/connectors/src/ai-provider-codecs.test.ts` owns provider-native positive, refusal/block/incomplete, bound, hash, and hostile tool/multi-candidate/malformed fixtures.
- Keep the codecs pure. A caller may supply only provider/model/text/output bounds; it must not add HTTP, credentials, tenant lookup, spend, routing, persistence, logging, retries, or fallback to this module. Those require later separately reviewed layers.
- Official review references were the OpenAI Responses quickstart/API output model, Anthropic Messages create/message schemas, and Google `models.generateContent` request/response reference. Re-review primary specifications and bump contract/codec/schema versions plus source hashes before changing provider shapes.
- Gate: clean lint; 210 TypeScript tests including 29 live PostgreSQL tests; every typecheck; 73 pages/routes; companion/native checks; 3 Rust tests; all 66 migrations repeat-safe twice.
- Live acceptance saw all three v1 rows retired, all three v2 rows Approved with `text-codec-v1` and implementation false, valid unauthenticated catalog access at 401, an absent generation route at 404, the revised AI settings explanation, and four browser diagnostic entries with zero errors. No QA data or audits were created.
- Unsigned installer `Market Me Companion_0.73.0_x64-setup.exe`: 2,945,329 bytes; SHA-256 `b794f6c891ef811eac8f923a47f70ba9d3263ea1b281861e31ac439756ba06d1`.

Known limitations: no provider generation network call exists. Missing layers include fixed endpoint/header transport, KMS-backed generation credential injection, tenant account restrictions, policy/routing selection, spend reservation binding, retry/circuit-breaker controls, redacted telemetry, response persistence policy, usage reconciliation, settlement, and global disable.

Rollback deploys 0.72 while retaining migration 0066. Release 0.72 ignores codec columns and v2 rows; v1 remains retired and no retained row grants execution authority.

## Release 0.74 build and operations

- Migration `0067_ai_provider_text_transport.sql` is applied and immutable at SHA-256 `5058ad487eed6155e52b9e31670ee236ae767ee07e77d9902dca6c8c628fdb0c`. It adds transport metadata, retires v2, and seeds three Approved v3 rows. Use a successor migration.
- `packages/connectors/src/ai-provider-transport.ts` owns fixed endpoints/headers, bounded response reading, timeout/abort, HTTP normalization, and the combined v3 contract dictionary. `ai-provider-transport.test.ts` owns exact URL/header/body assertions and hostile status/content/size/timeout fixtures.
- Never pass browser input directly as an API key or call this function from a client component. A future server orchestration layer must decrypt a current workspace key, revalidate configuration after await boundaries, clear the local key reference, reserve spend first, and persist only approved minimized evidence.
- The transport has no retry. Add retries only with a durable provider idempotency design, ambiguity handling, rate-limit backoff, reservation lease policy, and tests proving one billable action.
- Gate: clean lint; 222 TypeScript tests including 29 live PostgreSQL tests; every typecheck; 73 pages/routes; companion/native checks; 3 Rust tests; all 67 migrations repeat-safe twice.
- Live acceptance saw v1/v2 retired and three Approved v3 `text-codec-v1`/`fixed-https-text-v1` rows with provider endpoint policies and implementation false; valid unauthenticated catalog access was 401, generation route 404, and four browser diagnostics had zero errors. No real provider request, QA row, or audit was created.
- Unsigned installer `Market Me Companion_0.74.0_x64-setup.exe`: 2,947,948 bytes; SHA-256 `ba2a7422d381100a8e67de7dc383bb56517927a15606ce7d75f3d586859de241`.

Known limitations: internal transport is not authorization or orchestration. Missing layers include durable invocation records/idempotency, exact quote/reservation consumption, current health/circuit decision, response-to-workflow binding, actual usage reconciliation, settlement, telemetry/redaction review, incident response, and global disable.

Rollback deploys 0.73 while retaining migration 0067. Release 0.73 ignores transport columns; retired v2 and implementation-unavailable v3 rows prevent accidental fallback or execution.

## Release 0.75 build and operations

- Migration `0068_ai_provider_implementation_readiness.sql` is applied and immutable at SHA-256 `2bfc8096e84b2129b95131ab25f88e1cdbec3bff4099caf09f50b552c41a7ee8`. It drops the old hard-false check, adds `implementation_version`, adds the codec+transport implementation invariant, retires v3, and seeds three Approved v4 rows. Use a successor migration.
- `AI_PROVIDER_TEXT_IMPLEMENTATION_CONTRACTS` and `AI_PROVIDER_TEXT_IMPLEMENTATION_CONSTRAINTS` live beside the codec/transport implementation and are hash-verified by connector tests.
- Repository configure requires implementation, codec, and transport true in addition to all prior tenant/pricing/evidence checks. Health target/record operations repeat those implementation prerequisites around the external probe await boundary.
- Binding reads derive `healthReady` from actual contract implementation plus the existing current healthy evidence projection. Do not persist or client-supply readiness, and do not reuse global contract `healthReady:false` as a tenant value.
- Gate: clean lint; 223 TypeScript tests including 29 live PostgreSQL tests; every typecheck; 73 pages/routes; companion/native checks; 3 Rust tests; all 68 migrations repeat-safe twice.
- Database lifecycle acceptance proved initial not-ready, fresh healthy ready, reconfiguration stale/not-ready, unhealthy not-ready, and drift/retirement not-ready while routing/activation/execution remained false. Live catalog/UI/API acceptance showed only v4 Approved, internal implementation messaging, valid unauthenticated 401, no generation route 404, and four browser diagnostics with zero errors.
- Unsigned installer `Market Me Companion_0.75.0_x64-setup.exe`: 2,945,943 bytes; SHA-256 `cd834c8828dcee2e69be5307b90a739f54897d70f29c03f48676d1668497735b`.

Known limitations: a ready binding is still not invocable by product code. Add durable invocation identity/state, authorization, exact quote/reservation consumption, server-only credential handoff, post-await drift revalidation, ambiguity policy, minimized output persistence, actual usage reconciliation, settlement, monitoring, and a kill switch before a route.

Rollback deploys 0.74 while retaining migration 0068. Release 0.74 ignores implementation version/readiness promotion and has no generation route; all retained rows remain outside routing and public execution.

## Release 0.76 build and operations

- Migration `0069_ai_text_invocation_intents.sql` is applied and immutable at SHA-256 `97d851b0081a4f37aaca549b9b341abd42e776f6088f7e4d344c974b8c476e16`. It creates the intent ledger and composite reservation/quote evidence constraint. Use a successor migration for every change.
- Repository entry points are `listWorkspaceTextInvocationIntents`, `prepareWorkspaceTextInvocationIntent`, and `cancelWorkspaceTextInvocationIntent`. Preparation validates with `AI_TEXT_CODEC_LIMITS`, hashes prompt material with SHA-256, and performs all tenant/readiness/spend checks in one transaction.
- Routes are `GET|POST /api/v1/ai-text-invocation-intents` and `POST /api/v1/ai-text-invocation-intents/[id]/cancel`. Zod objects are strict; preparation is workspace-writer-only and list is membership-checked.
- The AI settings `AiTextInvocationIntents` panel lists only minimized safe projections, offers healthy bindings and active assistant text reservations, and explicitly labels preparation as no-provider-I/O.
- Integration coverage proves exact replay, conflicting replay rejection, private 64-hex hashes, no raw prompt in safe JSON, current authorization, cancellation, and reservation release.
- Gate: clean lint; 224 TypeScript tests including 29 live PostgreSQL tests; every typecheck; 74 generated production pages; companion/native checks; 3 Rust tests; all 69 migrations repeat-safe twice.
- Live acceptance: health 200 at version 0.76.0; unauthenticated intent read 401; generation route 404; AI settings panel rendered; two browser diagnostics and zero errors; intent table empty after QA cleanup.
- Unsigned installer `Market Me Companion_0.76.0_x64-setup.exe`: 2,946,107 bytes; SHA-256 `d4ccaa6baadbd0a7035b45cfba007561f4a373e740512e652abeb696c1df5670`.

Known limitations: preparation is not execution. Add a separate durable attempt/ambiguity model, post-I/O drift handling, minimized output retention, usage reconciliation, atomic settlement/release, circuit/kill controls, monitoring, and workflow binding before exposing provider generation.

Rollback deploys 0.75 while retaining migration 0069. The prior release does not read the intent table, and the retained rows cannot call a provider or settle spend.

## Release 0.77 build and operations

- Migration `0070_ai_text_invocation_attempts.sql` is applied and immutable at SHA-256 `b3def7a74110f40ff52b16a72c7bd066a77794f4237392c5eb10b01faee85711`. Use a successor migration for every change.
- Repository entry points are `claimWorkspaceTextInvocationAttempt`, `completeWorkspaceTextInvocationAttempt`, `reconcileAbandonedTextInvocationAttempts`, and `listWorkspaceTextInvocationAttempts`.
- `apps/web/src/server/ai-text-invocation.ts` is the internal orchestrator. It claims before decrypt/call, invokes fixed transport at most once, treats transport failure as ambiguous, and returns output only after successful post-await finalization.
- There is no POST/execute route. `GET /api/v1/ai-text-invocation-attempts` is membership-checked, strict, and safe-read-only; AI settings shows minimized evidence and explicit no-retry semantics.
- Tests cover claim ordering, one call, decryption failure, ambiguous transport, prompt substitution, duplicate claim, hash-only persistence, safe projections, and abandoned-claim reconciliation.
- Gate: clean lint; 227 TypeScript tests including 29 live PostgreSQL tests; every typecheck; 75 generated pages; companion/native checks; 3 Rust tests; all 70 migrations repeat-safe twice.
- Live acceptance: health 200/version 0.77.0; unauthenticated attempt read 401; generation route 404; attempt UI rendered; two browser diagnostics and zero errors; attempt table empty after QA cleanup.
- Unsigned installer `Market Me Companion_0.77.0_x64-setup.exe`: 2,947,382 bytes; SHA-256 `391a488892c25887e3a0a71951776694fe10d52f8eedf410726343b8de2bd986`.

Known limitations: no product workflow calls the executor. Next work must bind successful in-memory output to a governed artifact and reconcile provider usage to the reserved quote before settlement. Add operator ambiguity handling, monitoring, circuit/kill controls, and incident procedures before a public route.

## Release 0.78 implementation notes

- Migration `0071_ai_text_outputs_and_reconciliation.sql` is applied and immutable at SHA-256 `2e98c922f25106199ce6175068a05ed20dd26dbf42d406968d988192079c5b03`. Never edit it after deployment; add a successor migration.
- `apps/web/src/server/ai-text-invocation.ts` owns the single-call orchestration. `encryptionKey` is the deployment-provided base64 32-byte `AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY`; provider credentials and successful output use separate AES-GCM envelopes but the same configured AI vault boundary in this release. Neither value is global mutable state.
- The executor-local `apiKey` string is cleared in `finally`. `startedAt` and `latencyMs` are request-scoped values. `result.response.text` is transient and is withheld from `ExecutePreparedTextInvocationResult` after finalization.
- Repository entry points added in 0.78 are `listWorkspaceTextOutputArtifacts`, `listWorkspaceTextInvocationReconciliations`, `getWorkspaceTextOutputArtifactReadTarget`, and `reviewWorkspaceTextOutputArtifact`. The first two return safe arrays; the third is server-private ciphertext access; the fourth performs the one-way review transition.
- `completeWorkspaceTextInvocationAttempt` owns output insertion and billing reconciliation. Important locals are `exactCostMinor` (defined only when exact pricing succeeds), `reconciliationReason` (one closed quarantine reason), `usageEventId` (defined only for settlement), and `outputHash` (private SHA-256 evidence).
- Exact forecasts are arrays with one `{kind:"input", unit:"token"}` and/or `{kind:"output", unit:"token"}` object only when the rate card contains the corresponding component. Each has `minimumUnits === maximumUnits === actual token count`; request components need no forecast.
- APIs are `GET /api/v1/ai-text-outputs` for safe artifacts plus reconciliation, `GET /api/v1/ai-text-outputs/[id]` for approver-only server-side decryption, and `POST /api/v1/ai-text-outputs/[id]/review` for accept/discard. No execute/generate route exists.
- AI settings renders provider-attempt evidence, encrypted output review, and reconciliation. Only approval roles receive review controls. Accepted output remains an artifact; later Draft integration must perform a separately designed lineage-preserving transition.
- The database integration test covers generic-settlement bypass rejection, encrypted-at-rest/private projection, approval authorization, terminal acceptance, exact one-cent settlement, linked usage, missing-usage quarantine, held reservation, duplicate-claim rejection, and abandoned-attempt ambiguity.
- Full gate: clean lint; 227 TypeScript tests including 29 live PostgreSQL tests; every workspace typecheck; 76 generated pages; companion build/native check; 3 Rust tests; all 71 migrations rebuilt and replayed idempotently.
- Live gate: health 200/version 0.78.0; unauthenticated output and attempt reads 401; generation route 404; output/reconciliation UI rendered; browser console had zero warnings and zero errors.
- Unsigned installer `Market Me Companion_0.78.0_x64-setup.exe`: 2,943,061 bytes; SHA-256 `f2bac27977dd957c2a831c84f683ce4199ac1c26954cd294c700ca30e80a799d`.

Known limitations: no product workflow calls the internal executor; accepted artifacts do not yet become governed Draft versions. Quarantined or ambiguous attempts have no operator resolution workflow, and production still needs circuit breakers, a global kill switch, monitoring, KMS/HSM custody, and incident procedures.

## Release 0.79 implementation notes

- Migration `0072_ai_text_draft_proposals.sql` is immutable at SHA-256 `7b0d77ddec9b8768cbb88f650fbf43767990abdfd1a6ad1c2833e26fa150358e`.
- Repository methods are `attachWorkspaceTextOutputToDraft`, `listWorkspaceTextDraftProposals`, `getWorkspaceTextDraftProposalReadTarget`, and `dismissWorkspaceTextDraftProposal`.
- Important write inputs are UUID-only attachment lineage and a bounded dismissal note. No client sends plaintext, ciphertext, Draft body, claim array, version number, status, or authority flag.
- APIs are POST `/api/v1/ai-text-outputs/[id]/attach-draft`, GET `/api/v1/ai-text-draft-proposals`, GET `/api/v1/ai-text-draft-proposals/[id]`, and POST `/api/v1/ai-text-draft-proposals/[id]/dismiss`.
- AI settings offers accepted artifacts to current editable Drafts. Draft detail shows safe proposal metadata and writer-only decrypted review text beside the existing evidence-preserving revision form.
- Integration covers accepted-only attachment, exact source version, idempotency, editor access, ciphertext-free list projection, private read target, terminal dismissal, unchanged Draft content, and minimized authority flags.
- Gate: lint; 227 TypeScript tests including 29 live PostgreSQL; all typechecks; 77 generated pages; 3 Rust tests; all 72 migrations rebuilt/replayed twice. Live health was 200/version 0.79.0; unauthenticated proposal/output reads were 401; generation was 404; browser warnings/errors were zero.
- Installer `Market Me Companion_0.79.0_x64-setup.exe`: 2,944,020 bytes; SHA-256 `f634ca8f901e7d11545191fd8262bce95a0462b248453f14f1a20f679f313826`.

Known limitation: proposals are read-only references. Applying selected presentation changes to a successor Draft version still requires a separately validated, evidence-preserving mapping workflow.

## Release 0.80 implementation notes

- Migration `0073_ai_text_draft_proposal_application.sql` is immutable at SHA-256 `83cb24f7eb9bee17d4e2a971867b6f4fc7f1178d73a7072d8b6a495b7f8aaea9` after application to the main development database.
- The migration extends proposal lifecycle to `attached|applied|dismissed` and adds nullable `applied_by`, `application_note`, `applied_version_id`, `selected_fields`, and `applied_at`. One state constraint requires the complete fields for exactly one terminal path; composite foreign keys bind actor/workspace and successor/Draft.
- `AiTextDraftProposalApplyWrite` is the only new write model. Its important collections are `hashtags` (readonly author-selected list, maximum 20) and server-derived `selectedFields` (ordered subset of `lead_in|call_to_action|hashtags|alt_text`). No global mutable variable is introduced.
- `applyWorkspaceTextDraftProposal` validates presentation bounds, obtains writer authority, locks proposal/artifact/Draft/source version, derives changed fields, reads fact/evidence arrays, uses `DRAFT_FORMAT_CHARACTER_LIMITS`, and writes source supersession, one successor, copied claims/bindings, Draft pointer, proposal terminal metadata, and minimized audit in one transaction.
- Body content is not an input. Local `factClaims` is the evidence-bound source array; `facts` normalizes each claim's terminal punctuation; `body` combines only the selected non-factual lead-in with those facts; `appliedVersionId` is one server UUID; and `selectedFields` records presentation differences. These locals never become global state.
- Repository/API additions are `applyWorkspaceTextDraftProposal` and POST `/api/v1/ai-text-draft-proposals/[id]/apply`. The strict route payload is presentation-only and the response metadata states immutable successor, preserved evidence claims, approval required, and no publishing authority.
- Draft detail preloads current presentation values, shows decrypted accepted output as read-only reference, and requires the author to type/select final presentation fields and a change note. It never auto-parses model output. Applied history displays selected fields and successor-created state.
- Integration proves v1-to-v2 immutable lineage, evidence-ID preservation, deterministic body, source supersession, working successor, exact retry with only two versions, decrypt lockout, and forbidden applied-to-dismissed transition.
- Gate: lint; 227 TypeScript tests including 29 live PostgreSQL; all workspace typechecks; 77 generated pages; three Rust tests; all 73 migrations rebuilt and replayed twice. Live health returned 200/version 0.80.0; unauthenticated apply returned 401; unknown route returned 404; Draft UI console warnings/errors were zero.
- Installer `Market Me Companion_0.80.0_x64-setup.exe`: 2,945,893 bytes; SHA-256 `a113a53684c56249028faa277476ac825cf40d32643a21395113f609bfed1173`.

Known limitations: provider output is a manual review reference and no structured field extraction is trusted; the provider executor remains internal; quarantined/ambiguous attempts lack operator resolution; production still needs key lifecycle, circuit/kill controls, monitoring, incident response, and production identity.

Rollback may deploy 0.79 while retaining migration 0073 and its rows, but the 0.79 proposal projection does not understand terminal `applied` mutation metadata. Disable the proposal list/read/dismiss surfaces during that rollback and forward-deploy 0.80 before re-enabling them. Never drop or rewrite migration 0073 or applied successor lineage.

Rollback deploys 0.76 while retaining migration 0070. Attempt rows remain non-retryable evidence and are ignored by 0.76.

## Release 0.81 implementation notes

- Migration `0074_ai_execution_controls.sql` is immutable at SHA-256 `45b24bce669eb04dd863ea977957eff0b5cc12f60c06e216820de2348807d127`; the main `schema_migration` checksum matches.
- `AI_PROVIDER_EXECUTION_ENABLED=false` belongs in deployment configuration. `getServerConfiguration().aiProviderExecutionEnabled` is a Boolean derived by exact case-insensitive `true`; missing, empty, or any other value is false. Do not turn it on until an approved product execution route, monitoring, incident ownership, and managed secrets are in place.
- `ExecutionDependencies.deploymentExecutionEnabled` is required. `executePreparedTextInvocation` throws `AiProviderExecutionDisabledError` before repository claim when false. Future callers must pass the server configuration value rather than a browser field or mutable global.
- Repository methods are `getWorkspaceExecutionControl`, `saveWorkspaceExecutionControl`, `listWorkspaceProviderCircuits`, and `resetWorkspaceProviderCircuit`. Reads require membership; writes require owner/administrator at API and repository layers.
- `AI_EXECUTION_ENABLEMENT_MAX_MINUTES=1440` and `AI_PROVIDER_CIRCUIT_FAILURE_THRESHOLD=3` are module constants. `enabledUntil`, `consecutiveUnsafeOutcomes`, `opens`, `openedAt`, and `openedByAttemptId` are request/transaction locals, never globals.
- `recordProviderCircuitOutcome` is transaction-private. Success upserts closed/count zero; credential failure opens immediately; unknown or abandoned outcomes increment and open at the threshold; evidence drift is ignored. A newly open transition emits one minimized audit.
- Claim requires the active control and no open provider circuit in the same authorization query. Completion rechecks and locks the control; stop during the provider await converts success to `evidence_changed` and discards it. Open circuits affect new claims, while already linearized attempts retain normal ambiguity-safe finalization.
- APIs are GET/PUT `/api/v1/ai-execution-control` and POST `/api/v1/ai-provider-circuits/[provider]/reset`. Strict schemas reject extra fields and client-supplied actor/time/expiry/counter/open-state values.
- `AiExecutionControl` renders deployment/workspace/circuit/effective status, 15/60/240/1,440-minute choices, immediate stop, and reviewed reset controls. The deployment flag is safe state metadata; vault keys and credentials remain server-only.
- Integration verifies default stop, editor denial, timed owner enablement, successful use, output rejection after an in-flight stop, immediate credential circuit opening, blocked claim, editor reset denial, owner reset, and successful post-reset completion.
- Gate: lint; 229 TypeScript tests including 29 live PostgreSQL; all workspace typechecks; 78 generated pages; three Rust tests; all 74 migrations rebuilt on two empty databases. Live health returned 200/version 0.81.0; unauthenticated control mutation returned 401; unknown route returned 404; AI-settings browser warnings/errors were zero.
- Installer `Market Me Companion_0.81.0_x64-setup.exe`: 2,945,887 bytes; SHA-256 `3f6d81cbc58471c6ae24d5258abc7eece3182e03547f7e96518e1bb49326b2a1`.

Known limitations: no public execution route calls the executor. Circuits intentionally have no automatic half-open probe. Production still needs managed key rotation, monitoring/alert delivery, incident runbooks, moderation/retention policy, ambiguity/quarantine resolution, and production identity.

Rollback may retain migration 0074 but must first stop every workspace and set the deployment flag false. Release 0.80 does not enforce circuit rows, so no execution entry point may remain reachable during rollback. Preserve all circuit and audit evidence for forward recovery.

## Release 0.82 implementation notes

- Migration `0075_ai_text_invocation_resolutions.sql` is immutable at SHA-256 `d9ebadb4e73f321de60f34dd9cd189c31c009d92b4d2f558e67f32224d0cd1da`; the main `schema_migration` checksum matches.
- Repository additions are `listWorkspaceTextInvocationResolutions` and `resolveWorkspaceTextInvocation`. Resolution performs its own owner/administrator/approver check, locks all incident evidence, recognizes replay, and commits the decision, reservation transition, and minimized audit atomically.
- `AI_TEXT_INVOCATION_RESOLUTION_DISPOSITIONS` is the closed readonly tuple. Write fields are `attemptId`, `disposition`, optional `providerChargeMinor`, `evidenceReference`, and `note`; client-supplied actor, workspace, currency, provider, model, state, time, retry, and usage fields are rejected.
- `providerChargeMinor` is exact external-statement evidence, not a token estimate. Usage and `spendTotals` union settled resolutions at exact charge with one request, zero known token units, and null latency. Do not infer tokens without new evidence and a separate migration.
- Generic `releaseSpend` rejects a reservation linked to a text intent. Intent cancellation, known pre-request credential failure, and reviewed incident resolution are the only release paths. Credential-unavailable completion releases automatically because transport was never invoked.
- APIs are GET `/api/v1/ai-text-invocation-resolutions` and POST `/api/v1/ai-text-invocation-attempts/[id]/resolve`. The strict list/mutation schemas and response metadata make unknown usage and no retry explicit.
- `AiTextInvocationIntents` receives a `resolutions` collection, presents only eligible unresolved incidents, and requires disposition, evidence reference/note, and exact charge when applicable. History shows hold transition and permanent no-retry/unknown-usage state.
- Integration covers generic-release rejection, editor denial, statement settlement, quarantine projection, no-charge release, replay, aggregate totals, automatic pre-request release, and ineligible known failure. Cleanup deletes resolutions before reconciliations because the evidence foreign keys are intentional.
- Gate: lint; 230 TypeScript tests including 29 live PostgreSQL; all workspace typechecks; 79 generated pages; three Rust tests; all 75 migrations rebuilt on two empty databases. Live health returned 200/version 0.82.0; unauthenticated resolution mutation returned 401; unknown route returned 404; AI-settings browser warnings/errors were zero.
- Installer `Market Me Companion_0.82.0_x64-setup.exe`: 2,946,650 bytes; SHA-256 `bcf3324ba709c3818c9a01bc2299b9d196844f26449e932b1e084225ffd140b1`.

No mutable global variable was added. Important locals (`current`, `eligible`, `previousStatus`, `finalStatus`, and `resolutionId`) are transaction-scoped. Rollback to 0.81 must retain migration/data, disable resolution and reviewed-charge reporting surfaces, and keep execution stopped until 0.82 is restored.

## Release 0.83 implementation notes

- Migration `0076_ai_operational_incident_acknowledgements.sql` is immutable at SHA-256 `be686882d5648063b8c3fdb49242aaad35ffedadc1bb469608537d1c0bf4ee42`; the main `schema_migration` checksum matches.
- New closed tuples/types are `AI_OPERATIONAL_INCIDENT_TYPES`, `AI_OPERATIONAL_INCIDENT_SEVERITIES`, `AI_OPERATIONAL_READINESS_STATES`, `AiOperationalIncident`, and `AiOperationalReadiness`. Every incident keeps provider retry and execution authority literal false.
- Repository methods are `listWorkspaceAiOperationalIncidents`, `getWorkspaceAiOperationalReadiness`, and `acknowledgeWorkspaceAiOperationalIncident`. The list derives open circuits, overdue/ambiguous attempts, and unresolved quarantine at explicit `asOf` time without duplicating source lifecycle.
- Acknowledgement requires owner/administrator/approver, locks the attempt and optional reconciliation/circuit, rechecks active state, inserts once, and audits only minimized closed metadata. Replay preserves the first note; source resolution/reset removes the active projection without deleting history.
- Important write fields are `workspaceId`, `type`, `attemptId`, and `acknowledgementNote`. Server-derived fields include provider, reconciliation, severity, opened time, reviewer, and acknowledged time. No client may supply state, authority, retry, or resolved flags.
- APIs are GET `/api/v1/ai-operational-incidents`, POST `/api/v1/ai-operational-incidents/acknowledge`, and GET `/api/v1/ai-operational-readiness`; strict schemas reject extra keys. Readiness is observation-only and reports external paging/public execution unavailable.
- `AiOperationalIncidents` renders metrics, oldest-active guidance, safe source summaries, immutable acknowledgement history, and reviewer note controls. It never offers retry, resolution, circuit reset, enablement, billing, or provider actions.
- Integration covers quarantine projection, overdue claim detection before reconciliation, ambiguity, critical credential circuit, editor denial, acknowledgement replay, circuit-reset disappearance, readiness state transitions, and no execution authority. Schema tests cover closed types and note bounds.
- Gate: lint; 231 TypeScript tests including 29 live PostgreSQL; all workspace typechecks; 82 generated pages/routes; three Rust tests; all 76 migrations rebuilt and replayed on two empty databases. Live health returned 200/version 0.83.0; unauthenticated incident/readiness/mutation returned 401; unknown route returned 404; AI-settings browser warnings/errors were zero.
- Installer `Market Me Companion_0.83.0_x64-setup.exe`: 2,944,125 bytes; SHA-256 `2b3394b9cac27edd4ec99b45665eaedfb71dacf158e743f299adb4b2fff63afe`.

The only new persistent collection is the acknowledgement table; source incidents remain derived. Rollback to 0.82 retains migration/data, disables 0.83 APIs/UI, and keeps deployment/workspace execution stopped until forward recovery.

## Release 0.84 implementation notes

- Migration `0077_ai_operational_incident_response_policy.sql` is immutable at SHA-256 `e2462f81c0553cfcdc1ae1f898db17052d7669ee5e6c55b107ae77d0ead91a6e`; the main `schema_migration` checksum matches.
- `DEFAULT_AI_OPERATIONAL_INCIDENT_RESPONSE_POLICY` is frozen at critical 5/60 and high 30/240 minutes. `selectWorkspaceAiOperationalIncidentResponsePolicy` returns those values with `configured=false` when no row exists.
- Repository additions are `getWorkspaceAiOperationalIncidentResponsePolicy` and `saveWorkspaceAiOperationalIncidentResponsePolicy`. Reads require membership; save requires owner/administrator and writes tenant-bound created/updated attribution plus minimized audit.
- Policy fields are `criticalAcknowledgementMinutes`, `highAcknowledgementMinutes`, `criticalResolutionMinutes`, `highResolutionMinutes`, and `runbookUrl`. Numeric bounds and ordering are checked in database, repository, and strict Zod schema.
- Runbook validation requires a trimmed, credential-free HTTPS URL of at most 2,000 characters. The app stores/displays it but makes no server request. Audit stores only `runbookConfigured=true` and `runbookUrlIncluded=false`.
- Incident projection computes due timestamps, overdue/late Booleans, and closed response state at explicit `asOf`. Readiness adds target counts and next due time; policy changes immediately re-project active conditions without rewriting incident sources.
- API is GET/PUT `/api/v1/ai-operational-incident-response-policy`. UI adds four bounded number inputs, HTTPS runbook input/link, target summary, overdue metric, and per-incident due/state lines; save never changes paging/source/execution.
- Integration verifies defaults, viewer denial, configured policy, safe metadata, deadlines, within-target and future resolution-overdue readiness. Schema tests reject out-of-order targets, HTTP, and credential-bearing URLs.
- Gate: lint; 232 TypeScript tests including 29 live PostgreSQL; all workspace typechecks; 83 generated pages/routes; three Rust tests; all 77 migrations rebuilt/replayed on two empty databases. Live health returned 200/version 0.84.0; unauthenticated policy GET/PUT returned 401; unknown route returned 404; AI-settings browser warnings/errors were zero.
- Installer `Market Me Companion_0.84.0_x64-setup.exe`: 2,943,723 bytes; SHA-256 `18b5dbd18fdcdc42ed9ec66d83588ac300ce7c95e6d01a29c779e694d993dc1a`.

No mutable global variable or deadline scheduler is added. Rollback to 0.83 retains migration/policy/audit data, disables policy API/UI, and keeps execution stopped until forward recovery.

## Release 0.85 implementation notes

- Migration `0078_ai_operational_alert_webhook.sql` is immutable at SHA-256 `f47de90dd6c1d60e6b65846da786e4f5b5c3a07f1aa1b6d8f04635f466d7afd9`; the main `schema_migration` checksum matches.
- Deployment variables are `AI_OPERATIONAL_ALERT_ENCRYPTION_KEY` (separate base64 32-byte AES-GCM key), `AI_OPERATIONAL_ALERT_ALLOWED_HOSTS` (comma-separated exact lowercase hostnames), and `AI_OPERATIONAL_ALERT_BATCH_SIZE` (integer 1-100, default 25). If key/allowlist are both absent the worker safely disables delivery; configuring only one fails worker startup.
- `packages/connectors/src/operational-alert-webhook.ts` owns allowlist parsing, URL validation, HMAC signing/constant-time verification, and delivery classification. URLs require HTTPS, exact hostname match, default port, and no username/password/query/fragment. Redirects are manual and rejected.
- Signature input is the exact UTF-8 JSON body produced by `JSON.stringify`, prefixed by the ISO header timestamp and a period. Required headers are `content-type`, `idempotency-key`, `x-market-me-event-id`, `x-market-me-timestamp`, and `x-market-me-signature` with `v1=` plus 64 lowercase hex characters.
- Repository configuration methods are safe get/save, admin verification-target/readback, optimistic verification recording, and disable. System methods enqueue events, lease ready rows, and record exact claim outcomes. Public delivery history never returns payload, endpoint, or secret.
- `OperationalAlertService.processReadyEvents(limit, asOf)` first projects events, then claims and delivers. Secret-open/configuration failure dead-letters safely; 408/425/429/5xx and uncertain delivery retry after 60, 300, 900, then 3,600 seconds with a stable event UUID, and attempt five dead-letters.
- APIs are GET/PUT `/api/v1/ai-operational-alert-webhook`, POST `/verify`, POST `/disable`, and GET `/api/v1/ai-operational-alert-deliveries`. Strict schemas, session checks, repository authorization, deployment vault checks, and exact allowlist validation are independent layers.
- UI receives safe SSR projections and provides save-unverified, signed verification, disable, and redacted recent evidence controls. A status pill cannot grant provider execution; configuration never enables before a successful verification response.
- Integration covers viewer denial, secret/path redaction, stale verification rejection, verified readiness, idempotent event projection, verified-only claim evidence, delivery/retry outcomes, and redacted history. Transport tests cover allowlisting, signature integrity, fixed headers, redirect rejection, retry classes, and ambiguous network results.
- Gate: lint; 240 TypeScript tests including 29 live PostgreSQL; all workspace typechecks; 87 generated pages/routes; three Rust tests; all 78 migrations rebuilt/replayed on two empty databases. Live health returned 200/version 0.85.0; unauthenticated config GET/PUT, verify, and history returned 401; unknown route returned 404; AI-settings browser warning/error count was zero.
- Installer `Market Me Companion_0.85.0_x64-setup.exe`: 2,946,692 bytes; SHA-256 `043e52d9921801513b0704a562d264ffcaac2583eed4ca4beae33b85b46a4802`.

Rollback to 0.84 retains migration/configuration/outbox rows, disables 0.85 routes/UI/worker delivery, and leaves execution stopped. Never reuse the alert key for connector or hosted-provider secrets; rotate by resaving each webhook and re-verifying.

## Release 0.86 implementation notes

- No migration was added. Release 0.86 composes the intent/attempt/output/review tables from migrations 0069-0075 with execution, incident, response-policy, and webhook safeguards in 0074-0078. Migration 0078 remains immutable at SHA-256 `f47de90dd6c1d60e6b65846da786e4f5b5c3a07f1aa1b6d8f04635f466d7afd9` and matches the main ledger.
- `aiTextInvocationIntentExecuteSchema` accepts only workspace UUID, route-overridden intent UUID, bounded `userText`, and optional bounded `systemText`. Route `POST /api/v1/ai-text-invocation-intents/[id]/execute` requires a session, workspace write role, a valid 32-byte base64 AI provider credential/output vault key, and server configuration; it returns 503 `execution_disabled` before claim when deployment execution is off.
- `ExecutePreparedTextInvocationInput` and `ExecutionDependencies` are the executor boundary. Important server locals are `target` and request-memory `apiKey`; important UI state is `pending`, `intentId`, `systemText`, and `userText`. `executionAvailable` is derived from deployment flag, output-vault validity, and current workspace execution window. None is a mutable application global or reusable authority token.
- Authorization is deliberately repeated: API tenant write check, deployment gate, intent prompt hashes, active exact quote/reservation, current adapter/credential/rate/health evidence, unexpired workspace enablement, closed circuit, single attempt claim, and finalization-time stop/evidence checks. Do not replace these checks with a UI Boolean.
- The fixed transport is called at most once and never automatically retried. Credential-open failure before I/O is a known failure; transport uncertainty is ambiguous and retained for operational review. Output is AES-GCM encrypted before commit and is never returned by the execute response.
- `AiTextInvocationIntents` offers `Prepare intent only`, `Prepare and execute once`, and exact-prompt execution for an existing prepared intent. Because preparation retains only hashes, operators must keep or re-enter the exact prompt. Success remains subject to output review, accepted-artifact attachment, evidence-preserving proposal application, and normal Draft approval.
- Gate: 240 TypeScript tests including 29 live PostgreSQL; all workspace typechecks and web lint; 87 generated pages/routes; three Rust tests; all 78 migrations rebuilt and replayed on two empty databases. Live health returned 200/version 0.86.0; unauthenticated execute returned 401; unknown route returned 404; AI-settings showed one disabled fail-closed execute control and zero warning/error console entries.
- Installer `Market Me Companion_0.86.0_x64-setup.exe`: 2,944,551 bytes; SHA-256 `54df85fa662734a4a1dad0c9bd33dd7b497230227a0715a7eb9039b867651f86`.

Deployment activation requires `AI_PROVIDER_EXECUTION_ENABLED=true`, a valid `AI_PROVIDER_CREDENTIAL_ENCRYPTION_KEY` (32-byte base64 and separate from connector/alert keys), configured provider credentials, an owner/administrator time-limited workspace enablement, and closed circuits. This AI vault key encrypts both provider credentials and output envelopes in 0.86. Keep the deployment flag false until production identity, key lifecycle, output moderation/retention, incident ownership, and reviewed provider authorization are ready.

Rollback to 0.85 disables/removes the execute route and UI controls but retains every attempt, encrypted output, reconciliation, resolution, incident, and alert/outbox row. Cancel or release only intents/reservations not yet claimed through their defined boundaries. Never replay an ambiguous or otherwise claimed intent; forward-deploy to resume review and reconciliation.

## Release 0.87 implementation notes

- Migration `0079_ai_draft_revision_intents.sql` is immutable at SHA-256 `64ce8e969fc49e1a4e913dfdc2c5331fc45f5006d10208dd2a5fa8c70b8c6c97`; the main `schema_migration` checksum matches. It adds optional source Draft/version, closed goal, prompt-version, and private context-hash columns plus relational/all-or-none checks and a source index.
- `AI_DRAFT_REVISION_GOALS` contains clarity, concision, audience fit, and call to action. `AI_DRAFT_REVISION_PROMPT_VERSION` is the internal constant `draft-revision-v1`; changing its template requires a new version rather than silently changing reconstruction.
- `selectDraftRevisionPrompt` locks the exact current working/changes-requested Draft/version, requires an evidence-backed factual claim, canonicalizes presentation/claim/evidence context, bounds both prompt strings against `AI_TEXT_CODEC_LIMITS`, and hashes only the canonical context. It is server/database code and must not be imported into a Client Component.
- Repository methods are `prepareWorkspaceDraftRevisionIntent` and `getWorkspaceDraftRevisionExecutionPrompt`. Preparation rechecks source and requires an active `assistant.prepare_copy` quote reservation. Execution reconstruction must match stored prompt version, context SHA-256, user hash, and system hash before the existing single-claim executor runs.
- APIs are POST `/api/v1/drafts/[id]/ai-revision` and POST `/api/v1/ai-text-invocation-intents/[id]/execute-draft-revision`. Path IDs override bodies before strict validation; both require workspace write access. Creation supports prepare-only or immediate one-shot execution; execution never accepts prompt text.
- `AiDraftRevisionRequest` lives on the exact Draft page. Important state variables are `invocationBindingId`, `reservationId`, `goal`, `maxOutputTokens`, `pending`, and `message`; derived collections are `draftIntents`, `availableReservations`, and `readyBindings`. The component renders no raw prompt input.
- Generic AI settings hides its raw-prompt execution action for `productBound` intents and filters product output attachment targets to the source Draft. The repository independently enforces source Draft and current-version equality.
- Audits record product-bound Boolean, source Draft/version, and closed goal while explicitly excluding prompt, both prompt hashes, context hash, credentials, output, mutation authority, and publishing authority.
- Gate: 241 TypeScript tests including 29 live PostgreSQL; all workspace typechecks and web lint; 87 generated pages/routes; three Rust tests; all 79 migrations rebuilt and replayed on two empty databases. Live health returned 200/version 0.87.0; both new unauthenticated mutations returned 401; unknown route returned 404; Draft browser QA showed four closed goals, no raw prompt fields, expected fail-closed execution, and zero warning/error entries.
- Installer `Market Me Companion_0.87.0_x64-setup.exe`: 2,944,820 bytes; SHA-256 `4f0ba5961f3fe4dc7b6945644e133dbd55cffec0c398dddf0cd8c82294814a74`.

Known limitations: operators must still create/reserve the governed prepare-copy quote in AI settings, and encrypted output review/attachment remains in AI settings before selected presentation application on the Draft page. No structured model-output parser is trusted; authors manually select permitted presentation values.

Rollback to 0.86 retains migration 0079 and every product-bound intent/attempt/output/reconciliation/incident row. Disable both product routes and the Draft panel, keep deployment/workspace execution stopped, and cancel only unclaimed prepared product intents through the existing cancel API. Release 0.86 must not attempt to reconstruct or execute those intents through raw prompt substitution.

## Release 0.88 implementation notes

- Scope: authorize the prepare-copy maximum without leaving the exact Draft. No schema change was needed; migration `0079_ai_draft_revision_intents.sql` remains immutable at SHA-256 `64ce8e969fc49e1a4e913dfdc2c5331fc45f5006d10208dd2a5fa8c70b8c6c97`, which matches the main database ledger.
- Domain/repository: `AiWorkspaceAdapterInvocationBinding` now exposes safe `rateCardId`; `selectWorkspaceAdapterInvocationBindings` selects `workspace_ai_adapter_rate_binding.rate_card_id`. Keep this projection identifier-only and do not add card components, source evidence, prices, or credentials.
- Draft client: `apps/web/src/components/ai-draft-revision-request.tsx` owns the handoff. `authorizedReservations` is initialized from SSR props; `availableReservations` filters active unconsumed `assistant.prepare_copy` holds; `readyBindings` filters the safe binding list.
- `authorize()` resolves `binding` from `invocationBindingId`, posts `{ workspaceId, action: "prepare_copy", rateCardId: binding.rateCardId }` to `/api/v1/ai-assistant-cost-quotes`, then posts `{ workspaceId, idempotencyKey: crypto.randomUUID() }` to `/api/v1/ai-cost-quotes/[quoteId]/reserve`. It inserts the authoritative returned `reservation` once and sets `reservationId` immediately.
- Important transient variables: `quoteResponse`/`quoteBody` represent durable quote creation; `reserveResponse`/`reserveBody` represent the separate maximum-hold transaction; `pending` prevents duplicate UI actions; `message` distinguishes quote failure, reservation failure, and successful no-provider authorization. None is global state or trusted authorization evidence.
- A quote that cannot be reserved remains in the ledger and can expire normally. Never delete it to simulate rollback. A successful hold follows the established reservation consumption/cancellation/expiry rules and must not be released from the browser.
- Gate: all workspace typechecks and web lint passed; 241 TypeScript tests passed, including all 29 live PostgreSQL tests; the Next.js production build generated 87 pages/routes; three Rust tests passed. Main migration replay skipped all 79 checksum-matching files. Health returned 200/version 0.88.0; unauthenticated assistant-quote and reserve mutations returned 401.
- Browser acceptance: the exact Draft page displayed one disabled `Quote and reserve maximum here` control when no healthy implementation existed, four closed revision goals, no raw-prompt labels, disabled prepare/execute controls, the in-context authorization guidance, and zero warning/error diagnostics. The temporary Draft fixture, browser tab, dev server, and logs were removed afterward.
- Installer `Market Me Companion_0.88.0_x64-setup.exe`: 2,944,100 bytes; SHA-256 `c0eca4f6a7b49f04fd1019ad87332ce45b08dde68cf8edb9219fe93b1cc29222`.
- Rollback: deploy 0.87 UI/domain/repository code, retain migration 0079 and all quotes/reservations/audits, allow orphaned unreserved quotes to expire, and manage active reservations only through existing server lifecycle boundaries. No down migration is required.

## Release 0.89 implementation notes

- Scope: review and attach encrypted product-bound output without leaving its exact Draft. No schema or API route was added; migration `0079_ai_draft_revision_intents.sql` remains immutable at SHA-256 `64ce8e969fc49e1a4e913dfdc2c5331fc45f5006d10208dd2a5fa8c70b8c6c97`, matching the main ledger.
- New client: `apps/web/src/components/ai-draft-revision-outputs.tsx`. The Draft page now loads safe workspace output projections, passes exact Draft/version plus its existing proposals, computes `canApprove` separately from `canEdit`, and passes an AI-vault availability convenience flag.
- `draftArtifacts` filters product-bound safe projections to `sourceContentDraftId === contentDraftId`; `attachedArtifactIds` is a `Set` derived from proposals. Important state is `selectedArtifactId`, transient `outputText`, `reviewNote`, `pending`, and `message`; `selectedArtifact`, `sourceCurrent`, and `attached` are derived values. None is global or authoritative.
- `open()` GETs `/api/v1/ai-text-outputs/[id]?workspaceId=...`; only the approver route can decrypt. `review()` POSTs the closed decision and note. `attach()` POSTs the page's fixed `contentDraftId`; there is no target selector or client-supplied source version.
- Keep plaintext request-local and component-local. Clear `outputText` on close, review completion, or attachment completion. Do not put output into URL, SSR props, local/session storage, logs, audit data, error messages, or router state.
- The existing AI settings ledger remains the central cross-Draft operations view. The Draft component is a contextual projection; the existing `AiTextDraftProposals` component below it still owns explicit evidence-preserving presentation-field application.
- Gate: all workspace typechecks and web lint passed; 241 TypeScript tests passed including all 29 live PostgreSQL tests; the production build generated 87 pages/routes; all three Rust tests passed; all 79 migration checksums replayed as skips. Health returned 200/version 0.89.0; unauthenticated artifact read, review, and attach returned 401.
- Browser acceptance displayed one `Draft revision output review` H2, one `0 source-bound` empty state, no raw-prompt labels, no artifact action buttons without an artifact, and zero warning/error diagnostics. The exact temporary Draft, browser tab, dev server, and logs were removed.
- Installer `Market Me Companion_0.89.0_x64-setup.exe`: 2,946,543 bytes; SHA-256 `2d2a762c22a80e401cd4ce259d3317598a74164425c4f9634f0e25b785ed171e`.
- Rollback: deploy 0.88 UI/page code, retain every artifact/review/proposal/audit and migration 0079, and continue review/attachment from AI settings. No down migration, output decryption/re-encryption, or proposal deletion is required.

## Release 0.90 implementation notes

- No migration. New prompts are `draft-revision-v2`; `selectDraftRevisionPrompt(..., promptVersion)` retains the exact v1 branch for stored-intent reconstruction. Never delete the legacy branch while v1 intents may exist.
- Domain parser is `parseAiDraftRevisionPresentationSuggestion` in `packages/domain/src/ai.ts`; adversarial tests cover valid JSON/fence, surrounding prose, unknown/fact-bearing keys, schema mismatch, lead-in punctuation, duplicate/malformed hashtags, empty CTA, and short rationale.
- Proposal GET returns `suggestionParse` only after writer authorization and decryption; only persisted v2 product prompts are parsed. Old/generic output reports unavailable without changing plaintext review access.
- UI variables: `suggestionParse`, `selectedSuggestionFields`, `toggleSuggestionField`, and `useValidatedSuggestions`. Selection starts empty; filling does not call an API, persist, or apply. Existing `apply()` remains the only successor mutation.
- Gate: 245 TypeScript tests including 29 live PostgreSQL, all typechecks/lint, 87 pages/routes, three Rust tests, and 79 checksum-matching migrations. Health 200/version 0.90.0; proposal read unauthenticated 401; browser Draft QA had no raw prompt fields or warnings/errors.
- Installer `Market Me Companion_0.90.0_x64-setup.exe`: 2,944,985 bytes; SHA-256 `82499e4105ce72e3178412e062e6dfa5a7898b479d38609b4463828f633205cb`.
- Rollback to 0.89 retains v2 reconstruction for any prepared v2 intent, disables new v2 preparation/parser prefill, preserves encrypted/review/proposal evidence, and requires no down migration.

## Release 0.91 conversation-retention erasure operations

- Migration `0080_conversation_retention_erasure.sql` is applied and immutable. Final SHA-256: `cb1cc8db18c55dc7072c5895314a5ded313a68eb884b65ae7152e2abf83dbd4e`; the main `schema_migration` row must match before any 0.91 process starts.
- `conversation_retention_erasure_request` has no foreign key to `conversation_thread` by design. Never add one: an executed row must survive deletion as minimized governance evidence. Do not add subject, relationship label, message text, provider metadata, identities, credentials, AI output, or copied source JSON to this table or its audit events.
- Request API: POST `/api/v1/conversations/[id]/retention-erasure-requests` with strict `{workspaceId, requestNote}`. It requires owner/admin/editor at route and repository layers, locks policy then thread, requires enabled policy plus resolved/archived non-hold eligibility, and returns the existing pending request on an exact retry.
- Decision API: POST `/api/v1/conversation-retention-erasure-requests/[id]/decision` with strict `{workspaceId, decision: execute|reject, decisionNote}`. It requires owner/admin/approver, rejects self-decision, and locks the request before re-locking/revalidating policy and thread. Rejection never deletes.
- Execution compares current class and `eligibleAfter` to the request snapshot, counts nine child groups, deletes the exact tenant-bound thread, records counts/status/decision, and audits in one PostgreSQL transaction. Any error rolls back every delete and state change. Existing composite foreign keys own the cascade; do not replace this with hand-written unordered multi-table deletion.
- UI state `pending`, `notes`, `pendingRequests`, `canRequest`, and `canDecide` is presentation-only. The execute button requires a nonempty decision note and an irreversible browser confirmation. There is no batch select, background worker, automatic timer, or restore endpoint.
- Integration acceptance uses only generated disposable workspaces/threads. It proves writer/approver role separation, duplicate-request idempotence, self-approval rejection, rejection preservation, legal-hold blocking after request, exact child deletion/counts, relationship preservation, minimized ledger/audit content, and full fixture cleanup. Never validate this release by deleting an existing operator conversation.
- Release gate: 247 TypeScript tests passed including all 30 live PostgreSQL tests; every workspace typecheck and web lint passed; Next.js generated 87 pages/routes; three native Rust tests passed; and all 80 migrations replayed as checksum-matching skips. Runtime health was 200/version 0.91.0 and unauthenticated policy/request/decision routes returned 401.
- Browser acceptance used exact fixed UUIDs in the empty development workspace, showed one eligible action, created one pending request, hid execute from its requester, displayed the different-approver rule, and recorded zero warning/error diagnostics. Cleanup removed exactly one temporary thread, relationship, request, request audit, and policy, then verified zero fixture rows.
- Installer `Market Me Companion_0.91.0_x64-setup.exe`: 2,945,317 bytes; SHA-256 `b3c807a0c50345592142b6f0a1f3b177a42622d63bdbbf2de93cb29825f1b77b`.
- Rollback deploys 0.90 code only after disabling both 0.91 mutation routes/UI. Retain migration 0080, ledger rows, and audit events. An executed erasure cannot be restored by application rollback; recovery, if legally and operationally authorized, is a separately reviewed backup procedure outside Market Me.

## Release 0.92 legal-hold operations

- Migration `0081_conversation_legal_hold_cases.sql` is applied and immutable. Final SHA-256: `71148c414791e5ecadd8869bc6a16d31a3825bf36bf7123f87f6c49532dee918`; the `schema_migration` row must match before any 0.92 process starts. Never edit this file; use a forward migration.
- `conversation_thread.retention_revision` and `conversation_retention_erasure_request.thread_retention_revision` are nonnegative integers. The former increments on every effective ordinary class change, hold placement, and approved release. An erasure request stores the latter snapshot and execution requires exact equality.
- `conversation_legal_hold_case` is governance history with scalar thread identity, prior non-hold class, reason/reference, closed state, actors/times, and approved release-request ID. `conversation_legal_hold_release_request` binds to the exact hold/workspace/thread tuple and contains target class, request/decision notes, status, and actors/times. Do not add content, credentials, provider payloads, or a cascading thread foreign key.
- Placement API: POST `/api/v1/conversations/[id]/legal-holds` with strict `{workspaceId, reason, caseReference?}` and approval permission. Release-request API: POST `/api/v1/conversation-legal-holds/[id]/release-requests` with strict `{workspaceId, targetRetentionClass, requestNote}` and write permission. Decision API: POST `/api/v1/conversation-legal-hold-release-requests/[id]/decision` with strict `{workspaceId, decision: approve|reject, decisionNote}` and approval permission.
- Repository methods are `listLegalHoldCases`, `listLegalHoldReleaseRequests`, `getLegalHoldReleaseRequest`, `placeLegalHold`, `requestLegalHoldRelease`, and `decideLegalHoldRelease`. `setRetentionClass` intentionally rejects `legal_hold` and rejects any direct change away from an active hold. Retrying placement or a pending release request returns the existing record.
- Lock order is thread then active case for placement; case then thread for release request; request then case then thread for decision. Erasure locks policy then thread and also checks active hold state. Preserve these boundaries when adding features and avoid acquiring these entities in the opposite order.
- UI variables are component-local: `retentionClass`, `reason`, `caseReference`, `requestNote`, `decisionNote`, `pending`, and `error`. `activeHold`, `releaseRequest`, `canWrite`, and `canApprove` are derived convenience values; no browser state grants permission or changes authoritative status.
- Release gate: 248 TypeScript tests passed including all 30 live PostgreSQL tests; every workspace typecheck and web lint passed; Next.js generated 87 pages/routes; native check and all three Rust tests passed; all 81 migration checksums replayed as skips. Runtime health was 200/version 0.92.0 and all three unauthenticated mutations returned 401.
- Browser acceptance used exact fixed UUIDs in the development workspace, displayed only non-hold direct classes, placed a reasoned case, requested release, hid approval from the requester, displayed the different-approver rule, and rendered the new card without visible layout failure. Cleanup removed the exact relationship/thread/audit/release/hold fixtures and verified zero rows; the dev server, tab, and logs were removed.
- Installer `Market Me Companion_0.92.0_x64-setup.exe`: 2,945,021 bytes; SHA-256 `e9d86d9c40c2248e10bfd681820bceee77ba93320bad7261fff0731363e40a36`.
- Rollback deploys 0.91 code only after disabling all three 0.92 routes/UI. Retain migration 0081 and governance history. An active case remains a binding legal hold; never remove it through direct class updates, revision changes, or ledger deletion.

## Release 0.93 workspace legal-hold queue operations

- No migration. Migration 0081 remains immutable with SHA-256 `71148c414791e5ecadd8869bc6a16d31a3825bf36bf7123f87f6c49532dee918`; all 81 ledger checksums must replay unchanged.
- Repository reads are `listActiveLegalHolds(workspaceId)` and `listPendingLegalHoldReleaseRequests(workspaceId)`. Both cap at 200 and hydrate optional subject/relationship labels with same-workspace left joins. Do not persist these labels into governance rows.
- The Conversations page fetches both only for owner, administrator, editor, or approver roles. The retention-policy GET repeats that disclosure guard and returns `activeLegalHolds`, `legalHoldReleaseRequests`, plus active/pending counts in `meta`; analyst/viewer responses contain empty arrays and zero counts.
- Component props are readonly `activeLegalHolds` and `legalHoldReleaseRequests`. Per-card derived values are `releaseRequest`, `selfRequested`, and `key`; decision notes reuse the existing component-local `notes` dictionary. `pending` continues to serialize UI actions only.
- Workspace decisions POST to the existing `/api/v1/conversation-legal-hold-release-requests/[id]/decision` route. Keep exact-thread and workspace UI behavior aligned; do not create a second repository decision method.
- Release gate: 248 TypeScript tests passed including all 30 live PostgreSQL tests; every workspace typecheck and web lint passed; Next.js generated 87 pages/routes; native check and all three Rust tests passed; all 81 migration checksums replayed as skips. Runtime health was 200/version 0.93.0.
- Browser acceptance inserted an exact active hold and pending release requested by a different editor, showed one workspace operations card with thread link and both decision controls, rejected it as the owner, reloaded to “No release request is pending,” and removed the exact user/membership/relationship/thread/hold/release/audit fixtures to verified zero. The tab, dev server, and logs were removed.
- Installer `Market Me Companion_0.93.0_x64-setup.exe`: 2,946,946 bytes; SHA-256 `62caad12b01b2ebef6ccfda95c2fd10c5aacfc909c14f198a9b0cceeaf2595c9`.
- Rollback to 0.92 removes the workspace projection only. Retain migration 0081 and all governance evidence; exact-thread workflows remain authoritative and active holds remain effective.

## Release 0.94 recent legal-hold decision history

- Migration `0082_conversation_legal_hold_decision_index.sql` is applied and immutable at SHA-256 `e583b92bc225d1eac6bc2bf6918d9372b171142d286fe7d0e05ec259d2336dcb`. It adds only `conversation_legal_hold_release_decisions_idx` on workspace, descending decision time, and ID for approved/rejected rows. Never edit it after application; use a forward migration.
- Repository method `listRecentLegalHoldReleaseDecisions(workspaceId)` selects existing request columns, requester/decider display names, and optional same-workspace thread/relationship labels. It filters to `approved|rejected`, orders newest first, and limits to 200.
- Server variables are `recentLegalHoldReleaseDecisions` on the page/API and `recentLegalHoldReleaseDecisionCount` in response metadata. Both role branches must stay aligned with `canOperateLegalHolds`; analyst/viewer must resolve empty/zero without a repository call.
- Component prop `recentLegalHoldReleaseDecisions` is readonly. The display maps `slice(0, 20)` and derives status style plus optional link visibility; it adds no state variable, note dictionary entry, pending action, request, or mutation authority.
- Full gate: 248 TypeScript tests including 30 live PostgreSQL tests, all workspace typechecks, web lint, 87-page/route production build, companion build, native check, three Rust tests, and all 82 migration checksum replays passed. Health returned 200/version 0.94.0; unauthenticated policy and valid hold mutation requests returned 401.
- Browser acceptance used exact 0.94 UUID fixtures to show one active hold and two recent decisions (rejected newest, approved next) with subject, relationship, requester, target, request note, decider, decision note/time, status, and live links. Cleanup deleted exactly one user/membership/relationship plus two threads/holds/requests and verified every fixture count at zero; the browser tabs, dev server, and logs were removed.
- Installer `Market Me Companion_0.94.0_x64-setup.exe`: 2,944,021 bytes; SHA-256 `fd153a114c32544d815ed9429865e962ad7ae5e62bb6e91167dc7d4132d6b6d4`.
- Rollback deploys 0.93 application code while retaining migration 0082 and all governance rows. No down migration, status rewrite, or evidence deletion is required.

## Release 0.95 evidence-backed asset rights

- Migration `0083_content_asset_rights_reviews.sql` is applied and immutable at SHA-256 `a2e15d31eb69b7414d85931c908bfa6f290aab5e84d2c8ad85a12001afe8c6bd`. It adds reviewed evidence/permission/channel/validity/revision columns, revokes legacy bare clearances, adds original-image evidence constraints and a review index, and extends preview-asset snapshots. Never edit it; use a forward migration.
- `MarketMeRepository.reviewAssetRights(input, actorUserId)` accepts one original image in the actor's writable workspace, trims and validates evidence, refuses unsupported cleared obligations/future/expired windows, increments `rights_revision`, and returns the rehydrated package. Derivatives are never reviewed independently.
- The strict PUT route is `/api/v1/content-packages/[id]/assets/[assetId]`. Required request fields are `workspaceId`, `status`, `owner`, `sourceReference`, `proofReference`, the three permission Booleans, `permittedChannels`, and `reviewNote`; optional fields are license owner, validity timestamps, and the three requirement strings. Path identity and authenticated actor remain server-authoritative.
- `RightsDraft`, per-asset `rights`, `setRight`, and `putRights` are client-local form structures. Cleared UI state requires evidence plus commercial, derivative, worldwide, and Discord checks and no unsupported requirement. The package button is convenience-only; repository approval repeats current effective-rights checks.
- Preview creation resolves derivative rights from its source original. `draft_channel_preview_asset` snapshots revision/review/expiry. Both preview-list queries, Campaign activation, publication target resolution, and workflow-worker execution compare current state, revision, validity, and provider permission so withdrawal after preview creation is fail-closed.
- Full gate: 249 TypeScript tests including 30 live PostgreSQL tests, all workspace typechecks, web lint, 87-page/route production build, companion build, native check, three Rust tests, and a fresh replay of all 83 migrations passed. Health returned 200/version 0.95.0; a schema-valid unauthenticated rights mutation returned 401.
- Browser acceptance showed unchecked approval disabled, saved a restricted revision with an unsupported attribution obligation, kept approval disabled, cleared the obligation with all required permissions, saved revision 2, and approved the package. Browser diagnostics had no errors. Exact source/package/asset/audit fixtures were removed and verified at zero; the tab, server, and logs were removed.
- Installer `Market Me Companion_0.95.0_x64-setup.exe`: 2,946,137 bytes; SHA-256 `274f25a984b0c809d7d70eb3f6300aadfd1085f51433f572e6883a5aced84b18`.
- Rollback deploys 0.94 application code while retaining migration 0083 and reviewed evidence. Old code may display stored rights but must not resume outbound image execution without the 0.95 revalidation path; do not restore legacy bare `cleared` flags or decrement revisions.

## Release 0.96 ClamAV malware evidence and clean-only execution

- Migration `0084_content_asset_malware_scan_evidence.sql` is applied and immutable at SHA-256 `bec6747fd0be23fca4d43faec05dc0e65b54f1c4cb55025ee1664601c75eca47`. It adds asset engine/time/revision, preview time/revision, clean-evidence checks, a review index, and revokes legacy evidence-free clean flags. Never edit it; use a forward migration.
- Start local scanning with `npm run malware:up`; set `MALWARE_SCANNER=clamav`, `CLAMAV_HOST=127.0.0.1`, `CLAMAV_PORT=3310`, and a bounded `CLAMAV_TIMEOUT_MS`. Stop it with `npm run malware:stop`. The compose profile pins `clamav/clamav:1.5.3`, persists `/var/lib/clamav`, and binds TCP only to loopback.
- `ClamAvInstreamScanner` implements official `zINSTREAM` framing. Clean, signature-found, daemon-error, timeout, connection-error, oversized-response, and malformed-response outcomes are deterministic. `npm run qa:malware-scanner` requires a live daemon and verifies both a clean string and the EICAR test signature.
- `MediaProcessor` scans before `putImmutable`; infected bytes throw `MediaValidationError` and are not stored. Clean results persist engine/time/revision on original and derivative assets. Unconfigured/failed results keep the package in review and remain outbound-ineligible.
- Package approval, media-selection UI, preview creation, preview stale projections, Campaign activation, publishing-target hydration, and workflow-worker attachment loading all require clean positive-revision evidence. Scan withdrawal or revision change after preview creation invalidates execution.
- Full gate: 253 TypeScript tests including 30 live PostgreSQL tests, all workspace typechecks, web lint, 87-page/route production build, companion build, native check, three Rust tests, live ClamAV clean/EICAR and ingestion-worker evidence checks, and a fresh replay of all 84 migrations passed. Health returned 200/version 0.96.0; unauthenticated approval returned 401.
- Browser acceptance displayed failed clamd revision 1 and disabled approval, displayed clean clamd revision 2 after rescan, then approved the package with zero console errors. Exact source/package/asset/audit fixtures, tab, server, logs, and scanner container were removed or stopped.
- Installer `Market Me Companion_0.96.0_x64-setup.exe`: 2,945,426 bytes; SHA-256 `5b2e2f0735323a4b7da86f7050cca121a88c9ec0f953c294c93a534fd74d5165`.
- Rollback deploys 0.95 code while retaining migration 0084 and scan evidence. It must not restore evidence-free clean flags or allow `not_configured`; keep outbound media disabled until the 0.96 gates return.

## Release 0.97 exact publishing-account rights

- Migrations `0085_content_asset_rights_channel_connections.sql` and `0086_rights_channel_connection_deferred_delete.sql` are applied and immutable at SHA-256 `05b9d94bb2a8fbd10dc092d1a0041e88bdb7a96cf3925ff7a332a786283d9ff4` and `5addde3246477e9bcb6cf8b3a4750a236114b1ee13b515d2701f76dda1facb51`. Never edit them after application; use a forward migration.
- `reviewAssetRights` now requires `permittedChannelConnectionIds`. It deduplicates IDs, validates workspace/provider membership, replaces normalized scope rows transactionally, increments `rights_revision`, and records only `permittedChannelConnectionCount` in the audit dictionary.
- Domain and repository fields are `rightsPermittedChannelConnectionIds` on `ContentAsset`, `permittedChannelConnectionIds` on `ContentAssetRightsReviewWrite`, and `rightsChannelConnectionId` on `StoredDraftPreviewAsset`. The SQL table is `content_asset_rights_channel_connection`; snapshot storage is `draft_channel_preview_asset.rights_channel_connection_id`.
- Web form state adds `RightsDraft.permittedChannelConnectionIds` and `togglePermittedConnection(assetId, connectionId, checked)`. The server page passes a credential-free `channelConnections` list of ID/name/provider/status. Clearance and package-button eligibility require at least one exact account.
- Draft preview creation, both stale projections, Campaign activation, `getCampaignExecutionTarget`, and `CampaignExecutionRouter.loadPreviewAttachments` require the selected/snapshotted/live connection IDs to agree. Request snapshots include `rightsChannelConnectionId` with the existing rights and scan evidence.
- Integration coverage proves a second same-workspace Discord account cannot use an asset cleared only for the first, direct relation removal makes an existing preview stale, reinsertion restores it, exact IDs hydrate into snapshots, and the worker refuses an account-mismatched snapshot before media/provider I/O.
- Full gate: 254 TypeScript tests including 30 live PostgreSQL tests, all workspace typechecks, web lint, 87-page/route production build, companion build, native check, three Rust tests, and a fresh replay of all 86 migrations passed. Health returned 200/version 0.97.0; a schema-valid unauthenticated rights PUT returned 401.
- Browser acceptance showed the rights button disabled with no selected account, selected only `R097 Authorized`, persisted revision 1/cleared plus its display name while excluding `R097 Unauthorized`, enabled and completed package approval, and produced zero browser warnings/errors. Exact package, asset, source, connection, learning-review, audit, and stale failed-test fixtures were removed and verified at zero; the tab, server, and logs were removed.
- Installer `Market Me Companion_0.97.0_x64-setup.exe`: 2,945,036 bytes; SHA-256 `4ff06eda21b86018eeccc97c24d1928730b2ede602cb71d9c567f1dfab842c37`.
- Rollback deploys 0.96 application code while retaining migrations 0085-0086 and their revocations. Because 0.96 cannot author or revalidate exact account scope, disable outbound image publishing until 0.97 or a forward-compatible release is restored.

## Release 0.98 exact Campaign rights

- Migration `0087_content_asset_rights_campaigns.sql` is applied and immutable. Final SHA-256: `2fdde08ec2679956ea2fe02291f67c627e4639385c5748a2fb78d772bed724e4`; the `schema_migration` checksum matches. Never edit it after application; use a forward migration.
- The migration creates `content_asset_rights_campaign`, its reverse index, and `draft_channel_preview_asset.rights_campaign_id`. It invalidates legacy cleared preview authority and extends the cleared-snapshot constraint to require exact account and Campaign IDs. The Campaign foreign keys are deferred `NO ACTION` to preserve both in-use protection and workspace-cascade correctness.
- `ContentAssetRightsReviewWrite.permittedCampaignIds` and the strict PUT field are required arrays capped at 100 UUIDs. `reviewAssetRights` deduplicates them, validates same-workspace Campaigns, replaces rows transactionally, increments `rights_revision`, and audits only `permittedCampaignCount`.
- UI variables are `RightsDraft.permittedCampaignIds`, `campaigns`, and `togglePermittedCampaign`. They are local presentation data. The server page passes only Campaign ID/name/status; repository and execution checks remain authoritative.
- The lifecycle is intentionally two-stage: approve a fully reviewed package with an empty Campaign list, create the Campaign using that approved package, then revisit the package and select exact Campaigns. Do not add a package-approval requirement for a Campaign grant; it would recreate a circular dependency.
- Preview creation uses the draft's server-owned Campaign ID and snapshots it. Preview projections, Campaign activation, publishing targeting, and `CampaignExecutionRouter.loadPreviewAttachments` revalidate exact Campaign membership before media/provider side effects.
- Full release gate passed 255 TypeScript tests: web 67, workflow worker 14, companion protocol 4, connectors 56, database 30, domain 23, generation 29, ingestion 11, media 18, and workflows 3. All workspace typechecks, web lint, the 87-page/route production build, companion build, native check, and three Rust tests passed.
- A fresh database replay applied all 87 migrations and returned `87|0001_foundation.sql|0087_content_asset_rights_campaigns.sql`; the replay checksum and main ledger checksum both matched the file. Health returned 200/version 0.98.0 and a schema-valid unauthenticated rights PUT returned 401.
- Browser acceptance showed both Campaigns initially unselected, selected only `R098 Authorized Campaign`, persisted revision 2 plus its display name, excluded `R098 Unauthorized Campaign`, and produced zero warning/error diagnostics. The exact source/package/asset/connections/Campaigns/audits, tab, server, logs, and temporary script were removed and verified at zero.
- Installer `Market Me Companion_0.98.0_x64-setup.exe`: 2,944,260 bytes; SHA-256 `3e3dc2675dbc98c53dc314b1937c746fa7a503447e39836aad86be3fc91e5ea5`.
- Rollback deploys 0.97 code only after disabling outbound image preview/publishing. Retain migration 0087, grants, snapshot invalidation, and checksums; never delete grants, restore invalidated snapshots, weaken constraints, or edit the applied file.

## Release 0.99 exact Brand Profile rights

- Migration `0088_content_asset_rights_brand_profiles.sql` is applied and immutable. Final SHA-256: `4f445557973ce3527267dbde3cd474f0429dd3ac7d97b25940d161f7c2a3ed2f`; the main and replay `schema_migration` checksums match. Never edit it; use a forward migration.
- The migration creates `content_asset_rights_brand_profile`, its reverse index, and `draft_channel_preview_asset.rights_brand_profile_id`. It invalidates legacy cleared snapshots and extends the cleared-snapshot constraint to require account, Campaign, and Brand roots. Brand foreign keys are deferred `NO ACTION` for in-use protection plus workspace-cascade correctness.
- `ContentAssetRightsReviewWrite.permittedBrandProfileIds` and the strict PUT field are required arrays capped at 100 UUIDs. `reviewAssetRights` deduplicates them, validates same-workspace Brand roots, replaces rows transactionally, increments `rights_revision`, and audits only `permittedBrandProfileCount`.
- UI variables are `RightsDraft.permittedBrandProfileIds`, `brandProfiles`, and `togglePermittedBrandProfile`. They are local presentation state. The server page passes only root ID/name/status for profiles with a current version; repository and execution checks remain authoritative.
- Brand scope uses the stable `brand_profile.id`, not `brand_profile_version.id`. Campaign versions resolve through their exact version pin. This permits same-Brand profile updates while rejecting a different Brand root or an unbranded Campaign for governed attachments.
- Preview creation snapshots the root ID. Preview projections, Campaign activation, `getCampaignExecutionTarget`, and `CampaignExecutionRouter.loadPreviewAttachments` revalidate exact Brand identity before media/provider side effects.
- Full release gate passed 256 TypeScript tests: web 67, workflow worker 15, companion protocol 4, connectors 56, database 30, domain 23, generation 29, ingestion 11, media 18, and workflows 3. All workspace typechecks, web lint, the 87-page/route production build, companion build, native check, and three Rust tests passed.
- A fresh database replay applied all 88 migrations and returned `88|0001_foundation.sql|0088_content_asset_rights_brand_profiles.sql`. Health returned 200/version 0.99.0 and a schema-valid unauthenticated rights PUT returned 401.
- Browser acceptance showed both published Brands initially unselected with the exact Campaign selected, persisted only `R099 Authorized Brand` at revision 3, excluded `R099 Unauthorized Brand`, and produced zero warning/error diagnostics. Exact source/package/asset/account/Campaign/Brands/audits, tab, server, logs, and temporary script were removed and verified at zero.
- Installer `Market Me Companion_0.99.0_x64-setup.exe`: 2,948,079 bytes; SHA-256 `9ebb73a8ce4b0b32442337ea32e60ea6680688843f52ad9401c4969b751f394c`.
- Rollback deploys 0.98 code only after disabling outbound governed image preview/publishing. Retain migration 0088, grants, invalidated snapshots, constraints, and checksums; never restore old snapshots or broaden Brand authority during rollback.

## Release 1.0 production identity operations

- Register the exact callback `${APP_BASE_URL}/api/auth/oidc/callback` with a standards-compliant provider. Set `APP_BASE_URL` to the canonical HTTPS origin and configure `OIDC_ISSUER`, `OIDC_CLIENT_ID`, optional `OIDC_CLIENT_SECRET`, and a bounded `OIDC_PROVIDER_NAME`.
- Put only the initial verified owner email in `OIDC_BOOTSTRAP_EMAILS`, complete sign-in, confirm the owner and workspace on Team, then remove the bootstrap value and restart/redeploy. Every later member should use an owner/administrator-created Team invitation.
- The provider must expose discovery, authorization, token, and JWKS endpoints and issue RS256 ID tokens with `sub`, matching `iss`/`aud`, valid times, matching nonce, `email`, and `email_verified=true`. Production rejects HTTP issuers/endpoints and an `APP_BASE_URL` containing a path/query/fragment.
- Migration `0089_oidc_authentication.sql` is immutable at SHA-256 `aea5fc5664ae6038eaa575424abe6a0eebda7dd9b3a88940ca35c30a3f24efb5`; migration `0090_workspace_invitations.sql` is immutable at `804fe23da145a04bb5370dd7b200b395217b66add312b4ab75bda850aa110b25`.
- `npm run qa:oidc-provider` starts the loopback-only disposable acceptance issuer on port 3101. It is for a controlled development round trip only, uses ephemeral keys and in-memory codes, and is refused by production HTTPS validation.
- Release acceptance passed 269 TypeScript tests (web 76, workflow worker 15, companion protocol 4, connectors 56, database 34, domain 23, generation 29, ingestion 11, media 18, workflows 3), all typechecks/lint, a 90-page-generation web build, companion/native builds, three Rust tests, and fresh replay of 90 migrations.
- Browser QA completed discovery, PKCE authorization, callback, code exchange, JWKS verification, owner provisioning, Team rendering, invitation creation, and revocation with zero warning/error diagnostics. The first attempted round trip exposed a route/config property mismatch; the explicit OIDC configuration mapping fixed it before the final green gate.
- Installer `Market Me Companion_1.0.0_x64-setup.exe` is 2,946,935 bytes with SHA-256 `dc478c23fc13d8919d9dc5b0ff14f541da2dfff4e48fc751935cf887e2c52695`.

## Release 1.1 production object-storage operations

- `packages/media/src/object-store.ts` owns `ObjectStore`, `FileSystemObjectStore`, `S3ObjectStore`, environment parsing, key validation, and the sole runtime factory. Web, companion content upload, ingestion, and campaign execution all call this factory or the web process singleton; do not construct provider stores in a route or worker.
- `ObjectStoreConfiguration` is a discriminated union. `{kind: "filesystem", root}` is development-only. `{kind: "s3", bucket, region, endpoint?, forcePathStyle?, prefix?, accessKeyId?, secretAccessKey?, sessionToken?, maxReadBytes?}` contains normalized server configuration but no object data.
- `S3CommandClient` is the minimal injected `send(PutObjectCommand|GetObjectCommand)` interface used for deterministic tests. Production receives an AWS `S3Client` with `maxAttempts=2`; tests may supply a request-capturing fake. It is not a global registry or credential cache.
- S3 keys are `optional-prefix/(originals|derivatives)/<64 lowercase hex>/<safe suffix>`. `OBJECT_KEY_PATTERN`, the normalized prefix, and traversal/double-separator rejection are defense in depth; authorization remains the tenant-bound PostgreSQL asset lookup.
- `putImmutable` refuses objects above `MEDIA_OBJECT_MAX_READ_BYTES`, sends `IfNoneMatch: "*"`, `ChecksumSHA256`, and `market-me-sha256` metadata, then verifies existing bytes after 412. A transient 409 performs one read and, only after 404, one conditional retry. Do not convert either path to an unconditional overwrite.
- `read` requests checksum mode, rejects a declared or streamed body above the configured bound, and verifies returned base64 S3 and hex metadata checksums when present. Missing provider checksum metadata does not replace Market Me's content-addressed key and downstream database hash checks.
- `mediaGlobal.marketMeMediaStore` is the existing development-only process singleton, now typed as `ObjectStore`. The S3 SDK maintains its own connection pools; no mutable global `Map`, list, tuple, bucket dictionary, or per-tenant credential collection was added.
- `scripts/qa-s3-server.mjs` is a disposable in-memory loopback protocol fixture, not an installable storage product. Start it with `npm run qa:s3-server`, run `npm run qa:s3-object-store`, and stop it. It does not authenticate signatures, persist data, implement bucket policy, or qualify as production backup.
- Production workers validate storage configuration during startup. The Next.js web process validates it on the first media operation, while the production build remains environment-independent. Configure every runtime identically and test one ingest/read/publish path before accepting traffic.
- Provider setup remains operational: enable bucket versioning and server-side encryption, block public access, grant only the required object actions for the exact bucket/prefix, retain access logs, configure lifecycle/replication or backup, and run documented restore drills. Database, Temporal, bucket-policy, and object-version recovery remain separate Release 1.2+ work.
- Verification: 275 TypeScript tests (24 media and 34 live database), all typechecks, web lint, 90-page production generation, companion/native builds, three Rust tests, 90-migration fresh replay, zero npm vulnerabilities, and live loopback SDK acceptance.
- Installer `Market Me Companion_1.1.0_x64-setup.exe` is 2,944,030 bytes with SHA-256 `0025a9b463915c440c4eaf10864f929a642e09301a882a040b6a17eda6ea5729`.

## Release 1.2 PostgreSQL recovery operations

- `scripts/qa-database-recovery.mjs` is a local logical-recovery acceptance harness. It operates only through the configured development container and never acts as a scheduled production backup job.
- `QA_DATABASE_RECOVERY_ACKNOWLEDGE_QUIESCED` is an exact Boolean safety interlock and must equal `true`. Set it only after stopping web/worker writers; the script also compares source counts before/after the dump and rejects drift.
- `QA_POSTGRES_CONTAINER`, `QA_DATABASE_SOURCE`, and `QA_DATABASE_USER` are optional bounded identifiers defaulting to `market-me-postgres-1`, `market_me`, and `market_me`. The source cannot be `postgres`, `template0`, or `template1`.
- `suffix` is 48 bits of per-run random hex. `restoreDatabase` is `market_me_restore_qa_<suffix>` and `dumpPath` is `/tmp/market-me-recovery-<suffix>.dump`; both stay process-local and their exact generated targets are the only cleanup scope.
- `sourceTablesBefore`, `sourceTablesAfter`, and `restoredTables` are insertion-ordered local `Map<string,string>` values from a sorted public-table query. They contain table names and decimal count strings, not row bodies. Deep equality proves inventory/count consistency.
- `sourceMigrations` is ordered tab-delimited `version/checksum` text. The script compares it exactly with the restored database and reports only the count. `listing` is the pg_restore archive catalog and must contain public table-data entries.
- All Docker, pg_dump, pg_restore, psql, createdb, dropdb, and rm invocations use `execFile` argument arrays with a 16 MiB output cap and hidden Windows process windows. No shell expansion, command interpolation, password argument, host dump, or row logging is used.
- Run: stop application writers, set `$env:QA_DATABASE_RECOVERY_ACKNOWLEDGE_QUIESCED='true'`, execute `npm run qa:database-recovery`, then remove the environment acknowledgement. The runbook and production validation order live in `docs/RECOVERY.md`.
- Acceptance restored 120 public tables and 90 migrations in 38,091 ms and cleaned its generated database/dump. The duration is workstation fixture evidence, never an RPO/RTO or scale forecast.
- Final verification: 275 TypeScript tests, 34 live database tests, all workspace checks/builds, three Rust tests, 90-migration replay, zero npm vulnerabilities, successful recovery drill, and successful negative safety-interlock test.
- Installer `Market Me Companion_1.2.0_x64-setup.exe` is 2,947,217 bytes with SHA-256 `8adf406b4efbaf61d80a4a6eb39d9ad4955c36439f2f5c13c42f9b7aa67689bc`.

## Release 1.3 web readiness operations

- Route `/api/health` is liveness only. It returns `market-me-web`, `ok`, the imported `apps/web/package.json` version, and UTC `checkedAt`; `dynamic=force-dynamic` plus `Cache-Control: no-store` prevents stale probe data.
- Route `/api/ready` calls `checkWebReadiness`, returns the identical non-secret projection with HTTP 200 for `ready` or 503 for `not_ready`, and is the load-balancer/orchestrator traffic gate for the web process.
- `READINESS_CHECK_NAMES` is the readonly seven-item tuple defining stable public keys. `ReadinessCheckName` and the `checks` record close the response vocabulary; never add raw error, URL, host, credential, provider body, migration checksum, or configuration value.
- `configurationChecks` validates database URL, canonical app origin, production identity, shared object-store configuration, and production secret relationships. Development skips production identity/secret requirements but still requires database/origin/storage configuration.
- `EXPECTED_DATABASE_MIGRATION=0090_workspace_invitations.sql` and `EXPECTED_DATABASE_MIGRATION_COUNT=90` bind readiness to this release. A future migration release must update both constants and tests in the same change after adding the immutable SQL file.
- `DatabaseReadinessEvidence` contains only `migrationCount` and optional `latestMigration`. The default probe uses a one-connection client with five-second connect and one-second idle/close bounds, proves `SELECT 1`, and aggregates only the migration ledger.
- `DatabaseOptions.connectTimeoutSeconds` is the new provider-neutral database-client option; ordinary callers default to ten seconds and readiness explicitly uses five. It adds no pool global or process timer.
- `checkWebReadiness` accepts injected environment, database probe, version, and clock for deterministic tests. All caught database/configuration errors collapse to `not_ready`; the response never includes exception messages.
- Configure an orchestrator liveness probe on `/api/health` and readiness/traffic probe on `/api/ready`. Do not restart a healthy process merely because a dependency is temporarily not ready; do not send traffic because liveness alone is 200.
- Verification: 279 TypeScript tests (80 web, 34 live database), all workspace checks, 89-page production generation, native builds, three Rust tests, zero npm vulnerabilities, and live 1.3 HTTP acceptance.
- Installer `Market Me Companion_1.3.0_x64-setup.exe` is 2,943,795 bytes with SHA-256 `a8f52bd39214434e9949ea4570f09c92cafe74c214b1eb0ea3e39de25240216e`.

## Release 1.4 worker heartbeat operations

- Apply immutable migration `0091_service_heartbeats.sql` before starting 1.4 web or workers. File and ledger SHA-256 are `cf1bce8e99e964923d082e3242b82c3cc1b9b9afdd65f19ec46d6077a1d00d6c`. The release expects 91 migrations with 0091 latest.
- `SERVICE_HEARTBEAT_INTERVAL_SECONDS` is shared by `apps/worker` and `apps/workflow-worker`; default 30, integer range 5-through-60. `SERVICE_HEARTBEAT_MAX_AGE_SECONDS` is read by web readiness; default 120, integer range 15-through-600. Keep max age comfortably above cadence plus ordinary database jitter.
- Start the web alone in development as before: worker checks are explicitly ready outside production. Production requires at least one fresh instance of both service classes and will return 503 until both initial writes succeed.
- Repository types and intent: `OperationsRepository` owns SQL; `ServiceHeartbeat` carries closed service/UUID/version; `ServiceFreshness` carries two aggregate Booleans; `ServiceHeartbeatLease` owns one timer and one optional in-flight promise. Do not introduce a second timer in poll/dispatch loops or cache freshness in process globals.
- Workers await `heartbeat.start()` before their loops. On shutdown, they stop the lease before database close. A forced kill cannot set `stopped_at`; the row ages out after the configured maximum. Stale and stopped rows may be retained for operations analysis but do not count as ready.
- Run `npm run qa:worker-readiness` after a production web build with `DATABASE_URL` set. It uses port 3114, creates two random rows, proves 200/fresh and 503/stopped-workflow projections, kills its direct Next process, deletes only its UUIDs, and reports no secrets.
- Live acceptance observed real ingestion and workflow processes writing version 1.4.0 active rows. Ingestion run-once marked stopped gracefully; workflow was explicitly terminated after observation and its exact QA row was removed. Temporal services were stopped with volumes preserved.
- Fresh replay applied all 91 migrations into 121 public tables and matched the 0091 checksum; the generated replay database was force-dropped afterward. Main database contains no 1.4 QA heartbeat rows.
- Full gate: 282 TypeScript tests (web 82, workflow worker 15, companion protocol 4, connectors 56, database 35, domain 23, generation 29, ingestion 11, media 24, workflows 3), all workspace typechecks, web lint, 89-page production generation, companion/native builds, three Rust tests, zero npm vulnerabilities, and clean ports 3000/3114.
- Installer `Market Me Companion_1.4.0_x64-setup.exe` is 2,945,441 bytes with SHA-256 `d50757ea5c009f5d46f50a9a3a4a82eb4a6e45dc4126e8a2d6df037c24325a47`.
- Rollback: remove worker checks from the deployment traffic policy before deploying 1.3 web, stop 1.4 workers, retain additive migration/table rows, and never refresh rows manually. Restore a compatible web/workers set before reinstating the gate.

## Release 1.5 Mailchimp email operations

- Apply immutable migration `0092_mailchimp_email.sql` before starting 1.5 web/workflow workers. SHA-256 is `ec1482fce0857f03769e821b1ff29ef73ca5ba3b138c4ad49e5b83b70fd3e604`; the release expects exactly 92 migrations with 0092 latest and 121 public tables.
- No process-global environment variable was added. An operator creates a `mailchimp_email` Channel Connection through Integrations with `apiKey`, `audienceId`, `fromName`, and `replyTo`. The API key must be a bounded Mailchimp key ending in a data-center suffix such as `-us21`; it is encrypted with the existing connector-token key and is never returned.
- Use a provider audience whose opt-in, unsubscribe, bounce, and complaint policies have been reviewed. Market Me does not create/import contacts. The sender name and reply-to address must be authorized for the Mailchimp account before production use.
- Generate the channel preview after selecting the connection. The Campaign step must require approval and reference that exact ready preview. Editing content requires a new preview and approval; direct JSON email content is intentionally rejected.
- `MailchimpEmailConnector.publishCampaign` supports immediate send only. Its local variables `campaignId`, `html`, and `plainText` are request-scoped; the persisted publication action, not process memory, is retry authority. Do not add a blind create retry or accept a client-supplied provider ID.
- Run `npm run qa:mailchimp-email` for bounded loopback protocol acceptance. It uses port 3115 and proves the exact `GET audience -> POST campaign -> PUT content -> POST send` sequence, staged ID persistence, unsubscribe content, and tracked link output; it sends no external email.
- Full gate: 291 TypeScript tests (web 84, workflow worker 17, companion protocol 4, connectors 61, database 35, domain 23, generation 29, ingestion 11, media 24, workflows 3), all workspace typechecks, web lint, 89-page production generation, companion/native builds, three Rust tests, zero production dependency vulnerabilities, `qa:worker-readiness`, and a clean 92-migration replay.
- Installer `Market Me Companion_1.5.0_x64-setup.exe` is 2,945,353 bytes with SHA-256 `4c03a9b7c937ec45e497b4a1962f13caa74dee7c547f9615b89e517bf653c562`.
- Before real launch, perform a controlled smoke send to a provider-owned test audience and reconcile the resulting Campaign in Mailchimp. Release 1.5 does not yet ingest deliveries, opens, clicks, unsubscribes, bounces, or complaints.
- Rollback by disabling Mailchimp Channel Connections and stopping 1.5 workflow workers before deploying older code. Retain migration 0092, encrypted connection evidence, previews, publication actions, and provider IDs; do not delete or resend unresolved provider Campaigns.

## Release 1.6 Mailchimp report operations

- Apply `0093_mailchimp_campaign_reports.sql`, `0094_mailchimp_metrics_capability.sql`, and `0095_mailchimp_report_audience_snapshot.sql` before starting 1.6 web. Checksums are `163b812bf94e59c5a741dc81c4073c6bdc94ddce288adbad065808037b0cb4f6`, `3552bc728ee4b1775bb36a38fda9b6705f1452b8c934ba4e904c773095e66dd3`, and `b38c006eabe789ea33010643fd6503a7e3a548e0c79ce2c2eb2f23ef78e54568`. Migration 0095 backfills and then requires the immutable observed audience ID; readiness expects exactly 95 migrations with 0095 latest.
- No new credential or global environment variable exists. Report reads reuse the encrypted API key and safe audience ID on the exact Mailchimp Channel Connection; connector-token key availability remains mandatory.
- On a Campaign run, a workspace owner, administrator, or editor can choose `Refresh aggregate report` beside a Mailchimp publication with a provider ID. Viewers/analysts do not receive the mutation control, and the API independently requires write access.
- `MailchimpEmailConnector.getCampaignReport(campaignId,audienceId)` issues one bounded GET with an explicit aggregate field projection. Do not broaden it to recipient/member/open-detail/click-member/email-activity endpoints.
- `recordMailchimpCampaignReportSnapshot` canonicalizes metrics locally, locks the action, validates exact identities, inserts only a new hash, optionally reconciles sent status, and writes a minimized audit. No process global, mutable map, recipient list, or background timer was added.
- Run `npm run qa:mailchimp-report`; port 3116 proves the exact aggregate request, identity checks, totals, no recipient material, and cleanup. Continue running `qa:mailchimp-email` and `qa:worker-readiness` as adjacent release gates.
- Full gate: 293 TypeScript tests (web 84, workflow worker 17, companion protocol 4, connectors 63, database 35, domain 23, generation 29, ingestion 11, media 24, workflows 3), all workspace typechecks/lint/builds, 89 pages, three Rust tests, zero production vulnerabilities, and clean 95-migration/122-table replay.
- Installer `Market Me Companion_1.6.0_x64-setup.exe` is 2,944,804 bytes with SHA-256 `f5c6e53951e027c952920195f2a50ae0bb3082dab09343e6dde4121e60cb486e`.
- Roll back code only after disabling report refresh at the edge. Retain migrations/snapshots and never infer that an older absent snapshot reverses a provider result. Release 1.5 can ignore the additive tables but cannot display or perform report reconciliation.

## Release 1.7 provider aggregate metric operations

- Apply immutable migration `0096_campaign_provider_metric_totals.sql` before starting 1.7 web/workflow workers. SHA-256 is `5a362985855d4c4cc56fe2810aba17ec97b64ce837370aa5b5478bfb200b8a31`; readiness expects exactly 96 migrations with 0096 latest and a fresh schema contains 123 public tables.
- No environment variable, credential, process-global dictionary, poller, or timer was added. Aggregate updates occur only inside the existing authenticated Mailchimp report-refresh transaction.
- The current-total row variables are `metric_type`, `metric_total`, `report_snapshot_id`, and `observed_at`; do not detach them from publication/workspace/Campaign identity or overwrite immutable report snapshots.
- Campaign authors may select six provider aggregate types only for count criteria. Exact-currency value criteria and measurement ingest keys remain restricted to normalized `MEASUREMENT_EVENT_TYPES`.
- Run `npm run qa:mailchimp-report`, `npm run qa:mailchimp-email`, and `npm run qa:worker-readiness`. Live database integration additionally proves threshold crossing, correction below threshold, one durable command, exact source labels, and original audience preservation.
- Full gate: 294 TypeScript tests (web 84, workflow worker 17, companion protocol 4, connectors 63, database 35, domain 24, generation 29, ingestion 11, media 24, workflows 3), all workspace typechecks/lint/builds, 89 pages, three Rust tests, zero production vulnerabilities, and clean 96-migration/123-table replay.
- Installer `Market Me Companion_1.7.0_x64-setup.exe` is 2,945,659 bytes with SHA-256 `6db3d5845b8b4e473cfd980e116d947dd2c2bf01e60e7072d301ada35a6008f5`.
- Roll back application code only after disabling report refresh and provider-metric criteria authoring. Retain migration 0096, current projections, source snapshots, and any queued success command; older code may ignore additive rows but must not forge events or delete threshold evidence.

## Release 1.8 automatic Mailchimp report-collection operations

- Apply immutable migrations `0097_mailchimp_report_collection.sql` and `0098_mailchimp_collection_audience_snapshot.sql` before starting 1.8 web/workflow workers. SHA-256 values are `f0a3106195ee14f634c034d2f3baca546695eb398666cb9971bd61580f2e6fc7` and `f0d4976f95a704204431888291a47333b68f850a949deb4c2fb4e362dd91aa2f`. Readiness expects exactly 98 migrations with 0098 latest; fresh replay has 124 public tables.
- Collection is fail-closed by default. Set `MAILCHIMP_REPORT_COLLECTION_ENABLED=true` only after the existing `CONNECTOR_TOKEN_ENCRYPTION_KEY` is available and provider/API/network monitoring is owned. Exact variables: loop `30000` ms (5000-60000), batch `10` (1-50), refresh `900` seconds (300-86400), and max age `604800` seconds (3600-2592000).
- `reportCollectionEnabledValue` is the request-start scalar used for strict `true|false` parsing. `reportCollector` is one optional process object. `reportCollectionLoop` runs sequential bounded passes; it does not maintain an in-memory target list, timer registry, recipient cache, or second worker heartbeat.
- Repository claims use a due index, exact tenant/provider/active-connection joins, five-minute stale recovery, action age cutoff, and `SKIP LOCKED`. `completeMailchimpReportCollection` accepts delay 60-86400 seconds and one optional SQL-constrained safe error code.
- Failure delay policy: bounded provider `Retry-After` wins; authorization/validation/permanent/credential failures wait at least 3600 seconds; other closed failures use `min(refresh,60*2^(attempt-1))`, with exponent capped at six and final delay clamped to 60-86400 seconds.
- `recordPublicationProviderIdentity` creates the schedule with the preflight audience in the same transaction that first saves the provider Campaign ID. The report route and automatic collector both use collection-state audience identity, so a later connection edit cannot retarget the historical publication.
- Run `npm run qa:mailchimp-email`, `npm run qa:mailchimp-report`, `npm run qa:mailchimp-report-collector`, and `npm run qa:worker-readiness`. The collector check proves one aggregate-only request, exact bounds, no recipient fields, and successful reschedule without contacting Mailchimp.
- Full gate: 296 TypeScript tests (web 84, workflow worker 19, companion protocol 4, connectors 63, database 35, domain 24, generation 29, ingestion 11, media 24, workflows 3), all workspace typechecks/lint/builds, 89 pages, three Rust tests, all 35 live database tests, zero production vulnerabilities, clean QA ports, and clean 98-migration/124-table replay.
- Installer `Market Me Companion_1.8.0_x64-setup.exe` is 2,945,202 bytes with SHA-256 `559de0c92a514476720d9ffb71b2bda0068900715d2db7cb36699e0c9f33b4be`.
- Roll back by setting collection enabled to false and stopping/draining compatible workflow workers before older code. Retain both migrations, schedules, attempt/error history, snapshots, projections, and commands. Never clear claims/attempts or change audience IDs to force a retry; wait for a compatible worker or perform a reviewed database repair.

## Release 1.9 signed Mailchimp webhook-wakeup operations

- Apply immutable migration `0099_mailchimp_signed_webhook_wakeups.sql` before 1.9 web/workflow workers. SHA-256 is `9b7ba0079168538fa6d538414b087b5a01e5073f48c0c4da50c1748397af9dd9`; readiness expects exactly 99 migrations with 0099 latest and fresh replay has 124 public tables.
- No new environment variable exists. The Integrations control requires the existing `PUBLIC_WEBHOOK_BASE_URL` to be an HTTPS origin and the existing `CONNECTOR_TOKEN_ENCRYPTION_KEY` to encrypt the per-connection secret.
- In Mailchimp Audience Settings, create a signed webhook using the displayed `/api/webhooks/mailchimp/{connectionId}` callback and select Campaign sending only. Copy the shown-once secret into Market Me immediately; do not put it in environment files, logs, tickets, screenshots, or documentation.
- `encodeMailchimpCredentialBundle` writes version 1 with API key and optional secret; `decodeMailchimpCredentialBundle` preserves legacy API-key-only envelopes. All send/report/collector consumers extract only `apiKey` before connector construction.
- Incoming POST must be `application/x-www-form-urlencoded`, at most 32,768 bytes, carry exact `t=10-digits,v1=64-lowercase-hex`, and be within 300 seconds. Raw bytes are HMAC-verified before URL decoding; only exact sent Campaign/list identity survives parsing.
- `wakeMailchimpReportCollectionFromWebhook` never clears a current claim. A newer verified delivery advances a future/backed-off schedule to now; duplicate or wrong Campaign/audience evidence returns no mutation. Polling remains enabled independently as the completeness path.
- Run `npm run qa:mailchimp-webhook` plus email/report/collector/readiness QA. The signed fixture includes address/IP/merge fields and proves the returned wakeup omits them while rejecting tampered and 301-second-old deliveries.
- Full gate: 301 TypeScript tests (web 87, workflow worker 19, companion protocol 4, connectors 65, database 35, domain 24, generation 29, ingestion 11, media 24, workflows 3), all typechecks/lint/builds, 89 pages, all 35 live database tests, 3 Rust tests, zero vulnerabilities, clean QA ports, and 99-migration/124-table replay.
- Installer `Market Me Companion_1.9.0_x64-setup.exe` is 2,943,638 bytes with SHA-256 `981e87edaf74f8d358fa521fa1a0e689ecc41f01982dc657cbb137f97747b9f5`.
- Roll back by deleting/disabling the Mailchimp webhook before deploying older web code, disabling automatic collection if required, and retaining migration 0099/evidence. Never expose or copy the secret out of its encrypted envelope; recreate and rotate the provider webhook after any uncertain secret handling.
- Rollback to 0.99 keeps migrations 0089-0090 and all identity/invitation evidence. Disable production access until compatible code returns; never enable the development bootstrap in production.

## Release 1.10 managed Mailchimp webhook-lifecycle operations

- No migration or new environment variable exists. Deploy with the existing exact 99 migrations/124 public tables. Managed controls require an HTTPS `PUBLIC_WEBHOOK_BASE_URL`, `CONNECTOR_TOKEN_ENCRYPTION_KEY`, one active tested Mailchimp connection, and its exact `configuration.audienceId`.
- In Integrations, **Provision managed webhook** inventories the configured audience and creates only Campaign sending with recipient events disabled. If an exact callback or previously stored managed ID exists, the first request returns a conflict; review the displayed scope and explicitly confirm replacement.
- Replacement deletes only resources returned by `webhooksEligibleForReplacement`, then creates a new provider webhook and immediately encrypts the shown-once secret. Do not retry by editing configuration JSON, copying a secret, deleting unrelated audience hooks, or disabling report polling.
- **Check provider status** performs a live bounded inventory and returns the closed health state. Treat missing, drifted, secret-missing, manual-unverified, and unmanaged states as operational findings; replace through the same control rather than claiming the callback is healthy.
- **Disable signed wakeups** removes the stored managed provider webhook when present, stores an API-key-only encrypted bundle, clears managed metadata, and leaves durable aggregate collection unchanged. Manual compatibility removes only local secret state because Market Me has no verified provider ID to delete.
- Provider create is ambiguity-sensitive. Unexpected settings or missing one-time secret trigger immediate cleanup. A valid create followed by local persistence failure also triggers cleanup; `provider_cleanup_ambiguous` requires provider inventory/replacement before another success claim.
- Run `npm run qa:mailchimp-webhook-lifecycle` plus `qa:mailchimp-webhook`, email, report, collector, and worker-readiness. The lifecycle loopback proves exact POST/inventory/DELETE/inventory order, Campaign-only settings, zero recipient events, captured secret, active health, removal, and no secret in output.
- Full gate: 306 TypeScript tests (web 90, workflow worker 19, companion protocol 4, connectors 67, database 35, domain 24, generation 29, ingestion 11, media 24, workflows 3), all typechecks/lint/builds, 89 pages, all 35 live database tests, 3 Rust tests, zero vulnerabilities, clean ports 3114-3118, and unchanged 99-migration/124-table replay.
- Installer `Market Me Companion_1.10.0_x64-setup.exe` is 2,946,970 bytes with SHA-256 `721ec572c2b8295a29a00787de9cbc64939cccb2bb4293a5da9e573529ba0670`.
- Roll back by using the 1.10 disable control before deploying 1.9, or inventory/delete the exact stored provider ID through an approved operator path. Retain the encrypted/API configuration and all 0099 evidence; never expose the one-time secret. Polling must remain enabled through provider lifecycle changes.

## Release 1.11 managed-webhook health-monitor operations

- Apply immutable migration `0100_mailchimp_webhook_health_monitor.sql` before 1.11 web/workflow workers. SHA-256 is `3018f22f2d4aea8416a2cb066172b88c9dffb48aabf5eaa70f543b74937212be`; readiness expects exactly 100 migrations with 0100 latest, and fresh replay has 125 public tables.
- Monitoring is opt-in. Set `MAILCHIMP_WEBHOOK_HEALTH_MONITOR_ENABLED=true` only with `CONNECTOR_TOKEN_ENCRYPTION_KEY`; invalid values fail startup. `LOOP_MS` accepts 5000-60000, `BATCH_SIZE` 1-50, and `INTERVAL_SECONDS` 300-86400.
- Each pass claims due managed connections only. The normal interval applies to active and identity/settings-unhealthy results. Provider Retry-After is bounded; authorization/validation/permanent/credential failures wait at least one hour; transient/unknown uses bounded exponential delay.
- Automatic monitoring is read-only. It must never create, update, delete, rotate, or adopt a webhook. Use Integrations live check for immediate evidence and the explicit Release 1.10 replacement control for repair.
- Integrations displays automatic health only after a completed monitor check. A latest closed error can coexist with an older successful health/time; do not read that as current provider health. Consecutive count resets only on `managed_active`.
- Run `npm run qa:mailchimp-webhook-health-monitor` plus lifecycle, signed webhook, email, report, collector, and worker-readiness QA. The health fixture proves two GET-only inventories, active+drifted states, no mutation, and no secret output.
- Full gate: 309 TypeScript tests (web 90, workflow worker 22, companion protocol 4, connectors 67, database 35, domain 24, generation 29, ingestion 11, media 24, workflows 3), all typechecks/lint/builds, 89 pages, all 35 live database tests, 3 Rust tests, zero vulnerabilities, clean ports 3114-3119, and 100-migration/125-table replay.
- Installer `Market Me Companion_1.11.0_x64-setup.exe` is 2,943,514 bytes with SHA-256 `86b7b13e0ab12bfeba10c61f4b407a91214b0405d299227731bf268988a43adc`.
- Roll back by setting monitor enable false and stopping/draining compatible workflow workers before older code. Retain migration 0100 and health history; never bulk-clear claims/counters or reinterpret stale health as active. Report polling and explicit provider reconciliation remain authoritative.

## Release 1.12 Slack incoming-webhook operations

- Apply immutable migration `0101_slack_incoming_webhook.sql` before 1.12 web/workflow workers. SHA-256 is `c3d76ed97527abf130052af6837c8065992bbf0c7cae3a3bfcdb779ba393567e`; readiness expects exactly 101 migrations with 0101 latest, and fresh replay has 125 public tables.
- No environment variable is added. The existing `CONNECTOR_TOKEN_ENCRYPTION_KEY` is mandatory before test/save or execution. Production egress must permit only the exact Slack/GovSlack hosts needed by the deployment.
- In Slack app settings, enable incoming webhooks and create one webhook for the intended channel. Treat the complete URL as a secret. Do not store it in Campaign JSON, screenshots, tickets, documentation, logs, or source control.
- Saving a Slack connection posts `Market Me connection test — no Campaign content was published.` as a visible channel message. The UI discloses this side effect. Do not use a sensitive or high-volume channel for connection testing.
- `CHANNEL_PROVIDERS`, `ChannelProvider`, migration 0101, the web discriminated schema/form, connector manifest, Draft renderer, database types, and workflow router are one closed cross-package contract. Update all of them together for any future provider addition.
- `SLACK_WEBHOOK_CAPABILITIES.limits` is the operative preview policy: 4,000 content characters, zero Market Me attachments, and one message per second per channel. It is a timestamped snapshot, not a global mutable provider registry.
- Runtime requires an exact ready approved Draft preview and approval-required Campaign step. It locally compares host/team/service from decrypted URL to saved configuration, creates/recovers the normal publication action, and sends one payload with markup, automatic mention expansion, and unfurls disabled.
- Success is exact HTTP 200 plus a bounded `ok` response. `provider_external_id` and `provider_url` intentionally remain null. Network/5xx/unknown/oversized acknowledgement is ambiguous and must be reviewed in Slack before any manual completion; never clear the action or retry it by hand to force resend.
- Run `npm run qa:slack-webhook`. The loopback proves the visible test marker, exact approved content, safe identity binding, markup/mention/unfurl suppression, absence of provider message identity claims, secret-free output, and port cleanup.
- Full gate: 317 TypeScript tests (web 90, workflow worker 24, companion protocol 4, connectors 72, database 36, domain 24, generation 29, ingestion 11, media 24, workflows 3), all typechecks/lint/builds, 89 pages, all 36 live database tests, 3 Rust tests, zero production vulnerabilities, browser acceptance with zero warnings/errors, clean QA ports, and 101-migration/125-table replay.
- Installer `Market Me Companion_1.12.0_x64-setup.exe` is 2,945,935 bytes with SHA-256 `2b3091a3254f6246d2c1aaac8651908cb3696bee519fbdcd7bb3df3727edf0a2`.
- Roll back by stopping/draining 1.12 workflow workers and disabling Slack-targeted Campaign execution before deploying 1.11. Retain migration 0101, encrypted connections, previews, actions, and audits. Version 1.11 cannot author or execute Slack rows; do not rewrite them to Discord, delete ambiguous actions, expose the URL, or resend uncertain publications.

Known limitations: incoming webhooks do not return message IDs/URLs and cannot retrieve, edit, delete, reconcile, schedule, upload files, read metrics, monitor events, or ingest conversations. Rich blocks, OAuth installation, Web API message identity, channel discovery, file upload, signed events, outcomes, and inbound/reply flows require separate releases and scopes.

## Release 1.13 build and operations

- Set `MASTODON_ALLOWED_HOSTS` to a comma-separated list of exact lowercase production instance hostnames in both the web and workflow-worker environments. Empty means Mastodon connection creation/execution fails closed. Values are hostnames only: no scheme, path, port, wildcard, credentials, query, or fragment.
- Create a bounded Mastodon user access token with only the provider scopes required for credential verification and status creation. Enter its undecorated instance origin and token in Integrations. The test makes two reads and no status; the token is encrypted and never returned.
- `CHANNEL_PROVIDERS`, the database `ChannelProvider`, migration 0102, web Zod union/form, runtime router, tracked-link source map, connector tests, and documentation are a closed change set. Dynamic `contentCharacters` and `charactersReservedPerUrl` limits must equal safe configuration and are rechecked before dispatch.
- Important readonly/global values are `CHANNEL_PROVIDERS` and each manifest; `MASTODON_ALLOWED_HOSTS` is parsed once per process into a readonly array. Important request-scoped objects are `providerIdentity`, `configuration`, `providerPreflight`, the exact status payload, and the bounded provider response. No mutable global account/token map exists.
- Run `npm run qa:mastodon-account`. It starts a loopback receiver while keeping the configured provider origin synthetic, proves two read-only preflight calls, one exact idempotent public write, same-instance ID/URL, secret-free output, and deterministic cleanup.
- Full gate: 325 distinct TypeScript tests (web 90, workflow worker 26, companion protocol 4, connectors 77, database 37, domain 24, generation 29, ingestion 11, media 24, workflows 3), 3 Rust tests, all lint/type/build/native gates, 89 pages, all 37 live database tests, zero production vulnerabilities, browser acceptance, clean ports/session state, and 102-migration replay.
- Installer `Market Me Companion_1.13.0_x64-setup.exe` is 2,942,952 bytes with SHA-256 `d260c47b6ee8caf3882cead1650e69914748d37aa67ec64633867383805f8efa`.
- Roll back by stopping/draining 1.13 workers and disabling Mastodon-targeted Campaign execution before deploying 1.12. Retain migration 0102, encrypted connections, previews, actions, and audit evidence. Version 1.12 cannot author or execute these rows; never rewrite them as another provider or resend an uncertain status.

## Release 1.14 implementation notes

- Official contracts used: Mastodon `POST /api/v2/media`, `GET /api/v1/media/:id`, `POST /api/v1/statuses`, and instance configuration documented at `https://docs.joinmastodon.org/methods/media/`, `https://docs.joinmastodon.org/methods/statuses/`, and `https://docs.joinmastodon.org/entities/Instance/`.
- `mastodonMediaConfiguration(configuration,statuses)` validates provider integers and MIME arrays, intersects formats with JPEG/PNG/WebP, and returns capped generic attachment fields. Do not persist raw instance documents or arbitrary MIME values.
- `MastodonAccountConnector.uploadMedia(attachment,manifest)` validates filename, advertised MIME feature, byte size, and required approved description, then sends multipart `file` plus `description`. HTTP 200 may be ready; HTTP 202 persists the returned ID before bounded readiness polling. Network/5xx upload failure is ambiguous, not retryable.
- `MastodonAccountConnector.mediaReady(id)` performs only the same-origin authenticated media read and returns true when the exact ID has a nonempty URL. It does not mutate, delete, or adopt provider media.
- `providerAttachmentIds` passes only after repository persistence. `publishContent` adds `media_ids` in exact order and returns `metadata.attachmentCount` only when nonzero; text-only response metadata remains backward compatible.
- `CampaignExecutionRouter` validates live text/media capability equality, immutable bytes/hash, scan evidence, exact rights scopes, supported MIME, byte size, approved Unicode-counted alt text, and decoded pixels before creating a new action. It calls `listMastodonPublicationMedia` on retry and never re-uploads a matching known ID.
- Error intent: `rate_limit` and `transient` finish the action as failed so workflow retry can resume known IDs; `ambiguous` finishes ambiguous and requires manual reconciliation; validation/authorization/permanent errors fail without resend. Failure to persist an accepted ID is explicitly converted to ambiguous.
- Migration 0103 checksum is `b8f1489ed94fc1d57d4ea595cc5f057c41f38b4a40428326e82d8a655a876c6b`; migration 0104 checksum is `4fb9b04c8b7837645c3dce90f77b715cbf919e7a0e30bc065348bf37e64eb99a`. Both are applied and immutable. Readiness is exactly 104 migrations with latest `0104_mastodon_capability_constraint_hardening.sql`.
- QA: `npm run qa:mastodon-reviewed-images` proves two read-only preflight requests, one multipart upload containing approved alt text, one readiness read, one public status write with ordered IDs/idempotency, and no secret in output. Browser acceptance verifies the allowlist and reviewed JPEG/PNG/WebP disclosure. `npm run check`, live database tests, and `npm audit --omit=dev` must also pass.
- Release acceptance: 329 distinct TypeScript tests (web 90, workflow worker 28, companion protocol 4, connectors 79, database 37, domain 24, generation 29, ingestion 11, media 24, workflows 3), 3 Rust tests, all gates, 89 pages, all 37 live database tests, clean 104-migration replay, zero production vulnerabilities, clean ports/session state, and the 1.14.0 NSIS installer SHA-256 `254affbef9e02563dfb3a88573f2df384e834b16a73c30d83c59803e75a2f5ea`.

## Release 1.15 implementation notes

- Run migrations 0105 and 0106 before starting 1.15 web processes. Readiness requires exactly 106 migrations and latest `0106_mastodon_status_report_identity_hardening.sql`. Checksums are `b9a9cb949c162dfb704641b98f9f9ae66b262d0dbad394a81649ae6565f8624c` and `7284da6933d4a528f0b8f306c2bbeec787ef23b68829d04046e76be2b14c30c2` respectively.
- No new environment variable or credential is introduced. Existing `CONNECTOR_TOKEN_ENCRYPTION_KEY` and exact `MASTODON_ALLOWED_HOSTS` remain required for live refresh. The provider call is an authenticated read using the existing encrypted user token.
- `MastodonAccountConnector.getStatusReport(statusId,expectedAccountId)` is the only provider reporting boundary. Keep its five-second timeout, redirect rejection, exact origin/identity checks, 64-KiB response ceiling, safe-integer validation, and aggregate-only output when extending it.
- Repository snapshot writes are correction-aware, not additive. Never increment totals from a later report, explode totals into measurement events, or infer unique people. Every current projection must reference its exact immutable source snapshot.
- The writer route is `POST /api/v1/publication-actions/:id/mastodon-report` with strict `{workspaceId}` JSON and workspace write authority. The read measurement endpoint includes `mastodonReports`; the Campaign instance page renders the latest report per action and the existing provider-total summary.
- Run `npm run qa:mastodon-status-report`, `npm run qa:mastodon-account`, and `npm run qa:mastodon-reviewed-images` as adjacent gates. The new QA must report exactly one GET, exact status/account/origin binding, aggregate-only normalization, and no secret exposure.
- Browser acceptance uses a tenant-scoped disposable succeeded action/snapshot and verifies the exact aggregate sentence, refresh control, and provider aggregate labels. Delete the fixture action/connection/session and close the QA server/tab before release.
- Release acceptance: 331 distinct TypeScript tests (web 90, workflow worker 28, companion protocol 4, connectors 81, database 37, domain 24, generation 29, ingestion 11, media 24, workflows 3), 3 Rust tests, all gates, 89 pages, all 37 live database tests, clean 106-migration/127-table replay, zero production vulnerabilities, clean ports/session/fixture state, and the 1.15.0 NSIS installer SHA-256 `c5fa1318c78fa2e8ea83129ef51b3f3c668a39d94f06e12890bee2329372c46f`.

## Release 1.16 implementation notes

- Apply immutable migration `0107_mastodon_status_report_collection.sql` before 1.16 web or workflow-worker processes. Its SHA-256 is `840890e9581deba010e0fc25d0b011cc3d083e6d784125de278213261772f039`; readiness requires exactly 107 rows with 0107 latest, and a clean replay has 128 public tables with zero unvalidated constraints.
- `MASTODON_STATUS_REPORT_COLLECTION_ENABLED` is exactly `true` or `false` and defaults false. When true, `CONNECTOR_TOKEN_ENCRYPTION_KEY` and at least one exact `MASTODON_ALLOWED_HOSTS` entry are required during worker startup.
- `MASTODON_STATUS_REPORT_COLLECTION_LOOP_MS` defaults 30000 and is bounded 5000-60000; `MASTODON_STATUS_REPORT_COLLECTION_BATCH_SIZE` defaults 10 and is bounded 1-50; `MASTODON_STATUS_REPORT_COLLECTION_REFRESH_SECONDS` defaults 900 and is bounded 300-86400; `MASTODON_STATUS_REPORT_COLLECTION_MAX_AGE_SECONDS` defaults 604800 and is bounded 3600-2592000. These are process configuration values, not mutable module globals or database policy.
- `MastodonStatusReportCollectionTarget` carries exact worker-only claim identity and encrypted credentials. `StoredMastodonStatusReportCollectionState` is the safe UI projection. `MastodonReportCollectorOptions` is the bounded batch/refresh/age input; collector results contain only aggregate batch counts.
- `finishPublicationAction` must remain transactional: successful Mastodon completion and its first schedule are one commit. Claims must retain ordered `SKIP LOCKED`, five-minute stale recovery, recent-action filtering, exact workspace/action/connection/account/origin checks, and `read_metrics` validation.
- `MastodonReportCollector` must keep using `MastodonAccountConnector.getStatusReport`; do not add context, reaction-account, notification, search, timeline, reply-content, or other people/content endpoints. Never log claims, status URLs/IDs, account IDs, decrypted credentials, provider objects, or per-action counts.
- Run `npm run qa:mastodon-status-report-collector`, `qa:mastodon-status-report`, `qa:mastodon-account`, `qa:mastodon-reviewed-images`, and `qa:worker-readiness` with `DATABASE_URL` set. The collector QA proves one exact GET, bounded claim, immutable target binding, aggregate-only normalization, 900-second success cadence, and secret-free output.
- Browser acceptance must show the aggregate sentence plus next attempt, last success, closed result, and refresh button for one tenant-scoped disposable action. Delete its snapshot/schedule/action/connection/session/membership, close the tab/server, and verify no port or replay database remains.
- Release acceptance: 333 distinct TypeScript tests (web 90, workflow worker 30, companion protocol 4, connectors 81, database 37, domain 24, generation 29, ingestion 11, media 24, workflows 3), 3 Rust tests, all gates, 89 pages, all 37 live database tests, clean 107-migration/128-table replay, zero unvalidated constraints, clean ports/session/fixture/replay state, and installer SHA-256 `727211c73b16b3a67f6ba4fe71e986e1fc904c106b2bdb008d1cab34d995076f`.
- Rollback by disabling the collector, stopping/draining 1.16 workflow workers, and allowing five-minute claims to recover before 1.15 deployment. Keep migration 0107 and its state; do not delete schedules, rewrite immutable targets from current connection configuration, or turn missed intervals into additive measurements.

## Release 1.17 implementation notes

- This release adds no migration or environment variable. Readiness remains exactly 107 migrations with 0107 latest; the fresh schema remains 128 public tables with zero unvalidated constraints.
- `StoredMastodonStatusReportCollectionState.operationalStatus` is required and closed to `pending|scheduled|retrying|overdue|collecting|abandoned`. If a consumer adds a switch, make it exhaustive; never accept arbitrary provider/dynamic strings.
- Keep SQL precedence identical to claim semantics: stale claim before active claim, claim before due, due before closed error, error before prior success, then pending. Both stale checks use `now() - interval '5 minutes'` on the database clock.
- The status is read-only derived data. Do not add a column, trigger, cron updater, write API, cached global map, user override, or audit event. The underlying schedule transaction remains the only mutable source.
- Live database acceptance forces and verifies all six states, reclaims an abandoned lease, and confirms attempt counts advance 1/2/3. The web type/build gate proves API/UI shape compatibility.
- Browser acceptance uses a disposable exact tenant action with a six-minute-old claim and verifies `Mastodon collector: abandoned`, next attempt, last success, transient result, and manual refresh. Restore the development user's original membership and delete the session/action/connection/server/logs.
- Acceptance: 333 TypeScript tests, 3 Rust tests, all 37 live database tests, all gates, 89 pages, worker/collector readiness QA, zero production vulnerabilities, no migration change, and installer SHA-256 `8ffcd86d40b46e848be7bd91db1a20464a9b1425cca92e17edea5f3e4059fee9`.
- Roll back by stopping 1.17 web processes and deploying 1.16. No data rollback is required; older code ignores the derived API field and retains identical collector/schedule behavior.

## Release 1.18 implementation notes

- `getMastodonStatusReportCollectionOperationsSummary(workspaceId)` must reuse the exact 1.17 CASE precedence and action/state workspace join. All counts cast to PostgreSQL integer; empty workspaces return zeroes.
- Integrations shows the card only when `total>0`; `attention` means `overdue+abandoned>0`. Do not label retrying/collecting as unhealthy or interpret the card as provider readiness.
- Live database tests cover abandoned and scheduled summaries. Browser QA verifies one abandoned row, oldest abandoned time, and attention, then removes action/connection/session/membership/server/logs.
- No migration/config change; acceptance remains 333 TypeScript/3 Rust tests, all 37 live DB tests, 89 pages, zero vulnerabilities, and installer SHA-256 `1a658790fa5b37a83e00f0a09daf6a89d37ab5448bedcf8b0c054cd33caa364e`.

Known limitations: text-only public non-sensitive statuses; no OAuth app/authorization flow, media, content warnings, language/custom visibility, scheduling, edit/delete, metrics/events/replies, automatic allowlist changes, or compatibility claim for non-Mastodon ActivityPub servers.
