import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentExtensionInputValue } from "../Extensions/AgentExtensionInput.js";
import type { AgentMcpInputService, AgentMcpInputStatus } from "../Credentials/AgentMcpInputService.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentMcpActivationCatalogEntry, AgentMcpPackage, AgentMcpPackageServer } from "./AgentMcpPackageTypes.js";
import {
  createAgentExtensionLocalizedText,
  resolveAgentExtensionLocalizedText,
} from "../Extensions/AgentExtensionLocalization.js";
import type { AgentSystemExtensionSettingsItem } from "../SystemTools/AgentSystemToolSource.js";
import { AgentSystemExtensionSettingsSurfaces } from "../Types/AgentSystemExtensionSettingsSurface.js";
import type {
  AgentActivationCatalogEntryData,
  AgentActivationCatalogSnapshot,
} from "../Activation/AgentActivationTypes.js";
import { createAgentActivationCatalog } from "../Activation/AgentActivationCatalog.js";
import type { AgentPluginListEntry } from "../Plugins/AgentPluginTypes.js";
import {
  AgentMcpManagementCatalog,
  type AgentSystemSettingsSnapshot,
  type AgentSystemToolSettingsItem,
} from "./AgentMcpManagementCatalog.js";
import {
  detectAgentMcpHostCapabilities,
  missingAgentMcpHostCapabilities,
  type AgentMcpHostCapabilitySnapshot,
} from "./AgentMcpHostRequirements.js";
import { isAgentMcpServerEnabled } from "./AgentMcpServerEnablement.js";

export type { AgentSystemSettingsSnapshot, AgentSystemToolSettingsItem } from "./AgentMcpManagementCatalog.js";

export interface AgentMcpServerSettingsItem {
  readonly id: string;
  readonly packageName: string;
  readonly displayName: ReturnType<typeof createAgentExtensionLocalizedText>;
  readonly description: ReturnType<typeof createAgentExtensionLocalizedText>;
  readonly source: AgentMcpPackage["source"];
  readonly transport: "stdio" | "http";
  readonly descriptorKind: AgentMcpPackage["descriptorKind"];
  readonly presentation?: AgentMcpPackage["presentation"];
  readonly status: "configured" | "needs_input" | "unavailable";
  /** Effective activation state: configured and enabled by workspace policy. */
  readonly enabled: boolean;
  readonly unavailableCapabilityDetails?: readonly { readonly id: string; readonly reason?: string }[];
  readonly inputs: readonly AgentMcpInputStatus[];
}

export interface AgentMcpManagementServiceOptions {
  readonly workspaceRoot: string;
  readonly resourcesRoot: string;
  readonly inputs: AgentMcpInputService;
  readonly config: () => AgentSystemConfig;
  readonly hostCapabilities?: AgentMcpHostCapabilitySnapshot;
}

export interface AgentMcpSettingsSnapshot {
  readonly revision: string;
  readonly servers: readonly AgentMcpServerSettingsItem[];
}

export class AgentMcpManagementService {
  private readonly catalog: AgentMcpManagementCatalog;
  private readonly hostCapabilities: AgentMcpHostCapabilitySnapshot;
  private mcpSettingsCache?: AgentMcpSettingsSnapshot;

  constructor(private readonly options: AgentMcpManagementServiceOptions) {
    this.catalog = new AgentMcpManagementCatalog(options);
    this.hostCapabilities = options.hostCapabilities ?? detectAgentMcpHostCapabilities();
  }

  systemSettingsSnapshot(): AgentSystemSettingsSnapshot {
    return this.catalog.systemSnapshot(this.options.config());
  }

  listSystemTools(): readonly AgentSystemToolSettingsItem[] {
    return this.systemSettingsSnapshot().tools;
  }

  listSystemExtensions(): readonly AgentSystemExtensionSettingsItem[] {
    return this.systemSettingsSnapshot().extensions;
  }

  validateSystemExtensions(config: AgentSystemConfig): void {
    this.catalog.validateSystemExtensions(config);
  }

  listMcpServers(): readonly AgentMcpServerSettingsItem[] {
    return this.mcpSettingsSnapshot().servers;
  }

  mcpSettingsSnapshot(): AgentMcpSettingsSnapshot {
    const packages = this.catalog.packageSnapshot(this.options.config());
    const revision = sha256HexOfCanonicalJson({
      packages: packages.revision,
      inputs: this.options.inputs.revision(),
      hostCapabilities: {
        available: [...this.hostCapabilities.available].sort(),
        diagnostics: [...this.hostCapabilities.diagnostics.entries()].sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      },
    });
    if (this.mcpSettingsCache?.revision === revision) return this.mcpSettingsCache;
    const servers = packages.packages
      .flatMap((package_) => package_.servers.map((server) => this.projectServer(package_, server)))
      .sort((left, right) => left.id.localeCompare(right.id));
    this.mcpSettingsCache = deepFreeze({ revision, servers });
    return this.mcpSettingsCache;
  }

  /** Projects one live catalog; callers must provide the current plugin snapshot explicitly. */
  activationCatalog(plugins: readonly AgentPluginListEntry[]): AgentActivationCatalogSnapshot {
    return createAgentActivationCatalog(
      this.catalog.systemSkillCatalog(this.options.config()),
      plugins,
      this.activationEntries(),
      this.systemActivationEntries(),
    );
  }

  systemActivationEntries(): readonly AgentActivationCatalogEntryData[] {
    const snapshot = this.systemSettingsSnapshot();
    return snapshot.extensions
      .filter(
        (extension) =>
          extension.settingsSurface === AgentSystemExtensionSettingsSurfaces.SystemTools &&
          (extension.tools.length > 0 || extension.skillCount > 0),
      )
      .map((extension) => ({
        id: extension.id,
        revision: sha256HexOfCanonicalJson({ catalogRevision: snapshot.revision, extensionId: extension.id }),
        title: resolveAgentExtensionLocalizedText(extension.displayName),
        description: resolveAgentExtensionLocalizedText(extension.description),
        localizedTitle: extension.displayName,
        localizedDescription: extension.description,
        icon: extension.presentation.icon,
        enabled: extension.enabled,
        selectable: extension.enabled && (extension.tools.length > 0 || extension.skillCount > 0),
        source: extension.domain.id,
      }));
  }

  activationEntries(): readonly AgentMcpActivationCatalogEntry[] {
    const packages = this.catalog.packageSnapshot(this.options.config());
    const servers = this.mcpSettingsSnapshot().servers;
    const serversById = new Map(servers.map((server) => [server.id, server]));
    return packages.packages
      .flatMap((package_) =>
        package_.servers.map((server) => {
          const settings = serversById.get(server.name);
          if (!settings) throw new Error(`MCP server settings are missing: ${server.name}`);
          const title = resolveAgentExtensionLocalizedText(settings.displayName);
          const description = resolveAgentExtensionLocalizedText(settings.description);
          const enabled = settings.enabled;
          return {
            id: server.name,
            revision: package_.revision,
            title,
            description,
            localizedTitle: settings.displayName,
            localizedDescription: settings.description,
            ...(settings.presentation?.icon ? { icon: settings.presentation.icon } : {}),
            enabled,
            selectable: enabled,
            source: `${package_.source}:${package_.name}`,
          } satisfies AgentMcpActivationCatalogEntry;
        }),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  setInput(serverId: string, inputId: string, value: AgentExtensionInputValue): void {
    const definition = this.readInput(serverId, inputId);
    this.options.inputs.set(serverId, definition, value);
  }

  deleteInput(serverId: string, inputId: string): boolean {
    return this.options.inputs.delete(serverId, this.readInput(serverId, inputId));
  }

  updateInputs(
    serverId: string,
    values: Readonly<Record<string, AgentExtensionInputValue>>,
    deletes: readonly string[] = [],
  ): void {
    const { server } = this.readServer(serverId);
    this.options.inputs.update(serverId, server.inputs, { values, deletes });
  }

  /** Compatibility boundary for clients that still send the old credential commands. */
  setCredential(serverId: string, name: string, value: string): void {
    const definition = this.readInput(serverId, name);
    if (!definition.secret) throw new Error(`MCP input ${name} is not a Secret.`);
    this.options.inputs.set(serverId, definition, value);
  }

  /** Compatibility boundary for clients that still send the old credential commands. */
  deleteCredential(serverId: string, name: string): boolean {
    const definition = this.readInput(serverId, name);
    if (!definition.secret) throw new Error(`MCP input ${name} is not a Secret.`);
    return this.options.inputs.delete(serverId, definition);
  }

  restart(serverId: string): void {
    this.readServer(serverId);
    this.options.inputs.restart(serverId);
  }

  revision(): string {
    return this.options.inputs.revision();
  }

  private projectServer(package_: AgentMcpPackage, server: AgentMcpPackageServer): AgentMcpServerSettingsItem {
    const inputs = this.options.inputs.statuses(server.name, server.inputs);
    const missingCapabilities = missingAgentMcpHostCapabilities(package_.requirements, this.hostCapabilities);
    const unavailableCapabilityDetails = missingCapabilities.map((id) => {
      const reason = this.hostCapabilities.diagnostics.get(id);
      return reason ? { id, reason } : { id };
    });
    const status =
      missingCapabilities.length > 0
        ? "unavailable"
        : inputs.some((input) => input.required && !input.configured)
          ? "needs_input"
          : "configured";
    return {
      id: server.name,
      packageName: package_.name,
      displayName: package_.displayName ?? createAgentExtensionLocalizedText(package_.name),
      description: package_.description ?? createAgentExtensionLocalizedText(package_.name),
      source: package_.source,
      descriptorKind: package_.descriptorKind,
      ...(package_.presentation ? { presentation: package_.presentation } : {}),
      transport: server.configuration.type,
      status,
      enabled: status === "configured" && isAgentMcpServerEnabled(this.options.config(), server.name),
      ...(unavailableCapabilityDetails.length > 0 ? { unavailableCapabilityDetails } : {}),
      inputs,
    };
  }

  private readInput(serverId: string, inputId: string) {
    const { server } = this.readServer(serverId);
    const definition = server.inputs.find((input) => input.id === inputId);
    if (!definition) throw new Error(`MCP server ${serverId} does not declare input ${inputId}.`);
    return definition;
  }

  private readServer(serverId: string): { package_: AgentMcpPackage; server: AgentMcpPackageServer } {
    const location = this.catalog.packageSnapshot(this.options.config()).serversById.get(serverId);
    if (location) return location;
    throw new Error(`MCP server does not exist: ${serverId}`);
  }
}
