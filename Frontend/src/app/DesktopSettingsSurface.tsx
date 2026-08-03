import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Toaster } from "sonner";
import { useAgentSocket, type AgentSocketReconnectPolicy, type SocketStatus } from "../api/useAgentSocket";
import type { WsRequest } from "../api/eventTypes";
import { buildSettingsSurfaceSyncRequests } from "./settingsSurfaceSync";
import { readDesktopBridge } from "./desktopBridge";
import { useSettingsRuntime } from "./useSettingsRuntime";
import { SettingsWorkbench } from "../features/settings";
import { DiscardDraftDialog } from "../features/settings/DiscardDraftDialog";
import type { SettingsSectionId } from "../features/settings/settingsSectionContract";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import { TooltipProvider } from "../shared/ui";
import { useStore } from "../store/sessionStore";
import { resolveRuntimeWebSocketUrl } from "../config/runtimeConfig";

const WS_URL = resolveRuntimeWebSocketUrl(__SENERA_DEFAULT_WS_URL__);

export function DesktopSettingsSurface({
  initialSection,
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
  socketReconnectPolicy,
}: {
  initialSection: SettingsSectionId;
  values: ComponentProps<typeof SettingsWorkbench>["values"];
  motionLevel: ComponentProps<typeof SettingsWorkbench>["motionLevel"];
  onValueChange: ComponentProps<typeof SettingsWorkbench>["onValueChange"];
  onMotionLevelChange: ComponentProps<typeof SettingsWorkbench>["onMotionLevelChange"];
  socketReconnectPolicy: AgentSocketReconnectPolicy;
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
    reconnectPolicy: socketReconnectPolicy,
    onEvent: (env) => {
      ingest(env);
      settingsEventHandlerRef.current(env);
    },
  });
  sendRef.current = send;
  statusRef.current = status;
  const runtime = useSettingsRuntime({ sendRef, statusRef });
  settingsEventHandlerRef.current = runtime.ingestSettingsEvent;
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
        systemConfig={runtime.systemConfig}
      />
      <DiscardDraftDialog
        open={closeConfirmationOpen}
        title={frontendMessage("settings.discard.title")}
        description={frontendMessage("settings.discard.closeDescription")}
        consequence={frontendMessage("settings.discard.savedUnaffected")}
        continueLabel={frontendMessage("settings.discard.continue")}
        confirmLabel={frontendMessage("settings.discard.closeConfirm")}
        onOpenChange={(open) => {
          setCloseConfirmationOpen(open);
          if (!open) void bridge?.cancelSettingsClose?.();
        }}
        onDiscard={() => {
          setCloseConfirmationOpen(false);
          setPendingChanges(false);
          void bridge?.confirmSettingsClose?.();
        }}
      />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "!font-sans !text-[13px] !bg-paper-50 !text-ink-900 !border !border-ink-200 !shadow-soft",
        }}
      />
    </TooltipProvider>
  );
}
