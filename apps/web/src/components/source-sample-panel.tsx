"use client";

import { useEffect, useRef, useState } from "react";
import { parseScopedSourceSample, readSourceSampleResponse, type SourceSampleView } from "./source-sample-contract";
import styles from "./source-sample.module.css";

export interface SourceSamplePanelProps {
  workspaceId: string;
  smartSourceId: string;
  sourceVersion: number;
  provider: "local" | "google_drive" | "onedrive" | "sharepoint";
  locations: readonly { displayPath: string }[];
  canWrite: boolean;
}
export function SourceSamplePanel(props: SourceSamplePanelProps) {
  return <SourceSamplePanelState key={JSON.stringify([props.workspaceId, props.smartSourceId, props.sourceVersion, props.provider, props.canWrite, props.locations])} {...props} />;
}
function SourceSamplePanelState(props: SourceSamplePanelProps) {
  const [locationIndex, setLocationIndex] = useState(0);
  const [result, setResult] = useState<SourceSampleView>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => { inFlight.current?.abort(); }, []);

  async function test() {
    if (!props.canWrite || inFlight.current || !props.locations[locationIndex]) return;
    const controller = new AbortController(); inFlight.current = controller;
    setPending(true); setResult(undefined); setError("");
    try {
      const response = await fetch(`/api/v1/smart-sources/${props.smartSourceId}/sample`, { method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: props.workspaceId, expectedSourceVersion: props.sourceVersion, locationIndex }) });
      const payload: unknown = await readSourceSampleResponse(response);
      if (!response.ok) {
        const message = payload && typeof payload === "object" && "error" in payload && payload.error && typeof payload.error === "object"
          && "message" in payload.error && typeof payload.error.message === "string" && payload.error.message.length < 1_000 ? payload.error.message : "The dry test could not complete. Reload the saved source and try again.";
        setError(message); return;
      }
      const data = payload && typeof payload === "object" && "data" in payload ? payload.data : undefined;
      const sample = parseScopedSourceSample(data, { ...props, locationIndex });
      if (!controller.signal.aborted) setResult(sample);
    } catch {
      if (!controller.signal.aborted) setError("No usable dry-test result was received. Check your connection and retry; testing never enables the source.");
    } finally {
      if (inFlight.current === controller) { inFlight.current = null; setPending(false); }
    }
  }
  return <section className={`resource-panel ${styles.panel}`} aria-label="Smart Source dry test">
    <div className={styles.heading}><div><p className="eyebrow">Test before activation</p><h2>What would this source do?</h2></div><span className={styles.badge}>Metadata only</span></div>
    <p>Test saved configuration v{props.sourceVersion}. Unsaved edits above are not included. Testing does not enable synchronization, create a package or draft, approve content, or publish anything.</p>
    <p className={styles.coverage}>{props.provider === "local"
      ? "Uses up to 200 historical indexed items. This does not read your computer or ask the companion to scan. Previously excluded, new or changed files may be missing, and old items may refer to earlier folder settings."
      : "Reads one page of up to 200 direct children in the selected saved cloud folder. It does not enter subfolders or download file contents. An existing storage credential may be refreshed."}</p>
    <div className={styles.actions}>
      <label>Saved location<select value={locationIndex} disabled={pending || !props.canWrite} onChange={(event) => { setLocationIndex(Number(event.target.value)); setResult(undefined); setError(""); }}>
        {props.locations.map((location, index) => <option key={index} value={index}>{location.displayPath}</option>)}
      </select></label>
      <button type="button" className={styles.runButton} disabled={pending || !props.canWrite || props.locations.length === 0} onClick={() => void test()}>{pending ? "Testing saved source…" : "Run dry test"}</button>
    </div>
    {!props.canWrite && <p>Dry tests require a current owner, administrator, or editor.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {result && <SourceSampleResult sample={result} />}
  </section>;
}

const outcomeLabels: Record<SourceSampleView["simulation"]["items"][number]["outcome"], string> = {
  folder: "Folder only", ignored: "Ignored", ready_for_analysis: "Candidate for analysis", waiting: "Waiting", unknown: "Not established", review_required: "Review required",
};
export function SourceSampleResult({ sample }: { sample: SourceSampleView }) {
  const { simulation, context } = sample;
  const issues = context.facts.filter((fact) => fact.status !== "resolved");
  return <div className={styles.result} aria-live="polite">
    <h3>Dry-test result · {sample.source.enabled ? "synchronization was enabled" : "source remains paused"}</h3>
    <p>{sample.source.name} · saved v{sample.source.version} · {sample.location}</p>
    <p className={styles.coverage}><strong>{sample.coverage.kind === "historical_local_index" ? "Historical index only—not current folder contents."
      : sample.coverage.partial ? "Partial folder sample—not a complete inventory." : "One direct-child folder page; no subfolders inspected."}</strong>{" "}
      {sample.coverage.truncated && "More entries exist outside this returned sample. "}
      {sample.source.recursive && (sample.coverage.kind === "cloud_folder_page"
        ? "Recursion is configured, but this test does not traverse subfolders. "
        : "Recursion is configured; this sample contains only previously indexed entries, including any indexed descendants. ")}
      Missing evidence is not proof that a file or supporting document does not exist.</p>
    <div className={styles.counts}>
      <div><strong>{simulation.counts.inspected}</strong><span>items inspected</span></div>
      <div><strong>{simulation.counts.ignored}</strong><span>ignored by filters</span></div>
      <div><strong>{simulation.counts.readyForAnalysis}</strong><span>candidates for analysis</span></div>
      <div><strong>{simulation.counts.waiting + simulation.counts.unknown + simulation.counts.reviewRequired}</strong><span>waiting / uncertain / review</span></div>
    </div>
    <h3>Detected items and proposed packages</h3>
    <p>Each eligible root file can lead to its own Content Package after intake and content analysis. Supporting-file relationships below explain readiness only: they do not merge those files into one package. No package was created, and final readiness, rights, accessibility, and approval were not evaluated.</p>
    {simulation.items.length === 0 ? <p className={styles.coverage}>No items are available in this sample. This does not establish that the current source folder is empty.</p>
      : <ol className={styles.items}>{simulation.items.map((item) => <li key={item.index}>
        <div className={styles.itemHeading}><strong>{item.index + 1}. {item.name}</strong><span className={styles.badge}>{outcomeLabels[item.outcome]}</span></div>
        <p className={styles.path}>{item.displayPath} · {item.mimeType}</p><p>{item.reason}</p>
        {item.relatedItemIndexes.length > 0 && <p className={styles.related}>Observed readiness group: items {item.relatedItemIndexes.map((index) => index + 1).join(", ")} (includes this root).</p>}
      </li>)}</ol>}
    <h3>Context that would be consulted</h3>
    {context.packs.length ? <ul>{context.packs.map((pack, index) => <li key={index}>{pack.name} · published v{pack.versionNumber}</li>)}</ul> : <p>No Context Packs are selected.</p>}
    <p>{context.facts.filter((fact) => fact.status === "resolved").length} structured fact keys resolved. {issues.length} unresolved or conflicting keys. {context.unresolvedRecordedFacts} recorded fact rows lack usable source-backed values.</p>
    {issues.length > 0 && <ul>{issues.map((fact) => <li key={fact.factKey}><strong>{fact.factKey}</strong>: {fact.reason}</li>)}</ul>}
    <p>This checks published structured facts and their authority rules only. It does not interpret file contents or context instructions.</p>
    <h3>Proposed next step</h3>
    <p>Review ignored and uncertain items, correct the saved settings if needed, and test again. Starting synchronization is a separate action. Later content analysis can create packages that still need review.</p>
    <p>{sample.preparation?.enabled
      ? `Saved preparation binding v${sample.preparation.revision} is enabled. A later explicit package approval may queue draft-only preparation if its current references and writer remain valid.`
      : "No enabled preparation binding was captured. This sample does not queue a Campaign or drafts."} Preparation, finalization, and activation remain separate.</p>
    <p className={styles.boundary}>AI requests in this test: 0. Future processing cost: not estimated. This is not a prediction of zero monthly spend. Result captured at {simulation.evaluatedAt}; it is not an approval or activation token.</p>
  </div>;
}
