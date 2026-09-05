import {
  AgentModelTextPreviewer,
  AgentModelTokenEstimator,
  AgentTokenizationPreflight,
  shouldProjectBeforeExactTokenization,
} from "./AgentTextBudget.js";
import { projectAgentModelText } from "./AgentModelPayloadProjection.js";

const ProjectionEllipsis = "...";
const MaximumLeafCount = 4_096;
const MaximumProjectionNodes = 4_096;

export interface AgentBudgetedJsonProjection {
  readonly projectedValue: unknown;
  readonly text: string;
  readonly complete: boolean;
  readonly tokenCount: number;
  readonly tokenLimit: number;
  readonly omissionCount: number;
  readonly omissions: readonly AgentJsonProjectionOmission[];
}

export type AgentJsonProjectionOmissionReason = "token_limit" | "branch_limit" | "cycle" | "unsupported_value";

export interface AgentJsonProjectionOmission {
  readonly path: string;
  readonly reason: AgentJsonProjectionOmissionReason;
  readonly remaining?: number;
}

interface PartialJsonView {
  value: unknown;
}

interface PartialProjectionState {
  readonly omissions: AgentJsonProjectionOmission[];
  readonly ancestors: WeakSet<object>;
  readonly leafTokenLimit: number;
  readonly nodeLimit: number;
  visitedNodes: number;
}

export class AgentBudgetedJsonProjector {
  private readonly estimator: AgentModelTokenEstimator;
  private readonly model: string;
  private lastExactMeasurement: { serialized: string; tokenCount: number } | undefined;

  constructor(model: string) {
    this.model = model;
    this.estimator = new AgentModelTokenEstimator({ model });
  }

  project(value: unknown, requestedTokenLimit: number): AgentBudgetedJsonProjection {
    const tokenLimit = normalizePositiveInteger(requestedTokenLimit);
    const serialized = canAttemptCompleteSerialization(value, tokenLimit) ? tryStringifyJson(value) : undefined;
    const completeInspection =
      serialized === undefined ? { withinLimit: false as const } : this.inspectSerialized(serialized, tokenLimit);
    if (completeInspection.withinLimit) {
      const projectedValue = parseJson(serialized as string);
      return {
        projectedValue,
        text: serialized as string,
        complete: true,
        tokenCount: completeInspection.tokenCount,
        tokenLimit,
        omissionCount: 0,
        omissions: [],
      };
    }

    const omissions: AgentJsonProjectionOmission[] = [];
    const leafCount = countTextLeaves(value);
    const state: PartialProjectionState = {
      omissions,
      ancestors: new WeakSet<object>(),
      leafTokenLimit: initialLeafTokenLimit(tokenLimit, leafCount),
      nodeLimit: Math.max(256, Math.min(MaximumProjectionNodes, tokenLimit * 16)),
      visitedNodes: 0,
    };
    const view = createPartialView(value);
    view.value = this.projectLeafWise(value, [], state, false);
    this.fitValueToBudget(view, tokenLimit, omissions);
    const text = stringifyJson(view.value);
    const tokenCount = this.estimateSerialized(text);
    if (tokenCount > tokenLimit) {
      throw new Error(`JSON projection cannot fit the requested token budget: ${tokenLimit}.`);
    }
    return {
      projectedValue: view.value,
      text,
      complete: false,
      tokenCount,
      tokenLimit,
      omissionCount: omissions.length,
      omissions,
    };
  }

  fits(value: unknown, tokenLimit: number): boolean {
    const normalizedLimit = normalizePositiveInteger(tokenLimit);
    // Do not stringify a payload whose conservative JSON footprint already
    // proves that it cannot fit. This path is called repeatedly while a
    // projection searches for a fitting candidate, so the preflight must
    // happen before the potentially huge serialization and BPE pass.
    if (!maySerializeWithinTokenBudget(value, normalizedLimit)) return false;
    const serialized = stringifyJson(value);
    return this.inspectSerialized(serialized, normalizedLimit).withinLimit;
  }

  count(value: unknown): number {
    return this.estimateSerialized(stringifyJson(value));
  }

  private inspectSerialized(serialized: string, tokenLimit: number) {
    const cached = this.lastExactMeasurement;
    if (cached?.serialized === serialized) {
      return cached.tokenCount <= normalizePositiveInteger(tokenLimit)
        ? { withinLimit: true as const, tokenCount: cached.tokenCount }
        : { withinLimit: false as const };
    }
    // A large raw payload cannot fit after JSON framing. Avoid an exact BPE pass
    // over content that must be projected, while retaining exact measurement for
    // every bounded candidate and final result.
    if (shouldProjectBeforeExactTokenization(serialized, tokenLimit)) {
      return { withinLimit: false as const };
    }
    const inspection = this.estimator.inspect(serialized, tokenLimit);
    if (inspection.withinLimit) this.lastExactMeasurement = { serialized, tokenCount: inspection.tokenCount };
    return inspection;
  }

  private estimateSerialized(serialized: string): number {
    const cached = this.lastExactMeasurement;
    if (cached?.serialized === serialized) return cached.tokenCount;
    const tokenCount = this.estimator.estimate(serialized).tokenCount;
    this.lastExactMeasurement = { serialized, tokenCount };
    return tokenCount;
  }

  private projectLeafWise(
    source: unknown,
    path: readonly (string | number)[],
    state: PartialProjectionState,
    arrayEntry: boolean,
  ): unknown {
    state.visitedNodes += 1;
    if (state.visitedNodes > state.nodeLimit) {
      this.recordOmission(state.omissions, path, "branch_limit");
      return containerSkeleton(source);
    }

    if (typeof source === "string") {
      const projected = this.previewLeafText(
        projectAgentModelText(source, { maxStringCharacters: Number.MAX_SAFE_INTEGER }).text,
        state.leafTokenLimit,
      );
      if (projected.truncated) this.recordOmission(state.omissions, path, "token_limit");
      return projected.text;
    }
    if (typeof source === "bigint") {
      const projected = this.previewLeafText(String(source), state.leafTokenLimit);
      if (projected.truncated) this.recordOmission(state.omissions, path, "token_limit");
      return projected.text;
    }
    if (source === null || typeof source === "boolean") return source;
    if (typeof source === "number") return Number.isFinite(source) ? source : null;
    if (source === undefined || typeof source === "function" || typeof source === "symbol") {
      this.recordOmission(state.omissions, path, "unsupported_value");
      return arrayEntry ? null : undefined;
    }
    if (!isExpandableContainer(source)) {
      try {
        return this.projectLeafWise(normalizeJsonValue(source), path, state, arrayEntry);
      } catch {
        this.recordOmission(state.omissions, path, "unsupported_value");
        return arrayEntry ? null : undefined;
      }
    }
    if (state.ancestors.has(source)) {
      this.recordOmission(state.omissions, path, "cycle");
      return containerSkeleton(source);
    }

    state.ancestors.add(source);
    try {
      if (Array.isArray(source)) {
        const projected: unknown[] = [];
        let index = 0;
        for (; index < source.length; index += 1) {
          if (state.visitedNodes >= state.nodeLimit) {
            this.recordOmission(state.omissions, [...path, index], "branch_limit", source.length - index);
            break;
          }
          projected.push(this.projectLeafWise(source[index], [...path, index], state, true));
        }
        return projected;
      }
      const projected: Record<string, unknown> = {};
      for (const key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        if (state.visitedNodes >= state.nodeLimit) {
          this.recordOmission(state.omissions, [...path, key], "branch_limit");
          break;
        }
        const entry = source[key];
        if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
          this.recordOmission(state.omissions, [...path, key], "unsupported_value");
          continue;
        }
        const child = this.projectLeafWise(entry, [...path, key], state, false);
        if (child !== undefined) projected[key] = child;
      }
      return projected;
    } finally {
      state.ancestors.delete(source);
    }
  }

  private previewLeafText(value: string, tokenLimit: number): { text: string; truncated: boolean } {
    const preview = new AgentModelTextPreviewer({ model: this.model, tokenLimit }).preview(value);
    return { text: preview.text, truncated: preview.truncated };
  }

  private fitValueToBudget(view: PartialJsonView, tokenLimit: number, omissions: AgentJsonProjectionOmission[]): void {
    if (this.fits(view.value, tokenLimit)) return;

    const stringPaths = collectStringPaths(view.value);
    const perLeafTokenFloor = Math.max(1, Math.floor(tokenLimit / Math.max(1, stringPaths.length)));
    while (stringPaths.length > 0 && !this.fits(view.value, tokenLimit)) {
      const currentTokens = this.count(view.value);
      if (currentTokens <= tokenLimit) return;
      const shrinkRatio = Math.max(0.05, Math.min(0.9, (tokenLimit / currentTokens) * 0.92));
      let changed = false;
      const orderedPaths = [...stringPaths].sort((left, right) => {
        const leftValue = readPath(view.value, left);
        const rightValue = readPath(view.value, right);
        return (
          (typeof rightValue === "string" ? codePointLength(rightValue) : 0) -
          (typeof leftValue === "string" ? codePointLength(leftValue) : 0)
        );
      });
      for (const path of orderedPaths) {
        const current = readPath(view.value, path);
        if (typeof current !== "string") continue;
        const base = current.endsWith(ProjectionEllipsis)
          ? current.slice(0, -ProjectionEllipsis.length).trimEnd()
          : current;
        if (base.length === 0) continue;
        if (this.estimator.inspect(base, perLeafTokenFloor).withinLimit) continue;
        const currentLength = codePointLength(base);
        const nextLength = Math.min(currentLength, Math.max(0, Math.floor(currentLength * shrinkRatio)));
        if (nextLength >= currentLength) continue;
        assignPath(view, path, `${takeCodePoints(base, nextLength)}${ProjectionEllipsis}`);
        this.recordOmission(omissions, path, "token_limit");
        changed = true;
      }
      if (!changed) break;
    }
    if (this.fits(view.value, tokenLimit)) return;

    for (const path of collectContainerPaths(view.value).sort((left, right) => right.length - left.length)) {
      const container = readPath(view.value, path);
      if (!isExpandableContainer(container)) continue;
      const entries = containerEntries(container);
      if (entries.length === 0) continue;
      const best = largestFittingPrefix(entries.length, (length) => {
        replaceContainerPrefix(container, entries, length);
        return this.fits(view.value, tokenLimit);
      });
      replaceContainerPrefix(container, entries, best);
      if (best < entries.length) {
        this.recordOmission(omissions, [...path, best], "branch_limit", entries.length - best);
      }
      if (this.fits(view.value, tokenLimit)) return;
    }
  }

  private recordOmission(
    omissions: AgentJsonProjectionOmission[],
    path: readonly (string | number)[],
    reason: AgentJsonProjectionOmissionReason,
    remaining?: number,
  ): void {
    omissions.push({ path: jsonPointer(path), reason, ...(remaining === undefined ? {} : { remaining }) });
  }
}

function initialLeafTokenLimit(tokenLimit: number, leafCount: number): number {
  const normalizedLeafCount = Math.max(1, leafCount);
  const balancedLimit = Math.floor(tokenLimit / Math.sqrt(normalizedLeafCount));
  return Math.max(1, Math.min(tokenLimit, balancedLimit));
}

function largestFittingPrefix(length: number, apply: (length: number) => boolean): number {
  let low = 0;
  let high = length;
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (apply(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

function countTextLeaves(value: unknown, ancestors = new WeakSet<object>(), count = { value: 0 }): number {
  if (count.value >= MaximumLeafCount) return MaximumLeafCount;
  if (typeof value === "string" || typeof value === "bigint") {
    count.value += 1;
    return Math.max(1, count.value);
  }
  if (!isExpandableContainer(value) || ancestors.has(value)) return Math.max(1, count.value);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const entry of value) countTextLeaves(entry, ancestors, count);
    } else {
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        countTextLeaves(value[key], ancestors, count);
        if (count.value >= MaximumLeafCount) break;
      }
    }
  } finally {
    ancestors.delete(value);
  }
  return Math.max(1, Math.min(MaximumLeafCount, count.value));
}

function collectStringPaths(
  value: unknown,
  path: readonly (string | number)[] = [],
  result: (string | number)[][] = [],
): (string | number)[][] {
  if (typeof value === "string") {
    result.push([...path]);
    return result;
  }
  if (!isExpandableContainer(value)) return result;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStringPaths(entry, [...path, index], result));
  } else {
    Object.entries(value).forEach(([key, entry]) => collectStringPaths(entry, [...path, key], result));
  }
  return result;
}

function collectContainerPaths(
  value: unknown,
  path: readonly (string | number)[] = [],
  result: (string | number)[][] = [],
): (string | number)[][] {
  if (!isExpandableContainer(value)) return result;
  result.push([...path]);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectContainerPaths(entry, [...path, index], result));
  } else {
    Object.entries(value).forEach(([key, entry]) => collectContainerPaths(entry, [...path, key], result));
  }
  return result;
}

function readPath(root: unknown, path: readonly (string | number)[]): unknown {
  let current = root;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") current = current[segment];
    else if (isExpandableContainer(current) && !Array.isArray(current)) current = current[String(segment)];
    else return undefined;
  }
  return current;
}

function writePath(root: unknown, path: readonly (string | number)[], value: unknown): void {
  if (path.length === 0) return;
  const parent = readPath(root, path.slice(0, -1));
  const segment = path[path.length - 1];
  if (Array.isArray(parent) && typeof segment === "number") parent[segment] = value;
  else if (isExpandableContainer(parent) && !Array.isArray(parent)) parent[String(segment)] = value;
}

function assignPath(view: PartialJsonView, path: readonly (string | number)[], value: unknown): void {
  if (path.length === 0) view.value = value;
  else writePath(view.value, path, value);
}

function containerEntries(value: object): unknown[] {
  return Array.isArray(value) ? [...value] : Object.entries(value);
}

function replaceContainerPrefix(container: object, entries: readonly unknown[], length: number): void {
  if (Array.isArray(container)) {
    container.splice(0, container.length, ...entries.slice(0, length));
    return;
  }
  const record = container as Record<string, unknown>;
  for (const key of Object.keys(record)) delete record[key];
  for (const [key, value] of entries.slice(0, length) as Array<[string, unknown]>) record[key] = value;
}

function normalizeCompleteValue(value: unknown): unknown {
  return JSON.parse(stringifyJson(value)) as unknown;
}

function normalizeJsonValue(value: unknown): unknown {
  return normalizeCompleteValue(value);
}

function createPartialView(value: unknown): PartialJsonView {
  return { value: containerSkeleton(value) };
}

function containerSkeleton(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  return isExpandableContainer(value) ? {} : null;
}

function isExpandableContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => (typeof entry === "bigint" ? String(entry) : entry)) ?? "null";
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function canAttemptCompleteSerialization(value: unknown, tokenLimit: number): boolean {
  return maySerializeWithinTokenBudget(value, tokenLimit);
}

export function maySerializeWithinTokenBudget(value: unknown, tokenLimit: number): boolean {
  const byteLimit = Math.max(1_024, tokenLimit * AgentTokenizationPreflight.maxUtf8BytesPerToken);
  return estimateJsonUtf8Bytes(value, byteLimit).withinLimit;
}

function estimateJsonUtf8Bytes(value: unknown, byteLimit: number): { withinLimit: boolean; bytes: number } {
  const state: JsonFootprintState = {
    ancestors: new WeakSet<object>(),
    bytes: 0,
    limit: byteLimit,
    nodes: 0,
  };
  const withinLimit = visitJsonFootprint(value, state);
  return { withinLimit, bytes: state.bytes };
}

interface JsonFootprintState {
  readonly ancestors: WeakSet<object>;
  readonly limit: number;
  bytes: number;
  nodes: number;
}

function visitJsonFootprint(value: unknown, state: JsonFootprintState): boolean {
  state.nodes += 1;
  if (state.nodes > MaximumProjectionNodes || state.bytes > state.limit) return false;

  if (value === null) return addJsonFootprintBytes(state, 4);
  if (typeof value === "string") return addJsonFootprintBytes(state, Math.min(state.limit + 1, value.length * 6 + 2));
  if (typeof value === "bigint")
    return addJsonFootprintBytes(state, Math.min(state.limit + 1, String(value).length + 2));
  if (typeof value === "boolean") return addJsonFootprintBytes(state, value ? 4 : 5);
  if (typeof value === "number") return addJsonFootprintBytes(state, Number.isFinite(value) ? 24 : 4);
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return addJsonFootprintBytes(state, 4);
  }
  if (!isExpandableContainer(value) || state.ancestors.has(value)) return false;

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (!addJsonFootprintBytes(state, 1)) return false;
      for (const entry of value) {
        if (!visitJsonFootprint(entry, state) || !addJsonFootprintBytes(state, 1)) return false;
      }
      return addJsonFootprintBytes(state, 1);
    }

    if (!addJsonFootprintBytes(state, 1)) return false;
    let first = true;
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const entry = value[key];
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
      if (!first && !addJsonFootprintBytes(state, 1)) return false;
      first = false;
      if (!addJsonFootprintBytes(state, Math.min(state.limit + 1, key.length * 6 + 4))) return false;
      if (!visitJsonFootprint(entry, state)) return false;
    }
    return addJsonFootprintBytes(state, 1);
  } finally {
    state.ancestors.delete(value);
  }
}

function addJsonFootprintBytes(state: JsonFootprintState, bytes: number): boolean {
  state.bytes += bytes;
  return state.bytes <= state.limit;
}

function tryStringifyJson(value: unknown): string | undefined {
  try {
    return stringifyJson(value);
  } catch {
    return undefined;
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function takeCodePoints(value: string, length: number): string {
  return Array.from(value).slice(0, length).join("");
}

function jsonPointer(path: readonly (string | number)[]): string {
  if (path.length === 0) return "";
  return `/${path.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}
