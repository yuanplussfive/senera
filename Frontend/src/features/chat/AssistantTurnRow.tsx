import { lazy, Suspense } from "react";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { ApprovalBatchReference, ApprovalDecision } from "../../api/approvalEventTypes";
import type { ChatMessage } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { ConversationFrame, Spinner } from "../../shared/ui";
import { activeRunActivityLabel, runActivityPresentationPriority } from "../workflow/runActivityPresentation";
import { AssistantMessageBody } from "./AssistantMessageBody";
import { InteractionInputStrip } from "./InteractionInputStrip";
import { MessageActions } from "./MessageActions";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import { readAssistantDisplayContent } from "./messagePresentation";
import { projectAssistantTurnStages, type AssistantTurnStage } from "./assistantTurnStageProjection";
import {
  readAssistantTurnActionMessage,
  readAssistantTurnAnchorId,
  type AssistantTurnListItem,
} from "./assistantTurnProjection";

const ApprovalRequestStrip = lazy(() => import("./ApprovalRequestStrip"));
const AgentExecutionStageFeed = lazy(() =>
  import("../workflow/AgentExecutionFeed").then((module) => ({ default: module.AgentExecutionStageFeed })),
);

export interface AssistantTurnRowProps {
  sessionId: string;
  turn: AssistantTurnListItem;
  showInlineActions: boolean;
  approvalDisabled?: boolean;
  onForkFromMessage: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
  onDeleteFromMessage: (message: ChatMessage) => void;
  onViewWorkflow: (message: ChatMessage) => void;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveApprovalBatch?: (batch: ApprovalBatchReference, decision: ApprovalDecision) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}

export function AssistantTurnRow({
  sessionId,
  turn,
  showInlineActions,
  approvalDisabled = false,
  onForkFromMessage,
  onRegenerate,
  onDeleteFromMessage,
  onViewWorkflow,
  onResolveApproval,
  onResolveApprovalBatch,
  onResolveInteractionInput,
}: AssistantTurnRowProps): JSX.Element {
  const { run } = turn;
  const prefaces = turn.messages.filter((message) => message.kind === "AssistantToolPreface");
  const terminalMessages = turn.messages.filter((message) => message.kind !== "AssistantToolPreface");
  const actionMessage = readAssistantTurnActionMessage(turn);
  const fallbackMessage = turn.messages.at(-1);
  const transientPreface = readTransientPreface(turn, prefaces);
  const transientAnswer = readTransientAnswer(turn, terminalMessages);
  const copyContent = readTurnCopyContent(turn, transientPreface, transientAnswer);
  const stages = projectAssistantTurnStages(turn);
  const renderedStages = projectTransientStages(stages, turn, transientPreface, transientAnswer);

  return (
    <ConversationFrame mode="wide" className="group/msg" data-assistant-turn={turn.requestId ?? turn.key}>
      <div className="flex min-w-0 items-start gap-3" data-assistant-message>
        <AssistantMessageAvatar />
        <div className="min-w-0 flex-1">
          <MessageMeta title="Senera" timestamp={turn.createdAt} />

          <div className="assistant-turn-flow" data-assistant-turn-stage-list>
            {renderedStages.map((stage) => (
              <AssistantStage
                key={stage.id}
                stage={stage}
                sessionId={sessionId}
                approvalDisabled={approvalDisabled}
                onResolveApproval={onResolveApproval}
                onResolveApprovalBatch={onResolveApprovalBatch}
                onResolveInteractionInput={onResolveInteractionInput}
              />
            ))}
          </div>

          {fallbackMessage && copyContent ? (
            <MessageActions
              content={copyContent}
              placement="left"
              hasRequestId={!!turn.requestId}
              hasWorkflow={!!run}
              allowMutation={!!actionMessage}
              showInlineActions={showInlineActions}
              onFork={() => actionMessage && onForkFromMessage(actionMessage)}
              onRegenerate={() => actionMessage && onRegenerate(actionMessage)}
              onDelete={() => actionMessage && onDeleteFromMessage(actionMessage)}
              onViewWorkflow={() => onViewWorkflow(actionMessage ?? fallbackMessage)}
            />
          ) : null}
        </div>
      </div>
    </ConversationFrame>
  );
}

interface RenderedAssistantStage extends AssistantTurnStage {
}

function AssistantStage({
  stage,
  sessionId,
  approvalDisabled,
  onResolveApproval,
  onResolveApprovalBatch,
  onResolveInteractionInput,
}: {
  stage: RenderedAssistantStage;
  sessionId: string;
  approvalDisabled: boolean;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveApprovalBatch?: (batch: ApprovalBatchReference, decision: ApprovalDecision) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}): JSX.Element {
  return (
    <section
      className="assistant-turn-stage"
      data-assistant-turn-stage={stage.kind}
      data-current-stage={stage.current ? "true" : "false"}
    >
      {stage.run ? (
        <Suspense fallback={<ExecutionFeedFallback run={stage.run} />}>
          <AgentExecutionStageFeed run={stage.run} />
        </Suspense>
      ) : null}
      {stage.message ? <TurnMessageSegment message={stage.message} run={stage.run} /> : null}
      {stage.transientContent && stage.transientKind ? (
        <AssistantMessageBody
          message={{ kind: stage.transientKind, content: stage.transientContent }}
          streaming
        />
      ) : null}
      {stage.current ? (
        <StageInteractionContent
          sessionId={sessionId}
          run={stage.run}
          approvalDisabled={approvalDisabled}
          onResolveApproval={onResolveApproval}
          onResolveApprovalBatch={onResolveApprovalBatch}
          onResolveInteractionInput={onResolveInteractionInput}
        />
      ) : null}
    </section>
  );
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
  sessionId,
  run,
  approvalDisabled,
  onResolveApproval,
  onResolveApprovalBatch,
  onResolveInteractionInput,
}: {
  sessionId: string;
  run?: AssistantTurnListItem["run"];
  approvalDisabled: boolean;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveApprovalBatch?: (batch: ApprovalBatchReference, decision: ApprovalDecision) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}): JSX.Element {
  if (!run) return <></>;
  return (
    <div className="assistant-turn-stage-interactions" data-assistant-turn-execution>
      {run.approvals?.some((approval) => approval.status === "pending") ? (
        <Suspense
          fallback={
            <div className="mb-3 flex h-12 items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 text-[12px] text-content-secondary">
              <Spinner size="sm" />
              {frontendMessage("approval.waiting")}
            </div>
          }
        >
          <ApprovalRequestStrip
            sessionId={sessionId}
            requestId={run.requestId}
            approvals={run.approvals}
            disabled={approvalDisabled || (!onResolveApproval && !onResolveApprovalBatch)}
            onResolve={(approvalId, decision) => onResolveApproval?.(approvalId, decision)}
            onResolveBatch={(batch, decision) => onResolveApprovalBatch?.(batch, decision)}
          />
        </Suspense>
      ) : null}
      <InteractionInputStrip
        interactions={run.interactionInputs ?? []}
        disabled={approvalDisabled || !onResolveInteractionInput}
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

function readTurnCopyContent(
  turn: AssistantTurnListItem,
  transientPreface: string,
  transientAnswer: string,
): string {
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
        id: `stage:${turn.requestId ?? turn.key}:transient-preface`,
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
        id: `stage:${turn.requestId ?? turn.key}:transient-answer`,
        kind: "final",
        current: true,
        transientContent: transientAnswer,
        transientKind: turn.run?.visibleKind === "ask_user" ? "AssistantAsk" : "AssistantFinal",
      });
    }
  }
  return projected;
}

function projectCurrentStageRun(run?: AssistantTurnListItem["run"]): AssistantTurnListItem["run"] {
  if (!run) return undefined;
  return {
    ...run,
    steps: run.steps.filter((step) =>
      step.kind === "tool" || step.kind === "delegation" || step.kind === "retry" || step.kind === "error"),
    visibleText: "",
    displayText: "",
    visibleKind: "unknown",
    outputState: "pending",
  };
}
