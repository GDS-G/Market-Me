/** Shared structural admission rule; not authorization or a capability check. */
export function preferredWindowRouteIssue(input: {
  operationType: string;
  executionMethods: readonly string[];
  provider?: string;
  attachmentCount: number;
}): string | undefined {
  if (input.operationType !== "publish_content"
    || input.executionMethods.length !== 1 || input.executionMethods[0] !== "official_api"
    || !["discord_webhook", "slack_webhook", "mastodon_account"].includes(input.provider ?? "")
    || input.attachmentCount !== 0) {
    return "Preferred windows require one official-API text publication through Discord, Slack, or Mastodon, without attachments or fallback methods.";
  }
  return undefined;
}
