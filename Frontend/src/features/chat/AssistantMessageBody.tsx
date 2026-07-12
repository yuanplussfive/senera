import type { ChatMessage, RunRecord } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
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
    <div className="mt-1 min-w-0">
      {!isToolPreface ? <ThinkingSummaryBar run={run} onViewWorkflow={onViewWorkflow} /> : null}
      {isToolPreface ? (
        <div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-umber-50 px-2 py-0.5 font-mono text-[10.5px] text-umber-600">
          {frontendMessage("chat.toolPrefaceBadge")}
        </div>
      ) : null}
      <LazyMarkdownRenderer className="mt-1 min-w-0" contentClassName="text-[14.5px] leading-[1.85] text-ink-800">
        {message.content}
      </LazyMarkdownRenderer>
      {message.kind === "AssistantAsk" ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-terra-50 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-terra-600">
          {frontendMessage("chat.askUserBadge")}
        </div>
      ) : null}
    </div>
  );
}
