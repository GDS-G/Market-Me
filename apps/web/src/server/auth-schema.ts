import { z } from "zod";

export const workspaceInvitationSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "editor", "approver", "analyst", "viewer"]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
}).strict();
