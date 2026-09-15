import type { AssistantMessage, FetchFunction, Model, SimpleStreamOptions, StreamOptions } from "@earendil-works/pi-ai";
import { sha256Hex, sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentNativeToolApi } from "./AgentModelEndpointContract.js";

/**
 * Provider cache support is a protocol capability, not a consequence of a
 * Senera cache scope. Keep this registry explicit so unsupported adapters are
 * visible instead of being reported as successful cache hits.
 */
export const AgentPromptCacheStrategies: Readonly<Record<AgentNativeToolApi, AgentPromptCacheStrategy>> = {
  "openai-responses": "implicit-prefix",
  "openai-completions": "implicit-prefix",
  "anthropic-messages": "explicit-breakpoints",
  "google-generative-ai": "unsupported",
};

export type AgentPromptCacheStrategy = "implicit-prefix" | "explicit-breakpoints" | "named-context" | "unsupported";

export type AgentPromptCacheObservation = "requested" | "hit" | "miss" | "unsupported";

export interface AgentPromptWireSnapshot {
  readonly version: 1;
  readonly api: AgentNativeToolApi;
  readonly provider: string;
  readonly model: string;
  readonly sessionId?: string;
  readonly logicalCacheScope?: string;
  readonly providerCacheScope?: string;
  readonly stablePrefixRevision: string;
  readonly stablePrefixBytes: number;
  readonly strategy: AgentPromptCacheStrategy;
  readonly retention: NonNullable<SimpleStreamOptions["cacheRetention"]>;
  readonly payloadDigest?: string;
  readonly payloadBytes?: number;
  readonly wireBodyDigest?: string;
  readonly wireBodyBytes?: number;
  /** Digest of the provider-shaped stable prompt projection on the wire. */
  readonly wireStablePrefixDigest?: string;
  readonly wireStablePrefixSource?: "provider-projection" | "serialized-prefix";
  readonly observation: AgentPromptCacheObservation;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export interface AgentPromptWireCapture {
  readonly onPayload: NonNullable<SimpleStreamOptions["onPayload"]>;
  readonly fetch: FetchFunction;
  snapshot(input: {
    readonly model: Model<AgentNativeToolApi>;
    readonly sessionId?: string;
    readonly logicalCacheScope?: string;
    readonly providerCacheScope?: string;
    readonly stablePrefixRevision: string;
    readonly stablePrefixBytes: number;
    readonly retention: NonNullable<SimpleStreamOptions["cacheRetention"]>;
    readonly observation: AgentPromptCacheObservation;
    readonly usage: Pick<AssistantMessage["usage"], "cacheRead" | "cacheWrite">;
  }): AgentPromptWireSnapshot;
}

export function resolveAgentPromptCacheStrategy(api: AgentNativeToolApi): AgentPromptCacheStrategy {
  return AgentPromptCacheStrategies[api];
}

export function projectAgentPromptCacheRetention(
  strategy: AgentPromptCacheStrategy,
  requested: NonNullable<SimpleStreamOptions["cacheRetention"]>,
): NonNullable<SimpleStreamOptions["cacheRetention"]> {
  return strategy === "unsupported" ? "none" : requested;
}

export function resolveAgentPromptCacheObservation(
  strategy: AgentPromptCacheStrategy,
  usage: Pick<AssistantMessage["usage"], "cacheRead" | "cacheWrite">,
): AgentPromptCacheObservation {
  if (strategy === "unsupported") return "unsupported";
  if (usage.cacheRead > 0) return "hit";
  if (usage.cacheWrite > 0) return "miss";
  return "requested";
}

export function createAgentPromptWireCapture(
  options: Pick<StreamOptions | SimpleStreamOptions, "fetch" | "onPayload">,
): AgentPromptWireCapture {
  let payloadDigest: string | undefined;
  let payloadBytes: number | undefined;
  let wireBodyDigest: string | undefined;
  let wireBodyBytes: number | undefined;
  let wireBodyValue: Buffer | undefined;
  let payloadValue: unknown;
  const originalPayload = options.onPayload;
  const onPayload: NonNullable<SimpleStreamOptions["onPayload"]> = async (payload, model) => {
    const replacement = await originalPayload?.(payload, model);
    const effectivePayload = replacement === undefined ? payload : replacement;
    payloadValue = effectivePayload;
    try {
      payloadDigest = sha256HexOfCanonicalJson(effectivePayload);
      const serialized = JSON.stringify(effectivePayload);
      payloadBytes = serialized === undefined ? undefined : Buffer.byteLength(serialized, "utf8");
    } catch {
      // Wire observation is best effort; an exotic adapter payload must not
      // change the provider request's behavior.
      payloadDigest = undefined;
      payloadBytes = undefined;
    }
    return replacement;
  };
  const originalFetch = options.fetch ?? globalThis.fetch;
  const fetch: FetchFunction = async (input, init) => {
    try {
      const bodyIdentity = projectBodyIdentity(init?.body);
      if (bodyIdentity) {
        wireBodyDigest = bodyIdentity.digest;
        wireBodyBytes = bodyIdentity.bytes;
        wireBodyValue = bodyIdentity.value;
      }
    } catch {
      wireBodyDigest = undefined;
      wireBodyBytes = undefined;
      wireBodyValue = undefined;
    }
    return originalFetch(input, init);
  };

  return {
    onPayload,
    fetch,
    snapshot(input) {
      return {
        version: 1,
        api: input.model.api,
        provider: input.model.provider,
        model: input.model.id,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.logicalCacheScope ? { logicalCacheScope: input.logicalCacheScope } : {}),
        ...(input.providerCacheScope ? { providerCacheScope: input.providerCacheScope } : {}),
        stablePrefixRevision: input.stablePrefixRevision,
        stablePrefixBytes: input.stablePrefixBytes,
        strategy: resolveAgentPromptCacheStrategy(input.model.api),
        retention: input.retention,
        ...(payloadDigest ? { payloadDigest } : {}),
        ...(payloadBytes === undefined ? {} : { payloadBytes }),
        ...(wireBodyDigest ? { wireBodyDigest } : {}),
        ...(wireBodyBytes === undefined ? {} : { wireBodyBytes }),
        ...projectWireStablePrefixObservation(input.model.api, payloadValue, wireBodyValue, input.stablePrefixBytes),
        observation: input.observation,
        ...(input.usage.cacheRead === undefined ? {} : { cacheReadTokens: input.usage.cacheRead }),
        ...(input.usage.cacheWrite === undefined ? {} : { cacheWriteTokens: input.usage.cacheWrite }),
      };
    },
  };
}

export function projectAgentStablePrefixBytes(input: {
  readonly systemPrompt: string;
  readonly tools: readonly unknown[];
}): number {
  return Buffer.byteLength(`${input.systemPrompt}\n${JSON.stringify(input.tools) ?? ""}`, "utf8");
}

export function projectAgentStablePrefixRevision(input: {
  readonly systemPrompt: string;
  readonly tools: readonly unknown[];
}): string {
  return sha256HexOfCanonicalJson({ systemPrompt: input.systemPrompt, tools: input.tools });
}

function projectBodyIdentity(
  value: unknown,
): { readonly digest: string; readonly bytes: number; readonly value: Buffer } | undefined {
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return { digest: sha256Hex(bytes), bytes: bytes.byteLength, value: bytes };
  }
  if (value instanceof ArrayBuffer) {
    const viewBytes = new Uint8Array(value);
    const body = Buffer.from(viewBytes);
    return { digest: sha256Hex(body), bytes: body.byteLength, value: body };
  }
  if (ArrayBuffer.isView(value)) {
    const viewBytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const body = Buffer.from(viewBytes);
    return { digest: sha256Hex(body), bytes: body.byteLength, value: body };
  }
  return undefined;
}

export function verifyAgentPromptWireStablePrefix(
  previous: AgentPromptWireSnapshot,
  current: AgentPromptWireSnapshot,
): { readonly stable: boolean; readonly reason?: string } {
  if (previous.stablePrefixRevision !== current.stablePrefixRevision) {
    return { stable: false, reason: "stable prefix revision changed" };
  }
  if (previous.stablePrefixBytes !== current.stablePrefixBytes) {
    return { stable: false, reason: "stable prefix byte length changed" };
  }
  if (!previous.wireStablePrefixDigest || !current.wireStablePrefixDigest) {
    return { stable: false, reason: "wire stable prefix was not captured" };
  }
  if (previous.wireStablePrefixSource !== current.wireStablePrefixSource) {
    return { stable: false, reason: "wire stable prefix observation sources differ" };
  }
  return previous.wireStablePrefixDigest === current.wireStablePrefixDigest
    ? { stable: true }
    : { stable: false, reason: "wire stable prefix projection changed" };
}

type WirePayloadProjector = (payload: Record<string, unknown>) => unknown;

const AgentWireStablePrefixProjectors: Readonly<Record<AgentNativeToolApi, WirePayloadProjector>> = Object.freeze({
  "openai-responses": (payload) => ({
    model: payload.model ?? null,
    input: leadingStableMessages(payload.input),
    tools: payload.tools ?? [],
  }),
  "openai-completions": (payload) => ({
    model: payload.model ?? null,
    messages: leadingStableMessages(payload.messages),
    tools: payload.tools ?? [],
  }),
  "anthropic-messages": (payload) => ({
    model: payload.model ?? null,
    system: payload.system ?? null,
    tools: payload.tools ?? [],
  }),
  "google-generative-ai": (payload) => ({
    model: payload.model ?? null,
    systemInstruction: asRecord(payload.config)?.systemInstruction ?? null,
    tools: asRecord(payload.config)?.tools ?? [],
  }),
});

function projectWireStablePrefixObservation(
  api: AgentNativeToolApi,
  payload: unknown,
  wireBodyValue: Buffer | undefined,
  stablePrefixBytes: number,
): {
  readonly wireStablePrefixDigest?: string;
  readonly wireStablePrefixSource?: "provider-projection" | "serialized-prefix";
} {
  const record = asRecord(payload);
  if (record) {
    try {
      return {
        wireStablePrefixDigest: sha256HexOfCanonicalJson(AgentWireStablePrefixProjectors[api](record)),
        wireStablePrefixSource: "provider-projection",
      };
    } catch {
      // Continue with the raw body only when the adapter payload cannot be projected.
    }
  }
  if (!wireBodyValue || stablePrefixBytes > wireBodyValue.byteLength) return {};
  return {
    wireStablePrefixDigest: sha256Hex(wireBodyValue.subarray(0, stablePrefixBytes)),
    wireStablePrefixSource: "serialized-prefix",
  };
}

function leadingStableMessages(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const stable: unknown[] = [];
  for (const message of value) {
    const record = asRecord(message);
    const role = typeof record?.role === "string" ? record.role : undefined;
    if (role !== "system" && role !== "developer") break;
    stable.push(message);
  }
  return stable;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
