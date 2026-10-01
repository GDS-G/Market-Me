import { decryptToken, encryptToken } from "@market-me/connectors";
import { SourceSetupInputError } from "@market-me/domain";
import { z } from "zod";

export const sourceSetupBrowseSchema = z.strictObject({
  workspaceId: z.uuid(), connectionId: z.uuid(),
  provider: z.enum(["google_drive", "onedrive", "sharepoint"]),
  locationId: z.string().min(1).max(500), cursor: z.string().min(1).max(24_000).optional(),
}).superRefine((input, context) => {
  const valid = input.provider === "sharepoint" ? /^[^:\s\u0000-\u001f]+:[^:\s\u0000-\u001f]+$/u : /^[A-Za-z0-9_!-]+$/u;
  if (!valid.test(input.locationId)) context.addIssue({ code: "custom", path: ["locationId"], message: "Choose a folder identifier, not a URL or filesystem path." });
});
type BrowseInput = z.infer<typeof sourceSetupBrowseSchema>;
const cursorSchema = z.strictObject({
  kind: z.literal("source_setup_page_v1"), workspaceId: z.uuid(), actorUserId: z.uuid(), connectionId: z.uuid(),
  provider: z.enum(["google_drive", "onedrive", "sharepoint"]), locationId: z.string().min(1).max(500),
  pageToken: z.string().min(1).max(12_000), expiresAt: z.number().int().positive(),
});
const PAGE_LIFETIME_MS = 10 * 60 * 1000;
export function openSourceSetupCursor(input: BrowseInput, actorUserId: string, key: string, now = Date.now()): string | undefined {
  if (!input.cursor) return;
  try {
    const cursor = cursorSchema.parse(JSON.parse(decryptToken(input.cursor, key)));
    if (cursor.workspaceId !== input.workspaceId || cursor.actorUserId !== actorUserId || cursor.connectionId !== input.connectionId
      || cursor.provider !== input.provider || cursor.locationId !== input.locationId || cursor.expiresAt <= now || cursor.expiresAt > now + PAGE_LIFETIME_MS) throw new Error("scope");
    return cursor.pageToken;
  } catch { throw new SourceSetupInputError("The folder page expired or changed. Open the folder again."); }
}
export function sealSourceSetupCursor(input: BrowseInput, actorUserId: string, pageToken: string | undefined, key: string, now = Date.now()): string | undefined {
  if (!pageToken) return;
  return encryptToken(JSON.stringify(cursorSchema.parse({ kind: "source_setup_page_v1", workspaceId: input.workspaceId,
    actorUserId, connectionId: input.connectionId, provider: input.provider, locationId: input.locationId,
    pageToken, expiresAt: now + PAGE_LIFETIME_MS })), key);
}
