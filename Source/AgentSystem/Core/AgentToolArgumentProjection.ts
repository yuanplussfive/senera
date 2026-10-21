import { formatAgentJsonPointer, parseAgentJsonPointer } from "./AgentJsonPointerOperations.js";
import type { AgentJsonProjectionOmission } from "../Text/AgentBudgetedJsonProjection.js";
import { isAgentUnknownRecord as isRecord } from "./AgentUnknownValue.js";

/**
 * The declared pointers a tool contract wants to stay addressable, plus the
 * budgets that bound the projection.
 */
export interface AgentToolArgumentProjectionPolicy {
  /**
   * RFC 6901 pointers the presentation layer reads, `*` fan-out allowed.
   * Every path these resolve to survives projection, so contract templates
   * keep rendering instead of silently falling back to a raw argument dump.
   */
  readonly keepPointers: readonly string[];
  /** Byte ceiling for the projected value. */
  readonly maxBytes: number;
  /** Byte ceiling for a single projected string leaf. */
  readonly maxLeafBytes: number;
  /** Maximum array entries kept when a pointer fans out with `*`. */
  readonly maxArrayEntries: number;
}

export interface AgentToolArgumentProjection {
  readonly value: unknown;
  readonly omissions: readonly AgentJsonProjectionOmission[];
}

/** Mirrors the step-trace field ceiling; declared pointers override it. */
export const DefaultAgentToolArgumentProjection: Omit<AgentToolArgumentProjectionPolicy, "keepPointers"> = {
  maxBytes: 65536,
  maxLeafBytes: 2048,
  maxArrayEntries: 64,
};

/** Trailer appended to a shrunk leaf, so the value reads as incomplete. */
const LeafOmissionMarker = "…";

/** Below this a shrunk leaf stops being identifiable, so we stop tightening. */
const LeafByteFloor = 32;

/**
 * Projects tool arguments while keeping every contract-declared pointer
 * resolvable.
 *
 * This replaces the previous byte-slice clamp, which replaced an oversized
 * argument object with an opaque `{ __truncated, preview }` envelope. That
 * shape had no reader anywhere, so every downstream pointer walk resolved to
 * nothing and the UI degraded to printing the envelope itself. Here the
 * structure along declared paths is preserved, oversized leaves shrink in
 * place, and every loss is recorded by RFC 6901 path.
 */
export function projectAgentToolArguments(
  value: unknown,
  policy: AgentToolArgumentProjectionPolicy,
): AgentToolArgumentProjection {
  if (value === null || value === undefined) return { value, omissions: [] };
  if (typeof value === "number" && !Number.isFinite(value)) return { value, omissions: [] };
  if (typeof value === "string") {
    const shrunk = truncateUtf8(value, policy.maxBytes);
    return {
      value: shrunk.text,
      omissions: shrunk.truncated ? [{ path: "", reason: "token_limit" }] : [],
    };
  }
  if (typeof value !== "object") return { value, omissions: [] };

  const patterns = patternSet(policy.keepPointers);
  if (patterns.length === 0) {
    // No declared pointers (results, opaque payloads): shrink leaves but keep
    // the shape, mirroring the result-side projection's per-field policy.
    const terminalState = createState(policy);
    const projected = projectTerminalLeaf(value, terminalState, policy, []);
    return { value: projected, omissions: terminalState.omissions };
  }

  let state = createState(policy);
  let projected = projectNode(value, patterns, state, policy, []);
  // Declared pointers win over the global ceiling: an oversized argument object
  // must not lose the paths the presentation layer reads. Tighten the per-leaf
  // budget until the whole value fits, so a large patch keeps its operation
  // kinds, paths and counts while only the file bodies shrink.
  let leafBytes = policy.maxLeafBytes;
  while (utf8ByteLength(tryStringify(projected)) > policy.maxBytes && leafBytes > LeafByteFloor) {
    leafBytes = Math.max(LeafByteFloor, Math.floor(leafBytes / 2));
    state = createState(policy);
    projected = projectNode(value, patterns, state, { ...policy, maxLeafBytes: leafBytes }, []);
  }
  return { value: projected, omissions: state.omissions };
}

function createState(policy: AgentToolArgumentProjectionPolicy): ProjectionState {
  return {
    omissions: [],
    ancestors: new WeakSet<object>(),
    visitedNodes: 0,
    maxNodes: Math.max(256, policy.maxArrayEntries * 32),
  };
}

/** Only the remaining path segments matter once we are inside the value. */
interface PointerPattern {
  readonly tokens: readonly string[];
}

interface ProjectionState {
  readonly omissions: AgentJsonProjectionOmission[];
  readonly ancestors: WeakSet<object>;
  readonly maxNodes: number;
  visitedNodes: number;
}

function patternSet(pointers: readonly string[]): PointerPattern[] {
  return pointers.map((pointer) => ({ tokens: parseAgentJsonPointer(pointer) }));
}

function projectNode(
  source: unknown,
  patterns: readonly PointerPattern[],
  state: ProjectionState,
  policy: AgentToolArgumentProjectionPolicy,
  path: readonly string[],
): unknown {
  state.visitedNodes += 1;
  if (state.visitedNodes > state.maxNodes) {
    recordOmission(state, path, "branch_limit");
    return containerSkeleton(source);
  }

  if (patterns.some((pattern) => pattern.tokens.length === 0)) {
    return projectTerminalLeaf(source, state, policy, path);
  }
  if (source === null || source === undefined) return source;
  if (typeof source === "string" || typeof source === "number" || typeof source === "boolean") return source;
  if (typeof source === "bigint") return projectTerminalLeaf(source, state, policy, path);
  if (typeof source !== "object") {
    recordOmission(state, path, "unsupported_value");
    return undefined;
  }
  if (state.ancestors.has(source as object)) {
    recordOmission(state, path, "cycle");
    return containerSkeleton(source);
  }
  state.ancestors.add(source as object);
  try {
    return Array.isArray(source)
      ? projectArray(source, patterns, state, policy, path)
      : projectRecord(source as Record<string, unknown>, patterns, state, policy, path);
  } finally {
    state.ancestors.delete(source as object);
  }
}

/**
 * A pointer ends at this node. Objects stay whole but descend with an empty
 * pattern set, so their shape survives while the strings inside shrink.
 */
function projectTerminalLeaf(
  source: unknown,
  state: ProjectionState,
  policy: AgentToolArgumentProjectionPolicy,
  path: readonly string[],
): unknown {
  if (typeof source === "string") {
    const shrunk = truncateUtf8(source, policy.maxLeafBytes);
    if (shrunk.truncated) recordOmission(state, path, "token_limit");
    return shrunk.text;
  }
  if (typeof source === "bigint") return String(source);
  if (source === null || source === undefined) return source;
  if (typeof source !== "object") return source;
  if (state.ancestors.has(source as object)) {
    recordOmission(state, path, "cycle");
    return containerSkeleton(source);
  }
  state.ancestors.add(source as object);
  try {
    if (Array.isArray(source)) {
      return source.map((entry, index) => projectTerminalLeaf(entry, state, policy, [...path, String(index)]));
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source as Record<string, unknown>)) {
      result[key] = projectTerminalLeaf(entry, state, policy, [...path, key]);
    }
    return result;
  } finally {
    state.ancestors.delete(source as object);
  }
}

function projectArray(
  source: readonly unknown[],
  patterns: readonly PointerPattern[],
  state: ProjectionState,
  policy: AgentToolArgumentProjectionPolicy,
  path: readonly string[],
): unknown[] {
  // A declared `*` fans out across the whole array: the presentation may read
  // any entry, so no index may be dropped. The entry cap only bounds entries
  // beyond the pattern's reach, where nothing declared is being read.
  const fansOutAll = patterns.some((pattern) => pattern.tokens[0] === "*");
  const declaredIndexes = resolveDeclaredIndexes(patterns, source.length);
  const limit = fansOutAll
    ? source.length
    : Math.max(declaredIndexes.size, Math.min(source.length, policy.maxArrayEntries));
  const skipped = source.length - limit;
  if (skipped > 0) recordOmission(state, path, "branch_limit", skipped);

  const kept: unknown[] = [];
  for (let index = 0; index < limit; index += 1) {
    const entryPatterns = fansOutAll
      ? stripFanout(patterns)
      : declaredIndexes.has(String(index))
        ? descendPatterns(patterns, String(index))
        : [];
    if (entryPatterns.length === 0) {
      // Hold the position: dropping the slot would re-index later entries and
      // silently repoint pointers the contract already resolved.
      kept.push(null);
      continue;
    }
    const projected = projectNode(source[index], entryPatterns, state, policy, [...path, String(index)]);
    kept.push(projected === undefined ? null : projected);
  }
  return kept;
}

/** Indexes a declared pointer addresses explicitly, so the cap cannot drop them. */
function resolveDeclaredIndexes(patterns: readonly PointerPattern[], length: number): Set<string> {
  const indexes = new Set<string>();
  for (const pattern of patterns) {
    const [token] = pattern.tokens;
    if (token === undefined || token === "*") continue;
    if (/^(?:0|[1-9]\d*)$/u.test(token) && Number(token) < length) indexes.add(token);
  }
  return indexes;
}

/** `*` consumed one level, leaving the tail for each entry. */
function stripFanout(patterns: readonly PointerPattern[]): PointerPattern[] {
  const stripped: PointerPattern[] = [];
  for (const pattern of patterns) {
    const [token, ...remaining] = pattern.tokens;
    if (token === "*") stripped.push({ tokens: remaining });
  }
  return stripped;
}

function projectRecord(
  source: Record<string, unknown>,
  patterns: readonly PointerPattern[],
  state: ProjectionState,
  policy: AgentToolArgumentProjectionPolicy,
  path: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    const entryPatterns = descendPatterns(patterns, key);
    if (entryPatterns.length === 0) continue;
    const projected = projectNode(entry, entryPatterns, state, policy, [...path, key]);
    if (projected !== undefined) result[key] = projected;
  }
  return result;
}

/** Patterns that step one segment deeper, either literally or through `*`. */
function descendPatterns(patterns: readonly PointerPattern[], key: string): PointerPattern[] {
  const descended: PointerPattern[] = [];
  for (const pattern of patterns) {
    const [token, ...remaining] = pattern.tokens;
    if (token === undefined) continue;
    if (token === "*" || token === key) descended.push({ tokens: remaining });
  }
  return descended;
}

function containerSkeleton(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  return isRecord(value) ? {} : null;
}

function recordOmission(
  state: ProjectionState,
  path: readonly string[],
  reason: AgentJsonProjectionOmission["reason"],
  remaining?: number,
): void {
  state.omissions.push({
    path: formatAgentJsonPointer(path),
    reason,
    ...(remaining === undefined ? {} : { remaining }),
  });
}

/**
 * Truncates to a UTF-8 byte ceiling without splitting a multi-byte sequence.
 * The previous clamp sliced by UTF-16 code unit while naming the constant
 * after bytes, so it could cut a surrogate pair in half.
 */
export function truncateUtf8(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  if (utf8ByteLength(value) <= maxBytes) return { text: value, truncated: false };
  const marker = LeafOmissionMarker;
  const budget = Math.max(0, maxBytes - utf8ByteLength(marker));
  const source = Buffer.from(value, "utf8");
  let end = Math.min(budget, source.length);
  // Walk back off any continuation byte so the slice stays valid UTF-8.
  while (end > 0 && (source[end] & 0xc0) === 0x80) end -= 1;
  return { text: `${source.subarray(0, end).toString("utf8")}${marker}`, truncated: true };
}

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function tryStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}
