# Explicit preparation-preset reuse on Smart Sources

Status: next bounded integration after the verified 1.30 preset library; initial implementation and focused tests are underway, not released. The specification's setup progression calls for selecting preparation controls and a reusable template before preview and activation. This increment will let writers copy a saved General Announcement preset into the existing source-preparation editor. It does not claim live source-to-template-version bindings or arbitrary workflow execution.

## Intended flow

The source editor offers an explicit, bounded current-workspace preset chooser. Browse one page of 50 latest-version labels/revisions at a time; show archive/unavailable state and never claim the list is complete when another page exists. Current writer membership is rechecked for the choices endpoint. No configuration, notes, canonical bytes, receipt IDs, actors or credentials are included in chooser responses.

Selecting a preset is not applying it. The writer acknowledges replacement of unsaved reusable settings and separately requests an exact saved-version copy through the 1.30 readonly endpoint. The selected root revision/version are fixed at selection; a changed root or unavailable profile/policy rejects the copy with the current source form unchanged. Application is a local values replacement: preserve workspace, expected binding revision and enabled state, clear absent optional Brand/Destination references, preserve ordered Audiences, and invalidate any old plan preview. Copy must never enable source synchronization or approval-linked preparation, save a binding, queue preparation or send anything.

The writer can review the copied values with the existing **Preview this setup** action and separately save through the existing version-checked binding contract. Later preset edits do not follow the copied values. Existing queued command snapshots remain unchanged. No new preset ancestry is granted execution authority.

## Concurrency and recovery

Use immediate in-flight guarding and disable conflicting copy/preview/save actions while any is pending. Candidate selection or page/scope changes invalidate acknowledgement. Abort obsolete reads on unmount or workspace/source change, and reject stale response scope before updating the editor. Bound response bytes and strictly validate the small projected choice/version schemas. Do not silently overwrite unsaved edits made while a response was pending.

An uncertain binding save must require loading current server state before another save or preset copy; the feature must not treat timeout as failure or automatically retry a changed request. The existing binding revision remains the write precondition. Recovery may read the current source, but must never erase old commands/receipts or change enablement to resolve uncertainty.

## Acceptance and documentation

Tests must prove writer/tenant/query bounds, projection minimization, archive and stale-reference behavior, pagination, exact selection/acknowledgement scoping, optional-field clearing, Audience ordering, retained workspace/revision/enabled state, preview invalidation, duplicate-handler protection and uncertainty recovery. Live repository tests must show copy creates no source/binding/command/Campaign/draft/publication rows. Browser acceptance should exercise copy and preview without requiring a source-enable or binding-enable action. Previously unexecuted optional QA mutations remain unexecuted, not bypassed through this feature.

Run full regressions, static checks, builds, migration replay (no schema change is planned), native packaging, production/browser acceptance and exact cloud CI/audits before release. Update the existing Google development parent/five child tabs and repository architecture, domain, operations, security, recovery and release references. Source binding to a preset version as a durable live relationship, arbitrary template authoring and automatic activation remain separate designs.
