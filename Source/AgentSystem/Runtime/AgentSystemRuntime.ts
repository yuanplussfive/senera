import path from "node:path";
import { AgentConfigLoader } from "../AgentConfigLoader.js";
import { AgentModelTextBudget, AgentModelTokenEstimator } from "../AgentTextBudget.js";
import {
  resolveActionPlannerConfig,
  resolveAgentDelegationConfig,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveModelProviderConfig,
  resolvePresetsConfig,
  resolveToolLearningConfig,
  resolveToolSearchConfig,
} from "../AgentDefaults.js";
import { AgentDecisionXmlCollector } from "../Decision/AgentDecisionXmlCollector.js";
import { AgentDecisionExecutor } from "../Decision/AgentDecisionExecutor.js";
import { AgentDecisionParser } from "../Decision/AgentDecisionParser.js";
import type { AgentLanguageModel } from "../ModelEndpoints/AgentLanguageModel.js";
import { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { AgentPluginScanner } from "../Plugin/AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "../Prompt/AgentPromptContextBuilder.js";
import { AgentPromptRenderer } from "../Prompt/AgentPromptRenderer.js";
import { AgentSchemaValidator } from "../AgentSchemaValidator.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import { AgentXmlParser } from "../Xml/AgentXmlParser.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { createXmlProtocolPolicy } from "../Xml/AgentXmlPolicy.js";
import { AgentDecisionErrorFactory } from "../Decision/AgentDecisionErrorFactory.js";
import { AgentToolCallsXmlNormalizer } from "../Xml/AgentToolCallsXmlNormalizer.js";
import { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import { AgentActionPlanner } from "../ActionPlanner/AgentActionPlanner.js";
import { AgentToolCatalogProjector } from "../ToolRuntime/AgentToolCatalogProjector.js";
import { AgentActionMismatchRepairPromptBuilder } from "../ActionPlanner/AgentActionMismatchRepairPromptBuilder.js";
import { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import { AgentSkillActivationService } from "../AgentSkillActivation.js";
import { AgentPresetManager } from "../Presets/AgentPresetManager.js";
import { AgentRuntimeModuleComposer, type AgentRuntimeModule } from "./AgentRuntimeModule.js";
import {
  createDefaultAgentRuntimeServices,
  type AgentRuntimeServices,
} from "./AgentRuntimeServices.js";

export class AgentSystemRuntime {
  readonly registry = new AgentPluginRegistry();
  readonly schemaValidator = new AgentSchemaValidator();
  readonly promptRenderer = new AgentPromptRenderer();
  readonly errorFactory: AgentDecisionErrorFactory;
  readonly promptContextBuilder: AgentPromptContextBuilder;
  readonly conversationPolicy = new AgentConversationPolicy();
  readonly conversationProjector = new AgentConversationProjector();
  readonly modelProviderConfig;
  readonly agentLoopConfig;
  readonly agentDelegationConfig;
  readonly toolSearchConfig;
  readonly toolLearningConfig;
  readonly presetsConfig;
  readonly artifactsConfig;
  readonly actionPlannerConfig;
  readonly xmlPolicy;
  readonly decisionXmlTextBudget;
  readonly tokenEstimator;
  readonly xmlParser: AgentXmlParser;
  readonly toolCallsXmlNormalizer: AgentToolCallsXmlNormalizer;
  readonly decisionParser: AgentDecisionParser;
  readonly decisionExecutor: AgentDecisionExecutor;
  readonly toolSearch: AgentToolSearchRuntime;
  readonly toolCatalog: AgentToolCatalogProjector;
  readonly artifactRecorder: AgentToolExecutionArtifactRecorder;
  readonly presetManager: AgentPresetManager;
  readonly actionPlanner: AgentActionPlanner;
  readonly actionMismatchRepairPromptBuilder: AgentActionMismatchRepairPromptBuilder;
  readonly skillActivation: AgentSkillActivationService;
  readonly services: AgentRuntimeServices;

  private constructor(
    readonly workspaceRoot: string,
    readonly configPath: string,
    readonly config = AgentConfigLoader.load(configPath),
    readonly modelProviderId?: string,
    readonly runtimeModules: readonly AgentRuntimeModule[] = [],
  ) {
    this.modelProviderConfig = resolveModelProviderConfig(config, modelProviderId);
    this.agentLoopConfig = resolveAgentLoopConfig(config);
    this.agentDelegationConfig = resolveAgentDelegationConfig(config);
    this.toolSearchConfig = resolveToolSearchConfig(config);
    this.toolLearningConfig = resolveToolLearningConfig(config);
    this.presetsConfig = resolvePresetsConfig(config);
    this.artifactsConfig = resolveArtifactsConfig(config);
    this.actionPlannerConfig = resolveActionPlannerConfig(config, modelProviderId);
    this.xmlPolicy = createXmlProtocolPolicy(config);
    this.decisionXmlTextBudget = new AgentModelTextBudget({
      model: this.modelProviderConfig.Model,
      tokenLimit: this.xmlPolicy.maxDecisionTokens,
    });
    this.tokenEstimator = new AgentModelTokenEstimator({
      model: this.modelProviderConfig.Model,
    });
    this.promptContextBuilder = new AgentPromptContextBuilder(this.registry, config);
    this.skillActivation = new AgentSkillActivationService(this.registry);
    this.toolSearch = new AgentToolSearchRuntime(
      this.registry,
      this.toolSearchConfig,
      this.toolLearningConfig,
      this.workspaceRoot,
      this.modelProviderConfig,
    );
    this.toolCatalog = new AgentToolCatalogProjector(this.registry);
    this.artifactRecorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot: this.workspaceRoot,
      config: this.artifactsConfig,
    });
    this.presetManager = new AgentPresetManager({
      workspaceRoot: this.workspaceRoot,
      config: this.presetsConfig,
    });
    this.actionPlanner = new AgentActionPlanner(
      this.actionPlannerConfig,
      this.modelProviderConfig,
      this.toolCatalog,
    );
    this.actionMismatchRepairPromptBuilder = new AgentActionMismatchRepairPromptBuilder({
      registry: this.registry,
      promptRenderer: this.promptRenderer,
      toolCatalog: this.toolCatalog,
      protocol: this.xmlPolicy.protocol,
    });

    this.errorFactory = new AgentDecisionErrorFactory({
      registry: this.registry,
      promptRenderer: this.promptRenderer,
      workspaceRoot: this.workspaceRoot,
      protocol: this.xmlPolicy.protocol,
    });

    this.xmlParser = new AgentXmlParser({
      textBudget: this.decisionXmlTextBudget,
      policy: this.xmlPolicy,
    });
    this.toolCallsXmlNormalizer = AgentToolCallsXmlNormalizer.fromTools(
      () => this.registry.listTools(),
      this.xmlPolicy.protocol,
    );

    this.decisionParser = new AgentDecisionParser(
      this.xmlParser,
      this.registry,
      this.schemaValidator,
      {
        policy: this.xmlPolicy,
        errorFactory: this.errorFactory,
        candidateNormalizer: this.toolCallsXmlNormalizer,
      },
    );

    this.decisionExecutor = new AgentDecisionExecutor(
      this.registry,
      config,
      this.xmlPolicy.protocol,
      undefined,
      this.errorFactory,
      this.workspaceRoot,
      undefined,
      this.toolSearch,
      this.configPath,
    );
    this.services = new AgentRuntimeModuleComposer().compose(
      createDefaultAgentRuntimeServices({
        actionPlanner: this.actionPlanner,
        artifactRecorder: this.artifactRecorder,
        decisionExecutor: this.decisionExecutor,
        presetManager: this.presetManager,
        promptContextBuilder: this.promptContextBuilder,
        registry: this.registry,
        skillActivation: this.skillActivation,
        toolCatalog: this.toolCatalog,
        toolSearch: this.toolSearch,
      }),
      this.runtimeModules,
    );
  }

  createDecisionXmlCollector(model: AgentLanguageModel): AgentDecisionXmlCollector {
    return new AgentDecisionXmlCollector({
      model,
      policy: this.xmlPolicy,
      textBudget: this.decisionXmlTextBudget,
      tokenEstimator: this.tokenEstimator,
      decisionActions: this.registry.listDecisionActions(),
      candidateNormalizer: this.toolCallsXmlNormalizer,
      actionMismatchRepairPromptBuilder: this.actionMismatchRepairPromptBuilder,
    });
  }

  static load(options: {
    workspaceRoot?: string;
    configPath?: string;
    modelProviderId?: string;
    runtimeModules?: readonly AgentRuntimeModule[];
  } = {}): AgentSystemRuntime {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const configPath = path.resolve(
      workspaceRoot,
      options.configPath ?? "senera.config.json",
    );

    const runtime = new AgentSystemRuntime(
      workspaceRoot,
      configPath,
      undefined,
      options.modelProviderId,
      options.runtimeModules,
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
  }): AgentSystemRuntime {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const configPath = path.resolve(
      workspaceRoot,
      options.configPath ?? "senera.config.json",
    );

    const runtime = new AgentSystemRuntime(
      workspaceRoot,
      configPath,
      options.config,
      options.modelProviderId,
      options.runtimeModules,
    );
    const scanner = new AgentPluginScanner(workspaceRoot, runtime.config);
    for (const plugin of scanner.scan()) {
      runtime.registry.registerPlugin(plugin);
    }
    runtime.registry.validateAgentReferences();

    return runtime;
  }
}
