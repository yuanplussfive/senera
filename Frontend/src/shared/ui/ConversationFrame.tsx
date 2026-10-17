import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/util";

export type ConversationFrameMode = "prose" | "user" | "wide" | "composer";

export interface ConversationFrameProps extends HTMLAttributes<HTMLDivElement> {
  mode?: ConversationFrameMode;
}

export const ConversationFrame = forwardRef<HTMLDivElement, ConversationFrameProps>(function ConversationFrame(
  { mode = "prose", className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("conversation-frame", `conversation-frame--${mode}`, className)} {...props} />;
});
