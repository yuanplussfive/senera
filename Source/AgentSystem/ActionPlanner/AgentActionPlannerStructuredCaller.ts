import {
  AgentBamlStructuredOutputRunner,
  type AgentBamlStructuredOutputTraceSink,
} from "../AgentBamlStructuredOutputRunner.js";
import { issueMessages } from "./AgentActionPlannerFailure.js";
import {
  AgentActionPlannerBamlFunctionArgs,
  AgentActionPlannerBamlPromptFactory,
} from "./AgentActionPlannerBamlPromptFactory.js";
import type { AgentActionPlannerModelTransport } from "./AgentActionPlannerModelTransport.js";

type BamlFunctionName = AgentActionPlannerBamlFunctionArgs["functionName"];
type BamlFunctionArgs<TName extends BamlFunctionName> =
  Extract<AgentActionPlannerBamlFunctionArgs, { functionName: TName }>;
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
    });
  }

  async run<TValue, TName extends BamlFunctionName>(options: {
    functionName: TName;
    args: BamlFunctionArgs<TName>;
    signal?: AbortSignal;
    parse: (rawOutput: string) => TValue;
    repair?: (failure: {
      invalidOutput: string;
      issues: string[];
    }) => BamlRepairArgs;
  }): Promise<TValue> {
    const result = await this.structuredOutputRunner.run({
      functionName: options.functionName,
      request: await this.promptFactory.buildPrompt(options.args),
      signal: options.signal,
      parse: options.parse,
      repair: options.repair
        ? (failure) => this.promptFactory.buildPrompt(options.repair?.({
            invalidOutput: failure.invalidOutput,
            issues: failure.issues,
          }) ?? options.args)
        : undefined,
    });
    return result.value;
  }

  async repair<TValue, TName extends BamlFunctionName>(options: {
    functionName: TName;
    args: BamlFunctionArgs<TName>;
    signal?: AbortSignal;
    parse: (rawOutput: string) => TValue;
  }): Promise<TValue> {
    return this.run({
      functionName: options.functionName,
      args: options.args,
      signal: options.signal,
      parse: options.parse,
    });
  }
}
