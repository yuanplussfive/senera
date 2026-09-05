import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { resolveAgentTurnPromptProfile } from "./AgentTurnPromptProfile.js";
import type { AgentSystemPromptLayer } from "../Orchestration/AgentRunDispatchPort.js";
import type { AgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { AgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import {
  normalizeAgentContinuityTemplateContext,
  normalizeAgentWorkflowTemplateContext,
} from "../Prompt/AgentPromptTemplateContextNormalizer.js";
import type { AgentWorkflowPromptContext } from "../Prompt/AgentWorkflowPromptContext.js";
import { composeAgentPromptHarness, type AgentPromptHarnessComposition } from "../Prompt/AgentPromptHarness.js";
import { compileAgentSceneContext } from "../Prompt/AgentSceneContextCompiler.js";

export interface AgentRenderedTurnPrompt {
  text: string;
  systemPrompt: string;
  turnContext: string;
  tokenCount: number;
  roleplayPreset: AgentRoleplayPresetContext;
  continuityMemory: AgentContinuityMemoryPromptContext;
  workflow: AgentWorkflowPromptContext;
  harness: AgentPromptHarnessComposition;
}

export interface AgentDelegatedRolePromptContext {
  readonly enabled: boolean;
  readonly mode: AgentSystemPromptLayer["mode"];
  readonly content: string;
}

export function projectAgentDelegatedRolePromptContext(
  layer?: AgentSystemPromptLayer,
): AgentDelegatedRolePromptContext {
  return layer
    ? { enabled: true, mode: layer.mode, content: layer.content }
    : { enabled: false, mode: "append", content: "" };
}

export class AgentTurnPromptRenderer {
  constructor(private readonly runtime: AgentSystemRuntime) {}

  async render(input: {
    userInput: string;
    sessionId?: string;
    requestId?: string;
    loadedToolNames: string[];
    rootCommand: AgentRootCommand;
    toolPlanningMode: AgentModelToolPlanningMode;
    systemPromptLayer?: AgentSystemPromptLayer;
  }): Promise<AgentRenderedTurnPrompt> {
    const profile = resolveAgentTurnPromptProfile(input.toolPlanningMode);
    const frozenTemplate = this.runtime.registry.getTemplate(profile.frozenTemplateName);
    const stableTemplate = this.runtime.registry.getTemplate(profile.stableTemplateName);
    const volatileTemplate = this.runtime.registry.getTemplate(profile.volatileTemplateName);
    if (!frozenTemplate) {
      throw new Error(`Agent frozen prompt template is not registered: ${profile.frozenTemplateName}.`);
    }
    if (!stableTemplate) {
      throw new Error(`Agent stable prompt template is not registered: ${profile.stableTemplateName}.`);
    }
    if (!volatileTemplate) {
      throw new Error(`Agent volatile prompt template is not registered: ${profile.volatileTemplateName}.`);
    }

    const toolDescription = this.runtime.config.ToolDocumentation?.ToolDescription;
    const roleplayPreset = await this.runtime.services.promptContext.promptRoleplayPreset(input.userInput);
    const continuityMemory = normalizeAgentContinuityTemplateContext(
      await this.runtime.services.promptContext.promptContinuityMemory({
        userInput: input.userInput,
        sessionId: input.sessionId,
        requestId: input.requestId,
      }),
    );
    const workflow = normalizeAgentWorkflowTemplateContext(
      this.runtime.services.promptContext.promptWorkflow(input.sessionId),
    );
    const scene = compileAgentSceneContext({ world: workflow.world });
    const baseContext = this.runtime.services.promptContext.buildBaseContext({
      loadedToolNames: input.loadedToolNames,
      rootCommand: input.rootCommand,
      roleplayPreset,
      continuityMemory,
      workflow,
      scene,
      toolSections: {
        summary: toolDescription?.SummarySection,
        trigger: toolDescription?.TriggerSection,
        avoid: toolDescription?.AvoidSection,
      },
    });
    const delegatedRole = projectAgentDelegatedRolePromptContext(input.systemPromptLayer);
    const delegatedRoleRevision =
      delegatedRole.enabled && delegatedRole.mode === "replace"
        ? sha256HexOfCanonicalJson(delegatedRole.content)
        : "append";
    const stableCacheKey = `${profile.stableTemplateName}:${baseContext.ContextRevisions.stable}:${delegatedRoleRevision}`;
    const frozenPrompt = await this.runtime.promptRenderer.renderFile(frozenTemplate.path, {});
    const stablePrompt = await this.runtime.promptTierRenderCache.getOrRender(stableCacheKey, () =>
      this.runtime.promptRenderer.renderFile(stableTemplate.path, { ...baseContext, DelegatedRole: delegatedRole }),
    );
    const volatilePrompt = await this.runtime.promptRenderer.renderFile(volatileTemplate.path, {
      ...baseContext,
      DelegatedRole: delegatedRole,
      RoleCheck: this.runtime.promptConfig.RoleCheck,
    });
    const harness = composeAgentPromptHarness(
      {
        frozen: { text: frozenPrompt, revision: "static" },
        stable: {
          text: stablePrompt,
          revision: sha256HexOfCanonicalJson({
            template: stableTemplate.path,
            contextRevisions: baseContext.ContextRevisions.stable,
            delegatedRoleRevision,
          }),
        },
        volatile: {
          text: volatilePrompt,
          revision: sha256HexOfCanonicalJson({
            template: volatileTemplate.path,
            contextRevisions: baseContext.ContextRevisions.volatile,
          }),
        },
      },
      { estimateTokens: (text) => this.runtime.tokenEstimator.estimate(text).tokenCount },
    );
    const text = harness.text;
    return {
      text,
      systemPrompt: joinPromptSections(frozenPrompt, stablePrompt),
      turnContext: volatilePrompt.trim(),
      tokenCount: this.runtime.tokenEstimator.estimate(text).tokenCount,
      roleplayPreset,
      continuityMemory,
      workflow,
      harness,
    };
  }
}

function joinPromptSections(...sections: readonly string[]): string {
  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n");
}
