import { useId, useMemo, useState } from "react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { type TimelineChildRunState, type TimelineStep } from "../../store/sessionStore";
import { AppIcon } from "../../shared/ui/AppIcon";
import { MotionDisclosure } from "../../shared/motion";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { ChildRunStatusPresentation, isChildRunActive } from "./ChildRunOverview";
import { projectToolBatchActivity, ToolBatchActivity } from "./ToolBatchActivity";
import { RunThinkingPresentation } from "../chat/ModelThinkingDisclosure";
import { TextShimmer, textShimmerStyle } from "../../shared/motion";

interface ChildRunCardProps {
  childRun: TimelineChildRunState;
  agentName?: string;
  childToolSteps?: readonly TimelineStep[];
}

/**
 * A delegated run follows the same flat rhythm as the execution timeline.
 * Todo state is the primary surface; the report and tool trace remain opt-in
 * so a busy child run does not turn the conversation into a wall of logs.
 */
export function ChildRunActivity({ childRun, agentName, childToolSteps }: ChildRunCardProps): JSX.Element {
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const presentation = ChildRunStatusPresentation[childRun.status];
  const live = isChildRunActive(childRun.status);
  const settled = !live;
  const childMessages = childRun.messages.filter(
    (message) => message.direction === "child_to_parent" && message.content.trim(),
  );
  const liveUpdate = live
    ? [...childMessages].reverse().find((message) => message.kind === "progress" || message.kind === "response")
    : undefined;
  const traceItems = useMemo(
    () => projectChildRunTraceItems(childRun, childToolSteps, liveUpdate?.id),
    [childRun, childToolSteps, liveUpdate?.id],
  );
  const latestActivity = live ? readLatestChildRunActivity(traceItems, liveUpdate) : undefined;
  const liveThinking = !open && latestActivity?.kind === "thinking" ? latestActivity.block : undefined;
  const latestActivityVisible = Boolean(
    latestActivity &&
    (open || liveThinking || (latestActivity.kind === "message" && latestActivity.id === `message:${liveUpdate?.id}`)),
  );
  const hasDetails = traceItems.length > 0 || Boolean(liveUpdate);
  const name = agentName || frontendMessage("workflow.childRun.board.agentFallback");

  return (
    <section
      className="child-run-activity min-w-0"
      data-child-run-activity
      data-child-run-card
      data-child-run-status={childRun.status}
      aria-live="polite"
    >
      <button
        type="button"
        onClick={hasDetails ? () => setOpen((value) => !value) : undefined}
        aria-expanded={hasDetails ? open : undefined}
        aria-controls={hasDetails ? contentId : undefined}
        aria-label={`${name}: ${frontendMessage(presentation.label)}`}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 border-b border-line-subtle py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
          hasDetails && "cursor-pointer hover:bg-surface-hover/55",
        )}
        data-child-run-activity-trigger
        data-child-run-card-trigger
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" data-child-run-glyph>
          <AppIcon
            icon="delegation"
            size={15}
            className={cn("text-content-secondary", live && "text-accent-strong")}
            aria-hidden="true"
          />
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface-page",
              presentation.dot,
            )}
            aria-hidden="true"
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.75px] font-semibold leading-5 text-content-primary">
          {name}
        </span>
        <span
          className={cn(
            "shrink-0 text-[10.5px]",
            presentation.text,
            live && !latestActivityVisible && "motion-safe:animate-text-shimmer",
          )}
          data-child-run-status-text
          style={textShimmerStyle(frontendMessage(presentation.label))}
        >
          {frontendMessage(presentation.label)}
        </span>
        {hasDetails ? (
          <AppIcon
            icon="chevron-down"
            size={14}
            className={cn(
              "shrink-0 text-content-muted transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        ) : null}
      </button>

      {liveUpdate ? (
        <p
          className="ml-7 border-b border-line-subtle py-2 pl-3 pr-1 text-[11.5px] leading-5 text-content-secondary"
          data-child-run-live-update
        >
          <TextShimmer text={liveUpdate.content} active={live} />
        </p>
      ) : null}

      {liveThinking ? (
        <div className="ml-7 border-b border-line-subtle py-2 pl-3 pr-1" data-child-run-live-thinking>
          <RunThinkingPresentation blocks={[liveThinking]} current />
        </div>
      ) : null}

      <MotionDisclosure id={contentId} open={open} className="child-run-activity__disclosure">
        <div
          className="ml-7 min-w-0 border-b border-line-subtle py-2 pl-3 pr-1"
          data-child-run-activity-details
          data-child-run-card-body
        >
          <div className="flex min-w-0 flex-col gap-2.5">
            {traceItems.map((item) =>
              item.kind === "thinking" ? (
                <div key={item.id} data-child-run-trace-item="thinking">
                  <RunThinkingPresentation blocks={[item.block]} current={latestActivity?.id === item.id} />
                </div>
              ) : item.kind === "tools" ? (
                <ChildRunToolTrace key={item.id} steps={item.steps} animateActivity={latestActivity?.id === item.id} />
              ) : (
                <ChildRunTraceMessage
                  key={item.id}
                  item={item}
                  live={live}
                  settled={settled}
                  animateActivity={latestActivity?.id === item.id}
                />
              ),
            )}
          </div>
        </div>
      </MotionDisclosure>
    </section>
  );
}

/** Compatibility export for hosts that still import the pre-activity name. */
export const ChildRunCard = ChildRunActivity;

type ChildRunTraceItem =
  | {
      kind: "thinking";
      id: string;
      order: ChildRunTraceOrder;
      block: NonNullable<TimelineChildRunState["thinkingBlocks"]>[number];
    }
  | { kind: "message"; id: string; order: ChildRunTraceOrder; message: TimelineChildRunState["messages"][number] }
  | { kind: "tools"; id: string; order: ChildRunTraceOrder; steps: TimelineStep[] };

interface ChildRunTraceOrder {
  agentStep: number;
  modelMessageIndex: number;
  modelContentIndex: number;
  eventSequence: number;
}

function projectChildRunTraceItems(
  childRun: TimelineChildRunState,
  childToolSteps: readonly TimelineStep[] = [],
  excludedMessageId?: string,
): ChildRunTraceItem[] {
  const ordered: ChildRunTraceItem[] = [
    ...(childRun.thinkingBlocks ?? [])
      .filter((block) => block.content.trim())
      .map((block): ChildRunTraceItem => ({
        kind: "thinking",
        id: `thinking:${block.id}`,
        order: {
          agentStep: block.step,
          modelMessageIndex: block.messageIndex,
          modelContentIndex: block.contentIndex,
          eventSequence: block.eventSequence ?? Number.MAX_SAFE_INTEGER,
        },
        block,
      })),
    ...childRun.messages
      .filter(
        (message) =>
          message.id !== excludedMessageId && message.direction === "child_to_parent" && message.content.trim(),
      )
      .map((message): ChildRunTraceItem => ({
        kind: "message",
        id: `message:${message.id}`,
        order: {
          agentStep: message.agentStep ?? Number.MAX_SAFE_INTEGER,
          modelMessageIndex: message.modelMessageIndex ?? Number.MAX_SAFE_INTEGER,
          modelContentIndex: message.modelContentIndex ?? Number.MAX_SAFE_INTEGER,
          eventSequence: message.eventSequence ?? Number.MAX_SAFE_INTEGER,
        },
        message,
      })),
    ...childToolSteps.map((step): ChildRunTraceItem => ({
      kind: "tools",
      id: `tool:${step.id}`,
      order: {
        agentStep: step.agentStep ?? Number.MAX_SAFE_INTEGER,
        modelMessageIndex: step.modelMessageIndex ?? Number.MAX_SAFE_INTEGER,
        modelContentIndex: step.modelContentIndex ?? Number.MAX_SAFE_INTEGER,
        eventSequence: step.startedSequence ?? step.eventSequence ?? Number.MAX_SAFE_INTEGER,
      },
      steps: [step],
    })),
  ].sort(compareChildRunTraceItems);

  return ordered.reduce<ChildRunTraceItem[]>((items, item) => {
    const previous = items.at(-1);
    const previousToolActivity = previous?.kind === "tools" ? previous : undefined;
    const previousTool = previousToolActivity?.steps.at(-1);
    const currentTool = item.kind === "tools" ? item.steps[0] : undefined;
    if (
      previousToolActivity &&
      item.kind === "tools" &&
      previousTool?.toolBatch?.id &&
      previousTool.toolBatch.id === currentTool?.toolBatch?.id &&
      previousToolActivity.order.agentStep === item.order.agentStep &&
      previousToolActivity.order.modelMessageIndex === item.order.modelMessageIndex
    ) {
      previousToolActivity.steps.push(...item.steps);
      return items;
    }
    items.push(item);
    return items;
  }, []);
}

function compareChildRunTraceItems(left: ChildRunTraceItem, right: ChildRunTraceItem): number {
  return (
    left.order.agentStep - right.order.agentStep ||
    left.order.modelMessageIndex - right.order.modelMessageIndex ||
    left.order.modelContentIndex - right.order.modelContentIndex ||
    left.order.eventSequence - right.order.eventSequence ||
    left.id.localeCompare(right.id)
  );
}

function readLatestChildRunActivity(
  traceItems: readonly ChildRunTraceItem[],
  liveUpdate: TimelineChildRunState["messages"][number] | undefined,
): ChildRunTraceItem | undefined {
  const messageItem: ChildRunTraceItem | undefined = liveUpdate
    ? {
        kind: "message",
        id: `message:${liveUpdate.id}`,
        order: {
          agentStep: liveUpdate.agentStep ?? Number.MAX_SAFE_INTEGER,
          modelMessageIndex: liveUpdate.modelMessageIndex ?? Number.MAX_SAFE_INTEGER,
          modelContentIndex: liveUpdate.modelContentIndex ?? Number.MAX_SAFE_INTEGER,
          eventSequence: liveUpdate.eventSequence ?? Number.MAX_SAFE_INTEGER,
        },
        message: liveUpdate,
      }
    : undefined;
  return [...traceItems, ...(messageItem ? [messageItem] : [])].sort(compareChildRunTraceItems).at(-1);
}

function ChildRunToolTrace({
  steps,
  animateActivity,
}: {
  steps: readonly TimelineStep[];
  animateActivity: boolean;
}): JSX.Element | null {
  const activity = projectToolBatchActivity({ steps });
  return activity ? (
    <div data-child-run-trace-item="tools">
      <ToolBatchActivity activity={activity} defaultOpen={false} animateActivity={animateActivity} />
    </div>
  ) : null;
}

function ChildRunTraceMessage({
  item,
  live,
  settled,
  animateActivity,
}: {
  item: Extract<ChildRunTraceItem, { kind: "message" }>;
  live: boolean;
  settled: boolean;
  animateActivity: boolean;
}): JSX.Element {
  const finalReport = settled && item.message.kind === "response";
  const liveUpdate = live && (item.message.kind === "progress" || item.message.kind === "response");
  return (
    <div
      className={finalReport ? "border-b border-line-subtle pb-2" : undefined}
      data-child-run-trace-item="message"
      data-child-run-final-report={finalReport || undefined}
      data-child-run-live-update={liveUpdate || undefined}
    >
      {finalReport ? (
        <div className="mb-1 text-[10.5px] font-semibold text-content-muted">
          {frontendMessage("workflow.childRun.card.reportTitle")}
        </div>
      ) : null}
      <LazyMarkdownRenderer
        className="mt-1 min-w-0"
        contentClassName={cn(
          "text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary",
          animateActivity && "live-activity-markdown",
        )}
        contentStyle={animateActivity ? textShimmerStyle(item.message.content) : undefined}
        externalLinkPresentation="citation"
      >
        {item.message.content}
      </LazyMarkdownRenderer>
    </div>
  );
}
