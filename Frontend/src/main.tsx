import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App";
import { resolveAppSurface, resolveSettingsSection } from "./app/appSurface";
import { readDesktopBridge } from "./app/desktopBridge";
import { DesktopWindowChrome } from "./app/DesktopWindowChrome";
import { buildSettingsSurfaceSyncRequests } from "./app/settingsSurfaceSync";
import { useSettingsRuntime } from "./app/useSettingsRuntime";
import { useAgentSocket, type SocketStatus } from "./api/useAgentSocket";
import type { WsRequest } from "./api/eventTypes";
import { resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";
import { installMotionDevTools } from "./dev/motionDevTools";
import { SettingsWorkbench } from "./features/settings";
import type { SettingsSectionId } from "./features/settings/types";
import { AppMotionProvider } from "./shared/motion";
import { AppAppearanceProvider } from "./shared/theme";
import { Dialog, DialogActionButton, DialogActions, DialogContent, TooltipProvider } from "./shared/ui";
import { useStore } from "./store/sessionStore";
import "./index.css";
import "./styles/transitions.css";
import "./styles/react-flow.css";
import "./styles/markdown.css";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
const root = document.getElementById("root");

if (import.meta.env.DEV) installMotionDevTools();
if (!root) throw new Error("#root not found in index.html");

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

function Root(): JSX.Element {
  const motionLevel = useStore((state) => state.motionLevel);
  const defaultSidebarCollapsed = useStore((state) => state.defaultSidebarCollapsed);
  const defaultRightPanelCollapsed = useStore((state) => state.defaultRightPanelCollapsed);
  const setDefaultSidebarCollapsed = useStore((state) => state.setDefaultSidebarCollapsed);
  const setDefaultRightPanelCollapsed = useStore((state) => state.setDefaultRightPanelCollapsed);
  const setMotionLevel = useStore((state) => state.setMotionLevel);
  const isDesktop = Boolean(readDesktopBridge()?.isDesktop);
  const surface = resolveAppSurface(window.location, isDesktop);
  const settingsSection = resolveSettingsSection(window.location);

  return (
    <AppMotionProvider level={motionLevel}>
      <AppAppearanceProvider motionLevel={motionLevel}>
        <DesktopWindowChrome surface={surface}>
          {surface === "settings" ? (
            <DesktopSettingsSurface
              initialSection={settingsSection}
              values={{ defaultSidebarCollapsed, defaultRightPanelCollapsed }}
              motionLevel={motionLevel}
              onValueChange={(id, value) => {
                if (id === "defaultSidebarCollapsed") setDefaultSidebarCollapsed(value);
                if (id === "defaultRightPanelCollapsed") setDefaultRightPanelCollapsed(value);
              }}
              onMotionLevelChange={setMotionLevel}
            />
          ) : (
            <App />
          )}
        </DesktopWindowChrome>
      </AppAppearanceProvider>
    </AppMotionProvider>
  );
}

function DesktopSettingsSurface({
  initialSection,
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
}: {
  initialSection: SettingsSectionId;
  values: React.ComponentProps<typeof SettingsWorkbench>["values"];
  motionLevel: React.ComponentProps<typeof SettingsWorkbench>["motionLevel"];
  onValueChange: React.ComponentProps<typeof SettingsWorkbench>["onValueChange"];
  onMotionLevelChange: React.ComponentProps<typeof SettingsWorkbench>["onMotionLevelChange"];
}): JSX.Element {
  const [section, setSection] = useState(initialSection);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [closeConfirmationOpen, setCloseConfirmationOpen] = useState(false);
  const ingest = useStore((state) => state.ingest);
  const sendRef = useRef<((request: WsRequest) => boolean) | null>(null);
  const statusRef = useRef<SocketStatus>("idle");
  const settingsEventHandlerRef = useRef<(env: Parameters<typeof ingest>[0]) => boolean>(() => false);
  const { status, send } = useAgentSocket({
    url: WS_URL,
    onEvent: (env) => {
      ingest(env);
      settingsEventHandlerRef.current(env);
    },
  });
  sendRef.current = send;
  statusRef.current = status;
  const runtime = useSettingsRuntime({ sendRef, statusRef });
  settingsEventHandlerRef.current = runtime.controller.ingestConfigMutationEvent;
  const bridge = readDesktopBridge();

  useEffect(() => {
    if (status !== "open") return;
    for (const request of buildSettingsSurfaceSyncRequests()) send(request);
  }, [send, status]);

  useEffect(() => {
    void bridge?.setSettingsDirty?.(pendingChanges);
  }, [bridge, pendingChanges]);

  useEffect(() => {
    return bridge?.onSettingsCloseRequested?.(() => setCloseConfirmationOpen(true));
  }, [bridge]);

  const changeSection = (nextSection: SettingsSectionId): void => {
    const search = new URLSearchParams(window.location.search);
    search.set("surface", "settings");
    search.set("section", nextSection);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search.toString()}`);
    setSection(nextSection);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <SettingsWorkbench
        section={section}
        onSectionChange={changeSection}
        onPendingChangesChange={setPendingChanges}
        environment={{
          appVersion: __SENERA_APP_VERSION__,
          frontendVersion: __SENERA_FRONTEND_VERSION__,
          mode: import.meta.env.MODE,
          surface: "desktop",
        }}
        values={values}
        motionLevel={motionLevel}
        onValueChange={onValueChange}
        onMotionLevelChange={onMotionLevelChange}
        pluginSettings={runtime.pluginSettings}
        systemConfig={runtime.systemConfig}
      />
      <Dialog open={closeConfirmationOpen} onOpenChange={setCloseConfirmationOpen}>
        <DialogContent title="放弃未保存的更改？" description="关闭设置窗口会丢失尚未保存或确认的修改。">
          <DialogActions>
            <DialogActionButton close>继续编辑</DialogActionButton>
            <DialogActionButton
              variant="danger"
              onClick={() => {
                setCloseConfirmationOpen(false);
                setPendingChanges(false);
                void bridge?.confirmSettingsClose?.();
              }}
            >
              放弃更改
            </DialogActionButton>
          </DialogActions>
        </DialogContent>
      </Dialog>
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "!font-sans !text-[13px] !bg-paper-50 !text-ink-900 !border !border-ink-200 !shadow-soft",
        }}
      />
    </TooltipProvider>
  );
}
