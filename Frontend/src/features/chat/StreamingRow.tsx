import { lazy, Suspense } from "react";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { ApprovalBatchReference, ApprovalDecision } from "../../api/approvalEventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { InteractionInputStrip } from "./InteractionInputStrip";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import { ConversationFrame, Spinner } from "../../shared/ui";
import { AssistantMessageBody } from "./AssistantMessageBody";
import { activeRunActivityLabel, runActivityPresentationPriority } from "../workflow/runActivityPresentation";

const ApprovalRequestStrip = lazy(() => import("./ApprovalRequestStrip"));
const AgentExecutionFeed = lazy(() =>
  import("../workflow/AgentExecutionFeed").then((module) => ({ default: module.AgentExecutionFeed })),
);

export interface StreamingRowProps {
  sessionId: string;
  run: RunRecord;
  /** True once the active tool-preface event has its own message row in the list. */
  hasActiveToolPrefaceMessage?: boolean;
  approvalDisabled?: boolean;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveApprovalBatch?: (batch: ApprovalBatchReference, decision: ApprovalDecision) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}

export function StreamingRow({
  sessionId,
  run,
  hasActiveToolPrefaceMessage = false,
  approvalDisabled = false,
  onResolveApproval,
  onResolveApprovalBatch,
  onResolveInteractionInput,
}: StreamingRowProps): JSX.Element {
  const isAnswerStream = run.visibleKind === "final_answer" || run.visibleKind === "ask_user";
  const answerAvailable = run.outputState === "available" || run.outputState === "committed";
  const isToolPrefaceStream = run.visibleKind === "tool_preface";
  const showTransientPreface = isToolPrefaceStream && !!run.displayText && !hasActiveToolPrefaceMessage;
  const answerKind = run.visibleKind === "ask_user" ? "AssistantAsk" : "AssistantFinal";

  return (
    <>
      {showTransientPreface ? (
        <ConversationFrame mode="wide" className="group/msg" data-assistant-tool-preface-stream>
          <div className="flex min-w-0 items-start gap-3" data-assistant-message>
            <AssistantMessageAvatar />
            <div className="min-w-0 flex-1">
              <MessageMeta title="Senera" timestamp={run.startedAt} />
              <AssistantMessageBody message={{ kind: "AssistantToolPreface", content: run.displayText }} streaming />
            </div>
          </div>
        </ConversationFrame>
      ) : null}

      <ConversationFrame mode="wide" className="group/msg">
        <div className="flex min-w-0 items-start gap-3" data-assistant-message>
          <AssistantMessageAvatar />
          <div className="min-w-0 flex-1">
            <MessageMeta title="Senera" timestamp={run.startedAt} />
            <div className="mt-1">
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
                onResolve={(interactionId, action, content) =>
                  onResolveInteractionInput?.(interactionId, action, content)
                }
              />
              <Suspense fallback={<ExecutionFeedFallback run={run} />}>
                <AgentExecutionFeed run={run} showBody={!isAnswerStream && !isToolPrefaceStream} />
              </Suspense>
              {isAnswerStream && !answerAvailable && run.displayText ? (
                <AssistantMessageBody message={{ kind: answerKind, content: run.displayText }} streaming />
              ) : null}
            </div>
          </div>
        </div>
      </ConversationFrame>
    </>
  );
}

function ExecutionFeedFallback({ run }: { run: RunRecord }): JSX.Element {
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
