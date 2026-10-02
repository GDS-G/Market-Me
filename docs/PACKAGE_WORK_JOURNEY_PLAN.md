# Package work journey

Status: implemented and accepted in public release 1.35. [Programmer reference](PACKAGE_WORK_JOURNEY.md) records the delivered contract; [release evidence](RELEASES.md) distinguishes local, exact feature/main cloud, publication and documentation gates. This follows specification sections 01/23: a person should be able to trace one package through actual prepared work, not infer a journey from unrelated workspace totals.

## User outcome

From a Content Package, open a read-only Related work page showing its recorded General Announcement preparations, the exact captured package revision, draft variants with current state, any exact finalization receipt and recent runs of that finalized version. Link to existing independently authorized review/receipt/run surfaces. Provide refresh, bounded paging and explicit empty/historical/unavailable states. Add a return link from preparation receipts so operators can find sibling work without searching all Campaigns.

Do not add a launch button, approval action, provider call, automatic preparation, execution retry or readiness score. Do not silently prepare again when records are absent. Existing source-approval command monitoring remains at its exact approval receipt. This page covers completed preparation receipts, not every manually authored Campaign, independently generated draft, pending command or external action.

## Data boundaries

Authenticate active workspace and current membership. Use a coherent database read and exact package/workspace scope, without organization-owner fallback. Page at most ten preparations with one lookahead; bound supported page numbers and explain that paging is a current snapshot, not a stable historical export. Prepared variants are bounded by the existing receipt's twenty-draft limit. Recent run display has its own small cap and honest more-results guidance. Existing indexes support scoped queries; do not claim capped scan cost from bounded output.

Follow immutable receipt identifiers, never a title or the package's current Campaign pointer. Require same-workspace owning Campaign, planning version, generation and captured package identity. Resolve each recorded draft only through its matching generation/workspace and owning version. Preserve captured version separately from current version/status, including archived/unavailable records. Finalization must match workspace/preparation/Campaign/planning lineage; runs must match exact workspace/Campaign/finalized version. Do not mix sibling preparations, foreign tenants or another Campaign version's runs.

Return a minimized strictly validated frozen projection, not full canonical receipt JSON, review/preview fingerprints, actor-private request keys, credentials, content bodies or original provider payloads. Current role, observation time, display names, historical/current version labels and navigable exact IDs are sufficient. Status labels do not establish current approval eligibility, valid previews, launch capability or external delivery. Errors are not an empty success; missing membership/package is not-found. No new mutation authority, browser storage, result cache, worker or migration is expected.

## Acceptance and documentation

Cover all roles, exact tenant/package scope, removed membership, absent/empty packages, multiple preparations and revisions, draft edits/archives/missing pointers, no cross-generation substitution, exact finalized-version run isolation, pagination/lookahead/limits, SQL read-only execution and failure propagation. Build fixtures through real package approval/preparation/finalization wherever those guards apply; no production writes or provider sends.

Verify authenticated server-page routing and rejection of query authority, readable links/empty states, refresh, desktop/mobile/keyboard behavior and production login restrictions. Repeat local/cloud tests, static/build/native checks and relevant packaging/migration gates. Document every important DTO field, tuple/dictionary/collection, SQL filter, lifetime, link contract, limit, historical/current distinction, deployment and recovery rule in repository references and the existing Google development parent/five children. Continue broader product work after acceptance.
