import type { ChatMessage } from "../../store/sessionStore";

export interface SystemMessageRowProps {
  message: Pick<ChatMessage, "content">;
}

export function SystemMessageRow({ message }: SystemMessageRowProps): JSX.Element {
  return (
    <div className="mx-auto max-w-md rounded-md border border-brick-100 bg-brick-50/60 px-3 py-1.5 text-center text-[12px] text-brick-600">
      {message.content}
    </div>
  );
}
