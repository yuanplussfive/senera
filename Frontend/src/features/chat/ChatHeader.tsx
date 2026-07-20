import {
  Clock3,
  Lightbulb,
  MessageSquareText,
  PanelLeftOpen,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import type { SandboxRuntimeState, SandboxStatusSnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { IconButton, Tooltip } from "../../shared/ui";

export function ChatHeader({
  title,
  runStatus,
  waitingForApproval = false,
  waitingForInput = false,
  sandboxStatus,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
  onOpenTerminalPanel,
}: {
  title: string;
  runStatus?: "running" | "completed" | "failed" | "cancelled";
  waitingForApproval?: boolean;
  waitingForInput?: boolean;
  sandboxStatus?: SandboxStatusSnapshotData | null;
  onOpenSessionPanel?: () => void;
  onOpenWorkflowPanel?: () => void;
  onOpenTerminalPanel?: () => void;
}): JSX.Element {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-200/60 px-3 sm:px-6">
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
      <h1 className="min-w-0 flex-1 truncate font-serif text-[17px] italic text-ink-900" style={{ fontWeight: 500 }}>
        {title}
      </h1>
      {waitingForApproval ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-umber-200 bg-umber-50 px-2 py-0.5 font-mono text-[10px] text-umber-700">
          <Clock3 className="h-3 w-3" />
          {frontendMessage("approval.waiting")}
        </span>
      ) : waitingForInput ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-mono text-[10px] text-cyan-700">
          <MessageSquareText className="h-3 w-3" />
          {frontendMessage("interaction.input.pending")}
        </span>
      ) : runStatus === "failed" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-brick-200/60 bg-brick-50/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brick-600">
          failed
        </span>
      ) : runStatus === "cancelled" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-500">
          cancelled
        </span>
      ) : null}
      <SandboxStatusBadge status={sandboxStatus} />
      {onOpenTerminalPanel ? (
        <IconButton
          label={frontendMessage("terminal.panel.open")}
          tooltip={frontendMessage("terminal.panel.open")}
          tooltipSide="bottom"
          onClick={onOpenTerminalPanel}
          touchSafe
        >
          <SquareTerminal className="h-4 w-4" />
        </IconButton>
      ) : null}
      {onOpenWorkflowPanel ? (
        <IconButton
          label={frontendMessage("workflow.panel.open")}
          tooltip={frontendMessage("workflow.panel.open")}
          tooltipSide="bottom"
          onClick={onOpenWorkflowPanel}
          touchSafe
          className="ml-auto"
        >
          <Lightbulb className="h-4 w-4" />
        </IconButton>
      ) : null}
    </div>
  );
}

function SandboxStatusBadge({ status }: { status?: SandboxStatusSnapshotData | null }): JSX.Element {
  const presentation = readSandboxStatusPresentation(status);
  const Icon = presentation.Icon;

  return (
    <Tooltip
      content={<span className="max-w-[260px] whitespace-normal leading-5">{presentation.tooltip}</span>}
      side="bottom"
      align="end"
    >
      <button
        type="button"
        className={cn(
          "ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] transition",
          presentation.className,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{presentation.label}</span>
      </button>
    </Tooltip>
  );
}

function readSandboxStatusPresentation(status?: SandboxStatusSnapshotData | null): {
  label: string;
  tooltip: string;
  Icon: typeof Shield;
  className: string;
} {
  const state = status?.state ?? "unknown";
  const detail = status?.message ?? frontendMessage("sandbox.status.unsynced");
  const fallbackSuffix =
    status?.effectiveMode === "fallback"
      ? frontendMessage("sandbox.status.fallbackSuffix")
      : frontendMessage("sandbox.status.sandboxSuffix");
  const commonTooltip = `${detail} ${fallbackSuffix}`;

  const table = {
    unknown: {
      label: frontendMessage("sandbox.status.unknown"),
      tooltip: commonTooltip,
      Icon: Shield,
      className: "border-ink-200 bg-paper-100 text-ink-500 hover:bg-ink-900/[0.04]",
    },
    preparing: {
      label: frontendMessage("sandbox.status.preparing"),
      tooltip: commonTooltip,
      Icon: Shield,
      className: "border-umber-200 bg-umber-50/70 text-umber-700 hover:bg-umber-50",
    },
    ready: {
      label: frontendMessage("sandbox.status.ready"),
      tooltip: commonTooltip,
      Icon: ShieldCheck,
      className: "border-moss-200 bg-moss-50/70 text-moss-700 hover:bg-moss-50",
    },
    fallback: {
      label: frontendMessage("sandbox.status.fallback"),
      tooltip: commonTooltip,
      Icon: ShieldAlert,
      className: "border-brick-200 bg-brick-50/70 text-brick-700 hover:bg-brick-50",
    },
  } satisfies Record<
    SandboxRuntimeState,
    {
      label: string;
      tooltip: string;
      Icon: typeof Shield;
      className: string;
    }
  >;

  return table[state];
}
