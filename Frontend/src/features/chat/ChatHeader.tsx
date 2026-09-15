import { Ban, CircleAlert, Clock3, ListTree, MessageSquareText, PanelLeftOpen } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { IconButton, Spinner } from "../../shared/ui";
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
  return (
    <div
      className="relative z-10 flex h-[52px] shrink-0 items-center gap-2 border-b border-line-subtle bg-transparent px-3 sm:px-5"
      data-ui-chrome
      data-window-drag-region
      data-window-controls-inset
    >
      {onOpenSessionPanel ? (
        <IconButton
          label={frontendMessage("session.headerExpand")}
          tooltip={frontendMessage("session.headerExpand")}
          tooltipSide="bottom"
          onClick={onOpenSessionPanel}
          touchSafe
        >
          <PanelLeftOpen className="h-4 w-4" />
        </IconButton>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5" data-chat-header-title>
        <h1 className="min-w-0 truncate text-[14.5px] font-semibold text-content-strong">{title}</h1>
      </div>
      {waitingForApproval ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-umber-200 bg-umber-50 px-2 py-0.5 font-mono text-[10px] text-umber-600">
          <Clock3 className="h-3 w-3" />
          {frontendMessage("approval.waiting")}
        </span>
      ) : waitingForInput ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-surface px-2 py-0.5 font-mono text-[10px] text-accent-content">
          <MessageSquareText className="h-3 w-3" />
          {frontendMessage("interaction.input.pending")}
        </span>
      ) : runStatus === "cancelling" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-umber-200 bg-umber-50 px-2 py-0.5 font-mono text-[10px] text-umber-700">
          <Spinner size="xs" />
          {frontendMessage("workflow.run.status.cancelling")}
        </span>
      ) : runStatus === "failed" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-brick-200 bg-brick-50 px-2 py-0.5 font-mono text-[10px] text-brick-700">
          <CircleAlert className="h-3 w-3" />
          {frontendMessage("workflow.run.status.failed")}
        </span>
      ) : runStatus === "cancelled" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-line bg-surface-muted px-2 py-0.5 font-mono text-[10px] text-content-secondary">
          <Ban className="h-3 w-3" />
          {frontendMessage("workflow.run.status.cancelled")}
        </span>
      ) : null}
      {onOpenWorkflowPanel ? (
        <ToolDock
          items={[
            {
              id: "workflow",
              label: frontendMessage("workflow.panel.expand"),
              icon: <ListTree className="h-4 w-4" />,
              onSelect: onOpenWorkflowPanel,
            },
          ]}
        />
      ) : null}
    </div>
  );
}
