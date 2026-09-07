import { supportsNativeToolCalling } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentConversationBoundaryBamlClient } from "./AgentConversationBoundaryBamlClient.js";
import { AgentConversationBoundaryNativeClient } from "./AgentConversationBoundaryNativeClient.js";
import { parseAgentConversationBoundary } from "./AgentConversationBoundarySchema.js";
import type {
  AgentConversationBoundaryClient,
  AgentConversationBoundaryPromptInput,
  AgentConversationBoundaryResult,
} from "./AgentTemporalMemoryTypes.js";

export class AgentConversationBoundaryModelClient implements AgentConversationBoundaryClient {
  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly cacheScopeKey: string,
    private readonly clients: {
      readonly native?: Pick<AgentConversationBoundaryNativeClient, "classify">;
      readonly baml?: Pick<AgentConversationBoundaryBamlClient, "classify">;
    } = {},
  ) {}

  async classify(input: AgentConversationBoundaryPromptInput): Promise<AgentConversationBoundaryResult> {
    if (this.configuration.ToolPlanningMode === "native") {
      if (
        this.configuration.Capabilities?.ToolCalling !== true ||
        !supportsNativeToolCalling(this.configuration.Endpoint)
      ) {
        throw new Error(`Conversation boundary model ${this.configuration.Id} does not support native tool calling.`);
      }
      const client =
        this.clients.native ?? new AgentConversationBoundaryNativeClient(this.configuration, this.cacheScopeKey);
      return parseAgentConversationBoundary(await client.classify(input));
    }
    if (this.configuration.ToolPlanningMode === "baml") {
      const client =
        this.clients.baml ?? new AgentConversationBoundaryBamlClient(this.configuration, this.cacheScopeKey);
      return parseAgentConversationBoundary(await client.classify(input));
    }
    throw new Error(
      `Unsupported conversation boundary tool planning mode: ${String(this.configuration.ToolPlanningMode)}.`,
    );
  }
}
