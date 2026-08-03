import type { AgentToolObservationStructuralLimits } from "../Types/AgentToolObservationProjectionTypes.js";

export const AgentToolObservationOmissionReasons = {
  ArrayLimit: "array_limit",
  CharacterLimit: "character_limit",
  Cycle: "cycle",
  DepthLimit: "depth_limit",
  NodeLimit: "node_limit",
  ObjectLimit: "object_limit",
  TypeMismatch: "type_mismatch",
  UnsupportedValue: "unsupported_value",
  ArtifactPolicy: "artifact_policy",
  TokenLimit: "token_limit",
} as const;

export type AgentToolObservationOmissionReason =
  (typeof AgentToolObservationOmissionReasons)[keyof typeof AgentToolObservationOmissionReasons];

export interface AgentToolObservationProjectionOmission {
  readonly path: string;
  readonly reason: AgentToolObservationOmissionReason;
  readonly omitted?: number;
}

export interface AgentToolObservationStructuralProjection {
  readonly value: unknown;
  readonly complete: boolean;
  readonly omissionCount: number;
  readonly omissions: readonly AgentToolObservationProjectionOmission[];
}

interface ProjectionState {
  readonly limits: AgentToolObservationStructuralLimits;
  readonly maxOmissions: number;
  readonly ancestors: WeakSet<object>;
  nodes: number;
  characters: number;
  omissionCount: number;
  omissions: AgentToolObservationProjectionOmission[];
}

export class AgentToolObservationStructuralProjector {
  project(
    value: unknown,
    limits: AgentToolObservationStructuralLimits,
    maxOmissions: number,
  ): AgentToolObservationStructuralProjection {
    const state: ProjectionState = {
      limits,
      maxOmissions: normalizeNonNegativeInteger(maxOmissions),
      ancestors: new WeakSet<object>(),
      nodes: 0,
      characters: 0,
      omissionCount: 0,
      omissions: [],
    };
    return {
      value: this.visit(value, [], 0, state, false),
      complete: state.omissionCount === 0,
      omissionCount: state.omissionCount,
      omissions: state.omissions,
    };
  }

  private visit(
    value: unknown,
    path: readonly (string | number)[],
    depth: number,
    state: ProjectionState,
    arrayEntry: boolean,
  ): unknown {
    if (state.nodes >= state.limits.maxNodes) {
      this.omit(state, path, AgentToolObservationOmissionReasons.NodeLimit);
      return containerSkeleton(value);
    }
    state.nodes += 1;

    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") return this.projectString(String(value), path, state);
    if (typeof value === "string") return this.projectString(value, path, state);
    if (value === undefined || typeof value === "function" || typeof value === "symbol") {
      this.omit(state, path, AgentToolObservationOmissionReasons.UnsupportedValue);
      return arrayEntry ? null : undefined;
    }
    if (!isJsonContainer(value)) {
      this.omit(state, path, AgentToolObservationOmissionReasons.UnsupportedValue);
      return null;
    }
    if (state.ancestors.has(value)) {
      this.omit(state, path, AgentToolObservationOmissionReasons.Cycle);
      return containerSkeleton(value);
    }
    if (depth >= state.limits.maxDepth) {
      this.omit(state, path, AgentToolObservationOmissionReasons.DepthLimit, containerSize(value));
      return containerSkeleton(value);
    }

    state.ancestors.add(value);
    try {
      return Array.isArray(value)
        ? this.projectArray(value, path, depth, state)
        : this.projectObject(value as Readonly<Record<string, unknown>>, path, depth, state);
    } finally {
      state.ancestors.delete(value);
    }
  }

  private projectArray(
    values: readonly unknown[],
    path: readonly (string | number)[],
    depth: number,
    state: ProjectionState,
  ): unknown[] {
    const limit = Math.min(values.length, state.limits.maxArrayItems);
    const projected: unknown[] = [];
    for (let index = 0; index < limit; index += 1) {
      if (state.nodes >= state.limits.maxNodes) {
        this.omit(state, [...path, index], AgentToolObservationOmissionReasons.NodeLimit, values.length - index);
        break;
      }
      projected.push(this.visit(values[index], [...path, index], depth + 1, state, true));
    }
    if (limit < values.length && projected.length === limit) {
      this.omit(state, [...path, limit], AgentToolObservationOmissionReasons.ArrayLimit, values.length - limit);
    }
    return projected;
  }

  private projectObject(
    value: Readonly<Record<string, unknown>>,
    path: readonly (string | number)[],
    depth: number,
    state: ProjectionState,
  ): Record<string, unknown> {
    const entries = Object.entries(value).filter(([, entry]) => isJsonPropertyValue(entry));
    const limit = Math.min(entries.length, state.limits.maxObjectProperties);
    const projected: Record<string, unknown> = {};
    for (let index = 0; index < limit; index += 1) {
      const entry = entries[index];
      if (!entry) continue;
      const [key, child] = entry;
      if (!this.reserveCharacters(key.length, state)) {
        this.omit(state, [...path, key], AgentToolObservationOmissionReasons.CharacterLimit, entries.length - index);
        break;
      }
      if (state.nodes >= state.limits.maxNodes) {
        this.omit(state, [...path, key], AgentToolObservationOmissionReasons.NodeLimit, entries.length - index);
        break;
      }
      const result = this.visit(child, [...path, key], depth + 1, state, false);
      if (result !== undefined) projected[key] = result;
    }
    if (limit < entries.length && Object.keys(projected).length === limit) {
      this.omit(
        state,
        [...path, entries[limit]?.[0] ?? limit],
        AgentToolObservationOmissionReasons.ObjectLimit,
        entries.length - limit,
      );
    }
    return projected;
  }

  private projectString(value: string, path: readonly (string | number)[], state: ProjectionState): string {
    const remainingCharacters = Math.max(0, state.limits.maxTotalCharacters - state.characters);
    const retainedLength = Math.min(value.length, state.limits.maxStringCharacters, remainingCharacters);
    state.characters += retainedLength;
    if (retainedLength < value.length) {
      this.omit(state, path, AgentToolObservationOmissionReasons.CharacterLimit, value.length - retainedLength);
    }
    return value.slice(0, retainedLength);
  }

  private reserveCharacters(count: number, state: ProjectionState): boolean {
    if (state.characters + count > state.limits.maxTotalCharacters) return false;
    state.characters += count;
    return true;
  }

  private omit(
    state: ProjectionState,
    path: readonly (string | number)[],
    reason: AgentToolObservationOmissionReason,
    omitted?: number,
  ): void {
    state.omissionCount += 1;
    if (state.omissions.length >= state.maxOmissions) return;
    state.omissions.push({ path: jsonPointer(path), reason, ...(omitted === undefined ? {} : { omitted }) });
  }
}

export function selectAgentToolObservationPointer(root: unknown, pointer: string | undefined): unknown {
  if (pointer === undefined || pointer === "") return root;
  let current = root;
  for (const segment of pointer.slice(1).split("/").map(unescapeJsonPointerSegment)) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (!isJsonContainer(current) || !Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonPropertyValue(value: unknown): boolean {
  return value !== undefined && typeof value !== "function" && typeof value !== "symbol";
}

function containerSkeleton(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  return isJsonContainer(value) ? {} : null;
}

function containerSize(value: Record<string, unknown> | readonly unknown[]): number {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

function jsonPointer(path: readonly (string | number)[]): string {
  if (path.length === 0) return "";
  return `/${path.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function unescapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
