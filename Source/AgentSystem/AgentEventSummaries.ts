import {
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "./AgentEventCatalog.js";
import type { AgentEventSpec } from "./AgentEventBase.js";
import { readXmlRootName } from "./Xml/AgentXmlRootReader.js";

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

export function summarizeXmlDocument(xml: string, options: {
  sanitized: boolean;
  detailId: string;
}): AgentEventSpec<typeof AgentEventKinds.DecisionXmlSummary, {
  chars: number;
  lines: number;
  root?: string;
  sanitized: boolean;
  detailId: string;
}> {
  return {
    kind: AgentEventKinds.DecisionXmlSummary,
    layer: AgentEventLayers.Snapshot,
    phase: AgentEventPhases.Decision,
    data: {
      chars: xml.length,
      lines: countLines(xml),
      root: readXmlRootName(xml),
      sanitized: options.sanitized,
      detailId: options.detailId,
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
