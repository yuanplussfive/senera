import { AgentConcurrencyGate } from "../Core/AgentConcurrencyGate.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolRuntimeCapabilities } from "./AgentToolRuntimeCapabilities.js";
import type { AgentToolResourceClaimProjectorPort } from "./AgentToolResourceClaimProjector.js";
import { AgentToolResourceScheduler } from "./AgentToolResourceScheduler.js";

export interface AgentToolExecutionSchedulerOptions {
  readonly maxConcurrentCallsPerRun: number;
  readonly resourceClaims: AgentToolResourceClaimProjectorPort;
}

/** Coordinates bounded run capacity separately from declared resource conflicts. */
export class AgentToolExecutionScheduler {
  private readonly runGates = new WeakMap<object, AgentConcurrencyGate>();
  private readonly toolGates = new WeakMap<RegisteredTool, AgentConcurrencyGate>();
  private readonly resources: AgentToolResourceScheduler;

  constructor(private readonly options: AgentToolExecutionSchedulerOptions) {
    if (!Number.isSafeInteger(options.maxConcurrentCallsPerRun) || options.maxConcurrentCallsPerRun < 1) {
      throw new RangeError("Per-run tool concurrency limit must be a positive safe integer.");
    }
    this.resources = new AgentToolResourceScheduler(options.resourceClaims);
  }

  run<T>(
    run: object,
    tool: RegisteredTool,
    args: Readonly<Record<string, unknown>>,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const scheduling = resolveAgentToolRuntimeCapabilities(tool).scheduling;
    if (scheduling === "self-managed") return operation();

    const withCapacity = () => this.runWithCapacity(run, tool, operation, signal);
    return scheduling === "resource-claims" ? this.resources.run(tool, args, withCapacity, signal) : withCapacity();
  }

  private runWithCapacity<T>(
    run: object,
    tool: RegisteredTool,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const runGate = readOrCreateGate(this.runGates, run, this.options.maxConcurrentCallsPerRun);
    const withRunCapacity = () => runGate.run(operation, signal);
    const toolLimit = tool.runtime.MaxConcurrency;
    if (toolLimit === undefined) return withRunCapacity();
    return readOrCreateGate(this.toolGates, tool, toolLimit).run(withRunCapacity, signal);
  }
}

function readOrCreateGate<TKey extends object>(
  gates: WeakMap<TKey, AgentConcurrencyGate>,
  key: TKey,
  limit: number,
): AgentConcurrencyGate {
  const existing = gates.get(key);
  if (existing) return existing;
  const created = new AgentConcurrencyGate(limit);
  gates.set(key, created);
  return created;
}
