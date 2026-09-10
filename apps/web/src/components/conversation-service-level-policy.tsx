"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredConversationServiceLevelPolicy } from "@market-me/database";

const DAYS = [
  [1, "Sun"],
  [2, "Mon"],
  [4, "Tue"],
  [8, "Wed"],
  [16, "Thu"],
  [32, "Fri"],
  [64, "Sat"],
] as const;

export function ConversationServiceLevelPolicy({
  workspaceId,
  policy,
}: {
  workspaceId: string;
  policy?: StoredConversationServiceLevelPolicy;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    timezone: policy?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    businessDaysMask: policy?.businessDaysMask ?? 62,
    businessStartTime: policy?.businessStartTime ?? "09:00",
    businessEndTime: policy?.businessEndTime ?? "17:00",
    unknownTargetMinutes: String(policy?.unknownTargetMinutes ?? 480),
    lowTargetMinutes: String(policy?.lowTargetMinutes ?? 480),
    normalTargetMinutes: String(policy?.normalTargetMinutes ?? 240),
    highTargetMinutes: String(policy?.highTargetMinutes ?? 60),
    criticalTargetMinutes: String(policy?.criticalTargetMinutes ?? 15),
    atRiskBeforeMinutes: String(policy?.atRiskBeforeMinutes ?? 15),
    escalationAfterMinutes: String(policy?.escalationAfterMinutes ?? 60),
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const set = (key: keyof typeof values, value: string | number) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/v1/conversation-service-level-policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        timezone: values.timezone,
        businessDaysMask: values.businessDaysMask,
        businessStartTime: values.businessStartTime,
        businessEndTime: values.businessEndTime,
        unknownTargetMinutes: Number(values.unknownTargetMinutes),
        lowTargetMinutes: Number(values.lowTargetMinutes),
        normalTargetMinutes: Number(values.normalTargetMinutes),
        highTargetMinutes: Number(values.highTargetMinutes),
        criticalTargetMinutes: Number(values.criticalTargetMinutes),
        atRiskBeforeMinutes: Number(values.atRiskBeforeMinutes),
        escalationAfterMinutes: Number(values.escalationAfterMinutes),
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Could not save the service-level policy.");
      setPending(false);
      return;
    }
    setPending(false);
    router.refresh();
  }

  return (
    <section className="resource-panel service-level-panel">
      <div className="resource-panel-head">
        <div>
          <h2>Response service levels</h2>
          <p>
            Business-hour targets flag active conversations as on track, at
            risk, or overdue. They never send a reminder or change state.
          </p>
        </div>
      </div>
      <form className="routing-rule-form" onSubmit={submit}>
        <label className="field">
          <span>IANA timezone</span>
          <input required value={values.timezone} onChange={(e) => set("timezone", e.target.value)} />
        </label>
        <label className="field">
          <span>Business starts</span>
          <input required type="time" value={values.businessStartTime} onChange={(e) => set("businessStartTime", e.target.value)} />
        </label>
        <label className="field">
          <span>Business ends</span>
          <input required type="time" value={values.businessEndTime} onChange={(e) => set("businessEndTime", e.target.value)} />
        </label>
        <Target label="Unknown urgency target" value={values.unknownTargetMinutes} onChange={(value) => set("unknownTargetMinutes", value)} />
        <Target label="Low urgency target" value={values.lowTargetMinutes} onChange={(value) => set("lowTargetMinutes", value)} />
        <Target label="Normal urgency target" value={values.normalTargetMinutes} onChange={(value) => set("normalTargetMinutes", value)} />
        <Target label="High urgency target" value={values.highTargetMinutes} onChange={(value) => set("highTargetMinutes", value)} />
        <Target label="Critical urgency target" value={values.criticalTargetMinutes} onChange={(value) => set("criticalTargetMinutes", value)} />
        <label className="field">
          <span>At-risk lead time (minutes)</span>
          <input min="0" max="1440" required type="number" value={values.atRiskBeforeMinutes} onChange={(e) => set("atRiskBeforeMinutes", e.target.value)} />
        </label>
        <label className="field">
          <span>Escalate after overdue (minutes)</span>
          <input min="0" max="10080" required type="number" value={values.escalationAfterMinutes} onChange={(e) => set("escalationAfterMinutes", e.target.value)} />
        </label>
        <fieldset className="service-days">
          <legend>Business days</legend>
          {DAYS.map(([bit, day]) => (
            <label key={bit}>
              <input
                checked={(values.businessDaysMask & bit) !== 0}
                type="checkbox"
                onChange={(event) =>
                  set(
                    "businessDaysMask",
                    event.target.checked
                      ? values.businessDaysMask | bit
                      : values.businessDaysMask & ~bit,
                  )
                }
              />
              {day}
            </label>
          ))}
        </fieldset>
        <button className="button-secondary" disabled={pending || values.businessDaysMask === 0}>
          {pending ? "Saving…" : policy ? "Update service levels" : "Enable service levels"}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {policy && (
        <p className="form-note">
          Active · last updated {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(policy.updatedAt))}
        </p>
      )}
    </section>
  );
}

function Target({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label} (business minutes)</span>
      <input min="1" max="10080" required type="number" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
