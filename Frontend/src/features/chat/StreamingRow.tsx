import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { ApprovalDecision } from "../../api/approvalEventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { AgentExecutionFeed } from "../workflow/AgentExecutionFeed";
import { ApprovalRequestStrip } from "./ApprovalRequestStrip";
import { InteractionInputStrip } from "./InteractionInputStrip";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import { ConversationFrame } from "../../shared/ui";

export interface StreamingRowProps {
  run: RunRecord;
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
  approvalDisabled = false,
  onResolveApproval,
  onResolveInteractionInput,
}: StreamingRowProps): JSX.Element {
  return (
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
            <AgentExecutionFeed run={run} />
          </div>
        </div>
      </div>
    </ConversationFrame>
  );
}
