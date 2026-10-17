import type { AgentChannelFinalPart } from "./AgentChannelOutboundMedia.js";
import { splitChannelTextByParagraphs } from "./AgentChannelText.js";

/**
 * Controls only the transport-friendly grouping of adjacent prose parts.
 * Resource and code parts remain hard boundaries and never count towards the
 * text target.
 */
export interface AgentChannelFinalTextPackingPolicy {
  readonly minTextParts: number;
  readonly maxTextParts: number;
}

export const AgentChannelFinalTextPackingDefaults: Readonly<AgentChannelFinalTextPackingPolicy> = Object.freeze({
  minTextParts: 3,
  maxTextParts: 6,
});

/**
 * Normalizes model-authored final parts for channel transport. The model may
 * preserve semantic boundaries, while the host prevents ordinary prose from
 * becoming one outbound message per paragraph.
 */
export function packAgentChannelFinalTextParts(
  parts: readonly AgentChannelFinalPart[],
  policy: AgentChannelFinalTextPackingPolicy = AgentChannelFinalTextPackingDefaults,
): AgentChannelFinalPart[] {
  const resolved = resolvePolicy(policy);
  const packed: AgentChannelFinalPart[] = [];
  let textRun: string[] = [];

  const flushTextRun = (): void => {
    if (textRun.length === 0) return;
    const joined = textRun.join("\n\n");
    const chunks = splitChannelTextByParagraphs(joined, resolved.maxTextParts);
    packed.push(...chunks.map((text) => ({ kind: "text", text }) satisfies AgentChannelFinalPart));
    textRun = [];
  };

  for (const part of parts) {
    if (part.kind === "text") {
      const text = part.text.trim();
      if (text) textRun.push(text);
      continue;
    }
    flushTextRun();
    packed.push(part);
  }
  flushTextRun();
  return packed;
}

function resolvePolicy(policy: AgentChannelFinalTextPackingPolicy): AgentChannelFinalTextPackingPolicy {
  const minTextParts = positiveInteger(policy.minTextParts, AgentChannelFinalTextPackingDefaults.minTextParts);
  const maxTextParts = Math.max(
    minTextParts,
    positiveInteger(policy.maxTextParts, AgentChannelFinalTextPackingDefaults.maxTextParts),
  );
  return { minTextParts, maxTextParts };
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
