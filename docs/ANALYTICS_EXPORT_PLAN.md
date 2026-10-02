# Analytics snapshot downloads

Status: 1.46.0 candidate implemented; local/static/native and actual production-browser file acceptance pass. Independent cloud/publication and Google gates remain pending; [Releases](RELEASES.md) records exact evidence and an optional diagnostic blocked by Chrome. [Developer reference](ANALYTICS_EXPORTS.md) inventories formats, variables and boundaries. Specification section 17 explicitly requests CSV/JSON/API exports. This first export is the existing authorized aggregate report, not raw personal events, complete history or a scheduled BI feed.

## Product and scope

Add explicit CSV and JSON download links to Analytics. Each click obtains a fresh coherent saved-data snapshot for the current workspace and optional Campaign. It does not download the older rendered page verbatim, contact a provider or create records. Explain that details remain capped at 200 event groups and 20 recent runs, while headline counts cover the entire selected scope. Embed coverage, clocks, versioned format and interpretation notes in both file types, including empty reports.

JSON retains exact numeric strings, null versus zero, source labels and the complete allowlisted reporting projection. CSV uses a documented long-form row schema for metadata, totals, status counts, event groups, current provider metrics and recent runs. Every row has an explicit kind; event and provider clocks remain distinct. Exact numeric bytes must never pass through JavaScript Number. CSV consumers must import numeric columns as text to preserve long values and six-place decimals; JSON is the recommended precision-preserving interchange format. No format can establish attribution, real-world completeness, unique people or verified revenue.

## Transport and privacy

Use a versioned, authenticated same-origin GET download route, current active-workspace resolution, a required matching workspace hint and strict single-valued format/Campaign parameters. Recheck repository output scope. The existing SQL membership snapshot remains authoritative for all six reader roles; a hint cannot select or authorize another workspace. Unknown/duplicate parameters, invalid IDs, foreign scope and persistence errors fail closed with fixed non-sensitive errors. Attachment filenames contain only validated IDs/static tokens, never user labels.

Both successful and error responses are private/no-store and nosniff; downloads have attachment disposition and no cross-origin sharing. No speculative prefetch, polling, client store, export job, provider request, audit, migration, environment variable or third-party dependency is added. Export only explicit approved fields rather than spreading runtime objects with potential future sensitive extensions. Enforce a bounded UTF-8 serialized response without silent truncation.

CSV must quote delimiters/quotes/newlines and neutralize spreadsheet formula prefixes in textual fields, including leading whitespace/control characters. Numeric fields use strict decimal/count validation and retain signed numeric adjustments. Document changed formula-like text, empty/null conventions, UTF-8 encoding and the remaining risk of spreadsheet auto-conversion or re-saving imported data. JSON remains exact original label text, not a spreadsheet-safe CSV substitute.

## Acceptance

Tests must prove unauthenticated/revoked/foreign scope failures, strict queries, exact filter retention, all member roles, fixed private errors, allowlisted fields, response/header/filename bounds, exact large and negative numbers, currency/source separation, null/empty/zero distinctions, provider correction semantics inherited unchanged, coverage on empty/truncated reports, quotes/newlines/Unicode and malicious formula labels. Verify keyboard/mobile links and real authenticated downloads against synthetic isolated data, production auth, unchanged database fingerprints, full local/cloud gates and both repository/native Google documentation before final release acceptance.

Full-history/paginated export, raw events, externally authenticated API/BI integrations, delivery schedules, time-window analytics and experiments remain separately scoped requirements. No user input or real provider account is needed for this increment.
