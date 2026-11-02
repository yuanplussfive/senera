import { memo } from "react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { TimelineChildRunState } from "../../store/sessionStore";
import { ActivityStatusIcon, AppIcon, Button } from "../../shared/ui";
import { childRunStatus } from "./childRunPresentation";
import { ChildRunElapsed } from "./ChildRunElapsed";
import { useChildRunNavigation } from "./ChildRunNavigation";
import "./childRuns.css";

/** The parent conversation shows execution state; the dock owns the full trace. */
export const ChildRunActivity = memo(
  function ChildRunActivity({
    childRun,
    agentName,
  }: {
    childRun: TimelineChildRunState;
    agentName?: string;
  }): JSX.Element {
    const navigation = useChildRunNavigation();
    const presentation = childRunStatus(childRun.status);
    const name = agentName || frontendMessage("workflow.childRun.board.agentFallback");
    return (
      <div
        className="child-run-activity flex min-w-0 items-center gap-2 text-[12px]"
        data-child-run-activity
        data-child-run-card
        data-child-run-status={childRun.status}
      >
        <ActivityStatusIcon status={presentation.activity} size={15} motion="spin" className="shrink-0" />
        <span className="min-w-0 max-w-[30%] truncate font-medium text-content-primary" title={name}>
          {name}
        </span>
        <span
          className={cn("min-w-0 truncate", presentation.text)}
          title={frontendMessage(presentation.label)}
          data-child-run-status-text
        >
          {frontendMessage(presentation.label)}
        </span>
        <ChildRunElapsed startedAt={childRun.startedAt} completedAt={childRun.completedAt} status={childRun.status} />
        {navigation ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 shrink-0 gap-1 px-1.5 text-[11px] text-content-muted"
            onClick={() => navigation.open(childRun.id)}
          >
            {frontendMessage("workflow.childRun.viewDetails")}
            <AppIcon icon="chevron-right" size={12} />
          </Button>
        ) : null}
      </div>
    );
  },
  (previous, next) =>
    previous.agentName === next.agentName &&
    previous.childRun.id === next.childRun.id &&
    previous.childRun.status === next.childRun.status &&
    previous.childRun.startedAt === next.childRun.startedAt &&
    previous.childRun.completedAt === next.childRun.completedAt,
);

export const ChildRunCard = ChildRunActivity;
