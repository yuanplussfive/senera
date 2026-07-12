import type { ZodIssue, ZodType } from "zod";

export interface AgentConfigUnknownKeyMigrationResult<TConfig> {
  config: TConfig;
  removedPaths: string[];
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

function cloneJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
