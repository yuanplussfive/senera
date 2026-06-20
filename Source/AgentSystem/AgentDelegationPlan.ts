import { createOpaqueId } from "./AgentIds.js";
import { toWorkspaceRelativePath } from "./Artifacts/AgentArtifactLocator.js";
import {
  AgentWorkflowProjector,
  type AgentWorkflowProjectionRegistry,
} from "./AgentWorkflowProjector.js";
import type {
  AgentPluginRegistryLike,
  RegisteredAgentWorkflow,
} from "./Types.js";

export interface AgentDelegationPlanInput {
  workflow: string;
  objective?: string;
  evidenceRefs?: readonly string[];
  artifactUris?: readonly string[];
}

export interface AgentDelegationPlanOptions {
  registry: AgentPluginRegistryLike;
  workspaceRoot: string;
}

export interface AgentDelegationPlan {
  workflow: {
    name: string;
    title?: string;
    description?: string;
    pluginName: string;
  };
  objective?: string;
  execution: {
    mode: "plan";
    status: "readyForRuntime";
  };
  schedule: AgentDelegationSchedule;
  jobs: {
    item: AgentDelegationJob[];
  };
  jobCount: number;
  mergePolicy: {
    name: string;
    description?: string;
    strategy: string;
    templateFile: string;
    outputSchema?: string;
  };
}

export interface AgentDelegationSchedule {
  strategy: "sequential" | "parallel";
  maxConcurrency?: number;
}

export interface AgentDelegationJob {
  jobId: string;
  index: number;
  status: "planned";
  workflowName: string;
  agentName: string;
  agentTitle?: string;
  agentPluginName: string;
  agentDescriptionFile: string;
  agentInstructionsFile: string;
  taskFile: string;
  contextPack: string;
  contextPackDescription?: string;
  contextTemplateFile: string;
  contextInputs: {
    item: string[];
  };
  toolScope: string;
  historyPolicy: string;
  artifactPolicy: string;
  evidencePolicy?: string;
  recommendedTools: {
    item: string[];
  };
  runtimeProfile: string;
  outputSchema: string;
  required: boolean;
  suppliedEvidenceRefs: {
    item: string[];
  };
  suppliedArtifactUris: {
    item: string[];
  };
}

interface AgentDelegationRegistry extends AgentWorkflowProjectionRegistry {
  getAgentWorkflow(name: string): RegisteredAgentWorkflow | undefined;
}

export function buildAgentDelegationPlan(
  input: AgentDelegationPlanInput,
  options: AgentDelegationPlanOptions,
): AgentDelegationPlan {
  const registry = requireDelegationRegistry(options.registry);
  const workflow = registry.getAgentWorkflow(input.workflow);
  if (!workflow) {
    throw new Error(`Agent delegation workflow 不存在：${input.workflow}`);
  }

  const projection = new AgentWorkflowProjector(registry).project(workflow);
  const workflowName = projection.name;
  const jobs = projection.jobs.map((job, index): AgentDelegationJob => ({
    jobId: createOpaqueId("job"),
    index,
    status: "planned",
    workflowName,
    agentName: job.agent.name,
    agentTitle: job.agent.title,
    agentPluginName: job.agent.pluginName,
    agentDescriptionFile: projectWorkspacePath(job.agent.descriptionFile, options.workspaceRoot),
    agentInstructionsFile: projectWorkspacePath(job.agent.instructionsFile, options.workspaceRoot),
    taskFile: projectWorkspacePath(job.taskFile, options.workspaceRoot),
    contextPack: job.contextPack.name,
    contextPackDescription: job.contextPack.description,
    contextTemplateFile: projectWorkspacePath(job.contextPack.templateFile, options.workspaceRoot),
    contextInputs: {
      item: job.contextPack.inputs,
    },
    toolScope: job.contextPack.toolScope,
    historyPolicy: job.contextPack.history,
    artifactPolicy: job.contextPack.artifacts,
    evidencePolicy: job.contextPack.evidence,
    recommendedTools: {
      item: job.agent.recommendedTools,
    },
    runtimeProfile: job.agent.runtimeProfile,
    outputSchema: projectWorkspacePath(job.agent.outputSchemaPath, options.workspaceRoot),
    required: job.required === true,
    suppliedEvidenceRefs: {
      item: [...(input.evidenceRefs ?? [])],
    },
    suppliedArtifactUris: {
      item: [...(input.artifactUris ?? [])],
    },
  }));

  return {
    workflow: {
      name: projection.name,
      title: projection.title,
      description: projection.description,
      pluginName: projection.pluginName,
    },
    objective: input.objective,
    execution: {
      mode: "plan",
      status: "readyForRuntime",
    },
    schedule: {
      strategy: projection.execution.strategy,
      maxConcurrency: projection.execution.maxConcurrency,
    },
    jobs: {
      item: jobs,
    },
    jobCount: jobs.length,
    mergePolicy: {
      name: projection.mergePolicy.name,
      description: projection.mergePolicy.description,
      strategy: projection.mergePolicy.strategy,
      templateFile: projectWorkspacePath(projection.mergePolicy.templateFile, options.workspaceRoot),
      outputSchema: projection.mergePolicy.outputSchemaPath
        ? projectWorkspacePath(projection.mergePolicy.outputSchemaPath, options.workspaceRoot)
        : undefined,
    },
  };
}

export function normalizeAgentDelegationPlanForPrompt(
  plan: AgentDelegationPlan,
): AgentDelegationPlan {
  return {
    ...plan,
    workflow: {
      ...plan.workflow,
      title: plan.workflow.title ?? "",
      description: plan.workflow.description ?? "",
    },
    mergePolicy: {
      ...plan.mergePolicy,
      description: plan.mergePolicy.description ?? "",
      outputSchema: plan.mergePolicy.outputSchema ?? "",
    },
  };
}

export function normalizeAgentDelegationJobForPrompt(
  job: AgentDelegationJob,
): AgentDelegationJob {
  return {
    ...job,
    agentTitle: job.agentTitle ?? "",
    contextPackDescription: job.contextPackDescription ?? "",
    evidencePolicy: job.evidencePolicy ?? "",
  };
}

function requireDelegationRegistry(registry: AgentPluginRegistryLike): AgentDelegationRegistry {
  if (
    !registry.getAgent
    || !registry.getAgentContextPack
    || !registry.getAgentMergePolicy
    || !registry.getAgentWorkflow
  ) {
    throw new Error("Agent delegation 需要 workflow registry 能力。");
  }

  return {
    getAgent: registry.getAgent.bind(registry),
    getAgentContextPack: registry.getAgentContextPack.bind(registry),
    getAgentMergePolicy: registry.getAgentMergePolicy.bind(registry),
    getAgentWorkflow: registry.getAgentWorkflow.bind(registry),
  };
}

function projectWorkspacePath(filePath: string, workspaceRoot: string): string {
  return toWorkspaceRelativePath(workspaceRoot, filePath);
}
