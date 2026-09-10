"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredDraftChannelPreview } from "@market-me/database";

interface Choice {
  id: string;
  name: string;
  provider?: string;
  title?: string;
}
interface AssetChoice {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  mediaStatus?: string;
  scanStatus?: string;
  scanRevision?: number;
  scanScannedAt?: string;
  rightsStatus?: string;
  altTextStatus?: string;
  altText?: string;
}

export function DraftChannelPreviews({
  workspaceId,
  draftId,
  approved,
  connections,
  destinations,
  assets,
  previews,
}: {
  workspaceId: string;
  draftId: string;
  approved: boolean;
  connections: readonly Choice[];
  destinations: readonly Choice[];
  assets: readonly AssetChoice[];
  previews: readonly StoredDraftChannelPreview[];
}) {
  const router = useRouter();
  const [channelConnectionId, setChannelConnectionId] = useState(
    connections[0]?.id ?? "",
  );
  const [destinationId, setDestinationId] = useState("");
  const [linkMode, setLinkMode] = useState<"canonical" | "tracked">(
    "canonical",
  );
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const selectedConnection = connections.find((connection) => connection.id === channelConnectionId);
  const supportsAttachments = selectedConnection?.provider === "discord_webhook" || selectedConnection?.provider === "mastodon_account";
  const attachmentLimit = selectedConnection?.provider === "mastodon_account" ? 4 : 10;
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch(`/api/v1/drafts/${draftId}/previews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        channelConnectionId,
        destinationId: destinationId || undefined,
        linkMode,
        assetIds,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok)
      setError(
        payload?.error?.message ?? "Could not create the channel preview.",
      );
    else router.refresh();
  }
  return (
    <section className="resource-panel draft-channel-previews">
      <div className="resource-panel-head">
        <div>
          <h2>Channel previews</h2>
          <p>
            Render the exact approved copy and ordered media against a live
            capability snapshot. This does not publish externally.
          </p>
        </div>
      </div>
      {approved && connections.length ? (
        <form className="preview-create-form" onSubmit={create}>
          <label className="field">
            <span>Channel connection</span>
            <select
              required
              value={channelConnectionId}
              onChange={(event) => {
                setChannelConnectionId(event.target.value);
                const nextProvider = connections.find((connection) => connection.id === event.target.value)?.provider;
                if (nextProvider !== "discord_webhook" && nextProvider !== "mastodon_account") setAssetIds([]);
                else setAssetIds((current) => current.slice(0, nextProvider === "mastodon_account" ? 4 : 10));
              }}
            >
              {connections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.provider?.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Published Destination</span>
            <select
              value={destinationId}
              onChange={(event) => {
                setDestinationId(event.target.value);
                if (!event.target.value) setLinkMode("canonical");
              }}
            >
              <option value="">No destination link</option>
              {destinations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Destination URL mode</span>
            <select
              value={linkMode}
              onChange={(event) =>
                setLinkMode(event.target.value as "canonical" | "tracked")
              }
            >
              <option value="canonical">Canonical URL</option>
              <option disabled={!destinationId} value="tracked">
                First-party tracked URL
              </option>
            </select>
          </label>
          <button className="button-primary" disabled={pending}>
            {pending ? "Rendering…" : "Create exact preview"}
          </button>
          {supportsAttachments && assets.length > 0 && (
            <fieldset className="preview-assets">
              <legend>
                Approved media attachments · {assetIds.length}/{attachmentLimit} selected
              </legend>
              {assets.map((asset) => {
                const eligible =
                  asset.mediaStatus === "processed" &&
                  (selectedConnection?.provider !== "mastodon_account" || ["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType)) &&
                  ["approved", "decorative"].includes(
                    asset.altTextStatus ?? "",
                  ) &&
                  asset.scanStatus === "clean" &&
                  (asset.scanRevision ?? 0) > 0 &&
                  Boolean(asset.scanScannedAt) &&
                  asset.rightsStatus === "cleared" &&
                  asset.byteSize <= 10 * 1024 * 1024;
                return (
                  <label
                    key={asset.id}
                    className={
                      eligible
                        ? "preview-asset"
                        : "preview-asset preview-asset-blocked"
                    }
                  >
                    <input
                      type="checkbox"
                      disabled={
                        !eligible ||
                        (!assetIds.includes(asset.id) && assetIds.length >= attachmentLimit)
                      }
                      checked={assetIds.includes(asset.id)}
                      onChange={(event) =>
                        setAssetIds((current) =>
                          event.target.checked
                            ? [...current, asset.id]
                            : current.filter((id) => id !== asset.id),
                        )
                      }
                    />
                    <span>
                      <strong>{asset.fileName}</strong>
                      <small>
                        {asset.mimeType} · {(asset.byteSize / 1024).toFixed(1)}{" "}
                        KiB · {asset.altTextStatus?.replaceAll("_", " ")} · scan{" "}
                        {asset.scanStatus?.replaceAll("_", " ")} · rights{" "}
                        {asset.rightsStatus}
                      </small>
                      {asset.altTextStatus === "approved" && asset.altText && (
                        <small>{asset.altText}</small>
                      )}
                      {!eligible && (
                        <small>
                          Complete processing, accessibility, safety, and
                          reviewed rights clearance before selection.
                        </small>
                      )}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {error && <p className="form-message form-error">{error}</p>}
        </form>
      ) : (
        <p className="empty-inline">
          {approved
            ? "Add and test an active publishing connection before rendering a preview."
            : "Approve this exact Draft version before rendering channel output."}
        </p>
      )}
      <div className="preview-list">
        {previews.map((preview) => (
          <article className="channel-preview-card" key={preview.id}>
            <div className="channel-preview-head">
              <div>
                <strong>{preview.channelConnectionName}</strong>
                <p>
                  {preview.provider.replaceAll("_", " ")} · capability{" "}
                  {preview.capabilityVersion}
                  {preview.destinationTitle
                    ? ` · ${preview.destinationTitle}`
                    : ""}{" "}
                  ·{" "}
                  {preview.linkMode === "tracked"
                    ? "approved tracked URL"
                    : "canonical URL"}
                </p>
              </div>
              <span
                className={`status-pill ${preview.status === "ready" && !preview.isStale ? "status-green" : "status-amber"}`}
              >
                {preview.isStale ? "stale" : preview.status}
              </span>
            </div>
            {preview.renderedSubject && <p><strong>Subject:</strong> {preview.renderedSubject}</p>}
            <pre>{preview.renderedContent}</pre>
            <p>
              {preview.renderedSubject ? `${preview.subjectCount ?? preview.renderedSubject.length}${preview.subjectLimit ? ` / ${preview.subjectLimit}` : ""} subject characters · ` : ""}{preview.characterCount}
              {preview.characterLimit
                ? ` / ${preview.characterLimit}`
                : ""}{" "}
              characters · {preview.assets.length} attachment
              {preview.assets.length === 1 ? "" : "s"}
            </p>
            {preview.assets.length > 0 && (
              <ol className="preview-asset-snapshot">
                {preview.assets.map((asset) => (
                  <li key={asset.contentAssetId}>
                    <strong>{asset.fileName}</strong>
                    <span>
                      {(asset.byteSize / 1024).toFixed(1)} KiB ·{" "}
                      {asset.altTextStatus === "decorative"
                        ? "decorative"
                        : asset.altText}{" "}
                      · scan {asset.scanStatus} revision {asset.scanRevision} ·
                      rights {asset.rightsStatus} revision {asset.rightsRevision}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {preview.validationIssues.map((issue) => (
              <p className="form-error" key={issue.code}>
                {issue.message}
              </p>
            ))}
            {preview.isStale && (
              <p className="form-error">
                Connection capabilities, malware scan evidence, or reviewed
                asset rights changed after this snapshot. Render a new preview
                before delivery.
              </p>
            )}
          </article>
        ))}
        {previews.length === 0 && (
          <p className="empty-inline">No channel previews yet.</p>
        )}
      </div>
    </section>
  );
}
