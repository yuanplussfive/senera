import { useLayoutEffect, useRef } from "react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { ActivityStatusIcon, AppIcon, ExecutionStatusTones, IconButton } from "../../shared/ui";
import { readWindowControlsOverlapWidth } from "../../shared/responsive";
import { ToolDock } from "./ToolDock";

export function ChatHeader({
  title,
  runStatus,
  waitingForApproval = false,
  waitingForInput = false,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
}: {
  title: string;
  runStatus?: "running" | "cancelling" | "completed" | "failed" | "cancelled";
  waitingForApproval?: boolean;
  waitingForInput?: boolean;
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
      className="chat-header-shell relative z-10 flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-2 border-b border-line-subtle bg-transparent"
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
      {waitingForApproval ? (
        <span
          className="ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] text-umber-600"
          data-chat-run-status="waiting-approval"
          data-window-no-drag
        >
          <AppIcon icon="clock" size={12} />
          {frontendMessage("approval.waiting")}
        </span>
      ) : waitingForInput ? (
        <span
          className="ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] text-accent-content"
          data-chat-run-status="waiting-input"
          data-window-no-drag
        >
          <AppIcon icon="message-square" size={12} />
          {frontendMessage("interaction.input.pending")}
        </span>
      ) : runStatus === "running" ? (
        <span
          className={cn(
            "ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px]",
            ExecutionStatusTones.running.text,
          )}
          data-chat-run-status="running"
          data-window-no-drag
        >
          <ActivityStatusIcon status="running" motion="spin" size={13} />
          {frontendMessage("workflow.run.status.running")}
        </span>
      ) : runStatus === "cancelling" ? (
        <span
          className={cn(
            "ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px]",
            ExecutionStatusTones.cancelling.text,
          )}
          data-chat-run-status="cancelling"
          data-window-no-drag
        >
          <ActivityStatusIcon status="cancelling" motion="spin" size={13} />
          {frontendMessage("workflow.run.status.cancelling")}
        </span>
      ) : runStatus === "failed" ? (
        <span
          className={cn(
            "ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px]",
            ExecutionStatusTones.failed.text,
          )}
          data-chat-run-status="failed"
          data-window-no-drag
        >
          <AppIcon icon="alert-circle" size={12} />
          {frontendMessage("workflow.run.status.failed")}
        </span>
      ) : runStatus === "cancelled" ? (
        <span
          className="ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] text-content-secondary"
          data-chat-run-status="cancelled"
          data-window-no-drag
        >
          <AppIcon icon="ban" size={12} />
          {frontendMessage("workflow.run.status.cancelled")}
        </span>
      ) : null}
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
