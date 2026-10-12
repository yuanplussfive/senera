import type { SandboxRuntimeState, SandboxStatusSnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { sandboxStatusAvailabilitySuffix, sandboxStatusDetail } from "../sandbox/sandboxPreparationPresentation";
import { ActivityStatusIcon, AppIcon, ExecutionStatusTones, IconButton, Tooltip } from "../../shared/ui";
import type { AppIconName } from "../../shared/ui";
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
      className="relative z-10 flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-2 border-b border-line-subtle bg-transparent px-3 sm:px-5"
      data-ui-chrome
      data-chat-header
      data-testid="chat-header"
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
          <AppIcon icon="panel-left-open" size={16} />
        </IconButton>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-1.5" data-chat-header-title>
        <h1 className="min-w-0 truncate text-[14.5px] font-semibold text-content-strong">{title}</h1>
        <SandboxStatusBadge status={sandboxStatus} />
      </div>
      {waitingForApproval ? (
        <span
          className="ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] text-umber-600"
          data-chat-run-status="waiting-approval"
        >
          <AppIcon icon="clock" size={12} />
          {frontendMessage("approval.waiting")}
        </span>
      ) : waitingForInput ? (
        <span
          className="ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] text-accent-content"
          data-chat-run-status="waiting-input"
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
        >
          <AppIcon icon="alert-circle" size={12} />
          {frontendMessage("workflow.run.status.failed")}
        </span>
      ) : runStatus === "cancelled" ? (
        <span
          className="ml-2 inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] text-content-secondary"
          data-chat-run-status="cancelled"
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

function SandboxStatusBadge({ status }: { status?: SandboxStatusSnapshotData | null }): JSX.Element | null {
  if (!status || status.state === "ready" || status.state === "unknown") return null;
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
      align="start"
      delayDuration={150}
    >
      <span
        role="status"
        tabIndex={0}
        aria-label={presentation.label}
        data-sandbox-status={status.state}
        data-window-no-drag
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-content-muted transition-colors duration-150 ease-out hover:text-content-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
      >
        {status.state === "preparing" ? (
          <ActivityStatusIcon status="running" motion="spin" size={14} className={presentation.iconClassName} />
        ) : (
          <AppIcon
            icon={presentation.icon}
            size={14}
            className={presentation.iconClassName}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        )}
      </span>
    </Tooltip>
  );
}

function readSandboxStatusPresentation(status?: SandboxStatusSnapshotData | null): {
  label: string;
  tooltip: string;
  icon: AppIconName;
  iconClassName?: string;
} {
  const state = status?.state ?? "unknown";
  const detail = sandboxStatusDetail(status);
  const availabilitySuffix = sandboxStatusAvailabilitySuffix(status);
  const commonTooltip = `${detail} ${availabilitySuffix}`;

  const table = {
    disabled: {
      label: frontendMessage("sandbox.status.disabled"),
      tooltip: commonTooltip,
      icon: "shield-off",
    },
    unknown: {
      label: frontendMessage("sandbox.status.unknown"),
      tooltip: commonTooltip,
      icon: "shield",
    },
    preparing: {
      label: frontendMessage("sandbox.status.preparing"),
      tooltip: commonTooltip,
      icon: "shield",
      iconClassName: "senera-activity-status-pulse",
    },
    ready: {
      label: frontendMessage("sandbox.status.ready"),
      tooltip: commonTooltip,
      icon: "shield",
    },
    unavailable: {
      label: frontendMessage("sandbox.status.unavailable"),
      tooltip: commonTooltip,
      icon: "shield-alert",
    },
  } satisfies Record<
    SandboxRuntimeState,
    {
      label: string;
      tooltip: string;
      icon: AppIconName;
      iconClassName?: string;
    }
  >;

  return table[state] ?? table.unknown;
}
