# Searchable asset inventory

Status: implemented as1.49 with local/native/browser/mobile/production acceptance passed;exact-source cloud and final Google verification are pending. Specification01 explicitly includes searchable assets alongside packages,drafts and generated variants; section06 distinguishes primary/supporting/generated assets and their rights/readiness records. Package filename search finds packages but did not provide a bounded inventory of individual assets. Existing package review remains the authority for complete evidence and asset access. [Contract](ASSET_CATALOG.md) and [release evidence](RELEASES.md) describe the delivered boundary.

## Intended experience

Add a read-only Assets destination to the shared desktop/mobile navigation. Search current stored filename,MIME type and package title using literal case-insensitive substrings,with an existing asset-role filter: original,supporting,derivative. Display at most30 records,newest added first,exact complete inventory/match totals,original filename,MIME,nullable exact byte count,role,package label and recorded extraction/media/scan/rights states. Label these as recorded metadata,not current legal permission,verified safety,download eligibility or publishing readiness. Missing size is distinct from zero. Open the existing package review for full evidence and governed actions.

Do not download originals,sign URLs,load thumbnails,inspect extracted document bodies,refresh providers,create derivatives or change rights. Search only selected metadata fields; no content hashes,object/provider keys,source paths,recipes,private rights notes or claims in this inventory. Each stored asset is a separate record,not a promise of globally deduplicated files.

## Contract and safety

One current-membership SQL statement scopes coherent package/Smart Source/root-source lineage and optional source-item/immediate-parent-asset workspace references. Exclude mismatched linked metadata rather than following it across workspaces. Current asset root has created_at but no updated_at,so ordering must honestly say newest added rather than most recently edited. Use exclusive exact microsecond created_at/UUID ordering and a distinct asset-domain cursor bound to workspace/query/role. Recheck membership every request; cursors are not authority or frozen snapshots.

Reuse30-record/120-UTF16-query/512-cursor/1MiB-response bounds and decimal-string counts without converting bigint byte sizes to Number. Body-free metadata search still may scan all eligible rows; no load-performance guarantee. Strict unknown/duplicate query rejection,React escaping,form tuple identity and explicit empty/no-match/exhausted states follow the corrected1.48 catalog conventions. Workspace switching resets query/role controls and URLs. Existing generated asset access,scan evidence,rights enforcement and package review authority remain unchanged.

## Acceptance and exclusions

Cover all roles/revocation,foreign/corrupt package and source lineage,null source/parent/size,zero and beyond-safe-integer bytes,all three roles and recorded states,literal Unicode query syntax,65 tied rows and adjacent microseconds,exact counts/read-only transactions,bounded/minimized DTOs,strict cursor domain/context,auth/query/view states,navigation inventory and filter control identity. Actual isolated browser acceptance must cover metadata search,pagination,empty workspace,reset,reader navigation,mobile/keyboard and production authentication with unchanged domain fingerprints.

No new table,column,dependency,provider credential or paid service is expected. Document every DTO,constant,tuple,query CTE,variable lifetime,UI helper and rollout limit under the existing Google development parent/five children and repository reference. This is not historical/semantic/global search,arbitrary user-assigned asset roles,bulk actions,new downloads,full media understanding or whole-product completion.
