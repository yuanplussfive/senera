import type { AgentMcpExecution } from "./AgentMcpPackageSchema.js";
import type { AgentMcpHostRequirements } from "./AgentMcpHostRequirements.js";
import type { AgentMcpPackageServer, AgentMcpPackageSourceKind } from "./AgentMcpPackageTypes.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import {
  createAgentExtensionLocalizedText,
  type AgentExtensionLocalizedText,
} from "../Extensions/AgentExtensionLocalization.js";
import {
  AgentPluginBrandIconNames,
  AgentToolPresentationIconNames,
  type AgentPluginIdentityPresentation,
} from "../Types/AgentToolPresentationTypes.js";

export interface AgentMcpDescriptorContext {
  readonly packageRoot: string;
  readonly directoryName: string;
  readonly source: AgentMcpPackageSourceKind;
  readonly descriptorPath: string;
}

export interface AgentMcpDescriptorProjection {
  readonly name: string;
  readonly displayName?: AgentExtensionLocalizedText;
  readonly description?: AgentExtensionLocalizedText;
  readonly descriptorKind: "mcpb" | "registry" | "legacy" | "connection";
  readonly presentation?: AgentPluginIdentityPresentation;
  readonly execution?: AgentMcpExecution;
  readonly requirements?: AgentMcpHostRequirements;
  readonly servers: readonly AgentMcpPackageServer[];
}

export function readMcpLocalizedText(
  value: unknown,
  label: string,
  path: readonly PropertyKey[] = [],
): AgentExtensionLocalizedText | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return createAgentExtensionLocalizedText(requireMcpString(value, label, path));
  const record = requireMcpRecord(value, label, path);
  return {
    "zh-CN": requireMcpString(record["zh-CN"], `${label}.zh-CN`, [...path, "zh-CN"]),
    "en-US": requireMcpString(record["en-US"], `${label}.en-US`, [...path, "en-US"]),
  };
}

export interface AgentMcpDescriptorAdapter {
  readonly kind: AgentMcpDescriptorProjection["descriptorKind"];
  readonly fileName: string;
  recognizes(document: unknown): boolean;
  project(context: AgentMcpDescriptorContext, document: unknown): AgentMcpDescriptorProjection;
}

export class AgentMcpDescriptorError extends AgentBaseError {
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

/**
 * Reads the small, portable Senera identity declaration used by descriptor
 * adapters. It deliberately accepts no display labels or arbitrary SVG/URL
 * payloads: presentation stays local, reviewed, and independent of runtime
 * connectivity.
 */
export function readMcpPluginIdentityPresentation(
  value: unknown,
  label: string,
  path: readonly PropertyKey[] = [],
): AgentPluginIdentityPresentation | undefined {
  if (value === undefined) return undefined;
  const presentation = requireMcpRecord(value, label, path);
  const allowedKeys = new Set(["icon", "brandIcon"]);
  for (const key of Object.keys(presentation)) {
    if (!allowedKeys.has(key)) {
      throw new AgentMcpDescriptorError(`${label} has an unrecognized key: ${key}.`, [...path, key]);
    }
  }
  const icon = presentation.icon;
  const brandIcon = presentation.brandIcon;
  if (icon !== undefined && (typeof icon !== "string" || !AgentToolPresentationIconNames.includes(icon as never))) {
    throw new AgentMcpDescriptorError(`${label}.icon must be a supported semantic icon.`, [...path, "icon"]);
  }
  if (
    brandIcon !== undefined &&
    (typeof brandIcon !== "string" || !AgentPluginBrandIconNames.includes(brandIcon as never))
  ) {
    throw new AgentMcpDescriptorError(`${label}.brandIcon must be a supported local brand icon.`, [
      ...path,
      "brandIcon",
    ]);
  }
  if (icon === undefined && brandIcon === undefined) {
    throw new AgentMcpDescriptorError(`${label} must declare icon or brandIcon.`, path);
  }
  return {
    ...(typeof icon === "string" ? { icon: icon as AgentPluginIdentityPresentation["icon"] } : {}),
    ...(typeof brandIcon === "string" ? { brandIcon: brandIcon as AgentPluginIdentityPresentation["brandIcon"] } : {}),
  };
}
