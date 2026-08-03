import path from "node:path";
import { listDefaultAgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { resolveAgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { createAgentSystemTools } from "../SystemTools/AgentSystemTools.js";
import { systemToolCapability } from "../SystemTools/AgentSystemToolCatalog.js";
import {
  AgentSystemExtensionCatalog,
  type AgentSystemExtensionSettingsItem,
} from "../SystemTools/AgentSystemToolSource.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
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
  private readonly bundledMcpRoot: string;
  private readonly workspaceMcpRoot: string;
  private systemCache?: CachedSystemCatalog;
  private packageCache?: AgentMcpPackageSnapshot & { readonly key: string };

  constructor(options: AgentMcpManagementCatalogOptions) {
    this.systemExtensionsRoot = path.join(options.resourcesRoot, "System", "Extensions");
    this.bundledMcpRoot = path.join(options.resourcesRoot, "McpServers");
    this.workspaceMcpRoot = resolveAgentWorkspaceLayout(options.workspaceRoot).mcpRoot;
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
      sourceRevision: AgentMcpPackageScanner.sourceRevision(this.systemExtensionsRoot),
    });
    if (this.systemCache?.key === key) return this.systemCache;

    const definitions = createAgentSystemTools(config);
    const catalog = new AgentSystemExtensionCatalog();
    catalog.registerRoot(new AgentExtensionRegistry(), this.systemExtensionsRoot, {
      capabilities: new Set([...listDefaultAgentHostCapabilityNames(), ...definitions.map(systemToolCapability)]),
      configurations: config.Extensions,
    });
    const extensions = catalog.listExtensions();
    const tools = extensions
      .filter((extension) => extension.enabled)
      .flatMap((extension) =>
        extension.tools.map((tool) => ({
          name: tool.name,
          title: resolveAgentExtensionLocalizedText(extension.displayName),
          description: tool.description,
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
