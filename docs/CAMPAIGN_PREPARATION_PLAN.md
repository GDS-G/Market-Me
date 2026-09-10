# Review-first campaign preparation

Status: planned next vertical slice after the published 1.20 scheduling checkpoint. The immutable draft-evidence prerequisite is being repaired on `codex/review-first-preparation`; the starter itself is not executable support yet. This implements part of conceptual sections 01, 03, 06 and 10, not the complete beginner setup or template specification.

## Why this comes next

The approved setup describes folder selection, plain-language context, copy controls, review behavior, a template or drafts-only choice, dry test, then explicit activation. Current ingestion ends at `saveContentPackage`; `DraftRepository.generate` requires an approved package already bound to a published campaign. Users must construct and publish a campaign before producing its reviewed copy. Approved previews are campaign-bound, so creating an unrelated campaign afterward would violate existing lineage.

A review-first starter should prepare one ordinary campaign and its drafts from an approved package without requiring a workflow graph or JSON. Internal publication of a non-executable planning version must be clearly distinguished from external publishing.

## Prerequisite: immutable claim evidence

A live regression reproduced source refresh removing `content_draft_claim_evidence` links through the live evidence foreign key, while the old approved copy and `draft_generation.evidence_snapshot` survived. An old factual claim could then be mislabeled as presentation-only in the UI. Fix this before simplifying creation; do not let ease of use weaken traceability.

The repair must retain exact claim-to-generation-snapshot identity across refresh, protect workspace/version boundaries, preserve existing approvals only for their original versions, and fail closed for missing factual evidence. Any historical reconstruction needs provable immutable metadata for the entire claim order; duplicate text is not proof. Do not invent missing links or silently drop ungrounded facts from a revision. Historical mappings that cannot be proven must remain visibly unavailable. Migration and compatible writer rollout are separate gates.

## First useful flow

1. An approved package exposes **Prepare campaign** to authorized writers.
2. A short form selects a versioned General Announcement template, optional published Brand/Audience/Destination, and existing Information Depth/Promotional Strength controls. No inferred account, destination, audience contact or attachment.
3. One transaction creates a campaign, an immutable `draft_only` planning version and its governed drafts. Label the result **Prepared—not activated**. Create no campaign instance, workflow command or publication action.
4. Reuse existing draft revision, immutable evidence trace, approval and channel-preview UI. Writing and approval remain distinct permissions.
5. An exact current approved text preview compiles an executable draft version of the same campaign, with `approval_required` and one official API publication step. Optional immediate/exact/window timing must obey existing supported-route checks.
6. Present the final plan and hand off to explicit version publication, activation and execution approvals. Never auto-approve or auto-activate.

The compiler emits ordinary `CampaignDraftWrite`; it is not another execution engine. Media automation, source-ready automatic preparation, reusable user-authored/shared templates, recurrence and broader setup follow this bounded slice.

## Transaction and data contract to implement

- Persist a preparation record containing workspace/package IDs, expected package version, template key/version, normalized configuration snapshot/hash, idempotency key, campaign/planning-version/generation IDs and actor/audit identity.
- Unique `(workspace_id, idempotency_key)`: identical retries return the existing preparation; a different payload conflicts. Explicit **Prepare another** generates a new key. A lost HTTP response must not create another campaign.
- Lock and recheck the exact approved package revision before reading its evidence. Resolve profiles/destination within the authorized workspace and pin their published versions. Package refresh produces either a consistent snapshot or a stale-version conflict.
- Extract transaction-scoped helpers from existing campaign and draft repositories. Their public methods currently open separate transactions; calling them sequentially is not atomic orchestration. Do not cast a transaction into a client that then invokes nested `begin`.
- Finalization compares the expected campaign draft/version, current approved draft version, exact preview and account identity. Refuse stale or unrelated changes rather than overwriting user edits. Preserve the planning version that owns the draft generation.
- Template/source text cannot provide execution authority, arbitrary context-derived endpoints, credentials, approval decisions or an external-send bypass.
- Keep immutable preparation metadata separate from mutable presentation labels. Server-owned template versions and normalized inputs make replay auditable; process-local maps or browser state cannot be the idempotency record.

## Reuse points

`packages/ingestion/src/content-package-service.ts` supplies existing readiness and package creation. `packages/database/src/draft-repository.ts` supplies generation, revision, approval and exact previews. `packages/database/src/campaign-repository.ts` owns graph/reference validation, version writes and activation. `apps/web/src/components/content-package-review-actions.tsx`, `draft-channel-previews.tsx` and `campaign-preview-picker.tsx` provide the current user-facing surfaces. `apps/web/src/server/auth.ts` remains the permission entry point. Keep existing provider, rights, autonomy, schedule and idempotency checks intact.

## Acceptance gates

- Folder ingestion → package approval → preparation → reviewed draft → exact preview → executable campaign works without JSON editing.
- Duplicate clicks, concurrent requests and retry after an uncertain response create one preparation; changed payload under the same key conflicts.
- Source refresh cannot erase old draft trace or transfer old approval to new content; revision races fail closed.
- Foreign workspace references, viewer writes and editor approval attempts are denied at server boundaries.
- Preparation creates zero instances, workflow commands and provider actions. Finalization does not activate or contact providers.
- Stale/foreign previews, changed draft/campaign versions and revoked channels are rejected; successful finalization retains exact lineage.
- Existing activation, scheduler, provider uncertainty and approval regression suites still pass, followed by browser, production build and cloud CI checks.

Future automatic ready-event preparation should use a durable outbox and this same idempotent service. Ingestion must not call directly into external publishing.
