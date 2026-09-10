# Architecture

## Current checkpoint: 1.21 immutable draft evidence

Source refresh replaces current package evidence but must not erase the trace of an older approved draft. Claim links now identify captured generation-snapshot UUIDs independently of live `evidence_item` rows. A database proof function and insertion/update trigger validate exact workspace/version/generation lineage and the complete captured factual order. Historical backfill restores only provable missing links, never a text-based guess. See [Evidence retention](EVIDENCE_RETENTION.md) for the contract and rollout limits.

Generation holds a shared package-row lock while reading approval, revision and evidence. Ordinary and AI revisions preserve all facts, reject missing/invalid proof, and insert the complete claim set before its links. AI context construction checks proof before a paid invocation can be prepared. Historical UI trace distinguishes captured references from unavailable evidence and nonfactual calls to action. This does not transfer an old approval to refreshed content or add automatic publishing.

The review-first campaign starter remains planned, not implemented: [Campaign preparation](CAMPAIGN_PREPARATION_PLAN.md) describes its atomic/idempotent next slice. The existing scheduling architecture below remains applicable.

## 1.20 bounded scheduling

The current implementation adds absolute preferred request-start windows and delays after durable predecessor completion. It remains a modular monolith plus workers, not a full-product or production-readiness declaration. [Scheduling contracts](SCHEDULING_CONTRACTS.md) and [Implementation status](IMPLEMENTATION_STATUS.md) describe the boundary; the versioned sections below retain earlier design history.

- **A plan is immutable execution input.** Activation binds the published Campaign version, checks the current selected workspace connection/capabilities and route, then rechecks closed windows using database time before creating runs and the transactional start command. Authoring round-trips `dependencyDelaySeconds` and absolute UTC bounds without changing existing instants when the presentation timezone changes. Exact time remains a not-before target; preferred windows are half-open `[start,end)` intervals for starting a provider write, not promises about remote completion time.
- **The database owns time evidence.** `evaluateStepSchedule` combines the authored lower bound with each same-instance, pinned-version predecessor's first successful/partially-successful completion plus the dependency delay. `getStepScheduleState` returns that decision with one database `evaluatedAt`, exact target IDs and predecessor evidence. Historical fractional milliseconds are rounded inward: lower bounds/completions up and deadlines down. No browser time, arbitrary context value, newer draft, or dependency-batch start time can supply authority.
- **Temporal orchestration is versioned.** `patched("bounded-scheduling-v1")` selects the new independent-branch scheduler for new histories and the frozen 1.19 workflow/policy modules for unmarked replay. A successor becomes eligible after its own dependencies finish, even while an unrelated sibling is running. Approval, dependency and pause waits wake at the window deadline and re-read stored evidence. Recorded completion and canceled-timer histories from the frozen 1.19 source are replay-tested against the wrapper; that is not a claim about arbitrary older histories.
- **Recovery precedes permission for a new send.** V2 uses separate `getStepScheduleState` and `executeScheduledStep` activities; the legacy `executeStep` command remains unchanged. The scheduled activity verifies workspace/campaign/version/instance/run/step identity, invokes exact read-only publication recovery, and only then checks current running/approval/timing authority. Prior success is returned without preflight, link creation, media loading or I/O; dispatching/ambiguous outcomes require reconciliation. An expiry raised after preflight/admission triggers another recovery read before it can be labeled no-dispatch.
- **Publication admission is a short transaction, not an HTTP transaction.** Initial creation and failed-action retry share `admitPublication`: lock instance, pinned version/steps/runs/approvals, selected connection, exact Draft approval/draft/version/preview, relevant asset/source rows, Destination and tracked link; then re-read exact eligibility and compare rendered content/subject and preflight identity. The failed-to-dispatching claim still has one winner. A final database-clock read follows all lock/unique-index waits. Locks are released before provider HTTP; they do not recall an already admitted request or establish universal media/rights atomicity.
- **The final request has two conservative clocks.** After admission, the worker derives both a UTC cutoff and a same-process monotonic cutoff from a fresh database sample, charging the full read round trip and one millisecond. The connector takes the minimum of its normal timeout and both remaining intervals, rechecks before first I/O, and uses the same abort budget for headers and body. A request-start cutoff is distinct from ambiguous transport failure; valid late acknowledgements remain valid.
- **Missed windows and uncertain delivery are separate states.** Proven pre-dispatch expiry becomes `schedule_blocked`, retains its exact evidence and pauses the instance. Resume/manual completion cannot clear it at UI, API, command-queue, workflow-signal or persisted-state boundaries. Recovery is cancellation and a new published/reviewed plan for remaining work. Cancellation wakes pending branches immediately but waits for dispatched activities to settle; a late success or unresolved provider outcome is not overwritten by cancellation or a sibling's expiry.

Initial window execution is limited to text-only Discord, Slack and Mastodon with exactly `official_api`, an active publishing-capable selected account, no attachments and no fallback methods. Slack/Mastodon retain exact approved Draft preview and human-approval requirements. Positive delays also work for provider-free wait/request-approval steps and normal supported publication graphs. Any Campaign containing a preferred window or positive dependency delay rejects **all** `user_assisted` companion steps, including an otherwise-immediate predecessor, until the companion queue supports the same timing authority.

Conditional/follow-up execution, recurrence, evergreen rotation, quiet hours, slot reservations/collisions, automatic pacing and source-ready-to-template Campaign automation remain separate work. Mailchimp/media/browser/manual window routes remain saved-only. These changes introduce no new hosted service, scheduler-specific secret, or mutable application-global scheduling state. Deploy the compatible worker before admitting new plans and preserve legacy code/history retention; see [Development](DEVELOPMENT.md).

## Integrated 1.19 checkpoint (historical)

This checkpoint describes the 1.19.0 implementation; acceptance evidence is recorded in [Releases](RELEASES.md). [Implementation status](IMPLEMENTATION_STATUS.md) distinguishes implemented behavior from the approved specification's remaining requirements; older decisions and planned-topology labels below are retained as history. A local milestone is not production or whole-product acceptance.

- **Workspace selection is request state, not authorization.** `server/active-workspace.ts` resolves the session user's current `WorkspaceAccess[]` against the `mm_active_workspace` cookie. React `cache` deduplicates the page/shell lookup within one render; it is not a cross-request membership cache. A missing, forged, or revoked hint falls back to a current membership. No memberships produces an explicit no-access sign-in view. Pages, overview, calendar, Settings, and the shared shell use this selection. APIs that specify a workspace still authorize that exact workspace.
- **Switching is one authenticated Server Action.** `switchActiveWorkspace` verifies the configured application origin, validates one UUID, re-reads membership, writes the seven-day HttpOnly selection cookie, revalidates the root layout/client navigation cache, and replaces navigation with an allowlisted section root. Record IDs and query strings from the previous workspace are not carried across. Settings exposes current workspace/account facts and existing Team invitation administration; it does not imply workspace/profile/member-role editing endpoints.
- **Overview and calendar are repository projections.** Overview replaces demo metrics with saved sources, packages, runs, and pending draft/workflow approvals. Calendar uses each run's exact immutable workflow definition and independently displays unactivated draft/published plans. Reads of run definitions are grouped in batches of ten. Times are rendered in the version's timezone, with UTC fallback; saved exact times remain target times subject to dependencies, approval, pause, and execution health. This is a read-only agenda, not a recurring/evergreen scheduler, collision detector, or live metrics stream.
- **Campaign authoring preserves intent.** `campaign-step-form.ts` round-trips `scheduledAt`, preferred-window bounds, condition/input/output objects, execution methods, optionality, retries, and timeout fields. Date controls are explicitly UTC, including seconds and milliseconds. Unsupported plans can be saved without being silently reduced to immediate work; activation/runtime validation blocks unsupported schedules and conditions. Changing a display timezone does not reinterpret an already stored instant.
- **Execution authority is checked at multiple real boundaries.** `validateCampaignExecution` runs at activation and workflow start. Draft-only/unknown modes cannot execute; immediate, exact-time, dependency, and duration-wait behavior are implemented. Conditional confidence/history modes retain human review until their evidence-based waiver engines exist. Whole-campaign approval captures the exact version/steps in a request with no step-run foreign key and the reserved signal key `__campaign__`. Queued activities re-read active instance, running step, due time, completed dependencies, and relevant approvals before execution. Publication creation also re-reads the exact workspace/campaign/step/connection target and rejects idempotency-key reuse across targets. Slack, Mailchimp, and Mastodon continue to require exact approved previews and recorded human approval.
- **Mastodon incidents are a durable observation of eligible backlog.** Migration 0108 adds retained active/resolved incident rows. A nonblocking transaction advisory lock `(129691,119)` serializes observers; a single materialized attention query feeds resolution and upsert, avoiding separate observation snapshots. Eligibility matches collection's age, successful action, immutable provider identity, active connection, and metrics capability. Unclaimed attempts need five minutes of overdue grace; claims older than five minutes are abandoned. Expired or ineligible targets cease contributing to alerts, although the older all-schedule operations rollup still displays their schedule posture.
- **Recovered collection claims cannot be completed by an old worker.** Both aggregate snapshot writes and schedule completion receive the claimed `attemptCount`. Stale snapshot writes throw `MastodonReportCollectionClaimLostError`; stale completions return `false`. The worker counts these as `superseded` without modifying the new claim. Alert reconciliation occurs even on idle passes and failures do not block collection. Monitoring still runs inside the opt-in workflow collector: a disabled or stopped worker cannot independently observe its own outage, and this release adds no outbound collector-alert delivery.

The 1.19 change set preserved the existing modular monolith plus workers architecture and introduced no new hosted service or schema beyond collector migration 0108. The 1.20 scheduling migration and orchestration are described above.

## Decision summary

Market Me should be built as a modular TypeScript platform with a web control plane, durable worker services, a provider-neutral connector/model layer, PostgreSQL for transactional state, object storage for large assets, and an optional Tauri desktop companion. Start as a modular monolith plus workers; split services only when scale or ownership requires it.

This structure preserves one universal product model while allowing execution to vary by provider and deployment.

## Target topology

1. **Web control plane (`apps/web`)** — Next.js App Router for workspace setup, Smart Sources, Content Packages, campaigns, calendars, drafts, approvals, conversations, analytics, and operations.
2. **Application API (planned)** — authenticated commands and queries. The first build exposes Next.js Route Handlers; move high-throughput connector/webhook traffic to a dedicated Fastify service when needed.
3. **Workflow workers (`apps/workflow-worker`, `packages/workflows`)** — Temporal TypeScript workflows and activities for campaign graphs, durable timers, approval/manual signals, pause/resume/cancel controls, retries, persisted state, and transactional command dispatch.
4. **Connector adapters (planned)** — capability-described adapters for Google, Microsoft, social, email, commerce, community, analytics, and web destinations.
5. **Model Gateway (planned)** — task-based routing across cloud/local providers with budgets, privacy constraints, structured outputs, evaluation, and provenance.
6. **Desktop companion (planned)** — Tauri v2 application for encrypted browser sessions, attended/local-browser actions, local models, and local filesystem sources on Windows, macOS, and Linux.
7. **Data plane** — PostgreSQL for relational state and audit records, a production S3-compatible adapter (filesystem only in development) for originals/derivatives, Redis only if ephemeral caching/rate coordination becomes necessary, and pgvector only where semantic retrieval adds value.

## Key boundaries

### Universal domain, specialized adapters

Core schemas never encode an industry. A product launch, research paper, property listing, event, fundraiser, or service announcement is represented through the same Smart Source, Context Pack, Content Package, Destination, Campaign, and Conversation objects. Industry templates may provide defaults but cannot fork the architecture.

### Desired action versus execution method

Campaign steps declare a capability such as `publish.content` or `send.email`. The execution router chooses an official API, local browser worker, user-assisted browser action, or manual handoff from live capability and policy data. Workflows must not call provider SDKs directly.

### Deterministic shell around optional AI

Detection, stabilization, idempotency, policy precedence, permission checks, budgets, rights, approval gates, and audit logging are deterministic. AI may classify, recommend, extract, write, or rank through structured proposals; it does not silently bypass policy or mutate authoritative context.

### Evidence is first-class

Every extracted or generated claim carries provenance: directly observed, authoritative context, inferred with confidence, or unresolved. Conflicts enter review unless an explicit authority rule resolves them.

## Data and workflow rules

- Every tenant-owned row carries `workspaceId`; authorization is enforced at service and database boundaries.
- External events and workflow commands require idempotency keys.
- Mutable records use optimistic versions; append-only audit events capture actor, action, target, policy decision, correlation ID, and before/after references.
- Credentials are envelope-encrypted and referenced by opaque IDs. Tokens, passwords, signing keys, raw browser sessions, and provider secrets never enter model prompts or client bundles.
- Originals are immutable. Media derivatives are addressable by content hash plus a transformation recipe.
- Connector capabilities are live data with `observedAt`, supported actions, scopes, limits, and execution methods; they are not hard-coded marketing claims.

## Initial implementation slice

Release 0.1 establishes the visual control plane and executable domain policy. `packages/domain` owns universal types and deterministic readiness/override functions. `apps/web` renders a server component using a repository-shaped development fixture and exposes read-only API routes. The fixture is deliberately isolated so PostgreSQL can replace it without rewriting presentation code.

## Release 0.2 implementation slice

`packages/database` now owns the PostgreSQL schema, forward-only migrations, and typed repositories. `packages/connectors` owns normalized storage, capability, OAuth, and encrypted-token contracts. `apps/web/src/server` owns server-only configuration, session cookies, authenticated identity lookup, workspace authorization, input validation, and connector composition.

Authenticated resource pages query repositories in Server Components. Route Handlers are still public network boundaries and independently authenticate the session, resolve membership, and enforce read/write roles. The 0.1 dashboard fixtures remain a non-authoritative visual preview; Smart Source pages and APIs use PostgreSQL only.

## Release 0.2.1 ingestion slice

`packages/connectors` converts Google Drive and Microsoft Graph payloads into `NormalizedStorageEntry` values before provider data crosses the adapter boundary. `packages/ingestion` owns token refresh, recursive discovery, cursor advancement, filtering, idempotent persistence, and bounded sync orchestration. `apps/worker` repeatedly selects enabled remote Smart Sources and runs that service; the web control plane exposes the same operation as an authorized manual sync.

Provider cursors are authoritative. Google initial discovery walks the selected folder before storing a start-page token. Microsoft uses delta for initial hierarchy enumeration and subsequent changes so the local index can converge consistently. Webhook notifications are hints that wake cursor reconciliation, never authoritative changes by themselves.

## Release 0.2.2 webhook and reconciliation slice

`packages/connectors` creates Google Drive change channels and Microsoft Graph drive subscriptions, renews or replaces them before expiry, and revokes obsolete provider state. `packages/ingestion` validates hashed channel/client secrets, queues deduplicated hints, and reconciles each affected storage connection through the existing authoritative cursor service. `apps/web` exposes narrow public notification receivers; `apps/worker` owns subscription maintenance, retry/backoff, dead-letter transitions, reconciliation, and the polling fallback.

Google subscriptions are connection-wide `changes` channels. OneDrive subscriptions target the drive root, and SharePoint subscriptions target each selected drive root because business-drive item subscriptions are root constrained. Notification payloads are deliberately not treated as source-item mutations. This keeps loss, duplication, reordering, provider retry behavior, and renewal overlap from corrupting the local index.

## Release 0.3 evidence and review slice

`context_pack_version` is an immutable grounding snapshot once published. A Smart Source may bind only published Context Packs in the same workspace, and each Content Package records the exact published version IDs used during construction. Source rows describe manual text, HTTPS references, or indexed provider items; fact rows retain structured JSON values and source identity; authority rules are explicit per fact key.

`ContentPackageService` claims durable ingestion events, rechecks readiness, downloads bounded source content through the connector boundary, extracts supported text, hashes the bytes, and persists one reproducible package transaction. It never lets inferred or lower-authority values silently replace conflicting authoritative facts. Conflicts and unresolved evidence keep the package in `needs_review` until a permitted reviewer resolves or corrects them.

Learning Review is append-only. A correction creates a new authoritative evidence row and links the prior unresolved row through `superseded_by_evidence_id`; it does not rewrite the historical claim. Approval is a repository-enforced state transition, not a UI convention.

## Release 0.4 durable campaign slice

`campaign_version` freezes the objective, approved Content Package IDs, optional published Destination, autonomy policy, timezone, context, and one validated directed-acyclic graph. `campaign_step.depends_on[]` contains stable step keys rather than row IDs so workflow history remains readable and version-local. Publication supersedes the previous immutable version; activation always binds an instance to the currently published version and never activates unsaved draft edits.

Activation is one PostgreSQL transaction: validate the published destination and approved packages, create the instance and planned step runs, then enqueue a unique `start` command. The workflow worker claims commands with `FOR UPDATE SKIP LOCKED`, starts or signals Temporal with a stable workflow ID, and completes or exponentially retries the outbox record. This removes the database/Temporal dual-write gap and makes a stale five-minute claim recoverable.

Temporal workflow code contains only deterministic graph selection, timers, signals, and state transitions. Database writes are activities. Each eligible dependency batch runs concurrently; a dependency may advance after `succeeded` or an explicitly recorded optional `partially_succeeded` result. Non-wait actions remain in `manual_resolution` until a user supplies output, so 0.4 never pretends an external provider action occurred. Output is handed to later work under `context["steps.<stepKey>"]`.

## Release 0.5 publishing and measurement slice

Channel capabilities are evaluated per normalized action, not per provider. `ChannelCapabilityManifest` describes authentication, supported actions, execution methods, limits, and features with a version and observation time. The first official adapter is Discord incoming webhooks for `publish_content`; unsupported actions and providers remain explicit manual handoffs.

The workflow activity asks `CampaignExecutionRouter` to resolve the live connection, capability, and step input. Before external I/O it creates one `publication_action` under a stable idempotency key. A successful Discord call uses `wait=true` and records the message ID/URL. A rate-limit response is retryable. A response-lost or server-error outcome is `ambiguous`; automatic resend is suppressed and the step enters manual resolution so retry safety is preferred over duplicate public posts.

Canonical Destinations remain separate from `tracked_link` instances. A tracked link owns its random slug, Campaign/step association, and UTM dictionary; the redirect adds only allowed `utm_*` values and records a cookie-free `destination_visit`. Server integrations submit normalized conversions using high-entropy bearer keys whose hashes alone are stored. `measurement_event` preserves provider/event identity and idempotency while Campaign reporting groups activity and outcome types without inventing unavailable metrics.

## Release 0.6 desktop companion slice

`apps/companion` is a bundled React webview with a Rust/Tauri authority boundary. The webview can invoke only registered application commands; it never receives the long-lived worker bearer token. Rust stores that token in Windows Credential Manager, macOS Keychain, or a Linux Secret Service backend, while non-secret server/device/folder configuration stays in the Tauri application-data directory.

Pairing is initiated by an authenticated workspace editor who creates a random, ten-minute, one-use code. The unauthenticated pair endpoint atomically consumes its SHA-256 hash and returns a high-entropy worker token once. PostgreSQL retains only the token hash and display prefix. Heartbeats advertise a bounded boolean capability dictionary and coarse health data; approved local folder paths remain local and only a configured/not-configured flag is reported.

The preview job vocabulary contains only `open_url` in `assisted` or `confirm_before_submit` mode. A worker claims one queued job with `FOR UPDATE SKIP LOCKED`, receives a five-minute lease token, and receives a canonical JSON envelope signed with HMAC-SHA-256 using the presented worker credential. Rust re-verifies signature, expiry, worker identity, action, mode, HTTPS target, exact hostname allowlist, and expected origin before the user can open the default browser. A local executed-job set prevents a repeated open if completion reporting must be retried.

The web control plane owns pair-code creation, worker status, pause/resume/revoke, test-job creation, and job history. Server pause blocks claims; local emergency pause blocks polling and execution. Revocation invalidates future authentication and cancels queued/claimed jobs. Playwright automation, local-folder monitoring, background service mode, local models, signed updater infrastructure, and Campaign-router selection of this execution method are intentionally outside this preview.

## Release 0.7 media and accessibility slice

`@market-me/media` is the provider-neutral byte and derivative boundary. `ContentPackageService` still owns readiness, connector download, evidence, and package assembly, but delegates verified bytes to `MediaProcessor`. The processor bounds byte count, compares binary signatures with the declared MIME type, computes a SHA-256 identity, writes the original through `ObjectStore.putImmutable`, extracts supported metadata/text, and materializes deterministic recipe outputs. Provider bytes never pass through a browser or Route Handler.

The development `FileSystemObjectStore` uses the same interface intended for an S3-compatible implementation. Keys use separate `originals/<source-hash>/...` and `derivatives/<source-hash>/<processing-version>/<recipe-hash>...` namespaces. Original writes use create-if-absent semantics and verify an existing object's hash before reuse. PostgreSQL stores object keys, checksums, byte counts, lineage, recipe JSON, processing/scan/rights state, and accessibility state; it does not store the original or derivative bytes.

Image processing uses Sharp/libvips in the worker. Release 0.7 creates `thumbnail`, `web_preview`, and `square_preview` WebP variants from auto-oriented input with fixed, versioned recipes. The original is never rewritten. A content hash plus processing version and canonical recipe hash forms the cache identity, so retrying unchanged work reuses exact object keys. Text-like files retain bounded UTF-8 extraction while also gaining immutable byte storage. Release 0.11 extends this boundary to PDF and modern OOXML documents; verified video, audio, legacy/macro-enabled Office, SVG, and generic archive types remain unsupported rather than misinterpreted.

The web control plane reads derivative bytes only through a five-minute HMAC capability URL. The signature binds the asset UUID and expiry; the endpoint bounds future expiry, loads only the database object key, returns an allow-listed inline image MIME type with `nosniff`, and forces all other content to download. The Content Package page displays generated previews and per-asset processing, scan, rights, lineage, and accessibility state.

Informative original images begin at `alt_text_status=needs_review`. An editor must approve meaningful alternative text or explicitly classify the image as decorative. The repository, not only the UI, prevents package approval while an accessibility review is outstanding and audits each change. Current scan state is explicit: the development scanner reports `not_configured`; production external execution must require a real clean scan and rights recheck.

## Release 0.8 Campaign-to-companion routing

Campaign execution remains capability-routed per action. A step whose `desiredCapability` is `open_url` and whose `executionMethods` includes `user_assisted` may be delegated to one healthy, active desktop companion. Activation requires either exactly one eligible worker or an explicit `inputs.companionWorkerId`; this prevents a durable Campaign from silently choosing among multiple user devices.

`CampaignExecutionRouter` validates the credential-free HTTPS target before dispatch, narrows the issued job allowlist to the target's single hostname, binds the job to the Campaign instance and step run, and returns `manual_required`. That state is deliberate: Temporal waits durably while the attended companion asks the user to confirm. A successful, lease-authenticated completion inserts an idempotent `manual_step_completed` command in the same PostgreSQL statement that completes the job. The existing command dispatcher signals Temporal, which resumes the exact step with the companion result. Failure or loss of the worker does not fabricate completion; the step remains visible for manual resolution.

The execution priority remains official API, then an authorized local worker, then user-assisted/manual completion. Release 0.8 implements the attended `open_url` bridge only; it does not add browser credential capture, generic natural-language authority, Playwright, form submission, or a shell command surface.

## Release 0.9 local-folder ingestion

A local Smart Source binds its first `smart_source_location.provider_location_id` to one paired `browser_worker.id`; the display path is only `Approved companion folder`. The absolute canonical device path remains in `LocalConfiguration.approved_folder` and is never included in a heartbeat, manifest, source item, API response, or audit record.

The attended companion enumerates regular non-symlink files beneath that approved root, optionally recurses, and sends a bounded manifest of relative paths, stable path-derived identities, modification time, byte count, MIME declaration, and SHA-256 content identity. The control plane revalidates worker assignment/health/capability, identities, parent relationships, recursion, MIME filters, ignore patterns, uniqueness, and manifest bounds. It responds only with file identities whose matching immutable bytes are absent. The companion uploads those files through an authenticated, size- and hash-bound route; the server writes `originals/<sha256>/source` and attaches that opaque key to the exact source item only if its manifest hash is still current.

The standard ingestion event and Content Package worker remain the processing path. Local items without bytes retry rather than producing metadata-only success. Once bytes exist, the worker reads them through `ObjectStore`, rechecks the hash, and passes them through the same `MediaProcessor`, evidence, readiness, review, and accessibility boundaries as remote storage content.

## Release 0.10 attended foreground monitoring

The companion webview owns the foreground timer because 0.10 deliberately does not install an operating-system background service. A persisted interval is either off or 60 through 3,600 seconds. While the app is paired, unpaused, open, and has an approved folder, the timer invokes the same full manifest reconciliation used by manual sync. Reconnects therefore converge without a separate event journal.

Rust owns cross-invocation overlap prevention through one process-wide atomic guard. Manual and timer calls cannot scan/upload concurrently; the guard clears on success or error. Successful completion persists `last_local_sync_at`, and heartbeat health details report interval and last-sync state without reporting the folder path.

## Release 0.11 bounded document extraction

`MediaProcessor` retains its immutable-original and scan-before-parse order, then dispatches supported documents to a bounded adapter. PDF.js reads in-memory PDF bytes and extracts at most 250 pages and 250,000 characters. Password-protected PDFs fail with an explicit `encrypted` code; PDFs with no text become `requires_ocr`; page/text limits become `truncated`. These states remain visible in asset metadata and keep the Content Package in review.

Modern OOXML files are accepted only when the declared MIME type, ZIP structure, `[Content_Types].xml`, and required main parts agree. Yauzl enumerates entries lazily with filename and actual-size validation. Market Me rejects encrypted entries, more than 1,000 entries, more than 64 MiB expanded content, any selected XML part over 8 MiB, or a per-entry compression ratio over 100 before extracting Word paragraphs, PowerPoint slides, or Excel cell values. Legacy binary and macro-enabled Office files are deliberately unsupported.

Parser output is text and neutral metadata only; active content, links, macros, embedded objects, and formulas are never executed. The Content Package review surface shows parser state, counts, error text, and bounded extracted text. No document byte is rendered inline.

## Release 0.12 immutable communication profiles

Brand and Audience Profiles use the same root-plus-version pattern as Context Packs and Campaigns. A root owns mutable display metadata and one current published version; edits after publication create a separate draft. `brand_profile_version.profile` and `audience_profile_version.profile` contain bounded structured guidance, while information-depth and promotional-strength defaults/ceilings are explicit columns so deterministic policy checks do not depend on arbitrary JSON traversal.

Campaign drafts accept exact published or superseded profile-version UUIDs. One optional Brand Profile version is stored directly on `campaign_version`; ordered Audience Profile versions use `campaign_version_audience_profile` so every binding has a real foreign key rather than an unverifiable UUID array. Publishing or updating a profile never changes an existing Campaign version. Workspace ownership and publish state are revalidated transactionally before the Campaign version or bindings are written.

`resolveCommunicationPolicy` implements `workspace < brand < audience < destination < campaign < action`. The most-specific explicit value wins. Multiple audiences at the same level reduce to the least-intensive value, and every active ceiling reduces to the most restrictive ceiling. Campaign authoring remains explicit in 0.12; selected profile defaults guide future generation, while profile ceilings are enforced immediately and return structured 422 validation issues.

## Release 0.13 governed Draft generation

`@market-me/generation` is a pure provider-neutral boundary between approved factual context and presentation output. `generateGroundedDraft` is the first provider implementation and identifies itself with four stable constants: `GENERATOR_PROVIDER=market-me`, `GENERATOR_MODEL=grounded-template`, `GENERATOR_VERSION=1.0.0`, and `PROMPT_VERSION=grounded-draft-v1`. The database repository, API, and UI depend on the contract rather than embedding copy logic.

`DraftRepository.generate` is the deterministic gate. It locks generation to a current published Campaign version, requires the selected approved Content Package to be bound to that version, retrieves active resolved evidence, loads exact Brand/Audience Profile pins, and writes the generation record, all variants, claims, evidence links, and audit event in one PostgreSQL transaction. No browser or client-supplied claim text participates in generation.

The immutable JSON evidence snapshot is the reconstruction source. Live claim-to-evidence foreign keys support navigation while both records exist; their junction rows may cascade during evidence deletion so whole-workspace deletion works, but the snapshot remains unchanged. Approval submission captures the exact current Draft version; decisions update that version/root and never rewrite generation inputs.

### ADR-024 - Facts are shared; presentation is variant-specific

**Decision:** One generation record owns the exact Campaign/package/profile/control/evidence inputs, while each Audience Profile produces a separate Draft whose factual claim set is identical and whose presentation choices are explicit.  
**Reason:** Audience adaptation must not silently introduce unsupported audience-specific claims, and later model/provider changes must remain reproducible.  
**Consequence:** Generator providers return typed claims and evidence IDs; factual claims without evidence are invalid by contract, calls to action are labeled presentation-only, and a model gateway can replace the initial template only after passing the same validation/evaluation boundary.

## Release 0.14 bounded Draft formats and revision successors

Generation now accepts one `DraftFormat` and applies a server-owned character policy before any Draft is stored. The generator selects complete evidence claims that fit both the information-depth limit and the format ceiling; it never truncates a factual sentence. The longest selected Audience name participates in one shared budget calculation so every audience variant retains an identical factual claim set.

`DraftRepository.revise` is the only revision write gate. It accepts a Draft whose current immutable version is `working` or `changes_requested`, validates presentation fields, clones the exact factual claims and evidence bindings, marks the predecessor `superseded`, and creates a new `working` version with `source_version_id` and a required `change_note`. Approval always targets the successor version explicitly.

### ADR-025 - Presentation revisions cannot mutate factual claims

**Decision:** A requested-change successor may alter only a punctuation-free lead-in, call to action, bounded hashtags, alternative text, and change note; its facts and evidence bindings are cloned exactly from the predecessor.  
**Reason:** Normal copy editing must not turn reviewed evidence into an unsupported assertion or silently change what an approval covers.  
**Consequence:** A factual change requires a new governed generation from approved evidence. The repository, rather than the browser, reconstructs the successor body and enforces the selected format ceiling.

## Release 0.15 capability-bound channel previews

`renderChannelPreview` is a pure connector-bound renderer. It composes the exact approved Draft body, call to action, hashtags, and optional published canonical Destination into provider-ready text, then evaluates the captured live `ChannelCapabilityManifest` without truncating output. The first supported provider is the existing Discord incoming-webhook manifest; no credential or provider call participates in previewing.

`draft_channel_preview` is an immutable delivery-readiness snapshot bound to workspace, exact approved Draft version, active Channel Connection, optional published Destination, provider/capability version and observation time, rendered content, character count/limit, validation issues, and actor. Rerendering the same version/connection/destination replaces that exact preview identity while retaining audit events. A later capability observation or inactive connection derives `isStale=true` at read time.

### ADR-026 - Delivery rendering is capability-snapshotted and side-effect free

**Decision:** Channel previewing stores an exact provider capability snapshot and validation result but never decrypts credentials or invokes a provider.  
**Reason:** Approval of factual copy does not prove that a live account can accept the composed destination, CTA, hashtags, or current provider length policy. Readiness must be inspectable before an external side effect.  
**Consequence:** Only approved exact Draft versions can render; stale snapshots must be refreshed; blocked output remains intact for correction; later execution may consume only a fresh ready snapshot and must still revalidate immediately before delivery.

## Release 0.16 exact-preview Campaign execution

A `publish_content` Campaign step may set `inputs.draftChannelPreviewId`. Activation joins the preview back to its current approved Draft version, originating Campaign root, active Channel Connection observation, and the successor Campaign version's exact Destination. It rejects stale/blocked previews, cross-Campaign reuse, destination or connection mismatch, and any `appendDestination`/`useTrackedLink` mutation flag before an instance or start command is created.

The workflow worker resolves the Channel Connection from the preview when it is not repeated in step JSON, re-evaluates approved/current/fresh/ready state, and uses `rendered_content` byte-for-byte. The publication request snapshot records both preview and Draft version IDs. Existing ambiguity-safe publication/idempotency behavior remains unchanged.

### ADR-027 - Approved previews are exact execution inputs

**Decision:** When `draftChannelPreviewId` is present, Campaign execution may not recompute text, append a Destination, substitute a tracked link, or fall back to `inputs.content`.  
**Reason:** Any post-approval composition would invalidate the reviewed character count, Destination identity, capability result, and human decision.  
**Consequence:** Activation and runtime both fail closed on drift; tracked-link or destination changes require a newly rendered preview; provider delivery remains idempotent and ambiguity-safe.

## Release 0.17 guided exact-preview authoring

`DraftRepository.listCampaignPreviewOptions(workspaceId, campaignId)` is the server-owned Campaign-scoped read boundary. It returns preview identity and content together with source Campaign version, Draft headline/audience, current exact approval, Channel Connection freshness, provider capability, and Destination metadata. Cross-Campaign previews never enter the client option set.

`CampaignPreviewPicker` derives immediate form-time eligibility from the server read model plus the unsaved `destinationId`. `assessCampaignPreview` reports current-approval, ready/blocked, stale/inactive connection, and exact-Destination reasons. `writeDraftChannelPreviewId` requires an object-shaped JSON input, retains unrelated fields, writes the immutable preview ID, and removes `appendDestination`, `useTrackedLink`, and both connection-override spellings.

The picker is advisory and ergonomic, not an authorization boundary. Release 0.16 activation and worker checks remain authoritative after save, publish, scheduling delay, and provider drift. No schema migration or new external call is introduced.

### ADR-028 - Guided preflight duplicates but never replaces execution validation

**Decision:** Show operators all same-Campaign preview candidates and deterministic eligibility reasons in the authoring form, while retaining the independent activation and runtime gates.  
**Reason:** Destination choice is unsaved client state and capability freshness can change after rendering; the UI can prevent common mistakes but cannot safely authorize a side effect.  
**Consequence:** The picker may disable an option for usability, but repository and worker invariants decide whether execution is allowed. A stale browser cannot bypass server enforcement.

## Release 0.18 approved first-party tracked previews

Migration 0022 adds `draft_channel_preview.link_mode`, a tracked-preview uniqueness dimension, and `tracked_link.draft_channel_preview_id` with cascade lifecycle ownership. `createChannelPreview` reserves or reuses one random first-party slug, renders `${APP_BASE_URL origin}/r/{slug}` into the exact content, and atomically stores fixed UTM attribution and the preview/link relationship.

Activation and runtime eligibility require tracked links to remain active and match preview workspace/Destination. The worker uses `draftPreviewTrackedLinkId` from the approved preview and never calls execution-time link creation. `getTrackedLink` reads `utm_parameters::text` and parses it explicitly because the database camel transform otherwise changes security-whitelisted `utm_*` dictionary keys.

### ADR-029 - Tracking identity is reserved before content approval

**Decision:** A tracked URL is created and lifecycle-bound to the preview before rendering, then reused on refresh.  
**Reason:** Generating or substituting a URL after approval changes exact content and invalidates character/provider review.  
**Consequence:** Deleting the preview cascades its reserved link; disabling the link blocks activation/runtime; attribution and redirect identity are auditable before delivery.

## Architectural decision records

### ADR-001 — TypeScript monorepo

**Decision:** npm workspaces with separate apps and packages.  
**Reason:** shared schemas across web, workers, connectors, and desktop bindings; simple first-day tooling; no premature distributed boundaries.  
**Consequence:** public package APIs must stay narrow and browser/server imports must be explicit.

### ADR-002 — Next.js App Router control plane

**Decision:** Next.js 16 App Router with Server Components by default.  
**Reason:** fast full-stack iteration, small client bundles, route-level APIs, and a mature React UI surface.  
**Consequence:** connector secrets and database access stay in server-only modules; interaction islands become focused Client Components.

### ADR-003 — Temporal for durable orchestration

**Decision:** use Temporal for long-running, approval-aware campaign workflows rather than treating a posting queue as the workflow engine.  
**Reason:** durable waits, retries, signals, cancellation, timers, and observable histories match the product requirements.  
**Consequence:** workflow code must remain deterministic; network and model calls belong in activities.

### ADR-004 — PostgreSQL as system of record

**Decision:** PostgreSQL with explicit migrations and tenant-scoped queries.  
**Reason:** the domain is relational, audit-heavy, and transaction-sensitive.  
**Consequence:** object bytes stay outside the database; vector search is an extension, not the authoritative store.

### ADR-005 — Tauri local companion

**Decision:** Tauri v2 for the local companion.  
**Reason:** cross-platform delivery with a small native shell and strong separation from the web control plane.  
**Consequence:** browser/session automation stays opt-in, encrypted locally, capability-limited, and observable.

### ADR-006 - Opaque database sessions

**Decision:** Use 256-bit random bearer tokens in HttpOnly cookies and persist only SHA-256 token hashes with expiry and last-seen time.  
**Reason:** Server-side revocation and device visibility are required; user and role data should not be trusted from a client token.  
**Consequence:** Protected requests perform a database lookup. Session caching can be added later without changing the cookie contract.

### ADR-007 - Provider-neutral OAuth boundary

**Decision:** Implement state- and PKCE-protected authorization-code flows behind `StorageConnector`.  
**Reason:** Google and Microsoft differ in endpoints/scopes while sharing one storage capability model.  
**Consequence:** Tokens are AES-256-GCM envelopes, OAuth state is single-use with a ten-minute expiry, and provider credentials stay server-only.

### ADR-008 - Webhooks as reconciliation hints

**Decision:** Persist verified provider notifications in a deduplicating queue and resolve every hint through Google change pages or Microsoft delta links.  
**Reason:** Basic webhook payloads are incomplete and delivery can be duplicated, delayed, reordered, throttled, or lost during subscription renewal.  
**Consequence:** Notification endpoints perform bounded validation and enqueue work quickly; workers own retry, dead-letter handling, subscription lifecycle, and periodic polling recovery.

### ADR-009 - Immutable Context Pack snapshots

**Decision:** Publishing a Context Pack freezes one version; subsequent edits clone a new draft and Content Packages retain the exact version IDs used.  
**Reason:** Campaign output must be reproducible even after approved guidance changes.  
**Consequence:** Published rows are never edited in place, and Smart Source bindings are workspace-scoped and publish-state validated.

### ADR-010 - Explicit evidence resolution

**Decision:** Conflicting authoritative values and missing facts remain review blockers until an approver selects evidence or records a correction.  
**Reason:** Source rank is useful context but is not permission to invent or silently choose business truth.  
**Consequence:** Review actions are audited, corrected evidence supersedes rather than deletes history, and approval fails while active blockers remain.

### ADR-011 - Transactional workflow command outbox

**Decision:** Persist campaign starts and all operator, approval, and manual-completion signals in `campaign_workflow_command` before dispatching them to Temporal.  
**Reason:** PostgreSQL and Temporal cannot share one transaction; direct API-to-workflow calls can lose state during process or network failure.  
**Consequence:** Commands require stable idempotency keys, bounded claim leases, six-attempt exponential retry, and visible dead-letter state.

### ADR-012 - Immutable campaign definitions, mutable instances

**Decision:** A Campaign version is immutable after publication; every activation creates a new instance and step-run set.  
**Reason:** Reproducible execution and audit require the exact graph, controls, inputs, packages, and destination used at launch.  
**Consequence:** Editing a published Campaign creates a draft successor, while activation continues to use the current published version until the draft is published.

### ADR-013 - Capability routing per action

**Decision:** Select execution from a versioned live capability manifest for each normalized action.  
**Reason:** One provider may support publishing but not metrics, editing, inbound events, or scheduling, and those capabilities change independently.  
**Consequence:** Campaigns declare desired capabilities; adapters translate only supported actions and all other work remains labeled manual/unavailable.

### ADR-014 - Ambiguity-safe external publishing

**Decision:** Persist `dispatching` before provider I/O and never automatically resend a dispatch whose outcome cannot be proven.  
**Reason:** Discord incoming webhooks do not accept a client idempotency key, so retry after a lost response may duplicate a public announcement.  
**Consequence:** Confirmed rate limits may retry, but unknown delivery becomes `ambiguous` and requires operator verification.

### ADR-015 - Canonical Destination separate from tracked link

**Decision:** Store tracking instances separately and redirect to the immutable canonical Destination URL plus an allow-listed UTM dictionary.  
**Reason:** Attribution and rotation must not corrupt Destination identity or duplicate detection.  
**Consequence:** Tracking can be disabled/expired independently, and redirects collect no cookie or personal identifier in this release.

### ADR-016 - One-time pairing with OS credential storage

**Decision:** Exchange an expiring one-use pairing code for a worker bearer token, store only its hash in PostgreSQL, and keep plaintext only in the operating-system credential store.  
**Reason:** A user can authorize a desktop without copying account passwords or exposing a reusable token to the Tauri webview or local configuration file.  
**Consequence:** Pairing needs production rate limits and device administration; a lost credential requires revocation and re-pairing rather than recovery.

### ADR-017 - Short-lived worker-signed job leases

**Decision:** Bind each claimed local job to one worker, an exact domain/origin, a narrow action/mode, a five-minute lease token, and an HMAC signature verified in Rust.  
**Reason:** Local execution must reject tampering, replay, broad natural-language authority, stale jobs, and work intended for another device.  
**Consequence:** Job payloads use canonical JSON and schema version 1; future sidecar actions require new explicit validators and compatibility handling rather than generic shell access.

### ADR-018 - Content-addressed immutable media objects

**Decision:** Keep source and derivative bytes outside PostgreSQL behind `ObjectStore`, name them by source hash, processing version, and recipe hash, and write them with immutable create-if-absent semantics.  
**Reason:** Originals must remain reproducible, retry-safe, deduplicated, and independently lifecycle-managed without expanding transactional rows or allowing a derivative to overwrite source evidence.  
**Consequence:** PostgreSQL stores portable metadata and lineage. Development uses the filesystem adapter; production requires an encrypted, versioned S3-compatible adapter, lifecycle policy, backup, and orphan-object garbage collection.

### ADR-019 - Accessibility is an approval invariant

**Decision:** Store alt text and decorative classification on the original asset and reject Content Package approval while any asset remains `needs_review`.  
**Reason:** Accessibility is part of the publishable artifact, not an optional post-publish annotation; generated filename/dimension suggestions are insufficient without human review.  
**Consequence:** The review API is workspace-authorized and audited, derivative previews inherit the reviewed source meaning at publication time, and future destination adapters must validate platform-specific accessibility capabilities before execution.

### ADR-020 - Campaign-bound companion completion uses the workflow outbox

**Decision:** Bind a companion job to one Campaign instance and step run, and create its successful `manual_step_completed` command transactionally with job completion.

**Reason:** Updating PostgreSQL and signaling Temporal directly cannot be atomic; a crash between those operations could strand a completed attended action or deliver it twice.

**Consequence:** The job/step pair is unique, completion replay is rejected, the command uses `companion-job:<jobId>:completed`, and the normal lease/retry/dead-letter dispatcher is the only bridge into Temporal.

### ADR-021 - Local ingestion is manifest-first and content-addressed

**Decision:** Send a bounded relative manifest before bytes, request only missing/changed content, and converge local files into the existing immutable object-store and ingestion pipeline.

**Reason:** The control plane needs change identity and filtering without receiving an absolute path or repeatedly transferring unchanged content; local sources should not create a second Content Package architecture.

**Consequence:** Relative paths are metadata, path identities and content identities are separate SHA-256 values, uploads are exact-item/hash bound, and continuous watching can later reuse the same idempotent contract.

### ADR-022 - Documents parse behind a bounded adapter

**Decision:** Parse only PDF and modern OOXML after immutable storage and malware-scan disposition, with fixed resource ceilings and structured result states.

**Reason:** Content Packages need document evidence, but treating every office/archive byte as text or delegating parsing to a browser would weaken MIME, resource, provenance, and review boundaries.

**Consequence:** `document-v1` output is reproducible and reviewable; OCR, legacy binary Office, macros, embedded-object extraction, and unbounded archive traversal require separate future adapters and security review.

### ADR-023 - Campaigns pin immutable communication context

**Decision:** Store Brand and Audience guidance as immutable published versions and bind exact version foreign keys to each Campaign version.

**Reason:** Mutable profile names or guidance must not silently change the voice, audience assumptions, or legal/promotional guardrails of a reviewed Campaign.

**Consequence:** A profile update creates a new version and existing Campaigns retain history. More-specific settings may change presentation, but deterministic ceiling validation blocks unauthorized intensity. The foundation `brand` table remains the organizational/destination identity; `brand_profile` is separate versioned communication guidance and may later reference that identity explicitly.

### ADR-024 - Approved channel media is an immutable preview manifest

**Decision:** Bind an ordered list of exact image asset snapshots to the approved channel preview, then resolve and hash-check those immutable objects in the workflow worker immediately before provider delivery.

**Reason:** Reading mutable Content Package rows or selecting “current” derivatives at execution would allow bytes, accessibility meaning, filenames, or order to change after approval. Storing binary data in PostgreSQL would duplicate the object-store boundary and enlarge the side-effect ledger.

**Consequence:** `draft_channel_preview_asset` owns preview-scoped order and delivery metadata while `content_asset` remains the lineage authority. Web, ingestion-worker, and workflow-worker processes must share `MEDIA_STORAGE_ROOT`. Missing or hash-mismatched bytes fail before credential decryption, publication-action creation, or provider I/O. Provider adapters still revalidate their manifest limits.

## Release 0.19 exact-media delivery flow

`DraftChannelPreviews` sends ordered `assetIds[]` to the authorized preview endpoint. `DraftRepository.createChannelPreview` proves same-generation Content Package ownership, derives accessibility from the original when a derivative is selected, validates the live capability manifest, upserts text/link state, and transactionally replaces the preview asset rows. Campaign activation requires the same current approval/capability/Destination lineage and attachment feature. `PublishingRepository` returns snapshot metadata only. `CampaignExecutionRouter` loads and verifies bytes through `ObjectStore`, passes them to `DiscordWebhookConnector`, and records metadata-only evidence in `publication_action.request_snapshot`.

### ADR-025 - Verify the live provider target immediately before dispatch

**Decision:** Before beginning or retrying a Discord publication action, read the stable idempotency row, validate exact media, decrypt the webhook credential, call Discord's webhook GET endpoint, and compare the observed webhook, guild, and channel identifiers with any identifiers saved on the Channel Connection. Begin or retry the publication action only after a successful match.

**Reason:** An approved capability snapshot proves what was reviewed, but a deleted webhook, regenerated URL, or provider-side target move can make the credential point somewhere unavailable or different by execution time. The final provider boundary must therefore validate live identity without changing the approved content.

**Consequence:** A first dispatch adds one provider GET. Unavailable or drifted targets mark the connection unhealthy, produce manual-required workflow output, and create no publication action or POST. Successful preflight refreshes non-secret identity/health and records observed identity in the request snapshot. Prior succeeded or ambiguous ledger states are resolved before any network call, preserving exactly-once intent and ambiguity-safe resend suppression.

## Release 0.20 live-preflight execution flow

1. Resolve and revalidate the exact approved Campaign/Draft/preview lineage.
2. Read the stable publication action by idempotency key. Return an existing success or require manual resolution for dispatching/ambiguous state without network access.
3. Read and hash-check each approved immutable attachment before credential access.
4. Decrypt the Discord webhook and perform a live GET preflight.
5. Compare stored and observed `webhookId`, `guildId`, and `channelId`; fail closed on any stored-key mismatch.
6. Record successful connection health/identity, then begin or retry the stable publication action.
7. POST the exact approved text and verified bytes, recording success, confirmed failure, or ambiguous outcome in the existing ledger.

### ADR-026 - Success criteria belong to the immutable Campaign version

**Decision:** Store a bounded array of normalized event-count thresholds on `campaign_version`, then evaluate each Campaign instance against events scoped to that instance and the exact activated version.

**Reason:** A goal edited after launch must not rewrite the meaning of historical performance. Normalized measurement events already preserve idempotent, workspace-authorized facts; deterministic evaluation should consume those facts without mutating workflow or Campaign state.

**Consequence:** Success evaluation is reproducible and can distinguish no configured criteria from all criteria met. Release 0.21 does not automatically complete, stop, or signal workflows when a threshold is reached. Value/revenue criteria require a later currency-safe aggregation contract.

## Release 0.21 success-evaluation flow

1. Campaign author supplies zero to twenty stable criterion IDs, normalized event types, and positive integer target counts.
2. Server validation rejects duplicates, unknown event types, invalid IDs, and out-of-range counts before persistence.
3. Publishing freezes `success_criteria` with the Campaign version; activation pins that version to the instance.
4. Measurement ingestion authenticates the workspace key, validates every referenced entity, and idempotently records normalized events.
5. The run summary groups exact-instance events, loads the pinned criteria, treats missing event types as zero, and returns per-goal progress plus `allCriteriaMet`.

### ADR-027 - Revoke measurement credentials without deleting evidence

**Decision:** Rotate measurement ingest credentials by creating a replacement and atomically transitioning the old key from `active` to `revoked`; retain its hash, prefix, use timestamps, revocation time, and audit history.

**Reason:** Deleting a key removes incident and attribution evidence, while leaving a compromised key active is unsafe. Only the hash is needed to reject future authentication; plaintext cannot and should not be recovered for rotation.

**Consequence:** Revocation is immediate and irreversible in the application. Integrations must receive a newly created one-time secret before an in-use key is revoked. Repeat revocation is a no-op/not-found response and never creates duplicate audit history.

## Release 0.22 key-lifecycle flow

1. A workspace writer creates a named replacement; the server returns one high-entropy secret and stores only its hash/prefix.
2. Creation and revocation each commit their key mutation and non-secret audit event in one transaction.
3. The operator deploys the replacement to the external integration, then invokes the key-specific DELETE route.
4. The repository scopes by workspace and `status='active'`, stamps `revoked_at`, and retains historical metadata.
5. Future bearer authentication filters to active rows, so the revoked secret fails immediately; UI history remains visible without any secret readback.

### ADR-030 - Monetary success goals are exact-currency, never implicit FX

**Decision:** Model Campaign success criteria as a backward-compatible count/value union and aggregate measurement values by exact normalized event type and exact three-letter currency. Values without a currency remain in a separate untyped total and cannot satisfy a currency goal.

**Reason:** Adding USD, EUR, or unit-like values into one number creates false performance and makes historical evaluation irreproducible. Market Me has no approved exchange-rate source, rate timestamp, base currency, or accounting policy from which to infer conversion.

**Consequence:** A USD criterion reads only `currencyTotals[eventType].USD`; EUR and untyped values are visible but excluded. Cross-currency reporting, FX conversion, ratios, attribution, and return calculations require explicit future domain contracts rather than a UI-only calculation.

## Release 0.23 currency-safe evaluation flow

1. Campaign author selects event count or exact-currency value, provides a stable criterion ID, and supplies the bounded target fields for that metric.
2. Server parsing normalizes historical missing `metric` values to `count` and rejects unknown metrics, unsupported events, invalid targets, or non-uppercase three-letter currencies.
3. Publishing freezes the discriminated criteria with the Campaign version; activation pins that version to one run.
4. The measurement summary groups event counts, untyped values, and exact-currency values separately within the authorized Campaign instance.
5. Pure evaluation reads only the matching count or currency bucket, and the run UI displays the corresponding progress shape without combining money.

### ADR-031 - Measurement authorization is key-specific and time-bounded

**Decision:** Bind a non-empty normalized event-type allowlist and optional absolute expiry to each hash-only measurement key. Authenticate only active, unexpired hashes, then authorize the parsed event type against that principal before persistence.

**Reason:** A workspace-wide bearer that can submit every current and future metric indefinitely has unnecessary blast radius. Key identity must describe what the integration may ingest and when that authority ends without exposing or recovering plaintext.

**Consequence:** Existing keys migrate to all events/no expiry for compatibility; new integrations can receive least-privilege event access and deterministic expiry. Expired keys remain visible as evidence but cannot authenticate. Rollback to a pre-scope endpoint is security-sensitive because it would ignore both restrictions.

## Release 0.24 scoped-ingestion flow

1. A workspace writer selects one to 24 normalized event types, optionally sets a future expiry, and receives the secret once.
2. Creation stores only hash/prefix plus non-secret scope/expiry and commits the matching audit event in the same transaction.
3. Authentication updates last use and returns a scoped principal only when status is active and database time precedes expiry.
4. The endpoint validates the event payload, checks its normalized type against the principal allowlist, then performs the existing workspace-reference and idempotent insert checks.
5. Out-of-scope requests return forbidden, expired keys return unauthorized, and neither path creates an event.

### ADR-032 - Threshold crossing uses a serialized transactional outbox and an idempotent workflow signal

**Decision:** When a newly accepted measurement makes every criterion on the exact pinned Campaign version true, serialize evaluation by locking the Campaign instance and insert one stable `success_criteria_met` workflow command in the measurement transaction. Deliver that command as a Temporal signal whose handler preserves the first payload.

**Reason:** Event-key idempotency alone does not prevent two different concurrent events from both observing the same threshold transition. A database row lock gives the aggregate one order, the unique outbox key bridges the database/Temporal boundary durably, and an idempotent workflow handler makes at-least-once delivery safe.

**Consequence:** One run can have at most one durable success-transition command. The payload records evaluated immutable criteria, measurement time, and triggering event key; the workflow stores it at `context["measurement.success"]`. Release 0.25 deliberately performs no automatic stop, completion, or provider action. Dispatchers fail unknown command types so mixed-version deployments cannot silently consume unsupported work.

## Release 0.25 success-threshold flow

1. Ingestion validates references and locks the exact workspace-owned Campaign instance before inserting a new idempotent event.
2. Inside that transaction, it loads the instance's pinned Campaign version, aggregates exact-instance counts and currency totals, and evaluates the immutable criteria.
3. If every criterion is met, it inserts `campaign:{instanceId}:success-criteria-met` with `ON CONFLICT DO NOTHING`; otherwise it commits only the event.
4. The workflow dispatcher claims the outbox row, signals the existing Temporal workflow, and completes or retries/dead-letters the command through the established policy.
5. The workflow retains only the first `CampaignSuccessSignal`, while the run summary reports database delivery state independently from workflow control state.

### ADR-033 - Success behavior is a closed immutable policy, not an inferred side effect

**Decision:** Version a closed `notify_only | pause` success action with the Campaign definition. Copy the exact pinned action into the transactional success command, normalize older missing values to notification-only, and reuse the workflow's existing persisted pause transition when explicitly selected.

**Reason:** Threshold attainment and workflow control are separate decisions. Inferring pause, completion, cancellation, or publication from a goal creates surprising authority and makes historical runs depend on current settings. A small immutable enum makes the operator's intent reviewable and backward-compatible.

**Consequence:** Release 0.26 can durably pause future progress after first success while preserving manual resume/cancel controls. It does not cancel an activity already in flight and never completes or publishes automatically. New action types require a schema, migration, UI, workflow, security, and rollback review rather than arbitrary JSON interpretation.

## Release 0.26 success-action flow

1. Author selects notification-only or pause before publishing; migration/default makes historical Campaigns notification-only.
2. Publication freezes `success_action` beside success criteria, and activation pins that version to the instance.
3. First all-met evaluation copies the pinned action into the stable outbox payload.
4. Temporal preserves the first signal. Missing action normalizes to notification-only; explicit pause sets workflow/instance state paused through the existing activity boundary.
5. Manual resume reopens future workflow progress. In-flight work is not canceled, and success never implies completed or canceled state.

### ADR-034 - Measurement Campaign scope is an explicit root allowlist

**Decision:** Give each measurement key a closed `all | restricted` Campaign-scope mode and, for restricted keys, persist workspace-validated Campaign roots in a relational junction. Resolve every Campaign-bearing event reference to its root and authorize only when all supplied roots collapse to exactly one allowed Campaign.

**Reason:** A workspace bearer can otherwise submit a permitted event type against any Campaign in that workspace. Direct Campaign IDs are not the only attribution path: instances, step runs, tracked links, and publication actions can each imply a root. Checking only one field would permit confused-deputy and conflicting-reference requests.

**Consequence:** Existing keys retain all-Campaign compatibility. Restricted keys reject no-root, unresolved, conflicting, and unlisted-root events before persistence. Cascading Campaign deletion removes its allowlist row but never changes the mode, so an empty restricted set is deny-all rather than an accidental authorization expansion.

## Release 0.27 Campaign-scoped ingestion flow

1. A workspace writer chooses all Campaigns or up to 100 unique Campaign roots; the repository validates every selected ID in the key-creation transaction.
2. The server stores hash/prefix lifecycle data, the explicit scope mode, relational scope rows, and non-secret audit evidence atomically.
3. Authentication returns only key/workspace identity, event allowlist, and Campaign-scope data; it never returns the hash, prefix, name, or secret.
4. Ingestion checks event scope first, then resolves roots for all Campaign-bearing references and requires one allowed root for a restricted principal.
5. Authorized requests continue through normal workspace-reference validation and idempotent insertion. Campaign-scope denial returns 403 and creates no measurement event.

### ADR-035 - Contact permission is orthogonal to relationship stage

**Decision:** Model relationship stage and contact permission as independent closed values. Keep each external identity in a provider-specific child row, permit only one workspace owner for a provider/subject pair, and require a reasoned suppression transition instead of encoding do-not-contact as an ordinary funnel stage.

**Reason:** A customer, lead, partner, or active conversation can opt out without ceasing to be that kind of relationship. Treating suppression as a stage invites later stage updates to overwrite a legal or user-requested contact restriction. Speculative identity merging also risks applying context or consent to the wrong person.

**Consequence:** `contactPermission='suppressed'` remains authoritative regardless of stage and carries its own reason, timestamp, and actor. Restoration is explicit and audited. Provider identities remain separate unless exact identifiers or reviewed evidence support the same relationship. Future inbox/outreach adapters must load this record transactionally before an external action.

## Release 0.28 relationship-registry flow

1. A workspace writer records known business context and zero to 20 provider identities; schema and repository boundaries normalize closed values and bounded arrays.
2. The repository validates assigned-owner membership and rejects duplicate provider/subject identities within the request or elsewhere in the workspace.
3. Contact and identity replacement commit atomically. Composite `(relationship_contact_id, workspace_id)` references prevent cross-tenant child attachment.
4. Suppression requires a reason and stamps the current actor/time; restoration clears all suppression fields while preserving stage and provider evidence.
5. The corresponding non-sensitive audit transition commits with the mutation, and Conversations pages render registry/safety state without exposing notes or provider subjects in audit metadata.

### ADR-036 - Internal notes are structurally non-deliverable

**Decision:** Persist messages with a closed `inbound | outbound_observed | internal_note | system` kind, require an authenticated actor for `internal_note`, expose note creation through its own endpoint, and provide no outbound-send endpoint in the conversation service. Treat exact provider message IDs as thread-local idempotency keys.

**Reason:** Operator context must coexist with provider history without creating a path that can accidentally deliver internal text. Provider retries also must not duplicate a message or inflate history calculations. A label or UI convention alone is too weak for either boundary.

**Consequence:** Internal notes remain usable on suppressed relationships but cannot be selected by a connector contract. Audit evidence includes only the new message ID, never the body. A later reply adapter must define a separate outbound command, reload relationship permission immediately before I/O, and preserve provider idempotency independently from observed history.

## Release 0.29 conversation-inbox flow

1. A workspace writer creates a provider-neutral thread attached to one same-workspace relationship; optional exact provider/thread identity is unique within that workspace.
2. Ingestion records provider history with a closed message kind and optional provider-message idempotency key. Replays return no new row.
3. Inbox reads attach total count and latest message; detail reads attach the complete chronological message array.
4. Workspace writers update lifecycle state/owner under assignment invariants or add a dedicated authenticated internal note.
5. Relationship contact permission is rendered with every thread. History and notes remain available when suppressed, but no outbound action exists in this release.

### ADR-037 - Handoff briefs are durable collaboration records, not messages

**Decision:** Store a structured handoff in its own tenant-bound table, permit one active brief per thread, retain resolved/cancelled history, and keep response/follow-up timestamps on the thread. Do not encode the brief as a conversation message or outbound draft.

**Reason:** A handoff must explain human context and deadlines without appearing in provider history or becoming eligible for connector delivery. One active escalation gives operators a single current source of truth while retained closed briefs preserve decisions and accountability.

**Consequence:** Brief text is visible only through authenticated workspace reads and is excluded from audit dictionaries; audits store the handoff ID and transition only. Deadline timestamps are operator-authored signals, not automated SLA enforcement. Future notifications may read these records but cannot infer outbound authority from them.

## Release 0.30 handoff flow

1. A workspace writer sets optional response/follow-up timestamps on a provider-neutral thread.
2. The writer creates a bounded brief covering contact, importance, request/offer, prior response, relevant context, suggested next response, and optional deadline.
3. The repository locks the thread and rejects a second active brief; the brief and minimized audit transition commit together.
4. Inbox/detail reads hydrate active state and full closed history without merging the brief into message history.
5. Resolve or cancel closes the active brief with actor/time evidence. A later handoff may then be opened, and no transition performs provider I/O.

### ADR-038 - Inbox filtering is a bounded tenant query

**Decision:** Express triage as a typed optional query object, repeat workspace scope in every root and correlated subquery, cap results at 200, and keep filters in URL GET state. Search only the current domain fields that have explicit meaning.

**Reason:** Client-side filtering would require loading unbounded personal-message history and could diverge from authorization. Arbitrary query languages or JSON paths would create unpredictable cost and disclosure risk. URL state supports reviewable, shareable operator views without persisting another mutable object.

**Consequence:** Search is deterministic case-insensitive matching over subject, contact/organization, and message body, with exact structured filters and no relevance score. New semantic dimensions such as Campaign, topic, Destination, or sentiment must first gain reviewed relational/classification contracts.

## Release 0.31 inbox-query flow

1. The API/UI schema trims and bounds query input, closed values, dates, and limit before repository access.
2. The authenticated user/workspace mapping converts owner=me or unassigned into an exact tenant-safe predicate.
3. The repository composes parameterized root and correlated subqueries, always repeating workspace/thread identity.
4. Matching rows are activity ordered, capped, then hydrated with latest message/count and open handoff state.
5. The server-rendered form preserves validated URL state and exposes matching counts plus a clear action.

### ADR-039 - Unread state is a viewer cursor over storage time

**Decision:** Store one `last_read_at` cursor per workspace member and conversation thread. Count messages whose database `created_at` is newer than that cursor, excluding rows created by the viewer. Advance the cursor only through an explicit authenticated command using database time and a monotonic UPSERT.

**Reason:** Provider occurrence times may be delayed, replayed, or imported out of order, so they cannot represent when Market Me first showed work to an operator. A thread-global boolean would also let one teammate erase another teammate's attention state. Explicit mutation prevents server-rendered GETs, link previews, or crawlers from silently consuming unread work.

**Consequence:** Late-ingested history is unread even when its provider timestamp is old; a user's own internal notes are not unread to that user but are unread to teammates. Read receipts are tenant/membership bound and intentionally omitted from business audit events. Bulk unread operations and notification policies require separate reviewed contracts.

## Release 0.32 conversation read-state flow

1. An authenticated list/detail read supplies the viewer user ID after workspace authorization.
2. The repository joins an optional viewer cursor and counts only later messages not authored by that viewer.
3. URL `read=unread | read` becomes a typed boolean EXISTS/NOT EXISTS predicate within the same workspace query.
4. The user explicitly invokes the read endpoint; the repository validates thread and membership through one `INSERT ... SELECT` and advances the cursor with database time.
5. A later message has a later storage timestamp and reappears as unread without changing provider chronology or any outbound authority.

### ADR-040 - Conversation ownership is an eligible-member reference

**Decision:** Expose a privacy-minimized workspace directory, compute conversation eligibility from workspace role, and enforce owner/administrator/editor membership again inside the conversation write transaction. Store the existing user UUID reference and hydrate the current display name at read time.

**Reason:** Self-only controls do not satisfy collaborative manual assignment, while client-only option filtering can be bypassed. Email is unnecessary for choosing a teammate and would increase personal-data exposure. Hydrating the current name avoids copying mutable profile text into every thread.

**Consequence:** Workspace viewers, analysts, and approvers cannot become responsible conversation owners until granted an action-capable role. Assignment history stores the stable assignee UUID in minimized audit evidence; directory/inbox presentation uses the current display name. Teams, queues, presence, routing, and notifications remain separate future subsystems.

## Release 0.33 teammate-assignment flow

1. An authenticated page or directory API requests members for one authorized workspace.
2. The repository returns only user ID, display name, role, and the computed assignment flag.
3. Create/detail forms render eligible members; inbox owner filtering accepts self, unassigned, or one exact member UUID.
4. A workspace writer submits the thread mutation. The repository revalidates same-workspace membership and owner/admin/editor role in the transaction.
5. Thread reads hydrate the current assignee display name, while a same-status owner transition emits explicit minimized assignment audit evidence.

### ADR-041 - Conversation classification begins as explicit reviewed state

**Decision:** Represent sentiment, intent, and urgency as closed thread-level values with `unknown` defaults and reviewer/time evidence. Accept changes only through authenticated workspace writes and do not run a model or infer sensitive traits in this release.

**Reason:** These dimensions are required for inbox triage and future routing, but unbounded labels or opaque model guesses would be hard to filter, audit, correct, and secure. `unknown` communicates absence of review rather than inventing neutral sentiment, normal urgency, or a likely intent.

**Consequence:** Exact filters and visible triage work deterministically now. The current writer is evidence of the classification change, not proof that the classification is objectively correct. Any AI classifier must later add explicit model/prompt/input provenance, confidence, uncertainty, evaluation, sensitive-trait controls, and human override without rewriting historical evidence.

## Release 0.34 classification flow

1. The API schema accepts only shared closed classification values; omission preserves an existing value or defaults a new thread to unknown.
2. The repository locks the thread, compares all three prior values, and updates reviewer plus database time only when a classification actually changes.
3. Database checks reject unknown enum values and partial reviewer/time evidence.
4. Workspace-scoped exact predicates filter the bounded inbox; server-rendered pages expose the same closed lists.
5. The mutation writes a classification-specific minimized audit transition and performs no provider, routing, or AI action.

### ADR-042 - Conversation context uses explicit tenant-bound references

**Decision:** Give each conversation optional independent references to one Campaign and one Destination. Enforce each association with a composite workspace foreign key and repeat the ownership check inside the locked repository transaction. Hydrate current labels at read time; preserve omitted fields and use explicit null to clear an association.

**Reason:** Inbox triage and search need trustworthy business context, but copying names or inferring lineage from message text would drift and permit ambiguous cross-tenant relationships. Independent references accommodate conversations that discuss a Destination outside the Campaign's current version without rewriting immutable Campaign history.

**Consequence:** Operators can filter and search by stable related objects while labels follow their current registry values. Referenced Campaigns and Destinations are deletion-restricted until context is cleared, preserving evidence. Brand, account, Campaign-instance, post/publication, and automatic attribution require later explicit contracts.

## Release 0.35 conversation-context flow

1. Server pages load authorized workspace Campaigns and Destinations and pass only `{ id, name }` or `{ id, title }` option projections to interactive controls.
2. The write schema distinguishes omitted context from explicit null. The repository locks the thread, resolves both values, and validates each against the same workspace.
3. Composite database foreign keys provide a second tenant boundary and prevent deleting referenced context behind a live thread.
4. List/detail reads join current labels; exact predicates and bounded text search remain rooted in the authorized workspace query.
5. Actual clear/replace transitions emit minimized UUID-only audit evidence and never trigger Campaign execution, provider I/O, or contact authority.

### ADR-043 - Publication context is subordinate to a secret-free account reference

**Decision:** Let a conversation reference one optional Channel Connection and one optional Publication Action, but require the publication to belong to that exact account and workspace. Expose a separate bounded option projection that contains only safe identity/status fields.

**Reason:** A post-level association is useful only when its publishing account is unambiguous. Reusing `StoredChannelConnection` or `StoredPublicationAction` in client controls would expose encrypted credentials or unnecessarily replicate provider configuration, request snapshots, response metadata, URLs, and error detail.

**Consequence:** Operators can filter and search by account or external publication identity without receiving connector authority or secret-bearing records. Selecting a publication selects its account; changing the account clears an incompatible publication. Referenced ledgers are deletion-restricted until context is cleared.

## Release 0.36 account/publication-context flow

1. The server loads a bounded `ConversationContextDirectory` containing secret-free account and publication options for one authorized workspace.
2. Client controls keep publication and account IDs paired; the schema rejects a publication without an account.
3. The repository locks the thread, resolves omitted/null/UUID semantics, validates workspace ownership, and verifies the publication's exact account.
4. Composite database foreign keys repeat workspace/account/publication consistency and prevent deletion behind live context.
5. Reads hydrate only current labels/external identity/status; exact filters and bounded search stay tenant rooted, and the association triggers no provider action.

### ADR-044 - Conversation Brand context references the mutable profile root

**Decision:** Let a conversation reference one optional same-workspace `brand_profile` root, independently of Campaign context. Keep immutable `brand_profile_version` pins on Campaign versions and hydrate only the Brand root's current name/status for inbox presentation.

**Reason:** A thread may concern a Brand even when it has no Campaign, or may discuss the Brand generally rather than the exact version that governed a Campaign draft. Pointing the inbox at a version would imply immutable content lineage that manual thread relevance cannot prove; copying the full profile would expand privacy and drift risk.

**Consequence:** Operators can create, clear, display, filter, and search Brand relevance without rewriting Campaign history. A Brand association does not prove Campaign-version compatibility or grant generation, approval, contact, or provider authority. Referenced Brand roots are deletion-restricted until the thread is cleared or reassigned.

## Release 0.37 Brand-context flow

1. The authorized server page loads at most 200 Brand options from the workspace into `ConversationContextDirectory.brands` as `{ id, name, status }`.
2. The write schema distinguishes omitted, null, and UUID values; the locked repository transaction preserves, clears, or replaces the root reference accordingly.
3. Repository validation and the composite `(brand_profile_id, workspace_id)` foreign key both reject cross-workspace references, while delete restriction preserves live context.
4. List/detail queries hydrate the current Brand name/status. Exact Brand filtering and bounded name/description search remain rooted in the authorized workspace query.
5. Actual changes emit UUID-or-null audit evidence only and never compare against, mutate, or authorize a Campaign's immutable Brand Profile version.

### ADR-045 - Prior interaction context is a derived chronological summary

**Decision:** Derive relationship history at read time from same-workspace conversation rows that were created strictly before the current thread. Expose the current relationship stage, prior-thread count, prior-message count, and latest qualifying timestamp; do not copy history into the thread or return prior content.

**Reason:** Operators need the relationship stage and evidence that a contact has interacted before, but message excerpts, internal notes, provider identities, and speculative customer labels would enlarge the privacy boundary and become stale. A strict creation-time boundary also prevents later threads from appearing as prior history.

**Consequence:** The inbox and detail page receive a deterministic, privacy-minimized relationship summary without a migration or background denormalization job. Counts are operational context, not identity proof, sentiment, customer status, contact permission, or routing authority.

## Release 0.38 relationship-history flow

1. The thread query joins the authorized relationship root to read its current closed stage.
2. A tenant-correlated lateral aggregate considers only other relationship threads with `created_at < current.created_at` and only their messages with `created_at < current.created_at`.
3. The aggregate returns integer thread/message counts plus the latest qualifying thread/message creation time; it never selects message body, metadata, notes, identities, or provider subjects.
4. Hydration normalizes the optional timestamp and the server-rendered inbox/detail views display the summary without a new client mutation.
5. Future threads/messages are excluded, internal authorization remains unchanged, and the summary triggers no audit event or external action.

### ADR-046 - Previously shared resources require explicit observed evidence

**Decision:** Store one immutable evidence record when a workspace operator confirms that an existing Destination or Publication was shared in a conversation. Do not infer a share from optional thread context, scrape URLs from free text, or automatically send anything.

**Reason:** A related Destination/Publication is useful triage context but is not proof the contact received it. Explicit evidence preserves that distinction, supports repeated shares, and allows target/workspace integrity, idempotency, auditing, and safe relationship-history projection.

**Consequence:** The inbox can display reviewed links/promotions actually recorded as shared. Each record targets exactly one Destination or Publication, retains observer/time evidence, and remains independent from outbound-provider execution. Referenced targets are deletion-restricted while thread deletion cascades dependent share evidence.

## Release 0.39 observed-share flow

1. The authenticated client submits a UUID idempotency key, observed timestamp, and a strict discriminated Destination-or-Publication target to one thread route.
2. The locked repository validates thread/target workspace, rejects future evidence, derives the Publication's account, and inserts once under a composite idempotency constraint.
3. Composite foreign keys repeat thread, target, account/publication, and recorder-membership integrity; a database check enforces exactly one target family.
4. A bounded relationship-history query includes current-thread evidence plus records created before a later thread, excluding evidence recorded retroactively after that later thread began.
5. Reads hydrate only Destination title/canonical URL or account name/publication external ID/status. Audit data contains stable IDs, kind, and observed time; no provider action occurs.

### ADR-047 - Conversation routing is deterministic and advisory

**Decision:** Store ordered workspace routing rules whose optional matchers are limited to explicit Brand, Channel Connection, relationship stage, intent, and urgency values. Evaluate the enabled rules inside the authorized conversation query and return only the highest-ranked owner/status suggestion. Never mutate the thread as part of evaluation.

**Reason:** Operators need consistent triage assistance, but opaque inference or automatic reassignment would bypass review, make ownership changes hard to explain, and risk routing on message content or sensitive attributes. Closed equality matchers and a stable ordering make every winner reproducible.

**Consequence:** Priority sorts first, then matcher specificity, update time, and UUID. An assigned suggestion must point to a current same-workspace owner, administrator, or editor; every other suggested status must omit an owner. Operators apply or reject the suggestion through the existing conversation controls. Rules do not grant contact, provider, Campaign, approval, or credential authority.

## Release 0.40 suggested-routing flow

1. An authenticated writer creates a named rule with at least one closed matcher and one internally consistent suggested target.
2. The repository validates referenced Brand/account/owner records against the workspace; PostgreSQL repeats tenant, enum, matcher, and assignment invariants.
3. The thread query considers only enabled rules whose non-null fields exactly equal the thread's reviewed context/classification fields and whose owner remains eligible.
4. One lateral query ranks matches by priority, matcher count, update time, and UUID, then hydrates a minimized `routingSuggestion` with the matched field names.
5. Inbox/detail views explain the suggestion and require the operator to use the pre-existing state controls. Evaluation writes no thread, audit, message, or provider record.

### ADR-048 - Service-level deadlines are derived, deterministic, and advisory

**Decision:** Store one workspace service-level policy with an IANA timezone, a seven-bit business-day mask, local start/end times, urgency-specific response-minute targets, and an at-risk lead time. Derive a thread deadline from the latest inbound message, or thread creation when none exists, with a database function. An explicit thread `responseDueAt` always wins. Expose only a read-time `on_track`, `at_risk`, or `overdue` summary and never mutate status, ownership, handoffs, workflows, or providers.

**Reason:** Operators need a consistent response clock before notification or escalation automation can be safe. Centralizing business-minute arithmetic in PostgreSQL gives the API, server-rendered UI, tests, and future workers one DST-aware definition while preserving manually reviewed deadlines.

**Consequence:** List and detail views agree on the same policy-derived deadline and source. The read-time state advances with the wall clock without background writes. Holiday calendars, paused clocks, reminders, automatic escalation, and policy scopes below workspace remain future contracts.

## Release 0.41 service-level flow

1. An authenticated workspace writer saves the single workspace policy through a strict API contract; PostgreSQL retains the author membership and minimized audit evidence.
2. A tenant-scoped conversation query joins the policy and chooses an explicit thread deadline first, otherwise the latest inbound-created timestamp or thread creation as the service clock start.
3. `conversation_add_business_minutes` advances only through configured local business windows, translating through the named timezone so UTC offsets and daylight-saving transitions are not hard-coded.
4. Hydration compares the derived deadline with the current time and configured lead interval to return `on_track`, `at_risk`, or `overdue`; resolved and archived threads have no active service-level state.
5. Inbox and detail views label the deadline source as `manual deadline` or `workspace policy`. No notification, provider I/O, assignment, status transition, handoff, or workflow command is emitted.

### ADR-049 - Review requests are explicit non-deliverable collaboration records

**Decision:** Store a review request separately from conversation messages, with one action-eligible requested reviewer, zero to twenty additional current-member mentions, optional same-thread internal-note evidence, an optional due time, and a closed `open | resolved | cancelled` lifecycle. Only the requested reviewer may resolve; only the requester may cancel. Never serialize a review request as an outbound message or connector command.

**Reason:** A teammate mention, a request for review, and a private note have different authority and retention semantics. Making those relationships explicit prevents UI text from becoming accidental delivery intent, permits deterministic authorization, and preserves a review history without overloading message metadata or conversation status.

**Consequence:** Collaboration remains visible and auditable while the thread's owner, status, contact permission, workflow, and provider state remain unchanged. Membership removal deletes only that membership's optional mention edge; core requester/reviewer identity remains attributable through the workspace user record. Notification delivery, request editing/reopening, threaded review discussion, and approval decisions remain separate future contracts.

## Release 0.42 internal-review flow

1. The authenticated writer chooses one different, action-eligible workspace teammate, optional additional current members, optional offset-aware due time, and optional same-thread `internal_note` evidence.
2. The repository locks and validates the workspace/thread, reviewer eligibility, distinct actor/reviewer/mentions, mention limit, and cited-message kind before inserting the request and mention edges transactionally.
3. Audit evidence records stable IDs, due/citation presence, and mention IDs only. Request text and cited-note content never enter the audit dictionary.
4. Detail hydration returns retained request history, reviewer/requester display names, cited-note excerpts, and mentions. List hydration returns only `openReviewRequestCount`, keeping full collaboration content off the inbox projection.
5. The requested reviewer can resolve and the requester can cancel. Neither transition changes the conversation owner/status, creates a message, emits a notification, starts a workflow, or calls a provider.

### ADR-050 - Confirmed identities form a reversible graph, not a destructive merge

**Decision:** Keep every `relationship_contact` and `relationship_identity` on its original root. Represent cross-provider resolution as one canonical unordered pair with `suggested | confirmed | dismissed` state, a closed evidence kind, confidence, suggester, and reviewer. Compute the confirmed connected component recursively for the shared view. A dismissal removes that edge from the component without moving or deleting any identity, conversation, or audit record.

**Reason:** Destructive merging would make false positives difficult to reverse, obscure provider lineage, and create ambiguous deletion and contact-safety behavior. A reviewed graph preserves source identity and supports unconfirmed confidence while letting a later correction separate records exactly.

**Consequence:** Confirmed links can join existing groups transitively; UI and API reads aggregate member roots and provider identities on demand. Effective contact permission is suppression-first across the component and is reused by relationship options and conversation reads. Similar names and speculative model output are not evidence. Automatic candidate discovery, a unified conversation timeline, and provider/CRM reconciliation remain separate future work.

## Release 0.43 identity-resolution flow

1. A workspace writer selects another same-workspace relationship, one closed evidence basis (`verified_link`, `exact_address`, `strong_identifier`, or `user_confirmation`), a bounded confidence, and either suggestion or immediate confirmation.
2. The repository canonicalizes the UUID pair, locks both roots, validates current authoring membership, rejects self/cross-workspace/already-confirmed-group links, and stores or reopens one durable edge.
3. A reviewer can confirm or dismiss the edge. Dismissing a confirmed edge is the reversible separation operation; provider identities and conversation roots never move.
4. A recursive `UNION` derives the confirmed component. The shared view hydrates every member root and provider identity plus touching link history; suggestions remain outside the component and retain visible confidence.
5. `relationship_effective_contact_permission` returns `suppressed` when any confirmed member is suppressed. Relationship selectors, registry summaries, and conversation reads use this derived safety state without mutating the local roots.

### ADR-051 - Strong-evidence discovery is deterministic, bounded, and review-only

**Decision:** Discover candidate identity links only from exact normalized values on verified provider identities: email addresses, canonical HTTPS profile links, or namespaced strong identifiers. Store a SHA-256 evidence fingerprint and closed evidence kind, never the raw matched value. Create only `suggested` edges; a human must confirm or dismiss every candidate.

**Reason:** Identity resolution benefits from surfacing obvious cross-provider matches, but names, organization resemblance, message content, or model inference are unsafe merge signals. A deterministic signal pipeline makes every candidate reproducible and reviewable while minimizing retained personal data.

**Consequence:** One manual scan reads at most 5,000 verified identities, ignores any signal shared by more than five relationship roots, and creates at most 100 candidates. Existing direct pairs, including dismissed pairs, are never reopened automatically. Discovery remains an operator-triggered queue rather than a background workflow, and confirmed graph behavior stays owned by ADR-050.

## Release 0.44 identity-candidate discovery flow

1. An authenticated workspace writer starts a scan through `POST /api/v1/relationship-identity-candidates`; unauthenticated or viewer-only callers fail before identity data is read.
2. `scanIdentityCandidates` locks the workspace relationship set for a stable pass and loads no more than 5,001 verified identities, using the extra row to detect and reject an oversized scan.
3. `strongIdentitySignals` normalizes exact email, HTTPS profile, and namespaced identifier values. It excludes display names, organizations, notes, messages, handles, model output, and reported-only identities.
4. `discoverIdentityCandidates` groups exact signals, discards ambiguous signals shared by more than five roots, applies deterministic evidence priority and confidence, excludes every existing pair, and caps the insertion plan at 100.
5. The repository inserts canonical unordered `suggested` edges with origin `deterministic_scan` and a lowercase SHA-256 fingerprint. Conflict-safe insertion and the pair uniqueness constraint make retries idempotent.
6. The Conversations queue lists bounded suggestions and links each pair to the existing review surface. Confirmation/dismissal remains an explicit Release 0.43 decision and no provider identity, conversation, contact permission, workflow, or connector is mutated by scanning.

### ADR-052 - Conversation Assistant output is immutable advice, not delivery intent

**Decision:** Generate response suggestions behind the provider-neutral generation boundary from a bounded immutable snapshot of external thread history and approved structured context. Persist recommendation, response text, uncertainty, citations, claims, provider identity, prompt identity, and input fingerprint as a review record. Never translate generation into an outbound message or provider command.

**Reason:** Operators need help summarizing and answering conversations, but a model output is neither approved business truth nor permission to contact someone. Exact snapshots and citation-indexed claims make the result reconstructable; a closed recommendation and explicit uncertainty make safe refusal and human escalation first-class.

**Consequence:** Release 0.45 uses the deterministic local `grounded-conversation-template`, so no model credential is required. A future hosted or local model may replace it only behind the same validation contract. One active suggestion exists per thread; regeneration supersedes rather than rewrites history, and dismissal records review without sending anything.

## Release 0.45 Conversation Assistant flow

1. An authenticated workspace writer requests a suggestion for one same-workspace thread. The repository rechecks owner, administrator, or editor membership inside the transaction and locks the thread.
2. The input snapshot captures at most the latest twenty inbound/outbound-observed messages, suppression-first relationship safety, reviewed classification, and only published Brand, Campaign-version, and Destination context. Internal notes, provider metadata, credentials, and arbitrary client prompt text are excluded.
3. `generateGroundedConversationResponse` deterministically identifies up to five questions, summarizes the latest inbound context, chooses `respond | clarify | no_response | human_review`, recommends bounded promotional strength, and may propose the exact published Destination.
4. Repository validation requires response presence to match the recommendation and every generated factual claim to cite a valid zero-based citation index. The raw snapshot is hashed into `inputFingerprint`; generation and prompt constants make the output reproducible.
5. A new active row supersedes the prior active row without mutation of its content. The detail interface shows response text, uncertainty reasons, citations, claims, generator identity, and retained dismissed/superseded history.
6. Generation and dismissal write minimized audit dictionaries only. They create no outbound conversation message, status/owner change, handoff, workflow command, publication, connector call, or provider request.

### ADR-053 - Drafting presence is a lease; the composer is not a delivery queue

**Decision:** Store at most one shared review draft per conversation, with optional immutable assistant-suggestion provenance and explicit last-editor attribution. Represent human and assistant drafting indicators as renewable two-minute leases, never as durable ownership, approval, or delivery commands. The composer exposes save and discard only.

**Reason:** Teammates need a common place to adapt a suggested response and avoid overwriting active work, but browser disconnects make permanent presence flags unreliable. Separating mutable collaboration text from immutable assistant evidence and from provider delivery prevents a saved draft from being mistaken for approved outreach.

**Consequence:** Writers share one draft and see active human or assistant authors. A stale lease expires automatically; generation clears its assistant lease in a `finally` path. Saving preserves the selected suggestion ID but does not mutate that suggestion. There is no accept, send, scheduling, connector, publication, workflow, or outbound-message transition in this release.

## Release 0.46 review-composer flow

1. The detail page loads the current shared draft and unexpired presence leases alongside immutable assistant suggestions.
2. A writer may copy the active suggestion into local composer state; the copied text remains editable and its source suggestion ID is retained as provenance.
3. Focus or editing renews a human lease every minute. Blur/unmount clears it best-effort; the database expiry remains authoritative after interrupted clients.
4. Save validates a nonblank body of at most 20,000 characters, same-workspace thread/source suggestion, and current writer membership before upserting the one shared row and renewing presence.
5. Discard deletes only the shared draft and the actor's human lease. Audits retain IDs and character count, not response text. No action emits provider work.

### ADR-054 - Attention is a derived read model, not an automatic escalation

**Decision:** Derive one bounded workspace attention queue from authoritative response service levels, explicit follow-up timestamps, open review-request deadlines, and open handoff deadlines. Add a configurable overdue-to-escalation delay to the existing service-level policy, but represent escalation as a reason label only. Never mutate a thread or dispatch a notification while evaluating the queue.

**Reason:** Operators need one prioritized view of work at risk without introducing a scheduler, duplicate reminder records, or hidden automation. Derivation keeps the queue consistent with the source deadlines and makes reads replay-safe while a later notification system can define its own delivery, acknowledgement, retry, and idempotency contract.

**Consequence:** Release 0.47 ranks escalation-due, response-overdue, due collaboration, and at-risk work deterministically and returns at most 200 active threads. One thread can carry multiple reasons. Resolved and archived threads are excluded. Reading the queue creates no audit row, handoff, assignment, status transition, workflow command, provider request, or outbound message.

## Release 0.47 conversation-attention flow

1. Writers configure `escalationAfterMinutes` with the existing workspace business-hours and response-target policy; zero through 10,080 minutes is valid.
2. The repository computes each active thread's service-level deadline, then joins explicit follow-up time and the earliest open review/handoff due times.
3. A response becomes at-risk inside the configured lead window, overdue at the due time, and escalation-due after the configured delay. Follow-up, review, and handoff reasons appear once their own timestamps pass.
4. Multiple reasons are returned on one `ConversationAttentionItem`; severity, earliest relevant due time, and thread UUID provide deterministic ordering.
5. The authenticated API and server-rendered Conversations panel expose the queue and links. Evaluation is read-only and refresh-driven.

### ADR-055 - Retention configuration produces eligibility, never deletion

**Decision:** Assign every conversation one explicit retention class (`standard`, `personal_message`, `imported_email`, or `legal_hold`) and store independently configurable workspace day windows for the first three. Compute a bounded preview only for resolved or archived threads. Provide no delete endpoint, purge worker, automatic erasure, or cascade trigger.

**Reason:** The product specification requires configurable retention, especially for personal messages and imported email, but production deletion also requires legal basis, subject-access/export, legal-hold verification, approval, dependency analysis, backups, and evidence/audit policy. An explicit preview makes the future action set reviewable without treating provider names or message content as unsafe class inference.

**Consequence:** Writers review thread class changes and can place any thread on legal hold. An enabled policy calculates eligibility from the latest recorded message time or thread creation, class-specific whole-day windows, and closed status. Preview reads never delete or anonymize anything. Future execution requires a separate approval and reference-aware erasure design.

## Release 0.48 retention-preview flow

1. A workspace writer configures enabled state plus standard, personal-message, and imported-email windows from one through 3,650 days.
2. A writer explicitly assigns a thread class; no provider, subject, body, identity, or model heuristic selects it. Every change retains reviewer/time evidence and a minimized audit transition.
3. Legal-hold threads and active statuses are excluded before eligibility calculation.
4. For each remaining closed thread, `lastActivityAt = lastMessageAt ?? createdAt`; the applicable class window produces `eligibleAfter`.
5. The authenticated API and UI display at most 200 eligible candidates ordered by date and UUID. No route or worker can execute deletion.

### ADR-056 - AI routing applies hard constraints before optimization

**Decision:** Put every model invocation behind one provider-neutral descriptor and routing contract. Filter adapters by approval, availability, capability, tool need, context limit, and maximum permitted data exposure before ranking by the selected outcome mode. An unavailable result is valid and must not silently broaden privacy or provider authority.

**Reason:** Model names, prices, capabilities, and behavior change independently. Product code should request a capability and business outcome, while deterministic services retain responsibility for permissions, budgets, privacy, evidence, approvals, and execution. A closed route decision makes provider additions replaceable and testable without embedding provider logic throughout the application.

**Consequence:** Release 0.49 exposes six plain-language modes and eight capabilities. The only executable descriptor is the existing local grounded-template generator, which supports text and structured output. Other capabilities visibly fail closed until a separately reviewed adapter and credential boundary are added. The usage ledger records numeric operational metadata and hashes/version references, never prompt or output bodies.

## Release 0.49 AI gateway and cost-control flow

1. A workspace writer selects one `AiMode`, maximum privacy class, failover mode, cap behavior, currency, optional daily/Campaign/monthly caps, and one to five ascending alert percentages.
2. Product code requests one closed `AiCapability`; it does not select a provider by display name during ordinary setup.
3. `routeAiTask` removes unavailable, unapproved, incapable, over-context, tool-incompatible, or over-exposure adapters. `private_local` further requires local execution.
4. The selected mode ranks only eligible descriptors by quality, speed, cost, and privacy. Stable provider/model ordering breaks ties. With no eligible descriptor, routing returns `unavailable` and does not call a provider.
5. Successful executors may append `ai_usage_event` metadata. The authenticated AI & Cost page shows spend versus cap and keeps request/unit/model details under an advanced disclosure.

### ADR-057 - Paid AI work requires a reservation before provider I/O

**Decision:** Treat spend headroom as a transactional resource. A server-side caller must reserve a conservative minor-unit estimate before paid model I/O, settle the same reservation with an actual cost no greater than the estimate, or release it without usage. Reservation decisions serialize on the workspace row and include settled usage plus every unexpired hold in daily, monthly, and Campaign totals.

**Reason:** A read-then-write budget check permits concurrent requests to overspend. The 15-minute lease bounds abandoned capacity, UUID idempotency prevents duplicate holds, and one usage row per reservation makes settlement replay safe. Crossing a UTC day or month does not free an already active hold from the current cap calculation.

**Consequence:** Direct non-zero `recordUsage` writes are rejected. Provider adapters must estimate high enough to cover the final charge, retain the reservation ID, and settle or release on every terminal path. Denied, expired, released, and settled states are retained as operational evidence. No browser mutation endpoint is provided, so clients cannot consume headroom or attest provider charges.

## Release 0.50 transactional AI spend flow

1. A server call site invokes `reserveSpend` with a UUID idempotency key, conservative estimate, capability, bounded feature, exact policy currency, and optional Campaign root.
2. The repository locks the workspace row, expires stale holds, and calculates settled plus reserved totals. It records either a 15-minute `reserved` lease or `denied` with exact exceeded daily, Campaign, or monthly scopes and the cap-behavior snapshot.
3. Only a reserved decision may precede future provider I/O. Confirmed completion invokes `settleSpend(actual <= estimate)` and atomically creates one linked `ai_usage_event`.
4. A known no-charge terminal path invokes `releaseSpend`; an abandoned lease expires. Neither state creates usage.
5. `getBudgetStatus` supplies the read-only UI with settled, reserved, and available totals plus bounded active and recent decisions.

### ADR-058 - Budget alerts are durable threshold-crossing evidence

**Decision:** Evaluate configured alert percentages inside the same workspace-locked transaction that accepts a spend reservation. Create one retained alert for every reached daily, Campaign, or monthly threshold, deduplicated by workspace, scope, window key, percentage, exact cap, and currency. Acknowledgment changes shared alert state but never changes headroom or execution.

**Reason:** Calculating notices after commit can lose alerts during process failure and concurrent requests can duplicate them. Reservation-time evaluation sees the authoritative committed amount before provider I/O. Exact-cap uniqueness permits a materially changed policy to produce new notices while suppressing repeats caused by release/re-reserve cycles in the same window.

**Consequence:** One reservation may atomically create several alerts when it crosses multiple configured percentages or scopes. Denied reservations, settlement, release, and expiry do not create or retract alerts. Notices remain an in-app historical signal; Release 0.51 does not send email, push, webhook, or workflow work and does not retroactively evaluate a newly lowered cap until another accepted reservation occurs.

## Release 0.51 AI budget-alert flow

1. A workspace writer configures one to five ascending percentages on the existing AI policy.
2. `reserveSpend` serializes the decision, accepts the hold, then evaluates `settled + active reservations + new estimate` for every configured capped scope.
3. Daily uses `YYYY-MM-DD` UTC, monthly uses `YYYY-MM` UTC, and Campaign uses the exact Campaign UUID as the durable `windowKey`.
4. Reached thresholds insert `open` alerts with committed/cap snapshots and optional source reservation; the composite uniqueness rule makes retries and later re-crossing idempotent.
5. Authorized readers see at most fifty open-first recent notices. A writer may acknowledge one through a strict workspace-bound API; the retained notice and minimized audit remain.

### ADR-059 - Spend approval authorizes one exact denied estimate

**Decision:** Implement `require_approval` as a durable request tied to one immutable denied reservation. Writers may supply a bounded business justification; an owner, administrator, or approver records approved/rejected state. Only a server-side method can consume an unexpired approval, once, into a new reservation that copies the denied capability, feature, currency, Campaign, estimate, and cap behavior.

**Reason:** Letting clients submit an override amount or directly consume approval would bypass the trusted cost-estimation boundary. Linking the request to denial evidence preserves the exact scope and amount reviewed. A unique exception-to-reservation link and row/workspace locks make consumption replay safe.

**Consequence:** Requests expire after 24 hours. One approved request creates at most one 15-minute spend reservation and cannot be reused even if that hold is released or expires. Consumption is an explicit cap override but still requires settlement/release and may create normal threshold alerts. Release 0.52 provides no public consume endpoint and no provider call.

## Release 0.52 AI spend-exception flow

1. A server call receives a cap denial carrying `require_approval`; an authorized writer references that denial and provides 1-to-1,000-character justification.
2. Persistence verifies the denied state, captured cap behavior, tenant, and writer role, then creates one 24-hour pending request per denied reservation.
3. An approval-role member records approved or rejected through a strict API. Repeating the same decision is idempotent; a conflicting terminal decision fails closed.
4. An internal call locks the workspace and approved request. If unexpired and unconsumed, it creates one exception-linked 15-minute reservation from the original estimate and stamps `consumedAt` atomically.
5. The ordinary settlement/release contract handles the resulting reservation. Browser clients can request, review, and decide but cannot consume, call a provider, or forge usage.

### ADR-060 - Cap response planning cannot grant execution authority

**Decision:** Translate a persisted denied spend reservation and its captured `capBehavior` into one closed `AiCapResponsePlan`. Planning is pure and may choose pause, request approval, a known no-paid adapter, a limited draft, or a visible manual outcome. It never invokes an adapter, creates a reservation, consumes an exception, settles usage, or broadens the policy.

**Reason:** A configured cap response must be understandable and deterministic, but treating a fallback label as provider authority could evade the transactional spend boundary. The planner therefore receives only adapters the server already knows require no paid reservation. General provider descriptors cannot enter this list until an explicit billing-class contract exists.

**Consequence:** Text and structured-output denials can name the built-in Market Me grounded-template adapter for lower-cost or limited-draft behavior. Unsupported capabilities fail visibly to manual handling. Approval behavior points to the Release 0.52 request flow but does not create or consume a request. `requiresPaidReservation` is always false and the preview response explicitly reports `execution: false` and `providerCall: false`.

## Release 0.53 deterministic AI cap-response flow

1. The repository loads one exact same-workspace reservation; the preview route accepts only workspace and denied-reservation UUIDs.
2. Non-denied reservations return an unavailable manual plan. A denial uses the immutable capability and captured cap behavior, not a newly supplied client preference.
3. `pause_ai_work` returns a ready pause; `require_approval` returns a ready approval request that preserves the exact denied estimate.
4. `lower_cost_fallback` and `limited_drafts` route only through the caller-provided no-paid adapter set. The current built-in adapter supports text and structured output; other capabilities return unavailable/manual.
5. The AI & Cost page derives recent plans server-side and displays them beside denials. Reads and previews create no database row, provider call, workflow command, reservation, approval, usage, or external side effect.

### ADR-061 - Assistants are capability-oriented presentation, not autonomous principals

**Decision:** Present seven named assistants from the product specification and select one deterministically from the user's action. An assistant profile declares purpose, eligible actions, model-gateway capabilities, output kinds, and `executionAuthority: false`. It is not an identity, credential holder, policy principal, provider configuration, or workflow worker.

**Reason:** Outcome-oriented names help users understand the kind of help requested without exposing model selection. Combining that presentation role with execution authority would let an AI label bypass the existing evidence, privacy, permission, spend, approval, connector, and contact-safety boundaries.

**Consequence:** Release 0.54 uses `Automatic` selection for all seven actions and exposes the same closed catalog through the AI policy API and AI & Cost page. Selection returns a required gateway capability but does not route or invoke an adapter. Advanced profile/provider/model overrides remain disabled until compatibility validation, persistence, authorization, and safe provider controls are designed.

## Release 0.54 assistant-selection flow

1. Product code supplies one closed `AiAssistantAction`; free-form agent names and prompts are not selection inputs.
2. `automaticAssistantByAction` maps the action to one profile ID and one required `AiCapability`; TypeScript exhaustiveness prevents a missing action at compile time.
3. `selectAiAssistant` returns the immutable profile, required capability, reasons, automatic state, and false execution authority.
4. The policy API publishes all profiles and seven resolved selections with `assistantExecution: false`. The server-rendered AI & Cost page shows role, action, purpose, capability, and output kinds.
5. A later product service may pass the required capability through ordinary gateway routing and spend authorization, but this release creates no provider call, reservation, approval, workflow command, publication, or product mutation.

### ADR-062 - Assistant preferences are replaceable role mappings, not provider pins

**Decision:** Store at most one explicit assistant-profile choice per workspace/action. Omission means `Automatic`. Replace the entire explicit set atomically, require writer authority, and accept a choice only when the profile declares the action and the action's required capability. Resolve the effective selection through the same pure Release 0.54 selector.

**Reason:** Advanced users need controlled role preferences, but a stale or semantically incompatible profile must not silently change requested capability. Treating the preference as a provider/model pin would also merge user presentation with data-exposure, billing, credentials, and execution controls.

**Consequence:** The table contains only closed action/profile IDs and membership/timestamp evidence. Saving an empty set restores Automatic for every action. A workspace choice changes role/purpose/output presentation only; ordinary gateway routing, spend authorization, approvals, evidence, connector capability, and execution controls remain authoritative.

## Release 0.55 assistant-assignment flow

1. An authorized reader receives the explicit rows and seven resolved selections. No row means the Release 0.54 automatic profile.
2. A writer submits a strict zero-to-seven array with unique action keys; undeclared fields, unknown IDs, duplicates, and incompatible action/profile pairs fail before persistence.
3. The repository repeats writer authorization, deletes the old explicit set, inserts the validated replacement in one transaction, and writes one minimized audit event.
4. The UI offers Automatic plus only profiles whose declared action and capabilities satisfy the selected action's required capability. Saving and reload expose workspace-selected state.
5. Returning every control to Automatic replaces the set with zero rows. Reads/writes never select provider/model, invoke an adapter, reserve spend, start a workflow, publish, contact anyone, or execute a proposed action.

### ADR-063 - Cached analysis requires an exact semantic and tenant key

**Decision:** Cache a JSON analysis only under the complete tuple `(workspace, capability, feature, content SHA-256, model family, prompt version, context revision)`. Canonicalize and hash the result, cap it at 256 KiB, require a 60-second-to-30-day TTL, retain the first active result for a key, and permit refresh only after expiry.

**Reason:** Content identity alone cannot prove that model behavior, prompt instructions, business context, or requested capability is unchanged. Partial keys risk returning a stale or cross-purpose analysis. First-write-wins prevents concurrent identical work from racing to replace a result after another caller has begun consuming it.

**Consequence:** Exact unexpired lookup increments hit metadata and returns the server-held payload only to internal callers. Any changed key part is a miss. The browser/API receives aggregate active count, bytes, hits, and freshness only. Release 0.56 does not automatically wrap a generator/provider or expose cache payload/list/delete endpoints.

## Release 0.56 analysis-cache flow

1. A server caller supplies the exact tenant/capability/feature/content/model/prompt/context key, a finite acyclic JSON result, bounded TTL, and attributed writer.
2. The repository validates and canonically orders JSON object keys, computes UTF-8 byte size and SHA-256, then inserts under workspace/action authorization.
3. A concurrent active key retains its first result. An expired key may atomically refresh payload/hash/TTL and reset hits.
4. Exact unexpired lookup atomically increments `hitCount` and `lastHitAt`; expired or near-key lookups return no result.
5. Authenticated AI policy/page reads aggregate active entries, bytes, hits, and dates without selecting or serializing result JSON.

### ADR-064 - Readiness can use descriptor cost class; currency needs a rate card

**Decision:** Combine the effective assistant selection with ordinary policy-bound routing to produce one non-executing `AiAssistantWorkPlan`. Show Ready or Unavailable and the selected descriptor's Low/Medium/High cost class. Always report `currencyEstimateAvailable: false` until a versioned, effective-dated, provider-authentic rate card and unit estimator exist.

**Reason:** The adapter descriptor already supports honest relative comparison, but it has no per-unit price, currency, tokenizer, output-range, minimum charge, or effective date. Converting a qualitative class into money would manufacture precision and could mislead budget decisions.

**Consequence:** Release 0.57 can explain current readiness for every assistant action without invoking an adapter. Six actions route through local grounded text/structured output and Discovery's rerank requirement remains visibly unavailable. The plan grants no execution/spend/approval authority and cannot substitute for a future reservation estimate.

## Release 0.57 assistant work-readiness flow

1. Resolve the automatic or compatible workspace-selected assistant and its unchanged required capability.
2. Run existing gateway routing with current mode, maximum privacy, approval, availability, capability, tools, and context constraints.
3. An unavailable route produces Not configured and no estimated cost. A selected route produces Ready plus its descriptor cost class.
4. The API publishes all seven work plans; the AI & Cost cards show status, cost class, and a plain-language reason without surfacing model names in the primary label.
5. Planning creates no provider call, cache write, reservation, approval, usage event, workflow command, connector action, publication, or contact.

### ADR-065 - Provider pricing is a server-owned effective-dated registry

**Decision:** Persist provider/model-family price versions separately from adapter descriptors. Each approved `AiProviderRateCard` has one currency, model version, source reference and SHA-256, verification/approval evidence, a half-open `[effectiveFrom, effectiveTo)` window, and normalized input/cached-input/output/request components. PostgreSQL rejects overlapping approved windows for the same provider, model family, and currency.

**Reason:** Adapter Low/Medium/High classes are routing hints, not billable prices. Authentic pricing changes over time and different providers charge by token, character, second, image, or request. A source-verifiable normalized registry creates the necessary historical boundary without coupling pricing changes to deployment code or exposing commercial terms to workspace writers.

**Consequence:** Release 0.58 can resolve exactly one current approved version and expose aggregate readiness metadata, but it still reports `monetaryEstimateAvailable: false`. No currency quote is produced until a later estimator can bind an exact provider/model version to bounded input/output units, rounding/minimum rules, expiry, and spend reservation.

## Release 0.58 rate-card selection flow

1. Server-side readers evaluate an explicit request time and optional three-letter currency.
2. PostgreSQL selects approved cards where `effectiveFrom <= asOf` and `effectiveTo` is absent or greater than `asOf`; the upper boundary is exclusive.
3. The approved-window exclusion constraint prevents two active prices for one provider/model-family/currency identity. Draft windows may overlap because they are never selectable.
4. Components retain exact usage kind, metering unit, unit quantity, and bounded price in one-millionth major-currency units; the browser receives only count, currencies, verification freshness, and false estimate availability.
5. The seeded Market Me grounded-template card records one zero-price request component. Registration does not call a provider, forecast usage, create a quote, reserve spend, or authorize execution.

### ADR-066 - Cost quotes are conservative, bounded, expiring, and non-authorizing

**Decision:** Add an explicit 0-through-4 currency minor-unit exponent to every rate card and quote only when every non-request price component has one matching bounded usage forecast. Calculate component micros and final minor units with integer ceiling, expire after at most five minutes or the card boundary, and fix reservation/execution authority false.

**Reason:** Floating-point arithmetic, an implicit two-decimal assumption, omitted output components, or a quote that outlives its rate card can all understate spend. A quote is price information, not permission to incur cost or perform the work.

**Consequence:** Release 0.59 can honestly quote the fixed zero-price local request and future bounded paid requests. Paid quotes still require a separate transactional reservation before provider invocation, and actual settlement remains bound to measured usage.

## Release 0.59 conservative quotation flow

1. Select one approved effective provider/model-family/currency card at the quote time.
2. Require unique ordered integer minimum/maximum forecasts for every non-request component; reject missing, duplicate, unused, negative, inverted, or excessive quantities.
3. Multiply quantities by price micros using arbitrary-precision integers, ceiling-divide by component unit quantity, sum lines, then ceiling-convert to the card's minor currency unit.
4. Expire the quote after 300 seconds by default, shortened to an earlier card effective-to boundary.
5. Return exact card/model identity, line evidence, cost range, rounding rule, expiry, reservation requirement, and literal false reservation/execution flags; the browser receives only a minimized reference projection.

### ADR-067 - Durable cost quotes bind exactly once to server-derived reservations

**Decision:** Persist every requested quote as an immutable tenant/workspace/Campaign record with its exact effective rate card, canonical ordered forecasts, calculated lines, bounded minor-unit cost, expiry, creator, and a canonical SHA-256 identity. A paid quote may be consumed once by a reservation whose amount, currency, Campaign, capability, and feature are copied server-side from that quote in the same transaction.

**Reason:** A transient client quote cannot prove which rate evidence or forecast authorized a later reservation. Accepting client-submitted reservation fields would permit drift or tampering between display and spend authorization. Stable identity, hash verification, a quote row lock, and a unique reservation link make the boundary auditable and replay-safe.

**Consequence:** Release 0.60 creates and retrieves durable quotes and binds a positive quote to at most one accepted or denied reservation. Quote creation still performs no provider call and grants no execution authority. Settlement remains a later measured-usage operation, and zero-charge quotes intentionally cannot create reservations.

## Release 0.60 durable quote-reservation flow

1. A workspace writer requests a quote using only a server-known rate-card target, closed capability/feature, optional same-workspace Campaign, and complete bounded forecasts.
2. The repository reselects the exact approved/effective card, calculates the quote, canonicalizes its security-relevant fields, hashes them, and inserts the immutable quote plus minimized audit evidence.
3. A reservation request supplies only workspace, quote ID, and UUID idempotency key. The transaction locks the quote and workspace, recomputes the canonical hash, and rejects expiry, drift, zero cost, reuse, or currency mismatch.
4. Campaign, capability, feature, currency, and maximum minor cost are derived from the stored quote. Existing cap logic then creates one reservation linked by a unique `cost_quote_id`; same-key replay returns the same row.
5. Policy clients receive minimized quote targets and readiness metadata, not component prices, source evidence, hashes, or execution authority. Provider invocation and actual-cost settlement remain outside this release.

### ADR-068 - Assistant cost forecasts are closed server-owned planning envelopes

**Decision:** Define one versioned metering profile for every assistant action. Resolve the effective assistant and ordinary privacy/policy routing first, require the selected rate card to match that adapter's provider/model family and workspace currency, convert only supported token or character components, and create durable action quotes from server-derived capability, feature, and forecasts.

**Reason:** Release 0.60's generic quote API correctly validates explicit forecasts, but an assistant UI or client must not invent its own usage scope to obtain spend evidence. A closed action envelope supplies conservative repeatable bounds while preserving adapter/card compatibility and rejecting unsupported meters rather than guessing.

**Consequence:** Release 0.61 can preview currency ranges for six currently ready actions and create one durable quote through a strict action endpoint. The unconfigured rerank action stays unavailable. Profiles are preflight envelopes rather than payload-derived measurements and grant no provider, reservation, or execution authority.

## Release 0.61 assistant metering and quote flow

1. Resolve the automatic or compatible workspace assistant, its unchanged required capability, current AI mode, maximum privacy, and approved available adapter.
2. Select an approved effective rate card in the workspace policy currency whose provider and model family exactly match that routed adapter; an explicitly requested mismatched card fails closed.
3. Load the closed `assistant-metering-v1` action profile. Token meters use its bounds, character meters use a conservative four-characters-per-token conversion, cached input begins at zero, and second/image meters are unavailable.
4. Calculate a minimized non-persisted preview with no provider call. The policy surface exposes action, capability, profile identity, forecasts, bounded currency cost, expiry, and false authority fields but no component price/source/hash evidence.
5. A strict writer-only action quote request accepts workspace, optional Campaign, action, and rate-card ID. The server derives capability, feature, and forecasts, then the Release 0.60 repository revalidates and persists the exact quote.

### ADR-069 - Quote-ledger reads are minimized, tenant-bound operator projections

**Decision:** Add a bounded recent-quote repository read that requires workspace membership, orders immutable quotes newest first, derives status at read time, and joins only the optional reservation identity. Expose a separate minimized ledger projection and permit creation/reservation only through existing writer-authorized mutation routes.

**Reason:** Durable quote identity is not useful to operators if it is visible only in write responses, but returning the stored object would disclose forecasts, rate lines, model identity, canonical hashes, creator IDs, and other internal evidence. A purpose-built projection supports review without widening data or authority.

**Consequence:** Release 0.62 lets members inspect recent quote scope, currency range, time/status, and reservation linkage. Writers can create a server-profiled action quote and reserve an eligible positive active quote once. Zero-charge local quotes remain visible and correctly offer no reservation action.

## Release 0.62 operator quote-ledger flow

1. The AI & Cost page requests at most 20 recent quotes for its authenticated workspace and actor. The repository checks membership before reading tenant-filtered rows.
2. The server maps each stored quote to `AiCostQuoteLedgerItem`, omitting workspace/creator IDs, rate/model identity, forecasts, lines, hash, source evidence, and provider payloads.
3. Each quoted assistant action exposes a writer-only create button that calls the strict Release 0.61 route and refreshes the ledger after immutable persistence.
4. The ledger derives active, expired, or consumed state. A reserve button appears only for a positive, active, unlinked quote and uses the existing one-use transaction; zero, expired, consumed, and viewer cases remain non-actionable.
5. Quote creation, listing, and reservation still grant no provider or workflow execution. Measured settlement remains a later provider-call boundary.

### ADR-070 - Explicit provider/model preferences apply only after hard routing filters

**Decision:** A workspace may store at most one exact `{ provider, model }` identity for each closed assistant action. Automatic routing is represented by no row. The gateway first applies required capability, privacy ceiling, approval, availability, tool, context, and private-local constraints; an explicit preference may select only from that eligible set. If the preferred route is absent, unknown, unapproved, incompatible, or no longer eligible, planning fails closed instead of silently choosing another adapter.

**Rationale:** Administrators need predictable provider/model selection, but a preference must not become a policy override or covert failover path. Using the same `routeAiTask` boundary for work readiness and quote planning prevents a displayed route from diverging from the quoted route. Exact provider/model identity also avoids ambiguous family matching.

**Consequence:** Automatic behavior remains unchanged for workspaces with no preference. Writers can atomically replace the governed mapping, and every save is validated against the server adapter catalog before persistence. Runtime routing repeats all hard checks because catalog availability and workspace policy can change after a save. A stale explicit preference can intentionally make an action unavailable until it is cleared or changed.

## Release 0.63 governed routing-preference flow

1. The AI settings page loads registered adapter descriptors, the seven effective assistant actions, and tenant-bound routing preferences.
2. The advanced form shows only approved capability-compatible exact provider/model choices for each action; omitted actions remain Automatic.
3. Strict PUT validation rejects duplicate actions, unknown fields, unsupported routes, and client credential or execution data before repository access.
4. The repository rechecks writer membership, catalog compatibility, and closed action identity, then replaces all workspace rows in one transaction and writes minimized audit evidence.
5. Work-readiness and assistant-cost planning supply the action preference to the shared gateway. Hard filters run first; an ineligible explicit route produces an unavailable plan and no implicit fallback.
6. Release 0.63 stops at planning and quotation. It adds no provider credential, invocation, endpoint, health service, settlement, connector, publication, messaging, or workflow authority.

Migration 0057 adds `workspace_ai_routing_preference` with a `(workspace_id, action)` primary key, tenant-bound creator/updater membership foreign keys, trimmed 1-through-100-character provider/model constraints, a closed seven-action check, timestamps, and an updated-time index. The adapter catalog remains static in process; persistent provider registration and credential-backed execution are later architecture.

### ADR-071 - Adapter routing metadata is durable global server configuration

**Decision:** Replace application dependence on the static built-in adapter array with a normalized PostgreSQL registry. One `ai_provider_adapter` row owns exact provider/model identity, display and routing qualities, context limit, approval, availability, paid-reservation requirement, configuration source, and verification timestamps. Child rows store a unique subset of the closed gateway capabilities. Browser clients receive a read-only safe projection; no public mutation route exists.

**Rationale:** Workspace routing preferences cannot safely reference providers that exist only in process memory, and future deployments need one authoritative inventory shared by pages, generic routing previews, cap-response planning, assistant work readiness, and cost quotation. A normalized capability relation gives database-enforced closed values and uniqueness without opaque JSON arrays.

**Consequence:** The existing `market-me/grounded-template` adapter is seeded as built-in, approved, available, local, and not requiring a paid reservation. Workspace preference rows now have a restrictive composite foreign key to the registry. The registry records metadata only: availability is deployment evidence, not a live provider probe, credential, endpoint, invocation permission, rate card, or execution authority.

## Release 0.64 durable adapter-registry flow

1. Server code loads all adapter and capability rows through `AiRepository.listProviderAdapters`; timestamps are normalized and nullable availability reasons are omitted from projections.
2. Routing, assistant readiness, cost planning, generic previews, and cap responses receive that exact list. Cap responses explicitly filter to records whose `requiresPaidReservation` is false.
3. Preference writes validate exact identity, approval, and required capability against registry rows inside the writer-authorized replacement transaction before deleting existing preferences.
4. The AI policy response and strict membership-checked GET adapter endpoint expose only routing metadata, summary counts, and literal false credential/mutation/execution flags.
5. The AI settings registry panel shows registered, approved, available, and distinct-capability counts plus safe identity/status details; it provides no write control.
6. Migration-managed server administration remains the only registry mutation method in 0.64. Hosted credentials, health probes, administrator APIs, rate-card coupling, and provider calls are separate later boundaries.

### ADR-072 - Stored credentials do not make an adapter available

**Decision:** Store at most one workspace connection for each of the three closed hosted providers: OpenAI, Anthropic, and Google Generative AI. Encrypt every API key with AES-256-GCM and a server-only key that is separate from authentication and connector secrets. Saving or rotating a key always produces `unverified`; it does not create an adapter, change adapter availability, bind a rate card, or authorize execution.

**Rationale:** Possession of a syntactically valid secret does not prove that the provider accepts it, which account it represents, which models it may use, or whether spend and privacy policy permit a call. Keeping connection state separate from routing metadata prevents credential storage from becoming an accidental execution path.

**Consequence:** The browser can manage a deliberately narrow credential lifecycle without receiving ciphertext, fingerprints, or provider responses. A future provider-specific verifier must establish health before any registry integration. Revocation locks the connection row and irreversibly erases the ciphertext, fingerprint, and key version; replay returns the already-revoked record without duplicating the audit event.

## Release 0.65 hosted-provider connection flow

1. An authenticated workspace member can list a safe connection projection; only writers may save, rotate, or revoke credentials.
2. The strict save endpoint accepts one closed provider and a 20-through-4,096-character API key, validates the dedicated 32-byte base64 vault key, encrypts with an authenticated `v1` envelope, and computes a server-only SHA-256 fingerprint.
3. PostgreSQL upserts the workspace/provider row as `unverified`, clearing prior verification, error, and revocation evidence. Audit metadata records only provider, state, rotation, and literal false credential/execution flags.
4. Reads return status, configuration state, safe timestamps, and attribution only. The policy response similarly exposes safe connection state and never returns ciphertext, fingerprint, API key, token, or secret fields.
5. Revocation row-locks the record, nulls all stored credential material, sets `revoked`, and writes one minimized audit event. A replay is side-effect free.
6. Release 0.65 performs no provider request, verification, capability discovery, hosted adapter registration, rate-card linkage, reservation, generation, or settlement.

Migration 0059 creates `workspace_ai_provider_connection` with a workspace/provider primary key, closed providers and statuses, tenant-bound creator/updater membership foreign keys, bounded encrypted envelopes, lowercase SHA-256 fingerprints, `v1` key versions, cross-field state invariants, and a workspace/status updated-time index. Its immutable SHA-256 checksum is `f10ce5acb930dcc0bfe613225d960e223dea8ad02c09a818ff079b7b095f72e2`.

### ADR-073 - Credential verification is metadata authentication, not model execution

**Decision:** Verify a stored hosted-provider key only through one fixed official model-list endpoint for its closed provider. Decrypt immediately before the request, authenticate only in headers, reject redirects, abort after five seconds, discard the response body, and persist only `verified` or a redacted `error`. Never generate content, retain discovered models, or change the adapter registry during verification.

**Rationale:** A small authenticated metadata request can prove that a provider currently accepts the credential without incurring generation work or collecting provider catalog data. Fixed egress targets, response disposal, redacted outcomes, and a short timeout reduce SSRF, secret, data-retention, and availability risk. Verification still does not prove ongoing health, model entitlement, price, privacy suitability, or spend authority.

**Consequence:** A workspace writer can explicitly verify or reverify one stored key. The server fetches the encrypted target before network I/O and writes the result only when the fingerprint still matches, so a concurrent rotation or revocation makes the result stale and fails closed. `verified` remains connection evidence only; no hosted adapter becomes available or executable.

## Release 0.66 provider-verification flow

1. A writer invokes the strict provider verify route with only the workspace UUID; the provider comes from the closed URL segment and the client cannot submit a key, endpoint, model, timeout, or result.
2. The repository returns ciphertext and fingerprint only to the server verification boundary. The configured vault key decrypts the credential in memory immediately before the request.
3. OpenAI uses `GET https://api.openai.com/v1/models` with Bearer auth; Anthropic uses `GET https://api.anthropic.com/v1/models?limit=1` with `x-api-key` and `anthropic-version: 2023-06-01`; Google uses `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1` with `x-goog-api-key`.
4. Redirects fail, the request aborts after five seconds, no request body is sent, and every response body is canceled. Status is normalized to accepted, credential rejected, rate limited, provider unavailable, or unexpected response without retaining upstream text.
5. The result update requires the original SHA-256 fingerprint and a non-revoked row. Success writes `verified_at`; failure writes one bounded safe message. Audits exclude credentials and provider responses.
6. Verification makes no generation call, model record, capability claim, adapter mutation, rate-card binding, reservation, invocation, usage event, or settlement.
### ADR-074 - Discovered provider models are workspace-private inventory, not adapters

Verified-only discovery reads at most one mebibyte and 1,000 records from fixed official endpoints, normalizes minimal metadata, and replaces a workspace/provider snapshot under the original credential fingerprint. Missing records are retired, not deleted. Rotation/revocation retires active records. Raw responses, account/owner fields, capabilities, prices, and credentials are discarded; no record activates an adapter or execution.

### ADR-075 - Workspace evidence candidates are separate from the deployment adapter registry

**Decision:** Represent a reviewed hosted-model capability claim in `workspace_ai_adapter_candidate`, not in the global `ai_provider_adapter` registry. Bind every candidate to one exact workspace/provider/model inventory row and the credential fingerprint that discovered it. Permit workspace writers to submit; permit only owners and administrators to approve or reject. Keep `routingAvailable`, `adapterActivation`, and `execution` false in every API and domain projection, including after approval.

**Rationale:** The adapter registry is deployment-owned routing configuration shared by every workspace, while a discovered hosted model and its evidence are tenant-private and credential-specific. Promoting private model IDs or unverified capability claims into the global registry would cross tenant boundaries and could make approval an accidental execution grant. A separate state machine allows evidence review now while preserving a later, explicit deployment-registration boundary.

**Consequence:** Candidate approval records that an administrator reviewed evidence; it does not bind an endpoint, account, price, rate card, health state, spend reservation, or invocation implementation. Credential change/revocation and inventory disappearance retire pending or approved candidates. A future release must perform a separate deployment-governed registration step before routing can see a hosted adapter.

## Release 0.68 adapter-candidate governance flow

1. The AI settings server page loads member-authorized candidate projections and writer-only provider inventory. It never merges candidates into `listProviderAdapters()`.
2. A writer selects one active discovered model and submits a display name, a unique nonempty subset of `AI_CAPABILITIES`, closed quality/speed/cost values, bounded context limit, evidence reference, and lowercase evidence SHA-256.
3. `submitWorkspaceAdapterCandidate` row-locks and revalidates the active model, Verified connection, matching current fingerprint, context bound, and absence of a pending/approved duplicate. It then replaces normalized capabilities and writes minimized audit evidence in one transaction.
4. `decideWorkspaceAdapterCandidate` requires owner/administrator membership and a pending row. Approval repeats the current connection/model/fingerprint checks; approval and rejection retain reviewer, time, and bounded note.
5. Credential save, rotation, or revocation retires active inventory and pending/approved candidates. Inventory refresh retires candidates whose models disappeared. Retirement is aggregate-audited without model identifiers.
6. API/UI projections always state that routing, adapter activation, and execution are false. The deployment registry remains one independent global table and is neither inserted nor updated by this flow.

Migration 0061 adds `workspace_ai_adapter_candidate` and `workspace_ai_adapter_candidate_capability`. The candidate has a restrictive tenant/provider/model foreign key to inventory; submitter/reviewer are tenant-bound membership keys. Status is the closed `pending | approved | rejected | retired` state machine with cross-field reviewer/time/note/retirement checks. Cloud privacy and paid reservation are fixed true invariants. The immutable checksum is `ed5c24988e6132e6062a0611e95fe958cf98f571cf98334b0c5941171f5dbd60`.

### ADR-076 - Approved evidence enters tenant staging before any routing catalog

**Decision:** Copy an Approved, current workspace candidate into `workspace_ai_adapter_registration` as a tenant-scoped deployment-staging snapshot. Do not insert it into the global `ai_provider_adapter` registry and do not union registrations into routing. Registration and retirement require owner/administrator authority. All registration projections keep routing availability, adapter activation, and execution false.

**Rationale:** Candidate approval reviews claimed capability evidence, but executable provider integration also requires tenant credential binding, invocation implementation, rate evidence, health/staleness, spend authorization, and settlement. A durable staging layer preserves the reviewed snapshot and operational lifecycle without weakening the global deployment boundary or exposing one workspace's hosted model to another.

**Consequence:** Administrators can stage, retire, and re-stage current approved evidence. Credential/inventory drift retires both the candidate and its registration. A later release must explicitly configure an invocation adapter and establish availability before any tenant-scoped registration can participate in routing.

## Release 0.69 deployment-registration flow

1. The settings page loads tenant-authorized candidates and registrations separately from the global adapter registry.
2. An owner/administrator selects one Approved candidate. The repository row-locks candidate, model, and connection and repeats Verified, active-model, source-fingerprint, and state checks.
3. Registration copies the candidate's exact display name, routing classes, context limit, paid-reservation flag, fingerprint provenance, and normalized capabilities. A current duplicate fails; a retired record may be refreshed and re-registered.
4. Manual retirement requires an owner/administrator and a bounded trimmed reason. It retains the snapshot and attribution and writes minimized audit evidence.
5. Credential save/rotation/revocation retires every registered snapshot for that provider. Inventory replacement retires only registrations whose candidate became retired because its model disappeared.
6. API/UI responses remain tenant-scoped deployment staging with routing, activation, and execution false. The global registry, routing preferences, rate cards, reservations, and provider I/O remain untouched.

Migration 0062 adds `workspace_ai_adapter_registration` and its normalized capability child. Restrictive candidate, tenant/model, and membership foreign keys preserve lineage; `registered | retired` cross-field checks require retirement actor/reason/time together. The immutable checksum is `178efb02b65482d83a22da9ed2f5883a3ade07a9b9a526fa2f478a304e1b2be9`.

## Release 0.70 hosted pricing-evidence flow

Release 0.70 adds a tenant-scoped pricing-readiness layer between deployment staging and any future invocation design. An owner or administrator selects one currently Registered workspace adapter and one exact Approved rate card whose provider, model family, currency, and effective window match the registration. The server repeats registration, candidate, inventory, connection, fingerprint, and rate-card checks under transaction control; clients cannot submit prices, components, source evidence, provider/model identity, availability, or execution state.

`workspace_ai_adapter_rate_binding` stores the registration/rate-card relationship, currency, bound/retired lifecycle, source-hash snapshot, administrator attribution, and bounded retirement evidence. Rate components remain normalized in `ai_provider_rate_component` and are joined only into the safe read projection. One registration may have at most one lifecycle record per currency; a retired record can be rebound only after every current-evidence check succeeds again.

The read path derives `evidenceCurrent` and `pricingReady` on every request. Both require a bound record, a still-Registered staging record, an Approved rate card with the same retained source hash, and an effective half-open rate window. `routingAvailable`, `adapterActivation`, and `execution` are literal false values in the domain projection and API metadata, not inferred presentation states.

Manual pricing retirement is independent and reversible through re-binding. Registration retirement automatically retires every bound currency record. Credential rotation/revocation or inventory drift first retires the staging registration and therefore cascades pricing retirement. Aggregate automatic-retirement audits omit model IDs, rate-card IDs, source evidence, fingerprints, and components.

The pricing panel receives `effectiveRateCards`, registrations, and bindings as distinct collections. It performs presentation-only exact-match filtering for operator clarity; the repository remains authoritative. Bindings are never concatenated with `providerAdapters`, consulted by routing preferences, treated as availability, or used to create reservations or provider calls.

Future activation must add a separately reviewed invocation-adapter configuration, tenant endpoint/account binding, health and staleness observations, circuit breaking, routing visibility, spend preauthorization, response bounds, actual-usage reconciliation, settlement, and an emergency kill switch. Pricing evidence alone must never satisfy those prerequisites.

## Release 0.71 server-owned invocation-contract staging

Release 0.71 introduces a deployment-owned contract catalog and one tenant configuration row per registered adapter. The three seeded provider descriptors identify a versioned HTTPS/JSON transport, credential-injection mode, request/response schema versions, internal source reference/hash, and review time. Database constraints force `implementation_available = false`; the catalog describes reviewed wiring intent, not runnable code.

Configuration requires a current Registered adapter, Approved candidate, active inventory, Verified connection, matching fingerprints, a bound/effective source-current rate card, and an Approved contract for the exact provider. The browser submits only registration, pricing-binding, and contract UUIDs. Repository locking and restrictive tenant/provider/rate foreign keys remain authoritative.

`workspace_ai_adapter_invocation_binding` retains the contract hash snapshot, administrator attribution, configured/retired lifecycle, and bounded retirement evidence. A safe projection derives `configurationCurrent`; `implementationAvailable`, `healthReady`, `routingAvailable`, `adapterActivation`, and `execution` are literal false values.

Manual invocation retirement supports later reconfiguration. Pricing retirement automatically retires dependent configuration. Registration retirement, credential rotation/revocation, and inventory drift cascade through pricing to invocation staging. Reconfiguration must repeat every prerequisite check.

Invocation bindings remain separate from the global `ai_provider_adapter` registry and are not read by routing preferences, assistant readiness, cost quoting, reservation, provider networking, usage accounting, or settlement. Release 0.72 must add health/staleness evidence before availability or routing can even be considered.

## Release 0.72 provider-reachability evidence

Release 0.72 reuses the existing fixed, header-authenticated provider model-list request as a bounded non-generative reachability probe. The route decrypts a current tenant credential only in server memory, performs one five-second no-body/no-redirect/no-cache request, cancels and discards the response body, clears the local key reference, and records only a normalized outcome.

`workspace_ai_adapter_health_observation` is append-only. Each row binds an invocation configuration, provider, credential fingerprint, contract source hash, administrator, checked/expiry times, healthy/unhealthy status, and optional closed failure code/safe message. The latest observation is current only for five minutes, after the current configuration time, and while its fingerprint/hash still match.

`providerHealthEvidenceCurrent` can become true for a fresh healthy observation, but `healthReady` remains false because the invocation serializer/parser implementation is unavailable. Unhealthy evidence may be current evidence of failure; it never becomes readiness. Reconfiguration, expiry, credential drift, contract drift, pricing/registration retirement, or provider state changes invalidate the projection without rewriting history.

The health projection remains outside routing, activation, spend, provider generation, usage, and settlement. A future implementation-health release must separately validate runnable request/response code before combining reachability with availability.

## Release 0.73 bounded provider-native text codecs

`packages/connectors/src/ai-provider-codecs.ts` is a pure boundary module. `buildAiProviderTextRequest` converts one neutral, bounded text request into a fixed OpenAI Responses, Anthropic Messages, or Google `generateContent` body. It returns the separately validated model identity and body but cannot choose a URL, add headers, access a credential, perform network I/O, stream, attach media, or enable tools.

`parseAiProviderTextResponse` accepts JSON text rather than an already-parsed object so the one-mebibyte byte ceiling is enforced before allocation by JSON parsing. Provider-specific readers cap arrays and aggregate text under a 400,000-character ceiling; normalize only response ID, visible text, closed stop reason, and non-negative safe-integer token counts; ignore OpenAI reasoning items; and reject tool, function, executable-code, multi-candidate, mixed refusal/text, malformed, error, and non-final structures.

`AI_PROVIDER_TEXT_CODEC_CONTRACTS` is the readonly three-provider contract dictionary. `AI_PROVIDER_TEXT_CODEC_CONSTRAINTS` is the shared readonly tuple `non-streaming`, `no-tools`, `no-media`, `no-transport-authority`, `bounded-response`. Tests reconstruct each canonical descriptor and verify its SHA-256 against migration 0066.

Migration 0066 retires descriptor-only `contract-v1` rows and seeds Approved `contract-v2` rows with `codec_available=true`, `codec_version=text-codec-v1`, and the `text-request-v1`/`text-response-v1` schema pair. Existing v1 tenant bindings fail closed through retired contract status. `implementation_available`, `healthReady`, routing, activation, and execution remain false, and there is intentionally no generation route or transport component.

## Release 0.74 fixed provider text transport

`packages/connectors/src/ai-provider-transport.ts` is the internal network boundary around the pure codecs. `invokeAiProviderText` accepts the neutral codec request plus one server-side credential; it rebuilds the provider body itself, selects a closed provider URL/header policy, performs one JSON POST, reads one bounded success body, and delegates normalization to `parseAiProviderTextResponse`.

The endpoint map is code-owned: OpenAI `/v1/responses`, Anthropic `/v1/messages`, and Google `/v1beta/models/{encodedModel}:generateContent`. Model syntax is validated before URL construction. Authentication is header-only, redirects fail, caching is disabled, default timeout is 30 seconds, hard timeout maximum is 60 seconds, and the transport never retries.

HTTP errors are body-discarding closed outcomes: 401/403 credential rejection, 429 rate limit, 5xx provider unavailable, and all other statuses unexpected response. Successful responses require JSON content type and one-mebibyte declared/streamed bounds. Codec or decoding failures return one safe message without the key, request content, URL query secret, or raw response.

`AI_PROVIDER_TEXT_TRANSPORT_CONTRACTS` and `AI_PROVIDER_TEXT_TRANSPORT_CONSTRAINTS` are frozen canonical dictionaries with provider endpoint policy and `fixed-https-text-v1`; tests reconstruct and SHA-256 verify each descriptor. Migration 0067 retires v2 and seeds Approved v3 rows. This module is not referenced by a route, router, reservation, workflow, or UI action, so public execution remains absent.

## Release 0.75 internal implementation and health readiness

Migration 0068 separates code existence from public authority. The original Release 0.71 database constraint that forced `implementation_available=false` is replaced by an invariant permitting true only when the same contract row has codec and transport availability plus a valid implementation version. Approved v4 rows identify `hosted-text-implementation-v1`; v1-v3 are retained but retired.

The contract catalog's `implementationAvailable` now truthfully describes reviewed internal code. It does not describe workspace readiness, routing membership, API availability, spend authorization, or permission to call a provider. Contract projections therefore keep `healthReady=false` because health is tenant/configuration-specific.

Workspace binding `healthReady` is a derived conjunction: implementation available and `providerHealthEvidenceCurrent`. The latter already requires a configured binding, registered deployment, Approved candidate, active inventory, Verified same-fingerprint credential, bound current source-hashed pricing, Approved same-hash contract, and the latest healthy observation after configuration with matching credential/contract hashes and unexpired five-minute evidence.

The projection is recomputed on every read and stored nowhere. Reconfiguration makes older observations pre-configuration; expiry makes them stale; unhealthy status, credential/contract drift, or any lifecycle retirement fails the conjunction. Audit/API/UI surfaces distinguish internal implementation from readiness and retain literal false routing, adapter activation, and public execution.

## Release 0.76 durable text invocation-intent boundary

Migration 0069 introduces `workspace_ai_text_invocation_intent` as the durable boundary between planning/spend authorization and any future provider attempt. Each row belongs to one workspace and binds exactly one invocation configuration, one provider/model snapshot, one spend reservation, and that reservation's exact immutable cost quote. Composite foreign keys prevent cross-tenant or quote-swapped evidence.

`prepareWorkspaceTextInvocationIntent` runs under a writer-authorized transaction. It row-locks and rechecks the complete readiness chain: configured registration, Approved candidate, active inventory, Verified matching credential, current source-hashed price card, Approved implemented codec/transport contract, and latest healthy post-configuration unexpired observation. It also requires an unexpired reserved `generate_text` quote whose `assistant.*` feature, currency, maximum cost, and rate card match the binding.

The browser submits raw system/user text only to this preparation boundary. The repository validates the codec limits, computes SHA-256 evidence in memory, and stores no prompt text. The public `AiTextInvocationIntent` projection omits all hashes and credential evidence. A canonical request hash makes repeated workspace/idempotency-key preparation replay-safe and rejects payload substitution.

`authorizationCurrent` is a read-time conjunction over the retained snapshots and all live readiness, health, quote, and reservation evidence. Cancellation is an atomic local transition that marks the intent cancelled and releases a still-reserved hold. There is no attempt table, provider call, output, usage event, settlement, routing membership, or execution authority in this release.

## Release 0.77 exactly-once provider attempt boundary

`workspace_ai_text_invocation_attempt` gives each prepared intent at most one provider attempt. Claim commits before credential decryption or network access and repeats the complete tenant, deployment, credential, pricing, implementation, health, quote, reservation, expiry, and prompt-hash checks under row locks. Once claimed, an intent can never be claimed again.

The lifecycle is `claimed`, `succeeded`, `failed`, or `ambiguous`. A claim has a one-minute reconciliation deadline. A process crash can occur before or after provider I/O, so an expired claim becomes `ambiguous/claim_abandoned` and is never retried automatically. Request state is three-valued `not_sent`, `sent`, or `unknown`.

`executePreparedTextInvocation` is server-internal. It receives the original prompt again, claims and hash-verifies it, decrypts the current credential in memory, calls the fixed no-retry provider transport once, and finalizes. Decryption failure is known pre-request failure; every transport error is conservatively ambiguous because provider receipt cannot be disproved.

Finalization rechecks the full authorization conjunction after the await. Success after evidence drift or the claim deadline is discarded into ambiguity. Normal success persists only output/provider-ID hashes, bounded usage counters, and stop reason; raw output can return to the internal caller in memory but is absent from database, audit, API, and UI.

## Release 0.78 encrypted output and exact settlement boundary

Release 0.78 replaces the transient success return with a review-gated artifact. The internal executor encrypts provider text with the deployment AI vault key before it asks the repository to finalize. One database transaction then completes the attempt, inserts one `workspace_ai_text_output_artifact`, calculates reconciliation from the exact approved rate card, optionally inserts one linked `ai_usage_event`, settles the reservation, inserts one reconciliation row, and writes minimized audits. Any transaction failure rolls back the entire finalization.

Output artifacts begin as `pending_review`. Member list projections expose lineage, provider/model, status, character count, actors, timestamps, and literal safety flags but never ciphertext, plaintext, or output hashes. Only owner, administrator, or approver roles may obtain the private decrypt target, and the API decrypts server-side for an active review. `accepted` and `discarded` are terminal review states; acceptance does not create a Draft, publish content, route work, or grant workflow authority. Discarded artifacts cannot be decrypted through the read boundary.

Reconciliation uses the attempt token counters plus the exact source-hashed rate-card components already bound to the authorization chain. The existing `quoteAiCost` integer/BigInt calculation is reused with minimum equal to maximum actual units, preserving per-component and currency-minor-unit ceiling. Missing counters, unsupported non-request/non-token components, or calculated cost above the reserved maximum creates a `quarantined` row; the encrypted artifact remains reviewable and the reservation stays reserved for expiry/operator policy. A settled result creates exactly one attempt-linked usage event and resolves the reservation in the same transaction.

The general `settleSpend` entry point rejects every reservation already bound to a text intent, preventing an alternate client from bypassing exact reconciliation. The executor still has no public route and never returns provider output. Product access consists only of safe list, approver decrypt-for-review, and terminal review-decision APIs.

## Release 0.79 accepted-output Draft proposal boundary

An accepted output may now be attached exactly once to one current editable Draft version. `workspace_ai_text_draft_proposal` stores only workspace/artifact/Draft/source-version lineage, lifecycle attribution, and a terminal optional dismissal; plaintext remains in the encrypted output artifact.

Attachment locks the accepted artifact, Draft, and current version and requires writer authority plus `working` or `changes_requested` state. A unique artifact constraint prevents reuse across Drafts. The source version is immutable lineage; `sourceCurrent` is derived by comparing it with the Draft current version and editable lifecycle.

Writers may decrypt an attached proposal only while the accepted artifact, attached lifecycle, exact source version, and editable Draft remain current. The proposal is a review reference beside the existing evidence-preserving revision form. It cannot edit body/claims, create a version, submit approval, publish, route, or execute. Dismissal is terminal and retains minimized audit evidence.

## Release 0.80 evidence-preserving proposal application

Release 0.80 adds one author-controlled transition from an attached proposal to an immutable successor Draft version. The browser supplies only the final presentation values (`leadIn`, optional `callToAction`, `hashtags`, optional `altText`) and a bounded change note. It cannot supply body text, factual claims, evidence bindings, version identity/number, lifecycle state, provider output, or authority flags.

`applyWorkspaceTextDraftProposal` owns one transaction and row-locks the proposal, accepted artifact, Draft, and exact source version. It requires writer authority, `attached` lifecycle, accepted output, a still-current source version, and editable Draft/version states. The operation re-reads every evidence-backed fact and binding from the source version, reconstructs the body deterministically, reuses the Draft-format character ceiling, and creates exactly one `working` successor. The source becomes `superseded`; the Draft points to the successor; the proposal becomes terminal `applied` with actor, time, note, successor ID, and the exact changed-field tuple.

The output text remains a review reference and is never parsed or inserted as a body. `presentation_choices.aiTextDraftProposalId` records lineage, while factual claim text and evidence IDs are copied from governed source records. An optional author-selected call to action becomes the only presentation-only claim. The normal Draft submission and approval path remains mandatory, and application grants no preview, publishing, routing, provider, workflow, or execution authority.

Applied proposals are replay-safe and cannot be decrypted, dismissed, or applied into a second version. Stale and dismissed proposals fail closed. Safe projections expose application metadata and `draftContentMutated=true` only for the applied terminal state; ciphertext and plaintext remain excluded.

## Release 0.81 AI execution stop and circuit boundary

Provider execution now requires three independent gates: deployment configuration, one active workspace control window, and a closed workspace/provider circuit. `AI_PROVIDER_EXECUTION_ENABLED` is read only by server configuration and defaults false. `workspace_ai_execution_control` is absent-by-default and therefore projects stopped; only an owner or administrator can create an enablement lasting 1 through 1,440 minutes or issue an immediate stop with a bounded reason.

Claim and completion join and row-lock the control record. This gives stop, claim, and finalization one database serialization point: a claim that linearizes first may proceed, but a later stop prevents its output from being accepted at finalization; a stop that linearizes first prevents the claim. Nominal success after a stop becomes `ambiguous/evidence_changed`, with no artifact, usage event, settlement, or provider-output projection.

`workspace_ai_provider_circuit` stores one row per workspace and hosted provider. Success closes the circuit and resets its counter. `credential_unavailable` opens immediately; `provider_outcome_unknown` and `claim_abandoned` increment a consecutive counter and open at three. Evidence drift does not blame the provider. Open circuits have no automatic half-open state and block claims until an owner/administrator records a reset note. Circuit state changes and resets are audited without prompts, credentials, output, or provider response identifiers.

The AI settings surface composes deployment, workspace, circuit, and effective states but exposes no secret. Its API routes are administrative control-plane operations, not an execution route. The internal executor additionally checks the deployment flag before claim, preserving defense in depth for any future product caller.

## Release 0.82 reviewed incident-resolution architecture

Migration `0075_ai_text_invocation_resolutions.sql` adds an append-only decision record after the provider-attempt and reconciliation boundaries. `workspace_ai_text_invocation_resolution` is one-to-one with an attempt and its reservation, optionally binds the attempt's quarantine row, and preserves actor, reviewed evidence, exact external charge, and reservation transition. It neither edits the attempt nor manufactures a usage event.

The resolution transaction locks the attempt, intent, reservation, optional reconciliation, and any existing resolution. Eligibility is deliberately narrow: an unresolved ambiguous attempt, or a succeeded attempt whose reconciliation remains quarantined. Replay returns the existing row regardless of a second payload; conflicting instructions cannot rewrite the original decision.

`settled_provider_charge` consumes an exact provider-statement amount and settles the reservation at that amount. `confirmed_no_charge` releases an active reservation, expires an already expired hold, or closes a hold already released/expired. Neither path calls the provider, resets a circuit, or claims an attempt.

Reporting unions reviewed statement charges with ordinary usage events. They contribute exact cost and one request while token and latency measures remain absent; budget aggregates use the same union. Quarantined reconciliation derives `reservationSettled=true` from a settled resolution while preserving `usageRecorded=false`.

The application boundary consists of a membership-scoped list endpoint and reviewer-scoped mutation endpoint. AI settings renders safe incident context, an explicit two-disposition form, and immutable history. Evidence references and notes are retained for authorized review but excluded from minimized audit payloads.

No mutable global state is added. Release 0.82 adds persistent evidence and pure projections around existing transactions; execution remains governed by the Release 0.81 deployment flag, timed workspace control, and provider circuit. Rollback to 0.81 retains migration 0075 but must disable resolution and reviewed-charge reporting surfaces until 0.82 is restored.

## Release 0.83 derived operational-readiness architecture

The operational incident view is a derived union over authoritative source records rather than a duplicated incident lifecycle. It contains each currently open provider circuit, each unresolved ambiguous attempt, a claimed attempt whose reconciliation deadline has elapsed, and each unresolved quarantined reconciliation. Circuit reset or Release 0.82 resolution removes the condition from the active projection while source evidence remains retained.

Migration `0076_ai_operational_incident_acknowledgements.sql` stores only reviewer ownership evidence. Its composite key is workspace, incident type, and attempt; provider and optional reconciliation lineage, source-observed time, bounded note, reviewer, and timestamps make each acknowledgement attributable and replay-safe. Reopened circuits use the newly opening attempt and therefore cannot inherit stale acknowledgement.

`listWorkspaceAiOperationalIncidents` assigns closed summaries and severity without reading prompt, output, credential, response, hash, or price material. Credential-unavailable circuit opens are critical; other open circuits, ambiguity/overdue claims, and quarantine are high. `getWorkspaceAiOperationalReadiness` reduces the active set to counts, oldest time, `ready|attention|blocked`, and a conservative execution-stop recommendation.

Acknowledgement locks the attempt plus optional reconciliation or circuit row, then re-derives activity before insert. This serializes it against incident resolution and circuit reset. Unique insertion makes concurrent/repeated acknowledgement return the first record; acknowledgement never changes source status and never grants execution authority.

Three authenticated routes expose active incident list, acknowledgement, and observation-only readiness. AI settings renders the same server projection. The readiness response declares `externalAlertDeliveryConfigured=false` and `publicExecutionRouteAvailable=false`; it is an operator/monitoring signal, not a provider-call gate or external paging implementation.

No mutable global collection or timer is introduced. Time-sensitive overdue-claim derivation receives an explicit `asOf` value. Rollback to 0.82 retains migration 0076 but disables its API/UI; Release 0.81 execution controls remain the authoritative stop boundary.

## Release 0.84 incident-response policy and deadlines

Migration `0077_ai_operational_incident_response_policy.sql` adds one optional administrative policy per workspace. It stores separate critical/high acknowledgement and resolution minutes, one credential-free HTTPS runbook URL, creation/update actors, and timestamps. Database ordering ensures resolution cannot precede acknowledgement.

Absence is a fail-safe documented value rather than an error: critical acknowledgement/resolution default to 5/60 minutes and high to 30/240. `DEFAULT_AI_OPERATIONAL_INCIDENT_RESPONSE_POLICY` is an immutable server constant; the optional row overrides it only after owner/administrator validation.

Incident projection combines source-open time, closed severity, effective policy, acknowledgement time, and explicit `asOf` to derive acknowledgement/resolution deadlines and within-target, overdue, or late response state. No background timer or stored mutable incident deadline exists, preventing stale derived rows after policy changes.

Readiness reduces those fields into acknowledgement-overdue, acknowledgement-late, and resolution-overdue counts plus the next due time. Critical/unacknowledged/late/resolution-overdue evidence is blocked; acknowledged noncritical work within target is attention. These are operational signals only and do not replace the Release 0.81 execution gates.

The policy GET/PUT and UI form are separate from acknowledgement and source resolution. Market Me validates and displays the HTTPS runbook but never fetches it, preventing server-side request behavior. Policy audits record numeric targets and runbook presence, not its URL.

Rollback to 0.83 retains migration 0077 and policy rows but uses default 0.83 behavior. Disable the policy surface and keep execution stopped until 0.84 restores configured deadline projection.

## Release 0.85 verified operational alert delivery

Migration `0078_ai_operational_alert_webhook.sql` separates one workspace webhook configuration from a durable delivery outbox. Configuration stores the full endpoint and an AES-GCM envelope for the HMAC secret only on the server, while member-facing projections reveal only the endpoint origin, status, safe error, test timestamps, and Booleans. Outbox rows retain a stable UUID event ID, exact incident lineage, safe closed payload, attempt state, lease, response status, and bounded error.

Configuration follows `unverified -> verified|error` and explicit `disabled`. Saving or rotating either endpoint/secret always resets verification. The verify route decrypts the secret and sends one signed, non-incident test payload; only a 2xx result records `verified`. Optimistic secret-fingerprint matching prevents a stale verification result from enabling a concurrently rotated configuration.

The transport is provider-neutral HTTPS POST with `content-type`, stable `idempotency-key`/`x-market-me-event-id`, ISO `x-market-me-timestamp`, and `x-market-me-signature: v1=<hex HMAC-SHA-256(timestamp + "." + rawBody)>`. It never follows redirects, never accepts caller headers/body, cancels response bodies, and classifies 408/425/429/5xx or uncertain network outcomes as retryable.

`AiRepository.enqueueAiOperationalAlertEvents` projects opened, acknowledged, acknowledgement-overdue, resolution-overdue, and resolved transitions from authoritative incidents. A uniqueness key on workspace/type/attempt/event makes scanning replay-safe. `claimAiOperationalAlertDeliveries` uses `FOR UPDATE SKIP LOCKED`, a five-minute lease, verified-config join, and at most five attempts. Retries retain the same event ID so receivers can deduplicate.

The worker runs alert projection and delivery after existing content processing only when both deployment key and allowlist exist. Exact hostname allowlisting plus credential/port/query/fragment rejection bounds outbound destinations. Alerts never call an AI provider, retry an AI invocation, alter incident source state, or bypass Release 0.81 execution controls.

Rollback to 0.84 retains migration 0078, encrypted configuration, and outbox evidence while disabling the 0.85 routes, UI, and worker service. Disable configured webhooks before rollback when practical; do not drop delivery evidence. Forward-deploy 0.85 to resume verified pending/failed delivery with the same event IDs.

## Release 0.86 exact prepared-intent execution boundary

Release 0.86 exposes the existing internal executor through one authenticated, tenant-scoped route for an exact already-prepared text invocation intent. It is not a generic provider proxy: the path and strict body identify one intent and resubmit the original bounded prompt so the server can reproduce its private hashes before any provider I/O.

The route requires workspace write authority, a valid server-only AI provider credential/output vault key, the deployment execution flag, an unexpired workspace enablement window, a closed provider circuit, the intent's current implementation/credential/health/rate evidence, and its active exact quote reservation. The repository inserts the intent's only provider-attempt claim before transport, then the executor decrypts the credential into request-scoped memory and performs exactly one fixed, no-retry call.

Known pre-request credential decryption failure becomes `credential_unavailable`, releases the hold through the reviewed safe path, and opens the circuit immediately. Once transport begins, an uncertain network outcome is `provider_outcome_unknown`: it is ambiguous, non-retryable, retains the hold for reviewed resolution, and enters the operational incident/alert projections. A deployment/workspace stop or evidence change before finalization also discards nominal output as non-retryable ambiguity.

Success encrypts output before the atomic attempt/reconciliation/settlement transaction. The response returns only the safe attempt plus literal metadata: whether a request was attempted, `providerRequestRetried:false`, `outputReturned:false`, whether output is encrypted, whether settlement completed, and `publishingAuthority:false`. Plaintext output, credentials, hashes, provider response identifiers, and private pricing evidence never cross the route.

AI settings supports preparing only, preparing then executing once, or executing an already-prepared intent against the exact prompt still present in the operator's fields. The preparation endpoint does not retain plaintext, so a later execution requires re-entry. Successful output still enters encrypted human review, optional accepted-output Draft attachment, explicit evidence-preserving proposal application, and the ordinary Draft submission/approval/publication workflow.

Release 0.86 adds no migration or mutable global state. It composes migrations 0069-0075 with the execution, incident, policy, and alert safeguards in 0074-0078. Rollback to 0.85 removes/disables the execute route and buttons while retaining all attempt, encrypted-output, reconciliation, resolution, incident, and outbox evidence; cancel or release only unclaimed eligible reservations/intents and never retry an ambiguous attempt.

## Release 0.87 Draft-bound revision architecture

Release 0.87 moves provider assistance from an operator-authored raw prompt into the governed Draft workflow. The product command identifies an exact editable Draft, one of four closed presentation goals, a healthy implementation, and an existing `assistant.prepare_copy` reservation. Market Me—not the browser—loads the immutable current version, Campaign/package/audience lineage, presentation fields, claims, evidence bindings, and retained evidence snapshot.

`selectDraftRevisionPrompt` canonicalizes that context with deterministic claim order, sorted evidence IDs, sorted evidence records, and sorted source references. It creates a fixed `draft-revision-v1` system instruction and user prompt that permits presentation suggestions only. The canonical context SHA-256, source Draft/version, goal, and prompt version are persisted on the existing intent; prompt text remains transient and is reproducible from immutable relational evidence.

Migration `0079_ai_draft_revision_intents.sql` extends invocation intents rather than introducing a second attempt lifecycle. All five source columns are either absent together for a generic intent or present together for a product-bound intent. Tenant/Draft/version foreign keys, a closed goal check, prompt-version bound, lowercase SHA-256 check, and source-Draft index preserve exact lineage.

Preparation reads the product source, then the existing intent transaction locks and reconstructs it again before storing hashes. Execution reconstructs once more and compares prompt version, context hash, and both prompt hashes before the existing claim path. The claim additionally requires the exact source version to remain the current editable version and the quote feature to remain `assistant.prepare_copy`; Draft edits or lifecycle changes therefore invalidate unused execution authority.

The Draft page owns prepare, prepare-and-execute, later exact execution, and cancellation controls without exposing raw system/user text. The generic AI-settings executor hides its raw-prompt action for product-bound intents. Accepted output from a product-bound intent can attach only to the bound Draft while that same source version remains current; application still permits only the Release 0.80 presentation fields and creates an evidence-preserving successor.

No new provider transport, retry path, output plaintext response, Draft mutation, approval, workflow, routing, or publishing authority is introduced. Rollback to 0.86 retains migration 0079 and its source evidence, disables the two product routes and Draft panel, keeps execution stopped, and cancels only unclaimed product intents through the existing boundary. Never execute a Draft-bound intent by substituting a raw prompt or retry a claimed/ambiguous attempt.

## Release 0.88 in-context authorization architecture

Release 0.88 moves the already-governed prepare-copy quotation and reservation handoff onto the exact Draft page. It introduces no new pricing, budget, or provider boundary. The client first calls the existing action-specific assistant quote route with `workspaceId`, closed action `prepare_copy`, and the selected healthy binding's exact `rateCardId`; it then binds the returned durable quote through the existing reservation route using a new UUID idempotency key.

`AiWorkspaceAdapterInvocationBinding.rateCardId` is a safe identifier projection from the binding's current rate evidence. The database selector obtains it from `workspace_ai_adapter_rate_binding.rate_card_id`; it is not a price, credential, routing decision, or reservation authority. The assistant quote repository still verifies workspace policy, assignment, action envelope, binding/routing compatibility, current effective card, currency, and normalized rate components independently of the browser selection.

Quote creation and maximum reservation remain two durable operations. If the quote succeeds but budget reservation fails, the quote remains a harmless ledger record and the UI reports that it was not reserved. A successful reservation is added to local Draft-panel state and selected immediately, allowing the existing Release 0.87 prepare or prepare-and-execute command to consume its exact ID. Neither operation contacts a provider; execution remains a later, separately gated one-shot boundary.

The full AI settings ledger remains the operator view for quote/reservation history and cleanup. The Draft page is a focused orchestration surface only: server routes and repository transactions continue to own authorization, budget serialization, idempotency, provider-currentness, intent preparation, and execution decisions.

Rollback to 0.87 removes the `rateCardId` safe projection and Draft-page quote/reserve control while retaining all quotes, reservations, audit records, and migration 0079. Unreserved quotes may expire normally. Active reservations must be consumed, cancelled, or expired through their existing lifecycle; rollback must not delete or infer-release them.

## Release 0.89 in-context encrypted output review architecture

Release 0.89 composes the existing encrypted artifact, approver review, and Draft proposal boundaries on the exact Draft page. The server-rendered page loads only `AiTextOutputArtifact` safe projections and the Draft's existing proposals. `AiDraftRevisionOutputs` filters those projections to product-bound artifacts whose `sourceContentDraftId` equals the page Draft; output plaintext and ciphertext remain absent from server-rendered props.

An approver opens one artifact through the existing GET `/api/v1/ai-text-outputs/[id]` boundary. That route reauthorizes approve access, requires a valid AI vault, obtains the tenant artifact read target, decrypts in request memory, and returns plaintext only for the active review. Accept/discard uses the existing immutable review transaction and requires a note. The client clears its transient plaintext whenever review completes, attachment completes, or the reviewer closes the view.

An accepted artifact attaches through the existing writer-only POST `/api/v1/ai-text-outputs/[id]/attach-draft` boundary. The Draft ID comes from the current page rather than a browser-selectable target. Repository locking still proves the artifact is accepted, source-bound to this Draft when product-bound, not already attached elsewhere, and tied to the exact current editable source version before creating a read-only proposal.

The existing `AiTextDraftProposals` component remains the next stage on the same page. It decrypts an attached proposal only when opened by an authorized author and accepts explicit presentation fields; the repository reconstructs factual content from evidence into an immutable successor. Review, attachment, and application remain three independent operations with no direct provider, approval, workflow, or publishing authority.

Rollback to 0.88 removes the Draft-local artifact fetch/component and restores the guidance to use the central AI settings ledger. It retains every encrypted artifact, review, proposal, audit, attempt, reconciliation, reservation, and migration. No schema rollback or plaintext transformation is permitted.

## Release 0.90 structured presentation-suggestion architecture

Release 0.90 versions the product prompt rather than changing an existing stored contract. New Draft revision intents use `draft-revision-v2`; execution reconstruction reads each intent's persisted prompt version and can still reproduce `draft-revision-v1` byte-for-byte. The v2 system instruction requires exactly one JSON object with schema `draft-revision-suggestion-v1`, optional `leadIn`, `callToAction`, `hashtags`, and `altText`, plus required `rationale`. Headline, body, facts, evidence, approval, publishing, markdown, and arbitrary keys are forbidden.

`parseAiDraftRevisionPresentationSuggestion` is a pure domain boundary over already-decrypted reviewed output. It accepts a raw JSON object or one exact JSON code fence, enforces the artifact-size ceiling, closed keys/version, trimmed field bounds, punctuation-free lead-in, and unique hashtag syntax, and returns `valid|unavailable` with literal false mutation/publishing authority. Invalid output remains visible as reviewed free text but cannot prefill controls.

The proposal read API parses only outputs whose persisted intent version is `draft-revision-v2`; older proposals return a safe unavailable reason. The author UI selects zero fields by default. Checkboxes are rendered only for validated present fields, and `Fill selected suggestions` copies only checked values into the existing editable form. A second explicit apply action and required change note remain necessary; the repository still reconstructs the factual body from evidence.

Rollback to 0.89 stops creating v2 intents and removes parser/prefill UI while retaining all v2 intent hashes, encrypted output, reviews, and proposals. Deployed code that may execute prepared v2 intents must retain v2 reconstruction support; never reinterpret a v2 hash with v1 instructions.

## Release 0.98 exact Campaign asset-rights architecture

Release 0.98 introduces a second-stage rights authority between reusable Content Package approval and outbound Campaign execution. Package approval intentionally does not require a Campaign grant because no Campaign may exist yet and Campaign creation itself requires an approved package. After Campaign creation, a writer revisits the package and grants one or more exact Campaign IDs before any image attachment can enter a preview.

`content_asset_rights_campaign` is the normalized many-to-many authority relation. Its composite primary key prevents duplicates; the reverse Campaign index supports lifecycle checks. The asset foreign key cascades because rights are owned by the asset. The Campaign foreign key is deferrable `NO ACTION`, preserving standalone deletion protection while allowing a complete workspace cascade to settle without ordering failure.

`draft_channel_preview_asset.rights_campaign_id` snapshots the exact Campaign at preview creation. A cleared snapshot requires positive rights revision, reviewer/time evidence, exact Channel Connection, and exact Campaign. Migration 0087 resets old cleared preview snapshots to unchecked because they cannot prove Campaign authority.

The repository deduplicates and validates `permittedCampaignIds` in the rights-review transaction, replaces the relation, and increments the source original's monotonic revision. Derivatives never own grants; all reads resolve the effective original. Campaign names/statuses are hydrated only for display and are not copied into authority or snapshot rows.

Preview creation derives Campaign identity from the server-owned draft rather than a client field. Both preview projections compare the snapshot with current source Campaign lineage and require a live authority row. Campaign activation, publishing-target resolution, and worker attachment loading repeat the same check independently. The worker checks Campaign identity before object-store reads, publication-action creation, credential handling, or provider I/O.

Rollback retains migration 0087. Code without Campaign-grant awareness must not execute image attachments; a safe rollback disables that outbound path until compatible code returns.

## Release 0.99 exact Brand Profile asset-rights architecture

Release 0.99 adds Brand identity as a third independent outbound authority after publishing account and Campaign. The grant targets `brand_profile`, the stable identity root, rather than `brand_profile_version`. A Campaign may therefore adopt a newly published version of the same Brand Profile without re-licensing, while switching to another Brand root or becoming unbranded invalidates image authority.

`content_asset_rights_brand_profile` is the normalized many-to-many relation. Its composite primary key prevents duplicates; the reverse index supports lifecycle checks. Asset deletion cascades. The Brand foreign key is deferrable `NO ACTION`, which blocks standalone deletion while referenced but allows a full workspace cascade to settle atomically.

`draft_channel_preview_asset.rights_brand_profile_id` snapshots the stable Brand root resolved from the exact Campaign version used for Draft generation. A cleared snapshot now requires positive rights/reviewer evidence plus exact Channel Connection, Campaign, and Brand IDs. Migration 0088 resets old cleared snapshots because they cannot prove Brand authority.

Rights review validates same-workspace Brand roots and transactionally replaces the relation with the account and Campaign scopes. The Content Package page loads published Brand roots as credential-free ID/name/status options. Names are display-only; IDs and repository checks remain authoritative.

Preview creation resolves `campaign_version.brand_profile_version_id -> brand_profile_version.brand_profile_id`. Both preview projections repeat that derivation. Activation compares against the current published Campaign version, so a post-preview cross-Brand edit fails. Publishing-target hydration and the workflow worker carry and compare `brandProfileId` before media access or provider I/O.

There is no wildcard or inferred Brand. A Campaign without a Brand may operate without attachments, but governed image attachments remain blocked. Rollback retains migration 0088 and disables the outbound image path for Brand-unaware code.

## Release 0.91 approved conversation-retention erasure architecture

Release 0.91 supersedes the Release 0.48 preview-only execution limitation for one narrow aggregate: an exact eligible `conversation_thread` and records owned by it through tenant-scoped cascading foreign keys. It does not treat relationship, Campaign, Destination, Brand, account, publication, workspace, AI, workflow, object, provider, analytics, log, export, or backup data as owned by that conversation.

`conversation_retention_erasure_request` is a durable governance ledger rather than a deletion queue worker. It deliberately stores `conversation_thread_id` as an unreferenced UUID so execution may delete the thread while preserving decision evidence. One partial unique index serializes a pending request per workspace/thread. Closed status checks enforce `pending -> executed|rejected`; request/decision actors reference same-workspace membership, and a database check plus repository check prohibits self-decision.

The request path requires write authority and locks the enabled policy followed by the exact thread. It accepts only a resolved/archived, non-held thread whose class-specific eligibility time has passed. Duplicate requests under the same thread lock return the existing pending row rather than creating competing approvals.

The decision path first locks one pending request and requires approval authority. Rejection changes only the ledger. Execution then locks and rederives policy/thread eligibility and compares the current explicit class and eligible timestamp to the request snapshot. Legal hold, reopening, policy disablement, a changed window/class, future eligibility, tenant drift, or missing content aborts the transaction without partial deletion.

After validation, the transaction counts each dependent table, deletes the exact tenant-bound thread, relies on reviewed foreign-key cascades for its message/history/composer/review children, marks the request executed with aggregate counts, and writes a minimized audit event. No subject, relationship label, message body, internal note, provider payload, identity, or credential is copied to the retained ledger or audit dictionary. The browser confirmation and disabled state improve usability but grant no authority; route and repository checks remain authoritative.

This release intentionally has no timer, background worker, automatic or bulk purge, provider call, export, object deletion, Temporal cleanup, backup mutation, or restore command. Rollback removes the routes/UI while retaining migration 0080 and all governance evidence; it cannot reverse an executed erasure and must not infer or fabricate deleted content.

## Release 0.92 legal-hold case architecture

Release 0.92 makes legal hold a governed case lifecycle instead of a directly selectable retention class. `setRetentionClass` accepts only `standard`, `personal_message`, or `imported_email`; it rejects both placement into and removal from `legal_hold`. `placeLegalHold`, `requestLegalHoldRelease`, and `decideLegalHoldRelease` are the only supported mutation boundaries.

Migration 0081 adds `conversation_legal_hold_case` and `conversation_legal_hold_release_request`. Cases retain the previous non-hold class, bounded reason, optional case reference, placement actor/time, state, and optional approved-release evidence. Release requests retain one target non-hold class, bounded request/decision notes, actors/times, and `pending|approved|rejected`. A composite foreign key binds every request to the exact hold/workspace/thread tuple. Partial unique indexes allow one active hold per thread and one pending release per hold.

Thread IDs in both governance tables are intentionally scalar rather than content foreign keys. A released hold and its decision history therefore survive a later approved conversation erasure. Same-workspace actor foreign keys, closed-state checks, and requester/decider separation remain database-enforced. Audit dictionaries contain IDs, closed classes, and presence flags only; case narrative and notes remain in the access-controlled governance tables rather than general audit projections.

Placement locks the exact thread, returns an exact active retry, stores the case, sets `legal_hold`, increments `retention_revision`, and audits in one transaction. Release request locks the active case and thread and creates or returns one pending request. Decision locks request, case, and thread; rejection closes only the request, while approval closes both records, restores the requested non-hold class, increments the revision again, and audits atomically.

`conversation_thread.retention_revision` is a monotonic invalidation counter, not a displayed version. `conversation_retention_erasure_request.thread_retention_revision` snapshots it. Erasure execution compares class, computed eligibility, and revision. A temporary hold therefore permanently stales the old approval even if release restores the identical class and timestamp. Eligibility also queries for an active case as defense in depth if stored class and case state ever drift.

The three strict POST routes repeat permission checks before repository enforcement. The server-rendered page loads at most 100 cases and 100 release requests for the exact thread. React state (`retentionClass`, `reason`, `caseReference`, `requestNote`, `decisionNote`, `pending`, `error`) is component-local convenience only; no global mutable store, timer, batch, or background release exists.

## Release 0.93 workspace legal-hold operations projection

Release 0.93 adds no persistence or new mutation authority. `listActiveLegalHolds(workspaceId)` and `listPendingLegalHoldReleaseRequests(workspaceId)` are bounded read projections over the immutable 0.92 ledgers. Each left-joins the current thread and relationship solely to hydrate optional navigation labels; erased or unavailable content naturally produces absent labels rather than copied governance data.

The Conversations Server Component loads both lists in its existing parallel read batch only for owner, administrator, editor, or approver roles. The retention-policy GET uses the same rule and returns empty arrays plus zero counts to analysts and viewers. This avoids broadening case-reason/reference visibility from exact-thread access to a workspace-wide read-only feed.

`ConversationRetentionPolicy` merges pending releases into active holds by `legalHoldCaseId`. The queue renders one card per active hold, an exact thread link, and pending target/requester evidence. It calls the existing 0.92 decision route; no duplicate server mutation path exists. Approval confirmation is usability-only, and repository role/separation/lock checks remain authoritative.

## Release 0.94 recent legal-hold decision projection

`ConversationRepository.listRecentLegalHoldReleaseDecisions(workspaceId)` is a read-only projection over the existing release-request ledger. It filters to the closed `approved|rejected` states, orders by `decided_at DESC, id`, and caps the database result at 200. Migration 0082 supplies the matching partial workspace/decision-time index so the bounded result does not require sorting the full historical ledger as a workspace grows.

The server-rendered Conversations page loads active holds, pending releases, and recent decisions in the same parallel read batch only when the role is owner, administrator, editor, or approver. The retention-policy GET mirrors this topology and adds `recentLegalHoldReleaseDecisions` plus `recentLegalHoldReleaseDecisionCount`. Analyst and viewer branches resolve an empty array and never call the repository method.

The component renders at most the first 20 already-newest records. It includes request/decision rationale and actor/time evidence but no control. `request.subject` doubles as a live-thread availability signal because the label join is absent after source erasure; the thread link is omitted in that state. There is no new route, status transition, background job, notification, mutable singleton, or client authority.

The workspace queries cap results at 200. `activeLegalHolds`, `legalHoldReleaseRequests`, and component-local note/pending dictionaries are request/render state rather than durable queues. There is no search index, cursor, notification worker, unread store, assignment, auto-release, or released-history aggregation.

## Release 0.95 publication-rights governance architecture

Rights authority lives on an original image `content_asset`; a derivative resolves its effective decision through `source_asset_id`. Migration 0083 adds review evidence, channel scope, validity windows, reviewer identity/time, and a monotonic `rights_revision`. It revokes legacy bare `cleared` rows to `unchecked` because a status without evidence cannot authorize publication. The database accepts `cleared` only for original images with owner/source/proof, affirmative worldwide commercial and derivative permission, at least one channel, no unsupported attribution/watermark/disclaimer obligation, a bounded review note, reviewer, timestamp, and positive revision.

`reviewAssetRights` is the sole application write boundary. It locks and updates one tenant-bound original image, increments its revision, records the actor and current time, and emits a minimized audit dictionary without owner, evidence references, or narrative. Hydration exposes a current effective state: a future clearance is `restricted`, an elapsed one is `expired`, and every derivative inherits the source review.

Package approval and new channel-preview creation fail closed on current clearance. A preview stores `rights_status`, `rights_revision`, `rights_reviewed_at`, and optional expiry beside the immutable media snapshot. Draft/campaign preview projections mark that preview stale when the live original revision, state, validity window, or provider scope differs. Campaign activation and `PublishingRepository.getCampaignExecutionTarget` repeat the live comparison; the workflow worker then checks the snapshotted status/revision/review/expiry once more before reading media or invoking a provider.

The current executable rights-channel set contains only `discord_webhook`. Attribution, watermark, and disclaimer obligations deliberately force `restricted` until a future execution gate can prove them. There is no timer, rights crawler, license parser, global mutable registry, automatic renewal, external rights service, or background status rewrite; current time is evaluated at each governed boundary.

## Release 0.96 malware scanning architecture

`ClamAvInstreamScanner` implements clamd's NUL-framed `zINSTREAM` protocol over a bounded TCP connection. It sends 64 KiB chunks, each prefixed with a four-byte network-order length, finishes with a zero-length chunk, caps replies at 16 KiB, and maps only exact `stream: OK` and `stream: <signature> FOUND` verdicts. Timeouts, socket failures, oversized/malformed replies, and daemon errors become `failed`, never `clean`.

`MediaProcessor` validates size/MIME, scans the source bytes, rejects `infected`, then writes the immutable original. One scan outcome supplies the original and deterministic derivatives with `scanStatus`, `scanEngine`, `scanScannedAt`, and `scanRevision`. The default unconfigured scanner remains explicit for development ingestion but supplies revision zero and cannot authorize outbound media.

Migration 0084 adds scan engine/time/revision evidence to `content_asset` and revision/time to `draft_channel_preview_asset`. It revokes legacy evidence-free `clean` flags to `not_configured`; database checks make future `clean` rows require engine, time, and a positive revision. Package approval checks original images. Preview creation resolves derivative scan authority through the original and snapshots it. Preview projections, Campaign activation, and publishing-target hydration compare live source status/revision/time; the worker checks the snapshot again before object-store reads or provider I/O.

The local ClamAV Docker profile pins 1.5.3, persists signatures, and publishes port 3310 only on `127.0.0.1`. clamd TCP is intentionally treated as trusted local infrastructure because it provides neither authentication nor transport encryption. Production deployment requires private service networking, resource limits, signature-update monitoring, health alerts, and an explicit failure/retry runbook.

## Release 0.97 exact publishing-account rights architecture

Provider permission and account permission are separate authorities. `content_asset.rights_permitted_channels` continues to identify supported provider kinds, while `content_asset_rights_channel_connection` is the normalized many-to-many relation that names exact workspace publishing accounts. Its composite primary key deduplicates scope, the asset foreign key cascades with asset lifecycle, and the deferred connection foreign key prevents deleting an in-use account while permitting an enclosing workspace deletion to complete atomically.

`MarketMeRepository.reviewAssetRights` owns the write transaction. It deduplicates `permittedChannelConnectionIds`, requires at least one for `cleared`, proves every connection belongs to the request workspace and matches a permitted provider, updates the review and monotonic revision, replaces all account-scope rows, and writes a minimized audit count. Hydration resolves derivatives through the source original and projects the ordered IDs as `rightsPermittedChannelConnectionIds`.

Preview creation checks provider and exact connection membership before it stores any attachment snapshot. `draft_channel_preview_asset.rights_channel_connection_id` records which account the clearance authorized. Stale-preview projections, Campaign activation, and publication-target selection compare that snapshot with `preview.channel_connection_id` and independently require the live original-to-connection relation. This detects revision changes, direct relation changes, and account substitution.

The workflow worker performs the last defense-in-depth comparison before object-store reads: every attachment snapshot must have `rightsChannelConnectionId === target.connection.id`. Publication request snapshots retain that scalar account ID with rights/scan evidence. No global rights matrix, account alias cache, background entitlement synchronizer, or client-side authority is introduced.

## Release 1.0 production identity architecture

Market Me remains the session issuer and authorization authority while delegating primary authentication to one OpenID Connect issuer. `/api/auth/oidc/start` performs discovery, creates state/nonce/code-verifier entropy, saves hash-only one-use state, and redirects with Code plus PKCE S256. `/api/auth/oidc/callback` requires the same browser's scoped state cookie, consumes the database row, exchanges the code server-side, verifies the ID token against the discovered RS256 JWKS, resolves provisioning, and only then creates the existing opaque application session.

Migration 0089 separates transient authentication state from durable external identity. `oidc_auth_state` contains issuer, nonce hash, PKCE verifier, safe local return path, and expiry; it contains no code or token. `oidc_identity` uses `(issuer, subject)` as its primary key and permits one identity per issuer per Market Me user. Email is authoritative only while establishing a new link after the provider asserts `email_verified=true`; subsequent logins resolve the stable subject even if the provider's email or display name changes.

Migration 0090 provides controlled onboarding instead of open registration. Owners and administrators create an exact normalized-email invitation for one workspace and one non-owner role. A verified OIDC callback locks matching live invitations, creates the user if necessary, adds organization/workspace membership, marks invitations accepted, links the identity, and records minimized audit evidence in one transaction. `OIDC_BOOTSTRAP_EMAILS` is a deployment-only escape hatch for first-owner provisioning and should be emptied afterward.

Discovery, authorization, token, and JWKS endpoints require HTTPS in production, redirect following is disabled, requests have a ten-second timeout, and JSON bodies are capped at one MiB. The implementation intentionally supports only RS256 in 1.0; accepting another algorithm requires a reviewed forward change. There is no mutable discovery cache, global session map, browser token storage, password database, open signup, email delivery service, or implicit owner invitation.

## Release 1.1 production immutable-object architecture

All four media consumers now cross one `ObjectStore` boundary. The shared environment factory selects a local exclusive-create filesystem implementation only outside production or an S3-compatible implementation in production. PostgreSQL remains the authority for tenant ownership, media type, hashes, scan/rights state, and object-key lookup; the bucket never becomes an application index.

The S3 adapter maps Market Me's content-addressed immutability to a conditional create. It sends `If-None-Match: *` plus a precomputed SHA-256 checksum and independent checksum metadata. Existing objects are reusable only after a bounded byte-for-byte digest check. Reads stream through an application limit and verify provider checksums when returned. The workflow revalidates database authority before storage access as before.

### ADR-077 - Object immutability is enforced at both application and provider boundaries

**Decision:** production requires the S3 adapter; every create is conditional and every replay is verified. Bucket versioning, encryption, public-access blocking, policy, logging, retention, replication, and restore testing remain mandatory provider controls rather than implicit promises made by the adapter.

**Consequence:** horizontally separated web and worker processes share one durable namespace without a shared filesystem mount, while provider/operator configuration remains visible as an independent deployment responsibility. A storage misconfiguration fails media operations closed; no code falls back to local disk in production.

## Release 1.2 recovery-evidence architecture

Market Me recovery has three primary consistency boundaries: application PostgreSQL, object versions referenced by PostgreSQL keys, and Temporal workflow histories correlated through stable Campaign workflow IDs/outbox commands. Provider-side actions, secret/KMS state, and centralized logs add external evidence that cannot be recreated by restoring the application database.

The local recovery harness proves logical PostgreSQL portability without adding runtime authority. It takes a snapshot-consistent custom archive only after explicit quiescence acknowledgement, restores to a new random database, and compares all public table counts plus migration checksums and constraint validity. It never points the application at the restore or mutates the source.

### ADR-078 - Recovery is an independently validated cross-plane operation

**Decision:** use managed PITR/WAL and protected infrastructure backups for production, retain independent logical restore evidence, and always recover into an isolated target before staged reconciliation. Object versions, Temporal histories, external-provider ambiguity, and encryption keys require explicit validation rather than database-only success.

**Consequence:** a successful backup status is not release or recovery evidence. Production operators must approve RPO/RTO and retain drill records; the application cannot honestly infer those values from a local 38-second fixture or silently resume publishing/AI/provider actions after restore.

## Release 1.3 web health architecture

The web process exposes two intentionally different public probes. Liveness is a dependency-free answer used to decide whether the process itself should restart. Readiness is a bounded dependency/configuration evaluation used to decide whether traffic should reach that live process. Both source version from the built package and prohibit caching.

Readiness performs no provider calls or writes. It validates closed production configuration and runs a bounded PostgreSQL connection/migration query. Output is seven named ready/not-ready states; exceptions and configuration values remain server-side. Object storage readiness in 1.3 means valid fail-closed S3 configuration, not live bucket I/O.

### ADR-079 - Liveness never implies readiness

**Decision:** keep `/api/health` dependency-free and route traffic only through `/api/ready` when all web-control-plane checks pass. Bind database readiness to the exact immutable migration ledger expected by the application version.

**Consequence:** an unavailable database no longer causes an orchestrator restart loop while still removing the instance from traffic. Whole-system worker/Temporal/provider readiness requires separate future signals and cannot be inferred from the web probe.

## Release 1.4 worker heartbeat architecture

Migration 0091 establishes PostgreSQL as the shared observation plane for two required worker classes. Each process owns one UUID instance row with a closed service name, package version, database-owned start/last-seen time, and optional stopped time. Multiple replicas may coexist; readiness asks whether any active instance of each class is fresh. Stale rows remain bounded operational history and cannot become fresh without a live writer.

`OperationsRepository` is the only SQL boundary. `recordServiceHeartbeat` inserts or refreshes the exact `(service, instanceId)` row, `stopServiceHeartbeat` closes only that row, and `getServiceFreshness(maxAgeSeconds)` returns the fixed `{ingestionWorker, workflowWorker}` record using one database-clock aggregate. `ServiceHeartbeatLease` is the process timer boundary. Its local `active`, `timer`, and `inFlight` fields prevent duplicate start, overlapping writes, and database closure before the final pulse settles.

The ingestion and workflow entrypoints each create their lease only after core configuration/dependencies exist and await the initial database write before entering work loops. Later pulse failure logs only event, service, and error class. The web probe never starts timers or writes rows. Production readiness requires both fresh service classes; development deliberately treats worker freshness as ready so independent UI work does not require Temporal and ingestion processes.

### ADR-080 - Database-clock, multi-instance worker leases

**Decision:** store per-instance heartbeats in PostgreSQL, use database time for all timestamps/freshness comparisons, retain explicit graceful-stop evidence, and expose only aggregate per-service readiness. Keep liveness dependency-free and make worker freshness production-only traffic criteria.

**Consequence:** clock skew between web and worker hosts cannot create false freshness, replicas do not overwrite each other, and a killed process ages out automatically. PostgreSQL remains a shared dependency, so these checks cannot diagnose database-independent worker health and are not a substitute for queue-progress, Temporal, provider, or infrastructure monitoring.

## Release 1.5 governed owned-email architecture

Mailchimp Marketing is implemented behind the existing channel capability boundary, not as a recipient database. A Channel Connection contains encrypted API-key ciphertext plus bounded non-secret audience ID, verified audience identity, sender name, reply-to address, and data-center metadata. Audience membership and its consent, unsubscribe, suppression, bounce, and complaint state remain authoritative in Mailchimp.

The Draft pipeline renders an immutable email subject and body for one exact Campaign, provider capability version, canonical Destination, and tracked URL. Email previews carry no asset attachments in this release. The worker accepts email only through an exact ready preview on an approval-required publish step, revalidates the audience immediately before sending, and uses the approved subject/body rather than mutable Campaign JSON.

Execution has four provider operations: read audience identity, create a regular Campaign, set escaped HTML/plain content, and invoke immediate send. The provider Campaign ID is persisted while the publication action remains `dispatching`, before content or send. A retry with that known ID resumes content/send and cannot create a second Campaign. An unknown create or send result is classified `ambiguous` and removed from automatic retry.

### ADR-081 - Provider-owned audiences and staged external identity

**Decision:** never ingest raw email-recipient addresses for distribution. Bind a connection to one provider-owned audience, require provider-managed unsubscribe content, and persist a newly created provider Campaign identity before any subsequent network mutation.

**Consequence:** Market Me does not become a parallel consent/suppression ledger, and retries after a known create are duplicate-safe. Delivery outcomes still cross a provider boundary; an ambiguous create/send requires operator reconciliation, and metrics/webhook reconciliation is explicitly outside Release 1.5.

## Release 1.6 aggregate Campaign-report architecture

The existing Mailchimp API key and exact provider Campaign ID authorize one read-only `/reports/{campaign_id}` query. The adapter supplies an explicit `fields` projection containing only Campaign/list identity, send time, and aggregate counters. It validates that the returned list equals the approved connection audience and rejects malformed, oversized, negative, unsafe-integer, cross-audience, or internally inconsistent results.

`mailchimp_campaign_report_snapshot` is an append-only observation table. A canonical ordered metric dictionary is SHA-256 addressed per publication action, so unchanged refreshes are idempotent while changed provider aggregates preserve history. The row persists both provider Campaign ID and the exact observed audience ID; it never rehydrates historical identity from mutable connection configuration. The repository locks and revalidates the exact workspace/action/connection/provider Campaign/audience tuple before inserting. A valid sent report may change an uncertain action to succeeded in the same transaction and records a minimized audit event.

The Campaign-run server component selects the newest bounded snapshot per action for display; a small client control invokes the authenticated writer-only refresh endpoint and then revalidates the server view. Report snapshots remain separate from `measurement_event`: provider aggregates are not expanded into fake per-recipient events and cannot silently satisfy versioned Campaign goals.

### ADR-082 - Immutable aggregate observations, not recipient activity

**Decision:** query and retain only Campaign-level aggregate report fields, content-address each complete observation, and permit sent-report evidence to resolve only the same known provider Campaign. Do not fetch or synthesize recipient activity.

**Consequence:** operators gain post-send visibility and a safe ambiguity-resolution path without creating a contact-tracking store. Metric decreases/corrections remain visible as later snapshots; automated schedules, webhook acceleration, normalized deltas, and success evaluation require separate designs.

## Release 1.7 provider aggregate measurement architecture

`campaign_provider_metric_total` is a provenance-preserving current-value projection over immutable report snapshots. Its primary key is `(publication_action_id, metric_type)`; every row also retains workspace, Campaign instance, exact source snapshot, aggregate total, and provider observation time. A refresh writes all six metrics in the report transaction. Corrections replace only the current projection and never mutate or delete the source snapshot history.

The domain deliberately separates `MEASUREMENT_EVENT_TYPES` from `PROVIDER_AGGREGATE_METRIC_TYPES`. External ingest keys continue to authorize only normalized events. Campaign count criteria use the combined `CAMPAIGN_METRIC_TYPES` vocabulary, while value criteria remain event-only and currency-bound. The summary returns `providerTotals` beside combined evaluation totals so presentation and callers never need to infer provenance from a name.

The report transaction evaluates the exact Campaign version after current totals are updated. If every criterion is met, it queues the existing one-per-instance workflow command with a provider-report trigger key/source. Existing idempotency means a later report or correction cannot duplicate or erase the first threshold notification. The workflow normalizes legacy event-only signal payloads for replay compatibility.

### ADR-083 - Aggregate totals remain a distinct measurement source

**Decision:** allow explicit aggregate provider totals to participate in count thresholds through a separate closed vocabulary and provenance table. Never expand totals into recipient events, grant ingest keys authority over provider metrics, or reinterpret repeated aggregate opens/clicks as people.

**Consequence:** Campaigns can react deterministically to owned-email sent, engagement, and safety totals without a recipient ledger. Current values can follow provider corrections, while the first durable threshold transition remains immutable. Automatic collection cadence and signed webhook acceleration still require separate operational designs.

## Release 1.8 automatic Mailchimp report-collection architecture

`mailchimp_report_collection_state` is one durable schedule and lease per Mailchimp publication action. Migration 0097 records workspace, next-attempt time, attempt count, claim time, last attempt/success, and one closed error code. Migration 0098 adds the immutable audience selected at publication preflight. The state is created transactionally when the provider Campaign ID is first persisted; legacy rows are backfilled from the immutable request snapshot before the current connection is used as a last-resort migration fallback.

`PublishingRepository.claimMailchimpReportCollections(batchSize,maxAgeSeconds)` claims only due, recent, exact-workspace actions on active Mailchimp connections. PostgreSQL orders the bounded candidate set and uses `FOR UPDATE SKIP LOCKED`; a claim older than five minutes is recoverable. Returned `MailchimpReportCollectionTarget` values contain only the exact workspace/action/provider Campaign/audience identities, encrypted credential envelope, connection-creator actor, and incremented attempt count.

`MailchimpReportCollector.runOnce()` owns no global queue or recipient map. It decrypts one claimed credential in request scope, calls the same aggregate-only connector with a five-second request timeout, and passes the validated report into the existing immutable snapshot/provider-total/success transaction. Completion clears the claim and schedules either the configured refresh or a bounded failure-specific retry. Process configuration gates construction of the collector; disabled is the default.

The existing workflow-worker process runs the collector loop beside Temporal polling and durable command dispatch. Report collection does not start a second service identity, grant browser authority, mutate Mailchimp, or bypass provider-owned consent/suppression. The Campaign-run projection exposes schedule health for operations while omitting credential, raw provider response, recipient, and connection metadata.

### ADR-084 - Durable opt-in polling with immutable publication identity

**Decision:** refresh aggregate reports through a database-leased, bounded, opt-in worker loop keyed to the already persisted provider Campaign and publication-time audience. Reuse the manual report transaction and classify retry state with a closed vocabulary.

**Consequence:** restarts, concurrent workers, transient failures, and connection audience changes cannot create duplicate schedules or redirect historical collection. Polling adds provider load and operational ownership, so it remains disabled until explicitly configured; signed webhook acceleration and recipient-level collection remain separate, unimplemented designs.

## Release 1.9 signed Mailchimp webhook-wakeup architecture

The public callback is connection-addressed but not tenant-authoritative. A compatibility GET returns an empty 204 for provider URL validation. POST first resolves one active Mailchimp connection, decrypts its versioned API-key/signing-secret bundle, reads at most 32 KiB, and verifies the exact raw form bytes against Mailchimp's HMAC-SHA256 timestamp contract. Parsing occurs only after a timing-safe match within five minutes.

`parseMailchimpWebhookWakeup` returns only `{audienceId,providerCampaignId,deliveryHash,timestamp}` for a sent Campaign on the exact configured audience. It discards all other signed event types and never returns email, subscriber/member ID, IP, merges, subject, reason, or raw body. `deliveryHash` hashes the verified secret-keyed signature rather than recipient-bearing raw bytes.

`wakeMailchimpReportCollectionFromWebhook` joins the exact connection/action/external Campaign/audience and accepts only a timestamp newer than retained evidence. The atomic update sets `next_attempt_at=LEAST(next_attempt_at,now())`, increments aggregate wakeup count, and records closed verification evidence. It neither clears `claimed_at` nor calls a provider. The normal Release 1.8 worker claim and Release 1.6/1.7 report transaction remain the authority.

Credential storage is backward compatible: API-key-only plaintext inside old encryption envelopes decodes as a legacy bundle; newly created connections store bundle version 1, and webhook configuration rewrites the same encrypted envelope with the one-time signing secret. Only a Boolean configuration marker leaves the server.

### ADR-085 - Webhooks accelerate polling but never become measurement evidence

**Decision:** accept only signature-verified sent-Campaign notifications as hints that make an existing exact schedule due. Discard recipient-bearing fields and always obtain outcomes from the bounded aggregate report API.

**Consequence:** webhook loss, delay, duplication, or correction cannot create false metrics or remove polling completeness. A compromised signing secret can cause bounded provider-report reads for known Campaigns but cannot name a different audience/Campaign, publish content, or fabricate totals; prompt rotation, egress controls, rate monitoring, and polling bounds remain required.

## Release 1.10 managed Mailchimp webhook-lifecycle architecture

`MailchimpEmailConnector` owns the official audience-webhook provider boundary. `listAudienceWebhooks` performs one five-second, 64-KiB-bounded inventory read. `createCampaignWebhook` posts the exact connection callback with every recipient-bearing event disabled, `campaign=true`, subscriber source disabled, and admin/API sources enabled; it validates returned ID, audience, URL, Boolean maps, and shown-once signing secret. `deleteAudienceWebhook` is ID-bound and treats provider 404 as an idempotent absence.

The authenticated management route separates four operations: GET computes provider/local health, POST provisions or explicitly replaces, PUT retains manual-secret compatibility only for non-managed state, and DELETE removes a managed provider resource before clearing local signing state. Inventory precedes every destructive provider operation. `webhooksEligibleForReplacement` selects only the exact callback and/or the provider ID already stored by that connection; unrelated audience webhooks remain outside authority.

The provider and PostgreSQL cannot share a transaction, so compensation is explicit. Unexpected or secretless create responses are deleted inside the connector. After a valid create, failure to encrypt/persist the bundle and safe metadata causes best-effort provider deletion. An uncertain cleanup produces a closed ambiguous response and never claims managed health. Rotation may briefly remove acceleration, but Release 1.8 polling preserves completeness.

`configureManagedMailchimpWebhook` atomically writes encrypted credentials, safe management metadata, and a minimized audit. Stored metadata is `{webhookSigningConfigured,webhookManagement,webhookProviderId,webhookCallbackUrl,webhookAudienceId,webhookConfiguredAt}`; only the first five non-secret identity/state values may be projected. The signing secret remains exclusively in the encrypted version-1 bundle.

### ADR-086 - Provider webhook lifecycle is explicit, inventoried, and compensating

**Decision:** manage Mailchimp webhooks through exact audience inventory and explicit replacement, persist only safe provider identity beside encrypted one-time credentials, and compensate a provider create whenever local persistence cannot commit.

**Consequence:** operators no longer transfer the secret through a console, and drift/loss are visible. Cross-system atomicity is still impossible: deletion/create gaps and ambiguous network outcomes remain operational states, so the UI requires confirmation, health is recomputed from provider inventory, unrelated resources are never deleted, and polling remains mandatory.

## Release 1.11 durable managed-webhook health-monitor architecture

Migration 0100 creates `mailchimp_webhook_health_state` as one operational row per managed Channel Connection. The row snapshots exact workspace, audience, callback, and provider webhook ID, then owns due time, recoverable claim, attempt count, last successful check/health, consecutive unhealthy/error count, closed error, and update time. Managed create/rotation upserts and resets this row in the same local transaction; manual mode and disable remove it.

`claimMailchimpWebhookHealthChecks` orders by due time/connection, locks with `FOR UPDATE SKIP LOCKED`, recovers claims older than five minutes, and revalidates active provider plus every stored/configuration identity before returning encrypted credentials. No mismatched, disabled, manual, or reconfigured connection can be checked through a stale schedule.

The workflow-worker `MailchimpWebhookHealthMonitor` is a sibling to report collection, sharing the existing workflow-worker heartbeat but not its schedules. A missing local signing secret closes as unhealthy without provider I/O. Otherwise one bounded inventory GET compares the exact managed ID, callback, event/source dictionaries, and audience. The monitor records health/backoff only and has no create/update/delete method.

Integrations reads durable monitor state with tenant-bound Channel Connection joins and displays only closed health/error history, last verified time, and decimal-string consecutive count. The existing live GET remains an on-demand fresh check; the explicit Release 1.10 replace/disable controls remain the only repair authority.

### ADR-087 - Monitor managed webhook drift without automatic repair

**Decision:** use a database-leased opt-in inventory monitor to persist closed managed-webhook health and error state, while keeping all provider mutation behind explicit authenticated operator confirmation.

**Consequence:** loss and drift become durable and restart-safe without creating an autonomous credential/resource mutation loop. Detection can lag by the configured interval and requires operator repair; bounded backoff, provider monitoring, and report polling remain necessary.

## Release 1.12 Slack incoming-webhook distribution architecture

`SlackWebhookConnector` is a deliberately narrow official-API adapter. Construction parses an encrypted credential into an exact HTTPS `hooks.slack.com` or `hooks.slack-gov.com` target whose path is `/services/<teamId>/<serviceId>/<secret>`. `targetIdentity()` returns only `{teamId,serviceId,host}`; the secret path component remains inside the encrypted connection and request scope.

Connection creation is test-before-save but not read-only: `testConnection()` posts a fixed visible marker, requires the exact bounded response `ok`, and returns safe target identity. The Integrations form discloses the write and labels the final control `Post test marker and save`. Migration 0101 extends the closed Channel Connection provider set and requires the safe target identity plus a capability manifest that explicitly reports publishing support and absence of provider message identity.

Draft rendering reuses the provider-neutral `renderChannelPreview` pipeline with `SLACK_WEBHOOK_CAPABILITIES`. Slack uses a conservative 4,000-character preflight bound even though the provider may truncate only at a larger ceiling. It advertises zero Market Me attachments, no metrics/events, no native scheduling/edit/delete, and one-message-per-second-per-channel operating guidance.

The workflow router applies a stricter governed boundary than legacy Discord direct copy: Slack requires one exact ready approved Draft preview and an approval-required Campaign step. Runtime preflight reparses the URL and compares its safe identity with the saved configuration locally, avoiding a duplicate connection-marker post. After durable `dispatching` state exists, one JSON POST sends the exact preview with markup, automatic mention expansion, and link/media unfurling disabled.

Slack incoming-webhook success returns no message timestamp, ID, or URL. `PublishContentResult.externalId` is therefore optional. The action stores a safe `ok` acknowledgement, `providerMessageIdAvailable=false`, and target identity while provider external ID/URL remain null. Network failure, 5xx, oversized acknowledgement, or HTTP 200 with an unknown body is ambiguous; the existing idempotency action prevents automatic resend after uncertainty.

### ADR-088 - Slack acknowledgement is delivery evidence, not message identity

**Decision:** support Slack through exact-channel incoming webhooks, require governed immutable preview approval, and record only the evidence Slack actually returns. Never invent a message ID/URL, send a second runtime test post, enable automatic mention/markup expansion, or attach provider-unsupported Market Me media.

**Consequence:** Market Me gains a useful community distribution channel without OAuth credentials or false reconciliation claims. Saving a connection has a visible side effect, and ambiguous sends require channel review because incoming webhooks cannot retrieve, edit, or delete the sent message. Future Slack OAuth, Web API identity, rich blocks, files, metrics, events, inbound conversations, or message reconciliation require separately reviewed contracts.

## Mastodon account architecture (Release 1.13)

`MastodonAccountConnector` is the first owned social-account adapter. The web tier accepts an instance origin and user token only from an authenticated workspace writer. `parseMastodonInstanceOrigin` requires an undecorated default-port HTTPS origin whose exact lowercase host appears in deployment-owned `MASTODON_ALLOWED_HOSTS`; redirects are disabled on every request. This makes instance choice an operator egress decision rather than a browser-controlled SSRF surface.

Connection testing concurrently reads `/api/v1/accounts/verify_credentials` and `/api/v2/instance`. It persists the access token through the existing AES-GCM connector vault and records only safe account/origin identity plus live `max_characters` and `characters_reserved_per_url` limits. `mastodonCapabilities(max,reserved)` turns those integers into the immutable preview manifest; preview counting uses Unicode code points and provider-weighted URLs. SQL migration 0102 requires primary capability/configuration agreement.

## ADR 090: Persist Mastodon media identity before status creation

**Status:** Accepted in 1.14.0.

Mastodon media upload and status creation are separate provider writes. Market Me therefore treats provider media identity as its own durable boundary instead of hiding upload inside one status call. The execution sequence is: re-read account and instance capabilities; load exact immutable bytes; recheck hash, malware evidence, rights scopes, MIME, byte, pixel and alt-text limits; create/retry one `publication_action`; upload missing media in preview order; persist each returned media ID in `mastodon_publication_media`; verify asynchronous media readiness; then create one exact public status with ordered `media_ids[]` and the existing provider idempotency key.

The ledger primary key is `(publication_action_id, ordinal)`. Each row also records `content_asset_id`, `content_hash`, and `provider_media_id`, with a per-action unique provider ID. Repository insertion succeeds only while the action is `dispatching`, the Channel Connection is Mastodon, and the request snapshot at that ordinal contains the same asset UUID/hash. A retry may reuse only an exact stored row. This prevents provider IDs from crossing actions, reordering assets, or silently attaching bytes that were not approved.

Known upload identity enables safe retry after rate limiting, temporary readiness, or later status failure. Unknown upload outcome is ambiguous and suppresses automatic execution. A crash after provider response but before local persistence is also ambiguous on restart because the action remains `dispatching`. The first slice deliberately omits automatic provider media deletion: compensation after uncertain network state could delete the wrong resource or add another ambiguous write. Orphaned provider media is an operator reconciliation concern and carries no public visibility until a status references it.

## Release 1.15 Mastodon aggregate-measurement architecture

The status-report path is a bounded read model over Market Me's own succeeded `publication_action`. The repository resolves the exact provider status ID/URL and prefers the immutable `request_snapshot.providerPreflight.targetIdentity.{accountId,instanceOrigin}` captured immediately before publication; connection configuration is only a compatibility fallback for historical actions. The route decrypts the existing token server-side and supplies that immutable account/origin to `MastodonAccountConnector.getStatusReport`.

The connector calls only `GET /api/v1/statuses/:id`. It validates the returned status ID, authoring `account.id`, and same-instance URL before normalizing three non-negative safe integers: `replies_count`, `reblogs_count`, and `favourites_count`. The returned `MastodonStatusReport` deliberately has no content, actor arrays, media, mentions, tags, application, or reaction identities.

`mastodon_status_report_snapshot` retains one immutable content-addressed observation with status/account/URL identity, three totals, provider status creation time, server observation time, and actor. `campaign_provider_metric_total` remains the current correction-aware projection, but now has mutually exclusive source foreign keys for Mailchimp and Mastodon. A single transaction inserts/deduplicates the snapshot, updates all three projections, evaluates Campaign criteria from normalized events plus provider totals, and idempotently enqueues the existing success signal.

### ADR-091 - Social engagement remains aggregate and correction-aware

**Status:** Accepted in 1.15.0.

**Decision:** read only the Status entity for a Market Me-published Mastodon status, retain the minimum aggregate counts and immutable publication identity, and expose provider totals through count-only Campaign metrics. Do not enumerate or synthesize interacting people, convert totals to events, or treat repeated observations as additive activity.

**Consequence:** the system can measure useful owned-social response while preserving provenance and avoiding a social-profile surveillance store. Provider corrections may reduce a current total; immutable observations remain auditable. The first release requires an explicit operator refresh, so freshness is visible rather than implied.

## Release 1.16 durable Mastodon aggregate-report collection architecture

Migration 0107 adds one operational row per succeeded Mastodon `publication_action`. The row is not a mutable copy of Channel Connection configuration: `provider_status_id`, `provider_account_id`, `provider_status_url`, and `instance_origin` are an immutable collection target captured from the completed action and its preflight identity. `finishPublicationAction` creates the first due schedule in the same PostgreSQL transaction that records success, so a worker restart cannot lose the collection obligation.

`claimMastodonStatusReportCollections` owns the lease boundary. A due query is capped, ordered by `(next_attempt_at, publication_action_id)`, and uses `FOR UPDATE SKIP LOCKED`. Claims older than five minutes are recoverable. Before returning work it joins the exact workspace action and active connection, requires provider `mastodon_account` plus `read_metrics`, rejects targets older than the configured horizon, and returns the existing encrypted credential only to the worker process.

`MastodonReportCollector` is a workflow-worker sibling loop. It decrypts the connector bundle, rebuilds the exact allowlisted provider boundary, calls the Release 1.15 `getStatusReport`, rechecks the immutable returned URL, and delegates snapshot/projection/success-signal persistence to the existing repository transaction. Its result is only `{claimed,succeeded,failed}` and logs contain counts rather than action, account, URL, credential, response, or content values.

Collection completion clears the lease and records one closed result. A successful aggregate observation advances `last_success_at` and uses the configured steady refresh interval. Failures use rate evidence where available and otherwise bounded exponential backoff. The schedule is operational mutable state; the publication identity and every report snapshot remain immutable evidence.

### ADR-092 - Automatic collection leases immutable publication identity

**Status:** Accepted in 1.16.0.

**Decision:** create a durable collection schedule transactionally from successful publication, lease only exact immutable status/account/origin targets, and reuse the privacy-minimized Release 1.15 status-report transaction. Keep the loop disabled by default and require both vault decryption and an operator-owned host allowlist to enable it.

**Consequence:** aggregate freshness survives restarts and horizontal workers without duplicate due claims or mutable-connection target drift. The loop can still lag during outages or after its maximum action age; operators must monitor closed results and retain manual refresh/repair. Automatic collection adds no person-level endpoints, provider writes, notification inference, or resend authority.

## Release 1.17 Mastodon collection operations architecture

Collection operations use a read-time projection rather than a second state machine. The repository SQL derives one closed `operational_status` from the existing schedule row and database clock. This keeps the UI/API representation transactionally consistent with the values the claimant itself uses and avoids a background updater, status timestamp, or migration.

Precedence resolves overlaps deterministically. `abandoned` is a claim older than the fixed five-minute lease; `collecting` is any newer claim; `overdue` is an unclaimed due row; `retrying` is a future row with a closed error; `scheduled` is a future row with a prior success and no error; `pending` is the initial future row. A reclaimed abandoned row becomes collecting in the same claim transaction.

The Campaign page consumes only the safe `StoredMastodonStatusReportCollectionState`. Exact status/account/URL/origin identity and encrypted credentials stay in the worker-only claim type. The API adds one closed label but no dynamic error text, provider payload, or action beyond existing manual refresh.

### ADR-093 - Derive collector operations from lease evidence

**Status:** Accepted in 1.17.0.

**Decision:** expose a closed operational status by deriving it at query time from due, lease, success, and closed-error fields using the same database clock and stale-claim threshold as collection. Do not persist a duplicate status column or gate web readiness on provider backlog.

**Consequence:** operators receive an honest per-publication diagnosis with no drift-prone updater or migration. The label is point-in-time and workspace/Campaign scoped; fleet-wide backlog alerts and service-level objectives remain separate future work.

## Release 1.18 workspace collector operations architecture

The workspace rollup applies the Release 1.17 CASE once in a tenant-bound CTE, then aggregates seven integer counts and only the oldest overdue/abandoned timestamps. Integrations receives no row identity, credentials, provider fields, dynamic errors, or engagement totals. A joined publication action must have the same workspace as its schedule.

### ADR-094 - Aggregate collector posture without broadening identity

**Status:** Accepted in 1.18.0.

**Decision:** expose an on-demand workspace summary from existing schedule evidence, mark only overdue/abandoned counts as attention, and keep provider backlog out of web readiness.

**Consequence:** operators can spot fleet-level collection trouble without enumerating publications or causing provider access. The view is point-in-time and not proactive alert delivery.

The workflow router requires a ready exact approved Draft preview and human-approved Campaign step. Immediately before a durable action it decrypts the token, repeats both read-only calls, verifies host/origin/account ID, and requires both live counting limits to equal the approved manifest and still fit the exact text. A mismatch marks the connection unhealthy and requires a new test/preview.

After the normal `dispatching` boundary, one `POST /api/v1/statuses` carries exact text, explicit public visibility, `sensitive:false`, and the durable action key as `Idempotency-Key`. Success requires a bounded same-instance status ID/URL. Uncertain writes become `ambiguous`; no automatic resend occurs.

### ADR-089 - Operator-allowlisted Mastodon origins and provider idempotency

**Decision:** support user-token, text-only public status creation against exact deployment-approved Mastodon hosts; discover account identity and limits live; revalidate both before dispatch; and pass Market Me's durable action key to Mastodon's official idempotency header.

**Consequence:** Market Me gains a real social-network account with stable reconciliation identity and a read-only preflight, while administrators retain egress control. Instance onboarding requires deployment configuration, and media, custom visibility, OAuth installation, scheduling, metrics, events, edits/deletion, and broader ActivityPub compatibility remain outside this release.
