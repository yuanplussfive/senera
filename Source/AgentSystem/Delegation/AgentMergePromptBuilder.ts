import fs from "node:fs";
import path from "node:path";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import { AgentPromptRenderer } from "../Prompt/AgentPromptRenderer.js";
import { assertInsideRoot } from "../Artifacts/AgentArtifactLocator.js";
import type { AgentChildAgentRunResult } from "./AgentChildAgentRuntime.js";
import {
  normalizeAgentDelegationPlanForPrompt,
  type AgentDelegationPlan,
} from "./AgentDelegationPlan.js";

export interface AgentMergePromptBuilderInput {
  parent: {
    requestId: string;
    step?: number;
  };
  plan: AgentDelegationPlan;
  childResults: readonly AgentChildAgentRunResult[];
}

export interface AgentMergePrompt {
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
  files: AgentMergePromptFiles;
}

export interface AgentMergePromptFiles {
  systemTemplateFile: string;
  mergeTemplateFile: string;
  outputSchemaFile: string;
}

export class AgentMergePromptBuilder {
  constructor(
    private readonly options: {
      workspaceRoot: string;
      systemTemplateFile: string;
      renderer?: AgentPromptRenderer;
    },
  ) {}

  build(input: AgentMergePromptBuilderInput): AgentMergePrompt {
    const files = this.resolveFiles(input.plan);
    const outputSchemaText = fs.readFileSync(files.outputSchemaFile, "utf8");
    const plan = normalizeAgentDelegationPlanForPrompt(input.plan);
    const scope = {
      Parent: input.parent,
      Plan: plan,
      MergePolicy: plan.mergePolicy,
      ChildResults: input.childResults.map((child) => ({
        jobId: child.jobId,
        workflowName: child.workflowName,
        agentName: child.agentName,
        status: child.status,
        text: child.text,
      })),
      OutputSchema: {
        text: outputSchemaText,
      },
    };

    return {
      systemPrompt: this.renderer().renderFileSync(files.systemTemplateFile, scope),
      messages: [
        {
          role: "user",
          content: this.renderer().renderFileSync(files.mergeTemplateFile, scope),
        },
      ],
      files,
    };
  }

  private resolveFiles(plan: AgentDelegationPlan): AgentMergePromptFiles {
    if (!plan.mergePolicy.outputSchema) {
      throw new Error(`MergePolicy ${plan.mergePolicy.name} 缺少 OutputSchema。`);
    }

    return {
      systemTemplateFile: this.resolveWorkspaceFile(this.options.systemTemplateFile),
      mergeTemplateFile: this.resolveWorkspaceFile(plan.mergePolicy.templateFile),
      outputSchemaFile: this.resolveWorkspaceFile(plan.mergePolicy.outputSchema),
    };
  }

  private resolveWorkspaceFile(filePath: string): string {
    return assertInsideRoot(
      this.options.workspaceRoot,
      path.resolve(this.options.workspaceRoot, filePath),
      `Merge prompt 文件超出工作区：${filePath}`,
    );
  }

  private renderer(): AgentPromptRenderer {
    return this.options.renderer ?? new AgentPromptRenderer();
  }
}
