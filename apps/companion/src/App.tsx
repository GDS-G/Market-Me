import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

interface CompanionStatus {
  paired: boolean;
  serverUrl?: string;
  workerId?: string;
  workerName?: string;
  localPaused: boolean;
  approvedFolder?: string;
  localSyncIntervalSeconds: number;
  lastLocalSyncAt?: string;
}

interface JobEnvelope {
  jobId: string;
  mode: "assisted" | "confirm_before_submit";
  targetUrl: string;
  expectedOrigin: string;
  instructions: string;
  expiresAt: string;
}

interface SignedJob { envelope: JobEnvelope; signature: string }

const emptyStatus: CompanionStatus = { paired: false, localPaused: false, localSyncIntervalSeconds: 60 };

export function App() {
  const [status, setStatus] = useState<CompanionStatus>(emptyStatus);
  const [job, setJob] = useState<SignedJob>();
  const [message, setMessage] = useState<string>("Loading local status…");
  const [busy, setBusy] = useState(false);
  const localSyncActive = useRef(false);

  const refresh = useCallback(async () => {
    try { const next = await invoke<CompanionStatus>("companion_status"); setStatus(next); setMessage(next.paired ? "Companion ready" : "Pair this device to begin"); }
    catch (error) { setMessage(String(error)); }
  }, []);

  const heartbeat = useCallback(async () => {
    if (!status.paired) return;
    try {
      const response = await invoke<{ status: string }>("send_heartbeat");
      if (response.status === "paused" && !status.localPaused) setMessage("Paused by the workspace administrator");
    } catch (error) { setMessage(`Heartbeat needs attention: ${String(error)}`); }
  }, [status.localPaused, status.paired]);

  const poll = useCallback(async () => {
    if (!status.paired || status.localPaused || job) return;
    try { const next = await invoke<SignedJob | null>("claim_job"); if (next) { setJob(next); setMessage("A signed job is waiting for your confirmation"); } }
    catch (error) { setMessage(`Job polling needs attention: ${String(error)}`); }
  }, [job, status.localPaused, status.paired]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void heartbeat(); const timer = window.setInterval(() => void heartbeat(), 30_000); return () => window.clearInterval(timer); }, [heartbeat]);
  useEffect(() => { void poll(); const timer = window.setInterval(() => void poll(), 10_000); return () => window.clearInterval(timer); }, [poll]);

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await invoke("pair_companion", { serverUrl: data.get("serverUrl"), code: data.get("code"), workerName: data.get("workerName") });
      setMessage("Paired successfully. The device token is in your operating-system credential store."); await refresh();
    } catch (error) { setMessage(`Pairing failed: ${String(error)}`); }
    finally { setBusy(false); }
  }

  async function togglePause() {
    setBusy(true);
    try { const next = await invoke<CompanionStatus>("set_local_pause", { paused: !status.localPaused }); setStatus(next); if (!next.localPaused) setJob(undefined); setMessage(next.localPaused ? "Local emergency pause is active" : "Local execution resumed"); }
    catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  }

  async function chooseFolder() {
    setBusy(true);
    try { const next = await invoke<CompanionStatus>("select_approved_folder"); setStatus(next); setMessage(next.approvedFolder ? "Approved folder saved locally" : "Folder selection canceled"); }
    catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  }

  const syncFolder = useCallback(async (automatic = false) => {
    if (localSyncActive.current) return;
    localSyncActive.current = true;
    if (!automatic) setBusy(true);
    try {
      const result = await invoke<{ sourceCount: number; fileCount: number; uploadedCount: number }>("sync_local_sources");
      setMessage(`Synced ${result.fileCount} local file${result.fileCount === 1 ? "" : "s"} across ${result.sourceCount} Smart Source${result.sourceCount === 1 ? "" : "s"}; uploaded ${result.uploadedCount} changed file${result.uploadedCount === 1 ? "" : "s"}.`);
      await refresh();
    } catch (error) { setMessage(`Local sync failed: ${String(error)}`); }
    finally { localSyncActive.current = false; if (!automatic) setBusy(false); }
  }, [refresh]);

  useEffect(() => {
    if (!status.paired || status.localPaused || !status.approvedFolder || status.localSyncIntervalSeconds === 0) return;
    const timer = window.setInterval(() => void syncFolder(true), status.localSyncIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [status.approvedFolder, status.localPaused, status.localSyncIntervalSeconds, status.paired, syncFolder]);

  async function changeSyncInterval(seconds: number) {
    setBusy(true);
    try { setStatus(await invoke<CompanionStatus>("set_local_sync_interval", { seconds })); setMessage(seconds ? `Foreground folder sync set to every ${seconds / 60} minute${seconds === 60 ? "" : "s"}` : "Automatic foreground folder sync is off"); }
    catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  }

  async function executeJob() {
    if (!job) return;
    setBusy(true);
    try { await invoke("execute_job", { signedJob: job }); setMessage("The approved page was opened and the result was recorded"); setJob(undefined); }
    catch (error) { setMessage(`Job failed: ${String(error)}`); }
    finally { setBusy(false); }
  }

  return <main className="shell">
    <header><div className="brand-mark">M</div><div><p>Market Me</p><h1>Desktop companion</h1></div><span className={`state ${status.paired ? "healthy" : "offline"}`}>{status.paired ? "Paired" : "Not paired"}</span></header>
    <div className={`notice ${message.includes("failed") || message.includes("attention") ? "warning" : ""}`}>{message}</div>
    {!status.paired ? <section className="card"><div className="card-copy"><span>Secure setup</span><h2>Pair this device</h2><p>Create a one-time code in Market Me’s Companion page. Only localhost may use HTTP; all remote control planes require HTTPS.</p></div><form onSubmit={pair}>
      <label><span>Market Me server</span><input defaultValue="http://localhost:3000" name="serverUrl" required type="url" /></label>
      <label><span>Pairing code</span><input autoCapitalize="characters" maxLength={32} name="code" placeholder="MM-XXXX-XXXX" required /></label>
      <label><span>Device name</span><input defaultValue="My desktop" maxLength={100} name="workerName" required /></label>
      <button disabled={busy} type="submit">Pair securely</button>
    </form></section> : <>
      <section className="summary-grid"><article><span>Control plane</span><strong>{status.serverUrl}</strong><small>Worker {status.workerName}</small></article><article><span>Local execution</span><strong>{status.localPaused ? "Paused" : "Ready"}</strong><small>Attended actions only in this preview</small></article><article><span>Approved folder</span><strong>{status.approvedFolder ? "Configured" : "Not selected"}</strong><small>{status.lastLocalSyncAt ? `Last synced ${new Date(status.lastLocalSyncAt).toLocaleString()}` : status.approvedFolder ?? "No local folder access"}</small></article></section>
      <section className="actions"><button className={status.localPaused ? "resume" : "danger"} disabled={busy} onClick={togglePause}>{status.localPaused ? "Resume local worker" : "Emergency pause"}</button><button disabled={busy} onClick={chooseFolder}>Choose approved folder</button><button disabled={busy || status.localPaused || !status.approvedFolder} onClick={() => void syncFolder(false)}>Sync approved folder</button><label><span>Foreground sync</span><select disabled={busy} value={status.localSyncIntervalSeconds} onChange={(event) => void changeSyncInterval(Number(event.target.value))}><option value={0}>Off</option><option value={60}>Every minute</option><option value={300}>Every 5 minutes</option><option value={900}>Every 15 minutes</option><option value={3600}>Every hour</option></select></label><button disabled={busy || status.localPaused} onClick={() => void poll()}>Check for jobs</button></section>
      <section className="card job-card"><div className="card-copy"><span>Signed job queue</span><h2>{job ? "User confirmation required" : "No job waiting"}</h2><p>{job ? "Verify the domain and instructions before opening the page. Website challenges remain under your control." : "The companion polls only while paired and unpaused. No broad browser or filesystem authority is granted."}</p></div>{job ? <div className="job-detail"><dl><div><dt>Mode</dt><dd>{job.envelope.mode.replaceAll("_", " ")}</dd></div><div><dt>Expected origin</dt><dd>{job.envelope.expectedOrigin}</dd></div><div><dt>Expires</dt><dd>{new Date(job.envelope.expiresAt).toLocaleTimeString()}</dd></div></dl><p>{job.envelope.instructions}</p><code>{job.envelope.targetUrl}</code><button disabled={busy || status.localPaused} onClick={executeJob}>Verify and open page</button></div> : <div className="empty-job">Waiting for a narrowly scoped action</div>}</section>
    </>}
    <footer>Secrets stay in the operating-system credential store. Absolute folder paths and browser sessions are not sent to the control plane.</footer>
  </main>;
}
