import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import { AI_BUDGET_LEDGER_EXPONENT, type AiBudgetUnitIntegrity } from "@market-me/domain";

/** Read-only, workspace/currency-scoped evidence. Never convert or repair historical values. */
export async function readAiBudgetUnitIntegrity(sql: DatabaseClient | TransactionSql, workspaceId: string, currency: string): Promise<AiBudgetUnitIntegrity> {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM ai_spend_reservation reservation
    LEFT JOIN ai_spend_exception_request exception
      ON exception.workspace_id = reservation.workspace_id AND exception.id = reservation.spend_exception_request_id
    LEFT JOIN ai_spend_reservation denied
      ON denied.workspace_id = exception.workspace_id AND denied.id = exception.denied_reservation_id
    LEFT JOIN ai_cost_quote quote ON quote.workspace_id = reservation.workspace_id
      AND quote.id = COALESCE(reservation.cost_quote_id, denied.cost_quote_id)
    WHERE reservation.workspace_id = ${workspaceId} AND reservation.currency = ${currency}
      AND quote.minor_unit_exponent <> ${AI_BUDGET_LEDGER_EXPONENT}
  `;
  const incompatibleReservationCount = rows[0]?.count ?? 0;
  return { ledgerExponent: AI_BUDGET_LEDGER_EXPONENT, status: incompatibleReservationCount === 0 ? "compatible" : "incompatible_history", incompatibleReservationCount };
}
