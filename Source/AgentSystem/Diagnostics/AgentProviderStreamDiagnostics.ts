import { randomUUID } from "node:crypto";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { isAgentSelfSensitiveKey } from "../SelfService/AgentSelfRedaction.js";
import { sanitizeDiagnosticDetails } from "./AgentPiDiagnostics.js";
import { activeAgentModelDiagnosticScope } from "./AgentModelDiagnosticScope.js";
import { isAgentConfigSensitiveHeaderName } from "../Config/AgentConfigSecretContract.js";
import type { AgentWorkspaceLogDetailPublication } from "./AgentWorkspaceLogStore.js";
import type {
  AgentPiDiagnosticSink,
  AgentProviderStreamInput,
  AgentProviderStreamCapture,
  AgentProviderStreamFactory,
  AgentProviderStreamRequestStatus,
} from "../PiShared/AgentPiDiagnosticsTypes.js";

const Limits = {
  eventTypes: 64,
  toolCalls: 64,
  projectionEntries: 128,
  projectionDepth: 8,
  metadataCharacters: 256,
} as const;

interface ProviderIdentity {
  readonly provider: string;
  readonly api: string;
  readonly model: string;
}
interface TraceEvent {
  readonly sequence: number;
  readonly elapsedMs: number;
  readonly data: unknown;
}
interface CapturedEvent {
  readonly event: TraceEvent;
  readonly bytes: number;
}

export function collectAgentProviderDiagnosticSecrets(input: {
  readonly apiKeys: readonly (string | undefined)[];
  readonly headers: readonly (Readonly<Record<string, string | null>> | undefined)[];
}): readonly string[] {
  const secrets = new Set(input.apiKeys.filter((value): value is string => Boolean(value)));
  for (const headers of input.headers) {
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (isAgentConfigSensitiveHeaderName(key) && value) secrets.add(value);
    }
  }
  return [...secrets].sort((left, right) => right.length - left.length);
}

/** One completion record per wire request. No chunk publication, network interception or disk work in callbacks. */
export function createAgentProviderStreamDiagnosticSink(options: {
  readonly sink: AgentPiDiagnosticSink;
  readonly policy: () => {
    readonly enabled: boolean;
    readonly raw: boolean;
    readonly maxBytes: number;
    readonly maxConcurrentWrites: number;
  };
  readonly publishDetail: (value: unknown) => Promise<AgentWorkspaceLogDetailPublication>;
}): { readonly sink: AgentPiDiagnosticSink; close(): Promise<void> } {
  const pending = new Set<Promise<void>>();
  const reporting = new Set<Promise<void>>();
  let closed = false;
  const factory: AgentProviderStreamFactory = (input) => {
    const policy = options.policy();
    return new ProviderStreamCapture(
      input,
      policy.enabled && policy.raw && !closed ? policy.maxBytes : 0,
      (summary, events) => {
        if (!policy.enabled) return;
        const report = (persistence: string, detailId?: string) => {
          try {
            const result = options.sink({
              context: input.context ?? {},
              source: "provider",
              name: "stream_summary",
              summary: `${summary.providerId}/${summary.actual.model} ${summary.status} events=${summary.providerEvents} durationMs=${summary.durationMs} trace=${persistence}`,
              details: { ...summary, persistence },
              detailId,
            });
            if (result) {
              const task = Promise.resolve(result).catch(() => undefined);
              reporting.add(task);
              void task.finally(() => reporting.delete(task));
            }
          } catch {
            // A diagnostic sink is observational, including during shutdown.
          }
        };
        if (!events) {
          report(closed ? "closed" : "summary_only");
          return;
        }
        if (closed || pending.size >= policy.maxConcurrentWrites) {
          report(closed ? "closed" : "busy");
          return;
        }
        const save = async () => {
          const trace = { protocol: "senera.provider-stream/v1", summary, events };
          if (Buffer.byteLength(JSON.stringify(trace)) + 1 > policy.maxBytes) {
            report("budget");
            return;
          }
          const publication = await options.publishDetail(trace);
          report(publication.status, publication.status === "saved" ? publication.detailId : undefined);
        };
        const task = new Promise<void>((resolve) => setImmediate(resolve)).then(save).catch(() => report("failed"));
        pending.add(task);
        void task.finally(() => pending.delete(task));
      },
    );
  };
  return {
    sink: Object.assign((event: Parameters<AgentPiDiagnosticSink>[0]) => options.sink(event), {
      providerStream: factory,
    }),
    close: async () => {
      closed = true;
      await Promise.allSettled([...pending]);
      await Promise.allSettled([...reporting]);
    },
  };
}

/** Explicit native frames take precedence; auxiliary calls inherit the current execution/learning owner. */
export function startAgentProviderStreamCapture(
  input: AgentProviderStreamInput,
  sink?: AgentPiDiagnosticSink,
): AgentProviderStreamCapture | undefined {
  const scope = activeAgentModelDiagnosticScope();
  try {
    return (sink ?? scope?.sink)?.providerStream?.({
      ...input,
      context: { requestId: input.invocationId, ...scope?.context, ...input.context },
    });
  } catch {
    return undefined;
  }
}

class ProviderStreamCapture implements AgentProviderStreamCapture {
  private readonly started = performance.now();
  private readonly startedAt = new Date().toISOString();
  private readonly providerRequestId = randomUUID();
  private readonly rawTypes = new Map<string, number>();
  private readonly normalizedTypes = new Map<string, number>();
  private readonly head: CapturedEvent[] = [];
  private readonly tail = new Map<number, CapturedEvent>();
  private readonly tools = new Map<string, { id: string; name: string }>();
  private actual: ProviderIdentity;
  private finished = false;
  private headBytes = 0;
  private tailBytes = 0;
  private rawCount = 0;
  private toolCount = 0;
  private firstEventMs?: number;
  private firstOutputMs?: number;
  private stopReason?: string;
  private rawStopReason?: string;
  private usage?: unknown;
  private responseModel?: string;
  private providerTerminal = false;
  private projectionFailures = 0;

  constructor(
    private readonly input: AgentProviderStreamInput,
    private readonly maxBytes: number,
    private readonly publish: (
      summary: ReturnType<ProviderStreamCapture["summary"]>,
      events?: readonly TraceEvent[],
    ) => void,
  ) {
    this.actual = { provider: input.model.provider, api: input.model.api, model: input.model.id };
  }

  readonly onProviderStreamEvent: AgentProviderStreamCapture["onProviderStreamEvent"] = (data, model) => {
    if (this.finished) return;
    try {
      this.actual = { provider: model.provider, api: model.api, model: model.id };
      this.rawCount += 1;
      this.firstEventMs ??= this.elapsed();
      const type = data && typeof data === "object" && "type" in data ? data.type : undefined;
      increment(this.rawTypes, typeof type === "string" ? this.metadata(type) : "untyped");
      if (this.maxBytes <= 0) return;
      const event: TraceEvent = {
        sequence: this.rawCount,
        elapsedMs: this.elapsed(),
        data: projectRawStructure(data, (value) => this.metadata(value)),
      };
      const entry = { event, bytes: Buffer.byteLength(JSON.stringify(event)) + 1 };
      // Reserve half for the envelope/summary; keep both the start and the most recent tail.
      const segmentBytes = Math.floor(this.maxBytes / 4);
      if (entry.bytes > segmentBytes) return;
      if (this.headBytes + entry.bytes <= segmentBytes && !this.tail.size) {
        this.head.push(entry);
        this.headBytes += entry.bytes;
        return;
      }
      while (this.tailBytes + entry.bytes > segmentBytes && this.tail.size) {
        const oldest = this.tail.values().next().value;
        if (!oldest) break;
        this.tailBytes -= oldest.bytes;
        this.tail.delete(oldest.event.sequence);
      }
      this.tail.set(event.sequence, entry);
      this.tailBytes += entry.bytes;
    } catch {
      this.projectionFailures += 1;
      // Observational callbacks must not interrupt a provider's parser or consumer.
    }
  };

  observe(event: AssistantMessageEvent): void {
    if (this.finished) return;
    try {
      this.observeAssistant(event);
    } catch {
      this.projectionFailures += 1;
    }
  }

  private observeAssistant(event: AssistantMessageEvent): void {
    increment(this.normalizedTypes, event.type);
    if (["text_delta", "thinking_delta", "toolcall_delta"].includes(event.type)) this.firstOutputMs ??= this.elapsed();
    if (event.type === "toolcall_start" || event.type === "toolcall_end") {
      const block = event.partial.content[event.contentIndex];
      if (block?.type === "toolCall") this.rememberTool(block);
    }
    if (event.type === "done" || event.type === "error") {
      this.providerTerminal = true;
      const message = event.type === "done" ? event.message : event.error;
      this.stopReason = message.stopReason;
      this.rawStopReason = message.rawStopReason;
      this.responseModel = message.responseModel;
      if (message.responseModel) this.actual = { ...this.actual, model: message.responseModel };
      this.usage = sanitizeDiagnosticDetails(message.usage);
      // A streamed name/ID may be incomplete at toolcall_start. The terminal message is authoritative.
      this.tools.clear();
      for (const block of message.content) if (block.type === "toolCall") this.rememberTool(block);
      this.toolCount = message.content.filter((block) => block.type === "toolCall").length;
    }
  }

  finish(status: AgentProviderStreamRequestStatus, error?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    try {
      this.publish(
        this.summary(status, error),
        this.maxBytes > 0 ? [...this.head, ...this.tail.values()].map((e) => e.event) : undefined,
      );
    } catch {
      // A failed diagnostic must never reopen a completed request.
    } finally {
      this.head.length = 0;
      this.tail.clear();
    }
  }

  private summary(status: AgentProviderStreamRequestStatus, error?: unknown) {
    return {
      providerRequestId: this.providerRequestId,
      ...this.input.context,
      providerId: this.metadata(this.input.providerId),
      stage: this.metadata(this.input.stage),
      invocationId: this.input.invocationId ? this.metadata(this.input.invocationId) : undefined,
      requested: {
        provider: this.metadata(this.input.model.provider),
        api: this.metadata(this.input.model.api),
        model: this.metadata(this.input.model.id),
      },
      actual: {
        provider: this.metadata(this.actual.provider),
        api: this.metadata(this.actual.api),
        model: this.metadata(this.actual.model),
      },
      ...(this.responseModel ? { responseModel: this.metadata(this.responseModel) } : {}),
      startedAt: this.startedAt,
      durationMs: this.elapsed(),
      firstEventMs: this.firstEventMs,
      firstOutputMs: this.firstOutputMs,
      status,
      adapterTerminal: this.providerTerminal,
      stopReason: this.stopReason,
      rawStopReason: this.rawStopReason ? this.metadata(this.rawStopReason) : undefined,
      providerEvents: this.rawCount,
      eventTypes: Object.fromEntries(this.rawTypes),
      normalizedEvents: Object.fromEntries(this.normalizedTypes),
      toolCalls: [...this.tools.values()],
      omittedToolCalls: Math.max(0, this.toolCount - this.tools.size),
      usage: this.usage,
      capture: {
        mode: this.maxBytes > 0 ? "structure" : "summary",
        maxBytes: this.maxBytes,
        retainedEvents: this.head.length + this.tail.size,
        omittedEvents: this.rawCount - this.head.length - this.tail.size,
        projectionFailures: this.projectionFailures,
        content: "omitted",
      },
      ...(error === undefined ? {} : { error: this.metadata(error instanceof Error ? error.message : String(error)) }),
    };
  }

  private elapsed(): number {
    return Math.max(0, Math.round(performance.now() - this.started));
  }
  private metadata(value: string): string {
    return this.redactMetadata(value).slice(0, Limits.metadataCharacters);
  }
  private redactMetadata(value: string): string {
    let safe = value;
    for (const secret of this.input.secrets ?? []) if (secret) safe = safe.replaceAll(secret, "[redacted]");
    return safe.replace(/\bBearer\s+\S+/giu, "Bearer [redacted]");
  }
  private rememberTool(tool: { readonly id: string; readonly name: string }): void {
    if (this.tools.has(tool.id) || this.tools.size < Limits.toolCalls) {
      this.tools.set(tool.id, { id: this.redactMetadata(tool.id), name: this.redactMetadata(tool.name) });
      this.toolCount = this.tools.size;
    }
  }
}

function increment(counts: Map<string, number>, type: string): void {
  const key = counts.has(type) || counts.size < Limits.eventTypes ? type : "[other]";
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Preserve raw event shape and numeric protocol data. Text/argument fragments can split secrets across chunks. */
function projectRawStructure(value: unknown, metadata: (value: string) => string): unknown {
  let remaining = Limits.projectionEntries as number;
  const seen = new WeakSet<object>();
  const visit = (entry: unknown, depth: number, key?: string): unknown => {
    if (key && isAgentSelfSensitiveKey(key)) return "[redacted]";
    if (entry === null || typeof entry === "number" || typeof entry === "boolean") return entry;
    if (typeof entry === "string") return key === "type" ? metadata(entry) : `[string:${entry.length} chars]`;
    if (!entry || typeof entry !== "object") return "[unavailable]";
    if (depth >= Limits.projectionDepth || remaining <= 0) return "[truncated]";
    if (seen.has(entry)) return "[circular]";
    seen.add(entry);
    const entries: Array<[string, unknown]> = [];
    for (const field in entry) {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) continue;
      if (remaining-- <= 0) {
        entries.push(["[truncated]", true]);
        break;
      }
      entries.push([metadata(field), visit((entry as Record<string, unknown>)[field], depth + 1, field)]);
    }
    return Array.isArray(entry) ? entries.map(([, item]) => item) : Object.fromEntries(entries);
  };
  return visit(value, 0);
}
