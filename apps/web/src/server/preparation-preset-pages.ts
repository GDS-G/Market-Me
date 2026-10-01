import "server-only";
import { notFound,redirect } from "next/navigation";
import { getAuthenticatedUser } from "./auth";
import { getActiveWorkspace } from "./active-workspace";
import { getCampaignRepository,getProfileRepository } from "./database";
import type { PresetChoices } from "../components/preparation-preset-form";

export async function presetPageScope(workspaceId?:string|string[]){
  const user=await getAuthenticatedUser();if(!user)redirect("/login");
  const workspace=await getActiveWorkspace(user.id);if(!workspace)redirect("/login");
  // A link from another workspace must never silently fill the active one's form.
  if(workspaceId!==undefined&&(typeof workspaceId!=="string"||workspaceId!==workspace.workspaceId))notFound();
  return {user,workspace,canWrite:["owner","admin","editor"].includes(workspace.role)};
}
export async function presetChoices(workspaceId:string):Promise<PresetChoices>{
  const [brands,audiences,destinations]=await Promise.all([getProfileRepository().listBrandProfiles(workspaceId),getProfileRepository().listAudienceProfiles(workspaceId),getCampaignRepository().listDestinations(workspaceId)]);
  return {
    brands:brands.filter(p=>p.status==="published"&&p.currentVersion?.status==="published").map(p=>({id:p.currentVersion!.id,name:p.name,versionNumber:p.currentVersion!.versionNumber})),
    audiences:audiences.filter(p=>p.status==="published"&&p.currentVersion?.status==="published").map(p=>({id:p.currentVersion!.id,name:p.name,versionNumber:p.currentVersion!.versionNumber})),
    destinations:destinations.filter(d=>d.status==="published").map(d=>({id:d.id,title:d.title})),
  };
}
export function presetPageNumber(value:string|string[]|undefined,maximum=2_147_483_647):number|undefined{
  if(value===undefined)return undefined;
  if(typeof value!=="string"||!/^[1-9][0-9]*$/.test(value)||Number(value)>maximum)notFound();
  return Number(value);
}
