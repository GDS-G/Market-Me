import { mutateBudgetAction } from "@/server/ai-budget-actions-api";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return mutateBudgetAction(request, "decide_exception", (await context.params).id);
}
