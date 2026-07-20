import {
  AgentHarness,
  type AgentHarnessOptions,
  type AgentHarnessResources,
  type PromptTemplate,
  type Skill,
} from "@earendil-works/pi-agent-core";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { AgentPiProxyContextHeader } from "../PiProxy/AgentPiProxyRuntimeContext.js";
import type { AgentPiHarnessEvent, AgentPiHarnessTraceContext } from "./AgentPiHarnessEvents.js";
import { isPiCoreAgentEvent, projectPiHarnessTraceEvent } from "./AgentPiHarnessEvents.js";
import { AgentPiHarnessSession } from "./AgentPiHarnessSession.js";
import type { AgentPiSession } from "./AgentPiSubstrate.js";
import { renderPiHarnessSystemPrompt, type AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { applyAgentPiContextPolicy, type AgentPiContextPolicyFrame } from "./AgentPiContextPolicy.js";
import type { AgentPiProviderProjection, AgentPiToolDefinition } from "./AgentPiTypes.js";
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import type { AgentPiToolSet } from "./AgentPiToolRegistryProjector.js";
import type {
  AgentPiCompactionInspection,
  AgentPiCompactionPlan,
  AgentPiCompactionPolicy,
} from "./AgentPiCompactionPolicy.js";
import type { AgentPiCompactionSummarizer } from "./AgentPiCompactionSummarizer.js";
import { createPiTraceEvent } from "./AgentPiTraceProjector.js";
import { resolveAgentPiSessionCacheCapacity } from "./AgentPiSessionCachePolicy.js";

type AgentPiHarness = AgentHarness<Skill, PromptTemplate, AgentPiToolDefinition>;
type AgentPiHarnessOptions = AgentHarnessOptions<Skill, PromptTemplate, AgentPiToolDefinition>;

export interface AgentPiHarnessSessionFrame {
  sessionId?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  systemPrompt?: string;
  piProxyRuntimeContextId?: string;
  activeSkills?: readonly AgentActivatedSkill[];
  rootCommand?: AgentRootCommand;
  turnUnderstanding?: TurnUnderstanding;
  selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
  contextPolicy?: AgentPiContextPolicyFrame;
}

export interface AgentPiHarnessSessionPoolOptions {
  env: SeneraExecutionEnv;
  provider: AgentPiProviderProjection;
  modelProvider: ResolvedAgentModelProviderConfig;
  maxIdleSessions?: number;
  harnessFactory?: (options: AgentPiHarnessOptions) => AgentPiHarness;
  compactionPolicy?: AgentPiCompactionPolicy;
  compactionSummarizer?: AgentPiCompactionSummarizer;
}

export interface AgentPiHarnessLeaseInput {
  sessionId: string;
  session: AgentPiHarnessOptions["session"];
  signal?: AbortSignal;
  toolSet: AgentPiToolSet;
  resources: AgentHarnessResources<Skill, PromptTemplate>;
  resourceFingerprint: string;
  frame: AgentPiHarnessSessionFrame;
  preflight: (event: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }) => Promise<{ block?: boolean; reason?: string } | undefined>;
}

export interface AgentPiHarnessSessionPoolPort {
  lease(input: AgentPiHarnessLeaseInput): Promise<AgentPiHarnessLeaseResult>;
  findPersistentSession(sessionId: string): AgentPiHarnessOptions["session"] | undefined;
  rewind(sessionId: string, entryId: string): Promise<boolean>;
  reset(sessionId: string): Promise<void>;
  close(): Promise<void>;
}
export interface AgentPiHarnessLeaseResult {
  session: AgentPiSession;
  storage: "created" | "existing";
}

export function composePiProxyRequestHeaders(
  providerHeaders: Readonly<Record<string, string>>,
  piProxyRuntimeContextId?: string,
): Record<string, string> {
  return piProxyRuntimeContextId
    ? {
        ...providerHeaders,
        [AgentPiProxyContextHeader]: piProxyRuntimeContextId,
      }
    : { ...providerHeaders };
}

interface PooledHarness {
  readonly harness: AgentPiHarness;
  readonly frame: AgentPiMutableHarnessFrame;
  readonly disposeTrace: () => void;
  readonly disposeContextPolicy: () => void;
  readonly persistentSession: AgentPiHarnessOptions["session"];
  disposeCompaction: () => void;
  disposePreflight?: () => void;
  compactionRequest?: {
    plan: Extract<AgentPiCompactionPlan, { kind: "compact" }>;
    signal: AbortSignal;
  };
  shutdownPromise?: Promise<void>;
  tools: AgentPiToolDefinition[];
  toolFingerprint: string;
  resourceFingerprint: string;
  activeLeases: number;
  lastAccess: number;
}

class AgentPiMutableHarnessFrame {
  private value: AgentPiHarnessSessionFrame;

  constructor(value: AgentPiHarnessSessionFrame) {
    this.value = { ...value };
  }

  update(value: AgentPiHarnessSessionFrame): void {
    this.value = { ...value };
  }

  snapshot(): AgentPiHarnessSessionFrame {
    return { ...this.value };
  }
}

export class AgentPiHarnessSessionPool {
  private readonly sessions = new Map<string, PooledHarness>();
  private readonly leases = new AgentKeyedLeaseQueue<string>();
  private readonly maxIdleSessions: number;
  private closePromise: Promise<void> | undefined;
  private accessSequence = 0;

  constructor(private readonly options: AgentPiHarnessSessionPoolOptions) {
    this.maxIdleSessions = resolveAgentPiSessionCacheCapacity(options.maxIdleSessions);
  }

  findPersistentSession(sessionId: string): AgentPiHarnessOptions["session"] | undefined {
    const pooled = this.sessions.get(sessionId);
    if (!pooled) return undefined;
    pooled.lastAccess = this.nextAccessSequence();
    return pooled.persistentSession;
  }

  async lease(input: AgentPiHarnessLeaseInput): Promise<AgentPiHarnessLeaseResult> {
    const releaseLease = await this.acquireLease(input.sessionId, input.signal);
    let pooled: PooledHarness | undefined;
    try {
      const leased = await this.openOrCreate(input);
      pooled = leased.value;
      pooled.activeLeases += 1;
      pooled.lastAccess = this.nextAccessSequence();
      await this.configurePooledHarness(pooled, input);

      return {
        storage: leased.storage,
        session: new AgentPiHarnessSession(pooled.harness, {
          model: this.options.provider.model,
          tools: pooled.tools,
          persistentSession: input.session,
          compactionPolicy: this.options.compactionSummarizer ? this.options.compactionPolicy : undefined,
          setCompactionRequest: (request) => {
            pooled!.compactionRequest = request;
          },
          onCompactionEvent: (event, inspection, payload) =>
            this.emitCompactionTrace(pooled!.frame.snapshot(), event, inspection, payload),
          release: () => this.releasePooledHarness(input.sessionId, pooled!, releaseLease),
        }),
      };
    } catch (error) {
      if (pooled) {
        this.releasePooledHarness(input.sessionId, pooled, releaseLease);
      } else {
        releaseLease();
      }
      throw error;
    }
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeSessions());
  }

  private async closeSessions(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((pooled) => this.shutdownPooledHarness(pooled)));
  }

  async reset(sessionId: string): Promise<void> {
    const releaseLease = await this.acquireLease(sessionId);
    try {
      const pooled = this.sessions.get(sessionId);
      if (pooled && this.sessions.get(sessionId) === pooled) {
        this.sessions.delete(sessionId);
        await this.shutdownPooledHarness(pooled);
      }
    } finally {
      releaseLease();
    }
  }

  async rewind(sessionId: string, entryId: string): Promise<boolean> {
    const releaseLease = await this.acquireLease(sessionId);
    try {
      const pooled = this.sessions.get(sessionId);
      if (!pooled) return false;
      await pooled.harness.waitForIdle();
      if (!(await pooled.persistentSession.getEntry(entryId))) return false;
      await pooled.persistentSession.moveTo(entryId);
      return true;
    } finally {
      releaseLease();
    }
  }

  private async acquireLease(sessionId: string, signal?: AbortSignal): Promise<() => void> {
    return this.leases.acquire(sessionId, signal);
  }

  private async openOrCreate(input: AgentPiHarnessLeaseInput): Promise<{
    value: PooledHarness;
    storage: AgentPiHarnessLeaseResult["storage"];
  }> {
    const current = this.sessions.get(input.sessionId);
    if (current) {
      return {
        value: current,
        storage: "existing",
      };
    }

    const frame = new AgentPiMutableHarnessFrame(input.frame);
    const tools = input.toolSet.materialize(() => projectToolContext(frame.snapshot()));
    const harnessOptions: AgentPiHarnessOptions = {
      env: this.options.env,
      session: input.session,
      tools,
      activeToolNames: [...input.toolSet.activeToolNames],
      resources: input.resources,
      model: {
        ...this.options.provider.model,
        headers: this.providerHeaders(frame.snapshot()),
      },
      thinkingLevel: "off",
      streamOptions: this.streamOptions(frame.snapshot()),
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      getApiKeyAndHeaders: async () => ({
        apiKey: this.options.provider.apiKey,
        headers: this.providerHeaders(frame.snapshot()),
      }),
      systemPrompt: ({ resources }) =>
        renderPiHarnessSystemPrompt({
          systemPrompt: frame.snapshot().systemPrompt ?? "",
          skills: resources.skills ?? [],
          selectedPromptTemplates: frame.snapshot().selectedPromptTemplates,
        }),
    };
    const harness =
      this.options.harnessFactory?.(harnessOptions) ??
      new AgentHarness<Skill, PromptTemplate, AgentPiToolDefinition>(harnessOptions);
    const disposeTrace = harness.subscribe((event) =>
      this.emitHarnessTrace(frame.snapshot(), event as AgentPiHarnessEvent),
    );
    const disposeContextPolicy = harness.on("context", (event) => ({
      messages: applyAgentPiContextPolicy(event.messages, frame.snapshot().contextPolicy),
    }));
    const pooled: PooledHarness = {
      harness,
      frame,
      disposeTrace,
      disposeContextPolicy,
      persistentSession: input.session,
      disposeCompaction: () => undefined,
      tools,
      toolFingerprint: input.toolSet.fingerprint,
      resourceFingerprint: input.resourceFingerprint,
      activeLeases: 0,
      lastAccess: this.nextAccessSequence(),
    };
    pooled.disposeCompaction = harness.on("session_before_compact", async (event) => {
      const request = pooled.compactionRequest;
      const summarizer = this.options.compactionSummarizer;
      if (!request || !summarizer) return undefined;
      const currentLeafId = event.branchEntries.at(-1)?.id;
      if (currentLeafId !== request.plan.leafEntryId) {
        throw new Error("Pi session branch changed after compaction planning.");
      }
      return {
        compaction: await summarizer.summarize({
          preparation: request.plan.preparation,
          inspection: request.plan.inspection,
          objective: frame.snapshot().rootCommand?.objective ?? frame.snapshot().turnUnderstanding?.standaloneRequest,
          customInstructions: event.customInstructions,
          evidence: frame.snapshot().contextPolicy?.historicalEvidence,
          signal: request.signal,
        }),
      };
    });
    this.sessions.set(input.sessionId, pooled);
    return {
      value: pooled,
      storage: "created",
    };
  }

  private async configurePooledHarness(pooled: PooledHarness, input: AgentPiHarnessLeaseInput): Promise<void> {
    const cancellation = createHarnessCancellation(pooled.harness, input.signal);
    try {
      pooled.frame.update(input.frame);
      pooled.disposePreflight?.();
      pooled.disposePreflight = pooled.harness.on("tool_call", (event) =>
        input.preflight({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
        }),
      );

      await pooled.harness.waitForIdle();
      throwIfAborted(input.signal);
      if (pooled.toolFingerprint !== input.toolSet.fingerprint) {
        const tools = input.toolSet.materialize(() => projectToolContext(pooled.frame.snapshot()));
        await pooled.harness.setTools(tools, [...input.toolSet.activeToolNames]);
        throwIfAborted(input.signal);
        pooled.tools = tools;
        pooled.toolFingerprint = input.toolSet.fingerprint;
      }
      if (pooled.resourceFingerprint !== input.resourceFingerprint) {
        await pooled.harness.setResources(input.resources);
        throwIfAborted(input.signal);
        pooled.resourceFingerprint = input.resourceFingerprint;
      }
      await pooled.harness.setStreamOptions(this.streamOptions(input.frame));
      throwIfAborted(input.signal);
    } finally {
      await cancellation.dispose();
    }
  }

  private streamOptions(frame: AgentPiHarnessSessionFrame) {
    return {
      transport: "auto" as const,
      timeoutMs: this.options.modelProvider.TimeoutMs,
      maxRetries: this.options.modelProvider.MaxNetworkRetries,
      headers: this.providerHeaders(frame),
    };
  }

  private providerHeaders(frame: AgentPiHarnessSessionFrame): Record<string, string> {
    return composePiProxyRequestHeaders(this.options.provider.headers, frame.piProxyRuntimeContextId);
  }

  private releasePooledHarness(sessionId: string, pooled: PooledHarness, releaseLease: () => void): void {
    pooled.activeLeases = Math.max(0, pooled.activeLeases - 1);
    pooled.lastAccess = this.nextAccessSequence();
    releaseLease();
    // Let a queued lease for this session claim the harness before eviction runs.
    queueMicrotask(() => this.trimIdleSessions());
  }

  private trimIdleSessions(): void {
    const idleSessions = [...this.sessions.entries()]
      .filter(([, pooled]) => pooled.activeLeases === 0)
      .sort(([, left], [, right]) => right.lastAccess - left.lastAccess);
    for (const [sessionId, pooled] of idleSessions.slice(this.maxIdleSessions)) {
      this.evictPooledHarness(sessionId, pooled);
    }
  }

  private evictPooledHarness(sessionId: string, pooled: PooledHarness): void {
    if (this.sessions.get(sessionId) !== pooled) {
      return;
    }
    this.sessions.delete(sessionId);
    void this.shutdownPooledHarness(pooled).catch(() => undefined);
  }

  private shutdownPooledHarness(pooled: PooledHarness): Promise<void> {
    if (!pooled.shutdownPromise) {
      pooled.disposePreflight?.();
      pooled.disposeContextPolicy();
      pooled.disposeCompaction();
      pooled.disposeTrace();
      pooled.shutdownPromise = (async () => {
        await pooled.harness.abort();
        await pooled.harness.waitForIdle();
      })();
    }
    return pooled.shutdownPromise;
  }

  private nextAccessSequence(): number {
    this.accessSequence += 1;
    return this.accessSequence;
  }

  private async emitHarnessTrace(frame: AgentPiHarnessSessionFrame, event: AgentPiHarnessEvent): Promise<void> {
    if (isPiCoreAgentEvent(event)) {
      return;
    }

    const projected = projectPiHarnessTraceEvent(traceContextFromFrame(frame), event);
    if (projected) {
      await emitAgentEvent(frame.onEvent, projected);
    }
  }

  private async emitCompactionTrace(
    frame: AgentPiHarnessSessionFrame,
    event: "checked" | "skipped" | "started" | "completed" | "failed",
    inspection: AgentPiCompactionInspection,
    payload?: unknown,
  ): Promise<void> {
    const check = projectCompactionCheck(payload);
    if (event === "checked" && check) {
      await emitAgentEvent(
        frame.onEvent,
        createPiTraceEvent({
          ...traceContextFromFrame(frame),
          source: "substrate",
          eventType: "compaction.check.timing",
          payload: check,
        }),
      );
    }
    await emitAgentEvent(
      frame.onEvent,
      createPiTraceEvent({
        ...traceContextFromFrame(frame),
        source: "substrate",
        eventType: `compaction.${event}`,
        payload: {
          ...inspection,
          result:
            event === "completed"
              ? projectCompactionResult(payload)
              : event === "skipped"
                ? projectCompactionSkipResult(payload)
                : undefined,
          error: event === "failed" && payload instanceof Error ? payload.message : undefined,
        },
      }),
    );
  }
}

function createHarnessCancellation(harness: AgentPiHarness, signal?: AbortSignal): { dispose(): Promise<void> } {
  let cancellation: Promise<unknown> | undefined;
  const abort = (): void => {
    cancellation ??= harness.abort().catch(() => undefined);
  };

  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  return {
    async dispose(): Promise<void> {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) abort();
      await cancellation;
    },
  };
}

function projectToolContext(frame: AgentPiHarnessSessionFrame): AgentPiToolProjectionContext {
  return {
    sessionId: frame.sessionId,
    requestId: frame.requestId,
    step: frame.step,
    onEvent: frame.onEvent,
    piProxyRuntimeContextId: frame.piProxyRuntimeContextId,
    activeSkills: frame.activeSkills,
    rootCommand: frame.rootCommand,
    turnUnderstanding: frame.turnUnderstanding,
  };
}

function projectCompactionResult(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  return {
    firstKeptEntryId: result.firstKeptEntryId,
    tokensBefore: result.tokensBefore,
    summaryChars: typeof result.summary === "string" ? result.summary.length : undefined,
    details: result.details,
  };
}

function projectCompactionCheck(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  const projected = Object.fromEntries(
    ["durationMs", "branchEntryCount"].flatMap((key) => (typeof result[key] === "number" ? [[key, result[key]]] : [])),
  );
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function projectCompactionSkipResult(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  return {
    reason: result.reason,
    recommendedAction: result.recommendedAction,
  };
}

function traceContextFromFrame(frame: AgentPiHarnessSessionFrame): AgentPiHarnessTraceContext {
  return {
    sessionId: frame.sessionId,
    requestId: frame.requestId ?? "pi-substrate",
    step: frame.step ?? 0,
  };
}
