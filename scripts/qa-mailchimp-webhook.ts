import { createHmac } from "node:crypto";
import { parseMailchimpWebhookWakeup } from "../apps/web/src/server/mailchimp-webhook";

const timestamp = Math.floor(Date.now() / 1000);
const secret = "qa-mailchimp-signing-secret";
const rawBody = new TextEncoder().encode("type=campaign&fired_at=2026-08-12+08%3A00%3A00&data%5Bid%5D=campaign_qa&data%5Blist_id%5D=audience_qa&data%5Bstatus%5D=sent&data%5Bemail%5D=must-discard%40example.com&data%5Bip_opt%5D=10.20.30.40&data%5Bmerges%5D%5BEMAIL%5D=must-discard%40example.com");
const signature = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
const wakeup = parseMailchimpWebhookWakeup({ signingSecret: secret, signatureHeader: `t=${timestamp},v1=${signature}`, rawBody, expectedAudienceId: "audience_qa", nowSeconds: timestamp });
if (!wakeup || wakeup.providerCampaignId !== "campaign_qa") throw new Error("Signed Campaign delivery did not create a wakeup projection");
if (/email|example|ip_opt|merges/iu.test(JSON.stringify(wakeup))) throw new Error("Wakeup projection retained recipient material");
let rejected = 0;
for (const variant of [
  { signatureHeader: `t=${timestamp},v1=${"0".repeat(64)}`, nowSeconds: timestamp },
  { signatureHeader: `t=${timestamp},v1=${signature}`, nowSeconds: timestamp + 301 },
]) {
  try { parseMailchimpWebhookWakeup({ signingSecret: secret, rawBody, expectedAudienceId: "audience_qa", ...variant }); } catch { rejected += 1; }
}
if (rejected !== 2) throw new Error("Invalid or stale signed delivery was accepted");
process.stdout.write(`${JSON.stringify({ event: "qa.mailchimp-webhook.completed", signature: "hmac-sha256", replayWindowSeconds: 300, aggregateWakeupOnly: true, recipientDataPresent: false, rejectedInvalidDeliveries: rejected })}\n`);
