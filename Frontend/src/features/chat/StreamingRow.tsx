import type { InteractionInputAction, InteractionInputContent } from "../../api/eventTypes";
import type { RunRecord } from "../../store/sessionStore";
import { AssistantTurnRow } from "./AssistantTurnRow";

export interface StreamingRowProps {
  sessionId: string;
  run: RunRecord;
  /** True once the active tool-preface event has its own message row in the list. */
  hasActiveToolPrefaceMessage?: boolean;
  onResolveInteractionInput?: (
    interactionId: string,
    action: InteractionInputAction,
    content?: InteractionInputContent,
  ) => void;
}

export function StreamingRow({
  sessionId,
  run,
  hasActiveToolPrefaceMessage = false,
  onResolveInteractionInput,
}: StreamingRowProps): JSX.Element {
  return (
    <AssistantTurnRow
      sessionId={sessionId}
      turn={{
        __assistantTurn: true,
        key: `assistant-turn:${run.requestId}:0`,
        requestId: run.requestId,
        createdAt: run.startedAt,
        messages:
          hasActiveToolPrefaceMessage && run.displayMessageId
            ? [
                {
                  id: run.displayMessageId,
                  role: "assistant",
                  kind: "AssistantToolPreface",
                  requestId: run.requestId,
                  content: run.displayText,
                  createdAt: run.startedAt,
                },
              ]
            : [],
        run,
        streaming: true,
      }}
      showInlineActions={false}
      onForkFromMessage={() => undefined}
      onRegenerate={() => undefined}
      onDeleteFromMessage={() => undefined}
      onViewWorkflow={() => undefined}
      onResolveInteractionInput={onResolveInteractionInput}
    />
  );
}
