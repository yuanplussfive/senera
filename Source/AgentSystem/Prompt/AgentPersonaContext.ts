/** User-authored Markdown rendered as one prompt layer inside the system prompt. */
export interface AgentPersonaContext {
  readonly enabled: boolean;
  readonly card: {
    readonly markdown: string;
    readonly sourcePath?: string;
  };
}

export const EmptyAgentPersonaContext: AgentPersonaContext = {
  enabled: false,
  card: {
    markdown: "",
  },
};

export function createAgentPersonaContext(markdown = "", sourcePath?: string): AgentPersonaContext {
  const normalizedMarkdown = markdown.trim();
  return {
    enabled: normalizedMarkdown.length > 0,
    card: {
      markdown: normalizedMarkdown,
      ...(sourcePath ? { sourcePath } : {}),
    },
  };
}
