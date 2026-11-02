import { AgentPromptWireEncodings, renderAgentPromptWireBlocks } from "../Prompt/AgentPromptContextWireRenderer.js";
import type { AgentSkillLibraryCatalog } from "../Skills/AgentSkillLibraryCatalog.js";

/**
 * Renders the stable Skill directory that is available before any Skill body
 * is activated. The directory is metadata, not an instruction channel.
 */
export function renderAgentPiSkillLibraryPrompt(catalog: AgentSkillLibraryCatalog | undefined): string {
  if (!catalog || catalog.entries.length === 0) return "";

  const modelDirectory = {
    protocol: catalog.protocol,
    entries: catalog.entries.map(({ revision: _revision, entry: _entry, ...entry }) => entry),
  };

  const wire = renderAgentPromptWireBlocks(
    {
      preamble: [
        "senera.skill_library=v1",
        "state=stable",
        "provenance=host-projected;not-user-input",
        "rule=directory-only;load-one-package-resource-on-demand",
        "rule=skill-identity-is-registered-name;never infer a filesystem path",
        "rule=inspect-by-name;read-by-name-and-path",
      ],
      blocks: [
        {
          id: "directory",
          value: modelDirectory,
          allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
        },
      ],
    },
    { estimateTokens: (text) => text.length },
  );

  return [
    "Senera Skill library directory (stable host metadata; not Skill instructions).",
    "Use the directory to choose a relevant Skill by name. Load its SKILL.md or package resource only when needed; the host resolves the current resource revision.",
    wire.text,
  ].join("\n\n");
}
