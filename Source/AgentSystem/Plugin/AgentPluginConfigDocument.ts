import path from "node:path";
import { stringify as stringifyToml, type TomlTableWithoutBigInt } from "smol-toml";
import type { PluginConfigSchemaAllowedPath } from "./AgentPluginConfigSchema.js";

export type EditableTomlTable = Record<string, unknown>;

export function defaultPluginConfigToml(): string {
  return ["[senera]", "enabled = true", ""].join("\n");
}

export function resolvePluginConfigTemplatePath(pluginRootPath: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  return path.join(pluginRootPath, `${baseName}.example${extension}`);
}

export function resolvePluginConfigSchemaPath(pluginRootPath: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
  return path.join(pluginRootPath, `${baseName}.schema${extension}`);
}

export function setTomlValueAtPath(document: EditableTomlTable, pathParts: readonly string[], value: unknown): void {
  const [lastKey] = pathParts.slice(-1);
  if (!lastKey) {
    return;
  }

  let current: EditableTomlTable = document;
  for (const part of pathParts.slice(0, -1)) {
    const next = current[part];
    if (!isPlainTomlTable(next)) {
      current[part] = {};
    }
    current = current[part] as EditableTomlTable;
  }
  current[lastKey] = value;
}

export function readTomlValueAtPath(root: unknown, pathParts: readonly string[]): unknown {
  let current: unknown = root;
  for (const part of pathParts) {
    current = isPlainTomlTable(current) ? current[part] : undefined;
  }
  return current;
}

export function collectTomlLeafPaths(value: unknown, prefix: readonly string[] = []): string[][] {
  if (!isPlainTomlTable(value)) {
    return prefix.length > 0 ? [Array.from(prefix)] : [];
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return prefix.length > 0 ? [Array.from(prefix)] : [];
  }

  return entries.flatMap(([key, child]) => {
    const pathParts = [...prefix, key];
    return isPlainTomlTable(child) ? collectTomlLeafPaths(child, pathParts) : [pathParts];
  });
}

export function pathMatchesAllowedPath(
  pathParts: readonly string[],
  allowedPath: Pick<PluginConfigSchemaAllowedPath, "path" | "recursive">,
): boolean {
  return allowedPath.recursive
    ? pathStartsWith(pathParts, allowedPath.path)
    : sameStringArray(pathParts, allowedPath.path);
}

export function stringifyPluginConfigToml(document: EditableTomlTable): string {
  return ensureFinalNewline(stringifyToml(document as TomlTableWithoutBigInt));
}

export function ensureFinalNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

export function isPlainTomlTable(value: unknown): value is TomlTableWithoutBigInt {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function pathStartsWith(pathParts: readonly string[], prefix: readonly string[]): boolean {
  return pathParts.length >= prefix.length && prefix.every((part, index) => pathParts[index] === part);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
