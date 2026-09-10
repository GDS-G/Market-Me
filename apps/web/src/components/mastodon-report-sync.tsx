"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MastodonReportSync({ workspaceId, publicationActionId }: { workspaceId: string; publicationActionId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function synchronize() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/publication-actions/${publicationActionId}/mastodon-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const payload = await response.json() as { data?: { created: boolean }; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Mastodon metric refresh failed.");
      setMessage(payload.data?.created
        ? "New aggregate Mastodon snapshot recorded."
        : "Metrics are unchanged; no duplicate snapshot was created.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mastodon metric refresh failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button className="button button-secondary" type="button" onClick={synchronize} disabled={pending}>
        {pending ? "Checking Mastodon…" : "Refresh aggregate metrics"}
      </button>
      {message ? <small aria-live="polite">{message}</small> : null}
    </div>
  );
}
