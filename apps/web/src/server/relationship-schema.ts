import { z } from "zod";
import {
  CONTACT_PERMISSIONS,
  RELATIONSHIP_IDENTITY_EVIDENCE_KINDS,
  RELATIONSHIP_IDENTITY_STATUSES,
  RELATIONSHIP_STAGES,
} from "@market-me/domain";

const boundedList = z.array(z.string().trim().min(1).max(200)).max(50);
const optionalText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).optional();

const relationshipIdentitySchema = z.object({
  provider: z.string().trim().min(1).max(100),
  providerSubjectId: z.string().trim().min(1).max(500),
  displayHandle: optionalText(300),
  profileUrl: z
    .string()
    .url()
    .refine(
      (value) => new URL(value).protocol === "https:",
      "Profile URL must use HTTPS.",
    )
    .optional(),
  status: z.enum(RELATIONSHIP_IDENTITY_STATUSES).default("reported"),
  confidence: z.number().finite().min(0).max(1).optional(),
});

export const relationshipWriteSchema = z
  .object({
    workspaceId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(300),
    organizationName: optionalText(300),
    stage: z.enum(RELATIONSHIP_STAGES).default("unknown"),
    contactPermission: z.enum(CONTACT_PERMISSIONS).default("allowed"),
    assignedOwnerId: z.string().uuid().optional(),
    observedInterests: boundedList.default([]),
    sharedTopics: boundedList.default([]),
    preferredTone: optionalText(200),
    notes: z.string().trim().max(10_000).default(""),
    suppressionReason: optionalText(1_000),
    identities: z.array(relationshipIdentitySchema).max(20).default([]),
  })
  .superRefine((value, context) => {
    if (value.contactPermission === "suppressed" && !value.suppressionReason) {
      context.addIssue({
        code: "custom",
        path: ["suppressionReason"],
        message: "Explain why this relationship must not be contacted.",
      });
    }
    const seen = new Set<string>();
    value.identities.forEach((identity, index) => {
      const key = `${identity.provider}\0${identity.providerSubjectId}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["identities", index, "providerSubjectId"],
          message: "Provider identities must be unique.",
        });
      }
      seen.add(key);
    });
  });

export const relationshipIdentityLinkWriteSchema = z.object({
  workspaceId: z.string().uuid(),
  candidateRelationshipId: z.string().uuid(),
  evidenceKind: z.enum(RELATIONSHIP_IDENTITY_EVIDENCE_KINDS),
  confidence: z.number().finite().min(0).max(1),
  initialStatus: z.enum(["suggested", "confirmed"]).default("suggested"),
});

export const relationshipIdentityLinkDecisionSchema = z.object({
  workspaceId: z.string().uuid(),
  status: z.enum(["confirmed", "dismissed"]),
});

export const relationshipIdentityCandidateScanSchema = z.object({
  workspaceId: z.string().uuid(),
});
