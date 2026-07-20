import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ChatMessage } from "../../store/sessionStore";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";

export interface AssistantMessageBodyProps {
  message: Pick<ChatMessage, "content" | "kind">;
}

export function AssistantMessageBody({ message }: AssistantMessageBodyProps): JSX.Element {
  return (
    <div className="assistant-message-flow mt-1 min-w-0">
      <LazyMarkdownRenderer
        className="mt-1 min-w-0"
        contentClassName="text-[length:var(--theme-chat-assistant-font-size)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
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
