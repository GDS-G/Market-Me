"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createAccountProfileGate, makeAccountProfileIntent, runAccountProfileIntent,
  type AccountProfileIntent, type AccountProfileResult, type AccountProfileView } from "./account-profile-contract";
import styles from "./workspace-management.module.css";
import profileStyles from "./account-profile-form.module.css";

export function AccountProfileForm({ profile }: { profile: AccountProfileView }) {
  return <AccountProfileEditor key={profile.accountId} profile={profile} />;
}
function AccountProfileEditor({ profile }: { profile: AccountProfileView }) {
  const router = useRouter(), [name, setName] = useState(profile.displayName);
  const [intent, setIntent] = useState<AccountProfileIntent>(), [result, setResult] = useState<AccountProfileResult>();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [gate] = useState(createAccountProfileGate), mounted = useRef(true), retained = useRef<AccountProfileIntent | undefined>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gate.cancel(); }; }, [gate]);

  async function run(lookup: boolean) {
    // Even a second submit before React rerenders cannot send a second intent.
    if (!lookup && retained.current) return;
    const operation = gate.begin(); if (!operation) return;
    setPending(true); setError("");
    try {
      const exact = retained.current ?? (lookup ? undefined : makeAccountProfileIntent(profile, name, crypto.randomUUID()));
      if (!exact || exact.accountId !== profile.accountId) throw new Error("Reload your current account settings.");
      retained.current = exact; setIntent(exact); setName(exact.displayName);
      const receipt = await runAccountProfileIntent(exact, lookup, operation.signal);
      if (mounted.current && operation.current()) { setResult(receipt); router.refresh(); }
    } catch (failure) {
      if (mounted.current) setError(operation.signal.aborted
        ? "The request was interrupted or timed out. It may still have saved; check the original result without resending."
        : retained.current ? failure instanceof Error && failure.message.length < 500 ? failure.message : "No confirmed result was received. Check the original request."
        : "Use a plain display name of 1–120 characters. No request was sent.");
    } finally { operation.finish(); if (mounted.current) setPending(false); }
  }
  return <div className={`${styles.editor} ${profileStyles.profile}`}>
    <form aria-label="Edit your display name" onSubmit={event => { event.preventDefault(); void run(false); }}>
      <fieldset className={styles.fieldset} disabled={pending || Boolean(intent)}>
        <legend><h3>Your Market Me display name</h3></legend>
        <p>This label is shared across your Market Me workspaces. It does not change your email, sign-in provider profile, password or permissions. Display names are not unique proof of identity.</p>
        <p>Loaded profile revision: {profile.revision}.</p>
        <label className="field"><span>Display name</span><input required maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
          <small>1–120 characters. Leading, trailing and repeated spaces are normalized.</small></label>
        <button type="submit" className="button-primary">Save display name</button>
      </fieldset>
    </form>
    {intent && <section className={styles.notice} aria-label="Original profile request">
      <h3>Original display-name request</h3><p>“{intent.displayName}” · request {intent.requestId} · loaded revision {intent.expectedRevision}.</p>
      <p>Editing stays locked for this request. A missing result does not prove failure. Checking is read-only and never resends the save.</p>
      <div className={styles.actions}><button type="button" disabled={pending} onClick={() => void run(true)}>Check original result</button></div>
      <p>The request is retained only while this form is open. Reloading or leaving loses this local copy; the server receipt remains. Review the current saved name before starting another request.</p>
      <a className="button-secondary" href="/settings">Reload current settings</a>
    </section>}
    {pending && <p role="status">Checking your display-name request…</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {result && <section className={styles.result} role="status"><h3>Confirmed original result</h3>
      <p>{result.changed ? "Saved" : "Already saved"} “{result.displayName}” · profile revision {result.revision}.</p>
      <p>This receipt describes that request’s original outcome. A later edit may have changed your current name. Reload current settings before editing again.</p>
    </section>}
  </div>;
}
