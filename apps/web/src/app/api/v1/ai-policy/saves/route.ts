import { AiPolicySaveError, aiPolicySaveUuid } from "@market-me/database";
import { requireAuthenticatedUser } from "@/server/auth";
import { getAiRepository } from "@/server/database";
import { aiPolicySaveApiError, aiPolicySaveResponse, saveAiPolicyRequest } from "@/server/ai-policy-save-api";

export async function POST(request:Request){return saveAiPolicyRequest(request);}
/** Current writer + original actor only. No key/receipt directory is exposed. */
export async function GET(request:Request){
  try {
    const user=await requireAuthenticatedUser(),query=new URL(request.url).searchParams,allowed=["workspaceId","requestId"];
    if([...query.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>query.getAll(key).length!==1)) {
      throw new AiPolicySaveError("invalid_input","Choose one workspace and exact request identifier.");
    }
    const workspaceId=aiPolicySaveUuid(query.get("workspaceId")),requestId=aiPolicySaveUuid(query.get("requestId"));
    const receipt=await getAiRepository().getPolicySaveReceipt(workspaceId,requestId,user.id);
    return receipt?aiPolicySaveResponse({data:receipt}):aiPolicySaveResponse({error:{code:"not_found",
      message:"No completed policy save was found yet. An earlier request may still finish."}},404);
  }catch(error){return aiPolicySaveApiError(error);}
}
