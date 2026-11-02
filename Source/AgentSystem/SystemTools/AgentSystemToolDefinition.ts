import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolArtifactPayload, AgentToolProcessError } from "../Types/ToolRuntimeTypes.js";

const SystemToolExecutionResultMarker = Symbol("senera.system-tool-execution-result");

/**
 * Lets a host-owned system tool keep its normal, schema-validated result
 * separate from durable artifact material. The marker is intentionally not
 * enumerable, so it can never leak into a model-facing tool result.
 */
export interface AgentSystemToolExecutionResult<TOutput> {
  readonly [SystemToolExecutionResultMarker]: true;
  readonly result: TOutput;
  readonly artifactPayload?: AgentToolArtifactPayload;
  /** Optional structured failure while retaining the validated output shape. */
  readonly failure?: AgentToolProcessError;
  /**
   * Process facts are execution transport data, not part of the public tool
   * schema. Output streaming tools can keep full transcripts in their output
   * capture while exposing a compact result contract to the model.
   */
  readonly process?: AgentSystemToolExecutionProcess;
}

export interface AgentSystemToolExecutionProcess {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
}

export function systemToolExecutionResult<TOutput>(
  result: TOutput,
  options: {
    readonly artifactPayload?: AgentToolArtifactPayload;
    readonly failure?: AgentToolProcessError;
    readonly process?: AgentSystemToolExecutionProcess;
  } = {},
): AgentSystemToolExecutionResult<TOutput> {
  return Object.defineProperty(
    {
      result,
      ...(options.artifactPayload ? { artifactPayload: options.artifactPayload } : {}),
      ...(options.failure ? { failure: options.failure } : {}),
      ...(options.process ? { process: options.process } : {}),
    },
    SystemToolExecutionResultMarker,
    { value: true },
  ) as AgentSystemToolExecutionResult<TOutput>;
}

export function isSystemToolExecutionResult<TOutput>(
  value: TOutput | AgentSystemToolExecutionResult<TOutput>,
): value is AgentSystemToolExecutionResult<TOutput> {
  return (
    typeof value === "object" &&
    value !== null &&
    SystemToolExecutionResultMarker in value &&
    (value as Partial<AgentSystemToolExecutionResult<TOutput>>)[SystemToolExecutionResultMarker] === true
  );
}

/**
 * A code-owned implementation binding for one package-declared HostCapability.
 *
 * The extension package is the sole source for public tool identity, schemas,
 * permissions, scheduling, discovery metadata, and presentation. This type
 * deliberately contains none of those fields: it only connects an executable
 * capability to the runtime after AgentToolRunner has validated its package
 * contract.
 */
export interface AgentSystemToolDefinition<TOutput = unknown> {
  readonly capability: string;
  execute(input: Record<string, unknown>, context: AgentHostToolContext): Promise<TOutput> | TOutput;
  /**
   * Optional artifact-aware execution path. It preserves the public execute
   * return type used by existing host-tool callers and tests.
   */
  executeWithArtifacts?(
    input: Record<string, unknown>,
    context: AgentHostToolContext,
  ): Promise<AgentSystemToolExecutionResult<TOutput>> | AgentSystemToolExecutionResult<TOutput>;
}

export function defineSystemTool<TOutput>(
  definition: AgentSystemToolDefinition<TOutput>,
): AgentSystemToolDefinition<TOutput> {
  return Object.freeze(definition);
}

/**
 * `AgentToolRunner` has already materialized and validated the package-owned
 * JSON Schema before a HostCapability is invoked. This helper is a type-only
 * boundary for implementation code; it neither parses nor changes arguments.
 */
export function systemToolArguments<T extends object>(arguments_: Record<string, unknown>): T {
  return arguments_ as T;
}
