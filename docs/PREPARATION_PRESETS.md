# Reusable preparation presets

Release 1.30 implements a workspace-shared, versioned **values library** for the existing General Announcement v1 preparation compiler. It is not an arbitrary workflow-template engine. Release acceptance and publication state are recorded in [Releases](RELEASES.md); wider gaps remain in [Implementation status](IMPLEMENTATION_STATUS.md).

## Behavior and boundaries

Current workspace members can browse presets and immutable versions. Owners, admins and editors can create, revise, clone a selected historical version, archive, restore and explicitly copy values into preparation. Saving or copying a preset does not create a Content Package, Campaign, draft, approval, source binding, preparation command, workflow run or publication action. It never calls a provider or accesses a credential. Library changes never modify existing preparation receipts or previously copied values.

Copy is two explicit steps: select a saved version, then acknowledge replacing unsaved reusable fields on the preparation form and press **Copy preset settings into this form**. Navigating to the link alone changes no form values. Package selection, expected package revision and loaded exact approval fingerprint are retained. Optional Brand/Destination fields absent from the preset are cleared, not inherited from the old form. A saved or unreadable preparation attempt prevents copying entirely. Preparing work remains a separate exact-review action under the existing [preparation contract](CAMPAIGN_PREPARATION.md).

## Source map

- Database: `packages/database/src/preparation-preset-models.ts` defines strict mutation contracts, bounds and branded errors; `preparation-preset-repository.ts` owns transactions and membership-scoped reads. `campaign-preparation-template.ts` supplies shared settings normalization without changing the existing compiler's canonical field order.
- Persistence: additive `packages/database/migrations/0118_preparation_presets.sql`; web readiness expects 118 migrations ending at this file. SHA-256: `2fb25d013baf8ec51a2743161a3ee3b059f1559147f892dff9f885c07f8d5934`. Earlier migrations are unchanged; never rewrite a deployed migration.
- Server: `apps/web/src/server/preparation-preset-api.ts` provides no-store transport/errors; `preparation-preset-pages.ts` provides active-workspace scope, strict query numbers and current published choices. `server/database.ts` caches one repository instance with the existing database connection; no additional connection, background worker or global mutable configuration is introduced.
- Routes: `/campaigns/presets`, `/campaigns/presets/new`, `/campaigns/presets/[id]`, `/api/v1/preparation-presets`, `/api/v1/preparation-presets/[id]/copy-settings`.
- Browser: `preparation-preset-contract.ts` validates request/recovery/response shapes; `preparation-preset-form.tsx` handles exact-attempt recovery and library actions; `preparation-preset.module.css` supplies bounded responsive cards/forms. `campaign-preparation-form.tsx` adds explicit copy without changing preparation authority.

## Settings and important collections

`CampaignPreparationSettings` omits `workspaceId`, `contentPackageId` and `expectedPackageVersion` from normalized preparation input. Its allowed-field `Set` excludes those three identities and rejects all unknown keys, getters, hidden properties, symbols and inherited objects. The shared normalizer supplies defaults and canonical text/UUID/timezone/enum handling. Compiler key/version are fixed to `general_announcement` and numeric `1`.

| Field | Intent and rules |
| --- | --- |
| `name`, `description`, `timezone` | Campaign values, not library labels; 200/5,000/100-character bounds. Timezone is validated by the existing compiler; it creates no schedule. |
| `brandProfileVersionId` | Optional exact currently published Brand version in the same workspace. Not a mutable latest pointer. |
| `audienceProfileVersionIds` | Ordered array of up to 20 unique exact current published Audience versions. Selection order remains draft order; empty means one General variant. |
| `destinationId` | Optional currently published same-workspace Destination. It does not select a publishing account or authorize a send. |
| `informationDepth`, `promotionalStrength` | Existing domain enum tuples; current published profile ceilings remain authoritative. Preset save/copy cannot raise those ceilings. |
| `title`, `notes` | Separate library label and explanation, limited to 120 and 2,000 characters. NFC/line-ending normalization; title whitespace collapsed; unsupported control characters rejected. |

`PREPARATION_PRESET_LIMITS` is a frozen module constant: title 120, notes 2,000, request bytes 32,768, list page 50 and history page 20. It is not runtime configuration. UUIDs normalize to lowercase; saved revision/version integers are 1 through 2,147,483,647. `ERROR_BRAND` uses `Symbol.for('@market-me/database/PreparationPresetError/v1')` so cached repositories and hot-reloaded request modules recognize the same safe server error family. Unknown errors never expose SQL, private settings or credentials.

The browser's `presetSettingsSchema`, discriminated `presetRequestSchema`, version/receipt schemas and attempt schema are strict Zod objects. Browser checks improve recovery and reject mixed-up responses; server normalization and transaction checks remain authoritative. `defaultPresetSettings` is a module-scoped initial values object, not a mutable global store; updates create new objects/arrays. Profile choice arrays contain only current version IDs, friendly labels and version numbers. Historical stale selections remain labeled and removable instead of silently substituting a newer profile.

## Requests, receipts and reads

`POST /api/v1/preparation-presets` requires exact configured `APP_BASE_URL` Origin, no query string, a bounded streaming JSON body and a current writer session. The actor always comes from authentication, never the body.

| Operation | Request fields beyond `workspaceId`, `requestId`, `operation` | Result |
| --- | --- | --- |
| `create` | `title`, optional `notes`, `configuration` | New root, version 1, revision 1, available. |
| `revise` | `presetId`, `expectedRevision`, `title`, optional `notes`, `configuration` | Same root; revision and latest version each increase by one. |
| `clone` | `presetId`, `expectedRevision`, `versionNumber`, `title` | New independent root at 1/1 using the selected saved configuration/notes, not unsaved editor values. |
| `archive` / `restore` | `presetId`, `expectedRevision` | Same immutable version; revision increases by one and archived state changes. |

First execution returns 201; exact replay returns 200. Both return only the durable receipt: workspace/request/operation, result preset/version/revision/archive state, title and creation time. This is the original result, not a claim that its root is still current. `GET` on the same endpoint accepts exactly one `workspaceId` and `requestId` query value and returns only the current writer's own receipt; no result is 404. Reusing a workspace/request key for changed input or another actor conflicts.

Copy POST accepts exactly `{ workspaceId, expectedRevision, versionNumber }` with the preset UUID in the path. It returns a validated immutable version DTO after current authorization/revision/archive/reference/policy checks. It performs zero database writes: no mutation receipt or audit. Version DTOs contain title, notes, configuration, SHA-256, creation time and optional historical `copiedFrom` origin; no writer or canonical request bytes are exposed. Historical clone origin is informational, not execution authority.

List is current-membership scoped, latest-version labeled and ordered by updated time descending then ID, using pages of 50 and one lookahead. Pages 1–2,000 are supported; these are bounded observations, not a stable multi-page snapshot. Version history uses descending version numbers, 20 plus one lookahead and an exclusive `before` cursor. Detail may select one exact version; root state is always current. Page query allowlists reject duplicates/arrays, unknown keys, malformed numbers and active-workspace mismatch instead of silently switching workspaces.

## Tables, invariants and locking

`preparation_preset` holds `id`, `workspace_id`, monotonic `revision`, `latest_version_number`, `archived`, creator and timestamps. `preparation_preset_version` uses `(preset_id, version_number)` as its immutable identity and stores workspace, title/notes, normalized JSONB, exact canonical JSON text, SHA-256, optional clone source/version, creator/time. `preparation_preset_receipt` uses `(workspace_id, request_id)` and retains actor, exact canonical normalized request and committed result fields. Version/receipt canonical bytes are private server history.

Composite foreign keys prevent cross-workspace roots, versions, receipts or clone ancestry. Deferred references permit root/latest-version insertion in one transaction. SQL checks bound basic configuration shape/size, fixed compiler, required strings/enums/audience-array length, canonical JSON equality and SHA-256. Full UUID element/uniqueness/timezone/control-character/reference-policy validation belongs to the shared application normalizer and locked repository; the SQL checks are defense in depth, not a replacement API.

`protect_preparation_preset_history()` rejects invalid initial state, inserts by non-writers, versions not matching an available root, invalid clone roots and receipts not matching their canonical request/result. Root updates require exactly one version or archive transition and cannot change identity/creator. Updates to historical versions/receipts and individual deletion while the workspace survives fail. Whole-workspace erasure still cascades. Restoring a root is allowed even when old profile references are stale, but subsequent copy/revise/clone must pass current eligibility.

Mutation lock order is organization key-share → workspace share → user key-share → current membership share → workspace/request advisory lock → preset root update lock → selected reference roots/versions. Exact receipt replay is checked before mutable root/reference eligibility, after current writer authorization. Therefore later edits, archives or retired profiles cannot duplicate an earlier completed action; revoked writer access still prevents replay. Root expected-revision checks serialize concurrent edits. Selected profile roots and versions are locked in deterministic ID order, followed by Destination; shared `resolveCommunicationPolicy()` enforces ceilings. Provider/network I/O never occurs inside these transactions.

The invocation-local `root` tracks the result's ID/revision/latest version/archive state, `existing` is the selected immutable version, `origin` records clone ancestry only, `canonical` identifies the normalized request, and `configurationText`/`configurationHash` preserve exact configuration bytes. `lockReferences` selects SQL table/column names only from the closed internal `brand`/`audience` discriminant; client values remain bound SQL parameters. `ids`, `roots`, `versions` and `policies` are transaction-local arrays. `receipt()`/`version()` produce minimized ISO-time DTOs.

## Browser state and recovery

Storage key: `market-me:preparation-preset:v1:<user UUID>:<workspace UUID>`. A v1 attempt holds authenticated-user scope and the exact strict mutation request. Session storage is per browser tab (browsers may initially copy it when duplicating a tab), not a credential store or server authority. The serialized recovery copy is bounded to 40,960 UTF-8 bytes. Requests are persisted **before** POST; a failed persistence write sends nothing. Closing the tab discards local recovery but does not remove immutable server history.

`attempt` freezes original values and operation; `restored` is the hydration-time recovery capture; `storageError` blocks unsafe retries until explicitly cleared. `title`, `notes`, `configuration` and `cloneTitle` are editor-only values. `pending` disables controls; the `inFlight` ref prevents duplicate event handlers within a render interval. `confirmed` acknowledges possible earlier success before `reset()` clears local state. `message`, `error` and `resultLink` display verified receipt or uncertainty, never automatically start another request. A recovered attempt can belong to another preset/version in the same workspace and is explicitly labeled as such. Reset uses current page props, so reload before editing if a previous save may have changed root state.

In campaign preparation, `copySelectionKey` is the serialized selected preset tuple; `copyAcknowledgement` must match it so a new candidate cannot reuse an earlier acknowledgement. `copyPending` distinguishes readonly values-copy status from actual preparation. Existing `pending`/`inFlight` serialize copy against preparation. No preset identity is written into the preparation request as an authority pin; the normal immutable preparation configuration is authoritative.

`readPresetResponse()` reads stream chunks into bounded `Uint8Array` buffers, caps total bytes at 65,536, decodes fatal UTF-8 and parses JSON. `parsePresetReceipt()` checks strict shape plus exact workspace/key/operation and existing-root identity where applicable. Paths accept validated UUIDs/positive versions only. No automatic retry, background polling or cross-workspace storage recovery occurs.

Errors: 401 authentication, 403 access/Origin, 404 missing same-scope resource/receipt, 422 invalid settings, 409 changed key/revision, archive, unavailable references or policy conflict; bounded transport retains its own HTTP statuses. Unknown persistence failures return a generic 503 and instruct the user to check the saved request before retrying. An uncertain result must never be treated as proof of failure or “fixed” by deleting server history.

## Development, rollout and verification

No new dependency, environment variable, credential, provider permission or worker is needed. Apply migration 0118 before matching web/database code. Back up, drain preset mutations, migrate forward, deploy matching code and verify readiness. Roll back application code only when compatible with the additional tables; retain historical presets/receipts. Correct any deployed schema with a new forward migration, never an edited checksum.

Use `market_me_ci` for the entire integration suite. Focused preset database tests additionally accept isolated `market_me_qa_130_*` databases; they refuse the application database. Tests cover strict normalization and unchanged compiler canonical bytes, six-way exact-create races, competing revisions, actor-private replay, tenant/role revocation, current profile ceilings, immutable/cascade constraints, historical cloning, archive/restore, zero-write copy, paging and API/page/response/storage boundaries. Run all typechecks, lint, tests, frontend builds, native checks/tests/unsigned bundle, fresh migrations/replay, actual-browser acceptance, production smoke and exact-source cloud CI/audits before claiming a release.

Synthetic browser acceptance covers Unicode labels, create 201/retry 200/reload lookup, new version while v1 remains unchanged, cloning v1 after v2, archive/restore, explicit copy, stale-link 409 with unchanged form, preserved selected package and exact approval proof, separate successful draft-only preparation, and disabled copying with saved recovery. A 430px requested viewport has no horizontal overflow. Only unrelated extension warnings were observed. Before explicit preparation, the QA workspace had two roots, three versions and five receipts with zero Campaigns/drafts/preparations/commands/publications; afterward it had exactly one Campaign/draft/preparation and still zero commands/publications. One synthetic approved package was seeded separately for that check.

Still outside this release: arbitrary workflow-template design, template-version bindings on sources, cross-workspace/public sharing or export, schedule/autonomy/account settings in presets, automatic application, activation and provider acceptance. See [the original preset plan](PREPARATION_PRESETS_PLAN.md) and the wider specification rather than inferring those capabilities from this values library.
