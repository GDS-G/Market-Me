"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceInvitation, WorkspaceInvitationRole } from "@market-me/database";

const ROLES: readonly { value: WorkspaceInvitationRole; label: string }[] = [
  { value: "admin", label: "Administrator" },
  { value: "editor", label: "Editor" },
  { value: "approver", label: "Approver" },
  { value: "analyst", label: "Analyst" },
  { value: "viewer", label: "Viewer" },
];

export function TeamInvitations({
  workspaceId,
  invitations,
  canManage,
}: {
  workspaceId: string;
  invitations: readonly WorkspaceInvitation[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceInvitationRole>("editor");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role, expiresInDays: 7 }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage({ kind: "error", text: payload?.error?.message ?? "Invitation failed." });
      setPending(false);
      return;
    }
    setEmail("");
    setMessage({ kind: "success", text: "Invitation ready. The person can now sign in with that verified email." });
    setPending(false);
    router.refresh();
  }

  async function revoke(invitationId: string) {
    setPending(true);
    setMessage(undefined);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/invitations/${invitationId}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setMessage({ kind: "error", text: payload?.error?.message ?? "Revocation failed." });
      return;
    }
    setMessage({ kind: "success", text: "Invitation revoked." });
    router.refresh();
  }

  return (
    <>
      {canManage && (
        <form className="team-invite-form" onSubmit={invite}>
          <label>
            <span>Verified email</span>
            <input autoComplete="email" maxLength={320} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label>
            <span>Workspace role</span>
            <select onChange={(event) => setRole(event.target.value as WorkspaceInvitationRole)} value={role}>
              {ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button className="button-primary resource-button" disabled={pending} type="submit">
            {pending ? "Saving…" : "Invite for 7 days"}
          </button>
        </form>
      )}
      {message && <p className={message.kind === "error" ? "form-error" : "form-message"} role="status">{message.text}</p>}
      {invitations.length === 0 ? (
        <div className="empty-state"><h3>No invitations yet</h3><p>Pending and completed identity grants will appear here.</p></div>
      ) : (
        <div className="resource-table">
          {invitations.map((invitation) => (
            <article className="resource-row team-invitation-row" key={invitation.id}>
              <div className="resource-primary"><strong>{invitation.email}</strong><p>Created {new Date(invitation.createdAt).toLocaleString()}</p></div>
              <div><span className="resource-label">Role</span><strong>{invitation.role}</strong></div>
              <div><span className="resource-label">Expires</span><strong>{new Date(invitation.expiresAt).toLocaleDateString()}</strong></div>
              <span className={`status-pill ${invitation.status === "accepted" ? "status-green" : invitation.status === "pending" ? "status-amber" : "status-neutral"}`}>{invitation.status}</span>
              {canManage && invitation.status === "pending" && (
                <button className="button-secondary" disabled={pending} onClick={() => revoke(invitation.id)} type="button">Revoke</button>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
