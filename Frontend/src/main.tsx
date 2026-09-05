import { lazy, StrictMode, Suspense, useCallback, useState } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { resolveAppSurface, resolveSettingsSection } from "./app/appSurface";
import { readDesktopBridge } from "./app/desktopBridge";
import { useServerAuthentication } from "./app/useServerAuthentication";
import type { AgentSocketReconnectPolicy } from "./api/useAgentSocket";
import { AuthenticationSessionStates } from "./api/generatedEventCatalog";
import { resolveRuntimeHttpBaseUrl, resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";
import { FrontendI18nProvider, useFrontendLocale } from "./i18n/useFrontendLocale";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { AuthenticatedSurface } from "./app/AuthenticatedSurface";
import { useAuthenticatedApplicationPreload } from "./app/useAuthenticatedApplicationPreload";
import { installViteDynamicImportRecovery } from "./app/viteDynamicImportRecovery";
import "./styles/fonts.css";
import "./index.css";
import "./styles/transitions.css";

const LazyDesktopWindowChrome = lazy(() =>
  import("./app/DesktopWindowChrome").then(({ DesktopWindowChrome }) => ({ default: DesktopWindowChrome })),
);
const LazyServerAuthenticationBoundary = lazy(() =>
  import("./app/ServerAuthenticationGate").then(({ ServerAuthenticationBoundary }) => ({
    default: ServerAuthenticationBoundary,
  })),
);
const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
const HTTP_BASE_URL = resolveRuntimeHttpBaseUrl(WS_URL);
const root = document.getElementById("root");

if (import.meta.env.DEV) {
  void import("./dev/motionDevTools").then(({ installMotionDevTools }) => installMotionDevTools());
}
if (!root) throw new Error("#root not found in index.html");
installViteDynamicImportRecovery();

// Vite can re-evaluate this entry module during development HMR. Reusing the
// root prevents a second React tree from competing with the first one and
// avoids removeChild errors and visible settings flashes after updates.
const rootElement = root as HTMLElement & { __seneraReactRoot?: ReactRoot };
const appRoot = rootElement.__seneraReactRoot ?? createRoot(rootElement);
rootElement.__seneraReactRoot = appRoot;

appRoot.render(
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
    <Suspense fallback={<AuthenticationBoundaryLoading />}>
      <LazyServerAuthenticationBoundary
        state={authentication.state}
        onLogin={authentication.login}
        onRetry={authentication.refresh}
      >
        {(resolvedAuthentication) => (
          <AuthenticatedSurface
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
        )}
      </LazyServerAuthenticationBoundary>
    </Suspense>
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

function AuthenticationBoundaryLoading(): JSX.Element {
  return <main className="min-h-screen bg-paper-100" aria-busy="true" />;
}
