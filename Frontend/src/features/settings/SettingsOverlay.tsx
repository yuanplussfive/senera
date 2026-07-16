import { useEffect } from "react";
import { X } from "lucide-react";
import type { SocketStatus } from "../../api/useAgentSocket";
import type { WsRequest } from "../../api/eventTypes";
import { buildSettingsSurfaceSyncRequests } from "../../app/settingsSurfaceSync";
import type { WebSettingsController } from "../../app/useWebSettingsController";
import { Dialog, DialogActionButton, DialogActions, DialogContent, IconButton } from "../../shared/ui";
import { SettingsWorkbench, type SettingsWorkbenchProps } from "./SettingsWorkbench";

export function SettingsOverlay({
  controller,
  send,
  status,
  workbench,
}: {
  controller: WebSettingsController;
  send: (request: WsRequest) => boolean;
  status: SocketStatus;
  workbench: Omit<SettingsWorkbenchProps, "section" | "onSectionChange" | "onPendingChangesChange" | "shellActions">;
}): JSX.Element {
  const { section } = controller;

  useEffect(() => {
    if (!section || status !== "open") return;
    for (const request of buildSettingsSurfaceSyncRequests()) send(request);
  }, [section, send, status]);

  return (
    <>
      <Dialog
        open={section !== null}
        onOpenChange={(open) => {
          if (!open) controller.requestClose();
        }}
      >
        {section ? (
          <DialogContent
            title="Senera 设置"
            description="管理模型、能力、个人偏好和系统配置。"
            showHeader={false}
            showClose={false}
            className="h-[min(900px,calc(100dvh-48px))] max-h-[calc(100dvh-48px)] w-[min(1440px,calc(100vw-64px))] max-w-none overflow-hidden p-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:rounded-none max-sm:border-0"
            bodyClassName="min-h-0 flex-1 overflow-hidden"
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              controller.requestClose();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              controller.returnFocusRef.current?.focus({ preventScroll: true });
            }}
          >
            <SettingsWorkbench
              {...workbench}
              section={section}
              onSectionChange={controller.changeSection}
              onPendingChangesChange={controller.setPendingChanges}
              shellActions={
                <IconButton
                  label="关闭设置"
                  tooltip="关闭设置"
                  size="sm"
                  tone="muted"
                  onClick={controller.requestClose}
                >
                  <X className="h-4 w-4" />
                </IconButton>
              }
            />
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={controller.closeConfirmationOpen} onOpenChange={(open) => !open && controller.cancelClose()}>
        <DialogContent title="放弃未保存的更改？" description="关闭设置会丢失尚未保存或确认的修改。">
          <DialogActions>
            <DialogActionButton close onClick={controller.cancelClose}>
              继续编辑
            </DialogActionButton>
            <DialogActionButton variant="danger" onClick={controller.confirmClose}>
              放弃更改
            </DialogActionButton>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </>
  );
}
