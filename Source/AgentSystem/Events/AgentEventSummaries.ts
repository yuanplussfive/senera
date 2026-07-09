import {
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "./AgentEventCatalog.js";
import type { AgentEventSpec } from "./AgentEventBase.js";

export function summarizePrompt(prompt: string, tokenCount: number): AgentEventSpec<typeof AgentEventKinds.PromptSummary, {
  chars: number;
  lines: number;
  tokenCount: number;
}> {
  return {
    kind: AgentEventKinds.PromptSummary,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Prompt,
    data: {
      chars: prompt.length,
      lines: countLines(prompt),
      tokenCount,
    },
  };
}

function countLines(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  let lines = 1;
  for (const char of value) {
    if (char === "\n") {
      lines += 1;
    }
  }
  return lines;
}
