import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type { AgentPromptRenderer } from "./AgentPromptRenderer.js";
import type { AgentToolCatalogProjector } from "./AgentToolCatalogProjector.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import type {
  AgentDecisionOutputContract,
  AgentDecisionOutputShape,
} from "./AgentDecisionOutputResolver.js";
import type { AgentRootCommand } from "./AgentRootCommand.js";

export interface AgentActionMismatchRepairPromptInput {
  code: string;
  expected: AgentDecisionOutputContract;
  actual: AgentDecisionOutputShape["kind"];
  rootCommand?: AgentRootCommand;
}

export class AgentActionMismatchRepairPromptBuilder {
  constructor(
    private readonly deps: {
      registry: AgentPluginRegistry;
      promptRenderer: AgentPromptRenderer;
      toolCatalog: AgentToolCatalogProjector;
      protocol: AgentXmlProtocolSpec;
    },
  ) {}

  build(input: AgentActionMismatchRepairPromptInput): string {
    const template = this.deps.registry.getTemplate("ActionMismatchRepairPrompt");
    if (!template) {
      throw new Error("ActionMismatchRepairPrompt 模板没有注册。");
    }

    const visibleToolNames = input.rootCommand
      ? input.rootCommand.allowedTools
      : [];

    return this.deps.promptRenderer.renderFileSync(template.path, {
      code: input.code,
      expected: input.expected,
      actual: input.actual,
      RootCommand: input.rootCommand ?? null,
      tools: this.deps.toolCatalog.listVisible(visibleToolNames),
      ToolCallProtocol: {
        root: this.deps.protocol.roots.toolCalls,
        callTag: this.deps.protocol.items.toolCall,
        nameTag: this.deps.protocol.toolCall.name,
        argumentsTag: this.deps.protocol.toolCall.arguments,
        arrayItemTag: this.deps.protocol.items.arrayItem,
      },
    }).trim();
  }
}
