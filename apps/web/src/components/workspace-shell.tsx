import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspaceSelection } from "@/server/active-workspace";
import { WorkspaceSwitcher } from "./workspace-switcher";
import {
  ArrowUpRight,
  BookOpenCheck,
  CalendarDays,
  FileStack,
  FilePenLine,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareText,
  MonitorSmartphone,
  PlugZap,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  WandSparkles,
  BrainCircuit,
} from "lucide-react";

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/smart-sources", label: "Smart Sources", icon: FolderKanban },
  { href: "/context-packs", label: "Context Packs", icon: BookOpenCheck },
  { href: "/content-packages", label: "Content Packages", icon: FileStack },
  { href: "/drafts", label: "Drafts", icon: FilePenLine },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/conversations", label: "Conversations", icon: MessageSquareText },
] as const;

const manageNavigation = [
  { href: "/ai-settings", label: "AI & Cost", icon: BrainCircuit },
  { href: "/audience", label: "Audience", icon: Users },
  { href: "/destinations", label: "Destinations", icon: ArrowUpRight },
  { href: "/integrations", label: "Integrations", icon: PlugZap },
  { href: "/companion", label: "Companion", icon: MonitorSmartphone },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

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
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true"><WandSparkles size={18} strokeWidth={2.4} /></span>
          <span>Market Me</span>
        </Link>
        <WorkspaceSwitcher key={workspace.workspaceId} workspaceId={workspace.workspaceId}
          workspaces={workspaces.map(({ workspaceId, workspaceName }) => ({ workspaceId, workspaceName }))}
          returnPath={activePath} />
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navigation.map((item) => (
            <Link className={`nav-item ${activePath === item.href ? "active" : ""}`} href={item.href} key={item.href}>
              <item.icon size={17} /><span>{item.label}</span>
            </Link>
          ))}
          <p className="nav-label nav-label-spaced">Manage</p>
          {manageNavigation.map((item) => (
            <Link className={`nav-item ${activePath === item.href ? "active" : ""}`} href={item.href} key={item.href}>
              <item.icon size={17} /><span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer session-footer">
          <span className="session-person">{userName}</span>
          <form action="/api/auth/logout" method="post">
            <button aria-label="Sign out" title="Sign out" type="submit"><LogOut size={14} /></button>
          </form>
        </div>
      </aside>
      <main className="main-content resource-main">{children}</main>
    </div>
  );
}
