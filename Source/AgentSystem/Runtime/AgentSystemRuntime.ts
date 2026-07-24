import path from "node:path";
import { AgentConfigLoader } from "../Config/AgentConfigLoader.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import {
  resolveActionPlannerConfig,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveModelProviderConfig,
  resolvePresetsConfig,
  resolveSandboxRuntimeConfig,
  resolveToolExecutionConfig,
  resolveToolLearningConfig,
  resolveToolSearchConfig,
} from "../AgentDefaults.js";
import { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Plugin/AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "../Prompt/AgentPromptContextBuilder.js";
import { AgentPromptRenderer } from "../Prompt/AgentPromptRenderer.js";
import { AgentSchemaValidator } from "../Core/AgentSchemaValidator.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { createXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import { AgentActionPlanner } from "../ActionPlanner/AgentActionPlanner.js";
import { AgentToolCatalogProjector } from "../ToolRuntime/AgentToolCatalogProjector.js";
import { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import { AgentSkillActivationService } from "../Skills/AgentSkillActivation.js";
import { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import { AgentRuntimeModuleComposer, type AgentRuntimeModule } from "./AgentRuntimeModule.js";
import { createDefaultAgentRuntimeServices, type AgentRuntimeServices } from "./AgentRuntimeServices.js";
import { AgentPiSubstrate } from "../Pi/AgentPiSubstrate.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import { AgentToolPermissionGate } from "../Safety/AgentToolPermissionGate.js";
import { createAgentToolApprovalPolicy } from "../Safety/AgentToolApprovalPolicyFactory.js";
import { AgentSeneraOpaPolicyClient } from "../Safety/AgentSeneraOpaPolicyClient.js";
import { AgentResourceAccessPolicy } from "../Safety/AgentResourceAccessPolicy.js";
import { createAgentBamlToolRiskAuditor } from "../Safety/AgentBamlToolRiskAuditor.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import { createSeneraExecutionEnvironments } from "../Execution/SeneraExecutionEnvFactory.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { SeneraMicrosandboxSdkAdapter } from "../Execution/SeneraMicrosandboxTypes.js";
import { resolveAgentSandboxRuntimePaths } from "../Sandbox/AgentSandboxRuntimePreparation.js";
import { AgentPiCompactionSummarizer } from "../Pi/AgentPiCompactionSummarizer.js";
import { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import { resolveAgentExecutionResourceLimits } from "../ExecutionResources/AgentExecutionResourceConfig.js";
import { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import {
  createCompiledAgentMcpRuntimeModuleResolver,
  type AgentMcpRuntimeModuleResolver,
} from "../Mcp/AgentMcpRuntimeModuleResolver.js";

export class AgentSystemRuntime {
  readonly registry = new AgentPluginRegistry();
  readonly schemaValidator = new AgentSchemaValidator();
  readonly promptRenderer = new AgentPromptRenderer();
  readonly promptContextBuilder: AgentPromptContextBuilder;
  readonly conversationPolicy = new AgentConversationPolicy();
  readonly conversationProjector = new AgentConversationProjector();
  readonly modelProviderConfig;
  readonly agentLoopConfig;
  readonly toolSearchConfig;
  readonly toolLearningConfig;
  readonly presetsConfig;
  readonly artifactsConfig;
  readonly actionPlannerConfig;
  readonly xmlPolicy;
  readonly tokenEstimator;
  readonly toolCallExecutor: AgentToolCallExecutor;
  readonly toolSearch: AgentToolSearchRuntime;
  readonly toolCatalog: AgentToolCatalogProjector;
  readonly artifactRecorder: AgentToolExecutionArtifactRecorder;
  readonly presetManager: AgentPresetManager;
  readonly actionPlanner: AgentActionPlanner;
  readonly skillActivation: AgentSkillActivationService;
  readonly approvalRuntime: AgentApprovalRuntime;
  readonly interactionInput: AgentInteractionInputRuntime;
  readonly executionEnv: SeneraExecutionEnv;
  readonly toolExecutionEnv: SeneraExecutionEnv;
  readonly executionResources: AgentExecutionResourceBroker;
  readonly toolPermissionGate: AgentToolPermissionGate;
  readonly piSubstrate: AgentPiSubstrate;
  readonly piSessionRegistry: AgentPiActiveSessionRegistry;
  readonly services: AgentRuntimeServices;
  private closePromise: Promise<void> | undefined;
  private readonly ownsExecutionResources: boolean;
  private readonly ownsInteractionInput: boolean;

  private constructor(
    readonly workspaceRoot: string,
    readonly configPath: string,
    readonly config = AgentConfigLoader.load(configPath),
    readonly modelProviderId?: string,
    readonly runtimeModules: readonly AgentRuntimeModule[] = [],
    readonly logger?: AgentLogger,
    readonly piDiagnostics?: AgentPiDiagnosticSink,
    injectedApprovalRuntime?: AgentApprovalRuntime,
    injectedInteractionInput?: AgentInteractionInputRuntime,
    injectedPiSessionRegistry?: AgentPiActiveSessionRegistry,
    readonly resourcesPath?: string,
    runtimeModuleResolver?: AgentMcpRuntimeModuleResolver,
    injectedExecutionResources?: AgentExecutionResourceBroker,
    sandboxRuntimeReady?: () => boolean,
    microsandboxSdk?: SeneraMicrosandboxSdkAdapter,
  ) {
    this.approvalRuntime = injectedApprovalRuntime ?? new AgentApprovalRuntime();
    this.ownsInteractionInput = !injectedInteractionInput;
    this.interactionInput = injectedInteractionInput ?? new AgentInteractionInputRuntime();
    this.piSessionRegistry = injectedPiSessionRegistry ?? new AgentPiActiveSessionRegistry();
    const authorizationPolicyClient = new AgentSeneraOpaPolicyClient({ registry: this.registry });
    const sandboxRuntimeConfig = resolveSandboxRuntimeConfig(config);
    const sandboxRuntimePaths = tryResolveSandboxRuntimePaths(this.workspaceRoot, sandboxRuntimeConfig);
    const executionResourceLimits = resolveAgentExecutionResourceLimits(config);
    const executionEnvironments = createSeneraExecutionEnvironments({
      workspaceRoot: this.workspaceRoot,
      resourcesPath: this.resourcesPath,
      sandboxRuntimePaths,
      sandboxEnabled: sandboxRuntimeConfig.Enabled,
      sandboxRuntimeReady,
      microsandboxSdk,
      microsandboxSettings: {
        image: sandboxRuntimeConfig.Images[0],
      },
      environmentPolicy: resolveToolExecutionConfig(config).Environment,
      terminationGraceMs: executionResourceLimits.terminationGraceMs,
      resourceAccessPolicy: new AgentResourceAccessPolicy(authorizationPolicyClient),
    });
    this.executionEnv = executionEnvironments.system;
    this.toolExecutionEnv = executionEnvironments.tool;
    this.ownsExecutionResources = !injectedExecutionResources;
    this.executionResources =
      injectedExecutionResources ??
      new AgentExecutionResourceBroker({
        workspaceRoot: this.workspaceRoot,
        limits: executionResourceLimits,
      });
    this.modelProviderConfig = resolveModelProviderConfig(config, modelProviderId);
    this.agentLoopConfig = resolveAgentLoopConfig(config);
    this.toolSearchConfig = resolveToolSearchConfig(config);
    this.toolLearningConfig = resolveToolLearningConfig(config);
    this.presetsConfig = resolvePresetsConfig(config);
    this.artifactsConfig = resolveArtifactsConfig(config);
    this.actionPlannerConfig = resolveActionPlannerConfig(config, modelProviderId);
    this.xmlPolicy = createXmlProtocolPolicy(config);
    this.tokenEstimator = new AgentModelTokenEstimator({
      model: this.modelProviderConfig.Model,
    });
    this.promptContextBuilder = new AgentPromptContextBuilder(this.registry, config, this.workspaceRoot);
    this.skillActivation = new AgentSkillActivationService(this.registry);
    this.toolSearch = new AgentToolSearchRuntime(
      this.registry,
      this.toolSearchConfig,
      this.toolLearningConfig,
      this.workspaceRoot,
      this.modelProviderConfig,
      { logger: this.logger },
    );
    this.toolCatalog = new AgentToolCatalogProjector(this.registry);
    this.artifactRecorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot: this.workspaceRoot,
      config: this.artifactsConfig,
      model: this.modelProviderConfig.Model,
    });
    this.presetManager = new AgentPresetManager({
      workspaceRoot: this.workspaceRoot,
      config: this.presetsConfig,
    });
    this.actionPlanner = new AgentActionPlanner(this.actionPlannerConfig, this.modelProviderConfig, this.toolCatalog);
    this.toolPermissionGate = new AgentToolPermissionGate({
      policy: createAgentToolApprovalPolicy({
        registry: this.registry,
        policyClient: authorizationPolicyClient,
        auditors: [
          createAgentBamlToolRiskAuditor({
            client: new AgentActionPlannerModelClient(this.modelProviderConfig, this.actionPlannerConfig.Client, {
              maxRepairAttempts: this.actionPlannerConfig.MaxRepairAttempts,
            }),
          }),
        ],
      }),
      approvalRuntime: this.approvalRuntime,
    });

    this.toolCallExecutor = new AgentToolCallExecutor({
      registry: this.registry,
      config,
      protocol: this.xmlPolicy.protocol,
      workspaceRoot: this.workspaceRoot,
      executionEnv: this.toolExecutionEnv,
      runtimeModuleResolver: runtimeModuleResolver ?? createCompiledAgentMcpRuntimeModuleResolver(process.cwd()),
      toolSearch: this.toolSearch,
      executionResources: this.executionResources,
      configPath: this.configPath,
      emitLifecycleEvents: false,
      interactionInput: this.interactionInput,
    });
    this.piSubstrate = new AgentPiSubstrate({
      workspaceRoot: this.workspaceRoot,
      config,
      modelProvider: this.modelProviderConfig,
      registry: this.registry,
      toolCallExecutor: this.toolCallExecutor,
      artifactRecorder: this.artifactRecorder,
      executionEnv: this.executionEnv,
      toolPermissionGate: this.toolPermissionGate,
      compactionSummarizer: new AgentPiCompactionSummarizer(
        new AgentActionPlannerModelClient(
          this.modelProviderConfig,
          {
            ...this.actionPlannerConfig.Client,
            Temperature: 0,
            MaxTokens: this.agentLoopConfig.PiSessions.Compaction.SummaryMaxTokens,
          },
          { maxRepairAttempts: this.actionPlannerConfig.MaxRepairAttempts },
        ),
      ),
      diagnostics: this.piDiagnostics,
    });
    this.services = new AgentRuntimeModuleComposer().compose(
      createDefaultAgentRuntimeServices({
        actionPlanner: this.actionPlanner,
        artifactRecorder: this.artifactRecorder,
        toolCallExecutor: this.toolCallExecutor,
        piSessionRegistry: this.piSessionRegistry,
        presetManager: this.presetManager,
        promptContextBuilder: this.promptContextBuilder,
        piSubstrate: this.piSubstrate,
        skillActivation: this.skillActivation,
        toolCatalog: this.toolCatalog,
        toolSearch: this.toolSearch,
      }),
      this.runtimeModules,
    );
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeResources());
  }

  private async closeResources(): Promise<void> {
    const closures = [
      this.piSubstrate.close(),
      this.toolCallExecutor.close(),
      Promise.resolve().then(() => this.toolSearch.close()),
      ...(this.ownsInteractionInput ? [this.interactionInput.close()] : []),
      ...(this.ownsExecutionResources ? [this.executionResources.close()] : []),
    ];
    const outcomes = await Promise.allSettled(closures);
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Agent runtime shutdown failed.");
  }

  static load(
    options: {
      workspaceRoot?: string;
      configPath?: string;
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
    } = {},
  ): AgentSystemRuntime {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const configPath = path.resolve(workspaceRoot, options.configPath ?? "senera.config.json");

    const runtime = new AgentSystemRuntime(
      workspaceRoot,
      configPath,
      undefined,
      options.modelProviderId,
      options.runtimeModules,
      options.logger,
      options.piDiagnostics,
      options.approvalRuntime,
      options.interactionInput,
      options.piSessionRegistry,
      options.resourcesPath,
      options.runtimeModuleResolver,
      options.executionResources,
      undefined,
      options.microsandboxSdk,
    );
    const scanner = new AgentPluginScanner(workspaceRoot, runtime.config);
    for (const plugin of scanner.scan()) {
      runtime.registry.registerPlugin(plugin);
    }
    runtime.registry.validateAgentReferences();

    return runtime;
  }

  static fromConfig(options: {
    workspaceRoot?: string;
    configPath?: string;
    config: AgentSystemConfig;
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
    sandboxRuntimeReady?: () => boolean;
    microsandboxSdk?: SeneraMicrosandboxSdkAdapter;
  }): AgentSystemRuntime {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const configPath = path.resolve(workspaceRoot, options.configPath ?? "senera.config.json");

    const runtime = new AgentSystemRuntime(
      workspaceRoot,
      configPath,
      options.config,
      options.modelProviderId,
      options.runtimeModules,
      options.logger,
      options.piDiagnostics,
      options.approvalRuntime,
      options.interactionInput,
      options.piSessionRegistry,
      options.resourcesPath,
      options.runtimeModuleResolver,
      options.executionResources,
      options.sandboxRuntimeReady,
      options.microsandboxSdk,
    );
    const scanner = new AgentPluginScanner(workspaceRoot, runtime.config);
    for (const plugin of scanner.scan()) {
      runtime.registry.registerPlugin(plugin);
    }
    runtime.registry.validateAgentReferences();

    return runtime;
  }
}

function tryResolveSandboxRuntimePaths(workspaceRoot: string, config: ReturnType<typeof resolveSandboxRuntimeConfig>) {
  try {
    return resolveAgentSandboxRuntimePaths(workspaceRoot, config);
  } catch {
    return undefined;
  }
}
