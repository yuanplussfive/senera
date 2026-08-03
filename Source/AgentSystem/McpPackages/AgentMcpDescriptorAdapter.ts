import type { AgentMcpExecution } from "./AgentMcpPackageSchema.js";
import type { AgentMcpPackageServer, AgentMcpPackageSourceKind } from "./AgentMcpPackageTypes.js";

export interface AgentMcpDescriptorContext {
  readonly packageRoot: string;
  readonly directoryName: string;
  readonly source: AgentMcpPackageSourceKind;
  readonly descriptorPath: string;
}

export interface AgentMcpDescriptorProjection {
  readonly name: string;
  readonly descriptorKind: "mcpb" | "registry" | "legacy" | "connection";
  readonly execution?: AgentMcpExecution;
  readonly servers: readonly AgentMcpPackageServer[];
}

export interface AgentMcpDescriptorAdapter {
  readonly kind: AgentMcpDescriptorProjection["descriptorKind"];
  readonly fileName: string;
  recognizes(document: unknown): boolean;
  project(context: AgentMcpDescriptorContext, document: unknown): AgentMcpDescriptorProjection;
}

export class AgentMcpDescriptorError extends Error {
  constructor(
    message: string,
    readonly path: readonly PropertyKey[] = [],
  ) {
    super(message);
  }
}

export function requireMcpRecord(
  value: unknown,
  label: string,
  path: readonly PropertyKey[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentMcpDescriptorError(`${label} must be an object.`, path);
  }
  return value as Record<string, unknown>;
}

export function requireMcpString(value: unknown, label: string, path: readonly PropertyKey[] = []): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentMcpDescriptorError(`${label} must be a non-empty string.`, path);
  }
  return value;
}

export function optionalMcpString(
  value: unknown,
  label: string,
  path: readonly PropertyKey[] = [],
): string | undefined {
  return value === undefined ? undefined : requireMcpString(value, label, path);
}
