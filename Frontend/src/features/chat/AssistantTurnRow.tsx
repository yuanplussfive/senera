import { lazy, memo, Suspense, useEffect, useId, useState } from "react";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import type { ChatMessage, ConversationIdentity } from "../../store/sessionStore";
import { DEFAULT_ASSISTANT_PROFILE } from "../../store/session/userProfile";
import { ActivityLoader, ActivityStatusIcon, AppIcon, ConversationFrame, ExecutionStatusTones } from "../../shared/ui";
import { activeRunActivityLabel, runActivityPresentationPriority } from "../workflow/runActivityPresentation";
import { isChildRunActive } from "../workflow/ChildRunOverview";
import { readRunStatusLabel } from "../workflow/stepPresentation";
import { AssistantMessageBody } from "./AssistantMessageBody";
import { InteractionInputStrip } from "./InteractionInputStrip";
import { MessageActions } from "./MessageActions";
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
import { projectAssistantTurnStages, type AssistantTurnStage } from "./assistantTurnStageProjection";
import { isRunTerminal } from "../../store/session/sessionRunProjection";
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
}

export const AssistantTurnRow = memo(function AssistantTurnRow({
  turn,
  assistantProfile = DEFAULT_ASSISTANT_PROFILE,
  showInlineActions,
  onForkFromMessage,
  onRegenerate,
  onDeleteFromMessage,
  onViewWorkflow,
  onResolveInteractionInput,
}: AssistantTurnRowProps): JSX.Element {
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
  const hasResponseOrderedThinking = renderedStages.some((stage) => stage.responseItems !== undefined);
  const showLiveExecution = run?.status === "running" || run?.status === "cancelling";
  const liveToolStageId = showLiveExecution ? readLatestToolStageId(renderedStages) : undefined;
  const currentStageId = renderedStages.find((stage) => stage.current)?.id;
  const foregroundActivity =
    showLiveExecution && run?.liveActivity && runActivityPresentationPriority(run.liveActivity) === "foreground";
  const liveExecutionStageId = liveToolStageId ?? (foregroundActivity ? currentStageId : undefined);
  const activeExecutionStageIds = showLiveExecution ? readActiveExecutionStageIds(renderedStages) : new Set<string>();
  const liveTextActivityExists = Boolean(
    transientPreface ||
    transientAnswer ||
    run?.thinkingBlocks?.some((block) => block.status === "streaming" && block.content.trim()),
  );
  const liveTextActivityStageId = liveTextActivityExists ? currentStageId : undefined;
  // `visibleText` is the provider-side target. It can be populated before the
  // display ticker has produced a paintable fragment, so using it here would
  // remove the thinking slot and leave an empty frame before the answer.
  const hasCurrentRunText = Boolean(run?.displayText?.trim());
  const hasStreamingThinking = Boolean(
    run?.thinkingBlocks?.some((block) => block.status === "streaming" && block.content.trim()),
  );
  // Completed thinking blocks are historical context, not a visible answer.
  // Keep the live placeholder available while the model is between blocks.
  const hasCurrentStageResponse = renderedStages.some(
    (stage) => stage.current && hasVisibleStageResponse(stage, { includeThinking: false }),
  );
  const hasPendingUserAction = Boolean(
    run?.approvals?.some((approval) => approval.status === "pending") ||
    run?.interactionInputs?.some((interaction) => interaction.status !== "resolved"),
  );
  const hasRenderableActiveExecution = [...activeExecutionStageIds].some((stageId) => {
    const stage = renderedStages.find((candidate) => candidate.id === stageId);
    return stage?.run?.steps.some(isRenderableExecutionStep) ?? false;
  });
  const liveRunWaiting = run?.status === "running" || (!run && turn.streaming);
  const showLiveWaiting =
    liveRunWaiting &&
    !hasCurrentRunText &&
    !hasStreamingThinking &&
    !hasCurrentStageResponse &&
    !hasPendingUserAction &&
    !foregroundActivity &&
    !hasRenderableActiveExecution;
  const liveActivityStage = renderedStages.find((stage) => stage.current) ?? renderedStages.at(-1);
  const thinkingProjectionStageId = hasResponseOrderedThinking
    ? undefined
    : (currentStageId ?? renderedStages.at(-1)?.id);
  const terminalFinalStage = readTerminalFinalStage(renderedStages, run);
  const terminalProcessStages = projectTerminalProcessStages(renderedStages, terminalFinalStage?.id);
  const hasTerminalExecution = terminalProcessStages.some(hasExecutionStageContent);
  const showTerminalPresentation = terminalFinalStage !== undefined || (isTerminalRun(run) && hasTerminalExecution);
  const showTerminalDisclosure = showTerminalPresentation && terminalProcessStages.length > 0;
  const [terminalProcessOpen, setTerminalProcessOpen] = useState(false);
  const terminalProcessId = useId();

  useEffect(() => {
    if (!showTerminalDisclosure) setTerminalProcessOpen(false);
  }, [showTerminalDisclosure]);

  return (
    <ConversationFrame mode="wide" className="group/msg" data-assistant-turn={turn.requestId ?? turn.key}>
      <div className="flex min-w-0 items-start gap-4" data-assistant-message>
        <AssistantMessageAvatar profile={assistantProfile} />
        <div className="assistant-turn-content min-w-0 flex-1">
          <MessageMeta title={assistantProfile.name} timestamp={turn.createdAt} />
          {showTerminalPresentation ? (
            <TerminalTurnPresentation
              finalStage={terminalFinalStage}
              processStages={terminalProcessStages}
              processOpen={showTerminalDisclosure && terminalProcessOpen}
              processId={terminalProcessId}
              run={run}
              onProcessOpenChange={setTerminalProcessOpen}
            />
          ) : (
            <div className="assistant-turn-flow" data-assistant-turn-stage-list>
              <RunElapsedRow run={run} />
              {renderedStages.map((stage) => (
                <AssistantStage
                  key={stage.id}
                  stage={stage}
                  thinkingRun={stage.id === thinkingProjectionStageId ? run : undefined}
                  showLiveWaiting={showLiveWaiting && stage.id === liveActivityStage?.id}
                  liveActivity={!liveTextActivityExists && stage.id === liveExecutionStageId}
                  liveTextActivity={stage.id === liveTextActivityStageId}
                  onResolveInteractionInput={onResolveInteractionInput}
                  showExecution={stage.id === liveExecutionStageId || activeExecutionStageIds.has(stage.id)}
                />
              ))}
            </div>
          )}

          {run ? (
            <Suspense fallback={null}>
              <ToolRunOutputSummary run={run} />
            </Suspense>
          ) : null}

          <div
            className={cn(
              "mt-3 flex min-h-6 min-w-0 items-center gap-3 overflow-hidden opacity-0 pointer-events-none transition-opacity group-hover/msg:opacity-100 group-hover/msg:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto empty:hidden",
              showInlineActions && "opacity-100 pointer-events-auto",
            )}
          >
            <MessageMetrics
              role="assistant"
              usage={run?.usage ?? actionMessage?.metadata?.run?.usage}
              run={run}
              modelProvider={run?.modelProvider ?? actionMessage?.metadata?.run?.modelProvider}
            />

            {forkBoundary ? (
              <div className="ml-auto flex min-w-0">
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
    </ConversationFrame>
  );
}, areAssistantTurnRowPropsEqual);

function TerminalTurnPresentation({
  finalStage,
  processStages,
  processOpen,
  processId,
  run,
  onProcessOpenChange,
}: {
  finalStage?: RenderedAssistantStage;
  processStages: readonly RenderedAssistantStage[];
  processOpen: boolean;
  processId: string;
  run?: AssistantTurnListItem["run"];
  onProcessOpenChange: (open: boolean) => void;
}): JSX.Element {
  const hasProcess = processStages.length > 0;

  return (
    <div className="assistant-turn-flow" data-assistant-turn-stage-list data-assistant-turn-settled>
      {hasProcess ? (
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
      {hasProcess ? (
        <MotionDisclosure id={processId} open={processOpen} className="assistant-turn-process-disclosure">
          <div className="assistant-turn-process-list flex min-w-0 flex-col" data-settled-turn-process>
            {processStages.map((stage) => (
              <AssistantStage key={stage.id} stage={stage} displayMode="process" showExecution={false} />
            ))}
          </div>
        </MotionDisclosure>
      ) : null}
      {finalStage ? <AssistantStage stage={finalStage} displayMode="final" showExecution={false} /> : null}
    </div>
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

function readTerminalFinalStage(
  stages: readonly RenderedAssistantStage[],
  run?: AssistantTurnListItem["run"],
): RenderedAssistantStage | undefined {
  if (!isTerminalRun(run)) return undefined;
  return [...stages]
    .reverse()
    .find(
      (stage) =>
        stage.kind === "final" &&
        (Boolean(stage.message) ||
          Boolean(stage.responseItems?.some((item) => item.kind === "message")) ||
          Boolean(stage.transientContent?.trim())),
    );
}

function projectTerminalProcessStages(
  stages: readonly RenderedAssistantStage[],
  finalStageId?: string,
): RenderedAssistantStage[] {
  return stages.flatMap((stage) => {
    const isFinalStage = stage.id === finalStageId;
    const processResponseItems = isFinalStage
      ? stage.responseItems?.filter((item) => item.kind !== "message")
      : stage.responseItems;
    const projected: RenderedAssistantStage = {
      ...stage,
      current: false,
      ...(isFinalStage
        ? {
            message: undefined,
            transientContent: undefined,
            transientKind: undefined,
          }
        : {}),
      responseItems: processResponseItems,
    };
    const hasProcessContent =
      Boolean(projected.message) ||
      Boolean(projected.transientContent?.trim()) ||
      Boolean(projected.run?.steps.length) ||
      Boolean(projected.responseItems?.length);
    return hasProcessContent ? [projected] : [];
  });
}

function isTerminalRun(run?: AssistantTurnListItem["run"]): boolean {
  return run !== undefined && isRunTerminal(run);
}

function hasExecutionStageContent(stage: RenderedAssistantStage): boolean {
  return Boolean(stage.run?.steps.length) || Boolean(stage.responseItems?.some((item) => item.kind === "execution"));
}

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

function AssistantStage({
  stage,
  thinkingRun,
  showLiveWaiting = false,
  liveActivity = false,
  liveTextActivity = false,
  onResolveInteractionInput,
  showExecution,
  displayMode = "normal",
}: {
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
}): JSX.Element {
  const stageRunActive = stage.run?.status === "running" || stage.run?.status === "cancelling";
  // A live response execution item owns its own generic waiting row when the
  // provider has not exposed a renderable tool yet. Do not add the stage-level
  // placeholder alongside it, otherwise one model turn briefly shows two
  // identical "Thinking" rows while the response timeline is being built.
  const hasLiveResponseExecution = Boolean(
    stage.responseItems?.some((item) => item.kind === "execution" && isLiveRun(item.run)),
  );
  // Once an active execution is mounted, its Suspense/fallback row owns the
  // waiting slot. Keeping the stage placeholder at the same time creates two
  // Thinking rows during the short lazy-load window.
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
        <RunThinkingPresentation run={thinkingRun} current={liveTextActivity} showSummaryWhenEmpty />
      ) : null}
      {stage.responseItems ? (
        <>
          <MotionList presence="static" className="assistant-turn-response-items min-w-0">
            {stage.responseItems
              .filter((item) => displayMode !== "final" || item.kind === "message")
              .map((item, index) => {
                const liveActivity =
                  stage.liveActivityItemId === item.id || (stage.current && index === stage.responseItems!.length - 1);
                if (item.kind === "thinking") {
                  return (
                    <MotionListItem key={item.id} className="assistant-turn-response-item min-w-0" initial={false}>
                      <RunThinkingPresentation blocks={item.blocks} current={liveActivity} />
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

function readLatestToolStageId(stages: readonly RenderedAssistantStage[]): string | undefined {
  const latestExecutionStage = [...stages]
    .reverse()
    .find((stage) => stage.kind === "execution" && stage.run?.steps.some(hasNamedToolStep));
  return latestExecutionStage?.id ?? [...stages].reverse().find((stage) => stage.run?.steps.some(hasNamedToolStep))?.id;
}

function readActiveExecutionStageIds(stages: readonly RenderedAssistantStage[]): ReadonlySet<string> {
  return new Set(stages.filter((stage) => stage.run?.steps.some(isUnfinishedExecutionStep)).map((stage) => stage.id));
}

function isUnfinishedExecutionStep(step: NonNullable<AssistantTurnListItem["run"]>["steps"][number]): boolean {
  const activeChildRun = step.kind === "delegation" && step.childRun && isChildRunActive(step.childRun.status);
  if (activeChildRun) return true;
  if (step.status !== "pending" && step.status !== "running" && step.status !== "cancelling") return false;
  return step.kind === "delegation" || (step.kind === "tool" && Boolean(step.toolName?.trim()));
}

function isRenderableExecutionStep(step: NonNullable<AssistantTurnListItem["run"]>["steps"][number]): boolean {
  return (step.kind === "tool" && Boolean(step.toolName?.trim())) || step.kind === "delegation";
}

function hasVisibleStageResponse(
  stage: RenderedAssistantStage,
  { includeThinking = true }: { includeThinking?: boolean } = {},
): boolean {
  if (stage.transientContent?.trim()) return true;
  if (stage.message && readAssistantDisplayContent(stage.message, stage.run).trim()) return true;
  return Boolean(
    stage.responseItems?.some((item) => {
      if (item.kind === "message") return Boolean(readAssistantDisplayContent(item.message, stage.run).trim());
      if (item.kind === "thinking") return includeThinking && item.blocks.some((block) => block.content.trim());
      return false;
    }),
  );
}

function hasNamedToolStep(step: NonNullable<AssistantTurnListItem["run"]>["steps"][number]): boolean {
  return step.kind === "tool" && Boolean(step.toolName?.trim());
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
        run: projectCurrentStageRun(turn.run),
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
