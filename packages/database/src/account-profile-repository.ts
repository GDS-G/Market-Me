import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "./client";
import { ACCOUNT_PROFILE_LIMITS, AccountProfileError, accountProfileUuid, normalizeAccountProfileRequest,
  type AccountProfileSnapshot, type AccountProfileReceipt } from "./account-profile-models";

type ReceiptRow = Omit<AccountProfileReceipt, "createdAt"> & { canonicalRequest: string; createdAt: string | Date };
const receipt = (row: ReceiptRow): AccountProfileReceipt => ({ accountId: row.accountId, requestId: row.requestId,
  displayName: row.displayName, revision: row.revision, changed: row.changed, createdAt: new Date(row.createdAt).toISOString() });

/** An account hint is never authority. Check it before any database query. */
function selfScope(accountId: string, actorUserId: string): string {
  const account = accountProfileUuid(accountId), actor = accountProfileUuid(actorUserId);
  if (account !== actor) throw new AccountProfileError("access_denied", "Only your signed-in account profile is available.");
  return actor;
}

export class AccountProfileRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async getProfile(accountId: string, actorUserId: string): Promise<AccountProfileSnapshot | undefined> {
    const actor = selfScope(accountId, actorUserId);
    return (await this.sql<AccountProfileSnapshot[]>`SELECT id AS account_id,display_name,profile_revision AS revision
      FROM app_user WHERE id=${actor}`)[0];
  }

  async getReceipt(accountId: string, requestId: string, actorUserId: string): Promise<AccountProfileReceipt | undefined> {
    const actor = selfScope(accountId, actorUserId), key = accountProfileUuid(requestId);
    const row = (await this.sql<ReceiptRow[]>`SELECT r.* FROM account_profile_receipt r
      JOIN app_user u ON u.id=r.account_id WHERE r.account_id=${actor} AND r.request_id=${key}`)[0];
    return row ? receipt(row) : undefined;
  }

  async save(input: unknown, actorUserId: string): Promise<{ receipt: AccountProfileReceipt; replayed: boolean }> {
    const request = normalizeAccountProfileRequest(input), actor = selfScope(request.accountId, actorUserId);
    const canonical = JSON.stringify(request);
    return this.sql.begin(async tx => {
      // Serializes saves, replays and deletion for this one account, across all workspaces.
      const current = (await tx<AccountProfileSnapshot[]>`SELECT id AS account_id,display_name,profile_revision AS revision
        FROM app_user WHERE id=${actor} FOR UPDATE`)[0];
      if (!current) throw new AccountProfileError("not_found", "Your account profile is no longer available.");
      const prior = (await tx<ReceiptRow[]>`SELECT * FROM account_profile_receipt
        WHERE account_id=${actor} AND request_id=${request.requestId}`)[0];
      if (prior) {
        if (prior.canonicalRequest !== canonical) throw new AccountProfileError("request_conflict", "This request already belongs to different profile settings.");
        return { receipt: receipt(prior), replayed: true };
      }
      const changed = current.displayName !== request.displayName;
      if (current.revision !== request.expectedRevision || changed && current.revision === 2_147_483_647) {
        throw new AccountProfileError("revision_conflict", "Your profile changed or reached its revision limit. Reload before saving.");
      }
      const revision = current.revision + (changed ? 1 : 0);
      if (changed) await tx`UPDATE app_user SET display_name=${request.displayName},profile_revision=${revision},updated_at=clock_timestamp()
        WHERE id=${actor}`;
      const saved = (await tx<ReceiptRow[]>`INSERT INTO account_profile_receipt
        (account_id,request_id,display_name,revision,changed,canonical_request)
        VALUES (${actor},${request.requestId},${request.displayName},${revision},${changed},${canonical}) RETURNING *`)[0]!;
      // Legacy labels can exceed the new limit. Never split a Unicode scalar in JSONB audit data.
      const previousName = current.displayName.slice(0, ACCOUNT_PROFILE_LIMITS.displayName).replace(/[\uD800-\uDBFF]$/u, "");
      await tx`INSERT INTO audit_event(id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES (${randomUUID()},${actor},'account.profile_saved','account_profile',${actor},
          ${tx.json({ requestId: request.requestId, previousName,
            previousNameTruncated: previousName !== current.displayName, displayName: request.displayName,
            previousRevision: current.revision, revision, changed })})`;
      return { receipt: receipt(saved), replayed: false };
    });
  }
}
