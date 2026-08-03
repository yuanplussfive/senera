import fs from "node:fs";
import path from "node:path";
import { Ajv } from "ajv";
import { assertArtifactPolicyTemplates } from "../Artifacts/AgentArtifactTemplatePreflight.js";
import { AgentJsonFileLoader } from "../Config/AgentJsonFileLoader.js";
import { deepFreeze } from "../Core/AgentDeepFreeze.js";
import { agentDirectoryRevision } from "../Core/AgentDirectoryRevision.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import {
  resolveAgentExtensionLocalizedText,
  type AgentExtensionLocalizedText,
} from "../Extensions/AgentExtensionLocalization.js";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
import { AgentJsonSchemaPromptContractProjector } from "../ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import { ToolLoadingModes } from "../Types/AgentToolContractTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentSystemExtensionConfig } from "../Types/AgentSystemConfigTypes.js";
import {
  AgentSystemExtensionConfigurationReader,
  type AgentSystemExtensionConfigurationSettings,
} from "./AgentSystemExtensionConfiguration.js";
import {
  AgentSystemExtensionManifestFileName,
  AgentSystemExtensionManifestSchema,
  AgentSystemToolContractSchema,
  AgentToolObservationProjectionSchema,
  type AgentSystemExtensionManifest,
  type AgentSystemHostToolContribution,
  type AgentSystemToolContract,
} from "./AgentSystemExtensionManifest.js";
import type { AgentToolObservationProjectionManifest } from "../Types/AgentToolObservationProjectionTypes.js";
import {
  assertSystemExtensionRegularDirectory,
  assertSystemExtensionRegularFile,
  resolveSystemExtensionPackageDirectory,
  resolveSystemExtensionPackageFile,
} from "./AgentSystemExtensionPackagePath.js";

export type { AgentSystemExtensionConfigurationSettings } from "./AgentSystemExtensionConfiguration.js";

export interface AgentSystemExtensionCatalogOptions {
  readonly capabilities: ReadonlySet<string>;
  readonly configurations?: Readonly<Record<string, AgentSystemExtensionConfig>>;
}

export interface AgentSystemMcpContribution {
  readonly extensionId: string;
  readonly descriptorPath: string;
}

export interface AgentSystemExtensionToolSettingsItem {
  readonly name: string;
  readonly description: string;
  readonly loading: string;
  readonly capability: string;
}

export interface AgentSystemExtensionSettingsItem {
  readonly id: string;
  readonly version: string;
  readonly displayName: AgentExtensionLocalizedText;
  readonly description: AgentExtensionLocalizedText;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly priority?: number;
  readonly tools: readonly AgentSystemExtensionToolSettingsItem[];
  readonly skillCount: number;
  readonly mcpServerCount: number;
  readonly configuration?: AgentSystemExtensionConfigurationSettings;
}

/**
 * Traverses System extension packages and registers their contributions.
 * Manifest parsing, configuration materialization, and package path security
 * are delegated to focused collaborators.
 */
export class AgentSystemExtensionCatalog {
  private readonly json = new AgentJsonFileLoader();
  private readonly contracts = new AgentJsonSchemaPromptContractProjector();
  private readonly ajv = new Ajv({ allErrors: true, strict: true, validateFormats: false });
  private readonly configurations = new AgentSystemExtensionConfigurationReader();
  private readonly bindings = new Map<string, Set<string>>();
  private readonly mcpContributions: AgentSystemMcpContribution[] = [];
  private readonly extensions: AgentSystemExtensionSettingsItem[] = [];

  registerRoot(registry: AgentExtensionRegistry, rootPath: string, options: AgentSystemExtensionCatalogOptions): void {
    const root = path.resolve(rootPath);
    if (!fs.existsSync(root)) return;
    assertSystemExtensionRegularDirectory(root, "System extension collection");
    const packageIds = new Set<string>();
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      this.registerPackage(registry, path.join(root, entry.name), entry.name, options);
      packageIds.add(entry.name);
    }
    const unknownConfigurations = Object.keys(options.configurations ?? {}).filter((id) => !packageIds.has(id));
    if (unknownConfigurations.length > 0) {
      throw new Error(
        `Configuration references unknown System extensions: ${unknownConfigurations.sort().join(", ")}.`,
      );
    }
  }

  skillToolBindings(): ReadonlyMap<string, readonly string[]> {
    return new Map(
      [...this.bindings].map(([skill, tools]) => [skill, [...tools].sort((left, right) => left.localeCompare(right))]),
    );
  }

  listMcpContributions(): readonly AgentSystemMcpContribution[] {
    return [...this.mcpContributions];
  }

  listExtensions(): readonly AgentSystemExtensionSettingsItem[] {
    return [...this.extensions].sort(
      (left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id),
    );
  }

  private registerPackage(
    registry: AgentExtensionRegistry,
    packageRoot: string,
    directoryName: string,
    options: AgentSystemExtensionCatalogOptions,
  ): void {
    assertSystemExtensionRegularDirectory(packageRoot, "System extension package");
    const manifestPath = path.join(packageRoot, AgentSystemExtensionManifestFileName);
    assertSystemExtensionRegularFile(manifestPath, "System extension manifest");
    const manifest = deepFreeze(
      this.json.load(manifestPath, AgentSystemExtensionManifestSchema) as AgentSystemExtensionManifest,
    );
    if (manifest.id !== directoryName) {
      throw new Error(`System extension id ${manifest.id} must match its directory ${directoryName}.`);
    }
    if (this.extensions.some((extension) => extension.id === manifest.id)) {
      throw new Error(`Duplicate System extension id: ${manifest.id}.`);
    }

    const configured = options.configurations?.[manifest.id];
    const enabled = configured?.Enabled ?? true;
    const displayName = resolveAgentExtensionLocalizedText(manifest.displayName);
    const description = resolveAgentExtensionLocalizedText(manifest.description);
    const owner = {
      kind: "system" as const,
      name: manifest.id,
      title: displayName,
      description,
      rootPath: packageRoot,
      revision: agentDirectoryRevision(packageRoot),
      priority: manifest.priority,
      trusted: true,
      requiresApproval: false,
    };
    const toolContributions = manifest.contributions.filter(
      (contribution): contribution is AgentSystemHostToolContribution => contribution.kind === "hostTool",
    );
    assertUnique(
      toolContributions.map((contribution) => contribution.contract),
      `contract in ${manifest.id}`,
    );
    assertUnique(
      toolContributions.map((contribution) => contribution.capability),
      `capability in ${manifest.id}`,
    );
    const projectedTools = toolContributions.map((contribution) => {
      if (!options.capabilities.has(contribution.capability)) {
        throw new Error(
          `System extension ${manifest.id} references unregistered host capability ${contribution.capability}.`,
        );
      }
      const contractPath = resolveSystemExtensionPackageFile(packageRoot, contribution.contract, "host Tool contract");
      const contract = this.readContract(contractPath, packageRoot);
      for (const skill of enabled ? contribution.recommendedForSkills : []) {
        const toolNames = this.bindings.get(skill) ?? new Set<string>();
        toolNames.add(contract.name);
        this.bindings.set(skill, toolNames);
      }
      return {
        registered: this.project(owner, contract, contribution.capability),
        settings: {
          name: contract.name,
          description: contract.search?.Summary ?? contract.description,
          loading: ToolLoadingModes.Bootstrap,
          capability: contribution.capability,
        },
      };
    });
    if (enabled && projectedTools.length > 0) {
      registry.registerToolExtension(
        owner,
        projectedTools.map((tool) => tool.registered),
      );
    }

    const skills = manifest.contributions
      .filter((contribution) => contribution.kind === "skill")
      .map((contribution) => {
        const skillRoot = resolveSystemExtensionPackageDirectory(packageRoot, contribution.path, "Skill contribution");
        const skill = new AgentSkillScanner().readSkillDirectory(skillRoot);
        return {
          ...skill,
          source: {
            kind: "system" as const,
            id: manifest.id,
            displayName,
            priority: manifest.priority,
          },
        };
      });
    if (enabled && skills.length > 0) registry.replaceSkills(`system:${manifest.id}`, skills);

    for (const contribution of enabled ? manifest.contributions.filter((entry) => entry.kind === "mcpServer") : []) {
      this.mcpContributions.push({
        extensionId: manifest.id,
        descriptorPath: resolveSystemExtensionPackageFile(packageRoot, contribution.descriptor, "MCP descriptor"),
      });
    }

    const configuration = this.configurations.read(packageRoot, manifest, configured?.Configuration);
    this.extensions.push({
      id: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName,
      description: manifest.description,
      enabled,
      configured: configured !== undefined,
      priority: manifest.priority,
      tools: projectedTools.map((tool) => tool.settings),
      skillCount: skills.length,
      mcpServerCount: manifest.contributions.filter((entry) => entry.kind === "mcpServer").length,
      ...(configuration ? { configuration } : {}),
    });
  }

  private readContract(
    filePath: string,
    packageRoot: string,
  ): AgentSystemToolContract & { observation: AgentToolObservationProjectionManifest } {
    const source = deepFreeze(this.json.load(filePath, AgentSystemToolContractSchema) as AgentSystemToolContract);
    const projectionPath = resolveSystemExtensionPackageFile(
      packageRoot,
      source.observationProjection,
      "Tool observation projection",
    );
    const observation = deepFreeze(
      this.json.load(projectionPath, AgentToolObservationProjectionSchema) as AgentToolObservationProjectionManifest,
    );
    this.ajv.compile(source.inputSchema);
    if (source.outputSchema) this.ajv.compile(source.outputSchema);
    assertArtifactPolicyTemplates(source.artifacts, {
      argumentsSchema: source.inputSchema,
      resultSchema: source.outputSchema,
    });
    return { ...source, observation };
  }

  private project(
    owner: RegisteredTool["owner"],
    source: AgentSystemToolContract & { observation: AgentToolObservationProjectionManifest },
    capability: string,
  ): RegisteredTool {
    return {
      owner,
      name: source.name,
      loading: ToolLoadingModes.Bootstrap,
      contract: deepFreeze({
        digest: sha256HexOfCanonicalJson({
          inputSchema: source.inputSchema,
          outputSchema: source.outputSchema,
          observationProjection: source.observation,
        }),
        arguments: this.contracts.project(source.inputSchema),
        outputSchema: source.outputSchema,
      }),
      permissions: source.permissions,
      handler: { kind: "HostCapability", capability, resources: source.resources },
      execution: source.execution,
      runtime: source.runtime,
      observationProjection: source.observation,
      sources: source.sources,
      search: source.search ?? { Summary: source.description },
      evidenceCapabilities: source.evidenceCapabilities,
      approval: source.approval,
      artifactPolicy: source.artifacts,
    };
  }
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}
