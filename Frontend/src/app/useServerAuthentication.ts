import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loginServerAuthentication,
  logoutServerAuthentication,
  readServerAuthentication,
  ServerAuthenticationError,
  type ServerAuthorizedAuthentication,
} from "../api/authClient";
import { AuthenticationSessionStates } from "../api/generatedEventCatalog";

const INITIAL_AUTHENTICATION_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 8_000] as const;

export type ServerAuthenticationState =
  | { readonly status: "loading" }
  | { readonly status: "revalidating" }
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly authentication: ServerAuthorizedAuthentication }
  | { readonly status: "failed"; readonly error: Error };

export type ServerAuthenticationRevalidationResult =
  "authorized" | "anonymous" | "rejected" | "unreachable" | "superseded";

export interface ServerAuthenticationLifecycle {
  onInitialRequestStarted?: () => void;
  prepareAuthorizedSurface?: () => Promise<void>;
}

export function useServerAuthentication(
  httpBaseUrl: string,
  lifecycle: ServerAuthenticationLifecycle = {},
): {
  state: ServerAuthenticationState;
  login: (credentials: { loginName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  revalidate: () => Promise<ServerAuthenticationRevalidationResult>;
} {
  const [state, setState] = useState<ServerAuthenticationState>({ status: "loading" });
  const operationRef = useRef(0);
  const initialRequestStartedRef = useRef(false);
  const initialRetryTimerRef = useRef<number | null>(null);
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;

  const clearInitialRetryTimer = useCallback((): void => {
    if (initialRetryTimerRef.current === null) return;
    window.clearTimeout(initialRetryTimerRef.current);
    initialRetryTimerRef.current = null;
  }, []);

  const readAuthentication = useCallback(
    async (
      operation: number,
      retryTransientFailure: boolean,
      retryAttempt = 0,
      request?: Promise<Awaited<ReturnType<typeof readServerAuthentication>>>,
    ): Promise<void> => {
      try {
        const authentication = await (request ?? readServerAuthentication(httpBaseUrl));
        if (operation !== operationRef.current) return;
        clearInitialRetryTimer();
        await prepareAuthorizedAuthentication(authentication, lifecycleRef.current.prepareAuthorizedSurface);
        if (operation === operationRef.current) setState(projectAuthenticationState(authentication));
      } catch (error) {
        if (operation !== operationRef.current) return;

        const nextDelay = retryTransientFailure ? INITIAL_AUTHENTICATION_RETRY_DELAYS_MS[retryAttempt] : undefined;
        if (nextDelay !== undefined && isTransientAuthenticationFailure(error)) {
          initialRetryTimerRef.current = window.setTimeout(() => {
            initialRetryTimerRef.current = null;
            void readAuthentication(operation, true, retryAttempt + 1);
          }, nextDelay);
          return;
        }

        clearInitialRetryTimer();
        setState({ status: "failed", error: error instanceof Error ? error : new Error(String(error)) });
      }
    },
    [clearInitialRetryTimer, httpBaseUrl],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    clearInitialRetryTimer();
    setState((current) => (current.status === "loading" ? current : { status: "revalidating" }));
    await readAuthentication(operation, false);
  }, [clearInitialRetryTimer, readAuthentication]);

  const initialRefresh = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    clearInitialRetryTimer();
    const request = readServerAuthentication(httpBaseUrl);
    if (!initialRequestStartedRef.current) {
      initialRequestStartedRef.current = true;
      lifecycleRef.current.onInitialRequestStarted?.();
    }
    await readAuthentication(operation, true, 0, request);
  }, [clearInitialRetryTimer, httpBaseUrl, readAuthentication]);

  useEffect(() => {
    void initialRefresh();
    return () => {
      operationRef.current += 1;
      clearInitialRetryTimer();
    };
  }, [clearInitialRetryTimer, initialRefresh]);

  const login = useCallback(
    async (credentials: { loginName: string; password: string }): Promise<void> => {
      const operation = ++operationRef.current;
      const authentication = await loginServerAuthentication(httpBaseUrl, credentials);
      if (operation !== operationRef.current) return;
      await prepareAuthorizedAuthentication(authentication, lifecycleRef.current.prepareAuthorizedSurface);
      if (operation === operationRef.current) setState({ status: "authenticated", authentication });
    },
    [httpBaseUrl],
  );

  const logout = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    const authentication = state.status === "authenticated" ? state.authentication : undefined;
    const csrfToken =
      authentication?.state === AuthenticationSessionStates.Authenticated ? authentication.csrfToken : undefined;
    await logoutServerAuthentication(httpBaseUrl, csrfToken);
    if (operation === operationRef.current) setState({ status: "anonymous" });
  }, [httpBaseUrl, state]);

  const revalidate = useCallback(async (): Promise<ServerAuthenticationRevalidationResult> => {
    const operation = ++operationRef.current;
    try {
      const authentication = await readServerAuthentication(httpBaseUrl);
      if (operation !== operationRef.current) return "superseded";
      setState(projectAuthenticationState(authentication));
      return authentication.state === AuthenticationSessionStates.Anonymous ? "anonymous" : "authorized";
    } catch (error) {
      if (operation !== operationRef.current) return "superseded";
      if (error instanceof ServerAuthenticationError && (error.status === 401 || error.status === 403)) {
        setState({ status: "failed", error });
        return "rejected";
      }
      return "unreachable";
    }
  }, [httpBaseUrl]);

  return useMemo(
    () => ({
      state,
      login,
      logout,
      refresh,
      revalidate,
    }),
    [login, logout, refresh, revalidate, state],
  );
}

function isTransientAuthenticationFailure(error: unknown): boolean {
  if (!(error instanceof ServerAuthenticationError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

function projectAuthenticationState(
  authentication: Awaited<ReturnType<typeof readServerAuthentication>>,
): ServerAuthenticationState {
  return authentication.state === AuthenticationSessionStates.Anonymous
    ? { status: "anonymous" }
    : { status: "authenticated", authentication };
}

async function prepareAuthorizedAuthentication(
  authentication: Awaited<ReturnType<typeof readServerAuthentication>>,
  prepare: (() => Promise<void>) | undefined,
): Promise<void> {
  if (authentication.state === AuthenticationSessionStates.Anonymous || !prepare) return;
  try {
    await prepare();
  } catch {
    // Speculative loading must not turn a valid server session into an authentication failure.
  }
}
