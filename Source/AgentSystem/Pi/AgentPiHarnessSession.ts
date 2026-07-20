import { buildSessionContext } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentHarnessResources,
  AgentHarness,
  AgentMessage,
  AgentState,
  PromptTemplate,
  Skill,
  Session,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import type { AgentPiHarnessEvent } from "./AgentPiHarnessEvents.js";
import { isPiCoreAgentEvent } from "./AgentPiHarnessEvents.js";
import type { AgentPiSession, AgentPiSessionEventListener } from "./AgentPiSubstrate.js";
import type { AgentPiModelProjection, AgentPiToolDefinition } from "./AgentPiTypes.js";
import type {
  AgentPiCompactionInspection,
  AgentPiCompactionPlan,
  AgentPiCompactionRunResult,
  AgentPiCompactionPolicy,
} from "./AgentPiCompactionPolicy.js";

export interface AgentPiHarnessSessionOptions {
  model: AgentPiModelProjection;
  tools: readonly AgentPiToolDefinition[];
  release?: () => void;
  persistentSession?: Session;
  compactionPolicy?: AgentPiCompactionPolicy;
  setCompactionRequest?: (
    request: { plan: Extract<AgentPiCompactionPlan, { kind: "compact" }>; signal: AbortSignal } | undefined,
  ) => void;
  onCompactionEvent?: (
    event: "checked" | "skipped" | "started" | "completed" | "failed",
    inspection: AgentPiCompactionInspection,
    payload?: unknown,
  ) => void | Promise<void>;
}

export class AgentPiHarnessSession implements AgentPiSession {
  private history: AgentMessage[] = [];
  private lastAssistantText: string | undefined;
  private released = false;
  private compactionAbortController: AbortController | undefined;
  private abortPromise: Promise<void> | undefined;

  constructor(
    private readonly harness: AgentHarness,
    private readonly options: AgentPiHarnessSessionOptions,
  ) {}

  get state(): AgentState {
    const readHistory = (): AgentMessage[] => [...this.history];
    const writeHistory = (messages: AgentMessage[]): void => {
      this.history = [...messages];
    };
    const tools = this.snapshotTools();
    return {
      systemPrompt: "",
      model: this.options.model,
      thinkingLevel: "off",
      get tools() {
        return [...tools];
      },
      set tools(_tools: AgentPiToolDefinition[]) {},
      get messages() {
        return readHistory();
      },
      set messages(messages: AgentMessage[]) {
        writeHistory(messages);
      },
      isStreaming: false,
      pendingToolCalls: new Set(),
    } satisfies AgentState;
  }

  get model(): AgentState["model"] {
    return this.options.model;
  }

  setHistory(messages: readonly AgentMessage[]): void {
    this.history = [...messages];
  }

  async prompt(text: string): Promise<void> {
    await this.appendHistory();
    const assistant = await this.harness.prompt(text);
    throwIfAssistantFailed(assistant);
    this.lastAssistantText = readAssistantText(assistant);
  }

  async steer(text: string): Promise<void> {
    await this.harness.steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.harness.followUp(text);
  }

  async nextTurn(text: string): Promise<void> {
    await this.harness.nextTurn(text);
  }

  async compactIfNeeded(signal?: AbortSignal): Promise<AgentPiCompactionRunResult | undefined> {
    const persistentSession = this.options.persistentSession;
    const policy = this.options.compactionPolicy;
    if (!persistentSession || !policy) return undefined;

    await this.harness.waitForIdle();
    await this.appendHistory();
    const checkStartedAt = performance.now();
    const branchEntries = await persistentSession.getBranch();
    const context = buildSessionContext(branchEntries);
    const plan = policy.plan(context.messages, branchEntries);
    const inspection = plan.inspection;
    const check = {
      durationMs: elapsedMilliseconds(checkStartedAt),
      branchEntryCount: branchEntries.length,
    };
    await this.options.onCompactionEvent?.("checked", inspection, check);
    if (plan.kind !== "compact") {
      await this.options.onCompactionEvent?.("skipped", inspection, {
        ...check,
        reason: plan.reason,
        recommendedAction: plan.kind,
      });
      return { status: "skipped", reason: plan.reason, inspection };
    }

    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    this.compactionAbortController = controller;
    const timeout = setTimeout(() => controller.abort(new Error("Pi compaction timed out.")), policy.timeoutMs);
    this.options.setCompactionRequest?.({ plan, signal: controller.signal });
    await this.options.onCompactionEvent?.("started", inspection);
    try {
      const result = await this.harness.compact();
      await this.options.onCompactionEvent?.("completed", inspection, result);
      return { status: "compacted", inspection, ...result };
    } catch (error) {
      await this.options.onCompactionEvent?.("failed", inspection, error);
      if (signal?.aborted || inspection.hardLimitExceeded) throw error;
      return {
        status: "failed",
        inspection,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      this.options.setCompactionRequest?.(undefined);
      if (this.compactionAbortController === controller) this.compactionAbortController = undefined;
    }
  }

  async setResources(resources: AgentHarnessResources<Skill, PromptTemplate>): Promise<void> {
    await this.harness.setResources(resources);
  }

  subscribe(listener: AgentPiSessionEventListener): () => void {
    return this.harness.subscribe((event) => {
      if (isPiCoreAgentEvent(event as AgentPiHarnessEvent)) {
        return listener(event as AgentEvent);
      }
    });
  }

  abort(): Promise<void> {
    this.abortPromise ??= this.abortHarness();
    return this.abortPromise;
  }

  private async abortHarness(): Promise<void> {
    this.compactionAbortController?.abort();
    await this.harness.abort();
    await this.harness.waitForIdle();
  }

  markTurnBoundary(requestId: string): Promise<string> {
    const persistentSession = this.options.persistentSession;
    if (!persistentSession) {
      throw new Error("Pi turn boundaries require a persistent session.");
    }
    return persistentSession.appendCustomEntry("senera.turn_boundary", { requestId });
  }

  dispose(): void {
    if (this.released) {
      return;
    }

    this.released = true;
    this.options.release?.();
  }

  getLastAssistantText(): string | undefined {
    return this.lastAssistantText;
  }

  getActiveToolNames(): string[] {
    return this.options.tools.map((tool) => tool.name);
  }

  private async appendHistory(): Promise<void> {
    const pending = this.history;
    for (const message of pending) {
      await this.harness.appendMessage(message);
    }
    this.history = [];
  }

  private snapshotTools(): AgentPiToolDefinition[] {
    return [...this.options.tools];
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function readAssistantText(message: AgentState["messages"][number]): string {
  const content = message.role === "assistant" ? message.content : [];
  return content
    .flatMap((entry) => (entry.type === "text" && typeof entry.text === "string" ? [entry.text] : []))
    .join("")
    .trim();
}

function throwIfAssistantFailed(message: AssistantMessage): void {
  if (message.stopReason === "aborted") {
    throw new AgentCancellationError(message.errorMessage ?? "Pi provider request was aborted.");
  }
  if (message.stopReason === "error") {
    throw new Error(message.errorMessage ?? "Pi provider returned an error.");
  }
}
