"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createAccountSessionGate, makeAccountSessionIntent, runAccountSessionIntent,
  type AccountSessionIntent, type AccountSessionItem, type AccountSessionList, type AccountSessionResult } from "./account-session-contract";
import styles from "./account-sessions-panel.module.css";

function SessionTimes({ item }: { item: AccountSessionItem }) {
  return <dl className={styles.times}><dt>Created (UTC)</dt><dd><time dateTime={item.createdAt}>{item.createdAt}</time></dd>
    <dt>Last server request (UTC)</dt><dd><time dateTime={item.lastSeenAt}>{item.lastSeenAt}</time></dd>
    <dt>Expires (UTC)</dt><dd><time dateTime={item.expiresAt}>{item.expiresAt}</time></dd></dl>;
}
export function AccountSessionsPanel({ snapshot }: { snapshot: AccountSessionList }) {
  return <SessionEditor key={JSON.stringify([snapshot.accountId, snapshot.current.sessionId])} snapshot={snapshot} />;
}
function SessionEditor({ snapshot }: { snapshot: AccountSessionList }) {
  const router = useRouter(), [selected, setSelected] = useState<AccountSessionItem>(), [confirmed, setConfirmed] = useState(false);
  const [intent, setIntent] = useState<AccountSessionIntent>(), [result, setResult] = useState<AccountSessionResult>();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [gate] = useState(createAccountSessionGate), retained = useRef<AccountSessionIntent | undefined>(undefined), mounted = useRef(true);
  const reviewHeading = useRef<HTMLHeadingElement>(null), selectionTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gate.cancel(); }; }, [gate]);
  // A long session page must not leave the user thousands of pixels away from the review they opened.
  useEffect(() => { if (selected && !intent) reviewHeading.current?.focus(); }, [selected, intent]);
  async function run(lookup: boolean) {
    if (!lookup && (retained.current || !confirmed || !selected)) return;
    const operation = gate.begin(); if (!operation) return;
    setPending(true); setError("");
    try {
      const exact = retained.current ?? (!lookup && selected ? makeAccountSessionIntent(snapshot, selected.sessionId, crypto.randomUUID()) : undefined);
      if (!exact || exact.accountId !== snapshot.accountId || exact.targetSessionId === snapshot.current.sessionId) throw new Error("Reload your own current sessions.");
      retained.current = exact; setIntent(exact);
      const receipt = await runAccountSessionIntent(exact, lookup, operation.signal);
      if (mounted.current && operation.current()) { setResult(receipt); router.refresh(); }
    } catch (failure) {
      if (mounted.current) setError(operation.signal.aborted ? "The request was interrupted or timed out. It may still have signed out the selected session; check the original result without resending."
        : retained.current && failure instanceof Error && failure.message.length < 500 ? failure.message : "Review a current selected session before sending a request.");
    } finally { operation.finish(); if (mounted.current) setPending(false); }
  }
  return <div className={styles.panel}>
    <p>These are Market Me sign-in sessions, not connected-provider or companion credentials. No device, browser, IP address or location is recorded here. Last server request is not proof of human activity.</p>
    <article className={styles.card} aria-label="Current sign-in session"><h3>This current session</h3><p>Session {snapshot.current.sessionId}</p><SessionTimes item={snapshot.current} /><p>Use Sign out in the workspace menu to end this session.</p></article>
    <p>{snapshot.totalOthers} other active sessions · showing {snapshot.others.length} on this page. Newest created first. Observed <time dateTime={snapshot.observedAt}>{snapshot.observedAt}</time>. This is a live list, not a frozen history.</p>
    {snapshot.others.length ? <ul className={styles.sessions} aria-label="Other active sessions">{snapshot.others.map(item => <li className={styles.card} key={item.sessionId}>
      <h3>Other session</h3><p>Session {item.sessionId}</p><SessionTimes item={item} />
      <button type="button" disabled={pending || Boolean(intent)} onClick={event => { selectionTrigger.current = event.currentTarget; setSelected(item); setConfirmed(false); setError(""); }}>Review sign out · {item.sessionId}</button>
    </li>)}</ul> : <p>No other active sessions appear on this page.</p>}
    <nav className={styles.actions} aria-label="Session list pages"><a href="/settings">Reload newest sessions</a>
      {snapshot.nextCursor && <a href={`/settings?${new URLSearchParams({ sessionCursor: snapshot.nextCursor })}`}>Older sessions</a>}
    </nav>
    <p>Reloading, paging or leaving loses any locally retained request. Review its original result before leaving if you need that receipt.</p>
    {selected && !intent && <form aria-label="Confirm selected session sign out" className={styles.notice} onSubmit={event => { event.preventDefault(); void run(false); }}>
      <h3 ref={reviewHeading} tabIndex={-1}>Review this one session</h3><p>Selected session {selected.sessionId}</p><SessionTimes item={selected} />
      <p>Signing it out blocks later Market Me requests from that session after the change commits. Already-authorized work may finish. It does not sign out of your identity provider, disconnect providers or disable companion credentials.</p>
      <label className={styles.confirmation}><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />
        <span>Sign out only selected session {selected.sessionId}.</span></label>
      <div className={styles.actions}><button type="submit" disabled={!confirmed || pending}>Sign out selected session</button><button type="button" disabled={pending} onClick={() => { setSelected(undefined); setConfirmed(false); selectionTrigger.current?.focus(); }}>Cancel selection</button></div>
    </form>}
    {intent && <section className={styles.notice} aria-label="Original session request"><h3>Original session sign-out request</h3>
      <p>Selected session {intent.targetSessionId} · request {intent.requestId}.</p><p>Selection stays locked. An absent result does not prove failure; checking is read-only and never sends another sign-out request.</p>
      <button type="button" disabled={pending} onClick={() => void run(true)}>Check original sign-out result</button>
      <p>The exact request is retained only while this panel stays open. Server receipts remain, but reloading loses this local key.</p>
    </section>}
    {pending && <p role="status">Checking your selected session request…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {result && <section className={styles.notice} role="status"><h3>Confirmed original sign-out</h3>
      <p>Session {result.targetSessionId} was signed out at <time dateTime={result.revokedAt}>{result.revokedAt}</time>.</p>
      <p>This is that request’s historical outcome, not a claim about later sign-ins. Reload newest sessions before another action.</p>
    </section>}
  </div>;
}
