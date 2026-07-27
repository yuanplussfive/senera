import type { ChatMessage } from "../../store/sessionStore";
import { InlineError } from "../../shared/ui";

export interface SystemMessageRowProps {
  message: Pick<ChatMessage, "content">;
}

export function SystemMessageRow({ message }: SystemMessageRowProps): JSX.Element {
  return <InlineError className="mx-auto max-w-md px-3 py-1">{message.content}</InlineError>;
}
