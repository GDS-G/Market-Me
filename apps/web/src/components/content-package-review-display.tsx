import Image from "next/image";
import type { ContentPackageReview, ContentPackageReviewSnapshotV1 } from "@market-me/database";
import styles from "./content-package-review.module.css";

export interface CapturedAssetPreview { id: string; contentHash: string; url: string }
export function PackageReviewState({ review }: { review: ContentPackageReview }) {
  return <section className={styles.notice} aria-labelledby="package-review-status">
    <h2 id="package-review-status">{review.currentApprovalValid ? "Current exact review approved" : review.historicalApproval ? "Historical approval is unverified" : "Current review needs approval"}</h2>
    <p>{review.currentApprovalValid ? "This captured review matched a current approval when the server evaluated it. New work rechecks its proof and eligibility."
      : review.historicalApproval ? "An older approved status has no verifiable original review receipt. Review this captured content and explicitly approve it before new generation or preparation."
        : "A numeric source revision alone does not identify in-place corrections, rights, or accessibility changes."}</p>
    <p>Evaluated at <code>{review.evaluatedAt}</code>. Saved status: {review.status.replaceAll("_", " ")}.</p>
    <p className={styles.break}>Exact review fingerprint: <code>{review.reviewFingerprint}</code></p>
    {review.blockers.length > 0 ? <><h3>Approval blockers</h3><ul>{review.blockers.map((blocker, index) => <li key={`${blocker.code}:${index}`}>
      {blocker.message} <code>({blocker.code})</code>
      {blocker.evidenceId && <a href={`#evidence-${blocker.evidenceId}`}> Review evidence</a>}
      {blocker.conflictId && <a href={`#conflict-${blocker.conflictId}`}> Review conflict</a>}
      {blocker.assetId && <a href={`#asset-${blocker.assetId}`}> Review asset</a>}
    </li>)}</ul></> : <p>No approval blockers were found at this evaluation. Approval is a separate explicit action.</p>}
  </section>;
}

export function PackageReviewSnapshot({ snapshot, effectiveEvidenceIds, excludedEvidenceIds = [], assetPreviews = [] }: {
  snapshot: ContentPackageReviewSnapshotV1; effectiveEvidenceIds: readonly string[]; excludedEvidenceIds?: readonly string[];
  assetPreviews?: readonly CapturedAssetPreview[];
}) {
  const winners = new Set(snapshot.conflicts.filter((item) => item.status === "resolved").map((item) => item.resolutionEvidenceId));
  const assetsById = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  return <div className={styles.sections}>
    <section className="resource-panel"><div className="resource-panel-head"><div><h2>Captured package</h2><p>Source revision {snapshot.package.version}; no fields below are reloaded from live child records.</p></div></div>
      <dl className={styles.facts}><dt>Package</dt><dd>{snapshot.package.id}</dd><dt>Smart Source</dt><dd>{snapshot.package.smartSourceId}</dd>
        <dt>Root source item</dt><dd>{snapshot.package.rootSourceItemId}</dd><dt>Created</dt><dd>{snapshot.package.createdAtUtcMicros}</dd>
        <dt>Captured Context Pack versions</dt><dd>{snapshot.package.contextPackVersionIds.join(", ") || "None"}</dd>
        <dt>Confidence</dt><dd>{snapshot.package.confidence === null ? "Unavailable" : snapshot.package.confidence}</dd></dl>
    </section>
    <section className="resource-panel"><div className="resource-panel-head"><div><h2>Reviewed evidence</h2><p>{effectiveEvidenceIds.length} usable facts; selected winners and excluded history remain visible.</p></div></div>
      {!snapshot.evidence.length && <p className={styles.padding}>No evidence was captured.</p>}
      {snapshot.evidence.map((item) => <article key={item.id} id={`evidence-${item.id}`} className={styles.item}>
        <h3>{item.factKey ?? "Unkeyed claim"}</h3><p className={styles.captured}>{item.claim}</p>
        <p><strong>{effectiveEvidenceIds.includes(item.id) ? "Usable fact" : excludedEvidenceIds.includes(item.id) ? "Excluded from generation" : "Not currently usable"}</strong>
          {winners.has(item.id) ? " · Selected conflict winner" : ""}{item.supersededByEvidenceId ? " · Superseded history" : ""} · {item.provenance.replaceAll("_", " ")}</p>
        <dl className={styles.facts}><dt>Evidence ID</dt><dd>{item.id}</dd><dt>Captured source references</dt><dd>{item.sourceReferences.length ? item.sourceReferences.map((value, index) => <div key={index}>{value}</div>) : "None"}</dd>
          <dt>Confidence</dt><dd>{item.confidence === null ? "Unavailable" : item.confidence}</dd><dt>Context version</dt><dd>{item.contextPackVersionId ?? "None"}</dd>
          <dt>Superseded by</dt><dd>{item.supersededByEvidenceId ?? "None"}</dd><dt>Created</dt><dd>{item.createdAtUtcMicros}</dd></dl>
      </article>)}
    </section>
    <section className="resource-panel"><div className="resource-panel-head"><div><h2>Captured conflict decisions</h2><p>Open or unsupported decisions require review; no candidate is selected implicitly.</p></div></div>
      {!snapshot.conflicts.length && <p className={styles.padding}>No conflicts were captured.</p>}
      {snapshot.conflicts.map((conflict) => <article key={conflict.id} id={`conflict-${conflict.id}`} className={styles.item}>
        <h3>{conflict.factKey} · {conflict.status}</h3><p>Conflict {conflict.id}</p><ul>{conflict.candidateEvidenceIds.map((id) => <li key={id}>
          <a href={`#evidence-${id}`}>{snapshot.evidence.find((item) => item.id === id)?.claim ?? `Unavailable captured evidence ${id}`}</a>
          {conflict.resolutionEvidenceId === id ? " — selected winner" : conflict.status === "resolved" ? " — excluded candidate" : " — awaiting decision"}
        </li>)}</ul><p>Recorded selection: {conflict.resolutionEvidenceId ?? "None"}</p><p>Review note: {conflict.resolutionNote ?? "None"}</p>
        <p>Created {conflict.createdAtUtcMicros}; resolved {conflict.resolvedAtUtcMicros ?? "not recorded"}.</p>
      </article>)}
    </section>
    <section className="resource-panel"><div className="resource-panel-head"><div><h2>Captured assets</h2><p>Raw stored rights are separate from current eligibility. Derivatives inherit from the named source asset; blockers above are evaluated by the server.</p></div></div>
      {!snapshot.assets.length && <p className={styles.padding}>No assets were captured.</p>}
      {snapshot.assets.map((asset) => {
        const preview = assetPreviews.find((item) => item.id === asset.id && item.contentHash === asset.contentHash);
        const source = asset.role === "derivative" && asset.sourceAssetId ? assetsById.get(asset.sourceAssetId) : undefined;
        const previewAlt = source?.role === "original" && source.accessibility.status === "decorative" ? ""
          : source?.role === "original" && source.accessibility.status === "approved" && source.accessibility.altText?.trim()
            ? source.accessibility.altText : undefined;
        return <article key={asset.id} id={`asset-${asset.id}`} className={styles.item}>
          <h3>{asset.fileName}</h3><p>{asset.role} · {asset.mimeType} · {asset.byteSizeDecimal ?? "unknown"} bytes</p>
          {preview && previewAlt !== undefined && <figure><Image src={preview.url} width={640} height={480} className={styles.preview} unoptimized alt={previewAlt} /><figcaption>Derivative preview; captured content hash {asset.contentHash}.</figcaption></figure>}
          <dl className={styles.facts}><dt>Asset ID / content hash</dt><dd>{asset.id}<br />{asset.contentHash}</dd><dt>Inherited source asset</dt><dd>{asset.sourceAssetId ?? "None"}</dd>
            <dt>Media / extraction</dt><dd>{asset.mediaStatus} / {asset.extraction.status}</dd><dt>Malware scan</dt><dd>{asset.scan.status} · revision {asset.scan.revision} · {asset.scan.engine ?? "no engine"} · {asset.scan.scannedAtUtcMicros ?? "not scanned"}</dd>
            <dt>Accessibility</dt><dd>{asset.accessibility.status} · {asset.accessibility.altText ?? "no alternative text"}<br />{asset.accessibility.notes}</dd>
            <dt>Raw rights status</dt><dd>{asset.rights.status} · revision {asset.rights.revision}</dd><dt>Rights owner / license owner</dt><dd>{asset.rights.owner ?? "Unavailable"} / {asset.rights.licenseOwner ?? "Unavailable"}</dd>
            <dt>Permission window</dt><dd>{asset.rights.validFromUtcMicros ?? "No lower bound"} → {asset.rights.expiresAtUtcMicros ?? "No expiry"}</dd>
            <dt>Rights source / proof</dt><dd>{asset.rights.sourceReference ?? "None"}<br />{asset.rights.proofReference ?? "None"}</dd></dl>
          {asset.extraction.error && <p className="form-error">Captured extraction error: {asset.extraction.error}</p>}
          {asset.extraction.text !== null && <details><summary>Complete captured extracted text ({asset.extraction.text.length} characters; expandable, not truncated)</summary><pre className={styles.raw}>{asset.extraction.text}</pre></details>}
          <details><summary>All captured asset fields, including raw rights, scopes, recipe, and metadata</summary><pre className={styles.raw}>{JSON.stringify(asset, null, 2)}</pre></details>
        </article>;
      })}
    </section>
    <details className={styles.notice}><summary>Complete exact review snapshot (all included fields)</summary><p>This complete captured record is the source of the displayed fingerprint. Its presence does not assert that every byte has been read.</p><pre className={styles.raw}>{JSON.stringify(snapshot, null, 2)}</pre></details>
  </div>;
}
