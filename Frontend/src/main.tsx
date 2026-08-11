import { lazy, StrictMode, Suspense, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { resolveAppSurface, resolveSettingsSection } from "./app/appSurface";
import { readDesktopBridge } from "./app/desktopBridge";
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

const LazyDesktopWindowChrome = lazy(() =>
  import("./app/DesktopWindowChrome").then(({ DesktopWindowChrome }) => ({ default: DesktopWindowChrome })),
);
const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
const HTTP_BASE_URL = resolveRuntimeHttpBaseUrl(WS_URL);
const root = document.getElementById("root");

if (import.meta.env.DEV) installMotionDevTools();
if (!root) throw new Error("#root not found in index.html");

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

function Root(): JSX.Element {
  const [moduleRetryAttempt, setModuleRetryAttempt] = useState(0);
  const retryApplicationModules = useCallback(() => {
    setModuleRetryAttempt((attempt) => attempt + 1);
  }, []);

  return (
    <ErrorBoundary presentation="app" onReset={retryApplicationModules}>
      <ApplicationRoot key={moduleRetryAttempt} />
    </ErrorBoundary>
  );
}

function ApplicationRoot(): JSX.Element {
  const [LazyAuthenticatedSurface] = useState(() => lazy(loadAuthenticatedSurfaceComponent));
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

  const authenticatedContent = (
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
  );

  return (
    <FrontendI18nProvider>
      {isDesktop ? (
        <Suspense fallback={authenticatedContent}>
          <LazyDesktopWindowChrome surface={surface}>{authenticatedContent}</LazyDesktopWindowChrome>
        </Suspense>
      ) : (
        authenticatedContent
      )}
    </FrontendI18nProvider>
  );
}
