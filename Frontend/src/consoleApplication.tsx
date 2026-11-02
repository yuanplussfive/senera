import { lazy, StrictMode, Suspense, useCallback, useState } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { resolveAppSurface, resolveSettingsSection } from "./app/appSurface";
import { readDesktopBridge } from "./app/desktopBridge";
import { applyDesktopWindowDocumentState } from "./app/desktopWindowDocument";
import { ServerAuthenticationContext, useServerAuthentication } from "./app/useServerAuthentication";
import type { AgentSocketReconnectPolicy } from "./api/useAgentSocket";
import { AuthenticationSessionStates, WebSocketCloseCodes } from "./api/generatedEventCatalog";
import { resolveRuntimeHttpBaseUrl, resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";
import { FrontendI18nProvider, useFrontendLocale } from "./i18n/useFrontendLocale";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { ApplicationSurfaceLoading, SettingsSurfaceLoading } from "./app/SurfaceLoading";
import { useAuthenticatedApplicationPreload } from "./app/useAuthenticatedApplicationPreload";
import { installViteDynamicImportRecovery } from "./app/viteDynamicImportRecovery";
import "./index.css";
import "./styles/fonts-bootstrap.css";

// Keep the application shell independent from the full CJK font asset graph.
// The font CSS remains a dynamic resource so the first authenticated surface
// can render while the optional brand typeface is fetched in parallel.
void import("./styles/fonts.css");

const LazyDesktopWindowChrome = lazy(() =>
  import("./app/DesktopWindowChrome").then(({ DesktopWindowChrome }) => ({ default: DesktopWindowChrome })),
);
const LazyServerAuthenticationBoundary = lazy(() =>
  import("./app/ServerAuthenticationGate").then(({ ServerAuthenticationBoundary }) => ({
    default: ServerAuthenticationBoundary,
  })),
);
const LazyWorkspaceConnectionRecovery = lazy(() =>
  import("./app/WorkspaceConnectionRecovery").then(({ WorkspaceConnectionRecovery }) => ({
    default: WorkspaceConnectionRecovery,
  })),
);
const LazyAuthenticatedSurface = lazy(() =>
  import("./app/AuthenticatedSurface").then(({ AuthenticatedSurface }) => ({ default: AuthenticatedSurface })),
);
export function mountConsoleApplication(): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root not found in index.html");
  if (import.meta.env.DEV) {
    void import("./dev/motionDevTools").then(({ installMotionDevTools }) => installMotionDevTools());
  }
  installViteDynamicImportRecovery();
  // Both the web entry and the native connection entry mount the same app.
  // Reusing its root also keeps development HMR from creating a competing tree.
  const rootElement = root as HTMLElement & { __seneraReactRoot?: ReactRoot };
  const appRoot = rootElement.__seneraReactRoot ?? createRoot(rootElement);
  rootElement.__seneraReactRoot = appRoot;
  // Apply native chrome geometry before the loading surface is painted.
  applyDesktopWindowDocumentState(resolveAppSurface(window.location, Boolean(readDesktopBridge()?.isDesktop)));
  appRoot.render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}

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
  const [wsUrl] = useState(() => resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__));
  const [httpBaseUrl] = useState(() => resolveRuntimeHttpBaseUrl(wsUrl));
  useFrontendLocale();
  const isDesktop = Boolean(readDesktopBridge()?.isDesktop);
  const surface = resolveAppSurface(window.location, isDesktop);
  const settingsSection = resolveSettingsSection(window.location);
  const authenticatedApplicationPreload = useAuthenticatedApplicationPreload({ isDesktop, surface });
  const authentication = useServerAuthentication(httpBaseUrl, {
    onInitialRequestStarted: authenticatedApplicationPreload.onInitialAuthenticationRequestStarted,
    prepareAuthorizedSurface: authenticatedApplicationPreload.prepareAuthorizedSurface,
  });
  const revalidateAuthentication = authentication.revalidate;
  const [unavailableWorkspaceUrl, setUnavailableWorkspaceUrl] = useState<string>();
  const socketReconnectPolicy = useCallback<AgentSocketReconnectPolicy>(
    async (disconnect) => {
      if (disconnect.code === WebSocketCloseCodes.WorkspaceNotFound) {
        setUnavailableWorkspaceUrl(disconnect.url);
        return "stop";
      }
      const result = await revalidateAuthentication();
      return result === "anonymous" || result === "rejected" ? "stop" : "retry";
    },
    [revalidateAuthentication],
  );
  const authenticationLoadingFallback =
    surface === "settings" ? <SettingsSurfaceLoading presentation="desktop" /> : <ApplicationSurfaceLoading />;

  const authenticatedContent = (
    <Suspense fallback={authenticationLoadingFallback}>
      <LazyServerAuthenticationBoundary
        state={authentication.state}
        onLogin={authentication.login}
        onRetry={authentication.refresh}
        loadingFallback={authenticationLoadingFallback}
      >
        {(resolvedAuthentication) =>
          unavailableWorkspaceUrl ? (
            <Suspense fallback={authenticationLoadingFallback}>
              <LazyWorkspaceConnectionRecovery
                httpBaseUrl={resolveRuntimeHttpBaseUrl(unavailableWorkspaceUrl)}
                onSelect={(workspaceId) => {
                  const url = new URL(window.location.href);
                  url.searchParams.set("workspaceId", workspaceId);
                  window.location.assign(url.toString());
                }}
              />
            </Suspense>
          ) : (
            <LazyAuthenticatedSurface
              authentication={resolvedAuthentication}
              surface={surface}
              settingsSection={settingsSection}
              socketReconnectPolicy={socketReconnectPolicy}
              onLogout={
                resolvedAuthentication.state === AuthenticationSessionStates.Authenticated &&
                resolvedAuthentication.method !== "local"
                  ? authentication.logout
                  : undefined
              }
            />
          )
        }
      </LazyServerAuthenticationBoundary>
    </Suspense>
  );

  return (
    <ServerAuthenticationContext.Provider value={authentication}>
      <FrontendI18nProvider>
        {isDesktop ? (
          <Suspense fallback={authenticatedContent}>
            <LazyDesktopWindowChrome surface={surface}>{authenticatedContent}</LazyDesktopWindowChrome>
          </Suspense>
        ) : (
          authenticatedContent
        )}
      </FrontendI18nProvider>
    </ServerAuthenticationContext.Provider>
  );
}
