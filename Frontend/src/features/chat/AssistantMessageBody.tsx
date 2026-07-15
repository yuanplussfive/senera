import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ChatMessage, RunRecord } from "../../store/sessionStore";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { ThinkingSummaryBar } from "./ThinkingSummaryBar";

export interface AssistantMessageBodyProps {
  message: Pick<ChatMessage, "content" | "kind">;
  run?: RunRecord;
  onViewWorkflow: () => void;
}

export function AssistantMessageBody({ message, run, onViewWorkflow }: AssistantMessageBodyProps): JSX.Element {
  const isToolPreface = message.kind === "AssistantToolPreface";
  return (
    <div className="assistant-message-flow mt-1 min-w-0">
      {isToolPreface ? (
        <div className="mb-1.5 text-[11px] font-medium text-umber-600">
          {frontendMessage("runtime.migrated.features.chat.AssistantMessageBody.22.11")}
        </div>
      ) : null}
      <LazyMarkdownRenderer
        className="mt-1 min-w-0"
        contentClassName="text-[length:var(--theme-chat-assistant-font-size)] leading-[var(--theme-chat-assistant-line-height)] text-ink-800"
      >
        {message.content}
      </LazyMarkdownRenderer>
      {!isToolPreface ? <ThinkingSummaryBar run={run} onViewWorkflow={onViewWorkflow} /> : null}
      {message.kind === "AssistantAsk" ? (
        <div className="mt-2 text-[11px] font-medium text-terra-600">
          {frontendMessage("runtime.migrated.features.chat.AssistantMessageBody.33.11")}
        </div>
      ) : null}
    </div>
  );
}
