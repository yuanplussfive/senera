import path from "node:path";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import { AgentConfigLoader } from "../Config/AgentConfigLoader.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { SeneraGvisorWorkerClient } from "../Execution/SeneraGvisorTypes.js";
import type { SeneraMicrosandboxSdkAdapter } from "../Execution/SeneraMicrosandboxTypes.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import { AgentSkillScanner } from "../Skills/AgentSkillScanner.js";
import type { AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentToolSearchMemoryStore } from "../ToolSearch/AgentToolSearchMemoryTypes.js";
import type { AgentRuntimeModule } from "./AgentRuntimeModule.js";
import { AgentMcpPackageScanner, assertUniqueAgentMcpServerNames } from "../McpPackages/AgentMcpPackageScanner.js";
import { AgentMcpPackageDiscovery } from "../McpPackages/AgentMcpPackageDiscovery.js";
import { AgentMcpPackageSourceKinds } from "../McpPackages/AgentMcpPackageTypes.js";
import { isAgentMcpPackageToolNameForServer } from "../McpPackages/AgentMcpPackageIdentity.js";
import { AgentMcpPackageCatalog } from "../McpPackages/AgentMcpPackageCatalog.js";
import type { AgentMcpToolsChanged } from "../Mcp/AgentMcpToolCatalogChange.js";
import type { AgentExtensionValueResolver } from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentPiTurnContextStore } from "../PiShared/AgentPiTurnContext.js";
import {
  composeAgentSystemRuntime,
  type AgentSystemRuntimeComposition,
  type AgentSystemRuntimeCompositionOptions,
} from "./AgentSystemRuntimeComposition.js";
import type { AgentWorkspaceRuntimeServices } from "./AgentWorkspaceRuntime.js";

export interface AgentSystemRuntimeSharedOptions {
  modelProviderId?: string;
  runtimeModules?: readonly AgentRuntimeModule[];
  logger?: AgentLogger;
  piDiagnostics?: AgentPiDiagnosticSink;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  executionResources?: AgentExecutionResourceBroker;
  microsandboxSdk?: SeneraMicrosandboxSdkAdapter;
  toolSearchMemoryStore?: AgentToolSearchMemoryStore;
  mcpInputs?: AgentExtensionValueResolver;
  piTurnContexts?: AgentPiTurnContextStore;
  workspaceRuntime?: AgentWorkspaceRuntimeServices;
}

export interface AgentSystemRuntimeLoadOptions extends AgentSystemRuntimeSharedOptions {
  workspaceRoot?: string;
  configPath?: string;
}

export interface AgentSystemRuntimeFromConfigOptions extends AgentSystemRuntimeSharedOptions {
  workspaceRoot?: string;
  configPath?: string;
  config: AgentSystemConfig;
  sandboxRuntimeReady?: () => boolean;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  gvisorWorker?: SeneraGvisorWorkerClient;
}

export class AgentSystemRuntime {
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly config: AgentSystemConfig;
  readonly modelProviderId: string | undefined;
  readonly runtimeModules: readonly AgentRuntimeModule[];
  readonly logger: AgentLogger | undefined;
  readonly piDiagnostics: AgentPiDiagnosticSink | undefined;
  readonly resourcesPath: string | undefined;
  private readonly composition: AgentSystemRuntimeComposition;
  private readonly mcpPackageCatalog: AgentMcpPackageCatalog;
  private closePromise: Promise<void> | undefined;
  private initialization: Promise<void> | undefined;

  private constructor(options: AgentSystemRuntimeCompositionOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.configPath = options.configPath;
    this.config = options.config;
    this.modelProviderId = options.modelProviderId;
    this.runtimeModules = options.runtimeModules ?? [];
    this.logger = options.logger;
    this.piDiagnostics = options.piDiagnostics;
    this.resourcesPath = options.resourcesPath;
    this.composition = composeAgentSystemRuntime({
      ...options,
      onMcpToolsChanged: (change) => this.applyMcpToolsChanged(change),
    });
    this.mcpPackageCatalog = new AgentMcpPackageCatalog(this.registry, this.toolSearch);
  }

  get registry() {
    return this.composition.infrastructure.registry;
  }

  get schemaValidator() {
    return this.composition.infrastructure.schemaValidator;
  }

  get promptRenderer() {
    return this.composition.infrastructure.promptRenderer;
  }

  get conversationPolicy() {
    return this.composition.infrastructure.conversationPolicy;
  }

  get conversationProjector() {
    return this.composition.infrastructure.conversationProjector;
  }

  get approvalRuntime() {
    return this.composition.infrastructure.approvalRuntime;
  }

  get interactionInput() {
    return this.composition.infrastructure.interactionInput;
  }

  get piSessionRegistry() {
    return this.composition.infrastructure.piSessionRegistry;
  }

  get piTurnContexts() {
    return this.composition.infrastructure.piTurnContexts;
  }

  get executionEnv() {
    return this.composition.infrastructure.executionEnv;
  }

  get toolExecutionEnv() {
    return this.composition.infrastructure.toolExecutionEnv;
  }

  get executionResources() {
    return this.composition.infrastructure.executionResources;
  }

  get modelProviderConfig() {
    return this.composition.infrastructure.modelProviderConfig;
  }

  get agentLoopConfig() {
    return this.composition.infrastructure.agentLoopConfig;
  }

  get toolSearchConfig() {
    return this.composition.infrastructure.toolSearchConfig;
  }

  get toolLearningConfig() {
    return this.composition.infrastructure.toolLearningConfig;
  }

  get presetsConfig() {
    return this.composition.infrastructure.presetsConfig;
  }

  get artifactsConfig() {
    return this.composition.infrastructure.artifactsConfig;
  }

  get actionPlannerConfig() {
    return this.composition.infrastructure.actionPlannerConfig;
  }

  get xmlPolicy() {
    return this.composition.infrastructure.xmlPolicy;
  }

  get tokenEstimator() {
    return this.composition.agents.tokenEstimator;
  }

  get promptContextBuilder() {
    return this.composition.agents.promptContextBuilder;
  }

  get skillActivation() {
    return this.composition.agents.skillActivation;
  }

  get toolSearch() {
    return this.composition.agents.toolSearch;
  }

  get toolCatalog() {
    return this.composition.agents.toolCatalog;
  }

  get artifactRecorder() {
    return this.composition.agents.artifactRecorder;
  }

  get presetManager() {
    return this.composition.agents.presetManager;
  }

  get toolPermissionGate() {
    return this.composition.agents.toolPermissionGate;
  }

  get toolCallExecutor() {
    return this.composition.agents.toolCallExecutor;
  }

  get piSubstrate() {
    return this.composition.agents.piSubstrate;
  }

  get services() {
    return this.composition.agents.services;
  }

  initialize(): Promise<void> {
    return (this.initialization ??= this.initializeMcpPackages());
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeResources());
  }

  static load(options: AgentSystemRuntimeLoadOptions = {}): AgentSystemRuntime {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const configPath = path.resolve(workspaceRoot, options.configPath ?? "senera.config.json");
    return this.create({
      ...options,
      workspaceRoot,
      configPath,
      config: AgentConfigLoader.load(configPath),
    });
  }

  static fromConfig(options: AgentSystemRuntimeFromConfigOptions): AgentSystemRuntime {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const configPath = path.resolve(workspaceRoot, options.configPath ?? "senera.config.json");
    return this.create({ ...options, workspaceRoot, configPath });
  }

  private static create(options: AgentSystemRuntimeCompositionOptions): AgentSystemRuntime {
    const runtime = new AgentSystemRuntime(options);
    const resourcesRoot = path.resolve(runtime.resourcesPath ?? runtime.workspaceRoot);
    const systemSkillTools = runtime.composition.infrastructure.systemSkillToolBindings;
    const skillScanner = new AgentSkillScanner();
    for (const skill of skillScanner.scanRoot(path.join(resourcesRoot, "System", "Skills"))) {
      runtime.registry.registerSkill({
        ...skill,
        source: { kind: "system", id: skill.name, displayName: "Senera", priority: 10 },
        recommendedTools: [...new Set([...skill.recommendedTools, ...(systemSkillTools.get(skill.name) ?? [])])],
      });
    }
    for (const skill of skillScanner.scanRoot(resolveAgentWorkspaceLayout(runtime.workspaceRoot).skillRoot)) {
      runtime.registry.registerSkill(skill);
    }
    return runtime;
  }

  private async initializeMcpPackages(): Promise<void> {
    const resourcesRoot = path.resolve(this.resourcesPath ?? this.workspaceRoot);
    const workspaceLayout = resolveAgentWorkspaceLayout(this.workspaceRoot);
    const scanner = new AgentMcpPackageScanner();
    const packages = [
      ...scanner.scanRoot(path.join(resourcesRoot, "McpServers"), AgentMcpPackageSourceKinds.Bundled),
      ...this.composition.infrastructure.systemMcpContributions.map((contribution) =>
        scanner.readPackage(
          path.dirname(contribution.descriptorPath),
          AgentMcpPackageSourceKinds.Bundled,
          contribution.extensionId,
        ),
      ),
      ...scanner.scanRoot(workspaceLayout.mcpRoot, AgentMcpPackageSourceKinds.Workspace),
    ];
    assertUniqueAgentMcpServerNames(packages);
    const discovery = await new AgentMcpPackageDiscovery(this.config, this.executionEnv, {
      clientPool: this.composition.infrastructure.mcpClientPool,
      sampling: this.composition.infrastructure.mcpSampling,
      onToolsChanged: (change) => this.applyMcpToolsChanged(change),
      inputs: this.composition.infrastructure.mcpInputs,
    }).discover(packages);
    await this.mcpPackageCatalog.install(discovery.servers, {
      isDeferredToolReference: (toolName) =>
        discovery.unavailableServers.some((server) => isAgentMcpPackageToolNameForServer(toolName, server.serverName)),
    });
  }

  private applyMcpToolsChanged(change: AgentMcpToolsChanged): Promise<void> {
    return this.mcpPackageCatalog.update(change);
  }

  private async closeResources(): Promise<void> {
    const infrastructure = this.composition.infrastructure;
    const closures = [
      this.piSubstrate.close(),
      this.toolCallExecutor.close(),
      ...(infrastructure.ownsMcpClientPool ? [infrastructure.mcpClientPool.close()] : []),
      Promise.resolve().then(() => this.toolSearch.close()),
      ...(infrastructure.ownsInteractionInput ? [this.interactionInput.close()] : []),
      ...(infrastructure.ownsExecutionResources ? [this.executionResources.close()] : []),
    ];
    const outcomes = await Promise.allSettled(closures);
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Agent runtime shutdown failed.");
  }
}
