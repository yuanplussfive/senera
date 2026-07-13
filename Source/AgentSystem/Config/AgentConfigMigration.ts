import type { ZodIssue, ZodType } from "zod";

export interface AgentConfigMigrationResult<TConfig> {
  config: TConfig;
  migratedPaths: string[];
  removedPaths: string[];
}

export interface AgentConfigUnknownKeyMigrationResult<TConfig> {
  config: TConfig;
  removedPaths: string[];
}

export function migrateAgentConfigPayload<TConfig>(
  config: unknown,
  schema: ZodType<TConfig>,
): AgentConfigMigrationResult<TConfig> | undefined {
  const legacy = migrateLegacyAgentConfigFields(config);
  const parsed = schema.safeParse(legacy.config);
  if (parsed.success) {
    return legacy.migratedPaths.length > 0
      ? {
          config: parsed.data,
          migratedPaths: legacy.migratedPaths,
          removedPaths: [],
        }
      : undefined;
  }

  const unknown = migrateUnknownConfigKeys(legacy.config, schema);
  if (!unknown) {
    return undefined;
  }

  return {
    config: unknown.config,
    migratedPaths: legacy.migratedPaths,
    removedPaths: unknown.removedPaths,
  };
}

export function migrateUnknownConfigKeys<TConfig>(
  config: unknown,
  schema: ZodType<TConfig>,
): AgentConfigUnknownKeyMigrationResult<TConfig> | undefined {
  const working = cloneJsonValue(config);
  const removedPaths: string[] = [];

  while (true) {
    const parsed = schema.safeParse(working);
    if (parsed.success) {
      return removedPaths.length > 0
        ? {
            config: parsed.data,
            removedPaths,
          }
        : undefined;
    }

    const removableIssues = parsed.error.issues.filter(isUnrecognizedKeysIssue);
    if (removableIssues.length === 0) {
      return undefined;
    }

    let changed = false;
    for (const issue of removableIssues) {
      changed = removeUnknownKeys(working, issue, removedPaths) || changed;
    }

    if (!changed) {
      return undefined;
    }
  }
}

function removeUnknownKeys(
  target: unknown,
  issue: Extract<ZodIssue, { code: "unrecognized_keys" }>,
  removedPaths: string[],
): boolean {
  const parent = readPath(target, issue.path);
  if (!isRecord(parent)) {
    return false;
  }

  let changed = false;
  for (const key of issue.keys) {
    if (!(key in parent)) {
      continue;
    }
    delete parent[key];
    removedPaths.push(formatConfigPath([...issue.path, key]));
    changed = true;
  }
  return changed;
}

function readPath(target: unknown, path: readonly PropertyKey[]): unknown {
  let current = target;
  for (const segment of path) {
    if (typeof segment !== "string" && typeof segment !== "number") {
      return undefined;
    }
    if (!isRecord(current) && !Array.isArray(current)) {
      return undefined;
    }
    current = current[segment as keyof typeof current];
  }
  return current;
}

function formatConfigPath(path: readonly PropertyKey[]): string {
  return path.length > 0 ? path.map(String).join(".") : "<root>";
}

function isUnrecognizedKeysIssue(issue: ZodIssue): issue is Extract<ZodIssue, { code: "unrecognized_keys" }> {
  return issue.code === "unrecognized_keys";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateLegacyAgentConfigFields(input: unknown): {
  config: unknown;
  migratedPaths: string[];
} {
  const config = cloneJsonValue(input);
  if (!isRecord(config)) {
    return {
      config,
      migratedPaths: [],
    };
  }

  const migratedPaths: string[] = [];
  migrateAgentLoopRepairAttempts(config, "");
  const defaults = config.Defaults;
  if (isRecord(defaults)) {
    migrateAgentLoopRepairAttempts(defaults, "Defaults.");
  }

  return {
    config,
    migratedPaths,
  };

  function migrateAgentLoopRepairAttempts(container: Record<string, unknown>, prefix: string): void {
    const agentLoop = container.AgentLoop;
    if (!isRecord(agentLoop) || !Object.prototype.hasOwnProperty.call(agentLoop, "MaxRepairAttempts")) {
      return;
    }

    const actionPlanner = ensureRecord(container, "ActionPlanner");
    if (!Object.prototype.hasOwnProperty.call(actionPlanner, "MaxRepairAttempts")) {
      actionPlanner.MaxRepairAttempts = agentLoop.MaxRepairAttempts;
    }
    delete agentLoop.MaxRepairAttempts;
    migratedPaths.push(`${prefix}AgentLoop.MaxRepairAttempts`);
  }
}

function ensureRecord(container: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = container[key];
  if (isRecord(current)) {
    return current;
  }

  const next: Record<string, unknown> = {};
  container[key] = next;
  return next;
}

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
