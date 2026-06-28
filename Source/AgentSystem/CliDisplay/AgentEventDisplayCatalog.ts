import type { AgentEventEnvelope } from "../AgentEvent.js";
import {
  CompactEventCatalog,
  fallbackCompactEventDisplay,
} from "./AgentEventCompactDisplayCatalog.js";
import { eventDisplayMessage } from "./AgentEventDisplayMessages.js";
import {
  compactTokens,
} from "./AgentEventDisplayValueReaders.js";
import type {
  AgentEventDisplayMode,
  AgentRenderedEventDisplay,
} from "./AgentEventDisplayTypes.js";

export type {
  AgentEventDisplayMode,
  AgentRenderedEventDisplay,
} from "./AgentEventDisplayTypes.js";

const VerboseHiddenKeys = new Set([
  "channel",
  "requestId",
  "timestamp",
  "data",
]);

export function renderAgentEventDisplay(
  event: AgentEventEnvelope<string, unknown>,
  mode: AgentEventDisplayMode = "compact",
): AgentRenderedEventDisplay {
  return mode === "verbose"
    ? renderVerboseEventDisplay(event)
    : renderCompactEventDisplay(event);
}

function renderCompactEventDisplay(
  event: AgentEventEnvelope<string, unknown>,
): AgentRenderedEventDisplay {
  const formatter = CompactEventCatalog[event.kind] ?? fallbackCompactEventDisplay;
  const rendered = formatter(event);

  return {
    label: event.kind,
    message: rendered.message,
    tokens: compactTokens(rendered.tokens ?? []),
    details: {},
  };
}

function renderVerboseEventDisplay(
  event: AgentEventEnvelope<string, unknown>,
): AgentRenderedEventDisplay {
  const details = Object.fromEntries(
    Object.entries(event).filter(([key, value]) => !VerboseHiddenKeys.has(key) && value !== undefined),
  );

  return {
    label: event.kind,
    message: eventDisplayMessage(event.kind),
    tokens: [],
    details,
  };
}
