# Responsive workspace navigation

Implemented and public on main in verified 1.38 from the [scoped plan](RESPONSIVE_WORKSPACE_NAVIGATION_PLAN.md). [Releases](RELEASES.md) separates final local, native/browser, cloud and documentation evidence. This repairs missing narrow-screen navigation and inaccessible lower desktop links; it adds no product authority or persistent state.

## Topology and authority

`WorkspaceShell` remains an authenticated async Server Component. It reads `getAuthenticatedUser` once, redirects missing identity to login, then resolves `getActiveWorkspaceSelection(user.id)` once and redirects missing workspace. Failures propagate. Both responsive presentations reuse that same result; neither creates another repository load. Existing route/API membership and role checks remain authoritative.

Desktop uses the existing sidebar. At widths of 760 CSS pixels or less, existing global CSS hides it and the new CSS module shows an in-flow mobile header, current workspace name and native `details/summary` menu. Exactly one presentation is visible/focusable at a time. Closed native disclosure descendants are not interactive. The menu is not an overlay: no focus trap, body lock, backdrop, modal role or dismissal script is needed. At short desktop heights the sidebar scrolls, its children do not shrink, and its final links/sign-out remain reachable.

Both presentations contain the shared brand, existing `WorkspaceSwitcher`, shared destination inventory and existing sign-out form. React `useId` in the existing switcher supplies distinct select/label IDs even though both copies exist in server markup. Do not hard-code those IDs or replace the existing membership-checked action. The only switcher projection is `{ workspaceId, workspaceName }`; organization/role/other membership fields are not added to its props. Safe section-root return handling remains in the existing switcher/action. No automatic logout is introduced; the POST `/api/auth/logout` button remains explicit.

## Props, collections and lifetimes

| Symbol | Intent and lifetime |
| --- | --- |
| `children` | Existing page content, rendered once inside `main#workspace-main` |
| `activePath` | Existing section-root prop; exact active-link comparison and switch return target; no new route-prefix inference |
| `userName` | Existing display-only footer prop; escaped by React and allowed to wrap |
| `workspaceName` shell prop | Retained in the public type for caller compatibility, but not read; the current selected workspace supplies the displayed name |
| `user`, `workspace`, `workspaces` | Request-local authenticated selection; no newly cached identity, membership or result |
| `navigation` | Module-local readonly tuple of ten `{href,label,icon}` Workspace destinations |
| `manageNavigation` | Module-local readonly tuple of seven `{href,label,icon}` Manage destinations |
| `WorkspaceNavigation({activePath})` | Pure server presentation of both tuples inside the labelled Primary navigation landmark |
| `WorkspaceBrand()` | Shared brand link and decorative icon; no state/side effects |
| `WorkspaceSession({userName})` | Shared display name and explicit existing logout form |
| `styles` | CSS-module class dictionary; presentation only, never authority |

Workspace routes are `/`, `/getting-started`, `/smart-sources`, `/context-packs`, `/content-packages`, `/drafts`, `/campaigns`, `/approvals`, `/calendar`, `/conversations`. Manage routes are `/ai-settings`, `/audience`, `/destinations`, `/integrations`, `/companion`, `/team`, `/settings`. Labels and destinations retain their previous meaning. Exactly matching `activePath` gets the `active` class and `aria-current="page"`; unknown/case-different/nested values do not silently select a different route. Icons are decorative (`aria-hidden`).

All 17 navigation links set `prefetch={false}` so revealing the inventory does not speculatively load destination pages. This does not disable ordinary navigation or claim zero browser/network activity globally; the unchanged visible brand link retains Next's default behavior. The menu's React key is `JSON.stringify([workspace.workspaceId, activePath])`: changing workspace or section remounts it closed, while unrelated same-scope renders need not discard the native open state. Selection/version authority never comes from that key. No `useState`, global value store, local storage, new environment variable or dependency is introduced.

## Accessibility and layout

The first anchor is a focus-revealed Skip to main content link to `#workspace-main`. The target's `tabIndex={-1}` permits explicit focus without an extra normal tab stop. Native summary supports Enter/Space; native selection and submit controls retain keyboard behavior. Visible focus outlines cover sidebar/header links and controls. Mobile navigation/control targets are at least 44 CSS pixels high. Labels are not truncated or replaced with ambiguous icons.

`workspace-shell.module.css` scopes desktop overflow, non-shrinking children, long-name wrapping, mobile visibility/menu borders/spacing/targets and skip/focus styles. Existing global 760-pixel breakpoint remains authoritative for hiding the desktop sidebar. Keep both breakpoint rules aligned. Header/menu content stays in normal flow and may require vertical scrolling; no claim of fitting 17 destinations in one small viewport is made.

Testing the maximum 120-character unbroken name exposed an independent overflow in the Start here introduction. `start-guide.module.css` now gives the resource-header child `min-width:0; max-width:100%` and its paragraph `overflow-wrap:anywhere`. This preserves the full name while allowing the flex child to fit. No name normalization/storage rule changes. A fresh reload, not an old HMR style snapshot, verifies the correction.

## Tests, synthetic fixtures and operations

`workspace-shell.test.ts` adds 28 cases covering all 17 exact active paths, unmatched values, absent identity/workspace, one current selection read, failure propagation, no stale caller label, minimal switcher projection, real unique switcher IDs, menu remount identity, one-workspace presentation and escaped long labels. Auth/selection/Next link/CSS are mocked; the actual switcher and React hooks render. Tests do not submit its action. Together with existing Start here page tests, the focused gate is 44 cases.

Browser acceptance covers 320-by-568, 390-by-844, 760/761 breakpoints, short desktop scrolling, native Enter/Space, skip focus, real navigation and owner/viewer workspace switching. Navigation-only checks preserve the earlier synthetic journey and all 36 AI/audit row fingerprints. A separately seeded `market_me_qa_138_navigation_v1` fixture has two organizations/workspaces, three memberships and exactly two synthetic rename receipts/audits. The seed writes precede measurement; subsequent development and production interactions leave all twelve measured domain-table counts/fingerprints and workspace data identical. Ordinary login/session selection is outside that domain-write claim. Never seed the fixture again just to inspect it; its ignored QA helper's `--status` is read-only and exact-database guarded.

Production reload/switching verifies the built mobile CSS, full long labels, closed reset state and current owner guidance without overflow (305 CSS-pixel content/client widths). Health/authentication/readiness, full regression, unsigned package, frozen migration and cloud evidence are recorded in [Releases](RELEASES.md). Screenshots are inspected locally; viewport overrides reset and temporary servers stopped. Existing older browser-extension response-channel errors are not application regressions.

Deploy via normal web process replacement with the unchanged 120-migration ledger. There is no new configuration or data migration. Reload recovers transient menu state. Rollback restores the prior presentation and its narrow/short-screen limitation; it must not delete sessions, memberships, receipts or content. Responsive navigation is not a full responsive audit of every downstream page, semantic content understanding, provider activation, signed distribution or whole-product completion.
