import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { ApprovalDecision } from "../../api/approvalEventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { AgentExecutionFeed } from "../workflow/AgentExecutionFeed";
import { ApprovalRequestStrip } from "./ApprovalRequestStrip";
import { InteractionInputStrip } from "./InteractionInputStrip";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import { ConversationFrame } from "../../shared/ui";
import { AssistantMessageBody } from "./AssistantMessageBody";

export interface StreamingRowProps {
  run: RunRecord;
  /** True once the active tool-preface event has its own message row in the list. */
  hasActiveToolPrefaceMessage?: boolean;
  approvalDisabled?: boolean;
  onResolveApproval?: (approvalId: string, decision: ApprovalDecision) => void;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}

export function StreamingRow({
  run,
  hasActiveToolPrefaceMessage = false,
  approvalDisabled = false,
  onResolveApproval,
  onResolveInteractionInput,
}: StreamingRowProps): JSX.Element {
  const isAnswerStream = run.visibleKind === "final_answer" || run.visibleKind === "ask_user";
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
              <ApprovalRequestStrip
                approvals={run.approvals ?? []}
                disabled={approvalDisabled || !onResolveApproval}
                onResolve={(approvalId, decision) => onResolveApproval?.(approvalId, decision)}
              />
              <InteractionInputStrip
                interactions={run.interactionInputs ?? []}
                disabled={approvalDisabled || !onResolveInteractionInput}
                onResolve={(interactionId, action, content) =>
                  onResolveInteractionInput?.(interactionId, action, content)
                }
              />
              <AgentExecutionFeed run={run} showBody={!isAnswerStream && !isToolPrefaceStream} />
              {isAnswerStream && run.displayText ? (
                <AssistantMessageBody message={{ kind: answerKind, content: run.displayText }} streaming />
              ) : null}
            </div>
          </div>
        </div>
      </ConversationFrame>
    </>
  );
}
