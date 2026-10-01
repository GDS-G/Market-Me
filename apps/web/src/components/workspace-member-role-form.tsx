"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ManagedWorkspaceMember } from "@market-me/database";
import { clearMemberRoleAttempt, makeMemberRoleAttempt, MEMBER_ROLE_CHOICES, MEMBER_ROLE_DESCRIPTIONS, memberRoleStorageKey,
  normalizeMemberRoleReason, persistMemberRoleAttempt, restoreMemberRoleAttempt, runMemberRoleAttempt,
  type MemberRole, type MemberRoleAttempt, type MemberRoleReceipt, type MemberRoleScope } from "./workspace-member-role-contract";
import styles from "./workspace-management.module.css";

export type MemberRoleFormProps = MemberRoleScope & { members: readonly ManagedWorkspaceMember[] };
const subscribe = () => () => {}, browser = () => true, server = () => false;
export function WorkspaceMemberRoleForm(props: MemberRoleFormProps) {
  const revisionKey = props.members.map(m => `${m.userId}:${m.revision}:${m.canChangeRole}`).join("|");
  return useSyncExternalStore(subscribe, browser, server)
    ? <MemberRoleEditor key={`${memberRoleStorageKey(props)}:${revisionKey}`} {...props} />
    : <p role="status">Loading saved member-role requests…</p>;
}
function MemberRoleEditor(props: MemberRoleFormProps) {
  const storageKey = memberRoleStorageKey(props);
  const [restored] = useState(() => {
    let raw: string | null | undefined;
    try { raw = sessionStorage.getItem(storageKey); return { raw, attempt: restoreMemberRoleAttempt(raw, props), error: "" }; }
    catch { return { raw, attempt: undefined, error: "Recovery data cannot be read safely. An earlier role change may have succeeded. Reload or restore browser storage before proceeding." }; }
  });
  const [attempt, setAttempt] = useState<MemberRoleAttempt | undefined>(restored.attempt);
  const [storageError, setStorageError] = useState(restored.error);
  const [targetId, setTargetId] = useState(restored.attempt?.request.targetUserId ?? "");
  const [newRole, setNewRole] = useState<MemberRole>(restored.attempt?.request.newRole ?? "viewer");
  const [reason, setReason] = useState(restored.attempt?.request.reason ?? "");
  const [acknowledged, setAcknowledged] = useState(false), [clearAcknowledged, setClearAcknowledged] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<MemberRoleReceipt | undefined>();
  const inFlight = useRef(false), mounted = useRef(true), retained = useRef(restored.raw);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selected = props.members.find(m => m.userId === targetId && m.canChangeRole && m.role !== "owner" && m.userId !== props.userId);
  const editable = props.members.filter(m => m.canChangeRole && m.role !== "owner" && m.userId !== props.userId);
  const frozen = pending || Boolean(attempt) || Boolean(storageError);

  async function run(lookup = false) {
    if (inFlight.current || storageError) return;
    if (!attempt && (lookup || !acknowledged || !selected || selected.role === newRole)) return;
    inFlight.current = true; setPending(true); setError(""); setResult(undefined);
    try {
      const exact = attempt ?? makeMemberRoleAttempt(props, selected!.role as MemberRole, { workspaceId: props.workspaceId,
        targetUserId: selected!.userId, requestId: crypto.randomUUID(), expectedRevision: selected!.revision,
        newRole, reason: normalizeMemberRoleReason(reason) });
      try {
        persistMemberRoleAttempt(sessionStorage, props, exact);
        retained.current = JSON.stringify(exact); setAttempt(exact); setReason(exact.request.reason);
      } catch {
        setStorageError("Recovery storage could not retain this role change safely. Nothing was sent by this action. Reload to recover any earlier request, or restore browser storage."); return;
      }
      const saved = await runMemberRoleAttempt(sessionStorage, props, exact, lookup);
      if (mounted.current) setResult(saved);
    } catch (failure) {
      if (mounted.current) setError(attempt || retained.current
        ? `${failure instanceof Error && failure.message.length < 1_200 ? failure.message : "No confirmed result was received."} Your exact request is retained. Check its result or retry that same request.`
        : "Review the member, role and brief one-line reason. No request was sent.");
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }
  function reset() {
    if (!clearAcknowledged || inFlight.current) return;
    try {
      clearMemberRoleAttempt(sessionStorage, props, retained.current);
      inFlight.current = true; setPending(true); window.location.reload();
    } catch { setStorageError("The saved role change could not be cleared safely. Reload before trying again; no new request was sent."); }
  }
  return <div className={styles.editor}>
    {(attempt || storageError) && <section className={styles.notice} aria-label="Saved member-role request">
      <h3>Saved member-role request</h3>
      {attempt ? <><p>Member: {attempt.request.targetUserId}</p><p>{attempt.previousRole} → {attempt.request.newRole} · expected role revision {attempt.request.expectedRevision}</p>
        <p>Reason: {attempt.request.reason}</p><p>Request: {attempt.request.requestId}</p></> : <p>Unreadable recovery data</p>}
      <p>Editing is locked while this request is retained. A missing result does not prove it failed. Checking is read-only; retrying reuses the exact original request.</p>
      <div className={styles.actions}>
        <button type="button" disabled={pending || Boolean(storageError) || !attempt} onClick={() => void run(true)}>Check saved role result</button>
        <button type="button" disabled={pending || Boolean(storageError) || !attempt} onClick={() => void run()}>Retry same role request</button>
      </div>
      <label className={styles.consent}><input type="checkbox" disabled={pending} checked={clearAcknowledged} onChange={event => setClearAcknowledged(event.target.checked)} />
        <span>I checked the original outcome and understand that clearing local recovery does not undo a role change.</span></label>
      <button type="button" disabled={pending || !clearAcknowledged} onClick={reset}>Clear local role request and reload team</button>
    </section>}
    {!attempt && !storageError && <form onSubmit={event => { event.preventDefault(); void run(); }}>
      <fieldset className={styles.fieldset} disabled={frozen}>
        <legend><h3>Change an existing member’s role</h3></legend>
        <MemberRoleBoundary />
        <label className="field"><span>Existing member</span><select required value={targetId} onChange={event => { setTargetId(event.target.value); setAcknowledged(false); }}>
          <option value="">Choose a member from this page</option>
          {editable.map(member => <option key={member.userId} value={member.userId}>{member.displayName} · {member.role} · {member.userId}</option>)}
          {attempt && !editable.some(member => member.userId === targetId) && <option value={targetId}>Saved member · {targetId}</option>}
        </select></label>
        {editable.length === 0 && !attempt && <p>No other non-owner members on this page can be changed. Use team pagination for additional members.</p>}
        <label className="field"><span>New workspace role</span><select value={newRole} onChange={event => { setNewRole(event.target.value as MemberRole); setAcknowledged(false); }}>
          {MEMBER_ROLE_CHOICES.map(role => <option key={role} value={role}>{role}</option>)}
        </select><small>{MEMBER_ROLE_DESCRIPTIONS[newRole]}</small></label>
        <label className="field"><span>Reason for this role change</span><input required maxLength={500} autoComplete="off" value={reason}
          onChange={event => { setReason(event.target.value); setAcknowledged(false); }} /><small>One line, 1–500 characters. Retained in the audit and your private receipt. Do not include secrets.</small></label>
        {selected && <div className={styles.boundary}><strong>Review this exact change</strong><p>{selected.displayName} · member {selected.userId}</p>
          <p>Loaded role: {selected.role} · revision {selected.revision}. Proposed role: {newRole}.</p>
          {selected.role === newRole && <p>Choose a different role before confirming.</p>}</div>}
        <label className={styles.consent}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={!selected || selected.role === newRole} />
          <span>I reviewed this member and authorize this workspace role change.</span></label>
        <button type="submit" className="button-primary" disabled={!acknowledged || !selected || selected.role === newRole}>Confirm member role change</button>
      </fieldset>
    </form>}
    {storageError && <p role="alert" className="form-error">{storageError}</p>}{error && <p role="alert" className="form-error">{error}</p>}
    {pending && <p role="status">Checking your exact member-role request…</p>}
    {result && <section className={styles.result} role="status"><h3>Confirmed original role change</h3>
      <p>Member {result.targetUserId}: {result.previousRole} → {result.newRole} · role revision {result.revision}.</p>
      <p>Reason: {result.reason}</p><p>This is the original outcome, not a statement about current access. The loaded member list may now be stale.</p>
      <a href="/team" className="button-secondary">Reload current team</a>
    </section>}
    <p className={styles.help}>One exact role-change request is retained for this account and workspace in this browser tab. Closing the tab may lose this local copy. Server receipts remain until workspace erasure or a restore predating the request. No credentials are stored.</p>
  </div>;
}
export function MemberRoleBoundary() {
  return <p className={styles.boundary}>Only another existing non-owner member can be changed. Your own role, owner roles, organization roles and membership creation/removal are excluded. Permissions are checked again when saving. Changes affect new authorization checks; they do not undo already completed or admitted work.</p>;
}
