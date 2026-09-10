import { AUTONOMY_MODES, READINESS_MODES } from "@market-me/domain";
import { z } from "zod";

const optionalInteger = z.number().int().positive().optional();
const trimmedList = z.array(z.string().trim().min(1)).max(100);

export const smartSourceInputSchema = z.object({
  workspaceId: z.string().uuid(),
  storageConnectionId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  provider: z.enum(["google_drive", "onedrive", "sharepoint", "local"]),
  locations: z.array(z.object({
    providerLocationId: z.string().trim().min(1).max(500),
    displayPath: z.string().trim().min(1).max(1000),
  })).min(1).max(20),
  recursive: z.boolean(),
  readinessMode: z.enum(READINESS_MODES),
  stabilizationWindowSeconds: z.number().int().min(0).max(86400),
  relatedFileMinimum: optionalInteger,
  readyMarker: z.string().trim().min(1).max(100).optional(),
  aiConfidenceThreshold: z.number().min(0).max(1).optional(),
  allowedMimeTypes: trimmedList,
  ignorePatterns: trimmedList,
  contextPackIds: z.array(z.string().uuid()).max(100),
  autonomyMode: z.enum(AUTONOMY_MODES),
  enabled: z.boolean(),
}).superRefine((value, context) => {
  if (value.readinessMode === "related_files" && !value.relatedFileMinimum) {
    context.addIssue({ code: "custom", path: ["relatedFileMinimum"], message: "A related file minimum is required." });
  }
  if (value.readinessMode === "ready_marker" && !value.readyMarker) {
    context.addIssue({ code: "custom", path: ["readyMarker"], message: "A ready marker is required." });
  }
  if (value.readinessMode === "ai_recommended" && value.aiConfidenceThreshold === undefined) {
    context.addIssue({ code: "custom", path: ["aiConfidenceThreshold"], message: "An AI confidence threshold is required." });
  }
});

export type SmartSourceInput = z.infer<typeof smartSourceInputSchema>;

export function validationError(error: z.ZodError): Response {
  return Response.json({
    error: {
      code: "validation_failed",
      message: "The Smart Source configuration is invalid.",
      fields: z.flattenError(error).fieldErrors,
    },
  }, { status: 422 });
}
