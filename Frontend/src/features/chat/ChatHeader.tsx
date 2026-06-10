import { Lightbulb, PanelLeftOpen } from "lucide-react";
import { IconButton } from "../../shared/ui";

export function ChatHeader({
  title,
  runStatus,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
}: {
  title: string;
  runStatus?: "running" | "completed" | "failed" | "cancelled";
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
