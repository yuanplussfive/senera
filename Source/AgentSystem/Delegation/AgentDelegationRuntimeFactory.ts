import { AgentLoop } from "../Loop/AgentLoop.js";
import { AgentModelEndpointClient } from "../ModelEndpoints/AgentModelEndpointClient.js";
import { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import {
  resolveAgentDelegationRuntimeProfile,
  resolveModelProviderConfig,
} from "../AgentDefaults.js";
import {
  AgentChildAgentRuntime,
  type AgentChildModelFactory,
} from "./AgentChildAgentRuntime.js";
import { AgentDelegationExecutor } from "./AgentDelegationExecutor.js";
import { AgentDelegationWorkflowRunner } from "./AgentDelegationWorkflowRunner.js";
import { AgentMergePolicyExecutor } from "./AgentMergePolicyExecutor.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

export interface AgentDelegationRuntimeFactoryOptions {
  workspaceRoot: string;
  configPath: string;
  config: AgentSystemConfig;
  modelFactory?: AgentChildModelFactory;
}

export class AgentDelegationRuntimeFactory {
  constructor(private readonly options: AgentDelegationRuntimeFactoryOptions) {}

  createWorkflowRunner(): AgentDelegationWorkflowRunner {
    return new AgentDelegationWorkflowRunner({
      delegationExecutor: this.createDelegationExecutor(),
      mergeExecutor: this.createMergeExecutor(),
    });
  }

  createDelegationExecutor(): AgentDelegationExecutor {
    return new AgentDelegationExecutor({
      childRuntime: this.createChildRuntime(),
    });
  }

  createChildRuntime(): AgentChildAgentRuntime {
    const runtime = this.createRuntime();
    const template = this.requireTemplate(
      runtime,
      runtime.agentDelegationConfig.Templates.ChildSystemPrompt,
    );

    return new AgentChildAgentRuntime({
      workspaceRoot: this.options.workspaceRoot,
      systemTemplateFile: template.path,
      modelFactory: (modelProviderId) => this.createModel(modelProviderId),
      runtimeProfileResolver: (profileName) =>
        resolveAgentDelegationRuntimeProfile(this.options.config, profileName),
      loopFactory: ({ modelProviderId, agentLoopConfig }) => new AgentLoop({
        runtime: this.createRuntime(modelProviderId),
        model: this.createModel(modelProviderId),
        agentLoopConfig,
      }),
    });
  }

  createMergeExecutor(): AgentMergePolicyExecutor {
    const runtime = this.createRuntime();
    const template = this.requireTemplate(
      runtime,
      runtime.agentDelegationConfig.Templates.MergeSystemPrompt,
    );
    const providerId = runtime.agentDelegationConfig.Merge.ModelProviderId;

    return new AgentMergePolicyExecutor({
      workspaceRoot: this.options.workspaceRoot,
      systemTemplateFile: template.path,
      model: this.createModel(providerId),
    });
  }

  private createRuntime(modelProviderId?: string): AgentSystemRuntime {
    return AgentSystemRuntime.fromConfig({
      workspaceRoot: this.options.workspaceRoot,
      configPath: this.options.configPath,
      config: this.options.config,
      modelProviderId,
    });
  }

  private createModel(modelProviderId?: string) {
    const configured = resolveModelProviderConfig(this.options.config, modelProviderId);
    return this.options.modelFactory
      ? this.options.modelFactory(configured.Id)
      : new AgentModelEndpointClient(this.options.config, configured.Id);
  }

  private requireTemplate(runtime: AgentSystemRuntime, name: string) {
    const template = runtime.registry.getTemplate(name);
    if (!template) {
      throw new Error(`Agent delegation 模板没有注册：${name}`);
    }
    return template;
  }
}
