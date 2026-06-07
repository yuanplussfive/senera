import { Lightbulb, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";

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
        <Tooltip content="打开会话" side="bottom">
          <button
            type="button"
            onClick={onOpenSessionPanel}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 md:hidden"
            aria-label="打开会话"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </Tooltip>
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
        <Tooltip content="打开思考过程" side="bottom">
          <button
            type="button"
            onClick={onOpenWorkflowPanel}
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-ink-600 transition hover:bg-ink-900/[0.05] hover:text-ink-900 lg:hidden"
            aria-label="打开思考过程"
          >
            <Lightbulb className="h-4 w-4" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
