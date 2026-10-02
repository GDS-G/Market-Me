import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspaceSelection } from "@/server/active-workspace";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { LogOut, WandSparkles } from "lucide-react";
import { WorkspaceNavigation } from "./workspace-navigation";
import styles from "./workspace-shell.module.css";

export async function WorkspaceShell({
  children,
  activePath,
  userName,
}: {
  children: ReactNode;
  activePath: string;
  workspaceName: string;
  userName: string;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const { workspace, workspaces } = await getActiveWorkspaceSelection(user.id);
  if (!workspace) redirect("/login");
  return (
    <div className={`app-shell ${styles.shell}`}>
      <a className={styles.skipLink} href="#workspace-main">Skip to main content</a>
      <aside className={`sidebar ${styles.desktopSidebar}`}>
        <WorkspaceBrand />
        <WorkspaceSwitcher key={workspace.workspaceId} workspaceId={workspace.workspaceId}
          workspaces={workspaces.map(({ workspaceId, workspaceName }) => ({ workspaceId, workspaceName }))}
          returnPath={activePath} />
        <WorkspaceNavigation activePath={activePath} />
        <WorkspaceSession userName={userName} />
      </aside>
      <header className={styles.mobileHeader}>
        <WorkspaceBrand />
        <p className={styles.workspaceName}>Workspace: <strong>{workspace.workspaceName}</strong></p>
        <details key={JSON.stringify([workspace.workspaceId, activePath])} className={styles.menu}>
          <summary>Workspace menu</summary>
          <div className={styles.menuBody}>
            <WorkspaceSwitcher key={workspace.workspaceId} workspaceId={workspace.workspaceId}
              workspaces={workspaces.map(({ workspaceId, workspaceName }) => ({ workspaceId, workspaceName }))}
              returnPath={activePath} />
            <WorkspaceNavigation activePath={activePath} />
            <WorkspaceSession userName={userName} />
          </div>
        </details>
      </header>
      <main id="workspace-main" tabIndex={-1} className="main-content resource-main">{children}</main>
    </div>
  );
}

function WorkspaceBrand() {
  return <Link className="brand" href="/">
    <span className="brand-mark" aria-hidden="true"><WandSparkles size={18} strokeWidth={2.4} /></span>
    <span>Market Me</span>
  </Link>;
}
function WorkspaceSession({ userName }: { userName: string }) {
  return <div className="sidebar-footer session-footer">
    <span className="session-person">{userName}</span>
    <form action="/api/auth/logout" method="post">
      <button aria-label="Sign out" title="Sign out" type="submit"><LogOut size={14} aria-hidden="true" /></button>
    </form>
  </div>;
}
