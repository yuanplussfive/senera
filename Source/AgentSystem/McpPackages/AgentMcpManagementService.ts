import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentExtensionInputValue } from "../Extensions/AgentExtensionInput.js";
import type { AgentMcpInputService, AgentMcpInputStatus } from "../Credentials/AgentMcpInputService.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentMcpPackage, AgentMcpPackageServer } from "./AgentMcpPackageTypes.js";
import type { AgentSystemExtensionSettingsItem } from "../SystemTools/AgentSystemToolSource.js";
import {
  AgentMcpManagementCatalog,
  type AgentSystemSettingsSnapshot,
  type AgentSystemToolSettingsItem,
} from "./AgentMcpManagementCatalog.js";

export type { AgentSystemSettingsSnapshot, AgentSystemToolSettingsItem } from "./AgentMcpManagementCatalog.js";

export interface AgentMcpServerSettingsItem {
  readonly id: string;
  readonly packageName: string;
  readonly source: AgentMcpPackage["source"];
  readonly transport: "stdio" | "http";
  readonly descriptorKind: AgentMcpPackage["descriptorKind"];
  readonly status: "configured" | "needs_input";
  readonly inputs: readonly AgentMcpInputStatus[];
}

export interface AgentMcpManagementServiceOptions {
  readonly workspaceRoot: string;
  readonly resourcesRoot: string;
  readonly inputs: AgentMcpInputService;
  readonly config: () => AgentSystemConfig;
}

export interface AgentMcpSettingsSnapshot {
  readonly revision: string;
  readonly servers: readonly AgentMcpServerSettingsItem[];
}

export class AgentMcpManagementService {
  private readonly catalog: AgentMcpManagementCatalog;
  private mcpSettingsCache?: AgentMcpSettingsSnapshot;

  constructor(private readonly options: AgentMcpManagementServiceOptions) {
    this.catalog = new AgentMcpManagementCatalog(options);
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
    });
    if (this.mcpSettingsCache?.revision === revision) return this.mcpSettingsCache;
    const servers = packages.packages
      .flatMap((package_) => package_.servers.map((server) => this.projectServer(package_, server)))
      .sort((left, right) => left.id.localeCompare(right.id));
    this.mcpSettingsCache = deepFreeze({ revision, servers });
    return this.mcpSettingsCache;
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
    return {
      id: server.name,
      packageName: package_.name,
      source: package_.source,
      descriptorKind: package_.descriptorKind,
      transport: server.configuration.type,
      status: inputs.some((input) => input.required && !input.configured) ? "needs_input" : "configured",
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
