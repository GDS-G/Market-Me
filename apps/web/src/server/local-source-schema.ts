import { z } from "zod";

const localItemId = z.string().regex(/^local:[a-f0-9]{64}$/);

export const localSourceManifestSchema = z.object({
  smartSourceId: z.string().uuid(),
  entries: z.array(z.object({
    providerItemId: localItemId,
    providerParentId: localItemId.optional(),
    name: z.string().trim().min(1).max(255),
    relativePath: z.string().trim().min(1).max(1000).refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "Relative path is invalid"),
    mimeType: z.string().trim().min(1).max(200),
    isFolder: z.boolean(),
    sizeBytes: z.number().int().min(0).max(50 * 1024 * 1024).optional(),
    modifiedAt: z.string().datetime(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  })).max(5_000),
});
