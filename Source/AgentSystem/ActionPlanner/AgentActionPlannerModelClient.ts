import type {
  ControllerDecision as BamlControllerDecision,
  PiToolArgumentsDraft as BamlPiToolArgumentsDraft,
  ToolRiskAudit as BamlToolRiskAudit,
} from "../BamlClient/baml_client/types.js";
import type {
  ResolvedAgentActionPlannerClientConfig,
  ResolvedAgentModelProviderConfig,
} from "../Types/AgentConfigTypes.js";
import type { AgentBamlStructuredOutputTraceSink } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type {
  AgentPiControllerDecisionInput,
  AgentPiToolArgumentsInput,
  AgentPiToolArgumentsRepairInput,
} from "../PiShared/AgentPiPlanningTypes.js";
import type { AgentBamlToolRiskAuditPromptInput } from "../Safety/AgentBamlToolRiskAuditPromptJson.js";
import { AgentActionPlannerModelTransport } from "./AgentActionPlannerModelTransport.js";
import { resolvePlannerProvider } from "./AgentActionPlannerProviderResolver.js";
import { AgentActionPlannerStructuredCaller } from "./AgentActionPlannerStructuredCaller.js";
import { AgentActionPlannerCoreModelCalls } from "./AgentActionPlannerCoreModelCalls.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type {
  AgentLanguageModelMessage,
  AgentLanguageModelInvocationOptions,
} from "../ModelEndpoints/AgentLanguageModel.js";
import { contentText, type Context, type Message } from "@earendil-works/pi-ai";
import { z } from "zod";
import { AgentStructuredModelClient } from "../ModelEndpoints/AgentStructuredModelClient.js";

export class AgentActionPlannerModelClient {
  readonly providerConfig: ResolvedAgentModelProviderConfig;
  readonly supportsVisualInput: boolean;
  private readonly core: AgentActionPlannerCoreModelCalls;
  private readonly transport: AgentActionPlannerModelTransport;
  private readonly structured: AgentStructuredModelClient;

  constructor(
    _model: ResolvedAgentModelProviderConfig,
    overrides: ResolvedAgentActionPlannerClientConfig,
    options: {
      maxRepairAttempts?: number;
      omitOutputTokenLimit?: boolean;
      traceSink?: AgentBamlStructuredOutputTraceSink;
      usageSink?: AgentModelUsageSink;
      timingSink?: AgentModelTimingSink;
    } = {},
  ) {
    this.providerConfig = resolvePlannerProvider(overrides);
    this.supportsVisualInput = this.providerConfig.Capabilities?.Vision === true;
    this.transport = new AgentActionPlannerModelTransport(this.providerConfig, options.usageSink, options.timingSink, {
      omitOutputTokenLimit: options.omitOutputTokenLimit,
    });
    this.structured = new AgentStructuredModelClient(this.providerConfig, "PiCompaction", options);
    const caller = new AgentActionPlannerStructuredCaller(this.transport, options);
    this.core = new AgentActionPlannerCoreModelCalls(caller);
  }

  evolveTurn(
    input: AgentPiControllerDecisionInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlControllerDecision> {
    return this.core.evolveTurn(input, options);
  }

  async compactPiContext(context: Context, options: AgentLanguageModelInvocationOptions = {}): Promise<string> {
    const result = await this.structured.execute({
      contract: {
        name: "SummarizePiContext",
        description: "Produce the requested context compaction summary.",
        schema: z.object({ summary: z.string().trim().min(1) }).strict(),
        bamlFunction: "SummarizePiContext",
      },
      systemPrompt: context.systemPrompt ?? "",
      userPrompt: JSON.stringify(context.messages.map(projectPiCompactionMessage)),
      requestId: "action-planner:PiCompaction",
      signal: options.signal,
      cache: options.cache,
      managedRetries: true,
    });
    return result.summary;
  }

  repairControllerDecision(
    options: {
      input: AgentPiControllerDecisionInput;
      invalidDecision: string;
      issues: string[];
    },
    requestOptions?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlControllerDecision> {
    return this.core.repairControllerDecision(options, requestOptions);
  }

  fillPiToolArguments(
    input: AgentPiToolArgumentsInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlPiToolArgumentsDraft> {
    return this.core.fillPiToolArguments(input, options);
  }

  repairPiToolArguments(
    input: AgentPiToolArgumentsRepairInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlPiToolArgumentsDraft> {
    return this.core.repairPiToolArguments(input, options);
  }

  auditToolRisk(
    input: AgentBamlToolRiskAuditPromptInput,
    options?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlToolRiskAudit> {
    return this.core.auditToolRisk(input, options);
  }

  repairToolRiskAudit(
    options: {
      input: AgentBamlToolRiskAuditPromptInput;
      invalidAudit: string;
      issues: string[];
    },
    requestOptions?: AgentLanguageModelInvocationOptions,
  ): Promise<BamlToolRiskAudit> {
    return this.core.repairToolRiskAudit(options, requestOptions);
  }
}

function projectPiCompactionMessage(message: Message): AgentLanguageModelMessage {
  switch (message.role) {
    case "system":
      return { role: "system", content: contentText(message.content) };
    case "user":
      return { role: "user", content: contentText(message.content) };
    case "assistant":
      return { role: "assistant", content: contentText(message.content) };
    case "toolResult":
      throw new Error("Pi compaction context contains a tool result outside its summary prompt.");
  }
}
