import { AgentModelTokenEstimator } from "./AgentTextBudget.js";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";

export const AgentJsonProjectionProtocol = defineSeneraProtocol("json_projection", 1);

export interface AgentBudgetedJsonProjection {
  readonly value: unknown;
  readonly projectedValue: unknown;
  readonly text: string;
  readonly complete: boolean;
  readonly tokenCount: number;
  readonly tokenLimit: number;
}

interface ProjectionOmission {
  readonly path: string;
  readonly remaining?: number;
}

interface PartialJsonView {
  type: typeof AgentJsonProjectionProtocol.type;
  complete: false;
  value: unknown;
  omittedBranchCount: number;
  omissions?: ProjectionOmission[];
}

export class AgentBudgetedJsonProjector {
  private readonly estimator: AgentModelTokenEstimator;

  constructor(model: string) {
    this.estimator = new AgentModelTokenEstimator({ model });
  }

  project(value: unknown, requestedTokenLimit: number): AgentBudgetedJsonProjection {
    const tokenLimit = normalizePositiveInteger(requestedTokenLimit);
    const serialized = stringifyJson(value);
    const completeInspection = this.estimator.inspect(serialized, tokenLimit);
    if (completeInspection.withinLimit) {
      const projectedValue = normalizeJsonValue(value);
      return {
        value: projectedValue,
        projectedValue,
        text: serialized,
        complete: true,
        tokenCount: completeInspection.tokenCount,
        tokenLimit,
      };
    }

    const view = createPartialView(value);
    const omissions: ProjectionOmission[] = [];
    const expanded = this.expand(value, view.value, view, omissions, [], tokenLimit, new WeakSet<object>());
    view.value = expanded;
    this.attachOmissions(view, omissions, tokenLimit);
    const text = stringifyJson(view);
    const tokenCount = this.estimator.estimate(text).tokenCount;
    if (tokenCount <= tokenLimit) {
      return { value: view, projectedValue: view.value, text, complete: false, tokenCount, tokenLimit };
    }

    const minimal = minimalPartialView(value);
    const minimalText = stringifyJson(minimal);
    const minimalTokenCount = this.estimator.estimate(minimalText).tokenCount;
    if (minimalTokenCount > tokenLimit) {
      const emptyText = stringifyJson({});
      return {
        value: {},
        projectedValue: {},
        text: emptyText,
        complete: false,
        tokenCount: this.estimator.estimate(emptyText).tokenCount,
        tokenLimit,
      };
    }
    return {
      value: minimal,
      projectedValue: minimal.value,
      text: minimalText,
      complete: false,
      tokenCount: minimalTokenCount,
      tokenLimit,
    };
  }

  fits(value: unknown, tokenLimit: number): boolean {
    return this.estimator.inspect(stringifyJson(value), tokenLimit).withinLimit;
  }

  count(value: unknown): number {
    return this.estimator.estimate(stringifyJson(value)).tokenCount;
  }

  private expand(
    source: unknown,
    target: unknown,
    view: PartialJsonView,
    omissions: ProjectionOmission[],
    path: readonly (string | number)[],
    tokenLimit: number,
    ancestors: WeakSet<object>,
  ): unknown {
    if (!isExpandableContainer(source)) {
      const candidate = normalizeJsonScalar(source);
      const previous = view.value;
      if (path.length === 0) view.value = candidate;
      const fits = path.length === 0 && this.fits(view, tokenLimit);
      if (!fits && path.length === 0) view.value = previous;
      if (!fits) this.recordOmission(view, omissions, path);
      return fits ? candidate : target;
    }
    if (ancestors.has(source)) {
      this.recordOmission(view, omissions, path);
      return target;
    }

    ancestors.add(source);
    try {
      return Array.isArray(source)
        ? this.expandArray(source, target as unknown[], view, omissions, path, tokenLimit, ancestors)
        : this.expandObject(
            source as Record<string, unknown>,
            target as Record<string, unknown>,
            view,
            omissions,
            path,
            tokenLimit,
            ancestors,
          );
    } finally {
      ancestors.delete(source);
    }
  }

  private expandArray(
    source: readonly unknown[],
    target: unknown[],
    view: PartialJsonView,
    omissions: ProjectionOmission[],
    path: readonly (string | number)[],
    tokenLimit: number,
    ancestors: WeakSet<object>,
  ): unknown[] {
    for (const [index, entry] of source.entries()) {
      const child = containerSkeleton(entry);
      target.push(child);
      if (!this.fits(view, tokenLimit)) {
        target.pop();
        this.recordOmission(view, omissions, [...path, index], source.length - index);
        break;
      }
      if (isExpandableContainer(entry)) {
        target[index] = this.expand(entry, child, view, omissions, [...path, index], tokenLimit, ancestors);
        continue;
      }
      target[index] = normalizeJsonScalar(entry);
      if (!this.fits(view, tokenLimit)) {
        target.pop();
        this.recordOmission(view, omissions, [...path, index], source.length - index);
        break;
      }
    }
    return target;
  }

  private expandObject(
    source: Readonly<Record<string, unknown>>,
    target: Record<string, unknown>,
    view: PartialJsonView,
    omissions: ProjectionOmission[],
    path: readonly (string | number)[],
    tokenLimit: number,
    ancestors: WeakSet<object>,
  ): Record<string, unknown> {
    const entries = Object.entries(source).filter(([, value]) => value !== undefined);
    for (const [index, [key, entry]] of entries.entries()) {
      const child = containerSkeleton(entry);
      target[key] = child;
      if (!this.fits(view, tokenLimit)) {
        delete target[key];
        this.recordOmission(view, omissions, [...path, key], entries.length - index);
        break;
      }
      if (isExpandableContainer(entry)) {
        target[key] = this.expand(entry, child, view, omissions, [...path, key], tokenLimit, ancestors);
        continue;
      }
      target[key] = normalizeJsonScalar(entry);
      if (!this.fits(view, tokenLimit)) {
        delete target[key];
        this.recordOmission(view, omissions, [...path, key], entries.length - index);
        break;
      }
    }
    return target;
  }

  private recordOmission(
    view: PartialJsonView,
    omissions: ProjectionOmission[],
    path: readonly (string | number)[],
    remaining?: number,
  ): void {
    view.omittedBranchCount += 1;
    omissions.push({ path: jsonPointer(path), ...(remaining === undefined ? {} : { remaining }) });
  }

  private attachOmissions(view: PartialJsonView, omissions: readonly ProjectionOmission[], tokenLimit: number): void {
    for (const omission of omissions) {
      const current = view.omissions ?? [];
      view.omissions = [...current, omission];
      if (!this.fits(view, tokenLimit)) {
        view.omissions = current.length > 0 ? current : undefined;
        break;
      }
    }
  }
}

function createPartialView(value: unknown): PartialJsonView {
  return {
    type: AgentJsonProjectionProtocol.type,
    complete: false,
    value: containerSkeleton(value),
    omittedBranchCount: 0,
  };
}

function minimalPartialView(value: unknown): Omit<PartialJsonView, "value" | "omittedBranchCount"> & {
  value: unknown;
  omittedBranchCount: number;
} {
  return {
    type: AgentJsonProjectionProtocol.type,
    complete: false,
    value: containerSkeleton(value),
    omittedBranchCount: 1,
  };
}

function containerSkeleton(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  return isExpandableContainer(value) ? {} : null;
}

function isExpandableContainer(value: unknown): value is object {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => (typeof entry === "bigint" ? String(entry) : entry)) ?? "null";
}

function normalizeJsonValue(value: unknown): unknown {
  return JSON.parse(stringifyJson(value)) as unknown;
}

function normalizeJsonScalar(value: unknown): unknown {
  if (typeof value === "bigint") return String(value);
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return null;
  if (value !== null && typeof value === "object") return normalizeJsonValue(value);
  return value;
}

function jsonPointer(path: readonly (string | number)[]): string {
  if (path.length === 0) return "";
  return `/${path.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}
