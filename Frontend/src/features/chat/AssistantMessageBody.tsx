import type { ChatMessage, RunRecord } from "../../store/sessionStore";
import { LazyMarkdownRenderer } from "../../shared/code/LazyMarkdownRenderer";
import { ThinkingSummaryBar } from "./ThinkingSummaryBar";

export interface AssistantMessageBodyProps {
  message: Pick<ChatMessage, "content" | "kind">;
  run?: RunRecord;
  onViewWorkflow: () => void;
}

export function AssistantMessageBody({
  message,
  run,
  onViewWorkflow,
}: AssistantMessageBodyProps): JSX.Element {
  return (
    <div className="mt-1 min-w-0">
      <ThinkingSummaryBar run={run} onViewWorkflow={onViewWorkflow} />
      <LazyMarkdownRenderer
        className="mt-1 min-w-0"
        contentClassName="text-[14.5px] leading-[1.85] text-ink-800"
      >
        {message.content}
      </LazyMarkdownRenderer>
      {message.kind === "AskUser" ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-terra-50 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-terra-600">
          需要你的回复
        </div>
      ) : null}
    </div>
  );
}
