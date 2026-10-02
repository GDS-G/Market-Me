# Searchable, bounded Content Package catalog

Status: planned as the next independent increment after 1.46. Specification section 01 explicitly calls for searchable content and a nontechnical review-first experience. The current package page loads every package plus full asset/evidence details before rendering a list, has no search/status filter and reports the loaded array size as its catalog total.

## User experience

Replace only the Content Packages listing with current-workspace title/filename search, a plain-language recorded-status filter, at most30 lightweight results per page and an explicit next-page link. Keep the package detail/review route and all mutation permissions unchanged. A GET form retains selected workspace scope, clears an old cursor when changing filters and makes results linkable. Show complete matching counts separately from the current page; distinguish no packages from no matching results. Offer clear/reset and first-page navigation. Readers can search without writer permissions; no read action creates or approves content.

Search is literal case-insensitive substring matching over current package titles and same-workspace attached asset filenames only. It is not semantic search, source truth, full document-body search or evidence eligibility evaluation. Escape wildcard-like input through parameterized literal matching rather than treating it as a query language. Trim only the outside whitespace; bound query length and reject unsupported controls/duplicate parameters. Status filters use existing stored statuses with honest display labels.

## Repository and paging

Add a focused read projection with authenticated actor/current workspace membership in the same SQL statement snapshot as count and page results. Do not reuse the unrestricted listContentPackages detail loader or change its existing generation/worker consumers. Return only display identities,title,stored status/confidence,updated timestamp,exact string counts for assets/evidence and a bounded filename preview with explicit omitted-file count. No full evidence text,extracted content,provider metadata,storage location,private receipts or credentials belongs in the catalog response.

Use deterministic updated_at DESC/id ordering and a validated keyset cursor carrying exact timestamp/ID and bound filter/workspace identity. Cursor encoding is not authorization. Every page rechecks current membership and scope; stale filters/foreign cursor context fail safely. Each page is a coherent observation but pages do not share a frozen transaction: concurrent edits can move records, and Refresh/first page recomputes current results. No global user/search/result cache. Bound UTF-8 response bytes without silent truncation. Keep complete count exact, never cast SQL counts through Number.

## Acceptance and boundaries

Prove all reader roles,revocation/foreign workspace isolation,malformed/duplicate queries,empty/no-match states,literal wildcard/Unicode/quote input,all statuses,asset/title matching,exact counts and stable tied-timestamp paging without duplicates on unchanged data. Verify bounded response/filename previews,minimized fields,read-only execution,current-scope checks,URL escaping and no-prefetch detail/paging links. Exercise actual desktop/mobile/keyboard form/filter/pagination against isolated synthetic records,unchanged database fingerprints,production authentication,full local/cloud/native gates and existing Google/repository documentation.

No provider connection,user choice,new external permission or activation is needed. Draft/asset-body/global cross-object search,fuzzy ranking,full-text indexes,bulk actions,arbitrary date filters and a transaction-frozen multi-page export remain separate work. Schema/index needs will be decided from the existing model before implementation; no unsupported performance guarantee is implied by bounding result size.
