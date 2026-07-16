import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ChatMessage } from "../../store/sessionStore";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";

export interface AssistantMessageBodyProps {
  message: Pick<ChatMessage, "content" | "kind">;
}

export function AssistantMessageBody({ message }: AssistantMessageBodyProps): JSX.Element {
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
      {message.kind === "AssistantAsk" ? (
        <div className="mt-2 text-[11px] font-medium text-accent-content">
          {frontendMessage("runtime.migrated.features.chat.AssistantMessageBody.33.11")}
        </div>
      ) : null}
    </div>
  );
}
