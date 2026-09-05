import { supportsNativeToolCalling } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { AgentTemporalMemoryBamlSummaryClient } from "./AgentTemporalMemoryBamlSummaryClient.js";
import { AgentTemporalMemoryNativeSummaryClient } from "./AgentTemporalMemoryNativeSummaryClient.js";
import { parseAgentTemporalMemorySummary } from "./AgentTemporalMemorySummarySchema.js";
import type {
  AgentTemporalMemorySummaryClient,
  AgentTemporalMemorySummaryPromptInput,
  AgentTemporalMemorySummaryResult,
} from "./AgentTemporalMemoryTypes.js";

export class AgentTemporalMemorySummaryModelClient implements AgentTemporalMemorySummaryClient {
  constructor(
    private readonly configuration: ResolvedAgentModelProviderConfig,
    private readonly cacheScopeKey: string,
    private readonly clients: {
      readonly native?: Pick<AgentTemporalMemoryNativeSummaryClient, "summarize">;
      readonly baml?: Pick<AgentTemporalMemoryBamlSummaryClient, "summarize">;
    } = {},
  ) {}

  async summarize(input: AgentTemporalMemorySummaryPromptInput): Promise<AgentTemporalMemorySummaryResult> {
    const mode = this.configuration.ToolPlanningMode;
    if (mode === "native") {
      if (
        this.configuration.Capabilities?.ToolCalling !== true ||
        !supportsNativeToolCalling(this.configuration.Endpoint)
      ) {
        throw new Error(`Temporal memory model ${this.configuration.Id} does not support native tool calling.`);
      }
      const client =
        this.clients.native ?? new AgentTemporalMemoryNativeSummaryClient(this.configuration, this.cacheScopeKey);
      return parseAgentTemporalMemorySummary(await client.summarize(input));
    }
    if (mode === "baml") {
      const client =
        this.clients.baml ?? new AgentTemporalMemoryBamlSummaryClient(this.configuration, this.cacheScopeKey);
      return parseAgentTemporalMemorySummary(await client.summarize(input));
    }
    throw new Error(`Unsupported temporal memory tool planning mode: ${String(mode)}.`);
  }
}
