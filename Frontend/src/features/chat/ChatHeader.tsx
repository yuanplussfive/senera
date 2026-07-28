import {
  Ban,
  Box,
  CircleAlert,
  Clock3,
  ListTree,
  MessageSquareText,
  PanelLeftOpen,
} from "lucide-react";
import type { SandboxRuntimeState, SandboxStatusSnapshotData } from "../../api/eventTypes";
import { sandboxStatusAvailabilitySuffix, sandboxStatusDetail } from "../sandbox/sandboxPreparationPresentation";
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
  runStatus?: "running" | "completed" | "failed" | "cancelled";
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
      <h1 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-content-strong">{title}</h1>
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
      <SandboxStatusBadge status={sandboxStatus} />
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

  return (
    <Tooltip
      content={
        <span className="max-w-[260px] whitespace-normal leading-5">
          <span className="block font-medium text-paper-50">{presentation.label}</span>
          <span className="mt-0.5 block text-ink-300">{presentation.tooltip}</span>
        </span>
      }
      side="bottom"
      align="end"
    >
      <span
        role="status"
        tabIndex={0}
        aria-label={presentation.label}
        data-sandbox-status={status?.state ?? "unknown"}
        className="relative ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-content-muted transition-colors duration-150 ease-out hover:bg-surface-hover hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
      >
        <Box className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        <span
          className={cn(
            "pointer-events-none absolute bottom-[6px] right-[6px] h-[5px] w-[5px] rounded-full ring-1 ring-surface-canvas",
            presentation.indicatorClassName,
          )}
          data-sandbox-status-indicator
          aria-hidden="true"
        />
      </span>
    </Tooltip>
  );
}

function readSandboxStatusPresentation(status?: SandboxStatusSnapshotData | null): {
  label: string;
  tooltip: string;
  indicatorClassName: string;
} {
  const state = status?.state ?? "unknown";
  const detail = sandboxStatusDetail(status);
  const availabilitySuffix = sandboxStatusAvailabilitySuffix(status);
  const commonTooltip = `${detail} ${availabilitySuffix}`;

  const table = {
    disabled: {
      label: frontendMessage("sandbox.status.disabled"),
      tooltip: commonTooltip,
      indicatorClassName: "bg-ink-300",
    },
    unknown: {
      label: frontendMessage("sandbox.status.unknown"),
      tooltip: commonTooltip,
      indicatorClassName: "bg-ink-300",
    },
    preparing: {
      label: frontendMessage("sandbox.status.preparing"),
      tooltip: commonTooltip,
      indicatorClassName: "bg-umber-500 motion-safe:animate-pulse",
    },
    ready: {
      label: frontendMessage("sandbox.status.ready"),
      tooltip: commonTooltip,
      indicatorClassName: "bg-moss-500",
    },
    unavailable: {
      label: frontendMessage("sandbox.status.unavailable"),
      tooltip: commonTooltip,
      indicatorClassName: "bg-brick-500",
    },
  } satisfies Record<
    SandboxRuntimeState,
    {
      label: string;
      tooltip: string;
      indicatorClassName: string;
    }
  >;

  return table[state];
}
