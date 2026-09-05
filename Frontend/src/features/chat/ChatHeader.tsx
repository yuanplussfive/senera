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
  ShieldOff,
} from "lucide-react";
import type { SandboxRuntimeState, SandboxStatusSnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { sandboxStatusAvailabilitySuffix, sandboxStatusDetail } from "../sandbox/sandboxPreparationPresentation";
import { IconButton, Spinner, Tooltip } from "../../shared/ui";
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

function SandboxStatusBadge({ status }: { status?: SandboxStatusSnapshotData | null }): JSX.Element | null {
  if (!status || status.state === "ready" || status.state === "unknown") return null;
  const presentation = readSandboxStatusPresentation(status);
  const StatusIcon = presentation.Icon;
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
        <StatusIcon
          className={`h-3.5 w-3.5 ${presentation.iconClassName ?? ""}`}
          strokeWidth={1.8}
          aria-hidden="true"
        />
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
  const state = status?.state ?? "unknown";
  const detail = sandboxStatusDetail(status);
  const availabilitySuffix = sandboxStatusAvailabilitySuffix(status);
  const commonTooltip = `${detail} ${availabilitySuffix}`;

  const table = {
    disabled: {
      label: frontendMessage("sandbox.status.disabled"),
      tooltip: commonTooltip,
      Icon: ShieldOff,
    },
    unknown: {
      label: frontendMessage("sandbox.status.unknown"),
      tooltip: commonTooltip,
      Icon: Shield,
    },
    preparing: {
      label: frontendMessage("sandbox.status.preparing"),
      tooltip: commonTooltip,
      Icon: LoaderCircle,
      iconClassName: "motion-safe:animate-spin",
    },
    ready: {
      label: frontendMessage("sandbox.status.ready"),
      tooltip: commonTooltip,
      Icon: Shield,
    },
    unavailable: {
      label: frontendMessage("sandbox.status.unavailable"),
      tooltip: commonTooltip,
      Icon: ShieldAlert,
    },
  } satisfies Record<
    SandboxRuntimeState,
    {
      label: string;
      tooltip: string;
      Icon: typeof Shield;
      iconClassName?: string;
    }
  >;

  return table[state] ?? table.unknown;
}
