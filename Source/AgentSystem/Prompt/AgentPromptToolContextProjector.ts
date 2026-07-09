import type {
  RegisteredTool,
} from "../Types/PluginRuntimeTypes.js";
import { normalizeMarkdownSectionText } from "../Xml/AgentMarkdownSections.js";
import type {
  AgentPromptToolContext,
} from "./AgentPromptContextTypes.js";
import type { AgentPromptContractProjector } from "./AgentPromptContractProjector.js";
import type { AgentPromptDocumentationReader } from "./AgentPromptDocumentationReader.js";
import type { ResolvedAgentPromptSections } from "./AgentPromptSectionResolver.js";

export class AgentPromptToolContextProjector {
  constructor(
    private readonly contractProjector: AgentPromptContractProjector,
    private readonly documentationReader: AgentPromptDocumentationReader,
  ) {}

  projectTool(
    tool: RegisteredTool,
    sections: ResolvedAgentPromptSections,
  ): AgentPromptToolContext {
    const document = this.documentationReader.readMarkdownSections(tool.descriptionFile);
    const fallbackDescription = tool.plugin.manifest.Plugin.Description ?? "";

    return {
      name: tool.name,
      description: this.readSection(document.sections, sections.summary, fallbackDescription),
      whenToUse: this.readSection(document.sections, sections.trigger, fallbackDescription),
      whenNotToUse: this.readSection(document.sections, sections.avoid),
      argumentsContract: this.contractProjector.projectFromFile(
        tool.signatureFile,
        "arguments",
        tool.signatureType,
      ),
      documentationXml: this.documentationReader.renderOptionalMarkdownFile(tool.descriptionFile),
    };
  }

  private readSection(
    sections: ReadonlyMap<string, string>,
    name: string,
    fallback = "",
  ): string {
    return normalizeMarkdownSectionText(sections.get(name)) || fallback;
  }
}
