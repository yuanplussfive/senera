import { KeyRound, LoaderCircle, LogIn, RefreshCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { ServerAuthenticationState } from "./useServerAuthentication";

export function ServerAuthenticationGate({
  state,
  onLogin,
  onRetry,
}: {
  state: ServerAuthenticationState;
  onLogin: (credentials: { loginName: string; password: string }) => Promise<void>;
  onRetry: () => Promise<void>;
}): JSX.Element {
  if (state.status === "loading") {
    return <AuthenticationStatus icon={<LoaderCircle className="h-5 w-5 animate-spin" />} messageKey="auth.loading" />;
  }
  if (state.status === "failed") {
    return (
      <AuthenticationStatus
        icon={<RefreshCcw className="h-5 w-5" />}
        messageKey="auth.connectionFailed"
        actionLabel={frontendMessage("auth.retry")}
        onAction={() => void onRetry()}
      />
    );
  }
  return <LoginForm onLogin={onLogin} />;
}

function LoginForm({
  onLogin,
}: {
  onLogin: (credentials: { loginName: string; password: string }) => Promise<void>;
}): JSX.Element {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSubmitting(true);
    setFailed(false);
    void onLogin({ loginName, password })
      .catch(() => setFailed(true))
      .finally(() => {
        setSubmitting(false);
        setPassword("");
      });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-100 px-4 py-8 text-ink-900">
      <form
        className="w-full max-w-[360px] border border-ink-200 bg-paper-50 p-5 shadow-[0_18px_60px_rgba(24,27,31,0.12)]"
        onSubmit={submit}
      >
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center bg-accent-surface text-accent-content">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </span>
          <h1 className="text-[16px] font-semibold leading-6 text-ink-950">{frontendMessage("auth.title")}</h1>
        </div>
        <label className="mt-5 block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-600">{frontendMessage("auth.loginName")}</span>
          <input
            autoComplete="username"
            autoFocus
            className="h-10 w-full border border-ink-200 bg-paper-50 px-3 text-[13px] outline-none transition focus:border-ink-400 focus:ring-2 focus:ring-accent-focus"
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
            required
          />
        </label>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[12px] font-medium text-ink-600">{frontendMessage("auth.password")}</span>
          <input
            type="password"
            autoComplete="current-password"
            className="h-10 w-full border border-ink-200 bg-paper-50 px-3 text-[13px] outline-none transition focus:border-ink-400 focus:ring-2 focus:ring-accent-focus"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {failed ? <p className="mt-3 text-[12px] text-brick-700">{frontendMessage("auth.loginFailed")}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 bg-ink-900 px-3 text-[13px] font-medium text-paper-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {submitting ? frontendMessage("auth.signingIn") : frontendMessage("auth.signIn")}
        </button>
      </form>
    </main>
  );
}

function AuthenticationStatus({
  icon,
  messageKey,
  actionLabel,
  onAction,
}: {
  icon: JSX.Element;
  messageKey: "auth.loading" | "auth.connectionFailed";
  actionLabel?: string;
  onAction?: () => void;
}): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-100 px-4 py-8 text-ink-900">
      <div className="flex items-center gap-3 border border-ink-200 bg-paper-50 px-4 py-3 shadow-[0_18px_60px_rgba(24,27,31,0.12)]">
        <span className="text-ink-500">{icon}</span>
        <p className="text-[13px] text-ink-700">{frontendMessage(messageKey)}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="text-[13px] font-medium text-accent-content hover:text-accent-content-hover"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </main>
  );
}
