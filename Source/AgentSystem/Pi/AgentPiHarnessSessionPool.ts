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
import { AgentPiProxyContextHeader } from "../PiProxy/AgentPiProxyRuntimeContext.js";
import type { AgentPiHarnessEvent, AgentPiHarnessTraceContext } from "./AgentPiHarnessEvents.js";
import { isPiCoreAgentEvent, projectPiHarnessTraceEvent } from "./AgentPiHarnessEvents.js";
import { AgentPiHarnessSession } from "./AgentPiHarnessSession.js";
import type { AgentPiSession } from "./AgentPiSubstrate.js";
import { renderPiHarnessSystemPrompt, type AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import { applyAgentPiContextPolicy, type AgentPiContextPolicyFrame } from "./AgentPiContextPolicy.js";
import type { AgentPiProviderProjection, AgentPiToolDefinition } from "./AgentPiTypes.js";

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
}

export interface AgentPiHarnessLeaseInput {
  sessionId: string;
  session: AgentPiHarnessOptions["session"];
  tools: readonly AgentPiToolDefinition[];
  activeToolNames: readonly string[];
  resources: AgentHarnessResources<Skill, PromptTemplate>;
  frame: AgentPiHarnessSessionFrame;
  preflight: (event: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }) => Promise<{ block?: boolean; reason?: string } | undefined>;
}

export interface AgentPiHarnessSessionPoolPort {
  lease(input: AgentPiHarnessLeaseInput): Promise<AgentPiHarnessLeaseResult>;
  close(): void;
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

const DefaultMaxIdleSessions = 8;

interface PooledHarness {
  readonly harness: AgentPiHarness;
  readonly frame: AgentPiMutableHarnessFrame;
  readonly disposeTrace: () => void;
  readonly disposeContextPolicy: () => void;
  disposePreflight?: () => void;
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
  private readonly leaseQueues = new Map<string, Promise<void>>();
  private readonly maxIdleSessions: number;
  private accessSequence = 0;

  constructor(private readonly options: AgentPiHarnessSessionPoolOptions) {
    this.maxIdleSessions = normalizeMaxIdleSessions(options.maxIdleSessions);
  }

  async lease(input: AgentPiHarnessLeaseInput): Promise<AgentPiHarnessLeaseResult> {
    const releaseLease = await this.acquireLease(input.sessionId);
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
          tools: input.tools,
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

  close(): void {
    for (const pooled of this.sessions.values()) {
      this.disposePooledHarness(pooled);
    }
    this.sessions.clear();
  }

  private async acquireLease(sessionId: string): Promise<() => void> {
    const previous = this.leaseQueues.get(sessionId) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.leaseQueues.set(sessionId, tail);
    await previous.catch(() => undefined);

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      releaseCurrent();
      void tail.finally(() => {
        if (this.leaseQueues.get(sessionId) === tail) {
          this.leaseQueues.delete(sessionId);
        }
      });
    };
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
    const harnessOptions: AgentPiHarnessOptions = {
      env: this.options.env,
      session: input.session,
      tools: [...input.tools],
      activeToolNames: [...input.activeToolNames],
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
      activeLeases: 0,
      lastAccess: this.nextAccessSequence(),
    };
    this.sessions.set(input.sessionId, pooled);
    return {
      value: pooled,
      storage: "created",
    };
  }

  private async configurePooledHarness(pooled: PooledHarness, input: AgentPiHarnessLeaseInput): Promise<void> {
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
    await pooled.harness.setTools([...input.tools], [...input.activeToolNames]);
    await pooled.harness.setResources(input.resources);
    await pooled.harness.setStreamOptions(this.streamOptions(input.frame));
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
    this.disposePooledHarness(pooled);
  }

  private disposePooledHarness(pooled: PooledHarness): void {
    pooled.disposePreflight?.();
    pooled.disposeContextPolicy();
    pooled.disposeTrace();
    void pooled.harness.abort().catch(() => undefined);
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
}

function normalizeMaxIdleSessions(value: number | undefined): number {
  if (value === undefined) {
    return DefaultMaxIdleSessions;
  }
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : DefaultMaxIdleSessions;
}

function traceContextFromFrame(frame: AgentPiHarnessSessionFrame): AgentPiHarnessTraceContext {
  return {
    sessionId: frame.sessionId,
    requestId: frame.requestId ?? "pi-substrate",
    step: frame.step ?? 0,
  };
}
