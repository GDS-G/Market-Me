import Link from "next/link";
import { ArrowUpRight, BarChart3, BookOpenCheck, BrainCircuit, CalendarDays, Compass, FilePenLine, Files, FileStack,
  FolderKanban, LayoutDashboard, Megaphone, MessageSquareText, MonitorSmartphone, PlugZap, Settings,
  ShieldCheck, Users, UsersRound } from "lucide-react";

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/getting-started", label: "Start here", icon: Compass },
  { href: "/smart-sources", label: "Smart Sources", icon: FolderKanban },
  { href: "/context-packs", label: "Context Packs", icon: BookOpenCheck },
  { href: "/content-packages", label: "Content Packages", icon: FileStack },
  { href: "/drafts", label: "Drafts", icon: FilePenLine },
  { href: "/assets", label: "Assets", icon: Files },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/conversations", label: "Conversations", icon: MessageSquareText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
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

/** One server-rendered destination inventory for both responsive presentations. */
export function WorkspaceNavigation({ activePath }: { activePath: string }) {
  return <nav aria-label="Primary navigation">
    <p className="nav-label">Workspace</p>
    {navigation.map(item => <Link key={item.href} href={item.href} prefetch={false} className={`nav-item ${activePath === item.href ? "active" : ""}`}
      aria-current={activePath === item.href ? "page" : undefined}>
      <item.icon size={17} aria-hidden="true" /><span>{item.label}</span>
    </Link>)}
    <p className="nav-label nav-label-spaced">Manage</p>
    {manageNavigation.map(item => <Link key={item.href} href={item.href} prefetch={false} className={`nav-item ${activePath === item.href ? "active" : ""}`}
      aria-current={activePath === item.href ? "page" : undefined}>
      <item.icon size={17} aria-hidden="true" /><span>{item.label}</span>
    </Link>)}
  </nav>;
}
