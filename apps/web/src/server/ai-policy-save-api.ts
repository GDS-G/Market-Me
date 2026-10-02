import { AiPolicySaveError, AI_POLICY_SAVE_LIMITS, isAiPolicySaveError, normalizeAiPolicySaveRequest } from "@market-me/database";
import { AuthenticationError, requireAuthenticatedUser } from "./auth";
import { getAiRepository } from "./database";
import { preparationOriginAllowed } from "./campaign-preparation-api";

class PolicyTransportError extends Error {
  constructor(readonly code:string,readonly status:number,message:string) {super(message);}
}
export function aiPolicySaveResponse(value:unknown,status=200) {
  return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
}
export function aiPolicySaveApiError(error:unknown):Response {
  if(error instanceof PolicyTransportError) return aiPolicySaveResponse({error:{code:error.code,message:error.message}},error.status);
  if(isAiPolicySaveError(error)) return aiPolicySaveResponse({error:{code:error.code,message:error.message}},
    error.code==="access_denied"?403:error.code==="not_found"?404:error.code==="invalid_input"?422:409);
  if(error instanceof AuthenticationError) return aiPolicySaveResponse({error:{code:"authentication_required",message:"Sign in to save or recover AI policy settings."}},401);
  console.error("AI policy save result unavailable; private requests and persistence details were not logged.");
  return aiPolicySaveResponse({error:{code:"policy_save_unavailable",message:"No confirmed result was received. Check the saved request before retrying; do not assume it failed."}},503);
}
async function readPolicyJson(request:Request):Promise<unknown> {
  if(request.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json") {
    throw new PolicyTransportError("unsupported_media_type",415,"Send policy settings as application/json.");
  }
  const limit=AI_POLICY_SAVE_LIMITS.requestBytes;
  const tooLarge=()=>new PolicyTransportError("request_too_large",413,"Policy settings exceed the bounded request limit.");
  if(Number(request.headers.get("content-length"))>limit) throw tooLarge();
  const reader=request.body?.getReader();
  if(!reader) throw new AiPolicySaveError("invalid_input","Provide a JSON policy request.");
  const chunks:Uint8Array[]=[]; let length=0;
  try {
    for(;;) {
      const chunk=await reader.read(); if(chunk.done) break; length+=chunk.value.byteLength;
      if(length>limit){await reader.cancel();throw tooLarge();} chunks.push(chunk.value);
    }
    const bytes=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  } catch(error) {
    if(error instanceof PolicyTransportError) throw error;
    throw new AiPolicySaveError("invalid_input","Provide valid UTF-8 JSON policy settings.");
  } finally {reader.releaseLock();}
}
/** Shared by the new endpoint and the old PUT path; there is no unguarded browser bypass. */
export async function saveAiPolicyRequest(request:Request):Promise<Response> {
  try {
    if(!preparationOriginAllowed(request.headers.get("origin"),process.env.APP_BASE_URL??"")) {
      throw new PolicyTransportError("origin_forbidden",403,"Save policy settings from this application only.");
    }
    if(new URL(request.url).search) throw new AiPolicySaveError("invalid_input","Send policy settings and preconditions in the request body only.");
    const user=await requireAuthenticatedUser();
    const input=normalizeAiPolicySaveRequest(await readPolicyJson(request));
    const result=await getAiRepository().savePolicyExactly(input,user.id);
    return aiPolicySaveResponse({data:result.receipt,meta:{replayed:result.replayed}},result.replayed?200:201);
  } catch(error){return aiPolicySaveApiError(error);}
}
