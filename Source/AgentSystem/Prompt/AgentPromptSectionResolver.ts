import type { AgentPromptSectionOptions } from "./AgentPromptContextTypes.js";

export type ResolvedAgentPromptSections = Required<AgentPromptSectionOptions>;

export const DefaultAgentPromptSections: ResolvedAgentPromptSections = {
  summary: "简述",
  trigger: "何时使用",
  avoid: "不要使用的情况",
};

export function resolveAgentPromptSections(
  value: AgentPromptSectionOptions | undefined,
  fallback: ResolvedAgentPromptSections = DefaultAgentPromptSections,
): ResolvedAgentPromptSections {
  return {
    summary: value?.summary ?? fallback.summary,
    trigger: value?.trigger ?? fallback.trigger,
    avoid: value?.avoid ?? fallback.avoid,
  };
}
