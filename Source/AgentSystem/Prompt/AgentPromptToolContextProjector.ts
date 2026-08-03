import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import { normalizeMarkdownSectionText } from "./AgentMarkdownSections.js";
import type { AgentPromptToolContext } from "./AgentPromptContextTypes.js";
import type { AgentPromptDocumentationReader } from "./AgentPromptDocumentationReader.js";
import type { ResolvedAgentPromptSections } from "./AgentPromptSectionResolver.js";

export class AgentPromptToolContextProjector {
  constructor(private readonly documentationReader: AgentPromptDocumentationReader) {}

  projectTool(tool: RegisteredTool, sections: ResolvedAgentPromptSections): AgentPromptToolContext {
    const document = this.documentationReader.readMarkdownSections(tool.descriptionFile);
    const fallbackDescription = resolveAgentToolOwner(tool).description ?? "";

    return {
      name: tool.name,
      description: this.readSection(document.sections, sections.summary, fallbackDescription),
      whenToUse: this.readSection(document.sections, sections.trigger, fallbackDescription),
      whenNotToUse: this.readSection(document.sections, sections.avoid),
      argumentsContract: tool.contract?.arguments,
      documentationMarkdown: this.documentationReader.readOptionalMarkdownFile(tool.descriptionFile),
    };
  }

  private readSection(sections: ReadonlyMap<string, string>, name: string, fallback = ""): string {
    return normalizeMarkdownSectionText(sections.get(name)) || fallback;
  }
}
