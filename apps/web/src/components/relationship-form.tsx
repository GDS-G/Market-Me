"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StoredRelationship } from "@market-me/database";
import { RELATIONSHIP_STAGES } from "@market-me/domain";

type IdentityDraft = {
  provider: string;
  providerSubjectId: string;
  displayHandle: string;
  profileUrl: string;
  status: "reported" | "verified";
  confidence: string;
};

const emptyIdentity = (): IdentityDraft => ({
  provider: "",
  providerSubjectId: "",
  displayHandle: "",
  profileUrl: "",
  status: "reported",
  confidence: "",
});

export function RelationshipForm({
  workspaceId,
  currentUserId,
  currentUserName,
  relationship,
}: {
  workspaceId: string;
  currentUserId: string;
  currentUserName: string;
  relationship?: StoredRelationship;
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    displayName: relationship?.displayName ?? "",
    organizationName: relationship?.organizationName ?? "",
    stage: relationship?.stage ?? "unknown",
    contactPermission: relationship?.contactPermission ?? "allowed",
    assignedOwnerId: relationship?.assignedOwnerId ?? "",
    observedInterests: relationship?.observedInterests.join(", ") ?? "",
    sharedTopics: relationship?.sharedTopics.join(", ") ?? "",
    preferredTone: relationship?.preferredTone ?? "",
    notes: relationship?.notes ?? "",
    suppressionReason: relationship?.suppressionReason ?? "",
  });
  const [identities, setIdentities] = useState<IdentityDraft[]>(
    relationship?.identities.map((identity) => ({
      provider: identity.provider,
      providerSubjectId: identity.providerSubjectId,
      displayHandle: identity.displayHandle ?? "",
      profileUrl: identity.profileUrl ?? "",
      status: identity.status,
      confidence:
        identity.confidence === undefined ? "" : String(identity.confidence),
    })) ?? [],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const setIdentity = (
    index: number,
    key: keyof IdentityDraft,
    value: string,
  ) =>
    setIdentities((current) =>
      current.map((identity, identityIndex) =>
        identityIndex === index ? { ...identity, [key]: value } : identity,
      ),
    );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const body = {
      workspaceId,
      displayName: values.displayName,
      organizationName: optional(values.organizationName),
      stage: values.stage,
      contactPermission: values.contactPermission,
      assignedOwnerId: optional(values.assignedOwnerId),
      observedInterests: split(values.observedInterests),
      sharedTopics: split(values.sharedTopics),
      preferredTone: optional(values.preferredTone),
      notes: values.notes,
      suppressionReason:
        values.contactPermission === "suppressed"
          ? optional(values.suppressionReason)
          : undefined,
      identities: identities.map((identity) => ({
        provider: identity.provider,
        providerSubjectId: identity.providerSubjectId,
        displayHandle: optional(identity.displayHandle),
        profileUrl: optional(identity.profileUrl),
        status: identity.status,
        confidence:
          identity.confidence === "" ? undefined : Number(identity.confidence),
      })),
    };
    const response = await fetch(
      relationship
        ? `/api/v1/relationships/${relationship.id}`
        : "/api/v1/relationships",
      {
        method: relationship ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Could not save the relationship.");
      return;
    }
    router.push("/conversations");
    router.refresh();
  }

  return (
    <form className="resource-form" onSubmit={submit}>
      <section className="form-section">
        <div>
          <h2>Relationship record</h2>
          <p>
            Keep business context separate from contact permission and provider
            identity.
          </p>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Display name</span>
            <input
              required
              value={values.displayName}
              onChange={(event) => set("displayName", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Organization</span>
            <input
              value={values.organizationName}
              onChange={(event) => set("organizationName", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Relationship stage</span>
            <select
              value={values.stage}
              onChange={(event) => set("stage", event.target.value)}
            >
              {RELATIONSHIP_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {label(stage)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Owner</span>
            <select
              value={values.assignedOwnerId}
              onChange={(event) => set("assignedOwnerId", event.target.value)}
            >
              <option value="">Unassigned</option>
              <option value={currentUserId}>{currentUserName} (me)</option>
            </select>
          </label>
          <label className="field">
            <span>Observed interests, comma separated</span>
            <input
              value={values.observedInterests}
              onChange={(event) => set("observedInterests", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Shared topics, comma separated</span>
            <input
              value={values.sharedTopics}
              onChange={(event) => set("sharedTopics", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Preferred tone</span>
            <input
              value={values.preferredTone}
              onChange={(event) => set("preferredTone", event.target.value)}
            />
          </label>
          <label className="field field-wide">
            <span>Internal notes</span>
            <textarea
              value={values.notes}
              onChange={(event) => set("notes", event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="form-section">
        <div>
          <h2>Contact safety</h2>
          <p>
            Suppression is independent of relationship stage and always wins
            over outreach intent.
          </p>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>Contact permission</span>
            <select
              value={values.contactPermission}
              onChange={(event) => set("contactPermission", event.target.value)}
            >
              <option value="allowed">Allowed</option>
              <option value="suppressed">Do not contact</option>
            </select>
          </label>
          {values.contactPermission === "suppressed" && (
            <label className="field field-wide">
              <span>Suppression reason</span>
              <textarea
                required
                value={values.suppressionReason}
                onChange={(event) =>
                  set("suppressionReason", event.target.value)
                }
                placeholder="Opt-out, legal restriction, user request, or another reviewed reason"
              />
            </label>
          )}
        </div>
      </section>

      <section className="form-section">
        <div>
          <h2>Provider identities</h2>
          <p>
            Keep identities separate unless the provider and subject are exact
            or explicitly verified.
          </p>
          <button
            className="button-secondary"
            disabled={identities.length >= 20}
            onClick={() =>
              setIdentities((current) => [...current, emptyIdentity()])
            }
            type="button"
          >
            Add identity
          </button>
        </div>
        <div className="field-grid">
          {identities.length === 0 && (
            <p className="form-help">
              No provider identity recorded. The relationship remains
              workspace-local.
            </p>
          )}
          {identities.map((identity, index) => (
            <div
              className="form-subsection field-wide"
              key={`${index}-${identity.provider}`}
            >
              <div className="field-grid">
                <label className="field">
                  <span>Provider</span>
                  <input
                    required
                    value={identity.provider}
                    onChange={(event) =>
                      setIdentity(index, "provider", event.target.value)
                    }
                    placeholder="email, discord, linkedin"
                  />
                </label>
                <label className="field">
                  <span>Provider subject ID</span>
                  <input
                    required
                    value={identity.providerSubjectId}
                    onChange={(event) =>
                      setIdentity(
                        index,
                        "providerSubjectId",
                        event.target.value,
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span>Display handle</span>
                  <input
                    value={identity.displayHandle}
                    onChange={(event) =>
                      setIdentity(index, "displayHandle", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>Identity status</span>
                  <select
                    value={identity.status}
                    onChange={(event) =>
                      setIdentity(index, "status", event.target.value)
                    }
                  >
                    <option value="reported">Reported</option>
                    <option value="verified">Verified</option>
                  </select>
                </label>
                <label className="field field-wide">
                  <span>HTTPS profile URL</span>
                  <input
                    type="url"
                    value={identity.profileUrl}
                    onChange={(event) =>
                      setIdentity(index, "profileUrl", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>Link confidence (0–1)</span>
                  <input
                    max="1"
                    min="0"
                    step="0.001"
                    type="number"
                    value={identity.confidence}
                    onChange={(event) =>
                      setIdentity(index, "confidence", event.target.value)
                    }
                  />
                </label>
                <button
                  className="button-secondary"
                  onClick={() =>
                    setIdentities((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="button"
                >
                  Remove identity
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="form-actions">
        <button className="button-primary" disabled={pending}>
          {pending ? "Saving…" : "Save relationship"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function split(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}
