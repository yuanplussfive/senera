import {
  AgentToolContentPolicyCompressionModes,
  AgentToolContentPolicyDeduplicationModes,
  AgentToolContentPolicyKinds,
  AgentToolContentPolicyOwnerships,
  AgentToolContentPolicyPreservables,
  AgentToolContentProjectionReasons,
  type AgentToolContentPolicy,
  type AgentToolContentPolicyKind,
  type AgentToolContentProjection,
  type AgentToolContentProjectionStats,
} from "../Types/AgentToolContentPolicyTypes.js";

export interface AgentToolContentPolicyDispatchInput {
  readonly value: unknown;
  readonly policy?: AgentToolContentPolicy;
}

export type AgentToolContentPolicyProcessor = (value: unknown, policy: AgentToolContentPolicy) => unknown;

/**
 * Selects one content operation from a tool declaration.
 *
 * This class deliberately does not know tool names. A package declares the
 * ownership and representation of its output; the dispatcher then selects a
 * strategy and leaves observationProjection to enforce the final token cap.
 * Complete output is never mutated here and remains owned by Artifact.
 */
export class AgentToolContentPolicyDispatcher {
  private readonly processors: ReadonlyMap<AgentToolContentPolicyKind, AgentToolContentPolicyProcessor>;

  constructor(processors: ReadonlyMap<AgentToolContentPolicyKind, AgentToolContentPolicyProcessor> = new Map()) {
    this.processors = new Map([...defaultProcessors(), ...processors]);
  }

  project(input: AgentToolContentPolicyDispatchInput): AgentToolContentProjection {
    const sourceCharacters = characterCount(input.value);
    const policy = input.policy;
    if (!policy) return identityProjection(input.value, sourceCharacters, AgentToolContentProjectionReasons.Opaque);
    if (policy.ownership === AgentToolContentPolicyOwnerships.Tool) {
      return identityProjection(input.value, sourceCharacters, AgentToolContentProjectionReasons.ToolOwned, policy);
    }

    const processor = this.processors.get(policy.kind);
    // Content projection is an optional optimization. A missing or failing
    // processor must never turn a successful tool call into a host failure;
    // the structural/token projector remains the authoritative fallback.
    if (!processor)
      return identityProjection(input.value, sourceCharacters, AgentToolContentProjectionReasons.Opaque, policy);
    let value: unknown;
    try {
      value = processor(input.value, policy);
    } catch {
      return identityProjection(input.value, sourceCharacters, AgentToolContentProjectionReasons.Opaque, policy);
    }
    const projectedCharacters = characterCount(value);
    const transformed = value !== input.value;
    const unchangedReason = ProjectionReasonsByKind.get(policy.kind) ?? AgentToolContentProjectionReasons.Opaque;
    const reason = transformed ? AgentToolContentProjectionReasons.Applied : unchangedReason;
    return {
      value,
      policy,
      reason,
      stats: projectionStats(sourceCharacters, projectedCharacters, transformed ? 1 : 0),
    };
  }
}

function defaultProcessors(): ReadonlyMap<AgentToolContentPolicyKind, AgentToolContentPolicyProcessor> {
  return new Map<AgentToolContentPolicyKind, AgentToolContentPolicyProcessor>([
    [AgentToolContentPolicyKinds.Opaque, identityProcessor],
    [AgentToolContentPolicyKinds.Structured, identityProcessor],
    [AgentToolContentPolicyKinds.Execution, identityProcessor],
    [AgentToolContentPolicyKinds.AssetReference, identityProcessor],
    [AgentToolContentPolicyKinds.WebReadable, projectWebReadable],
  ]);
}

const ProjectionReasonsByKind: ReadonlyMap<AgentToolContentPolicy["kind"], AgentToolContentProjection["reason"]> =
  new Map([
    [AgentToolContentPolicyKinds.Opaque, AgentToolContentProjectionReasons.Opaque],
    [AgentToolContentPolicyKinds.Structured, AgentToolContentProjectionReasons.Structured],
    [AgentToolContentPolicyKinds.Execution, AgentToolContentProjectionReasons.Execution],
    [AgentToolContentPolicyKinds.AssetReference, AgentToolContentProjectionReasons.AssetReference],
    [AgentToolContentPolicyKinds.WebReadable, AgentToolContentProjectionReasons.Opaque],
  ]);

function identityProcessor(value: unknown): unknown {
  return value;
}

function projectWebReadable(value: unknown, policy: AgentToolContentPolicy): unknown {
  const targets = policy.targets?.length ? policy.targets : [""];
  return targets.reduce(
    (current, pointer) => replaceStringTarget(current, pointer, (text) => projectReadableText(text, policy)),
    value,
  );
}

function projectReadableText(value: string, policy: AgentToolContentPolicy): string {
  const normalized =
    policy.compression === AgentToolContentPolicyCompressionModes.Bounded ? normalizeReadableText(value) : value;
  return policy.deduplication === AgentToolContentPolicyDeduplicationModes.ProseOnly
    ? deduplicateProseBlocks(normalized, policy)
    : normalized;
}

function normalizeReadableText(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(/[ \t]+\n/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();
}

function deduplicateProseBlocks(value: string, policy: AgentToolContentPolicy): string {
  const seen = new Set<string>();
  return value
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter((block) => {
      if (!block || isPreservableBlock(block, policy)) return Boolean(block);
      const key = block.replaceAll(/\s+/gu, " ").trim().toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n\n");
}

function isPreservableBlock(value: string, policy: AgentToolContentPolicy): boolean {
  const preserve = new Set(policy.preserve ?? []);
  if (preserve.has(AgentToolContentPolicyPreservables.Code) && value.includes("```")) return true;
  if (preserve.has(AgentToolContentPolicyPreservables.Json) && (value.startsWith("[") || value.startsWith("{"))) {
    return true;
  }
  if (
    preserve.has(AgentToolContentPolicyPreservables.Logs) &&
    /^(?:\s*\[[^\]]+\]|\s*\d{4}-\d{2}-\d{2}[T ]|\s*(?:GET|POST|PUT|PATCH|DELETE)\s)/u.test(value)
  ) {
    return true;
  }
  if (preserve.has(AgentToolContentPolicyPreservables.Urls) && /^https?:\/\/\S+$/iu.test(value)) return true;
  return preserve.has(AgentToolContentPolicyPreservables.Identifiers) && /^[A-Za-z_][A-Za-z0-9_.:/-]*$/u.test(value);
}

function replaceStringTarget(value: unknown, pointer: string, transform: (value: string) => string): unknown {
  if (pointer === "") return typeof value === "string" ? transform(value) : value;
  if (!isContainer(value)) return value;
  const segments = pointer.slice(1).split("/").map(unescapePointerSegment);
  const [head, ...tail] = segments;
  if (head === undefined) return value;
  if (Array.isArray(value)) {
    if (!/^(?:0|[1-9]\d*)$/u.test(head)) return value;
    const index = Number(head);
    if (index < 0 || index >= value.length) return value;
    const next =
      tail.length === 0
        ? transformIfString(value[index], transform)
        : replaceStringTarget(value[index], `/${tail.map(escapePointerSegment).join("/")}`, transform);
    if (next === value[index]) return value;
    const copy = [...value];
    copy[index] = next;
    return copy;
  }
  const object = value as Record<string, unknown>;
  if (!Object.hasOwn(object, head)) return value;
  const next =
    tail.length === 0
      ? transformIfString(object[head], transform)
      : replaceStringTarget(object[head], `/${tail.map(escapePointerSegment).join("/")}`, transform);
  if (next === object[head]) return value;
  const copy = { ...object };
  copy[head] = next;
  return copy;
}

function transformIfString(value: unknown, transform: (value: string) => string): unknown {
  return typeof value === "string" ? transform(value) : value;
}

function isContainer(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return typeof value === "object" && value !== null;
}

function unescapePointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function escapePointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function identityProjection(
  value: unknown,
  sourceCharacters: number,
  reason: AgentToolContentProjection["reason"],
  policy?: AgentToolContentPolicy,
): AgentToolContentProjection {
  return {
    value,
    ...(policy ? { policy } : {}),
    reason,
    stats: projectionStats(sourceCharacters, sourceCharacters, 0),
  };
}

function projectionStats(
  sourceCharacters: number,
  projectedCharacters: number,
  transformedTargets: number,
): AgentToolContentProjectionStats {
  return {
    sourceCharacters,
    projectedCharacters,
    removedCharacters: Math.max(0, sourceCharacters - projectedCharacters),
    transformedTargets,
  };
}

function characterCount(value: unknown): number {
  if (typeof value === "string") return Array.from(value).length;
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? Array.from(serialized).length : 0;
  } catch {
    return 0;
  }
}
