import { lazy, Suspense } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { WebSettingsController } from "../../app/useWebSettingsController";
import { AppIcon, Dialog, DialogContent, IconButton, StateView } from "../../shared/ui";
import { DiscardDraftDialog } from "./DiscardDraftDialog";
import type { SettingsWorkbenchProps } from "./SettingsWorkbenchContracts";

const LazySettingsWorkbench = lazy(() =>
  import("./SettingsWorkbench").then((module) => ({ default: module.SettingsWorkbench })),
);

export function SettingsOverlay({
  controller,
  workbench,
}: {
  controller: WebSettingsController;
  workbench: Omit<SettingsWorkbenchProps, "section" | "onSectionChange" | "onPendingChangesChange" | "shellActions">;
}): JSX.Element {
  const { section } = controller;

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
            title={frontendMessage("settings.overlay.title")}
            description={frontendMessage("settings.overlay.description")}
            showHeader={false}
            showClose={false}
            contentInitial={false}
            className="h-[min(660px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] w-[min(1080px,calc(100vw-32px))] max-w-none overflow-hidden p-0 shadow-[var(--theme-overlay-shadow)] max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:rounded-none max-sm:border-0"
            bodyClassName="min-h-0 flex-1 overflow-hidden"
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              document.querySelector<HTMLElement>("[data-settings-workbench]")?.focus({ preventScroll: true });
            }}
            onEscapeKeyDown={(event) => {
              event.preventDefault();
              controller.requestClose();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              controller.returnFocusRef.current?.focus({ preventScroll: true });
            }}
          >
            <Suspense fallback={<StateView status="loading" className="h-full" />}>
              <LazySettingsWorkbench
                {...workbench}
                section={section}
                onSectionChange={controller.changeSection}
                onPendingChangesChange={controller.setPendingChanges}
                shellActions={
                  <IconButton
                    label={frontendMessage("settings.overlay.close")}
                    size="sm"
                    tone="muted"
                    onClick={controller.requestClose}
                  >
                    <AppIcon icon="close" size={16} aria-hidden="true" />
                  </IconButton>
                }
              />
            </Suspense>
          </DialogContent>
        ) : null}
      </Dialog>

      <DiscardDraftDialog
        open={controller.closeConfirmationOpen}
        title={frontendMessage("settings.discard.title")}
        description={frontendMessage("settings.discard.closeDescription")}
        consequence={frontendMessage("settings.discard.savedUnaffected")}
        continueLabel={frontendMessage("settings.discard.continue")}
        confirmLabel={frontendMessage("settings.discard.closeConfirm")}
        onOpenChange={(open) => !open && controller.cancelClose()}
        onDiscard={controller.confirmClose}
      />
    </>
  );
}
