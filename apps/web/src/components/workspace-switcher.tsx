"use client";

import { useActionState, useId } from "react";
import { switchActiveWorkspace } from "@/server/workspace-actions";
import type { WorkspaceSwitchState } from "@/server/workspace-selection";
import styles from "./workspace-switcher.module.css";

export function WorkspaceSwitcher({ workspaces, workspaceId, returnPath }: {
  workspaces: readonly { workspaceId: string; workspaceName: string }[];
  workspaceId: string;
  returnPath: string;
}) {
  const [state, formAction, pending] = useActionState<WorkspaceSwitchState, FormData>(switchActiveWorkspace, {});
  const selectId = useId();
  const selected = workspaces.find((workspace) => workspace.workspaceId === workspaceId);
  if (workspaces.length < 2) return (
    <div className="workspace-picker">
      <span className="workspace-avatar" aria-hidden="true">MM</span>
      <span className="workspace-copy"><strong>{selected?.workspaceName}</strong><small>Workspace</small></span>
    </div>
  );
  return (
    <form action={formAction} className={styles.form} aria-label="Switch workspace">
      <label htmlFor={selectId}>Workspace</label>
      <select id={selectId} name="workspaceId" defaultValue={workspaceId} disabled={pending}>
        {workspaces.map((workspace) => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.workspaceName}</option>)}
      </select>
      <input type="hidden" name="returnPath" value={returnPath} />
      <button type="submit" disabled={pending}>{pending ? "Switching…" : "Switch workspace"}</button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
