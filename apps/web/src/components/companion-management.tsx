"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

interface WorkerView {
  id: string;
  name: string;
  platform: string;
  architecture: string;
  appVersion: string;
  status: "active" | "paused" | "revoked";
  effectiveHealthState: string;
  tokenPrefix: string;
  capabilities: Record<string, boolean>;
  lastSeenAt?: string;
}

interface JobView {
  id: string;
  workerId: string;
  campaignInstanceId?: string;
  campaignStepRunId?: string;
  action: string;
  actionMode: string;
  targetUrl: string;
  status: string;
  attemptCount: number;
  createdAt: string;
  lastError?: string;
}

async function responseMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as
    { error?: { message?: string } } | undefined;
  return body?.error?.message ?? `Request failed (${response.status})`;
}

export function CompanionManagement({
  workspaceId,
  workers,
  jobs,
}: {
  workspaceId: string;
  workers: WorkerView[];
  jobs: JobView[];
}) {
  const router = useRouter();
  const [pairingCode, setPairingCode] = useState<{
    code: string;
    expiresAt: string;
  }>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function createPairingCode() {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/v1/companion/pairing-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const body = (await response.json()) as {
        data: { code: string; expiresAt: string };
      };
      setPairingCode(body.data);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to create a pairing code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function command(
    workerId: string,
    value: "pause" | "resume" | "revoke",
  ) {
    if (
      value === "revoke" &&
      !window.confirm(
        "Revoke this companion and cancel its active jobs? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/v1/companion/workers/${workerId}/commands`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, command: value }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update the companion.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createTestJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/companion/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          workerId: data.get("workerId"),
          action: "open_url",
          mode: data.get("mode"),
          targetUrl: data.get("targetUrl"),
          instructions: data.get("instructions"),
          idempotencyKey: `manual-${crypto.randomUUID()}`,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      event.currentTarget.reset();
      setMessage(
        "Test job queued. The companion will display it for user confirmation.",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to queue the job.",
      );
    } finally {
      setBusy(false);
    }
  }

  const activeWorkers = workers.filter((worker) => worker.status !== "revoked");

  return (
    <>
      {message ? (
        <p
          className={
            message.includes("queued")
              ? "form-message form-success"
              : "form-message form-error"
          }
        >
          {message}
        </p>
      ) : null}
      <section className="form-section companion-section">
        <div>
          <h2>Pair a desktop</h2>
          <p>
            Create a ten-minute, one-use code. The companion exchanges it for a
            device token kept in the operating-system credential store.
          </p>
        </div>
        <div className="field-grid">
          <button
            className="resource-button button-primary field-wide"
            disabled={busy}
            onClick={createPairingCode}
            type="button"
          >
            Create pairing code
          </button>
          {pairingCode ? (
            <div className="pairing-code field-wide">
              <strong>{pairingCode.code}</strong>
              <p>
                Expires {new Date(pairingCode.expiresAt).toLocaleTimeString()}.
                Enter it only in the Market Me companion.
              </p>
            </div>
          ) : null}
        </div>
      </section>
      <section className="resource-panel companion-workers">
        <div className="resource-panel-head">
          <div>
            <h2>Desktop companions</h2>
            <p>Heartbeat, pause, capability, version, and platform state.</p>
          </div>
          <span className="status-pill status-green">
            {activeWorkers.length} available
          </span>
        </div>
        {workers.length ? (
          workers.map((worker) => (
            <article className="companion-worker-row" key={worker.id}>
              <div>
                <strong>{worker.name}</strong>
                <p>
                  {worker.platform} · {worker.architecture} · app{" "}
                  {worker.appVersion} · token {worker.tokenPrefix}…
                </p>
                <small>
                  {worker.lastSeenAt
                    ? `Last heartbeat ${new Date(worker.lastSeenAt).toLocaleString()}`
                    : "Waiting for first heartbeat"}
                </small>
              </div>
              <span
                className={`status-pill status-${worker.effectiveHealthState === "healthy" ? "green" : worker.effectiveHealthState === "disconnected" ? "red" : "amber"}`}
              >
                {worker.status === "paused"
                  ? "paused"
                  : worker.effectiveHealthState}
              </span>
              <div className="companion-actions">
                {worker.status === "active" ? (
                  <button
                    disabled={busy}
                    onClick={() => command(worker.id, "pause")}
                    type="button"
                  >
                    Pause
                  </button>
                ) : worker.status === "paused" ? (
                  <button
                    disabled={busy}
                    onClick={() => command(worker.id, "resume")}
                    type="button"
                  >
                    Resume
                  </button>
                ) : null}
                {worker.status !== "revoked" ? (
                  <button
                    className="danger-button"
                    disabled={busy}
                    onClick={() => command(worker.id, "revoke")}
                    type="button"
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state companion-empty">
            <h3>No companion paired</h3>
            <p>
              Install the desktop preview, create a code above, and pair it to
              this workspace.
            </p>
          </div>
        )}
      </section>
      <section className="form-section companion-section">
        <div>
          <h2>Assisted test job</h2>
          <p>
            Queue one narrowly scoped HTTPS page-open action. The companion
            verifies the signed envelope and exact domain before asking the user
            to continue.
          </p>
        </div>
        <form className="field-grid" onSubmit={createTestJob}>
          <label className="field">
            <span>Companion</span>
            <select disabled={!activeWorkers.length} name="workerId" required>
              {activeWorkers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Mode</span>
            <select defaultValue="assisted" name="mode">
              <option value="assisted">Assisted</option>
              <option value="confirm_before_submit">
                Confirm before submit
              </option>
            </select>
          </label>
          <label className="field field-wide">
            <span>HTTPS target</span>
            <input
              defaultValue="https://example.com/"
              maxLength={2048}
              name="targetUrl"
              required
              type="url"
            />
          </label>
          <label className="field field-wide">
            <span>User instructions</span>
            <textarea
              defaultValue="Open the approved test page and confirm it matches the expected domain."
              maxLength={2000}
              name="instructions"
              required
            />
          </label>
          <button
            className="resource-button button-primary field-wide"
            disabled={busy || !activeWorkers.length}
            type="submit"
          >
            Queue signed test job
          </button>
        </form>
      </section>
      <section className="resource-panel companion-jobs">
        <div className="resource-panel-head">
          <div>
            <h2>Recent companion jobs</h2>
            <p>Every claim is leased, signed, replay-bounded, and auditable.</p>
          </div>
        </div>
        {jobs.length ? (
          jobs.map((job) => (
            <article className="companion-job-row" key={job.id}>
              <div>
                <strong>
                  {job.action.replaceAll("_", " ")} ·{" "}
                  {job.actionMode.replaceAll("_", " ")}
                </strong>
                <p>{job.targetUrl}</p>
                {job.campaignInstanceId ? (
                  <small>
                    Campaign {job.campaignInstanceId} · step run{" "}
                    {job.campaignStepRunId}
                  </small>
                ) : (
                  <small>Operator test job</small>
                )}
                {job.lastError ? <small>{job.lastError}</small> : null}
              </div>
              <span>Attempt {job.attemptCount}</span>
              <span
                className={`status-pill status-${job.status === "succeeded" ? "green" : job.status === "failed" ? "red" : "amber"}`}
              >
                {job.status}
              </span>
            </article>
          ))
        ) : (
          <p className="discovered-empty">No companion jobs yet.</p>
        )}
      </section>
    </>
  );
}
