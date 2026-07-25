import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loginServerAuthentication,
  logoutServerAuthentication,
  readServerAuthentication,
  ServerAuthenticationError,
  type ServerAuthorizedAuthentication,
} from "../api/authClient";
import { AuthenticationSessionStates } from "../api/generatedEventCatalog";

export type ServerAuthenticationState =
  | { readonly status: "loading" }
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly authentication: ServerAuthorizedAuthentication }
  | { readonly status: "failed"; readonly error: Error };

export type ServerAuthenticationRevalidationResult =
  "authorized" | "anonymous" | "rejected" | "unreachable" | "superseded";

export function useServerAuthentication(httpBaseUrl: string): {
  state: ServerAuthenticationState;
  login: (credentials: { loginName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  revalidate: () => Promise<ServerAuthenticationRevalidationResult>;
} {
  const [state, setState] = useState<ServerAuthenticationState>({ status: "loading" });
  const operationRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    try {
      const authentication = await readServerAuthentication(httpBaseUrl);
      if (operation === operationRef.current) setState(projectAuthenticationState(authentication));
    } catch (error) {
      if (operation === operationRef.current) {
        setState({ status: "failed", error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
  }, [httpBaseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (credentials: { loginName: string; password: string }): Promise<void> => {
      const operation = ++operationRef.current;
      const authentication = await loginServerAuthentication(httpBaseUrl, credentials);
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

function projectAuthenticationState(
  authentication: Awaited<ReturnType<typeof readServerAuthentication>>,
): ServerAuthenticationState {
  return authentication.state === AuthenticationSessionStates.Anonymous
    ? { status: "anonymous" }
    : { status: "authenticated", authentication };
}
