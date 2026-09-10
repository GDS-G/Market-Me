import { apiError } from "@/server/api-response";
import { aiCostQuoteCreateSchema, aiCostQuoteListSchema } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";
import type { AiStoredCostQuote } from "@market-me/domain";

export async function GET(request: Request) {
  try {
    const parsed = aiCostQuoteListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const quotes = await getAiRepository().listCostQuotes(
      parsed.data.workspaceId,
      user.id,
      parsed.data.limit,
    );
    return Response.json({ data: quotes.map(presentQuote) });
  } catch (error) {
    if (isValidationError(error))
      return validation(
        Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])),
      );
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = aiCostQuoteCreateSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const quote = await getAiRepository().createCostQuote(parsed.data, user.id);
    return Response.json({ data: presentQuote(quote) }, { status: 201 });
  } catch (error) {
    if (isValidationError(error))
      return validation(Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])));
    return apiError(error);
  }
}

function presentQuote(quote: AiStoredCostQuote) {
  return {
    id: quote.id,
    campaignId: quote.campaignId,
    capability: quote.capability,
    feature: quote.feature,
    currency: quote.currency,
    minorUnitExponent: quote.minorUnitExponent,
    minimumCostMinor: quote.minimumCostMinor,
    maximumCostMinor: quote.maximumCostMinor,
    quotedAt: quote.quotedAt,
    expiresAt: quote.expiresAt,
    status: quote.status,
    reservationId: quote.reservationId,
    reservationRequired: quote.reservationRequired,
    reservationAuthorized: false,
    execution: false,
  };
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({ error: { code: "validation_failed", message: "The cost quote request is not valid.", fields } }, { status: 422 });
}

function isValidationError(error: unknown): error is { issues: { field: string; message: string }[] } {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AiPolicyValidationError" && "issues" in error && Array.isArray(error.issues));
}
