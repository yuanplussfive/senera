import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loginServerAuthentication,
  logoutServerAuthentication,
  readServerAuthentication,
  type ServerAuthentication,
} from "../api/authClient";

export type ServerAuthenticationState =
  | { readonly status: "loading" }
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly authentication: ServerAuthentication }
  | { readonly status: "failed"; readonly error: Error };

export function useServerAuthentication(webSocketUrl: string): {
  state: ServerAuthenticationState;
  login: (credentials: { loginName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<ServerAuthenticationState>({ status: "loading" });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const authentication = await readServerAuthentication(webSocketUrl);
      setState(
        authentication.required && !authentication.account
          ? { status: "anonymous" }
          : { status: "authenticated", authentication },
      );
    } catch (error) {
      setState({ status: "failed", error: error instanceof Error ? error : new Error(String(error)) });
    }
  }, [webSocketUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (credentials: { loginName: string; password: string }): Promise<void> => {
      const authentication = await loginServerAuthentication(webSocketUrl, credentials);
      setState({ status: "authenticated", authentication });
    },
    [webSocketUrl],
  );

  const logout = useCallback(async (): Promise<void> => {
    const authentication = state.status === "authenticated" ? state.authentication : undefined;
    await logoutServerAuthentication(webSocketUrl, authentication?.csrfToken);
    setState({ status: "anonymous" });
  }, [state, webSocketUrl]);

  return useMemo(
    () => ({
      state,
      login,
      logout,
      refresh,
    }),
    [login, logout, refresh, state],
  );
}
