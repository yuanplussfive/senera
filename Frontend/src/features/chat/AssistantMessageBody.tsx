import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ChatMessage } from "../../store/sessionStore";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { StreamingMarkdownRenderer } from "../../shared/code/StreamingMarkdownRenderer";

export interface AssistantMessageBodyProps {
  message: Pick<ChatMessage, "content" | "kind">;
  streaming?: boolean;
}

export function AssistantMessageBody({ message, streaming = false }: AssistantMessageBodyProps): JSX.Element {
  return (
    <div className="assistant-message-flow mt-1 min-w-0">
      {streaming ? (
        <StreamingMarkdownRenderer
          className="mt-1 min-w-0 text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
          contentClassName="text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
          externalLinkPresentation="citation"
        >
          {message.content}
        </StreamingMarkdownRenderer>
      ) : (
        <LazyMarkdownRenderer
          className="mt-1 min-w-0"
          contentClassName="text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
          externalLinkPresentation="citation"
        >
          {message.content}
        </LazyMarkdownRenderer>
      )}
      {message.kind === "AssistantAsk" ? (
        <div className="mt-2 text-[11px] font-medium text-accent-content">{frontendMessage("chat.askUserBadge")}</div>
      ) : null}
    </div>
  );
}
