import { lazy, Suspense, useMemo } from "react";
import type { ServerAuthorizedAuthentication } from "../api/authClient";
import type { AgentSocketReconnectPolicy } from "../api/useAgentSocket";
import type { AppSurface } from "./appSurface";
import type { SettingsSectionId } from "../features/settings/settingsSectionContract";
import { loadDesktopSettingsSurfaceComponent, loadMainApplicationComponent } from "./applicationModuleLoaders";
import { ApplicationSurfaceLoading, SettingsSurfaceLoading } from "./SurfaceLoading";

export function AuthenticatedSurface({
  authentication,
  surface,
  settingsSection,
  socketReconnectPolicy,
  onLogout,
}: {
  authentication: ServerAuthorizedAuthentication;
  surface: AppSurface;
  settingsSection: SettingsSectionId;
  socketReconnectPolicy: AgentSocketReconnectPolicy;
  onLogout?: () => Promise<void>;
}): JSX.Element {
  // The parent error boundary remounts this surface after a chunk failure. Recreate
  // the lazy wrapper for that mount so the recoverable loader can issue a fresh import.
  const LazyMainApplication = useMemo(() => lazy(loadMainApplicationComponent), []);
  const LazyDesktopSettingsSurface = useMemo(() => lazy(loadDesktopSettingsSurfaceComponent), []);

  return surface === "settings" ? (
    <Suspense fallback={<SettingsSurfaceLoading presentation="desktop" />}>
      <LazyDesktopSettingsSurface initialSection={settingsSection} socketReconnectPolicy={socketReconnectPolicy} />
    </Suspense>
  ) : (
    <Suspense fallback={<ApplicationSurfaceLoading />}>
      <LazyMainApplication
        onLogout={onLogout}
        uploadCsrfToken={authentication.state === "authenticated" ? authentication.csrfToken : undefined}
        socketReconnectPolicy={socketReconnectPolicy}
      />
    </Suspense>
  );
}
