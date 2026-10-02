"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceInvitation, WorkspaceInvitationRole } from "@market-me/database";
import { readMemberRemovalResponse } from "./workspace-member-removal-contract";

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
  showCreateForm = true,
}: {
  workspaceId: string;
  invitations: readonly WorkspaceInvitation[];
  canManage: boolean;
  showCreateForm?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceInvitationRole>("editor");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string }>();
  const inFlight = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || !canManage || !showCreateForm) return;
    inFlight.current = true;
    setPending(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/invitations`, {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role, expiresInDays: 7 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!response.ok) { setMessage({ kind: "error", text: payload?.error?.message ?? "Invitation failed." }); return; }
      setEmail("");
      setMessage({ kind: "success", text: "Invitation ready. The person can now sign in with that verified email." });
      router.refresh();
    } catch {
      if (mounted.current) setMessage({ kind: "error", text: "No confirmed invitation result was received. Reload current invitations before another action; it may have been created." });
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }

  async function revoke(invitationId: string) {
    if (inFlight.current || !canManage || !invitations.some(item => item.id === invitationId && item.status === "pending")) return;
    inFlight.current = true;
    setPending(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/invitations/${invitationId}`, { method: "DELETE", credentials: "same-origin", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
      const payload = await readMemberRemovalResponse(response) as { data?: { id?: unknown; workspaceId?: unknown; status?: unknown } };
      if (!response.ok || response.status !== 200 || payload.data?.id !== invitationId || payload.data.workspaceId !== workspaceId || payload.data.status !== "revoked") {
        throw new Error("Unconfirmed invitation result");
      }
      if (mounted.current) { setMessage({ kind: "success", text: "Selected invitation revoked. Reload the member review for current impact." }); router.refresh(); }
    } catch {
      if (mounted.current) setMessage({ kind: "error", text: "No confirmed revocation result was received. Reload current invitations before another action; the selected grant may already be revoked." });
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }

  return (
    <>
      {canManage && showCreateForm && (
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
        <div className="empty-state"><h3>{showCreateForm ? "No invitations yet" : "No related pending invitations"}</h3><p>{showCreateForm ? "Pending and completed identity grants will appear here." : "Reload the member's removal review to check its current impact."}</p></div>
      ) : (
        <div className="resource-table">
          {invitations.map((invitation) => (
            <article className="resource-row team-invitation-row" key={invitation.id}>
              <div className="resource-primary"><strong>{invitation.email}</strong><p>Created {new Date(invitation.createdAt).toLocaleString()}</p><p>Issued by member {invitation.invitedBy}</p></div>
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
