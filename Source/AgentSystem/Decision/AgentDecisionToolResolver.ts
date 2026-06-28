import { AgentXmlSourceHelper } from "../Xml/AgentXmlParser.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";
import type {
  AgentDecisionExecutionContext,
  AgentToolCallDecision,
  AgentToolCallsDecision,
} from "./AgentDecisionExecutionTypes.js";

export class AgentDecisionToolResolver {
  constructor(
    private readonly registry: AgentPluginRegistry,
    private readonly errors: AgentDecisionErrorFactory,
    private readonly protocol: AgentXmlProtocolSpec,
  ) {}

  resolve(
    decision: AgentToolCallsDecision,
    call: AgentToolCallDecision,
    callIndex: number,
    context: AgentDecisionExecutionContext,
  ): RegisteredTool {
    const tool = this.registry.getTool(call.name);
    const allowedTools = this.allowedToolNames(context.loadedToolNames);
    if (!tool || !allowedTools.has(call.name)) {
      throw this.errors.unknownToolName({
        rootName: decision.root,
        source: new AgentXmlSourceHelper(decision.source.xml),
        protocol: this.protocol,
        callIndex,
        toolName: call.name,
        allowedTools: [...allowedTools],
      });
    }

    return tool;
  }

  private allowedToolNames(
    loadedToolNames: AgentDecisionExecutionContext["loadedToolNames"],
  ): Set<string> {
    const tools = this.registry.listTools();
    if (!loadedToolNames || loadedToolNames === "all") {
      return new Set(tools.map((tool) => tool.name));
    }

    const registered = new Set(tools.map((tool) => tool.name));
    return new Set(loadedToolNames.filter((toolName) => registered.has(toolName)));
  }
}
