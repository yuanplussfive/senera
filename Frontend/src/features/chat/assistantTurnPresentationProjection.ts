import type { ChatMessage } from "../../store/sessionStore";
import { isRunTerminal } from "../../store/session/sessionRunProjection";
import { isChildRunActive } from "../workflow/childRunPresentation";
import { runActivityPresentationPriority } from "../workflow/runActivityPresentation";
import type { AssistantTurnListItem } from "./assistantTurnProjection";
import { projectAssistantTurnStages, type AssistantTurnStage } from "./assistantTurnStageProjection";
import { readAssistantDisplayContent } from "./messagePresentation";

type RenderedAssistantStage = AssistantTurnStage;

/** Derives live and settled chronology without coupling it to the row's render lifecycle. */
export function projectAssistantTurnPresentation(turn: AssistantTurnListItem) {
  const { run } = turn;
  const prefaces = turn.messages.filter((message) => message.kind === "AssistantToolPreface");
  const terminalMessages = turn.messages.filter((message) => message.kind !== "AssistantToolPreface");
  const transientPreface = readTransientPreface(turn, prefaces);
  const transientAnswer = readTransientAnswer(turn, terminalMessages);
  const copyContent = readTurnCopyContent(turn, transientPreface, transientAnswer);
  const stages = projectAssistantTurnStages(turn);
  const renderedStages = projectTransientStages(stages, turn, transientPreface, transientAnswer);
  const hasResponseOrderedThinking = renderedStages.some((stage) => stage.responseItems !== undefined);
  const showLiveExecution = run?.status === "running" || run?.status === "cancelling";
  const currentStageId = renderedStages.find((stage) => stage.current)?.id;
  const foregroundActivity =
    showLiveExecution && run?.liveActivity && runActivityPresentationPriority(run.liveActivity) === "foreground";
  const activeExecutionStageIds = showLiveExecution ? readActiveExecutionStageIds(renderedStages) : new Set<string>();
  const liveExecutionStageId = foregroundActivity ? currentStageId : readLatestActiveExecutionStageId(renderedStages);
  const executionPresentationStageId = foregroundActivity
    ? currentStageId
    : (readLatestToolStageId(renderedStages) ?? liveExecutionStageId);
  const liveTextActivityExists = Boolean(
    transientPreface ||
    transientAnswer ||
    run?.thinkingBlocks?.some((block) => block.status === "streaming" && block.content.trim()),
  );
  const liveTextActivityStageId = liveTextActivityExists ? currentStageId : undefined;
  // `visibleText` is the provider-side target. Preserve the thinking slot until
  // the display projection has a paintable fragment, avoiding an empty frame
  // across a model-stage handoff.
  const hasCurrentRunText = Boolean(run?.displayText?.trim());
  const hasStreamingThinking = Boolean(
    run?.thinkingBlocks?.some((block) => block.status === "streaming" && block.content.trim()),
  );
  const hasCurrentAnswerResponse = renderedStages.some((stage) => stage.current && hasVisibleStageAnswer(stage));
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
    !hasCurrentAnswerResponse &&
    !hasPendingUserAction &&
    !foregroundActivity &&
    !hasRenderableActiveExecution;
  const liveActivityStage = renderedStages.find((stage) => stage.current) ?? renderedStages.at(-1);
  const thinkingProjectionStageId = hasResponseOrderedThinking
    ? undefined
    : (currentStageId ?? renderedStages.at(-1)?.id);
  const terminalFinalStage = readTerminalFinalStage(renderedStages, run);
  const terminalProcessStages = projectTerminalProcessStages(renderedStages, terminalFinalStage?.id);
  // Compact historical traces predate model-response coordinates. Preserve
  // their thinking once at turn level rather than inventing stage attribution.
  const terminalThinkingBlocks =
    isTerminalRun(run) && !hasResponseOrderedThinking
      ? (run?.thinkingBlocks ?? []).filter((block) => block.content.trim())
      : [];
  const hasTerminalExecution = terminalProcessStages.some(hasExecutionStageContent);
  const hasTerminalThinking = Boolean(run?.thinkingBlocks?.some((block) => block.content.trim()));
  const showTerminalPresentation =
    terminalFinalStage !== undefined || (isTerminalRun(run) && (hasTerminalExecution || hasTerminalThinking));
  const showTerminalDisclosure =
    showTerminalPresentation && (terminalProcessStages.length > 0 || terminalThinkingBlocks.length > 0);
  return {
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
  };
}

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

function readLatestActiveExecutionStageId(stages: readonly RenderedAssistantStage[]): string | undefined {
  return [...stages].reverse().find((stage) => stage.run && hasActiveExecutionWork(stage.run))?.id;
}

function readLatestToolStageId(stages: readonly RenderedAssistantStage[]): string | undefined {
  const latestExecutionStage = [...stages]
    .reverse()
    .find((stage) => stage.kind === "execution" && stage.run?.steps.some(hasNamedToolStep));
  return latestExecutionStage?.id ?? [...stages].reverse().find((stage) => stage.run?.steps.some(hasNamedToolStep))?.id;
}

function readActiveExecutionStageIds(stages: readonly RenderedAssistantStage[]): ReadonlySet<string> {
  return new Set(stages.filter((stage) => stage.run && hasActiveExecutionWork(stage.run)).map((stage) => stage.id));
}

export function hasActiveExecutionWork(run: Pick<NonNullable<AssistantTurnListItem["run"]>, "steps">): boolean {
  return run.steps.some(isUnfinishedExecutionStep);
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

function hasVisibleStageAnswer(stage: RenderedAssistantStage): boolean {
  if (stage.transientKind !== "AssistantToolPreface" && stage.transientContent?.trim()) return true;
  if (
    stage.message &&
    stage.message.kind !== "AssistantToolPreface" &&
    readAssistantDisplayContent(stage.message, stage.run).trim()
  ) {
    return true;
  }
  return Boolean(
    stage.responseItems?.some(
      (item) =>
        item.kind === "message" &&
        item.message.kind !== "AssistantToolPreface" &&
        readAssistantDisplayContent(item.message, stage.run).trim(),
    ),
  );
}

function hasNamedToolStep(step: NonNullable<AssistantTurnListItem["run"]>["steps"][number]): boolean {
  return step.kind === "tool" && Boolean(step.toolName?.trim());
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
