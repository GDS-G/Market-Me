import Link from "next/link";
import { BellRing } from "lucide-react";
import type { ConversationAttentionItem } from "@market-me/domain";

export function ConversationAttentionQueue({
  items,
}: {
  items: readonly ConversationAttentionItem[];
}) {
  return (
    <section className="resource-panel conversation-attention-panel">
      <div className="resource-panel-head">
        <div>
          <p className="eyebrow">In-app reminders</p>
          <h2>Needs attention</h2>
          <p>
            Deterministic response, follow-up, review, and handoff deadlines.
            This queue never changes ownership or sends a notification.
          </p>
        </div>
        <span className="attention-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="assistant-empty">
          <BellRing size={20} aria-hidden="true" />
          <p>No active conversation currently needs deadline attention.</p>
        </div>
      ) : (
        <div className="attention-list">
          {items.slice(0, 20).map((item) => (
            <Link
              className="attention-item"
              href={`/conversations/threads/${item.conversationThreadId}`}
              key={item.conversationThreadId}
            >
              <div>
                <strong>{item.subject}</strong>
                <p>
                  {item.relationshipDisplayName} · {item.assignedOwnerDisplayName ?? "Unassigned"}
                </p>
              </div>
              <div className="attention-reasons">
                {item.reasons.map((reason) => (
                  <span className={`status-pill attention-${reason}`} key={reason}>
                    {reasonLabel(reason)}
                  </span>
                ))}
              </div>
              <time dateTime={item.primaryDueAt}>{formatDate(item.primaryDueAt)}</time>
            </Link>
          ))}
          {items.length > 20 && (
            <p className="form-note">
              Showing the 20 most urgent of {items.length} bounded attention items.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function reasonLabel(reason: ConversationAttentionItem["reasons"][number]): string {
  const labels = {
    response_at_risk: "Response at risk",
    response_overdue: "Response overdue",
    response_escalation_due: "Escalation due",
    follow_up_due: "Follow-up due",
    review_request_due: "Review due",
    handoff_due: "Handoff due",
  } as const;
  return labels[reason];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
