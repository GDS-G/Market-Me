# Responsive workspace navigation

Status: implemented for 1.38; full local, native and production-browser acceptance pass. Cloud/publication evidence is tracked separately in [Releases](RELEASES.md). [Programmer reference](RESPONSIVE_WORKSPACE_NAVIGATION.md) records the delivered components, props, tuples, state lifetime and limits. The sections below preserve the original scope and acceptance intent.

## Observed gap

`globals.css` sets `.sidebar { display: none }` below 761 CSS pixels. `WorkspaceShell` provides no replacement, so narrow screens lose every section link, workspace switcher and sign-out control. The desktop fixed sidebar also lacks explicit overflow management for its long navigation. This was reproduced during 1.37 mobile acceptance; a readable page alone is not a complete mobile workflow.

## Intended implementation

Provide an accessible compact mobile header with the current workspace name and a native, keyboard-operable navigation disclosure. Reuse one definition of the existing Workspace/Manage destinations for desktop and mobile. Preserve current authentication, existing scoped WorkspaceSwitcher action, exact safe section-root returns and server-side membership checks; never invent new workspace or account authority. Mark the active route with aria-current and provide a skip-to-main path. Keep only the appropriate navigation surface visible/focusable at each breakpoint, make long names wrap, and preserve access to the last links/sign-out at short heights. An in-flow disclosure avoids an unnecessary modal/focus trap. Collapse/reset temporary menu state on route/workspace changes without storing preferences or sending requests just to open the menu.

No new API, database schema, permission, provider call, account change or automatic action. A duplicated responsive presentation may reuse the same server-loaded selection, but must not duplicate repository loads, DOM IDs or exposed landmarks. Do not turn narrow layout into a new source of stale cross-workspace forms.

## Acceptance

Cover authenticated/no-workspace redirects, all 17 destination links and exact active-state semantics, current selection rather than stale passed labels, shared action inputs, unique switcher labels, no added repository calls and native menu key/reset behavior. Browser-test desktop, 760/761 breakpoints, narrow/short layouts, keyboard open/close, focus visibility, navigation to a real page, existing-workspace switching, return to correct section root, and long-name wrapping. Do not log out merely to prove that the existing button is reachable. Verify no domain/provider changes and reset temporary browser viewport overrides. Document component props, navigation collections, disclosure lifetime and release evidence in the repository and existing Google development tabs.
