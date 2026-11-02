import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";

/** Only safe Pi boundaries may introduce additional user input. */
export interface AgentPiInputBoundary {
  readonly phase: "start" | "steer" | "follow_up" | "observe";
  readonly committedInputs: ReadonlySet<string>;
  readonly committedToolCalls?: ReadonlySet<string>;
  readonly continuation?: boolean;
}

export type AgentPiInputBoundaryHandler = (boundary: AgentPiInputBoundary) => Promise<void>;

/** Only successful, durable native results acknowledge a model observation. */
export function readAgentPiCommittedToolCalls(manager: SessionManager): ReadonlySet<string> {
  return readAgentPiCommittedReceipts(manager).toolCalls;
}

export function readAgentPiCommittedInputs(manager: SessionManager): ReadonlySet<string> {
  return readAgentPiCommittedReceipts(manager).inputs;
}

/** One branch traversal serves both durable inbox and tool observation receipts. */
export function readAgentPiCommittedReceipts(manager: SessionManager) {
  const receipts = new Set<string>();
  const inputs = new Set<string>();
  let requestId: string | undefined;
  for (const entry of manager.getBranch()) {
    if (entry.type === "custom" && entry.customType === AgentPiSessionCustomEntryTypes.TurnBoundary) {
      const data: unknown = entry.data;
      requestId =
        typeof data === "object" && data !== null && "requestId" in data && typeof data.requestId === "string"
          ? data.requestId
          : undefined;
    }
    if (requestId && entry.type === "message" && entry.message.role === "toolResult" && !entry.message.isError)
      receipts.add(JSON.stringify([requestId, entry.message.toolCallId]));
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const content = entry.message.content;
    inputs.add(
      typeof content === "string"
        ? content
        : content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
    );
  }
  return { inputs, toolCalls: receipts };
}
