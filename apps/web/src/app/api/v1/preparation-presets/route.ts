import { normalizePreparationPresetRequest, preparationPresetUuid, PreparationPresetError } from "@market-me/database";
import { requireWorkspaceAccess } from "@/server/auth";
import { getPreparationPresetRepository } from "@/server/database";
import { presetApiError, presetResponse, requirePresetOrigin } from "@/server/preparation-preset-api";
import { readSourceSetupJson } from "@/server/source-setup-api";

export async function POST(request:Request){
  try{
    requirePresetOrigin(request);
    const input=normalizePreparationPresetRequest(await readSourceSetupJson(request));
    const {user}=await requireWorkspaceAccess(input.workspaceId,"write");
    const result=await getPreparationPresetRepository().mutate(input,user.id);
    return presetResponse({data:result.receipt,meta:{replayed:result.replayed}},result.replayed?200:201);
  }catch(error){return presetApiError(error);}
}
/** Actor-private recovery; not a public preset or request-key directory. */
export async function GET(request:Request){
  try{
    const query=new URL(request.url).searchParams;
    if([...query.keys()].some(key=>!["workspaceId","requestId"].includes(key))||query.getAll("workspaceId").length!==1||query.getAll("requestId").length!==1){
      throw new PreparationPresetError("invalid_input","Choose one workspace and preset request.");
    }
    const workspaceId=preparationPresetUuid(query.get("workspaceId")),requestId=preparationPresetUuid(query.get("requestId"));
    const {user}=await requireWorkspaceAccess(workspaceId,"write");
    const receipt=await getPreparationPresetRepository().getReceipt(workspaceId,requestId,user.id);
    return receipt?presetResponse({data:receipt}):presetResponse({error:{code:"not_found",message:"No completed preset request was found yet. An earlier request may still finish."}},404);
  }catch(error){return presetApiError(error);}
}
