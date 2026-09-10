import { getActiveWorkspace } from "@/server/active-workspace";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CampaignForm } from "@/components/campaign-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getAuthenticatedUser } from "@/server/auth";
import { getCampaignRepository, getProfileRepository, getPublishingRepository, getRepository } from "@/server/database";

export default async function NewCampaignPage() { const user = await getAuthenticatedUser(); if (!user) redirect("/login"); const core = getRepository(); const workspace = await getActiveWorkspace(user.id); if (!workspace) redirect("/login"); const profileRepo = getProfileRepository(); const [packages, destinations, connections, brandProfiles, audienceProfiles] = await Promise.all([core.listContentPackages(workspace.workspaceId), getCampaignRepository().listDestinations(workspace.workspaceId), getPublishingRepository().listChannelConnections(workspace.workspaceId), profileRepo.listBrandProfiles(workspace.workspaceId), profileRepo.listAudienceProfiles(workspace.workspaceId)]); return <WorkspaceShell activePath="/campaigns" workspaceName={workspace.workspaceName} userName={user.displayName}><div className="resource-page form-page"><Link className="back-link" href="/campaigns"><ArrowLeft size={14} />Campaigns</Link><header className="resource-header"><div><p className="eyebrow">New durable workflow</p><h1>Create campaign</h1><p>Start with an acyclic graph; publish the version before activation.</p></div></header><CampaignForm workspaceId={workspace.workspaceId} stepSeed={randomUUID()} packages={packages.filter((item) => item.status === "approved")} destinations={destinations.filter((item) => item.status === "published")} brandProfiles={brandProfiles.filter((item) => item.currentVersion)} audienceProfiles={audienceProfiles.filter((item) => item.currentVersion)} channelConnections={connections.filter((item) => item.status === "active").map(({ id, name, provider }) => ({ id, name, provider }))} /></div></WorkspaceShell>; }
