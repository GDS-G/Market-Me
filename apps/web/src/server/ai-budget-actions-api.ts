import { z } from "zod";
import type { AiBudgetAlert, AiSpendExceptionRequest } from "@market-me/domain";
import { AuthenticationError, AuthorizationError, requireWorkspaceAccess } from "./auth";
import { getAiRepository } from "./database";
import { preparationOriginAllowed } from "./campaign-preparation-api";
import { BUDGET_ACTION_LIMITS, budgetActionSchema, budgetActionStateSchema, budgetActionTargetSchema, readBudgetActionJson,
  type BudgetAction } from "@/components/ai-budget-action-contract";

const workspaceId = z.string().uuid();
const requestSchema = z.object({ workspaceId, deniedReservationId: z.string().uuid(), justification: z.string().trim().min(1).max(1000) }).strict();
const acknowledgeSchema = z.object({ workspaceId }).strict();
const decisionSchema = z.object({ workspaceId, decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(1).max(1000).optional() }).strict();
class BudgetTransportError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
function response(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
function apiError(error: unknown) {
  if (error instanceof BudgetTransportError) return response({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof AuthenticationError) return response({ error: { code: "authentication_required", message: "Sign in to review budget actions." } }, 401);
  if (error instanceof AuthorizationError) return response({ error: { code: "access_denied", message: "Current workspace permission is required." } }, 403);
  if (error instanceof z.ZodError || (error instanceof Error && error.name === "AiPolicyValidationError"))
    return response({ error: { code: "invalid_action", message: "This action is invalid or no longer eligible. Check the current result before attempting another action." } }, 422);
  console.error("Budget action result unavailable; private explanations and persistence details were not logged.");
  return response({ error: { code: "result_unavailable", message: "The action may have completed. Check its current result before continuing." } }, 503);
}
/** Minimize the response; a mutable entity is not a new immutable action receipt. */
function projectState(entity: AiBudgetAlert | AiSpendExceptionRequest) {
  const parsed = budgetActionStateSchema.safeParse("deniedReservationId" in entity ? {
    kind: "exception", workspaceId: entity.workspaceId, id: entity.id, deniedReservationId: entity.deniedReservationId,
    status: entity.status, justification: entity.justification, requestedBy: entity.requestedBy, resolvedBy: entity.resolvedBy,
    decisionNote: entity.decisionNote, expiresAt: entity.expiresAt, resolvedAt: entity.resolvedAt, consumedAt: entity.consumedAt,
  } : { kind: "alert", workspaceId: entity.workspaceId, id: entity.id, status: entity.status,
    acknowledgedBy: entity.acknowledgedBy, acknowledgedAt: entity.acknowledgedAt });
  if (!parsed.success) throw new Error("Persisted budget result could not be projected safely.");
  return parsed.data;
}
export async function mutateBudgetAction(request: Request, kind: BudgetAction["kind"], targetId?: string) {
  try {
    if (!preparationOriginAllowed(request.headers.get("origin"), process.env.APP_BASE_URL ?? ""))
      throw new BudgetTransportError("origin_forbidden", 403, "Submit budget actions from this application only.");
    if (new URL(request.url).search) throw new BudgetTransportError("invalid_action", 422, "Send action fields in the request body only.");
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
      throw new BudgetTransportError("unsupported_media_type", 415, "Send application/json.");
    if (Number(request.headers.get("content-length")) > BUDGET_ACTION_LIMITS.requestBytes)
      throw new BudgetTransportError("request_too_large", 413, "Budget action exceeds its bounded request limit.");
    let raw: unknown;
    try { raw = await readBudgetActionJson(request, BUDGET_ACTION_LIMITS.requestBytes); }
    catch { throw new BudgetTransportError("invalid_action", 422, "Provide bounded valid UTF-8 JSON."); }
    let action: BudgetAction;
    if (kind === "request_exception") { const input = requestSchema.parse(raw); action = budgetActionSchema.parse({ kind, workspaceId: input.workspaceId, targetId: input.deniedReservationId, justification: input.justification }); }
    else if (kind === "acknowledge_alert") action = budgetActionSchema.parse({ ...acknowledgeSchema.parse(raw), kind, targetId });
    else action = budgetActionSchema.parse({ ...decisionSchema.parse(raw), kind, targetId });
    const { user } = await requireWorkspaceAccess(action.workspaceId, action.kind === "decide_exception" ? "approve" : "write");
    const repository = getAiRepository();
    const result = action.kind === "acknowledge_alert" ? await repository.acknowledgeBudgetAlert(action.workspaceId, action.targetId, user.id)
      : action.kind === "request_exception" ? await repository.requestSpendException({ workspaceId: action.workspaceId, deniedReservationId: action.targetId, justification: action.justification }, user.id)
      : await repository.decideSpendException(action.workspaceId, action.targetId, action.decision, user.id, action.note);
    return response({ data: projectState(result) }, kind === "request_exception" ? 201 : 200);
  } catch (error) { return apiError(error); }
}
export async function getBudgetActionState(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].length !== 3 || ["workspaceId", "kind", "targetId"].some(key => query.getAll(key).length !== 1))
      throw new BudgetTransportError("invalid_action", 422, "Provide one exact workspace, action kind and target.");
    const target = budgetActionTargetSchema.parse(Object.fromEntries(query));
    const { user } = await requireWorkspaceAccess(target.workspaceId, target.kind === "decide_exception" ? "approve" : "write");
    const result = await getAiRepository().getBudgetActionState(target.workspaceId, target.kind, target.targetId, user.id);
    if (!result) throw new BudgetTransportError("not_found", 404, "No saved result was found. The original action may still finish.");
    return response({ data: projectState(result) });
  } catch (error) { return apiError(error); }
}
