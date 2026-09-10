"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MailchimpReportSync({ workspaceId, publicationActionId }: { workspaceId: string; publicationActionId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function synchronize() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/publication-actions/${publicationActionId}/mailchimp-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const payload = await response.json() as { data?: { created: boolean; publicationReconciled: boolean }; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message ?? "Mailchimp report reconciliation failed.");
      setMessage(payload.data?.publicationReconciled
        ? "Report verified; the previously uncertain publication is now confirmed sent."
        : payload.data?.created ? "New aggregate report snapshot recorded." : "Report is unchanged; no duplicate snapshot was created.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mailchimp report reconciliation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button className="button button-secondary" type="button" onClick={synchronize} disabled={pending}>
        {pending ? "Checking Mailchimp…" : "Refresh aggregate report"}
      </button>
      {message ? <small aria-live="polite">{message}</small> : null}
    </div>
  );
}
