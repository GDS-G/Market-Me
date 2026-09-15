import type { DatabaseClient } from "../client";
import { ContentPackageReviewRepository } from "../content-package-review-repository";

/** Test-only equivalent of displaying a coherent review before a decision.
 * This does not approve anything, skip eligibility or bypass the repository. */
export async function packageReviewPrecondition(sql: DatabaseClient, workspaceId: string, packageId: string, actorUserId: string) {
  const displayed = await new ContentPackageReviewRepository(sql).getReview(workspaceId, packageId, actorUserId);
  if (!displayed) throw new Error("Fixture package unavailable for review");
  return { expectedVersion: displayed.version, expectedReviewFingerprint: displayed.reviewFingerprint };
}
export async function packageGenerationPrecondition(sql: DatabaseClient, workspaceId: string, packageId: string, actorUserId: string) {
  const displayed = await packageReviewPrecondition(sql, workspaceId, packageId, actorUserId);
  return { expectedPackageVersion: displayed.expectedVersion, expectedReviewFingerprint: displayed.expectedReviewFingerprint };
}
