# Reusable preparation presets

Status: implemented and verified in public release 1.30; exact release acceptance/publication is tracked in [Releases](RELEASES.md). [Implementation and variable reference](PREPARATION_PRESETS.md) documents the resulting contracts. The approved specification calls for reusable, cloneable, editable, shared and versioned campaign templates. This increment delivers reusable **preparation settings** for the existing General Announcement compiler; it does not relabel those settings as a complete arbitrary workflow-template engine.

## User outcome and boundary

An authorized workspace writer can save named preparation settings once, see immutable versions, create a new version without changing earlier ones, clone a version, and archive a preset. Workspace members share access through existing membership; there is no public link, cross-workspace sharing or new permission role. An explicit “Copy these settings” action fills a new preparation form for review. It never prepares a Campaign, edits an existing binding, approves content, publishes a workflow version, activates a run or sends anything.

The copied settings are editable independent values, not a live reference. The existing preparation request/receipt remains the exact authoritative snapshot. A saved browser attempt must never be replaced by a preset selection; recovery retains its original request/key/fingerprint. The preset must not carry package approval evidence, Content Package identity, idempotency or writer authority, account/credential identity, arbitrary JSON steps, preview IDs, schedule, autonomy or activation settings.

## Configuration

Reuse the existing versioned General Announcement normalization rather than introducing different copy-control semantics. Saved fields are Campaign name, description, timezone, optional exact published Brand Profile version, ordered exact published Audience Profile versions, optional published Destination, Information Depth and Promotional Strength. Preset title/description are separate library labels. Referenced resources must belong to the current workspace; new saved versions require currently published references and policy-compatible choices. Historical versions remain readable with clear stale-reference labels. Copying one into an editor is not proof that it is currently usable; the existing preparation transaction rechecks all current references and policies before generating any work.

## Persistence and concurrency

- Add a workspace-owned root with latest-version pointer/revision and archived state. Versions are immutable configuration snapshots with server-owned compiler key/version and canonical bytes/hash. Never update historical settings in place.
- Create/version/clone/archive writes require current owner/admin/editor membership under the established ancestor/member locks. Reads join current membership and return only the selected workspace. Archiving does not erase historical versions or existing prepared Campaigns.
- Each explicit mutation has an actor-private durable request receipt. Exact retries after response loss return the original result; changed payload/actor under the same workspace/key conflicts. A new version requires the expected current root revision. Replay is checked before mutable-current eligibility so later edits cannot turn a completed operation into a duplicate.
- Use foreign-key workspace integrity, monotonic version uniqueness, immutable-history guards, database-level bounds and minimized audits. Whole-workspace erasure must still cascade; ordinary version/receipt deletion must fail while its workspace survives. No original frozen migration is edited.
- Bound request/configuration bytes, text, audience counts, list page sizes and history reads. Do not store private credential/provider metadata in labels, snapshots, hashes, errors or audits.

## UI and verification

The Campaign area exposes the preset library and an explicit settings-copy route into review-first preparation. New-version forms explain that earlier versions and already copied work remain unchanged. Pending/uncertain mutations freeze and persist exact user/workspace-scoped requests before POST, offer lookup/retry, and require acknowledgement before starting a different attempt. Archived presets cannot supply new copies; historical views remain available to current members.

Acceptance requires live tenant/role/reference tests, version/clone/retry races, response-loss recovery, stale-revision rejection, archive/copy semantics, immutable-history and cascade checks, no Campaign/content/execution writes from library actions, browser reload recovery and narrow-layout checks, all regressions/builds/native gates, fresh migration/replay, synchronized developer docs, and exact reviewed-source cloud CI. The larger workflow-template authoring, package/source bindings to template versions, cross-workspace export/share and automatic execution remain separate requirements.
