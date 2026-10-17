import { lazy, Suspense } from "react";
import type { AgentSocketReconnectPolicy } from "../api/useAgentSocket";
import type { SettingsSectionId } from "../features/settings/settingsSectionContract";
import { SettingsSurfaceLoading } from "./SurfaceLoading";

const LazyDesktopSettingsRuntimeSurface = lazy(() =>
  import("./DesktopSettingsRuntimeSurface").then(({ DesktopSettingsRuntimeSurface }) => ({
    default: DesktopSettingsRuntimeSurface,
  })),
);

export function DesktopSettingsSurface({
  initialSection,
  socketReconnectPolicy,
}: {
  initialSection: SettingsSectionId;
  socketReconnectPolicy: AgentSocketReconnectPolicy;
}): JSX.Element {
  return (
    <Suspense fallback={<SettingsSurfaceLoading presentation="desktop" />}>
      <LazyDesktopSettingsRuntimeSurface
        initialSection={initialSection}
        socketReconnectPolicy={socketReconnectPolicy}
      />
    </Suspense>
  );
}
