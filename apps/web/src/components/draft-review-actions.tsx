"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DraftSubmitAction({ workspaceId, draftId, status }: { workspaceId: string; draftId: string; status: string }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  async function submit() { setPending(true); setError(""); const response = await fetch(`/api/v1/drafts/${draftId}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId }) }); const payload = await response.json().catch(() => ({})); setPending(false); if (!response.ok) setError(payload?.error?.message ?? "Could not submit draft."); router.refresh(); }
  return <div className="review-actions"><button className="button-primary" disabled={pending || !["working", "changes_requested"].includes(status)} onClick={submit}>{status === "pending_review" ? "Awaiting review" : "Submit exact version for review"}</button>{error && <p className="form-error">{error}</p>}</div>;
}

export function DraftApprovalActions({ workspaceId, approvalId }: { workspaceId: string; approvalId: string }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [notes, setNotes] = useState(""); const [error, setError] = useState("");
  async function decide(decision: "approved" | "rejected" | "changes_requested") { setPending(true); setError(""); const response = await fetch(`/api/v1/draft-approvals/${approvalId}/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, decision, notes: notes || undefined }) }); const payload = await response.json().catch(() => ({})); setPending(false); if (!response.ok) setError(payload?.error?.message ?? "Draft decision failed."); router.refresh(); }
  return <div className="review-actions"><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Decision notes (optional)" /><div><button className="button-primary" disabled={pending} onClick={() => decide("approved")}>Approve</button><button className="button-secondary" disabled={pending} onClick={() => decide("changes_requested")}>Request changes</button><button className="button-secondary" disabled={pending} onClick={() => decide("rejected")}>Reject</button></div>{error && <p className="form-error">{error}</p>}</div>;
}
