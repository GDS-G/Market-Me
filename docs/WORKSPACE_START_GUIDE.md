# Workspace Start here guide

Release 1.34 implementation reference. The read-only guide is verified on public main at runtime `515dbf87b6ec84403fa3176092a55768ac24d561`; local, exact feature/main cloud and final Google documentation gates pass. [The scope plan](WORKSPACE_START_GUIDE_PLAN.md) records the bounded contribution toward specification sections 01 and 23. This does not finish the full first-run wizard, semantic content understanding or end-to-end launch acceptance.

## Product behavior and boundaries

`/getting-started` gives the selected workspace a suggested next navigation action plus six persistent stages: source, package, prepare, review, launch and monitor. Overview links prominently to it and now offers review-first `/campaigns/prepare` instead of taking a beginner directly to the advanced editor. The advanced editor remains separately available to writers. Primary navigation includes Start here; the workspace switcher's closed section-root allowlist preserves that route without carrying another workspace's record IDs or query parameters.

The guide never approves, configures, synchronizes, invokes a provider/model, spends money, creates content or execution records, activates work, grants access or sends anything. Every link opens an existing independently authorized surface. There is no new mutation API, server action, completion checkbox, persisted completion percentage, browser storage, worker or provider secret. Session/sign-in and workspace selection remain the existing shell behavior, separate from the read-only guide repository.

All counts are saved-state navigation evidence. Enabled sources are not necessarily healthy. Ready/approved package labels do not prove current approval eligibility. Approved drafts do not prove valid previews, account availability or rights. Published internal plans are not external publications or necessarily executable. Completed runs do not prove external delivery or engagement. Aggregates may concern unrelated objects; they must never be assembled into an inferred per-package end-to-end chain. The UI states these limits beside the counts rather than displaying global readiness or percentage completion.

## Database contract and consistency

`packages/database/src/workspace-start-models.ts` defines frozen `WORKSPACE_START_COUNT_KEYS`, the closed 18-key tuple below. `WorkspaceStartCountKey` is its union; `WorkspaceStartCounts` is a readonly numeric record. `WorkspaceStartSnapshot` adds readonly `workspaceId`, current six-role `role` and server `observedAt` ISO timestamp. It contains no user email, source path, content, credentials, object IDs, private receipts or another actor's pending request.

| Count field | Exact saved-state filter |
| --- | --- |
| `sourceCount` / `enabledSourceCount` | All selected-workspace Smart Sources / those with `enabled=true`. |
| `packageCount` / `packagesToReview` | All selected-workspace packages / status `ready` or `needs_review`. |
| `approvedPackageCount` / `failedPackageCount` | Package status exactly `approved` / `failed`; no attestation validity is inferred. |
| `draftCount` / `draftsToEdit` | Unarchived drafts / their status `working`, `rejected` or `changes_requested`. |
| `approvedDraftCount` | Unarchived draft status exactly `approved`; not current launch eligibility. |
| `campaignCount` | Unarchived Campaign roots. |
| `draftOnlyPlanCount` | Unarchived roots with their own current version exactly `published` and `autonomy_mode=draft_only`. |
| `otherPublishedPlanCount` | Same current-version checks with autonomy other than `draft_only`; not proof of executability. |
| `runCount` / `openRunCount` | All selected-workspace runs / status `awaiting_approval`, `scheduled`, `active` or `paused`. |
| `attentionRunCount` / `completedRunCount` | Run status `paused` or `failed` / exactly `completed`. Paused runs intentionally appear in both open and attention counts. |
| `pendingDraftApprovals` / `pendingWorkflowApprovals` | Respective workspace queues with request status exactly `pending`; not an assigned-to-me or currently-decidable filter. |

`workspaceStartUuid` validates a trimmed RFC-variant UUID of version 1–8 and lowercases it before parameterized SQL. `workspaceStartCount` accepts safe nonnegative integer numbers or canonical decimal bigint strings, rejects missing/null/boolean/object/coercive/exponent/fractional/negative/out-of-range values, and never silently substitutes zero or loses precision. `workspaceStartSnapshot` checks the supported role, valid timestamp and every required count, projects only explicit fields, normalizes timestamp to ISO milliseconds and freezes the DTO. Its invocation-local `counts` dictionary is built from the fixed tuple; the private frozen `roles` array has no tenant data. Missing/invalid projection data fails rather than suggesting a healthy empty workspace.

`WorkspaceStartRepository.getSnapshot(workspaceId, actorUserId)` uses the authenticated actor supplied separately by the server. One SELECT reads `workspace_membership` and seven lateral aggregate groups (`s`, `p`, `d`, `c`, `r`, `da`, `wa`) scoped to that same membership workspace. Each group produces one aggregate row, so groups cannot multiply counts. The Campaign current-version join also requires `cv.campaign_id=c.id`; an unrelated version pointer cannot count as a published plan. `statement_timestamp()` marks the single statement's observation. There is no organization-owner fallback and absent/revoked membership returns `undefined`, not zero-filled content.

Membership, role and counts share the PostgreSQL statement snapshot. A change committed after that snapshot can make the rendered guidance stale; this read does not hold authority locks through later human action or grant a mutation capability. Existing destination operations must recheck current membership and exact resource conditions. The query makes no writes or advisory locks and succeeds inside a database-enforced read-only transaction. Output size is constant, but exact aggregate work scales with selected-workspace rows; this is not a capped scan or performance benchmark. Existing workspace/status indexes support the filters. No cross-request result cache is added.

## Guidance model and precedence

`apps/web/src/server/workspace-start-guide.ts` is a pure presentation mapper. `WORKSPACE_START_STAGE_KEYS` is the frozen ordered tuple `[source, package, prepare, review, launch, monitor]`. `StartGuideAction` has `label` and internal `href`. `StartGuideRecommendation` adds a stable `key`, `title` and saved-state `reason`. `StartGuideStage` adds a stage key, title, description, evidence text, boundary, optional collaborator handoff and signal `empty|saved|attention`. Signals mean no saved activity, saved activity or inspect current state—not blocked, eligible or completed milestones. `WorkspaceStartGuide` holds writer/reviewer booleans, role summary, recommendation and readonly stages.

The frozen `roleDescriptions` dictionary describes only current implementation. Frozen `writers` is owner/admin/editor; frozen `reviewers` is owner/admin/approver. Unknown roles, including prototype-like names, throw. `writerHandoff`/`reviewerHandoff` explain who can perform the separate action. The `count` formatter supplies singular/plural wording. Input `s`, role booleans, `pending`, `approvalsReason`, the selected recommendation and six-stage array are invocation-local. Returned guide, recommendation, stages and each action are frozen. No global per-user authority or mutable completion state exists.

The first matching recommendation wins:

1. Current reviewer and any pending draft/workflow request: inspect the approval queue, explicitly not necessarily assigned to the actor.
2. Any paused/failed run: inspect Campaigns and prior results before considering recovery.
3. Current reviewer and ready/needs-review package: inspect exact package review.
4. Current writer and working/rejected/changes-requested drafts: inspect drafts to revise.
5. Any open run: inspect Calendar, without delivery guarantees.
6. Pending requests for a non-reviewer: collaborator handoff to existing Drafts or Campaigns; no approval shortcut.
7. Writer, approved-labelled drafts and a saved Campaign: inspect Campaigns/original preparation receipts and finalization prerequisites.
8. Writer, approved-labelled packages and no unarchived drafts: open review-first preparation, which revalidates exact approval.
9. Failed packages: inspect content failure history; do not retry automatically.
10. Other saved drafts, then packages, then Campaign/run history: inspect the corresponding existing collection.
11. Writer with no sources and no prior work matched above: open guided source setup.
12. Configured sources but no earlier signal: inspect intake; distinguish zero enabled from enabled without imports and never infer health.
13. Otherwise: ask a workspace writer and inspect Team.

This is deterministic advisory priority, not scheduling or task allocation. A higher-priority suggestion never hides the six stages or turns a count into a per-item decision. Imported, manually prepared and historical work is not forced through a first-source gate. Reviewer-only and read-only roles do not receive preparation, advanced-authoring or source-creation shortcuts. Writer-only users receive explicit reviewer handoffs rather than an approval action.

## Server page, navigation and accessibility

`apps/web/src/app/getting-started/page.tsx` authenticates, resolves the membership-checked active workspace, rejects every query key, and requests one snapshot with the exact user/workspace IDs. Missing/mismatched scope returns not-found; storage/query errors propagate to normal error handling, never an empty-success fallback. Fresh snapshot role controls guidance, not the earlier active-workspace role. The page is server-rendered on demand; there is no guide client controller, effect, state, ref or browser-local persistence.

The fixed `supportingTools` array holds four optional title/href/description objects for Context Packs, Brand/Audience, Destination links and preparation presets. The frozen `signalLabels` dictionary maps the three stage signals to honest text. These static presentation collections contain no grants. A native details/summary provides optional progressive disclosure with keyboard behavior. A six-item ordered list has explicit list/listitem roles so its custom flex layout and removed bullets do not erase accessibility semantics. Number decorations are aria-hidden. Headings, labelled sections and visible focus outlines support navigation; the 640-pixel CSS breakpoint stacks controls and tools and wraps long text.

Guide action Links disable prefetch. The explicit Refresh saved state control is a plain local anchor to `/getting-started`, forcing a fresh request instead of relying on a cached client navigation result. The existing shell's workspace switch revalidates membership, retains only the allowed section root and refreshes scope. There is no query-supplied workspace, role, completion or action parameter. Advanced editing is separately linked for writers only.

`apps/web/src/server/database.ts` adds a `workspaceStart` repository to its shared factory and exposes `getWorkspaceStartRepository`. The instance retains only `sql`. The existing `globalThis.marketMeDatabase` bundle survives hot reload only in development; production does not retain new bundles there. No role, snapshot, count or result is cached. Restart development after modifying repository classes/factory structure.

## Verification, operations and remaining scope

Focused checks cover safe projection/conversion, all six roles, every count filter, revoked/absent/foreign membership, database-failure propagation, read-only execution, precedence conflicts, no invented authority/progress, authenticated page scope, no query authority, current-role rendering, safe workspace-switch return and Overview entry points. Synthetic draft fixtures use the real exact package approval/preparation path before introducing controlled lifecycle states; an initial fixture omission was correctly rejected by the existing generation guard and was fixed in the fixture, not bypassed in application code. Page tests explicitly resolve the real guide/formatting modules in the existing alias-mocking harness.

The final complete local gate passes 2,780 tests/153 files plus static/build/native checks after accessibility/plural refinements. Synthetic desktop/mobile/keyboard/refresh, production authentication and unsigned native packaging pass separately; unchanged post-browser domain counts and 120-migration replay are verified. Exact feature/main runs 36943447300/36943913349 reproduce those TypeScript tests, migrations, static/build checks and both clean audits. Final Google text/style/topology verification passes; [Releases](RELEASES.md) records the evidence. New database coverage is 72 tests; new web decision/page coverage is 61, plus existing selection coverage. Subsequent Related work implementation is separate.

Own metadata is 1.34.0 with no dependency upgrade. No migration is added: keep the frozen 120-file ledger ending in `0120_workspace_member_roles.sql` (SHA-256 `3b993c63971ae6d74ee7c6ca1f30682c6859be13f9b1e2b72f63d7add4e6abe4`). Deploy matching web/database package source together and restart processes; there is no new environment variable, secret, provider, worker or background task. Reverting the guide/navigation source requires no domain-data rollback. Do not edit historical migrations, approvals or receipts to recover a display issue.

This release improves discovery and the workflow map, not the original specification's complete setup/AI/cost experience. It does not establish a connected per-package launch journey, full semantic dry test, automatic source health diagnosis, live OAuth/provider acceptance, arbitrary campaign templates, recurring/evergreen execution, inbox expansion, quality evaluation, hosted deployment or signed/cross-platform distribution. Those remain independent implementation and acceptance work.
