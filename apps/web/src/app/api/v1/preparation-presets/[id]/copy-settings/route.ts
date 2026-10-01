import { z } from "zod";
import { preparationPresetUuid, PreparationPresetError } from "@market-me/database";
import { requireWorkspaceAccess } from "@/server/auth";
import { getPreparationPresetRepository } from "@/server/database";
import { presetApiError,presetResponse,requirePresetOrigin } from "@/server/preparation-preset-api";
import { readSourceSetupJson } from "@/server/source-setup-api";
const body=z.strictObject({workspaceId:z.uuid(),expectedRevision:z.number().int().min(1).max(2_147_483_647),versionNumber:z.number().int().min(1).max(2_147_483_647)});

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    requirePresetOrigin(request);
    const id=preparationPresetUuid((await context.params).id),parsed=body.safeParse(await readSourceSetupJson(request));
    if(!parsed.success)throw new PreparationPresetError("invalid_input","Choose an exact preset revision and version to copy.");
    const {workspaceId,expectedRevision,versionNumber}=parsed.data;
    const {user}=await requireWorkspaceAccess(workspaceId,"write");
    return presetResponse({data:await getPreparationPresetRepository().copySettings(workspaceId,id,expectedRevision,versionNumber,user.id)});
  }catch(error){return presetApiError(error);}
}
