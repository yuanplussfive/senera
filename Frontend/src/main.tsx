import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App";
import { resolveAppSurface, resolveSettingsSection } from "./app/appSurface";
import { buildSettingsSurfaceSyncRequests } from "./app/settingsSurfaceSync";
import { useConfigMutationController } from "./app/useConfigMutationController";
import { usePluginSettingsCommands } from "./app/usePluginSettingsCommands";
import { useAgentSocket, type SocketStatus } from "./api/useAgentSocket";
import type { WsRequest } from "./api/eventTypes";
import type { SettingsSystemConfigHandle } from "./features/settings/SettingsContracts";
import { resolveRuntimeWebSocketUrl } from "./config/runtimeConfig";
import { installMotionDevTools } from "./dev/motionDevTools";
import { SettingsWorkbench } from "./features/settings";
import { AppMotionProvider } from "./shared/motion";
import { AppAppearanceProvider } from "./shared/theme";
import { TooltipProvider } from "./shared/ui";
import { useStore } from "./store/sessionStore";
import "./index.css";
import "./styles/transitions.css";
import "./styles/react-flow.css";
import "./styles/markdown.css";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);
const root = document.getElementById("root");

if (import.meta.env.DEV) {
  installMotionDevTools();
}

if (!root) {
  throw new Error("#root not found in index.html");
}

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
  const surface = resolveAppSurface(window.location);
  const settingsSection = resolveSettingsSection(window.location);
  return (
    <AppMotionProvider level={motionLevel}>
      <AppAppearanceProvider motionLevel={motionLevel}>
        {surface === "settings" ? (
          <SettingsSurface
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
      </AppAppearanceProvider>
    </AppMotionProvider>
  );
}

type SettingsSurfaceProps = React.ComponentProps<typeof SettingsWorkbench>;

function SettingsSurface(props: SettingsSurfaceProps): JSX.Element {
  const ingest = useStore((state) => state.ingest);
  const configSnapshot = useStore((state) => state.configSnapshot);
  const providerModelCatalogs = useStore((state) => state.providerModelCatalogs);
  const providerModelErrors = useStore((state) => state.providerModelErrors);
  const sendRef = useRef<((request: WsRequest) => boolean) | null>(null);
  const statusRef = useRef<SocketStatus>("idle");
  const configSettingsEventHandlerRef = useRef<ReturnType<typeof useConfigMutationController>["ingestConfigMutationEvent"]>(
    () => false,
  );
  const pluginSettingsEventHandlerRef = useRef<ReturnType<typeof usePluginSettingsCommands>["handlePluginSettingsEvent"]>(
    () => false,
  );
  const { status, send } = useAgentSocket({
    url: WS_URL,
    onEvent: (env) => {
      ingest(env);
      void configSettingsEventHandlerRef.current(env);
      void pluginSettingsEventHandlerRef.current(env);
    },
  });

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const configMutations = useConfigMutationController({
    configSnapshot,
    sendRef,
    statusRef,
  });
  configSettingsEventHandlerRef.current = configMutations.ingestConfigMutationEvent;
  const pluginSettings = usePluginSettingsCommands({
    send,
    status,
  });
  pluginSettingsEventHandlerRef.current = pluginSettings.handlePluginSettingsEvent;

  const systemConfig: SettingsSystemConfigHandle = {
    ...configMutations,
    configSnapshot,
    providerModelCatalogs,
    providerModelErrors,
  };

  useEffect(() => {
    if (status !== "open") return;
    for (const request of buildSettingsSurfaceSyncRequests()) {
      send(request);
    }
  }, [send, status]);

  return (
    <TooltipProvider delayDuration={300}>
      <SettingsWorkbench
        {...props}
        pluginSettings={pluginSettings}
        systemConfig={systemConfig}
      />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className:
            "!font-sans !text-[13px] !bg-paper-50 !text-ink-900 !border !border-ink-200 !shadow-soft",
        }}
      />
    </TooltipProvider>
  );
}
