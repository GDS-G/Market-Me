import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./client";
import { ACCOUNT_SESSION_LIMITS, AccountSessionError, accountSessionUuid, decodeAccountSessionCursor, encodeAccountSessionCursor,
  normalizeAccountSessionRequest, type AccountSessionActor, type AccountSessionView, type AccountSessionSnapshot, type AccountSessionReceipt } from "./account-session-models";

type SessionRow = { sessionId: string; createdAt: Date | string; lastSeenAt: Date | string; expiresAt: Date | string; cursorAt?: string };
type ReceiptRow = Omit<AccountSessionReceipt, "revokedAt"> & { revokedAt: Date | string; canonicalRequest: string };
const sessionView = (row: SessionRow): AccountSessionView => ({ sessionId: row.sessionId, createdAt: new Date(row.createdAt).toISOString(),
  lastSeenAt: new Date(row.lastSeenAt).toISOString(), expiresAt: new Date(row.expiresAt).toISOString() });
const receiptView = (row: ReceiptRow): AccountSessionReceipt => ({ accountId: row.accountId, requestId: row.requestId,
  targetSessionId: row.targetSessionId, revokedAt: new Date(row.revokedAt).toISOString() });
function selfScope(accountId: string, actor: AccountSessionActor): string {
  const account = accountSessionUuid(accountId);
  if (account !== accountSessionUuid(actor.accountId)) throw new AccountSessionError("access_denied", "Only your own sessions are available.");
  // Hashes never come from the JSON request. This guard catches a broken server integration before SQL.
  if (typeof actor.tokenHash !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(actor.tokenHash)) throw new AccountSessionError("authentication_required", "Sign in again.");
  return account;
}
const unauthenticated = () => new AccountSessionError("authentication_required", "Your current session is no longer active. Sign in again.");

export class AccountSessionRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async list(accountId: string, actor: AccountSessionActor, encodedCursor?: string): Promise<AccountSessionSnapshot> {
    const account = selfScope(accountId, actor);
    // Resolve cursor context privately; the following statement independently revalidates it.
    const [context] = await this.sql<{ sessionId: string }[]>`SELECT session_id FROM app_session
      WHERE user_id=${account} AND token_hash=${actor.tokenHash} AND expires_at>statement_timestamp()`;
    if (!context) throw unauthenticated();
    const cursor = decodeAccountSessionCursor(account, context.sessionId, encodedCursor);
    const rows = await this.sql<(SessionRow & { currentSessionId: string; currentCreatedAt: Date; currentLastSeenAt: Date; currentExpiresAt: Date;
      totalOthers: string; observedAt: Date })[]>`WITH auth AS MATERIALIZED (
        SELECT session_id,created_at,last_seen_at,expires_at FROM app_session
        WHERE user_id=${account} AND token_hash=${actor.tokenHash} AND session_id=${context.sessionId} AND expires_at>statement_timestamp()
      ), others AS MATERIALIZED (
        SELECT s.session_id,s.created_at,s.last_seen_at,s.expires_at FROM app_session s,auth a
        WHERE s.user_id=${account} AND s.session_id<>a.session_id AND s.expires_at>statement_timestamp()
      ), page AS (
        SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at FROM others
        -- Keep the wire parameter text-typed; timestamp serialization otherwise rounds through JS Date.
        WHERE ${!cursor} OR (created_at,session_id)<(${cursor?.at ?? null}::text::timestamptz,${cursor?.id ?? null}::uuid)
        ORDER BY created_at DESC,session_id DESC LIMIT ${ACCOUNT_SESSION_LIMITS.pageSize + 1}
      ) SELECT a.session_id AS current_session_id,a.created_at AS current_created_at,a.last_seen_at AS current_last_seen_at,
        a.expires_at AS current_expires_at,statement_timestamp() AS observed_at,(SELECT count(*)::text FROM others) AS total_others,p.*
        FROM auth a LEFT JOIN page p ON true ORDER BY p.created_at DESC,p.session_id DESC`;
    const first = rows[0]; if (!first) throw unauthenticated();
    const others = rows.filter(row => row.sessionId), visible = others.slice(0, ACCOUNT_SESSION_LIMITS.pageSize), last = visible.at(-1);
    return { accountId: account, observedAt: new Date(first.observedAt).toISOString(),
      current: sessionView({ sessionId: first.currentSessionId, createdAt: first.currentCreatedAt, lastSeenAt: first.currentLastSeenAt, expiresAt: first.currentExpiresAt }),
      others: visible.map(sessionView), totalOthers: first.totalOthers,
      nextCursor: others.length > ACCOUNT_SESSION_LIMITS.pageSize && last ? encodeAccountSessionCursor(account, context.sessionId, { at: last.cursorAt!, id: last.sessionId }) : null };
  }

  async getReceipt(accountId: string, requestId: string, actor: AccountSessionActor): Promise<AccountSessionReceipt | undefined> {
    const account = selfScope(accountId, actor), key = accountSessionUuid(requestId);
    const [row] = await this.sql<(Partial<ReceiptRow> & { currentSessionId: string })[]>`SELECT s.session_id AS current_session_id,
      r.account_id,r.request_id,r.target_session_id,r.revoked_at FROM app_session s
      LEFT JOIN account_session_receipt r ON r.account_id=s.user_id AND r.request_id=${key}
      WHERE s.user_id=${account} AND s.token_hash=${actor.tokenHash} AND s.expires_at>statement_timestamp()`;
    if (!row) throw unauthenticated();
    return row.requestId ? receiptView(row as ReceiptRow) : undefined;
  }

  async revoke(input: unknown, actor: AccountSessionActor): Promise<{ receipt: AccountSessionReceipt; replayed: boolean }> {
    const request = normalizeAccountSessionRequest(input), account = selfScope(request.accountId, actor), canonical = JSON.stringify(request);
    return this.sql.begin(async tx => {
      // Shared account lock serializes mutual revocations, profile changes and account deletion.
      if (!(await tx`SELECT id FROM app_user WHERE id=${account} FOR UPDATE`)[0]) throw unauthenticated();
      // Stable ordering also makes interaction with future session workflows explicit.
      await tx`SELECT session_id FROM app_session WHERE user_id=${account}
        AND (token_hash=${actor.tokenHash} OR session_id=${request.targetSessionId}) ORDER BY session_id FOR UPDATE`;
      // Check wall-clock expiry AFTER all potentially waiting locks, not transaction-start now().
      const [current] = await tx<{ sessionId: string }[]>`SELECT session_id FROM app_session
        WHERE user_id=${account} AND token_hash=${actor.tokenHash} AND expires_at>clock_timestamp()`;
      if (!current) throw unauthenticated();
      if (current.sessionId === request.targetSessionId) throw new AccountSessionError("current_session", "Use Sign out for this current session.");
      const [prior] = await tx<ReceiptRow[]>`SELECT * FROM account_session_receipt WHERE account_id=${account} AND request_id=${request.requestId}`;
      if (prior) {
        if (prior.canonicalRequest !== canonical) throw new AccountSessionError("request_conflict", "This identifier belongs to a different selected session.");
        return { receipt: receiptView(prior), replayed: true };
      }
      const [removed] = await tx`DELETE FROM app_session WHERE user_id=${account} AND session_id=${request.targetSessionId}
        AND expires_at>clock_timestamp() AND EXISTS (SELECT 1 FROM app_session current_session
          WHERE current_session.token_hash=${actor.tokenHash} AND current_session.user_id=${account} AND current_session.expires_at>clock_timestamp())
        RETURNING session_id`;
      if (!removed) throw new AccountSessionError("not_found", "No active selected session was removed. Check the original result before another request.");
      const [saved] = await tx<ReceiptRow[]>`INSERT INTO account_session_receipt(account_id,request_id,target_session_id,actor_session_id,canonical_request)
        VALUES (${account},${request.requestId},${request.targetSessionId},${current.sessionId},${canonical}) RETURNING *`;
      await tx`INSERT INTO audit_event(id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES (${randomUUID()},${account},'account.session_revoked','account_session',${request.targetSessionId},
          ${tx.json({ requestId: request.requestId, actorSessionId: current.sessionId, targetSessionId: request.targetSessionId })})`;
      return { receipt: receiptView(saved!), replayed: false };
    });
  }
}
