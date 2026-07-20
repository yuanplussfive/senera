import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentResourceAccessIntent } from "../Execution/SeneraResourceAccess.js";
import type { ToolResourceArgumentManifest, ToolResourceIntentManifest } from "../Types/PluginToolManifestTypes.js";

interface JsonPointerLookup {
  readonly found: boolean;
  readonly value?: unknown;
}

export async function projectAgentMcpResourceArguments(
  args: Readonly<Record<string, unknown>>,
  resources: readonly ToolResourceArgumentManifest[],
  executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath">,
): Promise<Record<string, unknown>> {
  let projected: unknown = args;
  for (const resource of resources) {
    const candidate = readJsonPointer(projected, resource.Pointer);
    if (!candidate.found) continue;
    if (typeof candidate.value !== "string") {
      throw new TypeError(`MCP resource argument ${resource.Pointer} must be a string.`);
    }

    const intent = resolveResourceIntent(resource.Intent, projected);
    const canonical = await executionEnv.resolveResourcePath(candidate.value, intent);
    if (!canonical.ok) throw canonical.error;
    projected = replaceJsonPointer(projected, resource.Pointer, canonical.value);
  }
  return readRecord(projected);
}

function resolveResourceIntent(intent: ToolResourceIntentManifest, args: unknown): AgentResourceAccessIntent {
  if (typeof intent === "string") return intent;
  const selected = readJsonPointer(args, intent.Selector);
  return (
    intent.Cases.find((entry) => selected.found && Object.is(entry.Equals, selected.value))?.Intent ?? intent.Default
  );
}

function readJsonPointer(value: unknown, pointer: string): JsonPointerLookup {
  let current = value;
  for (const token of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      const index = parseArrayIndex(token, current.length);
      if (index === undefined) return { found: false };
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.hasOwn(current, token)) return { found: false };
    current = current[token];
  }
  return { found: true, value: current };
}

function replaceJsonPointer(value: unknown, pointer: string, replacement: unknown): unknown {
  const tokens = parseJsonPointer(pointer);
  return replaceJsonPointerTokens(value, tokens, replacement, pointer);
}

function replaceJsonPointerTokens(
  value: unknown,
  tokens: readonly string[],
  replacement: unknown,
  pointer: string,
): unknown {
  const [token, ...remaining] = tokens;
  if (token === undefined) return replacement;

  if (Array.isArray(value)) {
    const index = parseArrayIndex(token, value.length);
    if (index === undefined) throw new Error(`MCP resource argument pointer does not exist: ${pointer}`);
    const result = [...value];
    result[index] = replaceJsonPointerTokens(result[index], remaining, replacement, pointer);
    return result;
  }

  if (!isRecord(value) || !Object.hasOwn(value, token)) {
    throw new Error(`MCP resource argument pointer does not exist: ${pointer}`);
  }
  const result = { ...value };
  Object.defineProperty(result, token, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: replaceJsonPointerTokens(value[token], remaining, replacement, pointer),
  });
  return result;
}

function parseJsonPointer(pointer: string): string[] {
  if (!pointer.startsWith("/")) throw new TypeError(`Invalid MCP resource JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").map(decodeJsonPointerToken);
}

function decodeJsonPointerToken(token: string): string {
  if (/~(?:[^01]|$)/u.test(token)) throw new TypeError(`Invalid JSON Pointer escape in token: ${token}`);
  return token.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

function parseArrayIndex(token: string, length: number): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/u.test(token)) return undefined;
  const index = Number(token);
  return Number.isSafeInteger(index) && index < length ? index : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("MCP tool arguments must be an object.");
  return value;
}
