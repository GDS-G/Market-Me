import { mutateBudgetAction } from "@/server/ai-budget-actions-api";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return mutateBudgetAction(request, "acknowledge_alert", (await context.params).id);
}
