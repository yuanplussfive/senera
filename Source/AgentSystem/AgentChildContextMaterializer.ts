import path from "node:path";
import { AgentPromptRenderer } from "./Prompt/AgentPromptRenderer.js";
import { assertInsideRoot } from "./Artifacts/AgentArtifactLocator.js";
import type {
  AgentDelegationJob,
  AgentDelegationPlan,
} from "./AgentDelegationPlan.js";
import {
  normalizeAgentDelegationJobForPrompt,
  normalizeAgentDelegationPlanForPrompt,
} from "./AgentDelegationPlan.js";

export interface AgentChildContextMaterializerInput {
  parent: AgentChildParentRunContext;
  plan: AgentDelegationPlan;
  job: AgentDelegationJob;
  latestUserRequest: string;
  evidenceUris?: readonly string[];
  artifactUris?: readonly string[];
}

export interface AgentChildParentRunContext {
  requestId: string;
  step?: number;
}

export interface AgentChildMaterializedContext {
  templateFile: string;
  content: string;
}

export class AgentChildContextMaterializer {
  constructor(
    private readonly workspaceRoot: string,
    private readonly renderer = new AgentPromptRenderer(),
  ) {}

  materialize(input: AgentChildContextMaterializerInput): AgentChildMaterializedContext {
    const templateFile = this.resolveWorkspaceFile(input.job.contextTemplateFile);
    return {
      templateFile,
      content: this.renderer.renderFileSync(templateFile, this.createTemplateScope(input)),
    };
  }

  private createTemplateScope(input: AgentChildContextMaterializerInput): Record<string, unknown> {
    return {
      Parent: input.parent,
      Plan: normalizeAgentDelegationPlanForPrompt(input.plan),
      Job: normalizeAgentDelegationJobForPrompt(input.job),
      Objective: input.plan.objective ?? "",
      LatestUserRequest: input.latestUserRequest,
      EvidenceUris: [...(input.evidenceUris ?? input.job.suppliedEvidenceUris.item)],
      ArtifactUris: [...(input.artifactUris ?? input.job.suppliedArtifactUris.item)],
    };
  }

  private resolveWorkspaceFile(filePath: string): string {
    return assertInsideRoot(
      this.workspaceRoot,
      path.resolve(this.workspaceRoot, filePath),
      `子代理上下文模板超出工作区：${filePath}`,
    );
  }
}
