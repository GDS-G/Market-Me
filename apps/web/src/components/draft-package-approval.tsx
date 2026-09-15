import Link from "next/link";
import { packageApprovalResultPath, reviewUuid } from "./content-package-review-request";

export function DraftPackageApproval({ workspaceId, packageId, approvalId }: { workspaceId: string; packageId: string; approvalId?: string | null }) {
  const exact = reviewUuid.safeParse(approvalId);
  return <section className="resource-panel"><div className="empty-inline"><h2>Original package approval</h2>
    {exact.success ? <><p>This generation retains its original immutable source-review approval. The receipt shows the approved snapshot, exact fingerprint, and usable fact set; current package changes do not replace it.</p>
      <Link href={packageApprovalResultPath(packageId, exact.data, workspaceId)}>View original package approval receipt</Link></>
      : <p>Historical source-review approval unavailable. This draft remains readable, but no exact package attestation has been invented for its old generation.</p>}
  </div></section>;
}
