import Link from "next/link";
import { preparationResultPath } from "./campaign-preparation-request";
import type { SourcePreparationCommandView } from "./source-preparation-binding-request";
import styles from "./source-preparation-binding.module.css";

export function SourcePreparationCommandStatus({ workspaceId, command, showPackageLink = false }: {
  workspaceId: string;
  command: SourcePreparationCommandView;
  showPackageLink?: boolean;
}) {
  return <article className={styles.command}>
    <div className={styles.commandHeader}><strong>{showPackageLink
      ? <Link href={`/content-packages/${command.contentPackageId}`}>Content Package revision {command.contentPackageVersion}</Link>
      : <>Content Package revision {command.contentPackageVersion}</>}</strong>
      <span className={`status-pill ${commandStatusClass(command.status)}`}>{commandStatusLabel(command.status)}</span></div>
    <p>Binding revision {command.bindingRevision} · queued <time dateTime={command.createdAt}>{command.createdAt}</time> · worker attempts {command.attemptCount}</p>
    {command.status === "pending" && <p>Waiting for the preparation worker. No Campaign or provider action has been authorized.</p>}
    {command.status === "processing" && <p>The worker is preparing the draft-only plan. This is not activation or external publication.</p>}
    {command.status === "failed" && <p>Retryable failure recorded{command.nextAttemptAt ? <>; next attempt after <time dateTime={command.nextAttemptAt}>{command.nextAttemptAt}</time></> : ""}.</p>}
    {command.status === "dead_letter" && <p>Terminal failure recorded. This command will not retry automatically; changing the binding does not alter it. Correct the setup and record a new explicit approval only when new draft work is intended.</p>}
    {(command.status === "failed" || command.status === "dead_letter") && command.lastErrorCode && <p>Error code <code>{command.lastErrorCode}</code>{command.safeError ? ` · ${command.safeError}` : ""}</p>}
    {command.status === "completed" && command.preparationId && <p><Link href={preparationResultPath(command.preparationId, workspaceId)}>Open immutable preparation receipt</Link>. The resulting Campaign remains draft-only and requires separate review steps.</p>}
  </article>;
}

function commandStatusLabel(status: SourcePreparationCommandView["status"]): string {
  return status === "dead_letter" ? "Stopped" : status.replaceAll("_", " ");
}

function commandStatusClass(status: SourcePreparationCommandView["status"]): string {
  if (status === "completed") return "status-green";
  if (status === "failed") return "status-amber";
  if (status === "dead_letter") return "status-red";
  return "status-violet";
}
