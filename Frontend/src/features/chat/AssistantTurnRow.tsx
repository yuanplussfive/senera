import { lazy, memo, Suspense } from "react";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { ChatMessage } from "../../store/sessionStore";
import { ConversationFrame, Spinner } from "../../shared/ui";
import { activeRunActivityLabel, runActivityPresentationPriority } from "../workflow/runActivityPresentation";
import { AssistantMessageBody } from "./AssistantMessageBody";
import { InteractionInputStrip } from "./InteractionInputStrip";
import { MessageActions } from "./MessageActions";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import { ThinkingSummaryBar } from "./ThinkingSummaryBar";
import { readAssistantDisplayContent } from "./messagePresentation";
import { projectAssistantTurnStages, type AssistantTurnStage } from "./assistantTurnStageProjection";
import {
  readAssistantTurnActionMessage,
  readAssistantTurnAnchorId,
  type AssistantTurnListItem,
} from "./assistantTurnProjection";

const AgentExecutionStageFeed = lazy(() =>
  import("../workflow/AgentExecutionFeed").then((module) => ({ default: module.AgentExecutionStageFeed })),
);
const AgentExecutionStageFold = lazy(() =>
  import("../workflow/AgentExecutionFeed").then((module) => ({ default: module.AgentExecutionStageFold })),
);

export interface AssistantTurnRowProps {
  sessionId: string;
  turn: AssistantTurnListItem;
  showInlineActions: boolean;
  onForkFromMessage: (message: Pick<ChatMessage, "requestId">) => void;
  onRegenerate: (message: ChatMessage) => void;
  onDeleteFromMessage: (message: ChatMessage) => void;
  onViewWorkflow: (message: ChatMessage) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}

export const AssistantTurnRow = memo(function AssistantTurnRow({
  turn,
  showInlineActions,
  onForkFromMessage,
  onRegenerate,
  onDeleteFromMessage,
  onViewWorkflow,
  onResolveInteractionInput,
}: AssistantTurnRowProps): JSX.Element {
  const { run } = turn;
  const prefaces = turn.messages.filter((message) => message.kind === "AssistantToolPreface");
  const terminalMessages = turn.messages.filter((message) => message.kind !== "AssistantToolPreface");
  const actionMessage = readAssistantTurnActionMessage(turn);
  const fallbackMessage = turn.messages.at(-1);
  const forkBoundary = actionMessage ?? (turn.requestId ? { requestId: turn.requestId } : undefined);
  const transientPreface = readTransientPreface(turn, prefaces);
  const transientAnswer = readTransientAnswer(turn, terminalMessages);
  const copyContent = readTurnCopyContent(turn, transientPreface, transientAnswer);
  const stages = projectAssistantTurnStages(turn);
  const renderedStages = projectTransientStages(stages, turn, transientPreface, transientAnswer);
  const showLiveExecution = run?.status === "running" || run?.status === "cancelling";
  const liveToolStageId = showLiveExecution ? readLatestToolStageId(renderedStages) : undefined;
  const currentStageId = renderedStages.find((stage) => stage.current)?.id;
  const foregroundActivity =
    showLiveExecution && run?.liveActivity && runActivityPresentationPriority(run.liveActivity) === "foreground";
  const liveExecutionStageId = liveToolStageId ?? (foregroundActivity ? currentStageId : undefined);

  return (
    <ConversationFrame mode="wide" className="group/msg" data-assistant-turn={turn.requestId ?? turn.key}>
      <div className="flex min-w-0 items-start gap-3" data-assistant-message>
        <AssistantMessageAvatar />
        <div className="assistant-turn-content min-w-0 flex-1">
          <MessageMeta title="Senera" timestamp={turn.createdAt} />
          <ThinkingSummaryBar
            run={run}
            presentation={run?.status === "running" ? "live-final-answer" : "terminal-only"}
          />

          <div className="assistant-turn-flow" data-assistant-turn-stage-list>
            {renderedStages.map((stage) => (
              <AssistantStage
                key={stage.id}
                stage={stage}
                onResolveInteractionInput={onResolveInteractionInput}
                showExecution={stage.id === liveExecutionStageId}
                keepOpenWhileRunActive={showLiveExecution && stage.id === liveExecutionStageId}
              />
            ))}
          </div>

          {forkBoundary ? (
            <MessageActions
              content={copyContent}
              placement="left"
              hasRequestId
              hasWorkflow={!!run && !!(actionMessage ?? fallbackMessage)}
              allowFork
              allowMutation={!!actionMessage}
              allowCopy={!!copyContent}
              showInlineActions={showInlineActions}
              onFork={() => onForkFromMessage(forkBoundary)}
              onRegenerate={() => actionMessage && onRegenerate(actionMessage)}
              onDelete={() => actionMessage && onDeleteFromMessage(actionMessage)}
              onViewWorkflow={() => {
                const workflowMessage = actionMessage ?? fallbackMessage;
                if (workflowMessage) onViewWorkflow(workflowMessage);
              }}
            />
          ) : null}
        </div>
      </div>
    </ConversationFrame>
  );
}, areAssistantTurnRowPropsEqual);

function areAssistantTurnRowPropsEqual(previous: AssistantTurnRowProps, next: AssistantTurnRowProps): boolean {
  if (
    previous.sessionId !== next.sessionId ||
    previous.showInlineActions !== next.showInlineActions ||
    previous.onForkFromMessage !== next.onForkFromMessage ||
    previous.onRegenerate !== next.onRegenerate ||
    previous.onDeleteFromMessage !== next.onDeleteFromMessage ||
    previous.onViewWorkflow !== next.onViewWorkflow ||
    previous.onResolveInteractionInput !== next.onResolveInteractionInput
  ) {
    return false;
  }

  const previousTurn = previous.turn;
  const nextTurn = next.turn;
  if (
    previousTurn.key !== nextTurn.key ||
    previousTurn.requestId !== nextTurn.requestId ||
    previousTurn.createdAt !== nextTurn.createdAt ||
    previousTurn.streaming !== nextTurn.streaming ||
    previousTurn.run !== nextTurn.run ||
    previousTurn.messages.length !== nextTurn.messages.length
  ) {
    return false;
  }

  return previousTurn.messages.every((message, index) => message === nextTurn.messages[index]);
}

type RenderedAssistantStage = AssistantTurnStage;

function AssistantStage({
  stage,
  onResolveInteractionInput,
  showExecution,
  keepOpenWhileRunActive,
}: {
  stage: RenderedAssistantStage;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
  showExecution: boolean;
  keepOpenWhileRunActive: boolean;
}): JSX.Element {
  const stageRunActive = stage.run?.status === "running" || stage.run?.status === "cancelling";
  const shouldRenderExecution = !!stage.run && (!stageRunActive || showExecution);
  const execution =
    shouldRenderExecution && stage.run ? (
      <Suspense fallback={<ExecutionFeedFallback run={stage.run} />}>
        {showExecution ? (
          <AgentExecutionStageFeed run={stage.run} keepOpenWhileRunActive={keepOpenWhileRunActive} />
        ) : (
          <AgentExecutionStageFold run={stage.run} />
        )}
      </Suspense>
    ) : null;
  return (
    <section
      className="assistant-turn-stage"
      data-assistant-turn-stage={stage.kind}
      data-current-stage={stage.current ? "true" : "false"}
    >
      {stage.kind === "final" ? execution : null}
      {stage.message ? <TurnMessageSegment message={stage.message} run={stage.run} /> : null}
      {stage.transientContent && stage.transientKind ? (
        <AssistantMessageBody message={{ kind: stage.transientKind, content: stage.transientContent }} streaming />
      ) : null}
      {stage.kind === "execution" ? execution : null}
      {stage.current ? (
        <StageInteractionContent run={stage.run} onResolveInteractionInput={onResolveInteractionInput} />
      ) : null}
    </section>
  );
}

function readLatestToolStageId(stages: readonly RenderedAssistantStage[]): string | undefined {
  const latestExecutionStage = [...stages]
    .reverse()
    .find((stage) => stage.kind === "execution" && stage.run?.steps.some(hasNamedToolStep));
  return latestExecutionStage?.id ?? [...stages].reverse().find((stage) => stage.run?.steps.some(hasNamedToolStep))?.id;
}

function hasNamedToolStep(step: NonNullable<AssistantTurnListItem["run"]>["steps"][number]): boolean {
  return step.kind === "tool" && Boolean(step.toolName?.trim());
}

function TurnMessageSegment({
  message,
  run,
}: {
  message: ChatMessage;
  run: AssistantTurnListItem["run"];
}): JSX.Element {
  const content = readAssistantDisplayContent(message, run);
  const streaming =
    message.kind === "AssistantToolPreface" && run?.status === "running" && run.displayMessageId === message.id;
  return (
    <div id={readAssistantTurnAnchorId(message)} data-assistant-turn-segment={message.kind ?? "AssistantFinal"}>
      <AssistantMessageBody message={{ ...message, content }} streaming={streaming} />
    </div>
  );
}

function StageInteractionContent({
  run,
  onResolveInteractionInput,
}: {
  run?: AssistantTurnListItem["run"];
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}): JSX.Element {
  if (!run) return <></>;
  return (
    <div className="assistant-turn-stage-interactions" data-assistant-turn-execution>
      <InteractionInputStrip
        interactions={run.interactionInputs ?? []}
        disabled={!onResolveInteractionInput}
        onResolve={(interactionId, action, content) => onResolveInteractionInput?.(interactionId, action, content)}
      />
    </div>
  );
}

function ExecutionFeedFallback({ run }: { run: NonNullable<AssistantTurnListItem["run"]> }): JSX.Element {
  const activity = run.liveActivity;
  if (!activity || runActivityPresentationPriority(activity) !== "foreground") {
    return <div className="min-h-5" aria-hidden="true" />;
  }
  return (
    <div className="flex min-h-5 items-center gap-2 text-[13px] text-content-secondary" role="status">
      <Spinner size="sm" />
      <span>{activeRunActivityLabel(activity)}</span>
    </div>
  );
}

function readTransientPreface(turn: AssistantTurnListItem, prefaces: readonly ChatMessage[]): string {
  const { run } = turn;
  if (!turn.streaming || run?.visibleKind !== "tool_preface" || !run.displayText) return "";
  if (run.displayMessageId && prefaces.some((message) => message.id === run.displayMessageId)) return "";
  return run.displayText;
}

function readTransientAnswer(turn: AssistantTurnListItem, terminalMessages: readonly ChatMessage[]): string {
  const { run } = turn;
  if (!turn.streaming || !run?.displayText) return "";
  if (run.visibleKind !== "final_answer" && run.visibleKind !== "ask_user") return "";
  if (run.outputState === "available" || run.outputState === "committed") return "";
  if (run.displayMessageId && terminalMessages.some((message) => message.id === run.displayMessageId)) return "";
  return run.displayText;
}

function readTurnCopyContent(turn: AssistantTurnListItem, transientPreface: string, transientAnswer: string): string {
  const segments = turn.messages
    .map((message) => readAssistantDisplayContent(message, turn.run).trim())
    .filter(Boolean);
  if (transientPreface.trim()) segments.push(transientPreface.trim());
  if (transientAnswer.trim()) segments.push(transientAnswer.trim());
  return segments.join("\n\n");
}

function projectTransientStages(
  stages: readonly AssistantTurnStage[],
  turn: AssistantTurnListItem,
  transientPreface: string,
  transientAnswer: string,
): RenderedAssistantStage[] {
  const projected: RenderedAssistantStage[] = stages.map((stage) => ({ ...stage }));
  if (transientPreface) {
    const current = projected.find((stage) => stage.current && stage.kind === "execution" && !stage.message);
    if (current) {
      current.transientContent = transientPreface;
      current.transientKind = "AssistantToolPreface";
    } else {
      projected.forEach((stage) => {
        stage.current = false;
      });
      projected.push({
        id: readTransientStageId(turn, "transient-preface"),
        kind: "execution",
        run: projectCurrentStageRun(turn.run),
        current: true,
        transientContent: transientPreface,
        transientKind: "AssistantToolPreface",
      });
    }
  }
  if (transientAnswer) {
    const current = projected.find((stage) => stage.current && stage.kind === "final" && !stage.message);
    if (current) {
      current.transientContent = transientAnswer;
      current.transientKind = turn.run?.visibleKind === "ask_user" ? "AssistantAsk" : "AssistantFinal";
    } else {
      projected.forEach((stage) => {
        stage.current = false;
      });
      projected.push({
        id: readTransientStageId(turn, "transient-answer"),
        kind: "final",
        current: true,
        transientContent: transientAnswer,
        transientKind: turn.run?.visibleKind === "ask_user" ? "AssistantAsk" : "AssistantFinal",
      });
    }
  }
  return projected;
}

function readTransientStageId(turn: AssistantTurnListItem, fallback: string): string {
  const matchingDecision = [...(turn.run?.steps ?? [])]
    .reverse()
    .find((step) => step.kind === (turn.run?.visibleKind === "final_answer" ? "answer" : "decision"));
  return `stage:${turn.requestId ?? turn.key}:${matchingDecision ? `step:${matchingDecision.id}` : fallback}`;
}

function projectCurrentStageRun(run?: AssistantTurnListItem["run"]): AssistantTurnListItem["run"] {
  if (!run) return undefined;
  return {
    ...run,
    steps: run.steps.filter(
      (step) => step.kind === "tool" || step.kind === "delegation" || step.kind === "retry" || step.kind === "error",
    ),
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    outputState: "pending",
  };
}
