# Review-first campaign preparation

Status: preparation shipped in the verified 1.22 preview. The separate protected [Campaign finalization](CAMPAIGN_FINALIZATION.md) implementation shipped in the verified 1.23 preview. This document describes the preparation boundary; exact acceptance is in [Releases](RELEASES.md). See [the plan](CAMPAIGN_PREPARATION_PLAN.md) for rationale and broader setup requirements that remain open.

## User-facing scope

An approved Content Package can produce a General Announcement planning Campaign and governed draft variants in one operation. The result is **Prepared—not activated**. No provider account is inferred, no attachment is selected, and no Campaign instance, execution command, publication action or approval decision is created. Draft review, revision and channel previews remain separate existing operations. Publishing a `draft_only` planning version internally is not external publication.

The planning version must remain the ancestor of generated copy. A later executable plan must use the same Campaign and preserve that historical version. The future finalizer must reject stale user edits; creating an unrelated Campaign would break existing preview lineage.

## Compiler and normalized values

`packages/database/src/campaign-preparation-template.ts` exports `compileGeneralAnnouncementPreparation(input: unknown)`, the typed normalized input/result/error contracts, `GENERAL_ANNOUNCEMENT_TEMPLATE_KEY`, `GENERAL_ANNOUNCEMENT_TEMPLATE_VERSION`, and frozen `CAMPAIGN_PREPARATION_LIMITS`.

- Template key `general_announcement`, version `1`, are server-owned semantics. Unsupported keys/versions are rejected. Keep old version compilers while their durable attempts may be retried; do not reinterpret existing version-1 payloads after an upgrade.
- Required `workspaceId` and `contentPackageId` are normalized UUID references, not authorization. `expectedPackageVersion` is a numeric integer in 1–2,147,483,647; strings, nonfinite values and fractions are rejected.
- Optional `name` defaults to `General announcement` and is limited to 200 UTF-16 code units. It is NFC-normalized, trimmed and whitespace-folded. `description` defaults to empty, retains normalized line breaks, and is limited to 5,000 code units. Invalid control characters are rejected.
- Optional `brandProfileVersionId`, ordered `audienceProfileVersionIds` (maximum 20) and `destinationId` are explicit references. UUID casing/outer whitespace normalize; duplicate normalized audience IDs are rejected. No audience selection means one general draft. Authored audience order determines variant order.
- `informationDepth` defaults to `contextual`, `promotionalStrength` to `informational`, and `timezone` to `UTC`. Existing domain enums and profile ceilings apply; the compiler cannot grant an override. Timezone validity is checked with `Intl`, but its trimmed spelling is retained so ICU alias-canonicalization changes cannot alter hashes. Equivalent alias spellings intentionally identify different payloads; omitted and explicit `UTC` are identical.
- Strict plain-JSON validation rejects unknown keys, prototypes, accessors, symbols, sparse/custom audience arrays, authority fields, arbitrary context, steps, credentials and account selection. No input getter or `toJSON` is intentionally invoked.
- `normalizedInput` is a new frozen object with copied frozen collections. `canonicalPayload` is fixed-order JSON computed on the server, not a client-supplied fingerprint. `campaign` is an ordinary `CampaignDraftWrite`: awareness objective, the one selected package, explicit profile/destination/copy controls, `draft_only`, empty context/success criteria, `notify_only`, and one `request_approval` / `manual_handoff` review step. It is graph-valid but execution-policy-ineligible.

The compiler performs no I/O, creates no random IDs or timestamps, and never approves, activates or contacts a provider. Its module-level allowlist and limits are validation constants, not shared mutable request state.

## Atomic preparation and retry contract

`CampaignPreparationRepository.prepare(input, idempotencyKey, actorUserId)` owns exactly one database transaction and returns `{ preparation, replayed }`. The authenticated server supplies `actorUserId`; it is never accepted from form data. `idempotencyKey` is a UUID normalized separately from compiler input. It and actor identity are excluded from canonical settings.

1. Lock organization/workspace/actor ancestors before their membership child to avoid deletion/FK lock inversion. Lock the exact workspace membership `FOR SHARE` and require owner, admin or editor. Organization membership alone grants nothing.
2. Acquire a transaction-scoped advisory lock using the full workspace/key namespace's PostgreSQL 64-bit hash. A hash collision only serializes unrelated requests; it never establishes payload equality. The table's unique `(workspace_id, idempotency_key)` constraint is the durable boundary.
3. Check an existing receipt before mutable eligibility. Compare full canonical bytes, not just SHA-256. Identical retries return the same completed receipt, even after source refresh or profile publication. Different settings conflict with the existing preparation ID. Current writer authority is rechecked for every retry.
4. Lock the exact package `FOR SHARE`; require the submitted revision and approved status. Read evidence only afterward. Do not adopt a newer revision or use child evidence locks that invert correction/refresh lock order.
5. Lock the optional Brand root, then version; lock Audience roots in UUID order, then versions in UUID order. Require current published versions and published roots in this workspace. Retain the author's separate audience order. This agrees with profile publication's root-before-version order and is intentionally stricter than advanced Campaign editing, which can retain historical pins.
6. Lock an optional published Destination `FOR SHARE` and snapshot its identity, canonical URL, descriptions, availability bounds and tracking settings. Destinations are mutable and unversioned. Their snapshot is historical context, not guaranteed future availability or permission to publish; applicable downstream checks remain necessary.
7. Use existing Campaign graph/reference/communication-policy validation under those locks. Explicit Campaign controls override defaults, but the least-permissive selected profile ceiling remains binding. Reject violations; never silently clamp or read arbitrary JSON as a workspace/Destination policy. `CommunicationPolicyInput` now accepts null from SQL and treats it as absent: previously a null candidate's undefined ordinal rank could mask a real audience ceiling. Regression coverage checks both starter and advanced authoring paths.
8. Create the Campaign/draft, publish exactly that uncommitted `draft_only` version, generate pinned governed drafts, insert the completed receipt and audit, then commit. Any generator, validation, constraint or audit failure rolls everything back. No durable pending row or compensating-delete workflow is required.

`get(workspaceId, preparationId, actorUserId)` and `getByKey(workspaceId, idempotencyKey, actorUserId)` require current workspace membership in their read query and return no record for an unauthorized scope. `listForWorkspace(workspaceId, actorUserId)` supplies only `{id, campaignId}` summaries for Campaign cards, making the original receipt discoverable after the browser tab or pending key is lost. These readers do not regenerate or mutate anything. Role-appropriate API authorization remains an additional boundary. Public receipt `createdAt` is normalized from the PostgreSQL Date to an ISO string for identical safe JSON/server-rendered consumption.

## Transaction helper boundaries

- `CampaignRepository.createCampaignDraftInTransaction(tx, input, actor)` returns `{ campaignId, campaignVersionId }` after existing graph/reference validation.
- `publishExactCampaignDraftInTransaction(tx, workspaceId, campaignId, expectedDraftVersionId)` returns a boolean and never substitutes another draft. A draft ID alone does **not** detect in-place editing: the new preparation safely calls it only for its own uncommitted draft. A future user-facing finalizer needs stronger content/revision guards.
- `DraftRepository.generateDraftsInTransaction(tx, { workspaceId, campaignId, campaignVersionId, contentPackageId, expectedContentPackageVersion, draftFormat? }, actor)` returns `{ generationId, drafts: [{ draftId, versionId }] }`. It requires an exact published/superseded version belonging to the Campaign/workspace, a bound package with the exact approved revision, and usable evidence. Draft claim insertion keeps migration 0110's two-pass proof requirement.

Helpers never open `begin`, read outside the supplied transaction, or hydrate through mutable current pointers after commit. Public legacy repository wrappers remain compatible. In particular, the preparation path does not call public methods sequentially or cast a transaction into a full database client to create nested transactions.

## Persisted receipt and collections

Migration `0111_campaign_preparations.sql` adds `campaign_preparation` and its immutable-update/lineage guard. Migration acceptance/checksum belongs in Releases once verified; never edit an applied checksum to conceal source changes.

| Field / collection | Purpose and lifetime |
| --- | --- |
| `id`, `workspace_id`, `idempotency_key` | Durable receipt identity and tenant-scoped retry namespace. No expiration or automatic pruning is currently implemented. |
| `template_key`, `template_version` | Exact server-owned compiler semantics, separate from application release version. |
| `content_package_id`, `content_package_version` | Original reviewed package revision; never follows later refresh. |
| `canonical_payload`, `configuration_hash` | Exact fixed-order settings bytes and lowercase SHA-256 diagnostic/audit fingerprint. Equality checks full bytes; public receipt DTO omits raw canonical bytes. |
| `configuration_snapshot` | Frozen normalized settings as JSON, including original authored audience order. |
| `reference_snapshot` | Package title/revision, selected profile IDs/names/versions/data/defaults/ceilings, ordered audience snapshots, and optional mutable Destination snapshot captured under locks. |
| `campaign_id`, `planning_version_id`, `generation_id` | Exact persisted lineage; uniqueness prevents multiple receipts from claiming the same prepared lineage. Foreign keys retain referenced records. |
| `prepared_drafts` | Ordered `{draftId, versionId}` array of every initial generated variant. IDs remain the original versions after later revision/approval; result pages may link to the live review separately. |
| `created_by`, `created_at` | Server-authenticated actor and database transaction timestamp; neither is supplied by template content. |
| local `audiences` Map | Transaction-local lookup from selected version ID to locked snapshot. Sorted lock acquisition does not change authored variant order. Discarded when the transaction finishes. |
| local `generated.drafts` | Exact immutable IDs produced by the helper, used for receipt insertion and audit. No workspace-wide post-commit draft search. |

The insertion guard validates workspace/Campaign/planning-version/generation/package lineage, planning autonomy, and exact complete initial draft/version references. It rejects UPDATE rather than permitting identity mutation. Hash-to-configuration consistency, actor provenance and broader metadata immutability remain application/DB-role responsibilities; this is not tamper-proof against a privileged database owner. There is no receipt deletion endpoint. Intentional administrative retention/erasure needs explicit FK-aware design; test cleanup deletes only owned synthetic receipts first.

## Review and release gates

Required evidence includes compiler determinism/authority rejection; atomic multi-variant creation; concurrent duplicate requests; response-loss replay after refresh; changed-payload conflicts; role/tenant rejection; stale package/profile/Destination checks; policy ceilings; rollback on generation failure; lock races; and database receipt guards. Browser and API tests must prove explicit Origin enforcement, stable pending key/payload recovery, all variant links, accessible errors and **Prepared—not activated** status.

Preparation alone does not complete the no-JSON publication journey. Exact approved preview → same-Campaign executable draft → reviewed publication/activation remains a separate guarded finalization slice. Source-ready automation, arbitrary templates, media recipes, recurrence and the rest of the approved specification remain open.
