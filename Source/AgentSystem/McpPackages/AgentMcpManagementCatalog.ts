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
import { createAgentSystemTools } from "../SystemTools/AgentSystemTools.js";
import { systemToolCapability } from "../SystemTools/AgentSystemToolCatalog.js";
import {
  AgentSystemExtensionCatalog,
  type AgentSystemExtensionSettingsItem,
} from "../SystemTools/AgentSystemToolSource.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentConfigFormOptionCatalogs } from "../Types/ConfigFormTypes.js";
import { AgentSkillCatalogProjector } from "../Skills/AgentSkillCatalogProjector.js";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
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
}

interface CachedSystemCatalog {
  readonly key: string;
  readonly catalog: AgentSystemExtensionCatalog;
  readonly snapshot: AgentSystemSettingsSnapshot;
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

  constructor(options: AgentMcpManagementCatalogOptions) {
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
    const skillScanner = new AgentSkillScanner();
    const systemSkillTools = catalog.skillToolBindings();
    for (const skill of skillScanner.scanRoot(this.systemSkillsRoot)) {
      registry.registerSkill({
        ...skill,
        source: { kind: "system", id: skill.name, displayName: "Senera", priority: 10 },
        recommendedTools: [...new Set([...skill.recommendedTools, ...(systemSkillTools.get(skill.name) ?? [])])],
      });
    }
    for (const skill of skillScanner.scanRoot(this.workspaceSkillsRoot)) registry.registerSkill(skill);
    const skillOptions = new AgentSkillCatalogProjector(registry)
      .list()
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
              ...extension.configuration,
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
    this.systemCache = { key, catalog, snapshot };
    return this.systemCache;
  }
}
