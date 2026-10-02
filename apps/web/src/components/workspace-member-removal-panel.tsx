"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createMemberRemovalGate, loadMemberRemovalPreview, makeMemberRemovalAttempt, runMemberRemovalAttempt,
  MEMBER_REMOVAL_BROWSER_LIMITS, MEMBER_REMOVAL_IMPACT_LABELS,
  type MemberRemovalAttempt, type MemberRemovalPreview, type MemberRemovalReceipt, type MemberRemovalScope } from "./workspace-member-removal-contract";
import styles from "./workspace-member-removal-panel.module.css";

type SelectableMember = { userId: string; displayName: string; role: string; canChangeRole: boolean };
type Props = MemberRemovalScope & { members: readonly SelectableMember[] };
export function WorkspaceMemberRemovalPanel(props: Props) {
  return <RemovalEditor key={JSON.stringify([props.userId, props.workspaceId])} {...props} />;
}
function RemovalEditor({ userId, workspaceId, members }: Props) {
  const scope = { userId, workspaceId }, router = useRouter();
  const [preview, setPreview] = useState<MemberRemovalPreview>(), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState<MemberRemovalAttempt>(), [result, setResult] = useState<MemberRemovalReceipt>();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [gate] = useState(createMemberRemovalGate), mounted = useRef(true), retained = useRef<MemberRemovalAttempt | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gate.cancel(); }; }, [gate]);
  useEffect(() => { if (preview && !attempt) heading.current?.focus(); }, [preview, attempt]);
  async function review(target: string) {
    if (retained.current) return;
    const operation = gate.begin(); if (!operation) return;
    setPending(true); setError(""); setPreview(undefined); setReason(""); setConfirmed(false);
    try {
      const next = await loadMemberRemovalPreview(scope, target, operation.signal);
      if (mounted.current && operation.current()) setPreview(next);
    } catch { if (mounted.current) setError("The current member preview could not be loaded. No removal request was sent; reload Team or try reviewing again."); }
    finally { operation.finish(); if (mounted.current) setPending(false); }
  }
  async function run(lookup: boolean) {
    if (!lookup && (retained.current || !confirmed || !preview || preview.blocked)) return;
    const operation = gate.begin(); if (!operation) return;
    setPending(true); setError("");
    try {
      const exact = retained.current ?? (!lookup && preview ? makeMemberRemovalAttempt(scope, preview, crypto.randomUUID(), reason) : undefined);
      if (!exact) throw new Error("Review a current member before removing access.");
      retained.current = exact; setAttempt(exact);
      const receipt = await runMemberRemovalAttempt(exact, scope, lookup, operation.signal);
      if (mounted.current && operation.current()) { setResult(receipt); router.refresh(); }
    } catch (failure) {
      if (mounted.current) setError(operation.signal.aborted ? "The request was interrupted or timed out. Access may already have been removed; check the original result without resending."
        : failure instanceof Error && failure.message.length < 500 ? failure.message : "No confirmed result was received. Check any original request before another action.");
    } finally { operation.finish(); if (mounted.current) setPending(false); }
  }
  const eligible = members.filter(member => member.canChangeRole && member.userId !== userId && member.role !== "owner");
  return <div className={styles.panel}>
    <p>Remove one collaborator&apos;s access to this workspace. Accounts, personal sign-in sessions, other workspaces and historical attribution remain. Your own access and every owner are protected.</p>
    {eligible.length ? <ul className={styles.members} aria-label="Members eligible for access review">{eligible.map(member => <li className={styles.card} key={member.userId}>
      <div><h3>{member.displayName}</h3><p>{member.role} · member {member.userId}</p></div>
      <button type="button" disabled={pending || Boolean(attempt)} onClick={event => { trigger.current = event.currentTarget; void review(member.userId); }}>Review access removal · {member.displayName}</button>
    </li>)}</ul> : <p>No removable collaborators are shown on this member page.</p>}
    {preview && !attempt && <form className={styles.notice} aria-label="Confirm workspace member removal" onSubmit={event => { event.preventDefault(); void run(false); }}>
      <h3 ref={heading} tabIndex={-1}>Review removal of {preview.target.displayName}</h3>
      <p>Member {preview.target.userId} · role {preview.target.role} · grant {preview.target.incarnationId} · revision {preview.target.revision}.</p>
      <p>Observed <time dateTime={preview.observedAt}>{preview.observedAt}</time> (UTC). These counts are rechecked before removal; they are not a freeze on other work.</p>
      <dl className={styles.impact}>{Object.entries(MEMBER_REMOVAL_IMPACT_LABELS).map(([key, label]) => <div key={key}>
        <dt>{label}</dt><dd>{preview.impact[key as keyof typeof MEMBER_REMOVAL_IMPACT_LABELS]}</dd></div>)}</dl>
      <p>Assignments, routing rules, source bindings, campaigns, destinations and prepared AI records are retained, not automatically cancelled, reassigned or transferred. Resolve operational responsibilities in their existing controls. New actions must pass current authorization; already-admitted work and externally delivered content may remain.</p>
      {preview.blocked && <p role="alert">Removal is blocked by pending incoming or issued invitations. <a href={`/team?${new URLSearchParams({ invitationMember: preview.target.userId })}#identity-invitations`}>Review this member&apos;s pending invitations</a>, then load a new removal review. An old invitation must not silently restore removed access.</p>}
      {preview.target.revision >= MEMBER_REMOVAL_BROWSER_LIMITS.revision && <p role="alert">This membership&apos;s revision limit is exhausted. No removal can be submitted.</p>}
      <label className={styles.reason}>Reason for this access change<input value={reason} maxLength={MEMBER_REMOVAL_BROWSER_LIMITS.reason} required autoComplete="off"
        disabled={pending || preview.blocked} onChange={event => setReason(event.target.value)} aria-describedby="member-removal-reason-help" /></label>
      <p id="member-removal-reason-help">1–500 characters. The reason is retained in the workspace audit; do not include passwords, credentials or unnecessary personal details.</p>
      <label className={styles.confirmation}><input type="checkbox" checked={confirmed} disabled={pending || preview.blocked} onChange={event => setConfirmed(event.target.checked)} />
        <span>I reviewed the retained work and will remove only this grant for {preview.target.displayName} from this workspace.</span></label>
      <div className={styles.actions}><button type="submit" disabled={pending || !confirmed || !reason.trim() || preview.blocked || preview.target.revision >= MEMBER_REMOVAL_BROWSER_LIMITS.revision}>Remove selected workspace access</button>
        <button type="button" disabled={pending} onClick={() => { setPreview(undefined); setConfirmed(false); setReason(""); trigger.current?.focus(); }}>Cancel removal review</button></div>
    </form>}
    {attempt && <section className={styles.notice} aria-label="Original workspace removal request"><h3>Original access-removal request</h3>
      <p>Member {attempt.request.targetUserId} · request {attempt.request.requestId}.</p>
      <p>Selection stays locked. Checking is read-only and never sends another removal. An absent result does not prove that the request failed.</p>
      <button type="button" disabled={pending} onClick={() => void run(true)}>Check original removal result</button>
      <p>The exact request stays only in this open panel&apos;s memory. Reloading, changing workspace, paging or leaving loses this local reference; server receipts remain.</p>
    </section>}
    {pending && <p role="status">Checking the selected workspace member…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {result && <section className={styles.notice} role="status"><h3>Confirmed original access removal</h3>
      <p>Member {result.targetUserId}&apos;s grant {result.expectedIncarnationId} was revoked at <time dateTime={result.revokedAt}>{result.revokedAt}</time> (UTC), revision {result.revision}.</p>
      <p>This is the original historical result. A later authorized invitation may create a new grant; this receipt is not a claim about current membership.</p>
    </section>}
    <a href="/team">Reload current Team</a>
  </div>;
}
