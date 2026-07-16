import { ListTree, PanelLeftOpen, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SandboxRuntimeState, SandboxStatusSnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { IconButton, Tooltip } from "../../shared/ui";

export function ChatHeader({
  title,
  runStatus,
  sandboxStatus,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
}: {
  title: string;
  runStatus?: "running" | "completed" | "failed" | "cancelled";
  sandboxStatus?: SandboxStatusSnapshotData | null;
  onOpenSessionPanel?: () => void;
  onOpenWorkflowPanel?: () => void;
}): JSX.Element {
  return (
    <div
      className="relative z-10 flex h-[52px] shrink-0 items-center gap-2 bg-[var(--theme-elevated-bg)] px-3 [box-shadow:var(--shadow-soft)] sm:px-5"
      data-ui-chrome
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
          <PanelLeftOpen className="h-4 w-4" />
        </IconButton>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink-950">{title}</h1>
      {runStatus === "failed" ? (
        <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium text-brick-600">
          {frontendMessage("workflow.run.status.failed")}
        </span>
      ) : runStatus === "cancelled" ? (
        <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-medium text-ink-500">
          {frontendMessage("workflow.run.status.cancelled")}
        </span>
      ) : null}
      <SandboxStatusBadge status={sandboxStatus} />
      {onOpenWorkflowPanel ? (
        <nav
          className="ml-auto flex items-center border-l border-ink-200/70 pl-2"
          aria-label={frontendMessage("workflow.panel.title")}
          data-workspace-tool-dock
        >
          <IconButton
            label={frontendMessage("workflow.panel.expand")}
            tooltip={frontendMessage("workflow.panel.expand")}
            tooltipSide="bottom"
            aria-expanded={false}
            onClick={onOpenWorkflowPanel}
            touchSafe
            className="rounded-md"
          >
            <ListTree className="h-4 w-4" />
          </IconButton>
        </nav>
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
          "ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
          presentation.className,
        )}
        aria-label={presentation.label}
      >
        <Icon className="h-3.5 w-3.5" />
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
      className: "text-ink-500 hover:bg-ink-900/[0.04]",
    },
    preparing: {
      label: frontendMessage("sandbox.status.preparing"),
      tooltip: commonTooltip,
      Icon: Shield,
      className: "text-umber-600 hover:bg-ink-900/[0.04]",
    },
    ready: {
      label: frontendMessage("sandbox.status.ready"),
      tooltip: commonTooltip,
      Icon: ShieldCheck,
      className: "text-moss-600 hover:bg-ink-900/[0.04]",
    },
    fallback: {
      label: frontendMessage("sandbox.status.fallback"),
      tooltip: commonTooltip,
      Icon: ShieldAlert,
      className: "text-brick-600 hover:bg-ink-900/[0.04]",
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
