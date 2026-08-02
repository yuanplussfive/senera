import { KeyRound, LogIn, RefreshCw } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { LogoMark } from "../shared/ui/Logo";
import { Spinner } from "../shared/ui/Spinner";
import { InlineError } from "../shared/ui/StateView";
import type { ServerAuthenticationState } from "./useServerAuthentication";
import type { ServerAuthorizedAuthentication } from "../api/authClient";

export function ServerAuthenticationBoundary({
  state,
  onLogin,
  onRetry,
  children,
}: {
  state: ServerAuthenticationState;
  onLogin: (credentials: { loginName: string; password: string }) => Promise<void>;
  onRetry: () => Promise<void>;
  children: (authentication: ServerAuthorizedAuthentication) => ReactNode;
}): JSX.Element {
  if (state.status === "authenticated") {
    return <>{children(state.authentication)}</>;
  }
  return <ServerAuthenticationGate state={state} onLogin={onLogin} onRetry={onRetry} />;
}

export function ServerAuthenticationGate({
  state,
  onLogin,
  onRetry,
}: {
  state: ServerAuthenticationState;
  onLogin: (credentials: { loginName: string; password: string }) => Promise<void>;
  onRetry: () => Promise<void>;
}): JSX.Element {
  if (state.status === "loading" || state.status === "revalidating") {
    return <ServerAuthenticationLoading revalidating={state.status === "revalidating"} />;
  }
  if (state.status === "failed") {
    return <AuthenticationFailure onRetry={onRetry} />;
  }
  return <LoginForm onLogin={onLogin} />;
}

export function ServerAuthenticationLoading({ revalidating = false }: { revalidating?: boolean }): JSX.Element {
  return (
    <AuthenticationWorkspaceLoading
      title={frontendMessage(revalidating ? "auth.reconnecting" : "auth.loading")}
      description={frontendMessage(revalidating ? "auth.reconnectingDescription" : "auth.loadingDescription")}
    />
  );
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
        {failed ? (
          <InlineError announce="assertive" className="mt-3">
            {frontendMessage("auth.loginFailed")}
          </InlineError>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 bg-ink-900 px-3 text-[13px] font-medium text-paper-50 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Spinner size="md" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
          {submitting ? frontendMessage("auth.signingIn") : frontendMessage("auth.signIn")}
        </button>
      </form>
    </main>
  );
}

function AuthenticationFailure({ onRetry }: { onRetry: () => Promise<void> }): JSX.Element {
  const [retrying, setRetrying] = useState(false);

  const retry = async (): Promise<void> => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      // The authentication state owns the surfaced connection failure.
    } finally {
      setRetrying(false);
    }
  };

  const retryLabel = frontendMessage(retrying ? "auth.reconnecting" : "auth.retry");

  return (
    <main className="grid h-dvh min-h-[320px] min-w-[320px] place-items-center overflow-hidden bg-surface-canvas px-6 py-8 text-content-primary">
      <section
        role="alert"
        aria-busy={retrying || undefined}
        className="grid min-w-[212px] -translate-y-[3vh] gap-3.5 max-sm:translate-y-0"
        data-auth-status="failed"
      >
        <div className="flex min-h-6 items-center gap-2">
          <LogoMark size={21} />
          <h1 className="text-[17px] font-semibold leading-tight text-content-strong">Senera</h1>
        </div>

        <div className="flex min-h-7 items-center gap-1 pl-[29px]">
          <p className="whitespace-nowrap text-[13px] leading-5 text-content-secondary">
            {frontendMessage(retrying ? "auth.reconnecting" : "auth.connectionFailed")}
          </p>
          <button
            type="button"
            aria-label={retryLabel}
            title={retryLabel}
            className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md text-content-muted transition-[color,background-color,transform] duration-150 ease-out before:absolute before:-inset-2 before:content-[''] hover:bg-surface-hover hover:text-content-primary active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:cursor-wait disabled:opacity-55 motion-reduce:transition-none"
            onClick={() => void retry()}
            disabled={retrying}
          >
            <RefreshCw
              className={retrying ? "h-[15px] w-[15px] motion-safe:animate-spin" : "h-[15px] w-[15px]"}
              strokeWidth={1.65}
              aria-hidden="true"
            />
          </button>
        </div>
      </section>
    </main>
  );
}

function AuthenticationWorkspaceLoading({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <main
      className="flex h-dvh min-h-[420px] w-screen flex-col overflow-hidden bg-surface-canvas text-content-primary"
      data-auth-workspace-shell
    >
      <header
        className="flex h-[52px] shrink-0 items-center border-b border-line-subtle bg-surface-subtle pr-[150px]"
        data-auth-titlebar
      >
        <div className="flex h-full w-[200px] shrink-0 items-center gap-2 border-r border-line-subtle px-3 xl:w-[246px]">
          <LogoMark size={20} />
          <span className="text-[13px] font-semibold text-content-primary">Senera</span>
        </div>
        <span className="px-4 text-[11.5px] text-content-muted">{frontendMessage("auth.workspace")}</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[246px_minmax(0,1fr)_300px]">
        <AuthenticationSidebarSkeleton />

        <section
          className="grid min-h-0 min-w-0 grid-rows-[44px_minmax(0,1fr)_78px] bg-surface-canvas"
          data-auth-workspace-main
        >
          <div
            className="flex items-center justify-between border-b border-line-subtle bg-surface-panel px-4"
            aria-hidden="true"
          >
            <AuthenticationPlaceholder className="w-36" />
            <div className="flex gap-2">
              <span className="h-6 w-6 rounded-md border border-line-subtle bg-surface-panel" />
              <span className="h-6 w-6 rounded-md border border-line-subtle bg-surface-panel" />
            </div>
          </div>

          <div className="grid min-h-0 place-items-center px-8 py-10">
            <section
              role="status"
              aria-busy="true"
              className="w-full max-w-[420px] -translate-y-2"
              data-auth-status="loading"
            >
              <div className="flex items-start gap-3">
                <Spinner size="md" className="mt-1 text-accent-content" />
                <div className="min-w-0">
                  <h1 className="text-[18px] font-semibold leading-[1.3] text-content-strong">{title}</h1>
                  <p className="mt-1.5 max-w-[48ch] text-[13px] leading-5 text-content-secondary">{description}</p>
                </div>
              </div>
            </section>
          </div>

          <div
            className="grid justify-items-center border-t border-line-subtle bg-surface-panel pt-3.5"
            aria-hidden="true"
          >
            <div className="h-[46px] w-[min(560px,calc(100%_-_64px))] rounded-lg border border-line-subtle bg-surface-panel" />
          </div>
        </section>

        <AuthenticationInspectorSkeleton />
      </div>
    </main>
  );
}

function AuthenticationSidebarSkeleton(): JSX.Element {
  return (
    <aside
      className="hidden min-h-0 overflow-hidden border-r border-line-subtle bg-surface-sidebar px-3 py-4 md:block"
      aria-hidden="true"
      data-auth-sidebar-skeleton
    >
      <AuthenticationPlaceholder className="ml-1 w-16" />
      <div className="mt-4 space-y-1">
        <AuthenticationSidebarRow />
        <AuthenticationSidebarRow />
        <AuthenticationSidebarRow />
      </div>
    </aside>
  );
}

function AuthenticationSidebarRow(): JSX.Element {
  return (
    <div className="grid h-11 grid-cols-[16px_minmax(0,1fr)] items-center gap-2.5 px-1.5">
      <span className="h-3.5 w-3.5 rounded border border-line-subtle" />
      <span className="grid gap-1.5">
        <AuthenticationPlaceholder className="w-[72%]" />
        <AuthenticationPlaceholder className="h-1.5 w-[42%] opacity-60" />
      </span>
    </div>
  );
}

function AuthenticationInspectorSkeleton(): JSX.Element {
  return (
    <aside
      className="hidden min-h-0 overflow-hidden border-l border-line-subtle bg-surface-subtle px-3.5 py-4 xl:block"
      aria-hidden="true"
      data-auth-inspector-skeleton
    >
      <AuthenticationPlaceholder className="w-20" />
      <div className="mt-4 border-t border-line-subtle pt-4">
        <AuthenticationPlaceholder className="w-[78%]" />
        <AuthenticationPlaceholder className="mt-2.5 w-[54%] opacity-60" />
      </div>
    </aside>
  );
}

function AuthenticationPlaceholder({ className }: { className: string }): JSX.Element {
  return <span className={`block h-2 rounded-[3px] bg-ink-900/[0.075] ${className}`} />;
}
