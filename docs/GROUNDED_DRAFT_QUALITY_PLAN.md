# Grounded draft quality and representative evaluation

Status: next independent increment after responsive navigation 1.38; implementation/evaluation has not yet been accepted. Specification sections 06, 19 and 23 require traceable output and representative quality gates, not just a count of passing infrastructure tests.

## Observed implementation and gaps

`generateGroundedDraft` is a deterministic evidence-copying template, not semantic understanding or a local language model. It selects current non-unresolved evidence in provenance/ID order with depth and format budgets, then records exact evidence IDs. Brand/audience inputs affect presentation. Repository approval, policy and lineage checks remain outside the pure generator and must stay authoritative.

The existing generator has three direct cases, not a representative evaluation corpus. A read-only synthetic reproduction confirms a mismatch with its verbatim-fact contract: `claim.trim().replace(/[.!?]?$/, ".")` turns “Is registration required?” into “Is registration required.” and removes an exclamation while the saved claim record still retains it. Reported characterCount is the sum of body/CTA fields (45 in the fixture); selection reserves one separator (46), whereas channel preview joins those fields with two newlines (47). Duplicate 1000-character format budgets also label a direct_message failure social_standard. These are observed distinct contracts, not proof of provider delivery overflow or an authority bypass.

The same punctuation reconstruction exists in manual draft revision and accepted AI-presentation proposal application. Any fix must cover all three paths. Existing revision/application count checks and presentationChoices also need a coherent, explicitly versioned base-copy measurement; do not relabel it as a final provider-specific count. Repository checks still require immutable factual references and create a new working successor rather than modifying historical content.

## Intended bounded work

Create a versioned synthetic, industry-neutral evaluation set for the deterministic draft path: negative/conditional facts, punctuation, Unicode, unresolved/superseded exclusions, evidence order, depth selection, audience parity, all supported formats, exact boundary cases and no-fit failure. Expected outputs/IDs and source-preservation invariants must be independently stated; do not construct expected results using the production algorithm. Add mutation-style evaluator checks proving that changed facts, missing/wrong citations or exceeded limits actually fail the gate.

Repair only demonstrated presentation/measurement defects while retaining deterministic ranking, whole-claim selection, depth/promotion choices and current repository authorization. If generated output changes, version the generator/prompt identity for new batches and record the rendering contract on new presentation snapshots; historical batches/versions/approvals remain unchanged. Explicitly reviewed revision/application creates a new working version and requires its ordinary subsequent approval. Keep standard output character limits distinct from provider-specific counting, URLs, hashtags, destinations or final channel preview acceptance. Approved inferred evidence remains governed by existing review rules; this work must not silently invent a new epistemic authorization policy.

Integrate the evaluation gate with existing workspace/cloud checks and expose a reproducible developer command/report. Document fixture IDs, schema, evaluator predicates, collections, expected failures, generator identity, reference preservation and promotion/rollback boundaries. No external model calls, paid usage, provider credentials, corpus upload or personal data are required. Human assessment of copy usefulness and real model quality remain separately necessary; a synthetic deterministic corpus does not establish those outcomes.

## Acceptance

First reproduce the punctuation/count/error-label mismatches on the current implementation. Then require all regression/evaluation cases, exact independent expected output/IDs, zero unresolved/superseded leakage, no input mutation, repeatability, honest no-fit errors, correct version capture in real draft/preparation repositories and preservation of existing history. Run full static/test/build/native and cloud gates in proportion to the final change. If a behavioral repair reveals a broader fact-selection or financial/permission decision, scope it explicitly instead of silently folding it into this increment.
