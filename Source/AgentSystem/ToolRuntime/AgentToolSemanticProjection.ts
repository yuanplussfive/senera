import { reduceExecution, type CompactResult, type ToolExecutionInput } from "tokenjuice";
import { errorMessage } from "../Core/AgentErrors.js";

export const AgentToolSemanticProjectionKinds = {
  TerminalExecution: "terminal_execution",
} as const;

export type AgentToolSemanticProjectionKind =
  (typeof AgentToolSemanticProjectionKinds)[keyof typeof AgentToolSemanticProjectionKinds];

export interface AgentTerminalExecutionSemanticProjectionRequest {
  readonly kind: typeof AgentToolSemanticProjectionKinds.TerminalExecution;
  readonly command: string;
  readonly cwd: string;
}

export type AgentToolSemanticProjectionRequest = AgentTerminalExecutionSemanticProjectionRequest;

export interface AgentToolSemanticProjection {
  readonly kind: AgentToolSemanticProjectionKind;
  readonly text: string;
  readonly preview?: string;
  readonly facts?: Readonly<Record<string, number>>;
  readonly classification: {
    readonly family: string;
    readonly confidence: number;
    readonly reducer?: string;
  };
  readonly stats: {
    readonly sourceCharacters: number;
    readonly projectedCharacters: number;
    readonly ratio: number;
  };
}

export type AgentToolSemanticProjectionResult =
  | { readonly kind: "projected"; readonly value: AgentToolSemanticProjection }
  | { readonly kind: "failed"; readonly message: string };

export interface AgentToolSemanticProjector {
  project(input: {
    readonly request: AgentToolSemanticProjectionRequest;
    readonly toolName: string;
    readonly toolCallId: string;
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number | null;
  }): Promise<AgentToolSemanticProjectionResult>;
}

export class AgentDefaultToolSemanticProjector implements AgentToolSemanticProjector {
  async project(
    input: Parameters<AgentToolSemanticProjector["project"]>[0],
  ): Promise<AgentToolSemanticProjectionResult> {
    try {
      return {
        kind: "projected",
        value: projectTokenJuiceResult(
          input.request,
          await reduceExecution(projectTokenJuiceInput(input), {
            store: false,
            recordStats: false,
            trace: false,
          }),
        ),
      };
    } catch (error) {
      return { kind: "failed", message: errorMessage(error) };
    }
  }
}

function projectTokenJuiceInput(input: Parameters<AgentToolSemanticProjector["project"]>[0]): ToolExecutionInput {
  return {
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    command: input.request.command,
    cwd: input.request.cwd,
    stdout: input.stdout,
    stderr: input.stderr,
    ...(input.exitCode === null ? {} : { exitCode: input.exitCode }),
  };
}

function projectTokenJuiceResult(
  request: AgentToolSemanticProjectionRequest,
  result: CompactResult,
): AgentToolSemanticProjection {
  return {
    kind: request.kind,
    text: result.inlineText,
    ...(result.previewText ? { preview: result.previewText } : {}),
    ...(result.facts ? { facts: result.facts } : {}),
    classification: {
      family: result.classification.family,
      confidence: result.classification.confidence,
      ...(result.classification.matchedReducer ? { reducer: result.classification.matchedReducer } : {}),
    },
    stats: {
      sourceCharacters: result.stats.rawChars,
      projectedCharacters: result.stats.reducedChars,
      ratio: result.stats.ratio,
    },
  };
}
