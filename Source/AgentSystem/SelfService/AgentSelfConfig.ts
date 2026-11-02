import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentSelfServicePort } from "./AgentSelfServiceTypes.js";
import { projectAgentSelfRedacted } from "./AgentSelfRedaction.js";
import { createOpaqueId } from "../Core/AgentIds.js";

/** Dot-separated path navigation into the effective configuration. */
export function readAgentSelfConfigPath(
  snapshot: unknown,
  path: string | undefined,
): { readonly found: boolean; readonly value?: unknown; readonly error?: string } {
  if (!path || path.trim() === "") return { found: true, value: snapshot };
  let segments: string[];
  try {
    segments = parseAgentSelfConfigPath(path);
  } catch {
    return { found: false, error: `Invalid config path: "${path}".` };
  }
  let cursor: unknown = snapshot;
  for (const segment of segments) {
    if (typeof cursor !== "object" || cursor === null) {
      return { found: false, error: `Config path is unreachable at "${segment}".` };
    }
    const record = cursor as Record<string, unknown>;
    if (!Object.hasOwn(record, segment)) {
      return { found: false, error: `Config path not found: "${path}" (missing "${segment}").` };
    }
    cursor = record[segment];
  }
  return { found: true, value: cursor };
}

export interface AgentSelfConfigUpdateResult {
  readonly replaced: boolean;
  readonly revision?: number;
}

export interface AgentSelfConfigPathChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** Leaf-level diff between two configuration values. `after` is `undefined`
 * for removed paths; `before` is `undefined` for newly added paths. Array
 * indices use their numeric position as the path segment, so the leaf paths
 * stay compatible with the dot-pattern sensitivity rules. */
export function diffAgentSelfConfigPaths(before: unknown, after: unknown): readonly AgentSelfConfigPathChange[] {
  const changes: AgentSelfConfigPathChange[] = [];
  const walk = (prefix: string, left: unknown, right: unknown): void => {
    if (deepEqualAgentConfigValue(left, right)) return;
    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        walk(`${prefix}.${index}`, left[index], right[index]);
      }
      return;
    }
    if (!isPlainObject(left) || !isPlainObject(right)) {
      changes.push({ path: prefix, before: left, after: right });
      return;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      walk(
        prefix === "" ? key : `${prefix}.${key}`,
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      );
    }
  };
  walk("", before, after);
  return changes;
}

function deepEqualAgentConfigValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqualAgentConfigValue(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqualAgentConfigValue(left[key], right[key]));
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Applies one path/value change on top of the current snapshot and commits
 * it through the host config service (revision-guarded, mirrored, broadcast).
 * The committed value must pass the runtime config schema. */
export function updateAgentSelfConfigPath(
  port: AgentSelfServicePort,
  path: string,
  value: unknown,
): AgentSelfConfigUpdateResult {
  const segments = parseAgentSelfConfigPath(path);
  if (segments.length === 0) {
    throw new Error(`Invalid config path: "${path}".`);
  }
  const current = port.config.getSnapshot();
  const next = structuredClone(current.value);
  let cursor: Record<string, unknown> | unknown[] = asConfigContainer(next, path);
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const nextSegment = segments[index + 1]!;
    const existing = readContainerValue(cursor, segment);
    if (!isConfigContainer(existing)) {
      const replacement = isArrayIndex(nextSegment) ? [] : {};
      writeContainerValue(cursor, segment, replacement);
      cursor = replacement;
    } else {
      cursor = existing;
    }
  }
  const leaf = segments.at(-1)!;
  writeContainerValue(cursor, leaf, value === null ? undefined : value);
  const committed = port.config.replace({
    commandId: createOpaqueId("self_config"),
    baseRevision: current.revision,
    config: next as AgentSystemConfig,
    source: "api_update",
  });
  return { replaced: true, revision: committed.revision };
}

/** Parses and validates dot paths once so every writer rejects prototype
 * mutation vectors and handles numeric array segments consistently. */
function parseAgentSelfConfigPath(path: string): string[] {
  const segments = path.split(".").map((segment) => segment.trim());
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "" || ["__proto__", "prototype", "constructor"].includes(segment))
  ) {
    throw new Error(`Invalid config path: "${path}".`);
  }
  return segments;
}

function isConfigContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null && (Array.isArray(value) || isPlainObject(value));
}

function asConfigContainer(value: unknown, path: string): Record<string, unknown> | unknown[] {
  if (!isConfigContainer(value) || Array.isArray(value)) {
    throw new Error(`Config root is not an object for path: "${path}".`);
  }
  return value;
}

function readContainerValue(container: Record<string, unknown> | unknown[], segment: string): unknown {
  return (container as Record<string, unknown>)[segment];
}

function writeContainerValue(container: Record<string, unknown> | unknown[], segment: string, value: unknown): void {
  if (Array.isArray(container) && isArrayIndex(segment)) {
    container[Number(segment)] = value;
    return;
  }
  Object.defineProperty(container, segment, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function isArrayIndex(segment: string): boolean {
  return /^(?:0|[1-9]\d*)$/u.test(segment) && Number(segment) <= 4_294_967_294;
}

/** Restores a historical revision as a NEW revision on top of the current
 * state. History is append-only: the target revision is never rewritten. */
export function rollbackAgentSelfConfigPath(
  port: AgentSelfServicePort,
  target: AgentSystemConfig,
): AgentSelfConfigUpdateResult {
  const current = port.config.getSnapshot();
  const committed = port.config.replace({
    commandId: createOpaqueId("self_config_rollback"),
    baseRevision: current.revision,
    config: structuredClone(target),
    source: "api_update",
  });
  return { replaced: true, revision: committed.revision };
}

export function projectAgentSelfModels(config: AgentSystemConfig): unknown {
  return projectAgentSelfRedacted({
    providers: (config.ModelProviders ?? []).map((provider) => ({
      id: provider.Id,
      providerId: provider.ProviderId,
      model: provider.Model,
      planningMode: provider.ToolPlanningMode,
      contextWindowTokens: provider.ContextWindowTokens,
    })),
  });
}

export function projectAgentSelfEndpoints(config: AgentSystemConfig): unknown {
  return projectAgentSelfRedacted({
    defaultProviderId: config.DefaultModelProviderId,
    endpoints: (config.ModelProviderEndpoints ?? []).map((endpoint) => ({
      id: endpoint.Id,
      providerId: endpoint.ProviderId,
      enabled: endpoint.Enabled,
      kind: endpoint.Kind,
      baseUrl: endpoint.BaseUrl,
      priority: endpoint.Priority,
    })),
  });
}
