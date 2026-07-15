import type { ModelProviderListItem } from "../../api/eventTypes";
import type { ApprovalResolutionScope } from "../../api/approvalEventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { AgentExecutionFeed } from "../workflow/AgentExecutionFeed";
import { ApprovalRequestStrip } from "./ApprovalRequestStrip";
import { MessageMeta } from "./MessageChrome";
import { readRunDisplayName } from "./messagePresentation";
import { ConversationFrame } from "../../shared/ui";

export interface StreamingRowProps {
  run: RunRecord;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
  approvalDisabled?: boolean;
  onResolveApproval?: (approvalId: string, status: "approved" | "denied", scope?: ApprovalResolutionScope) => void;
}

export function StreamingRow({
  run,
  selectedModelProvider,
  approvalDisabled = false,
  onResolveApproval,
}: StreamingRowProps): JSX.Element {
  return (
    <ConversationFrame mode="wide" className="group/msg">
      <div className="flex min-w-0 flex-col">
        <MessageMeta title={readRunDisplayName(run, selectedModelProvider)} timestamp={run.startedAt} />
        <div className="mt-1">
          <ApprovalRequestStrip
            approvals={run.approvals ?? []}
            disabled={approvalDisabled || !onResolveApproval}
            onResolve={(approvalId, approvalStatus, scope) => onResolveApproval?.(approvalId, approvalStatus, scope)}
          />
          <AgentExecutionFeed run={run} />
        </div>
      </div>
    </ConversationFrame>
  );
}
