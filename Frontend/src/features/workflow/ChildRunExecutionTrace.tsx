import { memo, useMemo } from "react";
import type { TimelineChildRunState, TimelineStep } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { isChildRunActive } from "./childRunPresentation";
import { projectToolBatchActivities, ToolBatchActivityList } from "./ToolBatchActivity";
import { RunThinkingPresentation } from "../chat/ModelThinkingDisclosure";
import { formatTime } from "../../lib/util";

interface ChildRunTraceProps {
  childRun: TimelineChildRunState;
  childToolSteps?: readonly TimelineStep[];
}

export function ChildRunExecutionTrace({ childRun, childToolSteps }: ChildRunTraceProps): JSX.Element {
  const live = isChildRunActive(childRun.status);
  const items = useMemo(() => projectChildRunTraceItems(childRun, childToolSteps), [childRun, childToolSteps]);
  return (
    <div className="min-w-0" data-child-run-activity-details data-child-run-card-body>
      <div className="flex min-w-0 flex-col gap-3 py-1">
        {items.map((item) =>
          item.kind === "thinking" ? (
            <div key={item.id} data-child-run-trace-item="thinking">
              <RunThinkingPresentation blocks={[item.block]} />
            </div>
          ) : item.kind === "tools" ? (
            <ChildRunToolTrace key={item.id} steps={item.steps} animateActivity={live && item === items.at(-1)} />
          ) : (
            <ChildRunTraceMessage key={item.id} item={item} live={live} settled={!live} />
          ),
        )}
      </div>
    </div>
  );
}

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
      .filter((message) => message.content.trim())
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
    left.order.eventSequence - right.order.eventSequence ||
    left.order.agentStep - right.order.agentStep ||
    left.order.modelMessageIndex - right.order.modelMessageIndex ||
    left.order.modelContentIndex - right.order.modelContentIndex ||
    left.order.eventSequence - right.order.eventSequence ||
    left.id.localeCompare(right.id)
  );
}

function ChildRunToolTrace({
  steps,
  animateActivity,
}: {
  steps: readonly TimelineStep[];
  animateActivity: boolean;
}): JSX.Element | null {
  const activities = projectToolBatchActivities({ steps });
  return activities.length > 0 ? (
    <div data-child-run-trace-item="tools">
      <ToolBatchActivityList activities={activities} animateActivity={animateActivity} />
    </div>
  ) : null;
}

const ChildRunTraceMessage = memo(
  function ChildRunTraceMessage({
    item,
    live,
    settled,
  }: {
    item: Extract<ChildRunTraceItem, { kind: "message" }>;
    live: boolean;
    settled: boolean;
  }): JSX.Element {
    const fromChild = item.message.direction === "child_to_parent";
    const finalReport = fromChild && settled && item.message.kind === "response";
    const liveUpdate = fromChild && live && (item.message.kind === "progress" || item.message.kind === "response");
    return (
      <div
        className={finalReport ? "border-b border-line-subtle pb-2" : undefined}
        data-child-run-trace-item="message"
        data-child-run-final-report={finalReport || undefined}
        data-child-run-live-update={liveUpdate || undefined}
      >
        <div className="mb-1 flex items-center gap-2 text-[10.5px] font-medium text-content-muted">
          <span>
            {frontendMessage(
              finalReport
                ? "workflow.childRun.card.reportTitle"
                : fromChild
                  ? "workflow.childRun.message.child"
                  : "workflow.childRun.message.parent",
            )}
          </span>
          <time className="ml-auto tabular-nums" dateTime={item.message.createdAt}>
            {formatTime(item.message.createdAt)}
          </time>
        </div>
        <LazyMarkdownRenderer
          className="mt-1 min-w-0"
          contentClassName="text-[13px] leading-relaxed text-content-primary"
          externalLinkPresentation="citation"
        >
          {item.message.content}
        </LazyMarkdownRenderer>
      </div>
    );
  },
  (previous, next) =>
    previous.item.message === next.item.message && previous.live === next.live && previous.settled === next.settled,
);
