# Workspace start guide

Status: Release 1.34 passes final local acceptance after the reviewed 1.33 runtime; exact cloud/publication and Google documentation gates remain in progress. [The programmer reference](WORKSPACE_START_GUIDE.md) records fields, filters, guidance precedence, page/accessibility behavior, lifecycle and boundaries. This is a bounded usability improvement toward specification sections 01 and 23, not completion of their full nontechnical setup or end-to-end acceptance.

## Purpose and scope

Give a new or returning collaborator a plain-language map from folder intake to content review, campaign preparation, draft approval, final launch review and monitoring. Existing tools support those separate operations, but the Overview currently sends a new writer directly to the advanced campaign editor. Add a discoverable authenticated Start here page and an Overview entry point. Prefer the existing review-first campaign preparation path over the advanced editor in the Overview action.

The guide reads saved workspace evidence and offers navigation only. Visiting, refreshing, following a guide link or moving between workspaces must not create records, start synchronization, approve anything, grant permissions, spend money, connect a provider, activate work or send content. No completion checkbox or browser-local completion history may substitute for current server evidence.

## Evidence and permissions

Use one membership-scoped database snapshot with small aggregate counts rather than loading every source, package, draft and campaign into the page. Current authenticated membership selects the workspace and role. Organization ownership alone is not membership. A missing/revoked membership returns no guide; database failures must not be rendered as an empty, healthy workspace. Counts never include another workspace or expose content, credentials, private receipts or another actor's saved requests.

Counts describe current persisted facts, not health, readiness or proof that a particular source produced a particular approved draft. An enabled source is not a working connection; a recorded scan is not necessarily a successful import; an approved package is not a draft approval; an approved draft does not establish current launch eligibility; a published internal plan is not external publication; an activated/completed run is not a verified delivery. Do not infer a joined end-to-end chain from unrelated aggregate counts.

Map owner/admin/editor to existing writer navigation, owner/admin/approver to existing review navigation, and analyst/viewer to inspection plus explicit collaborator handoff. These are guidance only: destination pages and mutation endpoints retain their current authoritative checks. Unrecognized roles fail closed. No new privilege taxonomy or permission grant belongs here.

## Experience

Show a concise recommended next action with its concrete saved-state reason, followed by an ordered, always-available workflow map. Each stage explains its boundary and links to the existing relevant surface. Optional context, Brand/Audience, Destinations and reusable preparation presets are supporting choices, not artificial mandatory setup gates. Explain that preparation creates reviewable draft-only work and finalization/activation are separate.

Do not show a percentage complete, a green global ready state or a launch button derived from counts. Never hide existing pending review behind the instruction to configure a first source; workspaces can contain imported or manually prepared material. Readers may inspect existing work but must not be invited to perform an unauthorized mutation. Advanced campaign authoring remains accessible separately.

Use semantic headings, an ordered list, explicit link labels, visible keyboard focus and a narrow-layout design without horizontal overflow. Refresh recomputes current evidence. Keep the active workspace selector and local return path safe.

## Acceptance

Test all six roles, empty workspaces, pending/approved/rejected/archived state distinctions, enabled-versus-paused sources, draft-only versus executable internal plans, terminal versus open runs and simultaneous competing next-action signals. Prove snapshot isolation to the selected workspace, membership revocation, organization-only denial, zero database writes and bounded count conversion. Test unauthenticated page behavior, current-scope routing, database-failure behavior, role-specific links and no mutation controls in rendered markup.

Run focused and full local/cloud checks, synthetic desktop/mobile browser acceptance and production authentication. Preserve the frozen 120-migration ledger and user pnpm files; no migration, provider secret, worker or dependency change is expected. Document all DTO fields, count filters, collections, decision precedence, repository lifetime, page behavior, remaining limitations and release evidence in repository references and the existing Google development parent/five children. Continue toward broader workflow completion after this increment.
