import { lazy, StrictMode, Suspense, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { resolveAppSurface, resolveSettingsSection } from "./app/appSurface";
import { readDesktopBridge } from "./app/desktopBridge";
import { DesktopWindowChrome } from "./app/DesktopWindowChrome";
import { ServerAuthenticationBoundary, ServerAuthenticationLoading } from "./app/ServerAuthenticationGate";
import { useServerAuthentication } from "./app/useServerAuthentication";
import type { AgentSocketReconnectPolicy } from "./api/useAgentSocket";
import { AuthenticationSessionStates } from "./api/generatedEventCatalog";
import { resolveRuntimeHttpBaseUrl, resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";
import { installMotionDevTools } from "./dev/motionDevTools";
import { FrontendI18nProvider, useFrontendLocale } from "./i18n/useFrontendLocale";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { loadAuthenticatedSurfaceComponent } from "./app/applicationModuleLoaders";
import { useAuthenticatedApplicationPreload } from "./app/useAuthenticatedApplicationPreload";
import "./styles/fonts.css";
import "./index.css";
import "./styles/transitions.css";

const LazyAuthenticatedSurface = lazy(loadAuthenticatedSurfaceComponent);
const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
const HTTP_BASE_URL = resolveRuntimeHttpBaseUrl(WS_URL);
const root = document.getElementById("root");

if (import.meta.env.DEV) installMotionDevTools();
if (!root) throw new Error("#root not found in index.html");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary presentation="app">
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);

function Root(): JSX.Element {
  useFrontendLocale();
  const isDesktop = Boolean(readDesktopBridge()?.isDesktop);
  const surface = resolveAppSurface(window.location, isDesktop);
  const settingsSection = resolveSettingsSection(window.location);
  const authenticatedApplicationPreload = useAuthenticatedApplicationPreload({ isDesktop, surface });
  const authentication = useServerAuthentication(HTTP_BASE_URL, {
    onInitialRequestStarted: authenticatedApplicationPreload.onInitialAuthenticationRequestStarted,
    prepareAuthorizedSurface: authenticatedApplicationPreload.prepareAuthorizedSurface,
  });
  const revalidateAuthentication = authentication.revalidate;
  const socketReconnectPolicy = useCallback<AgentSocketReconnectPolicy>(async () => {
    const result = await revalidateAuthentication();
    return result === "anonymous" || result === "rejected" ? "stop" : "retry";
  }, [revalidateAuthentication]);

  return (
    <FrontendI18nProvider>
      <DesktopWindowChrome surface={surface}>
        <ServerAuthenticationBoundary
          state={authentication.state}
          onLogin={authentication.login}
          onRetry={authentication.refresh}
        >
          {(resolvedAuthentication) => (
            <Suspense fallback={<ServerAuthenticationLoading />}>
              <LazyAuthenticatedSurface
                authentication={resolvedAuthentication}
                surface={surface}
                settingsSection={settingsSection}
                socketReconnectPolicy={socketReconnectPolicy}
                onLogout={
                  resolvedAuthentication.state === AuthenticationSessionStates.Authenticated
                    ? authentication.logout
                    : undefined
                }
              />
            </Suspense>
          )}
        </ServerAuthenticationBoundary>
      </DesktopWindowChrome>
    </FrontendI18nProvider>
  );
}
