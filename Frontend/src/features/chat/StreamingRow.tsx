import type { ModelProviderListItem } from "../../api/eventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { AgentExecutionFeed } from "../workflow/AgentExecutionFeed";
import { MessageAvatar, MessageMeta } from "./MessageChrome";
import { readRunDisplayName } from "./messagePresentation";

export interface StreamingRowProps {
  run: RunRecord;
  assistantAvatarIcon?: string;
  selectedModelProvider?: ModelProviderListItem;
}

export function StreamingRow({
  run,
  assistantAvatarIcon,
  selectedModelProvider,
}: StreamingRowProps): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <MessageAvatar role="assistant" icon={assistantAvatarIcon} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MessageMeta
          title={readRunDisplayName(run, selectedModelProvider)}
          timestamp={run.startedAt}
        />
        <div className="mt-1">
          <AgentExecutionFeed run={run} />
        </div>
      </div>
    </div>
  );
}
