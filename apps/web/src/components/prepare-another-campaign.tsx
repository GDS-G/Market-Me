"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { preparationStorageKey, restorePreparationAttempt, type PreparationScope } from "./campaign-preparation-request";

export function PrepareAnotherCampaign({ userId, workspaceId, completedAttemptKey }: PreparationScope & { completedAttemptKey: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  function start() {
    try {
      const scope = { userId, workspaceId };
      const storageKey = preparationStorageKey(scope);
      const saved = restorePreparationAttempt(sessionStorage.getItem(storageKey), scope);
      if (saved && saved.idempotencyKey !== completedAttemptKey) {
        setError("Another saved attempt is waiting in this tab. Resolve it before starting a separate preparation.");
        return;
      }
      sessionStorage.removeItem(storageKey);
      router.push("/campaigns/prepare");
    } catch { setError("The saved attempt could not be cleared safely. Open preparation to review its recovery options."); }
  }
  return <div><button type="button" onClick={start}>Prepare another</button>{error && <p role="alert" className="form-error">{error} <Link href="/campaigns/prepare">Open preparation</Link></p>}</div>;
}
