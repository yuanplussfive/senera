import type { AgentActionDecision } from "./AgentActionPlanner.js";
import {
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
} from "./AgentActionPlanner.js";
import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type { AgentPromptRenderer } from "./AgentPromptRenderer.js";
import type { AgentToolCatalogProjector } from "./AgentToolCatalogProjector.js";
import type { AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import type {
  AgentDecisionOutputContract,
  AgentDecisionOutputShape,
} from "./AgentDecisionOutputResolver.js";

export interface AgentActionMismatchRepairPromptInput {
  code: string;
  expected: AgentDecisionOutputContract;
  actual: AgentDecisionOutputShape["kind"];
  actionDirective?: AgentActionDecision;
  loadedToolNames: "all" | readonly string[];
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

    return this.deps.promptRenderer.renderFileSync(template.path, {
      code: input.code,
      expected: input.expected,
      actual: input.actual,
      expectedLabel: OutputContractLabels[input.expected],
      actualLabel: OutputShapeLabels[input.actual],
      action: input.actionDirective
        ? {
            action: input.actionDirective.action,
            instruction: agentActionInstruction(input.actionDirective),
            preferredTools: agentActionPreferredTools(input.actionDirective),
            toolSearchQueries: agentActionToolSearchQueries(input.actionDirective),
          }
        : null,
      tools: this.deps.toolCatalog.listVisible(input.loadedToolNames),
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

const OutputContractLabels = {
  tool_call_xml: "工具调用 XML",
  final_text: "自然语言回复",
  open: "自然语言回复或工具调用 XML",
} as const satisfies Record<AgentDecisionOutputContract, string>;

const OutputShapeLabels = {
  plain_text: "自然语言回复",
  pure_tool_envelope: "纯工具调用 XML",
  mixed_tool_envelope: "自然语言混合工具调用 XML",
  tool_envelope_fragment: "未完整闭合的工具调用 XML",
} as const satisfies Record<AgentDecisionOutputShape["kind"], string>;
