/**
 * The complete user-authored persona surface.  Runtime prompts intentionally
 * accept only these two text fields; memories, tools, runtime state and current
 * requests remain separate host-owned context layers.
 */
export interface AgentPersonaContext {
  readonly enabled: boolean;
  readonly card: {
    readonly corePersona: string;
    readonly languageStyle: string;
  };
}

export const EmptyAgentPersonaContext: AgentPersonaContext = {
  enabled: false,
  card: {
    corePersona: "",
    languageStyle: "",
  },
};

export function createAgentPersonaContext(corePersona = "", languageStyle = ""): AgentPersonaContext {
  const normalizedCorePersona = corePersona.trim();
  const normalizedLanguageStyle = languageStyle.trim();
  return {
    enabled: normalizedCorePersona.length > 0 || normalizedLanguageStyle.length > 0,
    card: {
      corePersona: normalizedCorePersona,
      languageStyle: normalizedLanguageStyle,
    },
  };
}
