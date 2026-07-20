import type { ModelProviderListItem } from "../../api/eventTypes";
import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { ApprovalDecision } from "../../api/approvalEventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { AgentExecutionFeed } from "../workflow/AgentExecutionFeed";
import { ApprovalRequestStrip } from "./ApprovalRequestStrip";
import { InteractionInputStrip } from "./InteractionInputStrip";
import { MessageAvatar, MessageMeta } from "./MessageChrome";
import { readRunDisplayName } from "./messagePresentation";

export interface StreamingRowProps {
  run: RunRecord;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
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
  assistantAvatarIcon,
  selectedModelProvider,
  approvalDisabled = false,
  onResolveApproval,
  onResolveInteractionInput,
}: StreamingRowProps): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <MessageAvatar role="assistant" icon={assistantAvatarIcon} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageMeta title={readRunDisplayName(run, selectedModelProvider)} timestamp={run.startedAt} />
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
  );
}
