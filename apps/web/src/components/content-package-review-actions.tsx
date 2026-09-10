"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredContentPackage } from "@market-me/database";

interface RightsDraft {
  status: "cleared" | "restricted";
  owner: string;
  licenseOwner: string;
  sourceReference: string;
  proofReference: string;
  commercialUseAllowed: boolean;
  derivativeUseAllowed: boolean;
  worldwideUseAllowed: boolean;
  discordAllowed: boolean;
  mastodonAllowed: boolean;
  permittedChannelConnectionIds: string[];
  permittedCampaignIds: string[];
  permittedBrandProfileIds: string[];
  validFrom: string;
  expiresAt: string;
  attributionRequirement: string;
  watermarkRequirement: string;
  disclaimerRequirement: string;
  reviewNote: string;
}

interface RightsChannelConnection {
  id: string;
  name: string;
  provider: "discord_webhook" | "mastodon_account";
  status: "active" | "error" | "revoked";
}

interface RightsCampaign {
  id: string;
  name: string;
  status: string;
}

interface RightsBrandProfile {
  id: string;
  name: string;
  status: string;
}

export function ContentPackageReviewActions({
  workspaceId,
  item,
  channelConnections,
  campaigns,
  brandProfiles,
}: {
  workspaceId: string;
  item: StoredContentPackage;
  channelConnections: readonly RightsChannelConnection[];
  campaigns: readonly RightsCampaign[];
  brandProfiles: readonly RightsBrandProfile[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [altText, setAltText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      item.assets.map((asset) => [asset.id, asset.altText ?? ""]),
    ),
  );
  const [decorative, setDecorative] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      item.assets.map((asset) => [
        asset.id,
        asset.altTextStatus === "decorative",
      ]),
    ),
  );
  const [rights, setRights] = useState<Record<string, RightsDraft>>(() =>
    Object.fromEntries(
      item.assets.map((asset) => [
        asset.id,
        {
          status: asset.rightsStatus === "cleared" ? "cleared" : "restricted",
          owner: asset.rightsOwner ?? "",
          licenseOwner: asset.rightsLicenseOwner ?? "",
          sourceReference: asset.rightsSourceReference ?? "",
          proofReference: asset.rightsProofReference ?? "",
          commercialUseAllowed: asset.rightsCommercialUseAllowed ?? false,
          derivativeUseAllowed: asset.rightsDerivativeUseAllowed ?? false,
          worldwideUseAllowed: asset.rightsWorldwideUseAllowed ?? false,
          discordAllowed:
            asset.rightsPermittedChannels?.includes("discord_webhook") ?? false,
          mastodonAllowed:
            asset.rightsPermittedChannels?.includes("mastodon_account") ?? false,
          permittedChannelConnectionIds: [
            ...(asset.rightsPermittedChannelConnectionIds ?? []),
          ],
          permittedCampaignIds: [...(asset.rightsPermittedCampaignIds ?? [])],
          permittedBrandProfileIds: [
            ...(asset.rightsPermittedBrandProfileIds ?? []),
          ],
          validFrom: localDateTime(asset.rightsValidFrom),
          expiresAt: localDateTime(asset.rightsExpiresAt),
          attributionRequirement: asset.rightsAttributionRequirement ?? "",
          watermarkRequirement: asset.rightsWatermarkRequirement ?? "",
          disclaimerRequirement: asset.rightsDisclaimerRequirement ?? "",
          reviewNote: asset.rightsReviewNote ?? "",
        },
      ]),
    ),
  );

  async function post(url: string, body: Record<string, unknown>) {
    setPending(true);
    setError("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      setError(payload?.error?.message ?? "Review action failed.");
    setPending(false);
    router.refresh();
  }

  async function patchAccessibility(assetId: string) {
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/content-packages/${item.id}/assets/${assetId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          altText: altText[assetId],
          decorative: decorative[assetId] ?? false,
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      setError(payload?.error?.message ?? "Accessibility update failed.");
    setPending(false);
    router.refresh();
  }

  function setRight<K extends keyof RightsDraft>(
    assetId: string,
    key: K,
    value: RightsDraft[K],
  ) {
    setRights((current) => ({
      ...current,
      [assetId]: { ...current[assetId]!, [key]: value },
    }));
  }

  function togglePermittedConnection(
    assetId: string,
    connectionId: string,
    checked: boolean,
  ) {
    const selected = rights[assetId]?.permittedChannelConnectionIds ?? [];
    setRight(
      assetId,
      "permittedChannelConnectionIds",
      checked
        ? [...new Set([...selected, connectionId])]
        : selected.filter((id) => id !== connectionId),
    );
  }

  function togglePermittedCampaign(
    assetId: string,
    campaignId: string,
    checked: boolean,
  ) {
    const selected = rights[assetId]?.permittedCampaignIds ?? [];
    setRight(
      assetId,
      "permittedCampaignIds",
      checked
        ? [...new Set([...selected, campaignId])]
        : selected.filter((id) => id !== campaignId),
    );
  }

  function togglePermittedBrandProfile(
    assetId: string,
    brandProfileId: string,
    checked: boolean,
  ) {
    const selected = rights[assetId]?.permittedBrandProfileIds ?? [];
    setRight(
      assetId,
      "permittedBrandProfileIds",
      checked
        ? [...new Set([...selected, brandProfileId])]
        : selected.filter((id) => id !== brandProfileId),
    );
  }

  async function putRights(assetId: string) {
    const value = rights[assetId]!;
    setPending(true);
    setError("");
    const response = await fetch(
      `/api/v1/content-packages/${item.id}/assets/${assetId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          status: value.status,
          owner: value.owner,
          licenseOwner: value.licenseOwner || undefined,
          sourceReference: value.sourceReference,
          proofReference: value.proofReference,
          commercialUseAllowed: value.commercialUseAllowed,
          derivativeUseAllowed: value.derivativeUseAllowed,
          worldwideUseAllowed: value.worldwideUseAllowed,
          permittedChannels: [
            ...(value.discordAllowed ? ["discord_webhook" as const] : []),
            ...(value.mastodonAllowed ? ["mastodon_account" as const] : []),
          ],
          permittedChannelConnectionIds: value.permittedChannelConnectionIds,
          permittedCampaignIds: value.permittedCampaignIds,
          permittedBrandProfileIds: value.permittedBrandProfileIds,
          validFrom: value.validFrom
            ? new Date(value.validFrom).toISOString()
            : undefined,
          expiresAt: value.expiresAt
            ? new Date(value.expiresAt).toISOString()
            : undefined,
          attributionRequirement: value.attributionRequirement || undefined,
          watermarkRequirement: value.watermarkRequirement || undefined,
          disclaimerRequirement: value.disclaimerRequirement || undefined,
          reviewNote: value.reviewNote,
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      setError(payload?.error?.message ?? "Rights review failed.");
    setPending(false);
    router.refresh();
  }

  return (
    <div className="review-actions">
      {item.assets
        .filter(
          (asset) =>
            asset.role === "original" && asset.mimeType.startsWith("image/"),
        )
        .map((asset) => (
          <div className="accessibility-editor" key={asset.id}>
            <span>Alternative text for {asset.fileName}</span>
            <textarea
              disabled={decorative[asset.id]}
              value={altText[asset.id] ?? ""}
              onChange={(event) =>
                setAltText((current) => ({
                  ...current,
                  [asset.id]: event.target.value,
                }))
              }
              placeholder="Describe the informative content of this image"
            />
            <label className="check-row">
              <input
                type="checkbox"
                checked={decorative[asset.id] ?? false}
                onChange={(event) =>
                  setDecorative((current) => ({
                    ...current,
                    [asset.id]: event.target.checked,
                  }))
                }
              />
              This image is decorative
            </label>
            <button
              className="button-secondary"
              disabled={
                pending || (!decorative[asset.id] && !altText[asset.id]?.trim())
              }
              type="button"
              onClick={() => patchAccessibility(asset.id)}
            >
              Save accessibility review
            </button>
          </div>
        ))}
      {item.assets
        .filter(
          (asset) =>
            asset.role === "original" && asset.mimeType.startsWith("image/"),
        )
        .map((asset) => {
          const value = rights[asset.id]!;
          const coreComplete =
            Boolean(value.owner.trim()) &&
            value.sourceReference.trim().length >= 3 &&
            value.proofReference.trim().length >= 3 &&
            value.reviewNote.trim().length >= 3 &&
            (value.status !== "cleared" ||
              ((value.discordAllowed || value.mastodonAllowed) &&
                value.permittedChannelConnectionIds.length > 0));
          return (
            <div className="rights-editor" key={`rights:${asset.id}`}>
              <div>
                <strong>Publication rights for {asset.fileName}</strong>
                <small>
                  Revision {asset.rightsRevision ?? 0} · effective state{" "}
                  {asset.rightsStatus ?? "unchecked"}
                  {asset.rightsReviewedByDisplayName
                    ? ` · reviewed by ${asset.rightsReviewedByDisplayName}`
                    : ""}
                </small>
              </div>
              <div className="rights-checks">
                {brandProfiles.map((profile) => (
                  <label className="check-row" key={profile.id}>
                    <input
                      type="checkbox"
                      checked={value.permittedBrandProfileIds.includes(
                        profile.id,
                      )}
                      onChange={(event) =>
                        togglePermittedBrandProfile(
                          asset.id,
                          profile.id,
                          event.target.checked,
                        )
                      }
                    />
                    {profile.name} ({profile.status})
                  </label>
                ))}
                {brandProfiles.length === 0 && (
                  <p>
                    No published Brand Profile exists. Governed image
                    attachments require a Campaign with an exact permitted Brand
                    Profile.
                  </p>
                )}
              </div>
              <div className="rights-checks">
                {campaigns.map((campaign) => (
                  <label className="check-row" key={campaign.id}>
                    <input
                      type="checkbox"
                      checked={value.permittedCampaignIds.includes(campaign.id)}
                      onChange={(event) =>
                        togglePermittedCampaign(
                          asset.id,
                          campaign.id,
                          event.target.checked,
                        )
                      }
                    />
                    {campaign.name} ({campaign.status})
                  </label>
                ))}
                {campaigns.length === 0 && (
                  <p>
                    No Campaign exists yet. Approve the package, create a
                    Campaign, then return here to grant outbound attachment use.
                  </p>
                )}
              </div>
              <div className="field-grid">
                <label className="field">
                  <span>Review outcome</span>
                  <select
                    value={value.status}
                    onChange={(event) =>
                      setRight(
                        asset.id,
                        "status",
                        event.target.value as RightsDraft["status"],
                      )
                    }
                  >
                    <option value="restricted">Restricted</option>
                    <option value="cleared">Cleared</option>
                  </select>
                </label>
                <label className="field">
                  <span>Rights owner</span>
                  <input
                    maxLength={200}
                    value={value.owner}
                    onChange={(event) =>
                      setRight(asset.id, "owner", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>Licensed owner (optional)</span>
                  <input
                    maxLength={200}
                    value={value.licenseOwner}
                    onChange={(event) =>
                      setRight(asset.id, "licenseOwner", event.target.value)
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>Source reference</span>
                  <input
                    maxLength={1000}
                    value={value.sourceReference}
                    onChange={(event) =>
                      setRight(asset.id, "sourceReference", event.target.value)
                    }
                    placeholder="Controlled source or canonical reference"
                  />
                </label>
                <label className="field field-wide">
                  <span>Permission proof reference</span>
                  <input
                    maxLength={1000}
                    value={value.proofReference}
                    onChange={(event) =>
                      setRight(asset.id, "proofReference", event.target.value)
                    }
                    placeholder="Contract, release, license, or stored evidence reference"
                  />
                </label>
                <label className="field">
                  <span>Valid from (optional)</span>
                  <input
                    type="datetime-local"
                    value={value.validFrom}
                    onChange={(event) =>
                      setRight(asset.id, "validFrom", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>Expires (optional)</span>
                  <input
                    type="datetime-local"
                    value={value.expiresAt}
                    onChange={(event) =>
                      setRight(asset.id, "expiresAt", event.target.value)
                    }
                  />
                </label>
              </div>
              <div className="rights-checks">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={value.commercialUseAllowed}
                    onChange={(event) =>
                      setRight(
                        asset.id,
                        "commercialUseAllowed",
                        event.target.checked,
                      )
                    }
                  />
                  Commercial use allowed
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={value.derivativeUseAllowed}
                    onChange={(event) =>
                      setRight(
                        asset.id,
                        "derivativeUseAllowed",
                        event.target.checked,
                      )
                    }
                  />
                  Derivative use allowed
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={value.worldwideUseAllowed}
                    onChange={(event) =>
                      setRight(
                        asset.id,
                        "worldwideUseAllowed",
                        event.target.checked,
                      )
                    }
                  />
                  Worldwide use allowed
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={value.discordAllowed}
                    onChange={(event) =>
                      setRight(asset.id, "discordAllowed", event.target.checked)
                    }
                  />
                  Discord publishing allowed
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={value.mastodonAllowed}
                    onChange={(event) =>
                      setRight(asset.id, "mastodonAllowed", event.target.checked)
                    }
                  />
                  Mastodon publishing allowed
                </label>
              </div>
              <div className="rights-checks">
                {channelConnections.map((connection) => (
                  <label className="check-row" key={connection.id}>
                    <input
                      type="checkbox"
                      disabled={
                        connection.status === "revoked" &&
                        !value.permittedChannelConnectionIds.includes(
                          connection.id,
                        )
                      }
                      checked={value.permittedChannelConnectionIds.includes(
                        connection.id,
                      )}
                      onChange={(event) =>
                        togglePermittedConnection(
                          asset.id,
                          connection.id,
                          event.target.checked,
                        )
                      }
                    />
                    {connection.name} ({connection.provider.replaceAll("_", " ")} · {connection.status})
                  </label>
                ))}
                {channelConnections.length === 0 && (
                  <p>
                    No Channel Connections are configured. Add one in
                    Integrations before recording a cleared right.
                  </p>
                )}
              </div>
              <div className="field-grid">
                <label className="field field-wide">
                  <span>
                    Attribution requirement (restricted until supported)
                  </span>
                  <input
                    maxLength={1000}
                    value={value.attributionRequirement}
                    onChange={(event) =>
                      setRight(
                        asset.id,
                        "attributionRequirement",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>
                    Watermark requirement (restricted until supported)
                  </span>
                  <input
                    maxLength={1000}
                    value={value.watermarkRequirement}
                    onChange={(event) =>
                      setRight(
                        asset.id,
                        "watermarkRequirement",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>
                    Disclaimer requirement (restricted until supported)
                  </span>
                  <input
                    maxLength={1000}
                    value={value.disclaimerRequirement}
                    onChange={(event) =>
                      setRight(
                        asset.id,
                        "disclaimerRequirement",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>Required review note</span>
                  <textarea
                    maxLength={2000}
                    value={value.reviewNote}
                    onChange={(event) =>
                      setRight(asset.id, "reviewNote", event.target.value)
                    }
                  />
                </label>
              </div>
              <p>
                Cleared requires current worldwide commercial and derivative
                permission for each selected channel, at least one exact publishing account,
                and no unverified obligation. Package approval may precede
                Campaign creation, but attachments cannot preview or publish
                until an exact Campaign and the Campaign&apos;s exact Brand Profile
                are selected here. Unbranded Campaigns cannot publish governed
                image attachments.
              </p>
              <button
                className="button-secondary"
                disabled={pending || !coreComplete}
                type="button"
                onClick={() => putRights(asset.id)}
              >
                Save rights review
              </button>
            </div>
          );
        })}
      {item.conflicts
        .filter((conflict) => conflict.status === "open")
        .map((conflict) => (
          <div key={conflict.id}>
            <span>Resolve {conflict.factKey}</span>
            {conflict.candidateEvidenceIds.map((evidenceId) => {
              const evidence = item.evidence.find(
                (candidate) => candidate.id === evidenceId,
              );
              return (
                <button
                  className="button-secondary"
                  disabled={pending}
                  type="button"
                  key={evidenceId}
                  onClick={() =>
                    post(
                      `/api/v1/content-packages/${item.id}/conflicts/${conflict.id}/resolve`,
                      { workspaceId, evidenceId },
                    )
                  }
                >
                  Use {evidence?.claim ?? evidenceId}
                </button>
              );
            })}
          </div>
        ))}
      {item.evidence
        .filter(
          (evidence) =>
            evidence.provenance === "unresolved" &&
            !evidence.supersededByEvidenceId,
        )
        .map((evidence) => (
          <div key={evidence.id}>
            <span>Resolve {evidence.factKey ?? "unresolved claim"}</span>
            <input
              value={corrections[evidence.id] ?? ""}
              onChange={(event) =>
                setCorrections((current) => ({
                  ...current,
                  [evidence.id]: event.target.value,
                }))
              }
              placeholder="Enter the reviewed correction"
            />
            <button
              className="button-secondary"
              disabled={pending || !corrections[evidence.id]?.trim()}
              type="button"
              onClick={() =>
                post(
                  `/api/v1/content-packages/${item.id}/evidence/${evidence.id}/resolve`,
                  { workspaceId, correctedClaim: corrections[evidence.id] },
                )
              }
            >
              Record correction
            </button>
          </div>
        ))}
      <button
        className="button-primary"
        disabled={
          pending ||
          item.conflicts.some((conflict) => conflict.status === "open") ||
          item.evidence.some(
            (evidence) =>
              evidence.provenance === "unresolved" &&
              !evidence.supersededByEvidenceId,
          ) ||
          item.assets.some((asset) => asset.altTextStatus === "needs_review") ||
          item.assets.some(
            (asset) =>
              asset.role === "original" &&
              asset.mimeType.startsWith("image/") &&
              (asset.scanStatus !== "clean" ||
                (asset.scanRevision ?? 0) < 1 ||
                !asset.scanScannedAt ||
                asset.rightsStatus !== "cleared" ||
                !asset.rightsPermittedChannelConnectionIds?.length),
          ) ||
          item.status === "approved"
        }
        type="button"
        onClick={() =>
          post(`/api/v1/content-packages/${item.id}/approve`, { workspaceId })
        }
      >
        {item.status === "approved" ? "Approved" : "Approve package"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function localDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
