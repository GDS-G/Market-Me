# Immutable draft claim evidence

Status: 1.21 prerequisite implemented with passing local integration/build gates; final browser/source/cloud evidence is tracked in [Releases](RELEASES.md). The approved source-to-campaign experience requires historical claims to remain traceable when source files change. The broader starter is specified separately in [Campaign preparation](CAMPAIGN_PREPARATION_PLAN.md).

## Reproduced defect

`MarketMeRepository.saveContentPackage` replaces current evidence and increments the package revision. Migration 0019 made the live `evidence_item` foreign key cascade those deletions into `content_draft_claim_evidence`. The original generation snapshot, approved copy and version survived, but each claim's evidence IDs could disappear. A real ingestion-path refresh regression reproduced this; no live provider action was involved.

The snapshot is historical evidence, not approval for refreshed content. Old approvals must remain attached to their original draft version. The refreshed package still requires its own review, and a new generation must use its new evidence.

## Intended storage and validation contract

Migration `0110_immutable_draft_claim_evidence.sql` removes the live-evidence foreign key while retaining the existing UUID column and the claim-owned cascading lifecycle. `evidence_item_id` now identifies captured evidence in that claim's exact generation snapshot; absence of a current live row is normal after refresh. Do not use a current-package join to render historical trace.

`draft_claim_snapshot_reference_valid(claim_id, evidence_id)` verifies the claim/version/draft/generation/campaign/package workspace lineage, immutable `presentation_choices.factOrder`, snapshot ID uniqueness, matching captured claim text and supported provenance. Validation must establish a complete nonnegative contiguous factual claim order, not merely find identical text at one index. Repeated identical claims and a partially dropped historical fact list cannot justify a guessed mapping.

The trigger rejects new or changed links without that proof and disallows changing an existing claim/evidence identity. Because whole-version validation needs every factual claim present, writers insert all claims first, then all links within the same transaction. Both ordinary draft generation/revision and AI proposal application must use this ordering. Direct database-owner mutation of snapshots/claims remains outside the application authority model; this trigger is not a general tamper-proof database ledger.

The one-time backfill restores only provable, entirely unlinked claims. It must not augment contradictory surviving references, infer from text alone, use a current package's evidence, or guess for missing/ambiguous metadata. Unrecoverable historical evidence remains unavailable. Do not repeatedly rerun or broaden a backfill to conceal missing history.

## Read and revision behavior

Historical draft reads resolve recorded IDs against `draft_generation.evidence_snapshot`. The UI differentiates linked trace, unavailable history and a genuinely presentation-only call to action. A factual claim with no links must never receive the presentation-only label. Missing or duplicate snapshot IDs and absent source-reference text are explicitly disclosed.

Revision queries retain every factual claim with left joins. Missing factual evidence fails closed instead of disappearing from an inner join while surviving facts are copied. AI revision context must validate references before constructing a paid-provider intent; eventual rejection during apply is not enough. New output never inherits approval automatically.

`DraftRepository.generate` holds a shared lock on the exact package row while checking approval, reading its revision/evidence and persisting the generation snapshot. This coordinates with package replacement and prevents mixing a refreshed evidence set with an earlier approved revision. It is not a claim of immutability for every other source, asset or provider resource.

## Collections and lifetimes

- `generation.evidenceSnapshot`: immutable captured evidence objects, each with ID, claim, provenance and source references plus recorded optional metadata. Historical display reads this collection rather than live evidence.
- `version.presentationChoices.factOrder`: server-created ordered selected evidence IDs; revisions preserve it. It is proof only when the entire factual claim sequence and snapshot are consistent.
- `claim.evidenceItemIds`: persisted historical UUID references, not current evidence row ownership and not authorization to send.
- Writer-local prepared-claim arrays: temporary `{claimId, sortOrder, claim}` records to insert a complete claim set before links. They are transaction-local and contain no global mutable state.
- `describeDraftClaimTrace` result: `{status: linked | unavailable | presentation, text}` for display only. It describes recorded references; it does not verify factual truth, approve copy or grant execution authority.

No new environment variable or provider call is required. Package revision, user approval and campaign authority remain separate concepts.

## Rollout and acceptance

Stop/drain incompatible generation and revision writers before applying migration 0110 and deploying compatible code. Old interleaved writers can fail the whole-version trigger on multi-fact drafts. Retain historical snapshots and links; do not restore the destructive live-evidence cascade during rollback. Review exact SQL and compatibility behavior before release.

Local acceptance covers real source refresh, normal and AI revisions, foreign/malformed/contradictory proof, partial historical losses, an eight-case legacy upgrade from schema 109, clean 110-migration replay/checksums, the full 693-test suite, type/lint/build, native packaging and audits. The independent historical rehearsal restored three provable missing links while leaving ambiguous records untouched. Final browser and cloud evidence is recorded in Releases only after verification; no live-provider or whole-product acceptance is implied.
