import { z } from "zod";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentToolObservationSummaryRequest } from "../ToolRuntime/AgentToolResultObservationCompressor.js";
import { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type { AgentBackgroundLearningRequestLedger } from "../Memory/AgentBackgroundLearningRequestLedger.js";
import { stableMemoryId } from "../Memory/AgentMemoryIdentity.js";
import type { AgentPiCompactionWindowPolicy } from "./AgentPiCompactionSettings.js";

const SummarySchema = z.object({ summary: z.string().trim().min(1) }).strict();
const SummaryContract = {
  name: "CompressToolObservation",
  description: "Summarize one complete tool result for the current user request.",
  schema: SummarySchema,
  bamlFunction: "CompressToolObservation",
} as const;
const SummaryTool = {
  name: SummaryContract.name,
  description: SummaryContract.description,
  parameters: z.toJSONSchema(SummarySchema, { target: "draft-7", io: "input" }),
};

export class AgentPiToolObservationSummaryClient {
  private readonly call: AgentStructuredModelClient;
  private readonly tokenBudget: AgentTurnTokenBudget;
  private readonly tokenProjector: AgentTokenProjector;
  private readonly callProviderId: string;
  private readonly callModel: string;

  constructor(
    configuration: ResolvedAgentModelProviderConfig,
    contextBudget: Pick<AgentPiCompactionWindowPolicy, "contextWindowTokens" | "inputCapacityTokens" | "reserveTokens">,
    private readonly learningRequests?: AgentBackgroundLearningRequestLedger,
  ) {
    this.callProviderId = configuration.Id;
    this.callModel = configuration.Model;
    this.call = new AgentStructuredModelClient(configuration, "ToolObservationCompression");
    this.tokenBudget = new AgentTurnTokenBudget({
      model: configuration.Model,
      contextWindowTokens: contextBudget.contextWindowTokens,
      inputCapacityTokens: contextBudget.inputCapacityTokens,
      windowHeadroomTokens: contextBudget.reserveTokens,
    });
    this.tokenProjector = new AgentTokenProjector(configuration.Model);
  }

  async summarize(request: AgentToolObservationSummaryRequest): Promise<string> {
    const payload = {
      current_user_message: request.currentUserMessage,
      tool_name: request.toolName,
      arguments: request.arguments,
      result: request.feedback,
      ...(request.artifactUri ? { artifact_uri: request.artifactUri } : {}),
      ...(request.evidenceUris.length > 0 ? { evidence_uris: request.evidenceUris } : {}),
      token_budget: request.tokenBudget,
      source_complete: true,
    };
    const inputCapacity = this.tokenBudget.snapshot().inputCapacityTokens;
    const fixedInput = this.tokenBudget.inspectModelInput({
      systemPrompt: request.systemPrompt,
      messages: [{ role: "user", content: [{ type: "text", text: "" }], timestamp: 0 }],
      tools: [SummaryTool],
    }).tokenCount;
    let resultBudget = Math.max(1, Math.min(request.tokenBudget, inputCapacity - fixedInput));
    let userPrompt: string;

    for (;;) {
      const resultProjection = this.tokenProjector.projectJson(request.feedback, resultBudget);
      userPrompt = JSON.stringify({
        ...payload,
        result: resultProjection.projectedValue,
        source_complete: resultProjection.complete,
        ...(resultProjection.complete ? {} : { source_omissions: resultProjection.omissions }),
      });
      const inspection = this.tokenBudget.inspectModelInput({
        systemPrompt: request.systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }], timestamp: 0 }],
        tools: [SummaryTool],
      });
      if (inspection.fits) break;

      const excessTokens = Math.max(1, inspection.tokenCount - inspection.capacityTokens);
      const nextBudget = Math.max(0, resultBudget - excessTokens);
      if (nextBudget >= resultBudget || nextBudget === 0) {
        throw new Error("Tool-observation summary prompt exceeds the summarization model's input capacity.");
      }
      resultBudget = nextBudget;
    }

    const execute = async (): Promise<string> => {
      const result = await this.call.execute({
        contract: SummaryContract,
        systemPrompt: request.systemPrompt,
        userPrompt,
        requestId: operationId,
        signal: request.signal,
      });
      return result.summary;
    };
    const operationId =
      request.requestId ??
      stableMemoryId("tool-observation", [request.toolName, request.artifactUri ?? "", ...request.evidenceUris]);
    const run = () => execute();
    return this.learningRequests
      ? this.learningRequests.run(
          {
            operationKey: `tool_observation_compression:${operationId}`,
            board: "tool_observation_compression",
            stage: "summary",
            entityUri: request.artifactUri,
            sourceRevision: request.requestId,
            attempt: 1,
            providerId: this.callProviderId,
            model: this.callModel,
            metadata: {
              toolName: request.toolName,
              tokenBudget: request.tokenBudget,
            },
          },
          run,
          (summary) => ({ outputCharacters: summary.length }),
        )
      : run();
  }
}
