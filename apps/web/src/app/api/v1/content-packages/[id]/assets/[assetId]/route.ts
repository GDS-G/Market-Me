import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";
import { CONTENT_ASSET_RIGHTS_CHANNELS } from "@market-me/domain";

const accessibilitySchema = z
  .object({
    workspaceId: z.string().uuid(),
    altText: z.string().trim().max(2_000).optional(),
    decorative: z.boolean().default(false),
    notes: z.string().trim().max(2_000).optional(),
  })
  .superRefine((value, context) => {
    if (!value.decorative && !value.altText)
      context.addIssue({
        code: "custom",
        path: ["altText"],
        message: "Alternative text is required unless the image is decorative.",
      });
  });

const rightsSchema = z
  .object({
    workspaceId: z.string().uuid(),
    status: z.enum(["cleared", "restricted"]),
    owner: z.string().trim().min(1).max(200),
    licenseOwner: z.string().trim().min(1).max(200).optional(),
    sourceReference: z.string().trim().min(3).max(1_000),
    proofReference: z.string().trim().min(3).max(1_000),
    commercialUseAllowed: z.boolean(),
    derivativeUseAllowed: z.boolean(),
    worldwideUseAllowed: z.boolean(),
    permittedChannels: z.array(z.enum(CONTENT_ASSET_RIGHTS_CHANNELS)).max(20),
    permittedChannelConnectionIds: z.array(z.string().uuid()).max(100),
    permittedCampaignIds: z.array(z.string().uuid()).max(100),
    permittedBrandProfileIds: z.array(z.string().uuid()).max(100),
    validFrom: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    attributionRequirement: z.string().trim().min(1).max(1_000).optional(),
    watermarkRequirement: z.string().trim().min(1).max(1_000).optional(),
    disclaimerRequirement: z.string().trim().min(1).max(1_000).optional(),
    reviewNote: z.string().trim().min(3).max(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    const validFrom = value.validFrom ? new Date(value.validFrom) : undefined;
    const expiresAt = value.expiresAt ? new Date(value.expiresAt) : undefined;
    if (validFrom && expiresAt && expiresAt <= validFrom) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Expiration must follow the valid-from time.",
      });
    }
    if (value.status === "cleared") {
      if (
        !value.commercialUseAllowed ||
        !value.derivativeUseAllowed ||
        !value.worldwideUseAllowed
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message:
            "Clearance requires worldwide commercial and derivative permission.",
        });
      }
      if (!value.permittedChannels.includes("discord_webhook")) {
        context.addIssue({
          code: "custom",
          path: ["permittedChannels"],
          message:
            "Clearance must include the current Discord publishing channel.",
        });
      }
      if (value.permittedChannelConnectionIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["permittedChannelConnectionIds"],
          message: "Clearance must name at least one exact publishing account.",
        });
      }
      if (
        value.attributionRequirement ||
        value.watermarkRequirement ||
        value.disclaimerRequirement
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message:
            "Outstanding attribution, watermark, or disclaimer requirements must remain restricted until an execution gate can verify them.",
        });
      }
      if (validFrom && validFrom > new Date()) {
        context.addIssue({
          code: "custom",
          path: ["validFrom"],
          message: "A future permission window is not currently cleared.",
        });
      }
      if (expiresAt && expiresAt <= new Date()) {
        context.addIssue({
          code: "custom",
          path: ["expiresAt"],
          message: "Expired permission cannot be cleared.",
        });
      }
    }
  });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  try {
    const body = accessibilitySchema.parse(await request.json());
    const { user, workspace } = await requireWorkspaceAccess(
      body.workspaceId,
      "write",
    );
    const { id, assetId } = await context.params;
    const data = await getRepository().updateAssetAccessibility({
      workspaceId: workspace.workspaceId,
      packageId: id,
      assetId,
      altText: body.altText,
      decorative: body.decorative,
      notes: body.notes,
      actorUserId: user.id,
    });
    if (!data)
      return Response.json(
        { error: { code: "not_found", message: "Image asset not found." } },
        { status: 404 },
      );
    return Response.json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: "Accessibility details are invalid.",
            fields: error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    }
    return apiError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  try {
    const body = rightsSchema.parse(await request.json());
    const { user, workspace } = await requireWorkspaceAccess(
      body.workspaceId,
      "write",
    );
    const { id, assetId } = await context.params;
    const data = await getRepository().reviewAssetRights(
      {
        ...body,
        workspaceId: workspace.workspaceId,
        packageId: id,
        assetId,
      },
      user.id,
    );
    if (!data)
      return Response.json(
        {
          error: {
            code: "not_found",
            message: "Original image asset not found.",
          },
        },
        { status: 404 },
      );
    return Response.json({ data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: {
            code: "invalid_request",
            message: "Asset rights review is invalid.",
            fields: error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    }
    return apiError(error);
  }
}
