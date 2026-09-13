export interface AgentJsonPointerLookup {
  readonly found: boolean;
  readonly value?: unknown;
}

export interface AgentJsonPointerMatch {
  readonly pointer: string;
  readonly value: unknown;
}

/** RFC 6901 pointer operations shared by manifest validation and runtime projection. */
export function parseAgentJsonPointer(pointer: string): readonly string[] {
  // RFC 6901 uses the empty string to address the document root.
  if (pointer === "") return [];
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

/**
 * Reads a JSON Pointer pattern. A whole `*` token selects every own object
 * property or array entry at that level; ordinary tokens retain RFC 6901
 * semantics. The concrete pointer is returned so callers can safely project
 * each selected value without inventing their own traversal rules.
 */
export function readAgentJsonPointerMatches(value: unknown, pointer: string): readonly AgentJsonPointerMatch[] {
  return readPointerMatches(value, parseAgentJsonPointer(pointer), []);
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

function readPointerMatches(
  value: unknown,
  tokens: readonly string[],
  pathTokens: readonly string[],
): AgentJsonPointerMatch[] {
  const [token, ...remaining] = tokens;
  if (token === undefined) {
    return [{ pointer: formatAgentJsonPointer(pathTokens), value }];
  }
  if (token === "*") {
    if (Array.isArray(value)) {
      return value.flatMap((entry, index) => readPointerMatches(entry, remaining, [...pathTokens, String(index)]));
    }
    if (isRecord(value)) {
      return Object.keys(value).flatMap((key) => readPointerMatches(value[key], remaining, [...pathTokens, key]));
    }
    return [];
  }
  if (Array.isArray(value)) {
    const index = parseArrayIndex(token, value.length);
    return index === undefined ? [] : readPointerMatches(value[index], remaining, [...pathTokens, token]);
  }
  if (!isRecord(value) || !Object.hasOwn(value, token)) return [];
  return readPointerMatches(value[token], remaining, [...pathTokens, token]);
}

function formatAgentJsonPointer(tokens: readonly string[]): string {
  return tokens.length === 0 ? "" : `/${tokens.map(encodeJsonPointerToken).join("/")}`;
}

function encodeJsonPointerToken(token: string): string {
  return token.replace(/~/gu, "~0").replace(/\//gu, "~1");
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
