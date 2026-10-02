import { workspaceAnalyticsUuid } from "@market-me/database";

/** Scope hints constrain the current selection; they never select a workspace. */
export function workspaceAnalyticsQuery(query: Record<string, string | string[] | undefined>, workspaceId: string): string | undefined {
  if (Object.keys(query).some(key => key !== "campaignId" && key !== "workspaceId")) throw new Error("Unsupported Analytics filter.");
  if (query.workspaceId !== undefined && workspaceAnalyticsUuid(query.workspaceId) !== workspaceAnalyticsUuid(workspaceId)) throw new Error("Different workspace.");
  return query.campaignId === undefined ? undefined : workspaceAnalyticsUuid(query.campaignId);
}
export function workspaceAnalyticsPath(workspaceId: string, campaignId?: string): string {
  return `/analytics?workspaceId=${workspaceAnalyticsUuid(workspaceId)}${campaignId === undefined ? "" : `&campaignId=${workspaceAnalyticsUuid(campaignId)}`}`;
}
/** Decimal text stays text. No floating point, currency conversion, scaling, or rounding. */
export function analyticsDecimal(value: string): string {
  if (typeof value !== "string" || value.length > 128 || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new Error("Invalid recorded Analytics value.");
  const [whole, fraction] = value.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`);
}
export function analyticsCount(value: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error("Invalid recorded Analytics count.");
  return analyticsDecimal(value);
}
export const ANALYTICS_EVENT_SECTIONS = Object.freeze([
  { key: "outcome", title: "Recorded business outcomes", description: "Events reported as leads, registrations, purchases and other outcomes. Recording an event does not prove causal attribution or a completed business result." },
  { key: "engagement", title: "Recorded engagement", description: "Visits, clicks and interactions from event collectors. These are event counts, not unique people, reach estimates or business success." },
  { key: "feedback", title: "Recorded negative feedback", description: "Reported unsubscribes and complaints, kept separate from positive engagement." },
  { key: "custom", title: "Other recorded events", description: "Custom or unclassified event labels retain their recorded meaning; no success interpretation is inferred." },
] as const);
const outcomes: ReadonlySet<string> = new Set(["form_completion", "lead", "application", "registration", "subscription", "purchase", "booking", "donation", "revenue"]);
const engagement: ReadonlySet<string> = new Set(["impression", "reach", "view", "reaction", "comment", "reply", "share", "save", "follow", "profile_visit", "outbound_click", "destination_visit"]);
export function analyticsEventSection(eventType: string): typeof ANALYTICS_EVENT_SECTIONS[number]["key"] {
  return outcomes.has(eventType) ? "outcome" : engagement.has(eventType) ? "engagement" : ["unsubscribe", "complaint"].includes(eventType) ? "feedback" : "custom";
}
const labels: Readonly<Record<string, string>> = Object.freeze({
  email_sent: "Emails sent", email_unique_open: "Unique opens per email campaign", email_unique_click: "Unique clicks per email campaign",
  email_unsubscribe: "Email unsubscribes", email_bounce: "Email bounces", email_complaint: "Email complaints",
  mastodon_reply: "Mastodon replies", mastodon_reblog: "Mastodon boosts", mastodon_favourite: "Mastodon favourites",
  mailchimp_email: "Mailchimp", mastodon_account: "Mastodon", discord_webhook: "Discord", slack_webhook: "Slack",
  awaiting_approval: "Awaiting approval", scheduled: "Scheduled", active: "Active", paused: "Paused", completed: "Marked completed",
  failed: "Failed", canceled: "Canceled", dispatching: "Dispatching", succeeded: "Recorded success", ambiguous: "Outcome uncertain",
});
export function analyticsLabel(value: string): string { return Object.hasOwn(labels, value) ? labels[value] : value.replaceAll("_", " "); }
