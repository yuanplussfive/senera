export interface AgentPromptHarnessSectionStat {
  readonly bytes: number;
  readonly tokens: number;
  readonly revision: string;
}

export interface AgentPromptHarnessSectionInput {
  readonly text: string;
  readonly revision: string;
}

export interface AgentPromptHarnessComposition {
  readonly text: string;
  readonly sections: {
    readonly frozen: AgentPromptHarnessSectionStat;
    readonly stable: AgentPromptHarnessSectionStat;
    readonly volatile: AgentPromptHarnessSectionStat;
  };
  readonly merged: {
    readonly bytes: number;
    readonly tokens: number;
  };
}

export interface AgentPromptHarnessEstimatePort {
  estimateTokens(text: string): number;
}

const SectionOrder = ["frozen", "stable", "volatile"] as const;

/**
 * Composes the three-tier prompt harness: byte-stable platform truth, mostly
 * stable contracts, and per-turn reference material. Every tier is measured
 * so the economics of the context are auditable instead of implied.
 */
export function composeAgentPromptHarness(
  input: Readonly<Record<(typeof SectionOrder)[number], AgentPromptHarnessSectionInput>>,
  estimate: AgentPromptHarnessEstimatePort,
): AgentPromptHarnessComposition {
  const sections = {
    frozen: projectSection(input.frozen, estimate),
    stable: projectSection(input.stable, estimate),
    volatile: projectSection(input.volatile, estimate),
  };
  const { text, bytes } = joinSections({ sections, input });
  return {
    text,
    sections,
    merged: { bytes, tokens: estimate.estimateTokens(text) },
  };
}

function projectSection(
  input: AgentPromptHarnessSectionInput,
  estimate: AgentPromptHarnessEstimatePort,
): AgentPromptHarnessSectionStat {
  const trimmed = input.text.trim();
  return {
    bytes: byteLength(trimmed),
    tokens: trimmed.length === 0 ? 0 : estimate.estimateTokens(trimmed),
    revision: input.revision,
  };
}

function joinSections(input: {
  sections: Readonly<Record<(typeof SectionOrder)[number], AgentPromptHarnessSectionStat>>;
  input: Readonly<Record<(typeof SectionOrder)[number], AgentPromptHarnessSectionInput>>;
}): { text: string; bytes: number } {
  const parts = SectionOrder.flatMap((name) => {
    const text = input.input[name].text.trim();
    return text.length > 0 ? [text] : [];
  });
  if (parts.length === 0) return { text: "", bytes: 0 };
  const text = parts.join("\n\n");
  return { text, bytes: byteLength(text) };
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
