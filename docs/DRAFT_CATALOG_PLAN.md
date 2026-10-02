# Searchable draft variants

Status: implemented as1.48; corrected local/native/browser/mobile/production,independent exact-source feature/main cloud and final Google acceptance all pass; reviewed runtime43a4cd0da50a5a7706d6ca0c5c46386b08aa8f98 is public on main. Specification section01 explicitly calls for searchable drafts and generated variants. The former Drafts page hydrated every draft's current version,claims and generation evidence,rendered complete bodies and loaded every Campaign/Content Package to construct a generation form,even for readers. It had no search,status filter or paging. [Implemented contract](DRAFT_CATALOG.md) records limits and the browser-discovered form-reset correction; [Releases](RELEASES.md) is the acceptance authority.

## Intended experience

Provide current-workspace literal case-insensitive search of current draft headline/body and displayed Campaign/package/Audience labels, plus a recorded-draft-status filter. Return at most30 lightweight records, exact complete catalog/match totals, explicitly shortened copy excerpts and next/newest navigation. Each generated audience variant remains its own draft; General is a null Audience, not a guessed identity. Display current version number and stored status without implying exact approval, channel readiness or delivery. Open the existing draft detail for full copy, evidence, revisions and actions.

Move the existing generation form to an explicit writer-only Generate drafts page linked from the listing. Preserve its current exact-package-review and server mutation checks and its no-automatic-retry behavior. Ordinary search/paging must not hydrate candidate Campaigns/packages or execute generation. Existing approved-package preparation remains available. The generator's separate selection breadth is not a bounded catalog or a newly authorized generation operation.

## Read contract and safety

Use one coherent membership-scoped SQL projection of draft/current-version/generation/Campaign/package/Audience lineage. Exclude cross-workspace or mismatched current-version references rather than leaking linked names or repairing history. Search only intended current fields; do not expose historical copy, evidence snapshots, claim records, private rationale, profile details or channel payloads. A short body preview must identify truncation and preserve full copy in the detail route; SQL character counts and Unicode boundaries must be explicit.

Reuse the proven timestamp-text/UUID ordering semantics with a draft-domain-separated cursor bound to workspace and normalized filters. Check exact microseconds, context, keys, version and encoding. Every read rechecks membership; cursors are not authority or a frozen multi-page snapshot. Apply strict query/response bounds, reject duplicate/unknown parameters and preserve exact decimal-string counts. Search URLs/history/access logs have the same privacy considerations as package search.

## Acceptance and limits

Prove all reader roles and current revocation, foreign/malformed lineage, current versus historical version search, every stored status, General/Audience behavior, literal Unicode/wildcard/quote matching, matched text outside the excerpt, emoji-safe preview bounds, empty/no-match states, exact totals and65-record tied/adjacent-microsecond pagination. Verify request-local data, read-only SQL, response limits, encoded links, escaped output and generator-page role/approval behavior. Exercise desktop/mobile/keyboard UI against a new isolated synthetic fixture and preserve database fingerprints; retain full local/cloud/native and organized Google/repository documentation gates.

No provider, new credentials, migration or new external action is assumed. Full-text ranking, historical revision search, global cross-object search, bulk operations, new generation semantics, selection-option scalability, semantic understanding and complete application acceptance remain outside this increment. Any schema/index change requires evidence from the actual query, not an unsupported performance claim.
