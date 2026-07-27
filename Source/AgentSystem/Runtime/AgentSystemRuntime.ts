import path from "node:path";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import { AgentConfigLoader } from "../Config/AgentConfigLoader.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { SeneraGvisorWorkerClient } from "../Execution/SeneraGvisorTypes.js";
import type { SeneraMicrosandboxSdkAdapter } from "../Execution/SeneraMicrosandboxTypes.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import type { AgentMcpRuntimeModuleResolver } from "../Mcp/AgentMcpRuntimeModuleResolver.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import { AgentPluginScanner } from "../Plugin/AgentPluginScanner.js";
import type { AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentRuntimeModule } from "./AgentRuntimeModule.js";
import {
  composeAgentSystemRuntime,
  type AgentSystemRuntimeComposition,
  type AgentSystemRuntimeCompositionOptions,
} from "./AgentSystemRuntimeComposition.js";

export interface AgentSystemRuntimeSharedOptions {
  modelProviderId?: string;
  runtimeModules?: readonly AgentRuntimeModule[];
  logger?: AgentLogger;
  piDiagnostics?: AgentPiDiagnosticSink;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  runtimeModuleResolver?: AgentMcpRuntimeModuleResolver;
  executionResources?: AgentExecutionResourceBroker;
  microsandboxSdk?: SeneraMicrosandboxSdkAdapter;
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
  private closePromise: Promise<void> | undefined;

  private constructor(options: AgentSystemRuntimeCompositionOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.configPath = options.configPath;
    this.config = options.config;
    this.modelProviderId = options.modelProviderId;
    this.runtimeModules = options.runtimeModules ?? [];
    this.logger = options.logger;
    this.piDiagnostics = options.piDiagnostics;
    this.resourcesPath = options.resourcesPath;
    this.composition = composeAgentSystemRuntime(options);
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

  get actionPlanner() {
    return this.composition.agents.actionPlanner;
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
    const scanner = new AgentPluginScanner(runtime.workspaceRoot, runtime.config);
    for (const plugin of scanner.scan()) runtime.registry.registerPlugin(plugin);
    runtime.registry.validateAgentReferences();
    return runtime;
  }

  private async closeResources(): Promise<void> {
    const infrastructure = this.composition.infrastructure;
    const closures = [
      this.piSubstrate.close(),
      this.toolCallExecutor.close(),
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
