import { CampaignPreparationTemplateValidationError, isPreparationPresetError, PreparationPresetError } from "@market-me/database";
import { SourceSetupInputError } from "@market-me/domain";
import { AuthenticationError, AuthorizationError } from "./auth";
import { preparationOriginAllowed } from "./campaign-preparation-api";
import { SourceSetupTransportError } from "./source-setup-api";

export function presetResponse(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});}
export function requirePresetOrigin(request:Request){
  if(!preparationOriginAllowed(request.headers.get("origin"),process.env.APP_BASE_URL??""))throw new SourceSetupTransportError("origin_forbidden",403,"Manage preparation presets from this application only.");
  if(new URL(request.url).search)throw new PreparationPresetError("invalid_input","Send preset settings in the request body only.");
}
export function presetApiError(error:unknown):Response{
  if(error instanceof SourceSetupTransportError)return presetResponse({error:{code:error.code,message:"Use this application and a bounded application/json preset request."}},error.status);
  if(error instanceof SourceSetupInputError||error instanceof CampaignPreparationTemplateValidationError)return presetResponse({error:{code:"invalid_input",message:"Review the preset fields and provide valid bounded JSON settings."}},422);
  if(isPreparationPresetError(error))return presetResponse({error:{code:error.code,message:error.message}},error.code==="access_denied"?403:error.code==="not_found"?404:error.code==="invalid_input"?422:409);
  if(error instanceof AuthenticationError)return presetResponse({error:{code:"authentication_required",message:"Sign in to manage preparation presets."}},401);
  if(error instanceof AuthorizationError)return presetResponse({error:{code:"access_denied",message:"Current workspace writer access is required."}},403);
  console.error("Preparation preset operation failed; private settings and persistence details were not logged.");
  return presetResponse({error:{code:"preset_unavailable",message:"No confirmed result was received. Check your saved request before retrying; do not assume it failed."}},503);
}
