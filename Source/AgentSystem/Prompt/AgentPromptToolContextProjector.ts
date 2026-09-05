import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { normalizeMarkdownSectionText } from "./AgentMarkdownSections.js";
import type { AgentPromptToolContext } from "./AgentPromptContextTypes.js";
import type { AgentPromptDocumentationReader } from "./AgentPromptDocumentationReader.js";
import type { ResolvedAgentPromptSections } from "./AgentPromptSectionResolver.js";
import { projectAgentToolInteraction } from "../ToolRuntime/AgentToolInteractionProjector.js";

export class AgentPromptToolContextProjector {
  constructor(private readonly documentationReader: AgentPromptDocumentationReader) {}

  projectTool(tool: RegisteredTool, sections: ResolvedAgentPromptSections): AgentPromptToolContext {
    const document = this.documentationReader.readMarkdownSections(tool.descriptionFile);
    const interaction = projectAgentToolInteraction(tool);
    const fallbackDescription = interaction.purpose;

    return {
      name: tool.name,
      description: this.readSection(document.sections, sections.summary, fallbackDescription),
      whenToUse: this.readSection(document.sections, sections.trigger, interaction.useCases.join("\n")),
      whenNotToUse: this.readSection(document.sections, sections.avoid, interaction.avoid.join("\n")),
      argumentsContract: tool.contract?.arguments,
      documentationMarkdown: this.documentationReader.readOptionalMarkdownFile(tool.descriptionFile),
    };
  }

  private readSection(sections: ReadonlyMap<string, string>, name: string, fallback = ""): string {
    return normalizeMarkdownSectionText(sections.get(name)) || fallback;
  }
}
