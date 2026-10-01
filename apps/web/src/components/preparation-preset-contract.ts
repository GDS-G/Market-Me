import { z } from "zod";
import { INFORMATION_DEPTHS,PROMOTIONAL_STRENGTHS } from "@market-me/domain";
const uuid=z.uuid();
const revision=z.number().int().min(1).max(2_147_483_647);
export const presetSettingsSchema=z.strictObject({templateKey:z.literal("general_announcement"),templateVersion:z.literal(1),
  name:z.string().min(1).max(200),description:z.string().max(5_000),brandProfileVersionId:uuid.optional(),audienceProfileVersionIds:z.array(uuid).max(20),
  destinationId:uuid.optional(),informationDepth:z.enum(INFORMATION_DEPTHS),promotionalStrength:z.enum(PROMOTIONAL_STRENGTHS),timezone:z.string().min(1).max(100)});
const scope={workspaceId:uuid,requestId:uuid};
const values={title:z.string().min(1).max(120),notes:z.string().max(2_000),configuration:presetSettingsSchema};
export const presetRequestSchema=z.discriminatedUnion("operation",[
  z.strictObject({operation:z.literal("create"),...scope,...values}),
  z.strictObject({operation:z.literal("revise"),...scope,presetId:uuid,expectedRevision:revision,...values}),
  z.strictObject({operation:z.literal("clone"),...scope,presetId:uuid,expectedRevision:revision,versionNumber:revision,title:values.title}),
  z.strictObject({operation:z.literal("archive"),...scope,presetId:uuid,expectedRevision:revision}),
  z.strictObject({operation:z.literal("restore"),...scope,presetId:uuid,expectedRevision:revision}),
]);
const attemptSchema=z.strictObject({version:z.literal(1),userId:uuid,request:presetRequestSchema});
export const presetReceiptSchema=z.strictObject({...scope,operation:z.enum(["create","revise","clone","archive","restore"]),
  presetId:uuid,versionNumber:revision,revision,archived:z.boolean(),title:values.title,createdAt:z.iso.datetime()});
export const presetVersionSchema=z.strictObject({workspaceId:uuid,presetId:uuid,versionNumber:revision,title:values.title,notes:values.notes,
  configuration:presetSettingsSchema,configurationHash:z.string().regex(/^[0-9a-f]{64}$/),createdAt:z.iso.datetime(),
  copiedFrom:z.strictObject({presetId:uuid,versionNumber:revision}).nullable()});
export type PresetSettings=z.infer<typeof presetSettingsSchema>;
export type PresetRequest=z.infer<typeof presetRequestSchema>;
export type PresetAttempt=z.infer<typeof attemptSchema>;
export interface PresetScope{workspaceId:string;userId:string}
export function presetStorageKey(scope:PresetScope){return `market-me:preparation-preset:v1:${uuid.parse(scope.userId)}:${uuid.parse(scope.workspaceId)}`;}
export function presetDetailPath(workspaceId:string,presetId:string,versionNumber?:number){
  return `/campaigns/presets/${uuid.parse(presetId)}?workspaceId=${encodeURIComponent(uuid.parse(workspaceId))}${versionNumber?`&version=${revision.parse(versionNumber)}`:""}`;
}
export function makePresetAttempt(scope:PresetScope,request:PresetRequest):PresetAttempt{
  const parsed=attemptSchema.parse({version:1,userId:scope.userId,request});
  if(parsed.request.workspaceId!==scope.workspaceId)throw new Error("Preset request belongs to another workspace.");
  if(new TextEncoder().encode(JSON.stringify(parsed)).byteLength>40_960)throw new Error("Saved preset attempt is too large.");
  return parsed;
}
export function restorePresetAttempt(serialized:string|null,scope:PresetScope):PresetAttempt|undefined{
  if(serialized===null)return undefined;
  if(new TextEncoder().encode(serialized).byteLength>40_960)throw new Error("Saved preset attempt is too large.");
  const attempt=attemptSchema.parse(JSON.parse(serialized));
  if(attempt.userId!==scope.userId||attempt.request.workspaceId!==scope.workspaceId)throw new Error("Preset attempt belongs to another account.");
  return attempt;
}
export function parsePresetReceipt(value:unknown,attempt:PresetAttempt){
  const receipt=presetReceiptSchema.parse(value),request=attempt.request;
  if(receipt.workspaceId!==request.workspaceId||receipt.requestId!==request.requestId||receipt.operation!==request.operation
    ||(["revise","archive","restore"].includes(request.operation)&&"presetId" in request&&receipt.presetId!==request.presetId))throw new Error("Preset result belongs to another saved request.");
  return receipt;
}
/** Shared bounded response reader for these small settings/receipts, including errors. */
export async function readPresetResponse(response:Response):Promise<unknown>{
  const maximum=65_536;
  if(Number(response.headers.get("content-length"))>maximum||!response.body)throw new Error("Invalid preset response.");
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{
    for(;;){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;
      if(length>maximum){await reader.cancel();throw new Error("Preset response too large.");}chunks.push(chunk.value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }finally{reader.releaseLock();}
}
export function presetPayloadData(payload:unknown):unknown{return payload&&typeof payload==="object"&&"data" in payload?payload.data:undefined;}
export function presetErrorMessage(payload:unknown,fallback:string):string{
  if(payload&&typeof payload==="object"&&"error" in payload&&payload.error&&typeof payload.error==="object"&&"message" in payload.error
    &&typeof payload.error.message==="string"&&payload.error.message.length<1_000)return payload.error.message;
  return fallback;
}
