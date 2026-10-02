import { mutateBudgetAction } from "@/server/ai-budget-actions-api";
export async function POST(request: Request) { return mutateBudgetAction(request, "request_exception"); }
