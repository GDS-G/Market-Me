# Smart Source dry-test implementation plan

Status: the bounded metadata-only increment is published as 1.29. Reviewed commit `6d7592fcace50a8a40960ab49a3fa34e8088590e` is on main with exact feature/main cloud runs 36925952746/36926643029 passing 2,256 tests/130 files and both clean audits. Local frontend/native builds, unsigned packaging, migration replay, synthetic browser/production-mode checks and Google development-tab readback also pass. [Source dry-test contract](SOURCE_DRY_TEST.md) records implemented behavior. The larger specification boundary below remains the target, not a completion claim.

## Specification and acceptance target

Conceptual sections 01/03/23 require a nontechnical customer to inspect what a source would do before activation: detected/ignored items and reasons, proposed packages, supporting relationships, missing/conflicting information, consulted context, estimated processing and proposed next actions. The complete specification also calls for single-item, folder, date-range and current-content scopes. A configuration summary or success message is not a substitute for that evidence.

The next implementation should deliver an honest bounded dry test over one explicitly selected saved source location. It must work while the source is paused. It must not silently enable a source to populate its index, create an ingestion event/package/draft/Campaign, approve anything, alter a preparation binding or send content. Reading a provider page and refreshing its existing credential are distinct from pure local simulation and must be disclosed.

## Proposed dataflow

1. Authenticate a current workspace writer. Validate explicit source/workspace/location and expected saved source version through the existing bounded Origin/JSON transport patterns.
2. Capture a coherent saved configuration, selected location, published Context Pack identities/status and future preparation behavior under short database locks. No network request runs while a database transaction is held open.
3. For cloud sources, explicitly fetch one bounded page from that exact provider/folder. For local sources, inspect only already-indexed metadata; do not read arbitrary computer paths or dispatch companion work. Display that local coverage may be empty/stale and that it does not prove current filesystem contents.
4. Reuse one pure intake-filter classifier for runtime ingestion and simulation, so MIME/glob inclusion and exclusion explanations cannot drift. Retain current runtime behavior unless a separately tested correction is required. Folder traversal is distinct from file eligibility.
5. Apply the existing readiness evaluator to eligible sample entries using captured time, settling state and visible supporting-file/marker evidence. Report incomplete/unknown data explicitly. Never infer missing items are absent from an incomplete page or an old local index.
6. Explain the existing per-root-item package proposal; do not claim that related-file readiness already merges all supporting files into one package. Show grouping reasons and distinguish observed relationships from inferred ones.
7. List exactly the captured Context Pack versions/status that would be consulted and any reliably computed structured-fact conflict/unresolved state. Do not claim a text/content interpretation when only metadata was read. Preserve the existing authority-precedence semantics through shared pure logic rather than a second interpretation engine.
8. Recheck membership, source version/scope and relevant references before returning a minimized no-store result. A changed configuration must cause a refresh/review conflict, not a result that silently combines old and new settings.
9. Render a readable sample with an explicit coverage banner, item reasons, proposed next action and non-activation boundary. Changing source/location or reloading invalidates the visible sample; no stored result grants future activation authority.

## Important limits and design decisions

- Bound request bytes, provider page size, result size, name/path lengths, number of selected locations and item count. A provider next-page token or local truncation means partial coverage, even if the provider's separate incomplete-search flag is false.
- Do not accept raw provider continuation URLs, arbitrary fetch URLs, filesystem paths or browser-supplied actor/approval/command authority. SharePoint continues to use the explicitly selected library/folder identity.
- Do not return credential envelopes, tokens, provider web URLs, raw metadata, unpublished context instructions, internal command IDs or broad audit data.
- The simulation itself should make zero AI requests. Show that actual future AI/model costs are not estimated until there is a supported calculation using explicit model/workload/pricing inputs; zero simulation spend is not a zero monthly-cost prediction.
- Source synchronization, source package readiness, package approval, draft-only preparation, finalization and external activation remain distinct states. Describe the conditional next step, not a promise that all later gates will pass.
- A sampled file's modification time may be missing or invalid. Represent uncertain settling conservatively. Supporting-file absence on a partial sample is unknown, not a definitive missing-content diagnosis.
- Browser actions need in-flight locking, bounded response validation, caught network errors and finally cleanup. A dry test should not be confused with saving edited configuration.
- Preserve current source edits and user-owned local files. Keep migration history immutable. If new durable state becomes necessary, use a new forward migration and document its lifecycle rather than repurposing creation receipts.

## Verification before release

Tests must compare shared filter results against ingestion, exercise MIME/glob edge cases and folder traversal, readiness timestamps/markers/partial support, coherent source/context snapshots, membership loss and version changes during provider I/O, local/foreign scope, minimized responses and zero persistence. Browser tests should cover a paused source, empty local index, mixed eligible/ignored items, incomplete sample warnings, stale-version conflict and readable narrow layouts. Live Google/Graph verification remains explicitly separate from synthetic/mock acceptance.

Document all new fields, constants, collection ordering, caches, temporary state, errors, coverage semantics, build/release evidence and remaining specification gaps in the repository and the existing organized Google development tabs. Do not call the full simulation requirement complete while item/date-range scopes, real content interpretation or supported cost estimation remain absent.
