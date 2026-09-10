"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONVERSATION_INTENTS,
  CONVERSATION_STATUSES,
  CONVERSATION_URGENCIES,
  RELATIONSHIP_STAGES,
} from "@market-me/domain";
import type {
  ConversationBrandOption,
  ConversationChannelOption,
  StoredConversationRoutingRule,
  WorkspaceMember,
} from "@market-me/database";

export function ConversationRoutingRules({
  workspaceId,
  rules,
  brands,
  channels,
  members,
}: {
  workspaceId: string;
  rules: readonly StoredConversationRoutingRule[];
  brands: readonly ConversationBrandOption[];
  channels: readonly ConversationChannelOption[];
  members: readonly WorkspaceMember[];
}) {
  const router = useRouter();
  const [values, setValues] = useState({
    name: "",
    priority: "100",
    brandProfileId: "",
    channelConnectionId: "",
    relationshipStage: "",
    intent: "",
    urgency: "",
    targetStatus: "assigned",
    targetOwnerId: "",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const response = await fetch("/api/v1/conversation-routing-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        name: values.name,
        enabled: true,
        priority: Number(values.priority),
        brandProfileId: values.brandProfileId || undefined,
        channelConnectionId: values.channelConnectionId || undefined,
        relationshipStage: values.relationshipStage || undefined,
        intent: values.intent || undefined,
        urgency: values.urgency || undefined,
        targetStatus: values.targetStatus,
        targetOwnerId:
          values.targetStatus === "assigned"
            ? values.targetOwnerId || undefined
            : undefined,
      }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Could not save the routing rule.");
      setPending(false);
      return;
    }
    setValues((current) => ({
      ...current,
      name: "",
      brandProfileId: "",
      channelConnectionId: "",
      relationshipStage: "",
      intent: "",
      urgency: "",
    }));
    setPending(false);
    router.refresh();
  }

  async function toggle(rule: StoredConversationRoutingRule) {
    setError("");
    const response = await fetch(
      `/api/v1/conversation-routing-rules/${rule.id}/enabled`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, enabled: !rule.enabled }),
      },
    );
    if (!response.ok) {
      setError("Could not update the routing rule.");
      return;
    }
    router.refresh();
  }

  const hasMatcher = Boolean(
    values.brandProfileId ||
    values.channelConnectionId ||
    values.relationshipStage ||
    values.intent ||
    values.urgency,
  );
  const validTarget =
    values.targetStatus !== "assigned" || Boolean(values.targetOwnerId);

  return (
    <section className="resource-panel routing-rules-panel">
      <div className="resource-panel-head">
        <div>
          <h2>Suggested routing rules</h2>
          <p>
            Exact reviewed fields may suggest an owner or status. Suggestions
            never change a thread automatically.
          </p>
        </div>
      </div>
      <form className="routing-rule-form" onSubmit={submit}>
        <label className="field">
          <span>Rule name</span>
          <input
            required
            value={values.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Priority</span>
          <input
            max="1000"
            min="0"
            required
            type="number"
            value={values.priority}
            onChange={(event) => set("priority", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Brand match</span>
          <select
            value={values.brandProfileId}
            onChange={(event) => set("brandProfileId", event.target.value)}
          >
            <option value="">Any brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Account match</span>
          <select
            value={values.channelConnectionId}
            onChange={(event) => set("channelConnectionId", event.target.value)}
          >
            <option value="">Any account</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Relationship stage match</span>
          <select
            value={values.relationshipStage}
            onChange={(event) => set("relationshipStage", event.target.value)}
          >
            <option value="">Any stage</option>
            {RELATIONSHIP_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {label(stage)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Intent match</span>
          <select
            value={values.intent}
            onChange={(event) => set("intent", event.target.value)}
          >
            <option value="">Any intent</option>
            {CONVERSATION_INTENTS.map((intent) => (
              <option key={intent} value={intent}>
                {label(intent)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Urgency match</span>
          <select
            value={values.urgency}
            onChange={(event) => set("urgency", event.target.value)}
          >
            <option value="">Any urgency</option>
            {CONVERSATION_URGENCIES.map((urgency) => (
              <option key={urgency} value={urgency}>
                {label(urgency)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Suggested status</span>
          <select
            value={values.targetStatus}
            onChange={(event) => {
              set("targetStatus", event.target.value);
              if (event.target.value !== "assigned") set("targetOwnerId", "");
            }}
          >
            {CONVERSATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Suggested owner</span>
          <select
            disabled={values.targetStatus !== "assigned"}
            value={values.targetOwnerId}
            onChange={(event) => set("targetOwnerId", event.target.value)}
          >
            <option value="">Choose eligible owner</option>
            {members
              .filter((member) => member.assignableToConversations)
              .map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button-secondary"
          disabled={pending || !hasMatcher || !validTarget}
        >
          {pending ? "Saving…" : "Add routing rule"}
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      <div className="routing-rule-list">
        {rules.map((rule) => (
          <article key={rule.id}>
            <div>
              <strong>{rule.name}</strong>
              <span className="status-pill">
                {rule.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p>
              Priority {rule.priority} · {matcherSummary(rule)} · Suggest{" "}
              {label(rule.targetStatus)}
              {rule.targetOwnerDisplayName
                ? ` to ${rule.targetOwnerDisplayName}`
                : ""}
            </p>
            <button className="button-secondary" onClick={() => toggle(rule)}>
              {rule.enabled ? "Disable" : "Enable"}
            </button>
          </article>
        ))}
        {!rules.length && <p>No routing rules configured.</p>}
      </div>
    </section>
  );
}

function matcherSummary(rule: StoredConversationRoutingRule): string {
  return [
    rule.brandProfileName ? `Brand ${rule.brandProfileName}` : "",
    rule.channelConnectionName ? `Account ${rule.channelConnectionName}` : "",
    rule.relationshipStage ? `Stage ${label(rule.relationshipStage)}` : "",
    rule.intent ? `Intent ${label(rule.intent)}` : "",
    rule.urgency ? `Urgency ${label(rule.urgency)}` : "",
  ]
    .filter(Boolean)
    .join(" + ");
}

function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
