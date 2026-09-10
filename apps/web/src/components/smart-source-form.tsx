"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StorageConnectionRecord, StoredContextPack, StoredSmartSource } from "@market-me/database";

type FormValues = {
  name: string;
  provider: "google_drive" | "onedrive" | "sharepoint" | "local";
  storageConnectionId: string;
  providerLocationId: string;
  displayPath: string;
  recursive: boolean;
  readinessMode: "immediate" | "related_files" | "ready_marker" | "ai_recommended";
  stabilizationWindowSeconds: number;
  relatedFileMinimum: number;
  readyMarker: string;
  aiConfidenceThreshold: number;
  allowedMimeTypes: string;
  ignorePatterns: string;
  autonomyMode: "draft_only" | "approval_required" | "approve_uncertain" | "confidence_based";
  contextPackIds: string[];
  enabled: boolean;
};

type CompanionOption = { id: string; name: string; status: "active" | "paused" | "revoked"; effectiveHealthState: string };

function initialValues(source?: StoredSmartSource): FormValues {
  return {
    name: source?.name ?? "",
    provider: source?.provider ?? "google_drive",
    storageConnectionId: source?.storageConnectionId ?? "",
    providerLocationId: source?.locations[0]?.providerLocationId ?? "",
    displayPath: source?.locations[0]?.displayPath ?? "",
    recursive: source?.recursive ?? true,
    readinessMode: source?.readinessMode ?? "related_files",
    stabilizationWindowSeconds: source?.stabilizationWindowSeconds ?? 120,
    relatedFileMinimum: source?.relatedFileMinimum ?? 2,
    readyMarker: source?.readyMarker ?? "READY",
    aiConfidenceThreshold: source?.aiConfidenceThreshold ?? 0.85,
    allowedMimeTypes: source?.allowedMimeTypes.join(", ") ?? "image/*, video/*, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.presentationml.presentation, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ignorePatterns: source?.ignorePatterns.join(", ") ?? "**/drafts/**, ~$*",
    autonomyMode: source?.autonomyMode === "draft_only" || source?.autonomyMode === "approval_required" || source?.autonomyMode === "approve_uncertain" || source?.autonomyMode === "confidence_based"
      ? source.autonomyMode
      : "approval_required",
    contextPackIds: [...(source?.contextPackIds ?? [])],
    enabled: source?.enabled ?? true,
  };
}

function list(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function SmartSourceForm({
  workspaceId,
  source,
  connections,
  contextPacks,
  companions,
}: {
  workspaceId: string;
  source?: StoredSmartSource;
  connections: readonly StorageConnectionRecord[];
  contextPacks: readonly StoredContextPack[];
  companions: readonly CompanionOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => initialValues(source));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewEntries, setPreviewEntries] = useState<readonly { providerItemId: string; name: string; mimeType: string; isFolder: boolean }[]>([]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const body = {
      workspaceId,
      storageConnectionId: values.storageConnectionId || undefined,
      name: values.name,
      provider: values.provider,
      locations: [{ providerLocationId: values.providerLocationId, displayPath: values.displayPath }],
      recursive: values.recursive,
      readinessMode: values.readinessMode,
      stabilizationWindowSeconds: values.stabilizationWindowSeconds,
      relatedFileMinimum: values.readinessMode === "related_files" ? values.relatedFileMinimum : undefined,
      readyMarker: values.readinessMode === "ready_marker" ? values.readyMarker : undefined,
      aiConfidenceThreshold: values.readinessMode === "ai_recommended" ? values.aiConfidenceThreshold : undefined,
      allowedMimeTypes: list(values.allowedMimeTypes),
      ignorePatterns: list(values.ignorePatterns),
      contextPackIds: values.contextPackIds,
      autonomyMode: values.autonomyMode,
      enabled: values.enabled,
    };
    const response = await fetch(source ? `/api/v1/smart-sources/${source.id}` : "/api/v1/smart-sources", {
      method: source ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fieldMessages = payload?.error?.fields ? Object.values(payload.error.fields).flat().join(" ") : "";
      setError(fieldMessages || payload?.error?.message || "Could not save the Smart Source.");
      setPending(false);
      return;
    }
    setMessage(source ? "Smart Source updated." : "Smart Source created.");
    setPending(false);
    if (!source) router.push(`/smart-sources/${payload.data.id}/edit`);
    router.refresh();
  }

  async function runTest() {
    if (!source) return;
    setPending(true);
    setError("");
    const response = await fetch(`/api/v1/smart-sources/${source.id}/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload?.error?.message ?? "Test failed.");
    else setMessage(`Test ${payload.data.status}: ${payload.data.diagnostics.map((item: { message: string }) => item.message).join(" ")}`);
    setPending(false);
  }

  async function runSync() {
    if (!source) return;
    setPending(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/v1/smart-sources/${source.id}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload?.error?.message ?? "Synchronization failed.");
    else setMessage(`Sync ${payload.data.status}: ${payload.data.discoveredCount} discovered, ${payload.data.changedCount} changed, ${payload.data.deletedCount} deleted.`);
    setPending(false);
  }

  async function previewFolder() {
    if (!values.storageConnectionId || !values.providerLocationId) return;
    setPending(true);
    setError("");
    setPreviewEntries([]);
    const parameters = new URLSearchParams({ workspaceId, locationId: values.providerLocationId });
    const response = await fetch(`/api/v1/connectors/connections/${values.storageConnectionId}/browse?${parameters}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) setError(payload?.error?.message ?? "Folder preview failed.");
    else {
      setPreviewEntries(payload.data.entries);
      setMessage(`Preview loaded ${payload.data.entries.length} item${payload.data.entries.length === 1 ? "" : "s"}.`);
    }
    setPending(false);
  }

  return (
    <form className="resource-form" onSubmit={save}>
      <section className="form-section">
        <div><h2>Source location</h2><p>Name the source and identify the provider folder Market Me should watch.</p></div>
        <div className="field-grid">
          <label className="field field-wide"><span>Name</span><input required minLength={2} value={values.name} onChange={(event) => set("name", event.target.value)} placeholder="Product launches" /></label>
          <label className="field"><span>Provider</span><select value={values.provider} onChange={(event) => { const provider = event.target.value as FormValues["provider"]; setValues((current) => ({ ...current, provider, storageConnectionId: "", providerLocationId: "", displayPath: provider === "local" ? "Approved companion folder" : "" })); }}><option value="google_drive">Google Drive</option><option value="onedrive">OneDrive</option><option value="sharepoint">SharePoint</option><option value="local">Local folder</option></select></label>
          <label className="field"><span>Connection</span><select value={values.storageConnectionId} onChange={(event) => set("storageConnectionId", event.target.value)} disabled={values.provider === "local"}><option value="">{values.provider === "local" ? "Not required" : "Choose after connecting provider"}</option>{connections.filter((connection) => connection.provider === values.provider && connection.status === "active").map((connection) => <option value={connection.id} key={connection.id}>{connection.displayName}</option>)}</select></label>
          {values.provider === "local" ? <label className="field"><span>Assigned companion</span><select required value={values.providerLocationId} onChange={(event) => setValues((current) => ({ ...current, providerLocationId: event.target.value, displayPath: "Approved companion folder" }))}><option value="">Choose a paired desktop</option>{companions.filter((worker) => worker.status !== "revoked").map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · {worker.status === "paused" ? "paused" : worker.effectiveHealthState}</option>)}</select></label> : <label className="field"><span>Provider folder ID</span><input required value={values.providerLocationId} onChange={(event) => set("providerLocationId", event.target.value)} placeholder="Folder identifier" /></label>}
          <label className="field field-wide"><span>{values.provider === "local" ? "Server-visible label" : "Display path"}</span><input required readOnly={values.provider === "local"} value={values.displayPath} onChange={(event) => set("displayPath", event.target.value)} placeholder={values.provider === "local" ? "Approved companion folder" : "/Marketing/Product launches"} /></label>
          <label className="check-field"><input type="checkbox" checked={values.recursive} onChange={(event) => set("recursive", event.target.checked)} /><span>Include nested folders</span></label>
          {values.storageConnectionId && values.providerLocationId && <button className="button-secondary preview-button" disabled={pending} onClick={previewFolder} type="button">Preview folder</button>}
          {previewEntries.length > 0 && <div className="folder-preview field-wide"><strong>Read-only sample</strong>{previewEntries.slice(0, 8).map((entry) => <span key={entry.providerItemId}>{entry.isFolder ? "Folder" : entry.mimeType}: {entry.name}</span>)}</div>}
        </div>
      </section>

      <section className="form-section">
        <div><h2>Readiness</h2><p>Decide when a stable group of files becomes a content package.</p></div>
        <div className="field-grid">
          <label className="field"><span>Readiness rule</span><select value={values.readinessMode} onChange={(event) => set("readinessMode", event.target.value as FormValues["readinessMode"])}><option value="immediate">Each file immediately</option><option value="related_files">Related file count</option><option value="ready_marker">Ready marker</option><option value="ai_recommended">AI recommendation</option></select></label>
          <label className="field"><span>Stabilization seconds</span><input type="number" min={0} max={86400} value={values.stabilizationWindowSeconds} onChange={(event) => set("stabilizationWindowSeconds", Number(event.target.value))} /></label>
          {values.readinessMode === "related_files" && <label className="field"><span>Minimum related files</span><input type="number" min={1} value={values.relatedFileMinimum} onChange={(event) => set("relatedFileMinimum", Number(event.target.value))} /></label>}
          {values.readinessMode === "ready_marker" && <label className="field"><span>Marker text</span><input value={values.readyMarker} onChange={(event) => set("readyMarker", event.target.value)} /></label>}
          {values.readinessMode === "ai_recommended" && <label className="field"><span>Minimum confidence</span><input type="number" min={0} max={1} step="0.01" value={values.aiConfidenceThreshold} onChange={(event) => set("aiConfidenceThreshold", Number(event.target.value))} /></label>}
        </div>
      </section>

      <section className="form-section">
        <div><h2>Filters & control</h2><p>Use comma-separated MIME types and glob patterns. Approval remains the safe default.</p></div>
        <div className="field-grid">
          <label className="field field-wide"><span>Allowed MIME types</span><input value={values.allowedMimeTypes} onChange={(event) => set("allowedMimeTypes", event.target.value)} /></label>
          <label className="field field-wide"><span>Ignore patterns</span><input value={values.ignorePatterns} onChange={(event) => set("ignorePatterns", event.target.value)} /></label>
          <label className="field"><span>Autonomy</span><select value={values.autonomyMode} onChange={(event) => set("autonomyMode", event.target.value as FormValues["autonomyMode"])}><option value="draft_only">Draft only</option><option value="approval_required">Approval required</option><option value="approve_uncertain">Approve uncertain cases</option><option value="confidence_based">Confidence based</option></select></label>
          <label className="check-field"><input type="checkbox" checked={values.enabled} onChange={(event) => set("enabled", event.target.checked)} /><span>Source enabled</span></label>
        </div>
      </section>

      <section className="form-section">
        <div><h2>Grounding</h2><p>Bind published Context Packs so downstream evidence and content use approved facts and instructions.</p></div>
        <div className="field-grid">
          {contextPacks.length === 0 ? <p className="form-help field-wide">No published Context Packs are available yet.</p> : contextPacks.filter((pack) => pack.currentVersion).map((pack) => <label className="check-field field-wide" key={pack.id}><input type="checkbox" checked={values.contextPackIds.includes(pack.id)} onChange={(event) => set("contextPackIds", event.target.checked ? [...values.contextPackIds, pack.id] : values.contextPackIds.filter((id) => id !== pack.id))} /><span>{pack.name} — published v{pack.currentVersion?.versionNumber}</span></label>)}
        </div>
      </section>

      {(message || error) && <div className={error ? "form-message form-error" : "form-message form-success"} role="status">{error || message}</div>}
      <div className="form-actions">
        {source?.storageConnectionId && <button className="button-secondary" disabled={pending} onClick={runSync} type="button">Sync now</button>}
        {source && <button className="button-secondary" disabled={pending} onClick={runTest} type="button">Test configuration</button>}
        <button className="button-primary" disabled={pending} type="submit">{pending ? "Working…" : source ? "Save changes" : "Create Smart Source"}</button>
      </div>
    </form>
  );
}
