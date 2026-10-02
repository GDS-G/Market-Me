# Review-first campaign and draft preview

Status: 1.44.0 candidate implemented; acceptance is in progress. [Programmer reference](CAMPAIGN_PREPARATION_PREVIEW.md) inventories fields and lifetimes. Specification sections 01, 10 and 23 require users to see intended work before creating or activating it. Previously the manual form loaded an exact approved review but immediately created planning/drafts when submitted. Source-binding plan preview remains structural, not package-specific draft text.

## Product scope

Add an explicit read-only preview of the current General Announcement settings, exact package approval, selected current Brand/Audience/Destination references, single manual review step and ordered channel-neutral draft variants. Show headline, body, optional CTA, evidence citations and deterministic generator identity. No selected audience still yields one General variant. Label this as an unsaved preview, not an approved draft, platform preview, price quote, activation or sending permission.

Use the same pure generation/variant-selection path as durable draft creation and prove byte-for-byte parity for identical current inputs. No model credential, provider call, billable reservation, database row, audit, tracked link or random durable identifier is required. Do not simulate persistence by writing and rolling back. Do not invent media, schedules, destination linking, semantic understanding or future exactness after mutable inputs change.

## Authority and coherence

Normalize with the existing preparation compiler. Inside the existing repository transaction, require current writer membership and lock the same approved package/review and current profile/destination references as preparation. Reuse current communication-policy validation and exact evidence projection; no live unapproved facts or newly inferred claims enter output. Preserve existing lock ordering and retain prepare's independent revalidation. The preview is a bounded observation, not a lease or token that bypasses the write protocol.

Expose a strict same-origin authenticated no-store POST endpoint accepting only input and expectedReviewFingerprint. Reject duplicate/extra query authority, unknown fields, unsupported content types, oversized bodies and mismatched scope. Bound responses without silent truncation; fail with a safe explanation if the exact preview cannot fit. Avoid exposing raw profile JSON, canonical receipt payloads or private persistence errors.

SHA-256 requestDigest binds the response to exact UTF-8 input bytes. This is transport correlation only, not a durable token, receipt, lease or authorization; preparation independently validates current state.

## Browser behavior

Offer Preview campaign and drafts after loading the exact approved package review and before saving. Keep preparation and retry/recovery separate; never create an attempt ID or sessionStorage record for a read-only preview. A saved/unreadable preparation attempt prevents a new preview from replacing its identity. Share the form's synchronous busy fence; no copy, edit or submission may race pending preview work.

Invalidate the preview on any package/review/settings/preset change, account/workspace remount or reset. Late responses must match the exact captured input/review/scope and request generation before display. Failed, malformed, aborted or stale responses preserve the form and cannot show a success or stale preview. Use bounded response parsing and timeout cleanup. New preparation still requires its own exact approval check and durable recovery protocol; preview does not publish or activate anything.

## Acceptance

Cover pure variant parity and no input mutation; no-reference and ordered multi-audience paths; current/stale/revoked package approval and profile/destination policies; role/workspace isolation; request/response size limits and minimization; duplicate clicks, changed-input invalidation and late-response fencing. Compare all relevant database rows before/after read-only preview, then prove saved outputs match the preview while current inputs remain unchanged. Preserve existing preparation replay and protected finalization behavior.

Run full local/cloud/static/native gates and isolated desktop/mobile/keyboard/production acceptance. Document all types, fields, collections, helpers, locks, limits, client lifetimes and version boundaries in the repository and six existing Google development tabs. No new user input is needed to implement this read-only feature; real provider and hosted acceptance remain separate.
