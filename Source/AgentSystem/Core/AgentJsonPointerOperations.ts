export interface AgentJsonPointerLookup {
  readonly found: boolean;
  readonly value?: unknown;
}

/** RFC 6901 pointer operations shared by manifest validation and runtime projection. */
export function parseAgentJsonPointer(pointer: string): readonly string[] {
  if (!pointer.startsWith("/")) throw new TypeError(`Invalid JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").map(decodeJsonPointerToken);
}

export function isAgentJsonPointer(pointer: string): boolean {
  try {
    parseAgentJsonPointer(pointer);
    return true;
  } catch {
    return false;
  }
}

export function readAgentJsonPointer(value: unknown, pointer: string): AgentJsonPointerLookup {
  let current = value;
  for (const token of parseAgentJsonPointer(pointer)) {
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

export function replaceAgentJsonPointer(value: unknown, pointer: string, replacement: unknown): unknown {
  return replaceJsonPointerTokens(value, parseAgentJsonPointer(pointer), replacement, pointer);
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
    if (index === undefined) throw new Error(`JSON Pointer does not exist: ${pointer}`);
    const result = [...value];
    result[index] = replaceJsonPointerTokens(result[index], remaining, replacement, pointer);
    return result;
  }
  if (!isRecord(value) || !Object.hasOwn(value, token)) {
    throw new Error(`JSON Pointer does not exist: ${pointer}`);
  }
  return {
    ...value,
    [token]: replaceJsonPointerTokens(value[token], remaining, replacement, pointer),
  };
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

import { isAgentUnknownRecord as isRecord } from "./AgentUnknownValue.js";
