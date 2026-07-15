import type { ApprovalResolutionScope } from "../../api/approvalEventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { AgentExecutionFeed } from "../workflow/AgentExecutionFeed";
import { ApprovalRequestStrip } from "./ApprovalRequestStrip";
import { AssistantMessageAvatar, MessageMeta } from "./MessageChrome";
import { ConversationFrame } from "../../shared/ui";

export interface StreamingRowProps {
  run: RunRecord;
  approvalDisabled?: boolean;
  onResolveApproval?: (approvalId: string, status: "approved" | "denied", scope?: ApprovalResolutionScope) => void;
}

export function StreamingRow({
  run,
  approvalDisabled = false,
  onResolveApproval,
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
              onResolve={(approvalId, approvalStatus, scope) => onResolveApproval?.(approvalId, approvalStatus, scope)}
            />
            <AgentExecutionFeed run={run} />
          </div>
        </div>
      </div>
    </ConversationFrame>
  );
}
