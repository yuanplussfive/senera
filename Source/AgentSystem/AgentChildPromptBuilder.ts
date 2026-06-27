import fs from "node:fs";
import path from "node:path";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import { AgentPromptRenderer } from "./AgentPromptRenderer.js";
import { assertInsideRoot } from "./Artifacts/AgentArtifactLocator.js";
import {
  AgentChildContextMaterializer,
  type AgentChildMaterializedContext,
  type AgentChildParentRunContext,
} from "./AgentChildContextMaterializer.js";
import type {
  AgentDelegationJob,
  AgentDelegationPlan,
} from "./AgentDelegationPlan.js";
import {
  normalizeAgentDelegationJobForPrompt,
  normalizeAgentDelegationPlanForPrompt,
} from "./AgentDelegationPlan.js";

export interface AgentChildPromptBuilderInput {
  parent: AgentChildParentRunContext;
  plan: AgentDelegationPlan;
  job: AgentDelegationJob;
  latestUserRequest: string;
  evidenceUris?: readonly string[];
  artifactUris?: readonly string[];
}

export interface AgentChildPrompt {
  systemPrompt: string;
  messages: AgentLanguageModelMessage[];
  materializedContext: AgentChildMaterializedContext;
  files: AgentChildPromptFiles;
}

export interface AgentChildPromptFiles {
  systemTemplateFile: string;
  contextTemplateFile: string;
  agentDescriptionFile: string;
  agentInstructionsFile: string;
  taskFile: string;
  outputSchemaFile: string;
}

export class AgentChildPromptBuilder {
  private readonly contextMaterializer: AgentChildContextMaterializer;

  constructor(
    private readonly options: {
      workspaceRoot: string;
      systemTemplateFile: string;
      renderer?: AgentPromptRenderer;
    },
  ) {
    this.contextMaterializer = new AgentChildContextMaterializer(
      options.workspaceRoot,
      options.renderer,
    );
  }

  build(input: AgentChildPromptBuilderInput): AgentChildPrompt {
    const materializedContext = this.contextMaterializer.materialize(input);
    const files = this.resolveFiles(input.job, materializedContext);
    const systemPrompt = this.renderer().renderFileSync(files.systemTemplateFile, {
      Parent: input.parent,
      Plan: normalizeAgentDelegationPlanForPrompt(input.plan),
      Job: normalizeAgentDelegationJobForPrompt(input.job),
      Agent: {
        description: fs.readFileSync(files.agentDescriptionFile, "utf8"),
        instructions: fs.readFileSync(files.agentInstructionsFile, "utf8"),
      },
      Task: {
        text: fs.readFileSync(files.taskFile, "utf8"),
      },
      OutputSchema: {
        text: fs.readFileSync(files.outputSchemaFile, "utf8"),
      },
    });

    return {
      systemPrompt,
      messages: [
        {
          role: "user",
          content: materializedContext.content,
        },
      ],
      materializedContext,
      files,
    };
  }

  private resolveFiles(
    job: AgentDelegationJob,
    materializedContext: AgentChildMaterializedContext,
  ): AgentChildPromptFiles {
    return {
      systemTemplateFile: this.resolveWorkspaceFile(this.options.systemTemplateFile),
      contextTemplateFile: materializedContext.templateFile,
      agentDescriptionFile: this.resolveWorkspaceFile(job.agentDescriptionFile),
      agentInstructionsFile: this.resolveWorkspaceFile(job.agentInstructionsFile),
      taskFile: this.resolveWorkspaceFile(job.taskFile),
      outputSchemaFile: this.resolveWorkspaceFile(job.outputSchema),
    };
  }

  private resolveWorkspaceFile(filePath: string): string {
    return assertInsideRoot(
      this.options.workspaceRoot,
      path.resolve(this.options.workspaceRoot, filePath),
      `子代理提示文件超出工作区：${filePath}`,
    );
  }

  private renderer(): AgentPromptRenderer {
    return this.options.renderer ?? new AgentPromptRenderer();
  }
}
