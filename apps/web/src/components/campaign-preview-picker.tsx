"use client";

import { useState } from "react";
import type { StoredCampaignPreviewOption } from "@market-me/database";

export interface PreviewEligibility {
  eligible: boolean;
  reasons: readonly string[];
}

export function assessCampaignPreview(option: StoredCampaignPreviewOption, destinationId: string): PreviewEligibility {
  const reasons: string[] = [];
  if (!option.isCurrentApprovedVersion) reasons.push("The exact Draft version is no longer current and approved.");
  if (option.status !== "ready") reasons.push(...(option.validationIssues.length ? option.validationIssues.map((issue) => issue.message) : ["The channel render is blocked."]));
  if (option.isStale) reasons.push("The channel capability snapshot is stale or the connection is inactive.");
  if (option.linkMode === "tracked" && (!option.trackedLinkId || option.trackedLinkStatus !== "active")) reasons.push("The approved first-party tracked link is unavailable.");
  if ((option.destinationId ?? "") !== destinationId) reasons.push(destinationId
    ? "The preview does not use the Campaign's selected Destination."
    : "The preview includes a Destination while this Campaign does not.");
  return { eligible: reasons.length === 0, reasons };
}

export function readDraftChannelPreviewId(inputJson: string): string {
  try {
    const parsed: unknown = JSON.parse(inputJson);
    return isRecord(parsed) && typeof parsed.draftChannelPreviewId === "string" ? parsed.draftChannelPreviewId : "";
  } catch {
    return "";
  }
}

export function writeDraftChannelPreviewId(inputJson: string, previewId: string): string {
  const parsed: unknown = JSON.parse(inputJson);
  if (!isRecord(parsed)) throw new Error("Step inputs must be a JSON object before selecting a preview.");
  const next = { ...parsed };
  if (previewId) {
    next.draftChannelPreviewId = previewId;
    delete next.appendDestination;
    delete next.useTrackedLink;
    delete next.channelConnectionId;
    delete next.channel_connection_id;
  } else {
    delete next.draftChannelPreviewId;
  }
  return JSON.stringify(next, null, 2);
}

export function CampaignPreviewPicker({ options, destinationId, inputJson, onInputJsonChange }: {
  options: readonly StoredCampaignPreviewOption[];
  destinationId: string;
  inputJson: string;
  onInputJsonChange: (value: string) => void;
}) {
  const [error, setError] = useState("");
  const selectedId = readDraftChannelPreviewId(inputJson);
  const selected = options.find((option) => option.id === selectedId);
  const selectedEligibility = selected ? assessCampaignPreview(selected, destinationId) : undefined;

  function select(previewId: string) {
    setError("");
    try {
      onInputJsonChange(writeDraftChannelPreviewId(inputJson, previewId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Step inputs must be valid JSON before selecting a preview.");
    }
  }

  return <div className="campaign-preview-picker field-wide">
    <label className="field">
      <span>Exact approved channel preview</span>
      <select value={selectedId} onChange={(event) => select(event.target.value)}>
        <option value="">No preview — use advanced inputs</option>
        {selectedId && !selected && <option value={selectedId}>Configured preview is unavailable</option>}
        {options.map((option) => {
          const eligibility = assessCampaignPreview(option, destinationId);
          const audience = option.audienceName ?? "General audience";
          const destination = option.destinationTitle ?? "No Destination";
          const state = eligibility.eligible ? "ready" : "unavailable";
          const mode = option.linkMode === "tracked" ? "tracked" : "canonical";
          return <option disabled={!eligibility.eligible && option.id !== selectedId} key={option.id} value={option.id}>{audience} · {option.draftHeadline} · {option.channelConnectionName} · {destination} · {mode} · {option.assets.length} media · {state}</option>;
        })}
      </select>
      <small>Selection writes the immutable preview reference and removes conflicting link/connection override fields. Other advanced inputs are preserved.</small>
    </label>
    {!options.length && <p className="form-help">No previews exist for this Campaign. Generate and approve a Draft, then create its channel preview first.</p>}
    {selected ? <div aria-live="polite" className={`campaign-preview-summary ${selectedEligibility?.eligible ? "preview-eligible" : "preview-ineligible"}`}>
      <div><strong>{selected.channelConnectionName}</strong><span className={`status-pill ${selectedEligibility?.eligible ? "status-green" : "status-amber"}`}>{selectedEligibility?.eligible ? "eligible" : "attention"}</span></div>
      <p>{selected.provider.replaceAll("_", " ")} · source Campaign v{selected.sourceCampaignVersionNumber} · {selected.destinationTitle ?? "no Destination"} · {selected.linkMode === "tracked" ? "approved tracked URL" : "canonical URL"} · {selected.characterCount}{selected.characterLimit ? ` / ${selected.characterLimit}` : ""} characters · {selected.assets.length} attachment{selected.assets.length === 1 ? "" : "s"}</p>
      {selected.renderedSubject && <p><strong>Subject:</strong> {selected.renderedSubject}</p>}
      <pre>{selected.renderedContent}</pre>
      {selectedEligibility?.reasons.map((reason) => <p className="form-error" key={reason}>{reason}</p>)}
    </div> : selectedId ? <p className="form-error">This Campaign can no longer access the configured preview. Select a current eligible preview before publishing or activation.</p> : null}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
