import { lazy, Suspense } from "react";
import type { ServerAuthorizedAuthentication } from "../api/authClient";
import type { AgentSocketReconnectPolicy } from "../api/useAgentSocket";
import type { AppSurface } from "./appSurface";
import type { SettingsSectionId } from "../features/settings/settingsSectionContract";
import { AppMotionProvider } from "../shared/motion";
import { AppAppearanceProvider } from "../shared/theme";
import { useStore } from "../store/sessionStore";
import { loadDesktopSettingsSurfaceComponent, loadMainApplicationComponent } from "./applicationModuleLoaders";
import { ApplicationSurfaceLoading, SettingsSurfaceLoading } from "./SurfaceLoading";

const LazyMainApplication = lazy(loadMainApplicationComponent);
const LazyDesktopSettingsSurface = lazy(loadDesktopSettingsSurfaceComponent);

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
  const motionLevel = useStore((state) => state.motionLevel);
  const defaultSidebarCollapsed = useStore((state) => state.defaultSidebarCollapsed);
  const defaultRightPanelCollapsed = useStore((state) => state.defaultRightPanelCollapsed);
  const setDefaultSidebarCollapsed = useStore((state) => state.setDefaultSidebarCollapsed);
  const setDefaultRightPanelCollapsed = useStore((state) => state.setDefaultRightPanelCollapsed);
  const setMotionLevel = useStore((state) => state.setMotionLevel);

  return (
    <AppMotionProvider level={motionLevel}>
      <AppAppearanceProvider motionLevel={motionLevel}>
        {surface === "settings" ? (
          <Suspense fallback={<SettingsSurfaceLoading presentation="desktop" />}>
            <LazyDesktopSettingsSurface
              initialSection={settingsSection}
              values={{ defaultSidebarCollapsed, defaultRightPanelCollapsed }}
              motionLevel={motionLevel}
              onValueChange={(id, value) => {
                if (id === "defaultSidebarCollapsed") setDefaultSidebarCollapsed(value);
                if (id === "defaultRightPanelCollapsed") setDefaultRightPanelCollapsed(value);
              }}
              onMotionLevelChange={setMotionLevel}
              socketReconnectPolicy={socketReconnectPolicy}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<ApplicationSurfaceLoading />}>
            <LazyMainApplication
              onLogout={onLogout}
              uploadCsrfToken={authentication.state === "authenticated" ? authentication.csrfToken : undefined}
              socketReconnectPolicy={socketReconnectPolicy}
            />
          </Suspense>
        )}
      </AppAppearanceProvider>
    </AppMotionProvider>
  );
}
