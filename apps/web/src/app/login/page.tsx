import { redirect } from "next/navigation";
import { WandSparkles } from "lucide-react";
import { DevLoginButton } from "@/components/dev-login-button";
import { getAuthenticatedUser } from "@/server/auth";
import { getActiveWorkspace } from "@/server/active-workspace";
import { getServerConfiguration } from "@/server/config";

const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  account_not_provisioned: "This verified account has not been granted access to Market Me.",
  oidc_provider_denied: "Sign-in was canceled or denied by the identity provider.",
  oidc_state_invalid: "The sign-in request expired or did not match this browser. Please try again.",
  oidc_configuration_changed: "The identity provider configuration changed during sign-in. Please try again.",
  oidc_email_unverified: "Your identity provider must supply a verified email address.",
  oidc_token_expired: "The identity response expired. Please try again.",
  oidc_not_configured: "No production identity provider is configured.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const user = await getAuthenticatedUser();
  if (user) {
    if (await getActiveWorkspace(user.id)) redirect("/");
    return (
      <main className="auth-page">
        <section className="auth-card">
          <div className="brand-mark auth-mark"><WandSparkles size={22} /></div>
          <p className="eyebrow">Market Me workspace</p>
          <h1>No workspace access</h1>
          <p className="auth-copy">You are signed in as {user.email}, but this account has no current workspace membership. Contact a workspace owner or administrator for an invitation.</p>
          <form action="/api/auth/logout" method="post"><button type="submit" className="button-primary auth-button">Sign out</button></form>
        </section>
      </main>
    );
  }
  const config = getServerConfiguration();
  const oidcEnabled = Boolean(config.oidcIssuer && config.oidcClientId);
  const errorCode = (await searchParams).error;
  const error = typeof errorCode === "string"
    ? LOGIN_ERRORS[errorCode] ?? "Sign-in failed. Please try again."
    : undefined;
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark auth-mark"><WandSparkles size={22} /></div>
        <p className="eyebrow">Market Me workspace</p>
        <h1>Build campaigns from the folders your team already uses.</h1>
        <p className="auth-copy">Sign in to configure storage connections, Smart Sources, readiness rules, and approvals.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {oidcEnabled && (
          <a className="button-primary auth-button auth-provider-button" href="/api/auth/oidc/start">
            Continue with {config.oidcProviderName}
          </a>
        )}
        <DevLoginButton enabled={config.developmentLoginEnabled} showUnavailable={!oidcEnabled} />
        <p className="auth-footnote">
          Production sign-in uses your organization&apos;s verified OpenID Connect identity.
        </p>
      </section>
    </main>
  );
}
