# Backup and Recovery Runbook

## Release 1.5 Mailchimp publication recovery note

Treat the persisted Mailchimp Campaign ID as the reconciliation key across database restore, worker crash, timeout, and provider outage. Before enabling outbound execution, inspect every non-terminal or ambiguous Mailchimp publication action against that exact provider Campaign. If the ID is present, determine its provider status and resume only the safe remaining content/send operation through compatible code; never create a replacement Campaign automatically. If create may have succeeded but no ID was received, search the provider using controlled operational evidence and require a human disposition. Restored API keys, sender settings, approvals, audience bindings, and unsubscribe state must be revalidated, and provider-owned suppressions remain authoritative even when the database recovery point predates them.

Release 1.6 report snapshots are immutable historical observations, not provider authority. The Campaign and audience IDs stored on each snapshot are the identities observed at collection time and must not be replaced with current connection configuration during recovery. After restore, compare the newest retained snapshot with a fresh aggregate report for the same Campaign/audience before using it to resolve an uncertain action. A missing or older snapshot never proves zero activity, and a provider correction may legitimately reduce a later count. Do not copy a snapshot to another publication, expand aggregates into recipient events, or use restored counts to bypass provider suppressions. Keep report refresh and all outbound execution disabled until the API key, connection audience, provider Campaign ID, workspace ownership, and restored action are reconciled.

Release 1.7 current provider totals are rebuildable projections, but recovery must preserve their exact source snapshot links and any already queued `success_criteria_met` command. Validate every total against the newest retained snapshot for the same publication; then perform one authorized fresh report read before traffic. A correction may reduce the current projection and make present criteria false, but it must not delete or requeue the first immutable workflow transition. Never reconstruct provider totals as `measurement_event` rows, broaden ingest-key scopes, or infer recipient identities from aggregate counts.

Release 1.8 collection schedules are operational evidence and must be restored with their immutable publication/audience binding. Keep `MAILCHIMP_REPORT_COLLECTION_ENABLED=false` while validating migration 0098, encrypted-key availability, active connection ownership, provider Campaign existence, action age, snapshots, current totals, and any queued success command. Treat restored `claimed_at` as stale only through the normal five-minute lease rule; do not bulk-clear attempts or errors. Before re-enabling, manually read one exact aggregate report for a controlled publication, reconcile provider rate limits and credential rotation, confirm worker version/readiness, and approve cadence/egress monitoring. A missed poll is not a zero report, and replay must rely on snapshot hashes and command idempotency rather than creating recipient events or replacement Campaigns.

Release 1.9 adds encrypted webhook-signing material and minimized wakeup evidence to the recovery set. Disable or delete the provider webhook before restoring public traffic, keep automatic collection off, and prove the connector vault can decrypt the versioned API-key/secret bundle without printing it. Restored timestamps and signature hashes are historical replay evidence only; never reconstruct webhook payloads or recipient events from them. Validate the exact connection/Campaign/audience schedule, rotate by recreating the Mailchimp webhook if secret custody is uncertain, update Market Me through the authenticated rotation control, then send one provider test or controlled sent-Campaign event and confirm exactly one wakeup followed by one aggregate report. Re-enable polling even when webhook health is good, because callbacks are acceleration rather than completeness authority.

Release 1.10 adds safe managed provider identity to recovery. Keep webhook intake and outbound provider mutation disabled while comparing each restored `webhookManagement`, provider webhook ID, callback, audience, configured time, Boolean, and decryptable bundle against a fresh bounded provider inventory. A restored `managed_active` marker is not health proof: use the live 1.10 check. If provider ID/callback/settings or secret custody differ, explicitly replace through 1.10 so only the stored ID/exact callback is removed and a new shown-once secret is captured directly. If provider state exists but database identity was lost, classify it as unmanaged and require reviewed exact-callback replacement; never delete the entire audience inventory. If provider creation or cleanup was ambiguous at the recovery point, keep polling active, reconcile inventory first, and do not claim signed acceleration until live health is `managed_active` and one controlled Campaign event produces one aggregate wakeup/read.

Release 1.11 health rows are restored operational observations, not provider authority. Keep `MAILCHIMP_WEBHOOK_HEALTH_MONITOR_ENABLED=false` during recovery, retain claims/attempts/closed history for evidence, and do not bulk-mark rows active. After vault and exact managed identity reconciliation, use the live 1.10 check first; then start a compatible monitor and let normal five-minute stale-claim recovery process due rows. Compare new `last_checked_at`, health/error, and consecutive count with provider evidence before alert closure. A restored active code may predate provider deletion/drift, while a restored error may describe an outage that has ended. Re-enable report polling independently and never use health state to recreate webhooks, reconstruct secrets, or infer recipient/Campaign outcomes.

## Release 1.4 worker-readiness recovery note

After database recovery and before admitting web traffic, start compatible ingestion and workflow workers and require each to create a new instance-scoped heartbeat. Do not copy, update, or reinterpret pre-recovery heartbeat rows as current evidence. Production `/api/ready` must show both worker freshness checks ready only after the restored database, migration 0091, and new worker processes agree. This proves process-to-database liveness only; separately validate Temporal histories/task queue, ingestion backlog progress, object store, malware scanner, providers, alerts, and ambiguous outbound actions in the staged recovery order below.

## Status and scope

Release 1.2 establishes executable logical-restore evidence for the application PostgreSQL database and the recovery sequence for the complete Market Me data plane. It does not provision backups, choose a provider, approve recovery objectives, or claim that a local test duration is a production RTO.

Production owners must approve numeric recovery-point and recovery-time objectives before launch. Record those values in the deployment's controlled operations system, together with backup schedule, retention, regions/accounts, encryption keys, responsible roles, escalation contacts, and the date/evidence of the most recent successful restore. Do not put credentials or customer data in this document.

## Recovery inventory and ownership

| Data plane | Authority and contents | Required production protection | Recovery owner |
| --- | --- | --- | --- |
| Application PostgreSQL | Tenant identity, configuration, evidence, audit rows, object keys, workflows/outbox, encrypted secrets, hashes, approvals, measurements | Managed point-in-time recovery or continuous WAL archive, encrypted snapshots, independent logical backup, immutable/off-account copy, retention and restore drills | Database/platform owner |
| S3-compatible object storage | Immutable originals and derivatives addressed by PostgreSQL keys | Versioning, encryption, public-access block, least-privilege policy, replication or backup, lifecycle compatible with holds/retention, inventory and access logs | Storage/platform owner |
| Temporal persistence/namespace | Running workflow histories, timers, signals, task state and visibility data | Vendor-supported HA/backup, namespace retention, mTLS/authentication, payload encryption/codecs, compatible worker code and tested namespace recovery | Workflow/platform owner |
| Identity and connector providers | External accounts, grants, subscriptions, webhook resources and provider-side content | Provider recovery policy, export where supported, credential rotation, documented reauthorization/reconciliation | Integration owner |
| Secrets and deployment configuration | Database/object/Temporal/provider credentials, encryption/signing keys, allowlists and feature flags | Managed secrets/KMS, versioned infrastructure configuration, separated backup-key custody, tested key recovery/rotation | Security/platform owner |
| Logs and security evidence | Infrastructure, access, alert, deployment and incident evidence outside application tables | Protected centralized retention, restricted export, clock synchronization and legal-hold procedure | Security owner |

PostgreSQL and object storage form a logical pair: a restored row may reference an object version created before the selected database recovery point. Preserve object versions longer than the maximum database point-in-time window and validate every referenced key before reopening writes. Temporal is a third consistency boundary; PostgreSQL outbox idempotency reduces dual-write loss but does not recreate a missing running workflow history.

## Executable local restore proof

Prerequisites are the development PostgreSQL container, an already migrated `market_me` database, and stopped web/worker processes. The acknowledgement is deliberately explicit because a changing source invalidates a row-count comparison.

```powershell
npm run db:up
$env:QA_DATABASE_RECOVERY_ACKNOWLEDGE_QUIESCED='true'
npm run qa:database-recovery
Remove-Item Env:QA_DATABASE_RECOVERY_ACKNOWLEDGE_QUIESCED
```

`scripts/qa-database-recovery.mjs` performs these steps with argument-array process execution and validated identifiers:

1. Read the sorted public-table inventory and row counts plus all ordered migration versions/checksums.
2. Run `pg_dump` in custom format with owner/privilege restoration disabled and compression enabled.
3. Inspect the archive with `pg_restore --list` and prove the source did not change during the dump.
4. Create a random isolated database from `template0` and restore with `--exit-on-error`.
5. Compare every public table and row count, compare every migration checksum, and reject unvalidated public constraints.
6. Force-drop only the generated QA database and remove only the random `/tmp/market-me-recovery-*.dump`, including on failure.

The tool never copies a dump to the host, prints rows, prints credentials, alters the source, or measures a production RTO. Release 1.2 acceptance restored 120 public tables and 90 migrations in 38,091 milliseconds on one local workstation; that number is evidence of this fixture only.

## Production backup policy requirements

- Use the database service's supported continuous recovery/PITR mechanism as the primary recovery path. Keep an independently scheduled custom-format logical backup for portability and schema-level inspection; a logical dump alone is not sufficient for a large or low-RPO deployment.
- Run backup jobs with a dedicated least-privilege identity and encrypted transport. Never pass a password on a command line, log it, embed it in a backup URI, or store it beside the archive.
- Encrypt in transit and at rest with recoverable, separately governed keys. A backup encrypted by a lost or revoked-only key is not recoverable. Test key access during restore drills without broadening routine runtime roles.
- Store at least one immutable/off-account or cross-region copy. Define retention by approved business, legal, contract, and erasure requirements; backup expiry must honor active legal holds and must not silently resurrect data beyond policy.
- Monitor backup start, completion, size anomaly, age, WAL/archive continuity, replication lag, encryption, retention and deletion. Alert before the approved RPO can be exceeded.
- Restore to an isolated target on a schedule. A successful backup job is not recovery evidence. Record archive identity, source point, tool/server versions, duration, validations, operator, exceptions and cleanup.
- Keep PostgreSQL client tools compatible with the server. Prefer a restore server at the same major version first, then perform a separately tested upgrade.

## Incident restore sequence

1. Declare the incident, appoint one recovery lead and one recorder, preserve alerts/logs, record UTC times, and decide whether credential compromise requires immediate isolation or rotation.
2. Quiesce mutations: enter maintenance/read-only mode at the edge, stop web write traffic, ingestion/workflow workers, webhook processing, measurement ingest and external automations. Confirm no writers remain; do not rely only on a UI banner.
3. Protect current evidence before changing anything. Snapshot failed systems when safe, retain bucket versions and logs, and record deployment/application/migration/worker versions.
4. Select one approved recovery point from business impact and integrity evidence. Record the expected data-loss window; do not silently choose the newest point if corruption predates it.
5. Restore PostgreSQL into a new isolated database/cluster. Do not overwrite the failed primary first. Use the matching application version and keep outbound provider execution disabled.
6. Validate migration versions/checksums, table inventory, constraints, tenant counts, encryption-key availability, object-key references, session/credential policy, pending/dead-letter outbox rows, approvals, audit continuity and recent business aggregates.
7. Recover object versions and prove referenced objects are readable and hash-valid. Do not replace content-addressed keys with different bytes. Quarantine missing/corrupt assets and keep publishing disabled.
8. Recover or reconnect Temporal through its vendor-supported procedure. Run only workflow code compatible with surviving histories. Compare PostgreSQL Campaign instances/outbox commands with Temporal workflow IDs and resolve each missing/extra history deliberately.
9. Reconcile external providers without automatic replay. Inspect ambiguous publication attempts, connector cursors/subscriptions, webhooks, companion jobs and measurement keys. Idempotency records remain authoritative; never resend because a provider result is merely unknown.
10. Rotate compromised credentials/keys in a controlled order. Preserve old decryption keys until all retained ciphertext has been rewrapped or expired; revocation without data migration can make restored evidence unreadable.
11. Start read-only web access first, then controlled writes, then ingestion, then workflow dispatch. Keep outbound AI/publishing disabled until integrity and ambiguity review is signed off. Watch error, latency, queue, database, object and provider telemetry.
12. Record the actual recovery point, measured service restoration time, validation results, unrecovered data, manual decisions and follow-up work. Remove isolated artifacts only under the approved evidence/retention policy.

## Minimum validation gates

- The restored `schema_migration` set exactly matches the deployed code's expected immutable files and checksums. Never edit an applied migration to make a restore pass.
- All public constraints are valid and the application connects with its production least-privilege role; do not certify using an owner/superuser connection alone.
- Every sampled and every currently actionable `content_asset.object_key` resolves through the configured store and matches expected size/hash. Publishing remains closed for any missing object.
- Workspace, organization, user, membership and OIDC identity/invitation relations are tenant-consistent. Revoke sessions created after the selected recovery point and apply the incident's authentication decision.
- Encrypted connector/AI/alert material decrypts only through the expected managed key path. Never print plaintext during validation.
- Pending/dead-letter ingestion and workflow commands, ambiguous publication actions, approvals, spend reservations, measurement keys and retention/legal-hold cases receive explicit disposition.
- Temporal workflow code is history-compatible and task queues/namespaces point to the intended environment. Do not attach an older incompatible worker to surviving histories.
- External notifications, AI execution, publishing, companion execution and webhook consumption are enabled one boundary at a time with monitoring and rollback criteria.

## Failure scenarios and recovery choices

- **Single bad deployment:** prefer forward fix/application rollback while retaining schema and data; restore data only when evidence proves data corruption or loss.
- **Accidental row deletion:** use PITR into an isolated target and perform a reviewed tenant/aggregate recovery where safe. Avoid bulk table copy that bypasses tenant keys, audit, revisions or foreign keys.
- **Database loss:** restore PITR/snapshot, validate logical evidence, then reconcile object/Temporal/provider boundaries before traffic.
- **Object deletion/overwrite:** recover the exact version under the same content-addressed key only when its bytes match the recorded digest. Otherwise quarantine and repair references through a reviewed process.
- **Temporal loss with PostgreSQL intact:** do not fabricate completed workflow history. Classify each Campaign instance, retain outbox/idempotency evidence, and use an approved restart/manual-resolution procedure.
- **Credential compromise:** isolate, rotate and revoke; determine whether backup credentials and encryption keys were exposed. Restoring old data does not restore trust in compromised secrets.
- **Regional/provider outage:** use the pretested replica/backup environment only after confirming configuration, secrets, DNS/edge controls, object versions and provider callbacks belong to that environment.

## Changes requiring a new drill

Run and document a new restore drill after a PostgreSQL or Temporal major-version change, migration-framework change, encryption/key-management change, object-provider/prefix change, backup-provider/format change, major tenant-scale increase, workflow task-queue/versioning change, retention/legal-hold change, or material incident finding.

## Slack recovery note (Release 1.12)

Migration 0101 adds no table and does not change backup volume, but restored Slack connections contain encrypted bearer URLs and safe target identity. During recovery keep Slack publishing disabled until the connector vault key is available, every URL decrypts through the expected key path, and host/team/service matches saved configuration. Treat every restored `dispatching` or `ambiguous` Slack publication as possibly delivered: incoming webhooks provide no message ID or read-back API, so inspect the channel and resolve manually without automatic resend. Rotate the provider webhook after suspected secret exposure; restoring older ciphertext does not restore trust in a compromised URL.

## Mastodon recovery note (Release 1.13)

Migration 0102 adds no table, but restored Mastodon connections pair encrypted user tokens with safe instance/account identity and a snapshot of the instance's status limit. Keep Mastodon publishing disabled until the connector vault key and exact production `MASTODON_ALLOWED_HOSTS` set are restored through approved configuration. Re-test each account and render new previews when identity or live limits differ. Treat every restored `dispatching` or `ambiguous` Mastodon action as possibly published even though provider idempotency was supplied; reconcile the stored provider ID/URL or inspect the account before manual resolution, and never automatically resend. Rotate exposed tokens and review public statuses; older ciphertext does not restore trust.

## Mastodon reviewed-image recovery note (Release 1.14)

Migrations 0103/0104 add and harden `mastodon_publication_media`. Restore it with `publication_action`, `channel_connection`, `content_asset`, preview snapshots, rights-scope tables, and object storage; a media ID without its exact action/ordinal/asset/hash context is not reusable evidence. Validate both migration checksums and all foreign keys before enabling workers.

For each restored Mastodon action, classify every attachment ordinal. A stored provider media ID may be read for readiness and reused only when the action is failed, its request snapshot has the same asset UUID/hash, immutable bytes still hash-match, governance evidence is current, and live instance/account/media limits still equal the preview. Never guess or adopt an ID from logs, provider ordering, filename, URL, or another action.

A `dispatching` action may have uploaded media or may already have created the public status; mark it ambiguous and reconcile manually. An action with fewer durable media rows than snapshotted attachments may have orphan uploads. Provider media is not itself public until referenced, but operators should inspect/remove orphans under provider policy without treating cleanup success as publication evidence. Do not re-upload uncertain ordinals, automatically delete provider media, or resend an uncertain status.

Keep image publishing disabled if object bytes, scan evidence, rights scopes, alt text, provider token, allowlist, or current capability discovery cannot be restored and verified. Restoring old ciphertext or rows does not restore trust after credential, rights, malware, or provider-account compromise.

## Mastodon aggregate-report recovery note (Release 1.15)

Migrations 0105/0106 add `mastodon_status_report_snapshot` and extend `campaign_provider_metric_total` with a mutually exclusive Mastodon source. Restore publication actions, Channel Connections, Campaign instances/versions, snapshots, provider-total projections, audits, and connector ciphertext together; validate both migration checksums, source constraints, foreign keys, and the exact 106-row migration ledger before enabling refresh.

Snapshots are immutable observations. Do not collapse history, sum observations, turn totals into events, or treat a decrease as corruption without provider evidence. Rebuild a damaged current projection only from the newest valid exact-action snapshot in an isolated reviewed repair; preserve every immutable source row and record the repair.

Keep refresh disabled until the connector vault key, production `MASTODON_ALLOWED_HOSTS`, publication preflight identity, provider status URL/ID, and active account/token relationship are verified. A restored successful action does not prove the status still exists or counts remain current. Provider 404, authorization change, account drift, or cross-instance mismatch requires operator review, not deletion or zero fabrication.

If credentials were exposed, rotate/revoke them and review provider audit/state before resuming. Historical aggregate snapshots remain useful evidence but never restore trust in old ciphertext. Explicit refresh can resume after the exact account/origin boundary is re-established; no automatic backlog or catch-up write is required in Release 1.15.

## Durable Mastodon collection recovery note (Release 1.16)

Migration 0107 adds `mastodon_status_report_collection_state`. Restore it with publication actions, Channel Connections, connector ciphertext, preflight request snapshots, report snapshots, provider-total projections, Campaign state, and the exact 107-row migration ledger. Validate the migration checksum `840890e9581deba010e0fc25d0b011cc3d083e6d784125de278213261772f039`, all foreign keys, immutable status/account/URL/origin agreement, and zero unvalidated constraints before enabling collection.

Keep `MASTODON_STATUS_REPORT_COLLECTION_ENABLED=false` during restore. Re-establish the connector vault key and exact production `MASTODON_ALLOWED_HOSTS`, then verify active account/token identity and provider reachability with explicit reads. Restoring ciphertext does not prove the token remains trustworthy or authorized.

Claims are recoverable after five minutes. Do not bulk-null `claimed_at`, reset `attempt_count`, manufacture `last_success_at`, or advance every schedule to now while old workers may still run. Stop/drain all old workers, wait the lease interval, inspect due volume and provider rate limits, and enable one bounded worker cohort before scaling.

Schedule rows are operational obligations; snapshots are immutable measurement evidence. Never infer a missed interval's counts, replay it additively, backfill person-level events, overwrite identity from current connection configuration, or convert a failure/404 into a zero snapshot. The next successful current aggregate observation is sufficient because provider totals are correction-aware.

For rollback to 1.15, disable and drain the collector but retain migration 0107 and every state row. Release 1.15 can continue explicit refresh while ignoring schedules. After forward redeployment, recovered due rows resume through normal bounded leases and age policy; actions beyond the maximum age require explicit operator review rather than forced collection.

## Mastodon operational-state recovery note (Release 1.17)

Release 1.17 adds no stored state. After restoring the Release 1.16 schedule table, the six operational labels are recomputed from the restored timestamps, closed error, and the current PostgreSQL clock. Clock skew, an incorrect restore timestamp/timezone, or old `claimed_at` values may therefore change labels immediately without changing rows.

Do not “repair” a label by editing timestamps, clearing claims, resetting attempts, or inserting a status column. Follow the Release 1.16 drain/wait/reclaim procedure, validate clock synchronization, then let the normal claimant transaction move abandoned/overdue work. Rollback to 1.16 simply removes the projection/UI wording and requires no data or migration change.

## Workspace collector-summary recovery note (Release 1.18)

The summary has no stored state. After restore it recomputes from Release 1.16 schedule rows and the database clock. Use it to prioritize review, not to bulk-edit due/claim timestamps. Rollback to 1.17 removes the card without changing data.
