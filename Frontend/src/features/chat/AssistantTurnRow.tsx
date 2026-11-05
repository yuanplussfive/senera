import { lazy, memo, Suspense, useEffect, useId, useState } from "react";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { FeedbackCategory, FeedbackRating } from "../../api/feedbackEventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { cn } from "../../lib/util";
import type { ChatMessage, ConversationIdentity, ModelThinkingBlock } from "../../store/sessionStore";
import { DEFAULT_ASSISTANT_PROFILE } from "../../store/session/userProfile";
import { ActivityLoader, ActivityStatusIcon, AppIcon, ConversationFrame, ExecutionStatusTones } from "../../shared/ui";
import { activeRunActivityLabel, runActivityPresentationPriority } from "../workflow/runActivityPresentation";
import { readRunStatusLabel } from "../workflow/stepPresentation";
import { AssistantMessageBody } from "./AssistantMessageBody";
import { InteractionInputStrip } from "./InteractionInputStrip";
import { MessageActions } from "./MessageActions";
import { MessageFeedbackControl } from "./MessageFeedbackControl";
import { MessageMetrics } from "./MessageMetrics";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import {
  MotionList,
  MotionListItem,
  MotionDisclosure,
  StableActivitySlot,
  textShimmerStyle,
} from "../../shared/motion";
import { InitialThinkingIndicator, RunThinkingPresentation } from "./ModelThinkingDisclosure";
import { preloadMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { scheduleIdleTask } from "../../shared/scheduling/scheduleIdleTask";
import { readAssistantDisplayContent } from "./messagePresentation";
import type { AssistantTurnStage } from "./assistantTurnStageProjection";
import { hasActiveExecutionWork, projectAssistantTurnPresentation } from "./assistantTurnPresentationProjection";
import {
  readAssistantTurnActionMessage,
  readAssistantTurnAnchorId,
  type AssistantTurnListItem,
} from "./assistantTurnProjection";

const loadAgentExecutionFeed = () => import("../workflow/AgentExecutionFeed");
const AgentExecutionStageFeed = lazy(() =>
  loadAgentExecutionFeed().then((module) => ({ default: module.AgentExecutionStageFeed })),
);
const AgentExecutionStageFold = lazy(() =>
  loadAgentExecutionFeed().then((module) => ({ default: module.AgentExecutionStageFold })),
);
const loadToolRunOutputSummary = () => import("../workflow/ToolRunOutputSummary");
const ToolRunOutputSummary = lazy(() =>
  loadToolRunOutputSummary().then((module) => ({ default: module.ToolRunOutputSummary })),
);

export interface AssistantTurnRowProps {
  sessionId: string;
  turn: AssistantTurnListItem;
  assistantProfile?: ConversationIdentity;
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
  onRecordMessageFeedback?: (
    sessionId: string,
    requestId: string,
    rating: FeedbackRating | null,
    category?: FeedbackCategory,
  ) => void;
}

export const AssistantTurnRow = memo(function AssistantTurnRow({
  sessionId,
  turn,
  assistantProfile = DEFAULT_ASSISTANT_PROFILE,
  showInlineActions,
  onForkFromMessage,
  onRegenerate,
  onDeleteFromMessage,
  onViewWorkflow,
  onResolveInteractionInput,
  onRecordMessageFeedback,
}: AssistantTurnRowProps): JSX.Element {
  useFrontendLocale();
  const { run } = turn;
  const runRequestId = run?.requestId;
  const runStatus = run?.status;
  const runStepsLength = run?.steps.length ?? 0;
  useEffect(() => {
    if (runStepsLength === 0) return;
    const preload = (): void => {
      void Promise.all([preloadMarkdownRenderer(), loadAgentExecutionFeed(), loadToolRunOutputSummary()]);
    };
    if (runStatus === "running" || runStatus === "cancelling") {
      preload();
      return;
    }
    return scheduleIdleTask(preload);
  }, [runRequestId, runStatus, runStepsLength]);
  const actionMessage = readAssistantTurnActionMessage(turn);
  const fallbackMessage = turn.messages.at(-1);
  const forkBoundary = actionMessage ?? (turn.requestId ? { requestId: turn.requestId } : undefined);
  const {
    copyContent,
    renderedStages,
    showTerminalPresentation,
    terminalFinalStage,
    terminalProcessStages,
    terminalThinkingBlocks,
    showTerminalDisclosure,
    thinkingProjectionStageId,
    showLiveWaiting,
    liveActivityStage,
    liveTextActivityExists,
    liveTextActivityStageId,
    liveExecutionStageId,
    executionPresentationStageId,
    activeExecutionStageIds,
  } = projectAssistantTurnPresentation(turn);
  const [terminalProcessOpen, setTerminalProcessOpen] = useState(false);
  const terminalProcessId = useId();

  useEffect(() => {
    if (!showTerminalDisclosure) setTerminalProcessOpen(false);
  }, [showTerminalDisclosure]);

  return (
    <ConversationFrame
      mode="wide"
      className="group/msg"
      data-message-hover-surface
      data-assistant-turn={turn.requestId ?? turn.key}
    >
      <div className="flex min-w-0 items-start gap-4" data-assistant-message>
        <AssistantMessageAvatar profile={assistantProfile} />
        <div className="assistant-turn-content min-w-0 flex-1">
          <MessageMeta title={assistantProfile.name} timestamp={turn.createdAt} />
          <AssistantTurnPresentation
            run={run}
            stages={renderedStages}
            terminalPresentation={showTerminalPresentation}
            finalStage={terminalFinalStage}
            processStages={terminalProcessStages}
            processThinkingBlocks={terminalThinkingBlocks}
            processOpen={showTerminalDisclosure && terminalProcessOpen}
            processId={terminalProcessId}
            thinkingProjectionStageId={thinkingProjectionStageId}
            showLiveWaiting={showLiveWaiting}
            liveActivityStageId={liveActivityStage?.id}
            liveTextActivityExists={liveTextActivityExists}
            liveTextActivityStageId={liveTextActivityStageId}
            liveExecutionStageId={liveExecutionStageId}
            executionPresentationStageId={executionPresentationStageId}
            activeExecutionStageIds={activeExecutionStageIds}
            onProcessOpenChange={setTerminalProcessOpen}
            onResolveInteractionInput={onResolveInteractionInput}
          />

          {run ? (
            <Suspense fallback={null}>
              <ToolRunOutputSummary run={run} />
            </Suspense>
          ) : null}

          {/* Hover-only metadata is suspended below the turn without reserving
              layout. When it is always visible (touch/compact), it returns to
              flow so it cannot overlap the next turn. */}
          <div className={cn("relative", !showInlineActions && "h-0")}>
            <div
              className={cn(
                "flex min-h-6 min-w-0 items-center gap-3 select-none empty:hidden",
                showInlineActions
                  ? "mt-3"
                  : "absolute inset-x-0 top-0 pt-1 opacity-0 pointer-events-none transition-opacity group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto",
              )}
              data-message-hover-meta
            >
              <MessageMetrics
                role="assistant"
                usage={run?.usage ?? actionMessage?.metadata?.run?.usage}
                run={run}
                modelProvider={run?.modelProvider ?? actionMessage?.metadata?.run?.modelProvider}
              />

              {forkBoundary ? (
                <div className="ml-auto flex min-w-0 items-center gap-1">
                  {actionMessage && turn.requestId && onRecordMessageFeedback ? (
                    <MessageFeedbackControl
                      sessionId={sessionId}
                      requestId={turn.requestId}
                      onRecord={onRecordMessageFeedback}
                    />
                  ) : null}
                  <MessageActions
                    content={copyContent}
                    placement="left"
                    hasRequestId
                    hasWorkflow={!!run && !!(actionMessage ?? fallbackMessage)}
                    allowFork
                    allowMutation={!!actionMessage}
                    allowCopy={!!copyContent}
                    onFork={() => onForkFromMessage(forkBoundary)}
                    onRegenerate={() => actionMessage && onRegenerate(actionMessage)}
                    onDelete={() => actionMessage && onDeleteFromMessage(actionMessage)}
                    onViewWorkflow={() => {
                      const workflowMessage = actionMessage ?? fallbackMessage;
                      if (workflowMessage) onViewWorkflow(workflowMessage);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </ConversationFrame>
  );
}, areAssistantTurnRowPropsEqual);

function AssistantTurnPresentation({
  stages,
  terminalPresentation,
  finalStage,
  processStages,
  processThinkingBlocks,
  processOpen,
  processId,
  run,
  thinkingProjectionStageId,
  showLiveWaiting,
  liveActivityStageId,
  liveTextActivityExists,
  liveTextActivityStageId,
  liveExecutionStageId,
  executionPresentationStageId,
  activeExecutionStageIds,
  onProcessOpenChange,
  onResolveInteractionInput,
}: {
  stages: readonly RenderedAssistantStage[];
  terminalPresentation: boolean;
  finalStage?: RenderedAssistantStage;
  processStages: readonly RenderedAssistantStage[];
  processThinkingBlocks: readonly ModelThinkingBlock[];
  processOpen: boolean;
  processId: string;
  run?: AssistantTurnListItem["run"];
  thinkingProjectionStageId?: string;
  showLiveWaiting: boolean;
  liveActivityStageId?: string;
  liveTextActivityExists: boolean;
  liveTextActivityStageId?: string;
  liveExecutionStageId?: string;
  executionPresentationStageId?: string;
  activeExecutionStageIds: ReadonlySet<string>;
  onProcessOpenChange: (open: boolean) => void;
  onResolveInteractionInput?: AssistantStageProps["onResolveInteractionInput"];
}): JSX.Element {
  const displayStages = terminalPresentation ? processStages : stages;
  const hasTerminalProcess = terminalPresentation && (processStages.length > 0 || processThinkingBlocks.length > 0);

  return (
    <div
      className="assistant-turn-flow"
      data-assistant-turn-stage-list
      data-assistant-turn-settled={terminalPresentation || undefined}
    >
      {hasTerminalProcess ? (
        <button
          type="button"
          className="group flex min-w-0 w-full items-center gap-1.5 border-b border-line-subtle py-[5px] text-left text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-5 text-content-secondary transition-colors hover:text-content-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus"
          aria-controls={processId}
          aria-expanded={processOpen}
          onClick={() => {
            onProcessOpenChange(!processOpen);
          }}
          data-settled-turn-toggle
        >
          <SettledRunSummary run={run} fallback={frontendMessage("chat.metrics.process")} />
          <AppIcon
            icon="chevron-right"
            size="1em"
            strokeWidth={1.7}
            className={cn("ml-0.5 shrink-0 transition-transform duration-200", processOpen && "rotate-90")}
            aria-hidden="true"
          />
        </button>
      ) : (
        <RunElapsedRow run={run} />
      )}
      <MotionDisclosure
        id={processId}
        open={terminalPresentation ? processOpen : true}
        strategy="stable"
        lazyMount
        className="assistant-turn-process-disclosure"
      >
        <div
          className={cn("min-w-0", terminalPresentation && "assistant-turn-process-list flex flex-col")}
          data-settled-turn-process={terminalPresentation || undefined}
        >
          {terminalPresentation && processThinkingBlocks.length > 0 ? (
            <RunThinkingPresentation blocks={processThinkingBlocks} />
          ) : null}
          {displayStages.map((stage) => (
            <AssistantStage
              key={stage.id}
              stage={stage}
              thinkingRun={!terminalPresentation && stage.id === thinkingProjectionStageId ? run : undefined}
              showLiveWaiting={!terminalPresentation && showLiveWaiting && stage.id === liveActivityStageId}
              liveActivity={!terminalPresentation && !liveTextActivityExists && stage.id === liveExecutionStageId}
              liveTextActivity={!terminalPresentation && stage.id === liveTextActivityStageId}
              onResolveInteractionInput={onResolveInteractionInput}
              showExecution={
                !terminalPresentation &&
                (stage.id === executionPresentationStageId || activeExecutionStageIds.has(stage.id))
              }
              displayMode={terminalPresentation ? "process" : "normal"}
            />
          ))}
        </div>
      </MotionDisclosure>
      {terminalPresentation && finalStage ? <TerminalFinalResponse stage={finalStage} /> : null}
    </div>
  );
}

function TerminalFinalResponse({ stage }: { stage: RenderedAssistantStage }): JSX.Element {
  return (
    <section className="assistant-turn-stage" data-assistant-turn-stage="final" data-current-stage="false">
      {stage.responseItems ? (
        <MotionList presence="static" className="assistant-turn-response-items min-w-0">
          {stage.responseItems
            .filter((item) => item.kind === "message")
            .map((item) => {
              if (item.kind !== "message") return null;
              return (
                <MotionListItem key={item.message.id} className="assistant-turn-response-item min-w-0" initial={false}>
                  <TurnMessageSegment message={item.message} run={stage.run} liveActivity={false} />
                </MotionListItem>
              );
            })}
        </MotionList>
      ) : stage.message ? (
        <TurnMessageSegment message={stage.message} run={stage.run} liveActivity={false} />
      ) : null}
      {stage.transientContent && stage.transientKind ? (
        <AssistantMessageBody message={{ kind: stage.transientKind, content: stage.transientContent }} />
      ) : null}
    </section>
  );
}

function areAssistantTurnRowPropsEqual(previous: AssistantTurnRowProps, next: AssistantTurnRowProps): boolean {
  if (
    previous.sessionId !== next.sessionId ||
    previous.assistantProfile?.name !== next.assistantProfile?.name ||
    previous.assistantProfile?.avatarDataUrl !== next.assistantProfile?.avatarDataUrl ||
    previous.showInlineActions !== next.showInlineActions ||
    previous.onForkFromMessage !== next.onForkFromMessage ||
    previous.onRegenerate !== next.onRegenerate ||
    previous.onDeleteFromMessage !== next.onDeleteFromMessage ||
    previous.onViewWorkflow !== next.onViewWorkflow ||
    previous.onResolveInteractionInput !== next.onResolveInteractionInput ||
    previous.onRecordMessageFeedback !== next.onRecordMessageFeedback
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

function RunElapsedRow({ run }: { run?: AssistantTurnListItem["run"] }): JSX.Element {
  return (
    <div
      className="flex min-w-0 items-center border-b border-line-subtle py-[5px] text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-5 text-content-secondary"
      data-assistant-turn-duration
    >
      <RunElapsedText run={run} />
    </div>
  );
}

function SettledRunSummary({ run, fallback }: { run?: AssistantTurnListItem["run"]; fallback: string }): JSX.Element {
  if (!run || run.status === "completed") return <RunElapsedText run={run} fallback={fallback} />;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" data-settled-turn-status={run.status}>
      <ActivityStatusIcon status={run.status} size={14} motion="none" />
      <span className={cn("font-medium", ExecutionStatusTones[run.status].text)}>{readRunStatusLabel(run.status)}</span>
      <span className="text-content-muted" aria-hidden="true">
        ·
      </span>
      <RunElapsedText run={run} fallback={fallback} />
    </span>
  );
}

function RunElapsedText({
  run,
  fallback,
}: {
  run?: AssistantTurnListItem["run"];
  fallback?: string;
}): JSX.Element | null {
  const live = run?.status === "running" || run?.status === "cancelling";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live, run?.requestId]);

  const durationMs = readRunElapsedMs(run, live ? now : undefined);
  const text =
    durationMs === undefined
      ? fallback
      : frontendMessage("chat.metrics.elapsed", { duration: formatElapsedDurationMs(durationMs) });
  return text ? <span className="min-w-0 truncate">{text}</span> : null;
}

function readRunElapsedMs(run: AssistantTurnListItem["run"], nowEpoch?: number): number | undefined {
  if (!run) return undefined;
  const startedAt = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAt)) return undefined;
  const live = run.status === "running" || run.status === "cancelling";
  const endEpoch = live
    ? (nowEpoch ?? Date.now())
    : Date.parse(run.endedAt ?? [...run.steps].reverse().find((step) => step.endedAt)?.endedAt ?? run.startedAt);
  if (!Number.isFinite(endEpoch) || endEpoch <= startedAt) return undefined;
  return endEpoch - startedAt;
}

function formatElapsedDurationMs(milliseconds: number): string {
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(frontendMessage("chat.metrics.elapsed.hour", { count: hours }));
  if (minutes > 0 || hours > 0) parts.push(frontendMessage("chat.metrics.elapsed.minute", { count: minutes }));
  if (seconds > 0 || parts.length === 0) parts.push(frontendMessage("chat.metrics.elapsed.second", { count: seconds }));
  return parts.join(getElapsedUnitSeparator());
}

function getElapsedUnitSeparator(): string {
  return frontendMessage("chat.metrics.elapsed.separator");
}

interface AssistantStageProps {
  stage: RenderedAssistantStage;
  thinkingRun?: AssistantTurnListItem["run"];
  showLiveWaiting?: boolean;
  liveActivity?: boolean;
  liveTextActivity?: boolean;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
  showExecution: boolean;
  displayMode?: "normal" | "process" | "final";
}

const AssistantStage = memo(function AssistantStage({
  stage,
  thinkingRun,
  showLiveWaiting = false,
  liveActivity = false,
  liveTextActivity = false,
  onResolveInteractionInput,
  showExecution,
  displayMode = "normal",
}: AssistantStageProps): JSX.Element {
  useFrontendLocale();
  const stageRunActive = stage.run?.status === "running" || stage.run?.status === "cancelling";
  // A genuine live tool or delegation owns its execution view. Generic model
  // waiting stays with this stage's single InitialThinkingIndicator.
  const hasLiveResponseExecution = Boolean(
    stage.responseItems?.some((item) => item.kind === "execution" && hasActiveExecutionWork(item.run)),
  );
  // The execution view, including its loading fallback, owns the slot while
  // real execution work is active.
  const executionOwnsWaiting = Boolean(stage.run && stageRunActive && showExecution);
  const shouldShowInitialThinking = showLiveWaiting && !hasLiveResponseExecution && !executionOwnsWaiting;
  const shouldRenderExecution = !!stage.run && (!stageRunActive || showExecution);
  const execution =
    shouldRenderExecution && stage.run ? (
      <StableActivitySlot stateKey={`execution:${stage.id}`} geometry="content">
        <Suspense fallback={<ExecutionFeedFallback run={stage.run} />}>
          {showExecution ? (
            <AgentExecutionStageFeed run={stage.run} liveActivity={liveActivity} showWaitingActivity={false} />
          ) : (
            <AgentExecutionStageFold run={stage.run} showWaitingActivity={false} />
          )}
        </Suspense>
      </StableActivitySlot>
    ) : null;
  return (
    <section
      className="assistant-turn-stage"
      data-assistant-turn-stage={stage.kind}
      data-current-stage={stage.current ? "true" : "false"}
    >
      {thinkingRun && displayMode === "normal" ? (
        <RunThinkingPresentation run={thinkingRun} showSummaryWhenEmpty />
      ) : null}
      {stage.responseItems ? (
        <>
          <MotionList presence="static" className="assistant-turn-response-items min-w-0">
            {stage.responseItems
              .filter((item) => displayMode !== "final" || item.kind === "message")
              .map((item, index) => {
                const liveActivity = stage.current && index === stage.responseItems!.length - 1;
                if (item.kind === "thinking") {
                  return (
                    <MotionListItem key={item.id} className="assistant-turn-response-item min-w-0" initial={false}>
                      <RunThinkingPresentation blocks={item.blocks} />
                    </MotionListItem>
                  );
                }
                if (item.kind === "message") {
                  return (
                    <MotionListItem
                      key={item.message.id}
                      className="assistant-turn-response-item min-w-0"
                      // A final message is often appended as the run settles. It
                      // must not replay a vertical entrance animation and shift
                      // the already-visible assistant turn for one frame.
                      initial={false}
                    >
                      <TurnMessageSegment message={item.message} run={stage.run} liveActivity={liveActivity} />
                    </MotionListItem>
                  );
                }
                return (
                  <MotionListItem key={item.id} className="assistant-turn-response-item min-w-0" initial={false}>
                    <ResponseExecutionItem run={item.run} liveActivity={liveActivity} />
                  </MotionListItem>
                );
              })}
          </MotionList>
          {stage.responseItems.length === 0 && displayMode !== "final" && stage.kind === "final" ? execution : null}
          {shouldShowInitialThinking && displayMode === "normal" ? <InitialThinkingIndicator /> : null}
        </>
      ) : (
        <>
          {displayMode !== "final" && stage.kind === "final" ? execution : null}
          {stage.message ? (
            <TurnMessageSegment message={stage.message} run={stage.run} liveActivity={liveTextActivity} />
          ) : null}
        </>
      )}
      {stage.transientContent && stage.transientKind ? (
        <AssistantMessageBody
          message={{ kind: stage.transientKind, content: stage.transientContent }}
          streaming
          liveActivity={liveTextActivity}
        />
      ) : null}
      {!stage.responseItems && displayMode !== "final" && stage.kind === "execution" ? execution : null}
      {!stage.responseItems && shouldShowInitialThinking && displayMode === "normal" ? (
        <InitialThinkingIndicator />
      ) : null}
      {stage.current && displayMode === "normal" ? (
        <StageInteractionContent run={stage.run} onResolveInteractionInput={onResolveInteractionInput} />
      ) : null}
    </section>
  );
}, areAssistantStagePropsEqual);

function areAssistantStagePropsEqual(previous: AssistantStageProps, next: AssistantStageProps): boolean {
  return (
    previous.showLiveWaiting === next.showLiveWaiting &&
    previous.liveActivity === next.liveActivity &&
    previous.liveTextActivity === next.liveTextActivity &&
    previous.showExecution === next.showExecution &&
    previous.displayMode === next.displayMode &&
    previous.onResolveInteractionInput === next.onResolveInteractionInput &&
    sameAssistantStage(previous.stage, next.stage) &&
    sameThinkingRun(previous.thinkingRun, next.thinkingRun)
  );
}

function sameAssistantStage(left: RenderedAssistantStage, right: RenderedAssistantStage): boolean {
  return (
    left === right ||
    (left.id === right.id &&
      left.kind === right.kind &&
      left.message === right.message &&
      left.current === right.current &&
      left.transientContent === right.transientContent &&
      left.transientKind === right.transientKind &&
      samePresentationRun(left.run, right.run) &&
      sameResponseItems(left.responseItems, right.responseItems))
  );
}

function sameResponseItems(
  left: AssistantTurnStage["responseItems"],
  right: AssistantTurnStage["responseItems"],
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((item, index) => {
    const candidate = right[index];
    if (
      !candidate ||
      item.id !== candidate.id ||
      item.kind !== candidate.kind ||
      item.modelContentIndex !== candidate.modelContentIndex ||
      item.eventSequence !== candidate.eventSequence
    ) {
      return false;
    }
    if (item.kind === "thinking" && candidate.kind === "thinking") {
      return sameThinkingBlocks(item.blocks, candidate.blocks);
    }
    if (item.kind === "message" && candidate.kind === "message") return item.message === candidate.message;
    return item.kind === "execution" && candidate.kind === "execution" && samePresentationRun(item.run, candidate.run);
  });
}

function sameThinkingRun(
  left: AssistantTurnListItem["run"] | undefined,
  right: AssistantTurnListItem["run"] | undefined,
): boolean {
  return samePresentationRun(left, right) && sameThinkingBlocks(left?.thinkingBlocks, right?.thinkingBlocks);
}

function samePresentationRun(
  left: AssistantTurnListItem["run"] | undefined,
  right: AssistantTurnListItem["run"] | undefined,
): boolean {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.requestId === right.requestId &&
      left.status === right.status &&
      left.steps === right.steps &&
      left.activities === right.activities &&
      left.liveActivity === right.liveActivity &&
      left.activeFlags === right.activeFlags &&
      left.approvals === right.approvals &&
      left.interactionInputs === right.interactionInputs &&
      left.activeModelRequest === right.activeModelRequest &&
      left.outputState === right.outputState &&
      left.visibleKind === right.visibleKind)
  );
}

function sameThinkingBlocks(
  left: readonly ModelThinkingBlock[] | undefined,
  right: readonly ModelThinkingBlock[] | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every(
    (block, index) =>
      block === right[index] ||
      (block.id === right[index]?.id &&
        block.content === right[index]?.content &&
        block.status === right[index]?.status &&
        block.step === right[index]?.step &&
        block.messageIndex === right[index]?.messageIndex &&
        block.contentIndex === right[index]?.contentIndex &&
        block.eventSequence === right[index]?.eventSequence),
  );
}

function ResponseExecutionItem({
  run,
  liveActivity,
}: {
  run: NonNullable<AssistantTurnStage["run"]>;
  liveActivity: boolean;
}): JSX.Element {
  const hasActiveStep = run.steps.some(
    (step) => step.status === "running" || step.status === "pending" || step.status === "cancelling",
  );
  const hasLiveChild = run.steps.some(
    (step) =>
      step.kind === "delegation" &&
      step.childRun &&
      ["queued", "running", "wrapping_up", "cancelling", "awaiting_supervisor"].includes(step.childRun.status),
  );
  const live = hasActiveStep || hasLiveChild || (run.status === "running" && run.steps.length === 0);

  return (
    <StableActivitySlot stateKey={`response-execution:${run.requestId}`} geometry="content">
      <Suspense fallback={<ExecutionFeedFallback run={run} />}>
        {live || liveActivity ? (
          <AgentExecutionStageFeed run={run} liveActivity={liveActivity} showWaitingActivity={false} />
        ) : (
          <AgentExecutionStageFold run={run} />
        )}
      </Suspense>
    </StableActivitySlot>
  );
}

function TurnMessageSegment({
  message,
  run,
  liveActivity,
}: {
  message: ChatMessage;
  run: AssistantTurnListItem["run"];
  liveActivity: boolean;
}): JSX.Element {
  const content = readAssistantDisplayContent(message, run);
  const streaming =
    message.kind === "AssistantToolPreface" && run?.status === "running" && run.displayMessageId === message.id;
  return (
    <div id={readAssistantTurnAnchorId(message)} data-assistant-turn-segment={message.kind ?? "AssistantFinal"}>
      <AssistantMessageBody message={{ ...message, content }} streaming={streaming} liveActivity={liveActivity} />
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
  const foregroundActivity =
    activity && runActivityPresentationPriority(activity) === "foreground" ? activity : undefined;
  if (!foregroundActivity) {
    return isLiveRun(run) ? (
      <LiveActivityFallback />
    ) : (
      <div className="execution-feed-fallback" aria-hidden="true" data-execution-feed-fallback />
    );
  }
  const label = activeRunActivityLabel(foregroundActivity);
  return (
    <div
      className="execution-feed-headline execution-feed-fallback text-content-secondary"
      role="status"
      aria-live="polite"
    >
      <span className="execution-feed-headline__icon text-accent-content" aria-hidden="true">
        <ActivityLoader size={16} active />
      </span>
      <span className="execution-feed-headline__title motion-safe:animate-text-shimmer" style={textShimmerStyle(label)}>
        {label}
      </span>
    </div>
  );
}

function LiveActivityFallback(): JSX.Element {
  return <InitialThinkingIndicator />;
}

function isLiveRun(run: Pick<NonNullable<AssistantTurnListItem["run"]>, "status">): boolean {
  return run.status === "running" || run.status === "cancelling";
}
