import { Lightbulb, PanelLeftOpen, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SandboxRuntimeState, SandboxStatusSnapshotData } from "../../api/eventTypes";
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
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-200/60 px-3 sm:px-6">
      {onOpenSessionPanel ? (
        <IconButton
          label="打开会话"
          tooltip="打开会话"
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
      {runStatus === "failed" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-md border border-brick-200/60 bg-brick-50/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-brick-600">
          failed
        </span>
      ) : runStatus === "cancelled" ? (
        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-500">
          cancelled
        </span>
      ) : null}
      <SandboxStatusBadge status={sandboxStatus} />
      {onOpenWorkflowPanel ? (
        <IconButton
          label="打开思考过程"
          tooltip="打开思考过程"
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

function SandboxStatusBadge({
  status,
}: {
  status?: SandboxStatusSnapshotData | null;
}): JSX.Element {
  const presentation = readSandboxStatusPresentation(status);
  const Icon = presentation.Icon;

  return (
    <Tooltip
      content={
        <span className="max-w-[260px] whitespace-normal leading-5">
          {presentation.tooltip}
        </span>
      }
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
  const detail = status?.message ?? "沙箱运行时尚未同步状态。";
  const fallbackSuffix = status?.effectiveMode === "fallback"
    ? "允许回退的工具会继续使用本地执行边界。"
    : "支持沙箱的工具会优先进入 microVM。";
  const commonTooltip = `${detail} ${fallbackSuffix}`;

  const table = {
    unknown: {
      label: "沙箱未检测",
      tooltip: commonTooltip,
      Icon: Shield,
      className: "border-ink-200 bg-paper-100 text-ink-500 hover:bg-ink-900/[0.04]",
    },
    preparing: {
      label: "沙箱准备中",
      tooltip: commonTooltip,
      Icon: Shield,
      className: "border-umber-200 bg-umber-50/70 text-umber-700 hover:bg-umber-50",
    },
    ready: {
      label: "沙箱可用",
      tooltip: commonTooltip,
      Icon: ShieldCheck,
      className: "border-moss-200 bg-moss-50/70 text-moss-700 hover:bg-moss-50",
    },
    fallback: {
      label: "本地回退",
      tooltip: commonTooltip,
      Icon: ShieldAlert,
      className: "border-brick-200 bg-brick-50/70 text-brick-700 hover:bg-brick-50",
    },
  } satisfies Record<SandboxRuntimeState, {
    label: string;
    tooltip: string;
    Icon: typeof Shield;
    className: string;
  }>;

  return table[state];
}
