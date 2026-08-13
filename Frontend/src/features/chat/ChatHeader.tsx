import {
  Ban,
  CircleAlert,
  Clock3,
  LoaderCircle,
  ListTree,
  MessageSquareText,
  PanelLeftOpen,
  Shield,
  ShieldAlert,
  SquareTerminal,
} from "lucide-react";
import type { SandboxStatusSnapshotData } from "../../api/eventTypes";
import {
  executionModeLabel,
  sandboxStatusAvailabilitySuffix,
  sandboxStatusDetail,
} from "../sandbox/sandboxPreparationPresentation";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { IconButton, Tooltip } from "../../shared/ui";
import { ToolDock } from "./ToolDock";

export function ChatHeader({
  title,
  runStatus,
  waitingForApproval = false,
  waitingForInput = false,
  sandboxStatus,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
}: {
  title: string;
  runStatus?: "running" | "cancelling" | "completed" | "failed" | "cancelled";
  waitingForApproval?: boolean;
  waitingForInput?: boolean;
  sandboxStatus?: SandboxStatusSnapshotData | null;
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
        <SandboxStatusBadge status={sandboxStatus} />
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
          <LoaderCircle className="h-3 w-3 animate-spin motion-reduce:animate-none" />
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

function SandboxStatusBadge({ status }: { status?: SandboxStatusSnapshotData | null }): JSX.Element {
  const presentation = readSandboxStatusPresentation(status);
  const StatusIcon = presentation.Icon;
  const expanded =
    !status || status.state === "preparing" || (status.effectiveMode !== "host" && status.effectiveMode !== "sandbox");

  return (
    <Tooltip
      content={
        <span className="max-w-[260px] whitespace-normal leading-5">
          <span className="block font-medium">{presentation.label}</span>
          <span className="mt-0.5 block text-ink-300">{presentation.tooltip}</span>
        </span>
      }
      side="bottom"
      align="start"
      delayDuration={150}
    >
      <span
        role="status"
        tabIndex={0}
        aria-label={presentation.label}
        data-sandbox-status={status?.state ?? "unknown"}
        data-execution-mode={status?.effectiveMode ?? "unknown"}
        data-window-no-drag
        className={cn(
          "inline-flex h-6 min-w-0 shrink-0 items-center justify-center rounded-md text-[10.5px] font-medium transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          expanded
            ? "gap-1.5 border border-line-subtle bg-surface-muted px-1.5 text-content-secondary hover:border-line hover:text-content-strong"
            : "w-6 text-content-muted hover:bg-surface-hover hover:text-content-primary",
        )}
      >
        <StatusIcon className={`h-3.5 w-3.5 ${presentation.iconClassName ?? ""}`} aria-hidden="true" />
        {expanded ? <span className="max-w-[180px] truncate">{presentation.label}</span> : null}
      </span>
    </Tooltip>
  );
}

function readSandboxStatusPresentation(status?: SandboxStatusSnapshotData | null): {
  label: string;
  tooltip: string;
  Icon: typeof Shield;
  iconClassName?: string;
} {
  const detail = sandboxStatusDetail(status);
  const availabilitySuffix = sandboxStatusAvailabilitySuffix(status);
  const commonTooltip = `${detail} ${availabilitySuffix}`;
  const label = executionModeLabel(status);

  if (!status) {
    return { label, tooltip: commonTooltip, Icon: LoaderCircle, iconClassName: "text-content-muted" };
  }

  if (status.effectiveMode === "host") {
    return { label, tooltip: commonTooltip, Icon: SquareTerminal };
  }

  if (status.state === "preparing") {
    return {
      label,
      tooltip: commonTooltip,
      Icon: LoaderCircle,
      iconClassName: "text-umber-600 motion-safe:animate-spin",
    };
  }

  if (status.effectiveMode === "sandbox") {
    return { label, tooltip: commonTooltip, Icon: Shield };
  }

  return { label, tooltip: commonTooltip, Icon: ShieldAlert, iconClassName: "text-brick-600" };
}
