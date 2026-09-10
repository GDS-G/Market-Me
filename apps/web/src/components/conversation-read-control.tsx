"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";

export function ConversationReadControl({
  workspaceId,
  threadId,
  unreadCount,
}: {
  workspaceId: string;
  threadId: string;
  unreadCount: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function markRead() {
    setPending(true);
    setError("");
    const response = await fetch(`/api/v1/conversations/${threadId}/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(
        payload?.error?.message ?? "Could not mark the conversation read.",
      );
      return;
    }
    router.refresh();
  }

  return (
    <div className="conversation-read-control">
      {unreadCount > 0 ? (
        <button
          className="button-secondary"
          disabled={pending}
          onClick={markRead}
          type="button"
        >
          <CheckCheck size={15} />
          {pending ? "Marking read..." : `Mark ${unreadCount} read`}
        </button>
      ) : (
        <span className="status-pill status-green">
          <CheckCheck size={13} /> Read
        </span>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
