import {
  AgentBamlStructuredOutputRunner,
  type AgentBamlStructuredOutputTraceSink,
} from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import { issueDetails, issueMessages } from "./AgentActionPlannerFailure.js";
import {
  type AgentActionPlannerBamlFunctionArgs,
  AgentActionPlannerBamlPromptFactory,
} from "./AgentActionPlannerBamlPromptFactory.js";
import type { AgentActionPlannerModelTransport } from "./AgentActionPlannerModelTransport.js";
import type {
  AgentLanguageModelCacheOptions,
  AgentLanguageModelImageAttachment,
} from "../ModelEndpoints/AgentLanguageModel.js";
import { deriveAgentModelCacheOptions } from "../ModelEndpoints/AgentModelCacheScope.js";

type BamlFunctionName = AgentActionPlannerBamlFunctionArgs["functionName"];
type BamlFunctionArgs<TName extends BamlFunctionName> = Extract<
  AgentActionPlannerBamlFunctionArgs,
  { functionName: TName }
>;
type BamlRepairArgs = AgentActionPlannerBamlFunctionArgs;

export class AgentActionPlannerStructuredCaller {
  private readonly promptFactory = new AgentActionPlannerBamlPromptFactory();
  private readonly structuredOutputRunner: AgentBamlStructuredOutputRunner;

  constructor(
    transport: AgentActionPlannerModelTransport,
    options: {
      maxRepairAttempts?: number;
      traceSink?: AgentBamlStructuredOutputTraceSink;
    } = {},
  ) {
    this.structuredOutputRunner = new AgentBamlStructuredOutputRunner({
      complete: (request, signal) => transport.complete(request, signal),
      maxRepairAttempts: options.maxRepairAttempts ?? 0,
      traceSink: options.traceSink,
      describeIssues: issueMessages,
      describeStructuredIssues: issueDetails,
    });
  }

  async run<TValue, TName extends BamlFunctionName>(options: {
    functionName: TName;
    args: BamlFunctionArgs<TName>;
    signal?: AbortSignal;
    attachments?: readonly AgentLanguageModelImageAttachment[];
    cache?: AgentLanguageModelCacheOptions;
    parse: (rawOutput: string) => TValue;
    repair?: (failure: {
      invalidOutput: string;
      issues: string[];
      diagnostics: AgentSourceDiagnostic[];
    }) => BamlRepairArgs;
  }): Promise<TValue> {
    const request = await this.promptFactory.buildPrompt(options.args, {
      attachments: options.attachments,
    });
    const cache = deriveAgentModelCacheOptions(options.cache, options.functionName, {
      systemPrompt: request.systemPrompt,
      tools: [],
    });
    const result = await this.structuredOutputRunner.run({
      functionName: options.functionName,
      request: { ...request, ...(cache ? { cache } : {}) },
      signal: options.signal,
      parse: options.parse,
      repair: options.repair
        ? async (failure) => {
            const repairArgs =
              options.repair?.({
                invalidOutput: failure.invalidOutput,
                issues: failure.issues,
                diagnostics: failure.diagnostics,
              }) ?? options.args;
            const request = await this.promptFactory.buildPrompt(repairArgs, {
              attachments: options.attachments,
            });
            const repairCache = deriveAgentModelCacheOptions(options.cache, repairArgs.functionName, {
              systemPrompt: request.systemPrompt,
              tools: [],
            });
            return { ...request, ...(repairCache ? { cache: repairCache } : {}) };
          }
        : undefined,
    });
    return result.value;
  }

  async repair<TValue, TName extends BamlFunctionName>(options: {
    functionName: TName;
    args: BamlFunctionArgs<TName>;
    signal?: AbortSignal;
    attachments?: readonly AgentLanguageModelImageAttachment[];
    cache?: AgentLanguageModelCacheOptions;
    parse: (rawOutput: string) => TValue;
  }): Promise<TValue> {
    return this.run({
      functionName: options.functionName,
      args: options.args,
      signal: options.signal,
      attachments: options.attachments,
      cache: options.cache,
      parse: options.parse,
    });
  }
}
