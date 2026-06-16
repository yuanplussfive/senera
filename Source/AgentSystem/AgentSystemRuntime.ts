import path from "node:path";
import { AgentConfigLoader } from "./AgentConfigLoader.js";
import { AgentModelTextBudget, AgentModelTokenEstimator } from "./AgentTextBudget.js";
import {
  resolveActionPlannerConfig,
  resolveAgentLoopConfig,
  resolveArtifactsConfig,
  resolveModelProviderConfig,
  resolveToolSearchConfig,
} from "./AgentDefaults.js";
import { AgentDecisionXmlCollector } from "./AgentDecisionXmlCollector.js";
import { AgentDecisionExecutor } from "./AgentDecisionExecutor.js";
import { AgentDecisionParser } from "./AgentDecisionParser.js";
import type { AgentLanguageModel } from "./AgentLanguageModel.js";
import { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import { AgentPluginScanner } from "./AgentPluginScanner.js";
import { AgentPromptContextBuilder } from "./AgentPromptContextBuilder.js";
import { AgentPromptRenderer } from "./AgentPromptRenderer.js";
import { AgentSchemaValidator } from "./AgentSchemaValidator.js";
import { AgentConversationPolicy } from "./AgentConversationPolicy.js";
import { AgentConversationProjector } from "./AgentConversationProjector.js";
import { AgentXmlParser } from "./AgentXmlParser.js";
import type { AgentSystemConfig } from "./Types.js";
import { createXmlProtocolPolicy } from "./AgentXmlPolicy.js";
import { AgentDecisionErrorFactory } from "./AgentDecisionErrorFactory.js";
import { AgentToolCallsXmlNormalizer } from "./AgentToolCallsXmlNormalizer.js";
import { AgentToolSearchRuntime } from "./AgentToolSearchRuntime.js";
import { AgentActionPlanner } from "./AgentActionPlanner.js";
import { AgentToolCatalogProjector } from "./AgentToolCatalogProjector.js";
import { AgentActionMismatchRepairPromptBuilder } from "./AgentActionMismatchRepairPromptBuilder.js";
import { AgentToolExecutionArtifactRecorder } from "./Artifacts/AgentToolExecutionArtifactRecorder.js";

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
  readonly toolSearchConfig;
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
  readonly actionPlanner: AgentActionPlanner;
  readonly actionMismatchRepairPromptBuilder: AgentActionMismatchRepairPromptBuilder;

  private constructor(
    readonly workspaceRoot: string,
    readonly configPath: string,
    readonly config = AgentConfigLoader.load(configPath),
    readonly modelProviderId?: string,
  ) {
    this.modelProviderConfig = resolveModelProviderConfig(config, modelProviderId);
    this.agentLoopConfig = resolveAgentLoopConfig(config);
    this.toolSearchConfig = resolveToolSearchConfig(config);
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
    this.toolSearch = new AgentToolSearchRuntime(
      this.registry,
      this.toolSearchConfig,
      this.workspaceRoot,
    );
    this.toolCatalog = new AgentToolCatalogProjector(this.registry);
    this.artifactRecorder = new AgentToolExecutionArtifactRecorder({
      workspaceRoot: this.workspaceRoot,
      config: this.artifactsConfig,
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
    );
    const scanner = new AgentPluginScanner(workspaceRoot, runtime.config);
    for (const plugin of scanner.scan()) {
      runtime.registry.registerPlugin(plugin);
    }

    return runtime;
  }

  static fromConfig(options: {
    workspaceRoot?: string;
    configPath?: string;
    config: AgentSystemConfig;
    modelProviderId?: string;
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
    );
    const scanner = new AgentPluginScanner(workspaceRoot, runtime.config);
    for (const plugin of scanner.scan()) {
      runtime.registry.registerPlugin(plugin);
    }

    return runtime;
  }
}
