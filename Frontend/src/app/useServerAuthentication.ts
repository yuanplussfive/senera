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

export function useServerAuthentication(webSocketUrl: string): {
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
      const authentication = await readServerAuthentication(webSocketUrl);
      if (operation === operationRef.current) setState(projectAuthenticationState(authentication));
    } catch (error) {
      if (operation === operationRef.current) {
        setState({ status: "failed", error: error instanceof Error ? error : new Error(String(error)) });
      }
    }
  }, [webSocketUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (credentials: { loginName: string; password: string }): Promise<void> => {
      const operation = ++operationRef.current;
      const authentication = await loginServerAuthentication(webSocketUrl, credentials);
      if (operation === operationRef.current) setState({ status: "authenticated", authentication });
    },
    [webSocketUrl],
  );

  const logout = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    const authentication = state.status === "authenticated" ? state.authentication : undefined;
    const csrfToken =
      authentication?.state === AuthenticationSessionStates.Authenticated ? authentication.csrfToken : undefined;
    await logoutServerAuthentication(webSocketUrl, csrfToken);
    if (operation === operationRef.current) setState({ status: "anonymous" });
  }, [state, webSocketUrl]);

  const revalidate = useCallback(async (): Promise<ServerAuthenticationRevalidationResult> => {
    const operation = ++operationRef.current;
    try {
      const authentication = await readServerAuthentication(webSocketUrl);
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
  }, [webSocketUrl]);

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
