"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DevLoginButton({ enabled, showUnavailable = true }: { enabled: boolean; showUnavailable?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    setError("");
    const response = await fetch("/api/auth/dev-login", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload?.error?.message ?? "Sign in failed.");
      setPending(false);
      return;
    }
    router.push("/smart-sources");
    router.refresh();
  }

  if (!enabled) {
    return showUnavailable ? <p className="auth-note">No identity provider is configured yet.</p> : null;
  }
  return (
    <div>
      <button className="button-primary auth-button" disabled={pending} onClick={signIn} type="button">
        {pending ? "Starting workspace…" : "Enter development workspace"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
