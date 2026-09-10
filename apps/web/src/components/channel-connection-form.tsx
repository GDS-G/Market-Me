"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ChannelConnectionForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<"discord_webhook" | "mailchimp_email" | "slack_webhook" | "mastodon_account">("discord_webhook");
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [instanceOrigin, setInstanceOrigin] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const providerFields = provider === "mailchimp_email"
      ? { apiKey, audienceId, fromName, replyTo }
      : provider === "mastodon_account"
        ? { instanceOrigin, accessToken }
        : { webhookUrl };
    const response = await fetch("/api/v1/channel-connections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, provider, name, ...providerFields }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) return setError(payload?.error?.message ?? "Could not save the channel connection.");
    setName("");
    setWebhookUrl("");
    setApiKey("");
    setAudienceId("");
    setFromName("");
    setReplyTo("");
    setInstanceOrigin("");
    setAccessToken("");
    router.refresh();
  }

  return (
    <form className="form-subsection" onSubmit={submit}>
      <h3>Add an owned channel</h3>
      <p>Credentials are tested, encrypted, and never returned. Mastodon testing is read-only; saving Slack posts one visible connection-test marker; Mailchimp sends only to its provider-managed audience.</p>
      <label className="field"><span>Provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="discord_webhook">Discord incoming webhook</option><option value="slack_webhook">Slack incoming webhook</option><option value="mastodon_account">Mastodon account</option><option value="mailchimp_email">Mailchimp email audience</option></select></label>
      <label className="field"><span>Connection name</span><input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder={provider === "mailchimp_email" ? "Customer newsletter" : provider === "mastodon_account" ? "Brand social account" : "Community announcements"} /></label>
      {provider === "mailchimp_email" ? (
        <>
          <label className="field"><span>Mailchimp API key</span><input required type="password" autoComplete="off" maxLength={200} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Key ending in -us21" /></label>
          <label className="field"><span>Audience ID</span><input required maxLength={64} value={audienceId} onChange={(event) => setAudienceId(event.target.value)} /></label>
          <label className="field"><span>Sender name</span><input required maxLength={100} value={fromName} onChange={(event) => setFromName(event.target.value)} /></label>
          <label className="field"><span>Reply-to email</span><input required type="email" maxLength={320} value={replyTo} onChange={(event) => setReplyTo(event.target.value)} /></label>
        </>
      ) : provider === "mastodon_account" ? (
        <>
          <label className="field"><span>Mastodon instance origin</span><input required type="url" maxLength={500} value={instanceOrigin} onChange={(event) => setInstanceOrigin(event.target.value)} placeholder="https://social.example.com" /></label>
          <label className="field"><span>User access token</span><input required type="password" autoComplete="off" maxLength={500} value={accessToken} onChange={(event) => setAccessToken(event.target.value)} /></label>
          <p>The instance host must be approved by the deployment. Public statuses can include exact reviewed JPEG, PNG, or WebP attachments when the instance advertises support.</p>
        </>
      ) : (
        <label className="field"><span>{provider === "slack_webhook" ? "Slack" : "Discord"} incoming webhook URL</span><input required type="password" autoComplete="off" maxLength={500} value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder={provider === "slack_webhook" ? "https://hooks.slack.com/services/..." : "https://discord.com/api/webhooks/..."} /></label>
      )}
      <button className="button-primary" disabled={pending}>{pending ? "Testing..." : provider === "slack_webhook" ? "Post test marker and save" : provider === "mastodon_account" ? "Verify account and save" : "Test and save"}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
