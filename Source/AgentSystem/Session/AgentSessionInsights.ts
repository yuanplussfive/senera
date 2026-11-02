import { setImmediate } from "node:timers/promises";
import { AgentEventKinds } from "../Events/AgentEvent.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";
import type { AgentSessionInsightsPage } from "./AgentSessionInsightsContract.js";
import { projectAgentToolArguments } from "../Core/AgentToolArgumentProjection.js";
import { collectAgentToolPresentationArgumentPointers } from "../SystemTools/AgentSystemToolPresentation.js";
import type { AgentToolEventOrigin } from "../ToolRuntime/AgentToolEventOrigin.js";

// Analytics retains declared action targets, never raw prompts, tool bodies or results.
const InsightFields = new Map<string, readonly string[]>([
  [AgentEventKinds.ModelStarted, ["model", "provider", "messageIndex", "contextSnapshot"]],
  [
    AgentEventKinds.ModelCompleted,
    ["model", "responseModel", "provider", "messageIndex", "outcome", "errorMessage", "usage"],
  ],
  [AgentEventKinds.RunCompleted, ["usage"]],
  [AgentEventKinds.SessionCompacted, ["sessionId", "tokensBefore", "estimatedTokensAfter", "boundaryId"]],
  [
    AgentEventKinds.ToolCallStarted,
    ["index", "callId", "toolName", "startedAt", "origin", "modelMessageIndex", "batchId", "executionMode"],
  ],
  [AgentEventKinds.ToolCallCompleted, ["index", "callId", "toolName", "startedAt", "durationMs"]],
  [
    AgentEventKinds.ToolCallFailed,
    ["index", "callId", "toolName", "startedAt", "durationMs", "message", "localizedMessage"],
  ],
]);

const PageSize = 128;
const ActionPreviewBudget = { maxBytes: 4096, maxLeafBytes: 256, maxArrayEntries: 16, maxObjectEntries: 16 } as const;

function projectInsightData(
  kind: string,
  data: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const projected = Object.fromEntries(fields.filter((key) => key in data).map((key) => [key, data[key]]));
  if (kind === AgentEventKinds.ToolCallStarted && data.arguments !== undefined) {
    const origin = data.origin as AgentToolEventOrigin | undefined;
    const keepPointers = collectAgentToolPresentationArgumentPointers(origin?.presentation);
    if (keepPointers.length > 0) {
      const action = projectAgentToolArguments(data.arguments, { ...ActionPreviewBudget, keepPointers });
      // A second bounded projection enforces the aggregate cap even for wildcard declarations.
      projected.arguments = projectAgentToolArguments(action.value, { ...ActionPreviewBudget, keepPointers: [] }).value;
    }
  }
  return projected;
}

export async function readAgentSessionInsights(
  store: Pick<AgentSessionStore, "captureHistorySnapshot" | "loadRunEventPage">,
  input: { sessionId: string; after?: number; through?: number; signal?: AbortSignal },
): Promise<AgentSessionInsightsPage | undefined> {
  const snapshot = store.captureHistorySnapshot(input.sessionId);
  if (!snapshot) return undefined;
  const through = Math.min(input.through ?? Infinity, snapshot.runEventHighWaterMark ?? 0);
  const events: AgentEventEnvelope[] = [];
  let after = input.after;
  for (;;) {
    input.signal?.throwIfAborted();
    const page = store.loadRunEventPage(input.sessionId, { after, through, pageSize: PageSize });
    for (const event of page.items) {
      const fields = InsightFields.get(event.kind);
      if (!fields || typeof event.data !== "object" || !event.data) continue;
      const data = event.data as Record<string, unknown>;
      events.push({
        ...event,
        data: projectInsightData(event.kind, data, fields),
      });
    }
    after = page.nextCursor;
    if (after === undefined || events.length >= PageSize)
      return { sessionId: input.sessionId, through, nextCursor: after, events };
    // Large streams of model deltas are scanned locally, without flooding the browser or blocking other sessions.
    await setImmediate();
  }
}
