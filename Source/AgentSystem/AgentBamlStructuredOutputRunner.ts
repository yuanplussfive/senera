import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import { throwIfAborted } from "./AgentCancellation.js";

export interface AgentBamlModelRequest {
  requestId: string;
  step: number;
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
  signal?: AbortSignal;
}

export interface AgentBamlStructuredOutputResult<T> {
  value: T;
  repaired: boolean;
  attempts: AgentBamlStructuredOutputAttempt[];
}

export interface AgentBamlStructuredOutputAttempt {
  functionName: string;
  phase: "initial" | "repair";
  attempt: number;
  requestId: string;
  rawOutput?: string;
  status: "success" | "failed";
  issues: string[];
  artifactUri?: string;
  artifactPath?: string;
}

export interface AgentBamlStructuredOutputTraceEvent extends AgentBamlStructuredOutputAttempt {
  request: AgentBamlModelRequest;
  error?: unknown;
}

export interface AgentBamlStructuredOutputTraceSink {
  record(event: AgentBamlStructuredOutputTraceEvent): Promise<AgentBamlStructuredOutputAttempt | void>;
}

export interface AgentBamlStructuredOutputRepairInput {
  functionName: string;
  attempt: number;
  repairAttempt: number;
  rawOutput: string;
  invalidOutput: string;
  issues: string[];
  error: unknown;
}

export class AgentBamlStructuredOutputError extends Error {
  readonly functionName: string;
  readonly attempts: AgentBamlStructuredOutputAttempt[];
  readonly issues: string[];
  readonly rawOutput?: string;
  readonly originalError: unknown;

  constructor(input: {
    functionName: string;
    attempts: AgentBamlStructuredOutputAttempt[];
    issues: string[];
    rawOutput?: string;
    error: unknown;
  }) {
    super(`${input.functionName} structured output failed: ${input.issues.join("; ")}`);
    this.name = "AgentBamlStructuredOutputError";
    this.functionName = input.functionName;
    this.attempts = input.attempts;
    this.issues = input.issues;
    this.rawOutput = input.rawOutput;
    this.originalError = input.error;
  }
}

export class AgentBamlStructuredOutputRunner {
  constructor(
    private readonly options: {
      complete: (request: AgentBamlModelRequest, signal?: AbortSignal) => Promise<string>;
      maxRepairAttempts: number;
      traceSink?: AgentBamlStructuredOutputTraceSink;
      isRepairable?: (error: unknown) => boolean;
      describeIssues?: (error: unknown) => string[];
      describeInvalidOutput?: (error: unknown, rawOutput: string) => string;
    },
  ) {}

  async run<T>(options: {
    functionName: string;
    request: AgentBamlModelRequest;
    signal?: AbortSignal;
    parse: (rawOutput: string) => T;
    repair?: (failure: AgentBamlStructuredOutputRepairInput) => Promise<AgentBamlModelRequest> | AgentBamlModelRequest;
  }): Promise<AgentBamlStructuredOutputResult<T>> {
    const attempts: AgentBamlStructuredOutputAttempt[] = [];
    let request = options.request;
    let repairAttempt = 0;

    for (let attempt = 1; ; attempt += 1) {
      throwIfAborted(options.signal);
      const phase = repairAttempt > 0 ? "repair" : "initial";
      let rawOutput = "";

      try {
        rawOutput = await this.options.complete(request, options.signal);
      } catch (error) {
        const issues = this.describeIssues(error);
        attempts.push(await this.record({
          functionName: options.functionName,
          phase,
          attempt,
          requestId: request.requestId,
          rawOutput,
          status: "failed",
          issues,
          request,
          error,
        }));
        throw new AgentBamlStructuredOutputError({
          functionName: options.functionName,
          attempts,
          issues,
          rawOutput,
          error,
        });
      }

      try {
        const value = options.parse(rawOutput);
        attempts.push(await this.record({
          functionName: options.functionName,
          phase,
          attempt,
          requestId: request.requestId,
          rawOutput,
          status: "success",
          issues: [],
          request,
        }));
        return {
          value,
          repaired: repairAttempt > 0,
          attempts,
        };
      } catch (error) {
        const issues = this.describeIssues(error);
        attempts.push(await this.record({
          functionName: options.functionName,
          phase,
          attempt,
          requestId: request.requestId,
          rawOutput,
          status: "failed",
          issues,
          request,
          error,
        }));

        if (
          !options.repair
          || repairAttempt >= this.options.maxRepairAttempts
          || !this.isRepairable(error)
        ) {
          throw new AgentBamlStructuredOutputError({
            functionName: options.functionName,
            attempts,
            issues,
            rawOutput,
            error,
          });
        }

        repairAttempt += 1;
        request = await options.repair({
          functionName: options.functionName,
          attempt,
          repairAttempt,
          rawOutput,
          invalidOutput: this.describeInvalidOutput(error, rawOutput),
          issues,
          error,
        });
      }
    }
  }

  private isRepairable(error: unknown): boolean {
    return this.options.isRepairable ? this.options.isRepairable(error) : true;
  }

  private describeIssues(error: unknown): string[] {
    const issues = this.options.describeIssues?.(error);
    if (issues && issues.length > 0) {
      return issues;
    }
    return [error instanceof Error ? error.message : String(error)];
  }

  private describeInvalidOutput(error: unknown, rawOutput: string): string {
    return this.options.describeInvalidOutput?.(error, rawOutput) ?? rawOutput;
  }

  private async record(
    event: AgentBamlStructuredOutputTraceEvent,
  ): Promise<AgentBamlStructuredOutputAttempt> {
    const recorded = await this.options.traceSink?.record(event);
    if (recorded) {
      return {
        ...event,
        artifactUri: recorded.artifactUri,
        artifactPath: recorded.artifactPath,
      };
    }

    return {
      functionName: event.functionName,
      phase: event.phase,
      attempt: event.attempt,
      requestId: event.requestId,
      rawOutput: event.rawOutput,
      status: event.status,
      issues: event.issues,
    };
  }
}
