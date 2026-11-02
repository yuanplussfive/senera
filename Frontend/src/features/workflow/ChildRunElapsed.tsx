import { memo } from "react";
import type { TimelineChildRunState } from "../../store/sessionStore";
import { formatDurationMs } from "../../lib/util";
import { useLiveNow } from "../../shared/scheduling/useLiveNow";
import { isChildRunActive } from "./childRunPresentation";

export const ChildRunElapsed = memo(function ChildRunElapsed({
  startedAt,
  completedAt,
  status,
}: Pick<TimelineChildRunState, "startedAt" | "completedAt" | "status">): JSX.Element | null {
  const live = isChildRunActive(status);
  const now = useLiveNow(live);
  const start = Date.parse(startedAt ?? "");
  const end = live ? now : Date.parse(completedAt ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const elapsed = Math.max(0, live ? Math.floor((end - start) / 1000) * 1000 : end - start);
  return (
    <span className="shrink-0 text-[11px] tabular-nums text-content-muted" data-child-run-elapsed>
      {elapsed === 0 ? "0s" : formatDurationMs(elapsed)}
    </span>
  );
});
