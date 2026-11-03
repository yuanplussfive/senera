import { useLayoutEffect, useRef } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { AppIcon, IconButton } from "../../shared/ui";
import { readWindowControlsOverlapWidth } from "../../shared/responsive";
import { ToolDock } from "./ToolDock";

/**
 * The title bar carries the conversation's name and nothing else: run status is
 * announced by the thinking summary and the approval dock in the message
 * stream, and the execution boundary now lives in the composer's context chip.
 * What remains besides the title is window chrome — a drag surface plus the
 * panel and status affordances that have no other home.
 */
export function ChatHeader({
  title,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
}: {
  title: string;
  onOpenSessionPanel?: () => void;
  onOpenWorkflowPanel?: () => void;
}): JSX.Element {
  const headerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const view = header?.ownerDocument.defaultView;
    if (!header || !view) return;

    const root = header.ownerDocument.documentElement;
    const readCssPixelValue = (name: string): number => {
      const value = Number.parseFloat(view.getComputedStyle(root).getPropertyValue(name));
      return Number.isFinite(value) ? value : 0;
    };
    const syncWindowControlsInset = (): void => {
      const controls = header.ownerDocument.querySelector<HTMLElement>("[data-desktop-window-controls]");
      const inset = readWindowControlsOverlapWidth({
        containerRect: header.getBoundingClientRect(),
        controlsRect: controls?.getBoundingClientRect(),
        gap: readCssPixelValue("--senera-window-controls-gap"),
      });
      header.style.setProperty("--chat-header-window-controls-inset", `${inset}px`);
    };

    syncWindowControlsInset();
    view.addEventListener("resize", syncWindowControlsInset);
    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(syncWindowControlsInset) : undefined;
    resizeObserver?.observe(header);
    const controls = header.ownerDocument.querySelector<HTMLElement>("[data-desktop-window-controls]");
    if (controls) resizeObserver?.observe(controls);

    return () => {
      view.removeEventListener("resize", syncWindowControlsInset);
      resizeObserver?.disconnect();
      header.style.removeProperty("--chat-header-window-controls-inset");
    };
  }, []);

  return (
    <div
      ref={headerRef}
      className="chat-header-shell relative z-10 flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-2 bg-transparent"
      data-ui-chrome
      data-chat-header
      data-testid="chat-header"
      data-window-drag-region
    >
      {onOpenSessionPanel ? (
        <IconButton
          label={frontendMessage("session.headerExpand")}
          tooltip={frontendMessage("session.headerExpand")}
          tooltipSide="bottom"
          onClick={onOpenSessionPanel}
          touchSafe
        >
          <AppIcon icon="panel-left-open" size={16} />
        </IconButton>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5" data-chat-header-title>
        <h1 className="min-w-0 truncate text-[14.5px] font-semibold text-content-strong">{title}</h1>
      </div>
      {onOpenWorkflowPanel ? (
        <ToolDock
          items={[
            {
              id: "workflow",
              label: frontendMessage("workflow.panel.expand"),
              icon: <AppIcon icon="list-tree" size={16} />,
              onSelect: onOpenWorkflowPanel,
            },
          ]}
        />
      ) : null}
    </div>
  );
}
