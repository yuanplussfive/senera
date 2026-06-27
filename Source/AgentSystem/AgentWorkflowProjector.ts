import type {
  RegisteredAgent,
  RegisteredAgentContextPack,
  RegisteredAgentMergePolicy,
  RegisteredAgentWorkflow,
} from "./Types/PluginRuntimeTypes.js";
import type { AgentWorkflowSelectionResult } from "./AgentWorkflowSelector.js";

export interface AgentWorkflowProjectionRegistry {
  getAgent(name: string): RegisteredAgent | undefined;
  getAgentContextPack(name: string): RegisteredAgentContextPack | undefined;
  getAgentMergePolicy(name: string): RegisteredAgentMergePolicy | undefined;
}

export interface AgentWorkflowProjection {
  name: string;
  title?: string;
  description?: string;
  pluginName: string;
  execution: AgentWorkflowExecutionProjection;
  jobs: AgentWorkflowJobProjection[];
  mergePolicy: AgentWorkflowMergePolicyProjection;
  matched?: AgentWorkflowMatchProjection;
}

export interface AgentWorkflowExecutionProjection {
  strategy: "sequential" | "parallel";
  maxConcurrency?: number;
}

export interface AgentWorkflowJobProjection {
  agent: AgentWorkflowAgentProjection;
  taskFile: string;
  contextPack: AgentWorkflowContextPackProjection;
  required?: boolean;
}

export interface AgentWorkflowAgentProjection {
  name: string;
  title?: string;
  pluginName: string;
  descriptionFile: string;
  instructionsFile: string;
  recommendedTools: string[];
  runtimeProfile: string;
  outputSchemaPath: string;
}

export interface AgentWorkflowContextPackProjection {
  name: string;
  description?: string;
  templateFile: string;
  inputs: string[];
  toolScope: string;
  history: string;
  artifacts: string;
  evidence?: string;
}

export interface AgentWorkflowMergePolicyProjection {
  name: string;
  description?: string;
  strategy: string;
  templateFile: string;
  outputSchemaPath?: string;
}

export interface AgentWorkflowMatchProjection {
  matchedSkills: string[];
  matchedAgents: string[];
  matchedTerms: string[];
  sources: string[];
}

export class AgentWorkflowProjector {
  constructor(private readonly registry: AgentWorkflowProjectionRegistry) {}

  projectSelection(selection: AgentWorkflowSelectionResult): AgentWorkflowProjection {
    return {
      ...this.project(selection.workflow),
      matched: {
        matchedSkills: selection.matchedSkills,
        matchedAgents: selection.matchedAgents,
        matchedTerms: selection.matchedTerms,
        sources: selection.sources,
      },
    };
  }

  project(workflow: RegisteredAgentWorkflow): AgentWorkflowProjection {
    return {
      name: workflow.name,
      title: workflow.title,
      description: workflow.description,
      pluginName: workflow.plugin.manifest.Plugin.Name,
      execution: this.projectExecution(workflow.execution),
      jobs: workflow.jobs.map((job) => {
        const agent = this.requireAgent(job.agent, workflow.name);
        return {
          agent: this.projectAgent(agent),
          taskFile: job.taskFile,
          contextPack: this.projectContextPack(
            this.requireContextPack(job.contextPack ?? agent.contextPack, workflow.name),
          ),
          required: job.required,
        };
      }),
      mergePolicy: this.projectMergePolicy(
        this.requireMergePolicy(workflow.mergePolicy, workflow.name),
      ),
    };
  }

  private projectExecution(
    execution: RegisteredAgentWorkflow["execution"],
  ): AgentWorkflowExecutionProjection {
    return {
      strategy: execution.Strategy,
      maxConcurrency: execution.MaxConcurrency,
    };
  }

  private projectAgent(agent: RegisteredAgent): AgentWorkflowAgentProjection {
    return {
      name: agent.name,
      title: agent.title,
      pluginName: agent.plugin.manifest.Plugin.Name,
      descriptionFile: agent.descriptionFile,
      instructionsFile: agent.instructionsFile,
      recommendedTools: agent.recommendedTools,
      runtimeProfile: agent.runtimeProfile,
      outputSchemaPath: agent.outputSchemaPath,
    };
  }

  private projectContextPack(
    contextPack: RegisteredAgentContextPack,
  ): AgentWorkflowContextPackProjection {
    return {
      name: contextPack.name,
      description: contextPack.description,
      templateFile: contextPack.templateFile,
      inputs: contextPack.inputs,
      toolScope: contextPack.toolScope,
      history: contextPack.history,
      artifacts: contextPack.artifacts,
      evidence: contextPack.evidence,
    };
  }

  private projectMergePolicy(
    mergePolicy: RegisteredAgentMergePolicy,
  ): AgentWorkflowMergePolicyProjection {
    return {
      name: mergePolicy.name,
      description: mergePolicy.description,
      strategy: mergePolicy.strategy,
      templateFile: mergePolicy.templateFile,
      outputSchemaPath: mergePolicy.outputSchemaPath,
    };
  }

  private requireAgent(agentName: string, workflowName: string): RegisteredAgent {
    const agent = this.registry.getAgent(agentName);
    if (!agent) {
      throw new Error(`Workflow ${workflowName} 引用了不存在的 Agent：${agentName}`);
    }
    return agent;
  }

  private requireContextPack(
    contextPackName: string,
    workflowName: string,
  ): RegisteredAgentContextPack {
    const contextPack = this.registry.getAgentContextPack(contextPackName);
    if (!contextPack) {
      throw new Error(`Workflow ${workflowName} 引用了不存在的 ContextPack：${contextPackName}`);
    }
    return contextPack;
  }

  private requireMergePolicy(
    mergePolicyName: string,
    workflowName: string,
  ): RegisteredAgentMergePolicy {
    const mergePolicy = this.registry.getAgentMergePolicy(mergePolicyName);
    if (!mergePolicy) {
      throw new Error(`Workflow ${workflowName} 引用了不存在的 MergePolicy：${mergePolicyName}`);
    }
    return mergePolicy;
  }
}
