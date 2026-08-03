import { createOpaqueId } from "../Core/AgentIds.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentModelUsageLedger } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnosticsTypes.js";
import type { AgentPiPlanningSkill } from "./AgentPiPlanningTypes.js";
import type { AgentPiToolPlanCoordinator } from "./AgentPiToolPlanCoordinator.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";

export interface AgentPiTurnContext {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly step?: number;
  readonly onEvent?: AgentEventSink;
  readonly diagnostics?: AgentPiDiagnosticSink;
  readonly rootCommand?: AgentRootCommand;
  readonly toolAccessGrant: AgentToolAccessGrant;
  readonly toolExposure: AgentToolExposureState;
  readonly activeSkills?: readonly AgentPiPlanningSkill[];
  readonly usageLedger?: AgentModelUsageLedger;
  readonly toolPlan?: AgentPiToolPlanCoordinator;
  readonly tokenBudget?: AgentTurnTokenBudget;
}

interface StoredAgentPiTurnContext {
  readonly context: AgentPiTurnContext;
  readonly toolBatchIdsByCallId: Map<string, string>;
  readonly executedToolResultsByCallId: Map<string, ExecutedToolCallResult>;
  ownerReleased: boolean;
  readers: number;
}

export interface AgentPiTurnContextLease {
  readonly context: AgentPiTurnContext;
  release(): void;
}

export interface AgentPiTurnContextStore {
  withContext<T>(context: AgentPiTurnContext, run: (id: string) => Promise<T> | T): Promise<T>;
  acquire(id: string | undefined): AgentPiTurnContextLease | undefined;
  registerToolCallBatch(contextId: string | undefined, batchId: string, callIds: readonly string[]): void;
  readToolCallBatchId(contextId: string | undefined, callId: string | undefined): string | undefined;
  registerExecutedToolResult(contextId: string | undefined, callId: string, result: ExecutedToolCallResult): void;
  takeExecutedToolResult(contextId: string | undefined, callId: string): ExecutedToolCallResult | undefined;
}

export class AgentPiTurnContextRegistry implements AgentPiTurnContextStore {
  private readonly contexts = new Map<string, StoredAgentPiTurnContext>();

  get size(): number {
    return this.contexts.size;
  }

  register(context: AgentPiTurnContext): string {
    const id = createOpaqueId("pictx");
    this.contexts.set(id, {
      context,
      toolBatchIdsByCallId: new Map(),
      executedToolResultsByCallId: new Map(),
      ownerReleased: false,
      readers: 0,
    });
    return id;
  }

  async withContext<T>(context: AgentPiTurnContext, run: (id: string) => Promise<T> | T): Promise<T> {
    const id = this.register(context);
    try {
      return await run(id);
    } finally {
      this.releaseOwner(id);
    }
  }

  acquire(id: string | undefined): AgentPiTurnContextLease | undefined {
    if (!id) return undefined;
    const stored = this.active(id);
    if (!stored) return undefined;
    stored.readers += 1;
    let released = false;
    return {
      context: stored.context,
      release: () => {
        if (released) return;
        released = true;
        stored.readers = Math.max(0, stored.readers - 1);
        this.deleteReleased(id, stored);
      },
    };
  }

  registerToolCallBatch(contextId: string | undefined, batchId: string, callIds: readonly string[]): void {
    const stored = this.active(contextId);
    if (!stored || callIds.length === 0) return;
    for (const callId of callIds) stored.toolBatchIdsByCallId.set(callId, batchId);
  }

  readToolCallBatchId(contextId: string | undefined, callId: string | undefined): string | undefined {
    return contextId && callId ? this.active(contextId)?.toolBatchIdsByCallId.get(callId) : undefined;
  }

  registerExecutedToolResult(contextId: string | undefined, callId: string, result: ExecutedToolCallResult): void {
    this.active(contextId)?.executedToolResultsByCallId.set(callId, result);
  }

  takeExecutedToolResult(contextId: string | undefined, callId: string): ExecutedToolCallResult | undefined {
    const results = this.active(contextId)?.executedToolResultsByCallId;
    const result = results?.get(callId);
    results?.delete(callId);
    return result;
  }

  release(id: string | undefined): void {
    if (id) this.releaseOwner(id);
  }

  clear(): void {
    this.contexts.clear();
  }

  private active(id: string | undefined): StoredAgentPiTurnContext | undefined {
    if (!id) return undefined;
    const stored = this.contexts.get(id);
    return stored && !stored.ownerReleased ? stored : undefined;
  }

  private releaseOwner(id: string): void {
    const stored = this.contexts.get(id);
    if (!stored || stored.ownerReleased) return;
    stored.ownerReleased = true;
    this.deleteReleased(id, stored);
  }

  private deleteReleased(id: string, stored: StoredAgentPiTurnContext): void {
    if (stored.ownerReleased && stored.readers === 0) this.contexts.delete(id);
  }
}
