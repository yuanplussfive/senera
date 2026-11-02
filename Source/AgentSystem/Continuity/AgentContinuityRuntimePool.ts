import fs from "node:fs/promises";
import { agentLearningPaths } from "./AgentLearningStorage.js";
import type { AgentContinuityRuntime } from "./AgentContinuityRuntime.js";
import type { AgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type { AgentMemorySessionPort } from "../Memory/AgentMemoryService.js";

/** Workspace owner of isolated learning runtimes. Session routing always uses host-owned metadata. */
export class AgentContinuityRuntimePool {
  private readonly runtimes = new Map<string, AgentContinuityRuntime>();
  private readonly deleting = new Set<string>();
  private closed = false;
  private closePromise?: Promise<void>;
  constructor(
    private readonly options: {
      layout: AgentWorkspaceLayout;
      assertAgent(id: string): void;
      sessionAgentId(sessionId: string): string;
      create(agentId: string, paths: ReturnType<typeof agentLearningPaths>): AgentContinuityRuntime;
    },
  ) {}

  forAgent(id: string): AgentContinuityRuntime {
    this.options.assertAgent(id);
    if (this.closed || this.deleting.has(id)) throw new Error("Agent learning storage is closed.");
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = this.options.create(id, agentLearningPaths(this.options.layout, id));
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  forSession(sessionId: string): AgentContinuityRuntime {
    return this.forAgent(this.options.sessionAgentId(sessionId));
  }

  readonly memory: AgentMemorySessionPort = {
    recordCompletedTurn: (input) => this.forSession(input.sessionId).memory.recordCompletedTurn(input),
    deleteSession: (id) => this.forSession(id).memory.deleteSession(id),
    deleteFromSessionRequest: (id, request) => this.forSession(id).memory.deleteFromSessionRequest(id, request),
  };

  async remove(agentId: string): Promise<void> {
    this.deleting.add(agentId);
    const runtime = this.runtimes.get(agentId);
    if (runtime) await runtime.close();
    this.runtimes.delete(agentId);
    // UUID parsing and the fixed per-Agent layout constrain the recursive target.
    const target = agentLearningPaths(this.options.layout, agentId);
    await fs.rm(target.root, { recursive: true, force: true });
  }

  close(): Promise<void> {
    this.closed = true;
    return (this.closePromise ??= this.closeRuntimes());
  }

  private async closeRuntimes(): Promise<void> {
    const results = await Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.close()));
    const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    this.runtimes.clear();
    if (errors.length) throw new AggregateError(errors, "Agent learning stores could not close.");
  }
}
