import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { ServerAuthenticationController, type ServerAuthenticationLifecycle } from "../api/serverAuthentication";

export type {
  ServerAuthenticationState,
  ServerAuthenticationLifecycle,
  ServerAuthenticationRevalidationResult,
} from "../api/serverAuthentication";

export const ServerAuthenticationContext = createContext<ReturnType<typeof useServerAuthentication> | undefined>(
  undefined,
);

export function useActiveServerAuthentication() {
  const authentication = useContext(ServerAuthenticationContext);
  if (!authentication) throw new Error("Server authentication must be provided by the application root.");
  return authentication;
}

/** React subscribes to the same authentication controller as channel documents. */
export function useServerAuthentication(httpBaseUrl: string, lifecycle: ServerAuthenticationLifecycle = {}) {
  const controller = useMemo(() => new ServerAuthenticationController(httpBaseUrl), [httpBaseUrl]);
  controller.configure(lifecycle);
  const state = useSyncExternalStore(
    controller.store.subscribe,
    controller.store.getState,
    controller.store.getInitialState,
  );
  useEffect(() => {
    controller.start();
    return controller.stop;
  }, [controller]);
  return useMemo(
    () => ({
      state,
      login: controller.login,
      logout: controller.logout,
      refresh: controller.refresh,
      revalidate: controller.revalidate,
    }),
    [controller, state],
  );
}
