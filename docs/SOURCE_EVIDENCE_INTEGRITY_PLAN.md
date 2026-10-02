# Source-evidence integrity

Status: release 1.40 is verified and published after release 1.39. Six pre-fix baseline tests reproduced five failures/one pass; final local and exact-source feature/main cloud gates pass 3,109 tests/169 files plus 44/44 quality evaluations. Both cloud dependency audits, native/unsigned packaging, isolated browser/mobile/production checks and final Google synchronization pass. [Implementation and variable reference](SOURCE_EVIDENCE_INTEGRITY.md) records the completed contract; [Releases](RELEASES.md) records exact source and separate evidence. These changes are not part of 1.39 runtime evidence.

## Observed problem

ContentPackageService currently promotes extractedText.slice(0, 500) to observed evidence with confidence 1. This can cut a qualification, negation or Unicode pair. It also promotes a partial extraction even when media metadata says truncated; the needs_review package label alone does not prevent approval, because the exact-review evaluator blocks unresolved evidence, not that workflow label. The service additionally creates a synthetic observed claim describing the file name/path, allowing transport metadata to become marketing copy. This is not proof that any real publication used unsafe text.

## Bounded correction

For new ingestion snapshots, retain complete captured extracted text and existing extraction diagnostics on the original asset. Admit text as observed evidence only when the extraction is completed, nonempty, free of reported incompleteness/error, and the entire trimmed text fits the existing 500 UTF-16-unit automatic-evidence bound. Never select a prefix or pretend sentence splitting guarantees independent meaning. Oversized, incomplete, failed, skipped or empty source text instead creates an explicit unresolved review item with original source/hash references and no invented confidence. A current approver can use the existing fingerprint-guarded correction workflow to record a supported fact after reviewing the source; package approval remains separate.

Keep file name/path as asset provenance, not generated factual evidence. Document assessment version, exact length unit/bound, reasons and metadata lifetime. Structured Context Pack resolution remains unchanged, but cannot bypass an unresolved source review. This deliberately makes unsupported content require human review rather than letting source metadata stand in for understanding. It is not semantic extraction, OCR, source-truth verification or automatic summarization.

No historical evidence, package approval, draft or receipt will be rewritten. No new provider calls, AI spending, automatic approval/publication, credential requirement or schema migration is intended. Preserve raw asset bytes/text and existing scan, rights, accessibility and source-readiness gates. Parser fidelity and decoding behavior are distinct limitations, not claimed solved by a completeness flag.

## Verification

Reproduce the current mid-sentence and partial-extraction promotion before changing runtime code. Independently test exact 500/501 boundaries, condition/negation suffixes, Unicode, outer whitespace, completed short text, every supported extraction state, unknown/malformed diagnostics, blank/missing text, error status and metadata preservation. Prove no transport-only claim or incomplete prefix becomes eligible evidence.

Exercise actual ingestion into an isolated database, exact-review blocking, explicit correction, approval and downstream grounded generation, including immutable pre-correction history and normal current-role/fingerprint enforcement. Inspect the captured full source text and correction workflow in the browser at desktop/mobile sizes. Run full local/cloud static, regression, evaluation, build and appropriate packaging checks; update programmer references and the existing Google development parent/five child tabs. Existing user files remain excluded from commits.
