# Smart Source preparation plan preview

Release 1.27 adds a side-effect-free preview of the current, possibly unsaved Smart Source preparation form. It is a planning explanation, not a generated-content preview, saved binding, approval receipt, readiness guarantee or authority to execute. Saving remains a separate action. See [source-bound preparation](SOURCE_BOUND_DRAFT_PREPARATION.md) for the durable binding/outbox and [release evidence](RELEASES.md) for verification status.

## User-visible contract

- **Preview this setup** normalizes the proposed name, description, copy controls and timezone on the server, using the same `general_announcement@1` compiler as saving and preparation.
- The plan shows the source's persisted name/version and synchronization flag, optional Brand and Destination labels, authored Audience order or exactly one General draft, and the compiler's single approval-required manual review step.
- The future trigger is conditional on separately saving an enabled binding and on a later explicit exact Content Package approval. The preview does not scan or backfill existing approvals. Source synchronization and the preparation binding remain independent controls.
- A proposed disabled setting is not described as an already-disabled binding. The saved configuration remains in force until save succeeds. Queued commands are not canceled by a preview, edit or later disable.
- Changing any preparation field removes the preview. Saving also clears it. A source-version/binding-revision refresh remounts the form so an in-flight response from an older page cannot become the current preview.
- The actual wording requires an approved Content Package and is generated only during preparation. Neither preview nor preparation finalizes, activates, schedules, approves or sends a Campaign.

## Request, response and authorization

`POST /api/v1/smart-sources/[id]/preparation-binding/preview?workspaceId=<uuid>` accepts the strict existing binding body plus required `expectedSourceVersion` (`1..2147483647`). `expectedRevision` is required when a binding exists and must be absent for an unconfigured source. The path supplies the source ID; query/body workspace IDs must agree. The current authenticated owner/admin/editor supplies the actor. Viewer, analyst and approver-only roles cannot request preview.

The route requires the configured Origin, `application/json`, one explicit workspace query value and a streaming body no larger than 32,768 bytes. Unknown fields, duplicates, invalid IDs/versions, invalid timezones and invalid copy settings fail before repository work. All success and error responses use `Cache-Control: no-store`. Existing authentication, schema and bounded safe-error mappings are reused; `source_changed` and `binding_changed` are conflicts requiring reload, never automatic retries.

The browser receives `SourcePreparationPlanPreviewView`, built explicitly by `sourcePreparationPlanPreviewView()`. Only workspace/source IDs remain as scope checks. Brand/Audience version UUIDs, Destination UUID, internal binding revision, actor/writer identity, command or approval IDs, fingerprints, snapshots, credentials and compiler placeholder identity are absent. Labels are rendered as React text, not HTML. The browser guard rejects extra nested keys, foreign scope, unsupported steps, invalid versions, mixed General/Audience variants and inconsistent stale-reference flags. The form separately matches the returned source version to its server prop.

## Repository and locking

`SourcePreparationRepository.previewSourcePreparationPlan(input, actorUserId)` validates the source version and reuses `normalizeBinding()`. That helper now returns both `normalized` configuration and `campaign` from `compileGeneralAnnouncementPreparation()`; save consumes the same normalized value. `PLACEHOLDER_PACKAGE_ID` is an existing internal compiler-only UUID used because no Content Package is selected during source configuration. It is never persisted or returned in the preview.

One short transaction locks the same authority hierarchy as save: organization/workspace, current user/membership, source `FOR SHARE`, the existing workspace/source binding advisory lock, then Brand/Audience/Destination references. After acquiring the binding lock it reads the current row and compares `expectedRevision`. A concurrent binding edit either precedes the preview and causes a conflict, or waits until the preview finishes. Source-version and membership checks happen under their corresponding locks. The returned value is a point-in-time explanation; it is not a durable lease or promise that later save/execution will succeed.

For new, changed or enabled settings, `lockReferences()` requires the current published Brand/Audience versions and a published same-workspace Destination. It now returns safe labels/version numbers along with validation. Profile roots and versions are locked in stable database order; maps restore authored Audience order afterward.

For an existing disabled proposal retaining the exact saved Brand, Destination and ordered Audience IDs, `lockRetainedReferences()` resolves labels under locks without requiring those references still be current. Restrictive foreign keys retain the original identities. Each reference reports `current`; `referenceValidation` is `retained_for_disabled_safe_stop` only when at least one reference is actually stale. A fully current disabled proposal reports `current`. Changed references and re-enablement still require full current-reference validation. This mirrors save's safe-stop exception; it never enables stale settings.

The compiler output must contain exactly one `review_preparation` step with `request_approval`, the one-element execution-method tuple `["manual_handoff"]`, `approvalRequired: true` and `scheduleType: "immediate"`, under objective `awareness` and autonomy `draft_only`. Unexpected compiler authority fails closed instead of being relabeled as a safe plan. Arrays, nested objects and the top-level server result are frozen before return.

## Important values, collections and lifetimes

| Value / type | Intent and lifetime |
| --- | --- |
| `SourcePreparationPlanPreviewInput` | Per-request binding configuration plus `expectedSourceVersion`; no actor field or execution authority. |
| `expectedSourceVersion`, `expectedRevision` | Optimistic concurrency inputs for the persisted source and binding; not bearer tokens. |
| `normalized`, `campaign` | Per-call output of the shared compiler; no duplicated client-side compiler or global cache. |
| `prior`, `preservesDisabledReferences` | Transaction-local prior binding and exact ordered-reference equality test for safe disable. |
| `ResolvedPreparationReferences` | Transaction-local optional Brand, ordered Audience array and optional Destination labels/current flags. |
| `rootsById`, `versionsById` | Invocation-local maps joining stable lock order back to authored Audience order. Never shared between tenants or requests. |
| `SourcePreparationPlanPreviewReference` | Server-only `{versionId, name, versionNumber, current}`. UUID removed by the browser projection. |
| `draftVariants` | Frozen ordered discriminated union: one `{position:0, kind:"general", label:"General"}` when no Audiences, otherwise up to 20 Audience label/version/current records. Server UUIDs and positions are omitted from the browser array. |
| `referenceValidation` | Closed `current | retained_for_disabled_safe_stop` union describing the actual resolved reference state, not execution readiness. |
| `currentBindingRevision` | Optional server-only row revision used in the repository result; no command or persisted preview receipt is created. |
| `SourcePreparationPlanPreviewView` | Closed serializable browser projection. Exact nested-key checking is part of the response boundary. |
| `sourceVersion`, form `key` | Server props for current source version and workspace/source/version/binding-revision remount identity. |
| `values`, `binding` | Component-local unsaved fields and latest accepted saved binding; never replace database authority. |
| `preview` | Component-local, short-lived plan; cleared on field changes/save and not stored in browser storage. |
| `pending` | Component-local `"preview" | "save" | undefined`; disables both actions/fields to avoid overlapping form requests. |
| `error`, `message` | Component-local safe feedback; edits clear old feedback. Uncertain outcomes are not retried automatically. |

No new environment variables, mutable globals, database tables, migrations, triggers, workers, provider adapters, network calls or credential scopes are introduced. Existing constants and normalization limits remain authoritative. Migration readiness stays at 116, ending at frozen 0116; migrations 0113–0116 must remain byte-identical.

## Programmer entry points

- `packages/database/src/source-preparation-repository.ts`: types, shared normalization, locked preview and safe-reference projections.
- `apps/web/src/app/api/v1/smart-sources/[id]/preparation-binding/preview/route.ts`: authenticated POST route.
- `apps/web/src/server/source-preparation-schema.ts`, `source-preparation-api.ts`, `source-preparation-view.ts`: strict inputs, bounded request/error boundary and minimized response.
- `apps/web/src/components/source-preparation-binding-request.ts`: request serialization, exact scope/shape guard and view types.
- `source-preparation-binding-form.tsx`, `source-preparation-plan-preview.tsx`, `source-preparation-binding.module.css`: ephemeral form state and responsive display; preview body text is 14px, headings 20px/15px.
- `apps/web/src/app/smart-sources/[id]/edit/page.tsx`: source-version props and remount key.

## Verification and operations

Use a disposable `market_me_ci` database for the complete suite. The focused source-preparation integration suite also permits an isolated `market_me_qa_127_*` database; other historical suites have narrower allowlists, so do not use that prefix for the whole suite. Never point integration tests at an application/customer database.

```powershell
npm run db:migrate
npm test
npm run typecheck
npm run lint
npm run build
npm run companion:native:check
npm run companion:native:test
npm run companion:bundle
```

The live repository suite checks normalized/save equivalence, General fallback, authored order, writer roles/revocation, tenant isolation, stale source/binding revisions, concurrent binding edits, current/stale safe disable, frozen projections and zero persistent footprint/provider calls. Web tests cover Origin, content type/size, strict scope/schema, safe errors/no-store, minimization, exact response guards, source-version wiring and rendered semantics. The pre-existing ingestion-claim test now dates only its owned fixture first and claims one item, eliminating the assumption that all parallel tests together have fewer than ten intake events.

Browser acceptance must exercise General and ordered Audiences, normalization, edit invalidation, separate save, stale-reference rejection and safe disable, plus desktop/mobile readability. A preview-only browser flow must leave bindings/commands/Campaigns/drafts/publication actions unchanged. An explicit save should add only the binding. Production smoke must retain authenticated routing and disabled development login. Cloud CI and local/native/browser evidence are independent; record exact results in [Releases](RELEASES.md).

Rolling this application-only increment back removes the preview UI/route without schema changes. Existing bindings and queued commands retain their original semantics. Preview responses must never be reused as save or execution authorization.
