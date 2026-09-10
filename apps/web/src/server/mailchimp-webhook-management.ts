import { isExactMailchimpCampaignWebhook, type MailchimpAudienceWebhook } from "@market-me/connectors";

export type MailchimpWebhookHealth =
  | "managed_active"
  | "managed_missing"
  | "managed_drifted"
  | "managed_secret_missing"
  | "manual_unverified"
  | "unmanaged_provider_webhook"
  | "disabled";

export interface MailchimpWebhookHealthResult {
  health: MailchimpWebhookHealth;
  matchingCallbackCount: number;
  providerWebhookPresent: boolean;
}

export function assessMailchimpWebhookHealth(input: {
  webhooks: readonly MailchimpAudienceWebhook[];
  callbackUrl: string;
  management?: string;
  providerWebhookId?: string;
  signingConfigured: boolean;
}): MailchimpWebhookHealthResult {
  const matching = input.webhooks.filter((webhook) => webhook.callbackUrl === input.callbackUrl);
  const providerWebhook = input.providerWebhookId
    ? input.webhooks.find((webhook) => webhook.webhookId === input.providerWebhookId)
    : undefined;
  if (input.management === "managed" && input.providerWebhookId) {
    if (!providerWebhook) return result("managed_missing", matching.length, false);
    if (providerWebhook.callbackUrl !== input.callbackUrl || !isExactMailchimpCampaignWebhook(providerWebhook)) {
      return result("managed_drifted", matching.length, true);
    }
    if (!input.signingConfigured) return result("managed_secret_missing", matching.length, true);
    return result("managed_active", matching.length, true);
  }
  if (input.signingConfigured) return result("manual_unverified", matching.length, matching.length > 0);
  if (matching.length > 0) return result("unmanaged_provider_webhook", matching.length, false);
  return result("disabled", 0, false);
}

export function webhooksEligibleForReplacement(input: {
  webhooks: readonly MailchimpAudienceWebhook[];
  callbackUrl: string;
  providerWebhookId?: string;
}): readonly MailchimpAudienceWebhook[] {
  const selected = input.webhooks.filter((webhook) =>
    webhook.callbackUrl === input.callbackUrl || webhook.webhookId === input.providerWebhookId,
  );
  return [...new Map(selected.map((webhook) => [webhook.webhookId, webhook])).values()];
}

function result(health: MailchimpWebhookHealth, matchingCallbackCount: number, providerWebhookPresent: boolean): MailchimpWebhookHealthResult {
  return { health, matchingCallbackCount, providerWebhookPresent };
}
