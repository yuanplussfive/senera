import path from "node:path";
import { listDefaultAgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import {
  createAgentExtensionLocalizedText,
  resolveAgentExtensionLocalizedText,
} from "../Extensions/AgentExtensionLocalization.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { projectAgentConfigFormOptions } from "../Config/AgentConfigFormOptionProjector.js";
import { AgentConfigSecretContract } from "../Config/AgentConfigSecretContract.js";
import { createAgentSystemTools } from "../SystemTools/AgentSystemTools.js";
import { systemToolCapability } from "../SystemTools/AgentSystemToolCatalog.js";
import {
  AgentSystemExtensionCatalog,
  type AgentSystemExtensionSettingsItem,
} from "../SystemTools/AgentSystemToolSource.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentConfigFormOptionCatalogs } from "../Types/ConfigFormTypes.js";
import { AgentSkillCatalogProjector, type AgentSkillCatalogItem } from "../Skills/AgentSkillCatalogProjector.js";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
import { registerAgentSkillCatalog } from "../Skills/AgentSkillCatalogRegistration.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentMcpPackageScanner, assertUniqueAgentMcpServerNames } from "./AgentMcpPackageScanner.js";
import { AgentMcpPackageSourceKinds, type AgentMcpPackage } from "./AgentMcpPackageTypes.js";

export interface AgentSystemToolSettingsItem {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly extension: string;
  readonly loading: string;
}

export interface AgentSystemSettingsSnapshot {
  readonly revision: string;
  readonly extensions: readonly AgentSystemExtensionSettingsItem[];
  readonly tools: readonly AgentSystemToolSettingsItem[];
}

export interface AgentMcpPackageSnapshot {
  readonly revision: string;
  readonly packages: readonly AgentMcpPackage[];
  readonly serversById: ReadonlyMap<string, AgentMcpPackageServerLocation>;
}

export interface AgentMcpPackageServerLocation {
  readonly package_: AgentMcpPackage;
  readonly server: AgentMcpPackage["servers"][number];
}

export interface AgentMcpManagementCatalogOptions {
  readonly workspaceRoot: string;
  readonly resourcesRoot: string;
  readonly logger?: AgentLogger;
}

interface CachedSystemCatalog {
  readonly key: string;
  readonly catalog: AgentSystemExtensionCatalog;
  readonly snapshot: AgentSystemSettingsSnapshot;
  readonly skills: readonly AgentSkillCatalogItem[];
}

/**
 * Owns revision-based discovery snapshots shared by System extension and MCP
 * settings projections. Directory revisions are cheap metadata walks after the
 * first read; package parsing only runs when a relevant revision changes.
 */
export class AgentMcpManagementCatalog {
  private readonly scanner = new AgentMcpPackageScanner();
  private readonly systemExtensionsRoot: string;
  private readonly systemSkillsRoot: string;
  private readonly bundledMcpRoot: string;
  private readonly workspaceMcpRoot: string;
  private readonly workspaceSkillsRoot: string;
  private systemCache?: CachedSystemCatalog;
  private packageCache?: AgentMcpPackageSnapshot & { readonly key: string };

  constructor(private readonly options: AgentMcpManagementCatalogOptions) {
    this.systemExtensionsRoot = path.join(options.resourcesRoot, "System", "Extensions");
    this.systemSkillsRoot = path.join(options.resourcesRoot, "System", "Skills");
    this.bundledMcpRoot = path.join(options.resourcesRoot, "McpServers");
    const workspaceLayout = resolveAgentWorkspaceLayout(options.workspaceRoot);
    this.workspaceMcpRoot = workspaceLayout.mcpRoot;
    this.workspaceSkillsRoot = workspaceLayout.skillRoot;
  }

  systemSnapshot(config: AgentSystemConfig): AgentSystemSettingsSnapshot {
    return this.systemCatalog(config).snapshot;
  }

  systemSkillCatalog(config: AgentSystemConfig): readonly AgentSkillCatalogItem[] {
    return this.systemCatalog(config).skills;
  }

  validateSystemExtensions(config: AgentSystemConfig): void {
    this.systemCatalog(config);
  }

  packageSnapshot(config: AgentSystemConfig): AgentMcpPackageSnapshot {
    const system = this.systemCatalog(config);
    const key = sha256HexOfCanonicalJson({
      systemRevision: system.snapshot.revision,
      bundledRevision: AgentMcpPackageScanner.sourceRevision(this.bundledMcpRoot),
      workspaceRevision: AgentMcpPackageScanner.sourceRevision(this.workspaceMcpRoot),
    });
    if (this.packageCache?.key === key) return this.packageCache;

    const packages = deepFreeze([
      ...this.scanner.scanRoot(this.bundledMcpRoot, AgentMcpPackageSourceKinds.Bundled),
      ...system.catalog
        .listMcpContributions()
        .map((contribution) =>
          this.scanner.readPackage(
            path.dirname(contribution.descriptorPath),
            AgentMcpPackageSourceKinds.Bundled,
            contribution.extensionId,
          ),
        ),
      ...this.scanner.scanRoot(this.workspaceMcpRoot, AgentMcpPackageSourceKinds.Workspace),
    ]);
    assertUniqueAgentMcpServerNames(packages);
    const serversById = new Map<string, AgentMcpPackageServerLocation>();
    for (const package_ of packages) {
      for (const server of package_.servers) serversById.set(server.name, { package_, server });
    }
    const snapshot = {
      key,
      revision: key,
      packages,
      serversById,
    } satisfies AgentMcpPackageSnapshot & { readonly key: string };
    this.packageCache = snapshot;
    return snapshot;
  }

  private systemCatalog(config: AgentSystemConfig): CachedSystemCatalog {
    const key = sha256HexOfCanonicalJson({
      config,
      extensionRevision: AgentMcpPackageScanner.sourceRevision(this.systemExtensionsRoot),
      systemSkillRevision: AgentSkillScanner.sourceRevision(this.systemSkillsRoot),
      workspaceSkillRevision: AgentSkillScanner.sourceRevision(this.workspaceSkillsRoot),
    });
    if (this.systemCache?.key === key) return this.systemCache;

    const definitions = createAgentSystemTools(config);
    const catalog = new AgentSystemExtensionCatalog();
    const registry = new AgentExtensionRegistry();
    catalog.registerRoot(registry, this.systemExtensionsRoot, {
      capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
      configurations: config.Extensions,
    });
    const skillDiagnostics = registerAgentSkillCatalog(registry, {
      systemRoot: this.systemSkillsRoot,
      workspaceRoot: this.workspaceSkillsRoot,
      systemToolBindings: catalog.skillToolBindings(),
    });
    for (const diagnostic of skillDiagnostics) this.options.logger?.warn("resources.skills.invalid", { diagnostic });
    const skills = new AgentSkillCatalogProjector(registry).list();
    const skillOptions = skills
      .map((skill) => ({ value: skill.name, label: createAgentExtensionLocalizedText(skill.title) }))
      .sort(
        (left, right) =>
          resolveAgentExtensionLocalizedText(left.label).localeCompare(
            resolveAgentExtensionLocalizedText(right.label),
          ) || left.value.localeCompare(right.value),
      );
    const extensions = catalog.listExtensions().map((extension) => ({
      ...extension,
      ...(extension.configuration
        ? {
            configuration: {
              ...redactExtensionConfiguration(extension.configuration),
              sections: projectAgentConfigFormOptions(extension.configuration.sections, {
                [AgentConfigFormOptionCatalogs.Skills]: skillOptions,
              }),
            },
          }
        : {}),
    }));
    const tools = extensions
      .filter((extension) => extension.enabled)
      .flatMap((extension) =>
        extension.tools.map((tool) => ({
          name: tool.name,
          title: resolveAgentExtensionLocalizedText(extension.displayName),
          description: resolveAgentExtensionLocalizedText(tool.description),
          extension: extension.id,
          loading: tool.loading,
        })),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const snapshot = deepFreeze({ revision: key, extensions, tools });
    this.systemCache = { key, catalog, snapshot, skills: deepFreeze(skills) };
    return this.systemCache;
  }
}

function redactExtensionConfiguration(
  configuration: NonNullable<AgentSystemExtensionSettingsItem["configuration"]>,
): NonNullable<AgentSystemExtensionSettingsItem["configuration"]> {
  const fields = configuration.sections.flatMap((section) => flattenFields(section.fields));
  return {
    ...configuration,
    value: redactConfigurationValue(configuration.value, fields),
    effectiveValue: redactConfigurationValue(configuration.effectiveValue, fields),
    defaults: redactConfigurationValue(configuration.defaults, fields),
  };
}

function redactConfigurationValue(
  source: Readonly<Record<string, unknown>>,
  fields: readonly { readonly path: readonly string[]; readonly secret?: boolean; readonly type: string }[],
): Readonly<Record<string, unknown>> {
  const value = structuredClone(source) as Record<string, unknown>;
  for (const field of fields) {
    if (!field.secret || field.type !== "string") continue;
    const current = readPath(value, field.path);
    if (typeof current === "string" && current.length > 0)
      writePath(value, field.path, AgentConfigSecretContract.RedactedPlaceholder);
  }
  return value;
}

function flattenFields<T extends { readonly itemFields?: readonly T[] }>(fields: readonly T[]): readonly T[] {
  return fields.flatMap((field) => [field, ...flattenFields(field.itemFields ?? [])]);
}

function readPath(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const part of path) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function writePath(source: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const last = path[path.length - 1];
  if (!last) return;
  let current = source;
  for (const part of path.slice(0, -1)) {
    const next = current[part];
    if (!isRecord(next)) return;
    current = next;
  }
  current[last] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
