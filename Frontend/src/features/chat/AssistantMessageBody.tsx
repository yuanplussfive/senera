import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { ChatMessage } from "../../store/sessionStore";
import { ChatMessageMarkdown } from "./ChatMessageMarkdown";

export interface AssistantMessageBodyProps {
  message: Pick<ChatMessage, "content" | "kind">;
  streaming?: boolean;
  liveActivity?: boolean;
}

export function AssistantMessageBody({
  message,
  streaming = false,
  liveActivity = false,
}: AssistantMessageBodyProps): JSX.Element {
  return (
    <div className="assistant-message-flow mt-3 min-w-0" data-live-activity={liveActivity || undefined}>
      {streaming ? (
        <ChatMessageMarkdown
          content={message.content}
          streaming
          className="mt-1 min-w-0 text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
          contentClassName="text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
          externalLinkPresentation="citation"
        />
      ) : (
        <ChatMessageMarkdown
          content={message.content}
          className="mt-1 min-w-0"
          contentClassName="text-[length:var(--theme-chat-assistant-font-size-scaled)] leading-[var(--theme-chat-assistant-line-height)] text-content-primary"
          externalLinkPresentation="citation"
        />
      )}
      {message.kind === "AssistantAsk" ? (
        <div className="mt-2 text-[11px] font-medium text-accent-content">{frontendMessage("chat.askUserBadge")}</div>
      ) : null}
    </div>
  );
}
