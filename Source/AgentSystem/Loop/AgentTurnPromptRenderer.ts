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
import {
  AgentPromptWireEncodings,
  renderAgentPromptWireBlocks,
  renderAgentPromptContextWires,
} from "../Prompt/AgentPromptContextWireRenderer.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";
import type { AgentEffectiveModelReceipt } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import { renderAgentWorkbenchContractIndex } from "../SelfService/AgentWorkbenchContract.js";

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
    logicalCacheScope?: string;
    effectiveModel?: AgentEffectiveModelReceipt;
    turnNumber?: number;
    interaction?: AgentInteractionContext;
    loadedToolNames: string[];
    reusableCapabilities: readonly AgentToolCapabilityCacheEntry[];
    authorizedToolNames?: readonly string[];
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
    const wireRenderOptions = {
      estimateTokens: (text: string) => this.runtime.tokenEstimator.estimate(text).tokenCount,
    };
    const contextWires = renderAgentPromptContextWires(
      {
        scene,
        continuity: continuityMemory,
        workflow,
      },
      wireRenderOptions,
    );
    // Keep the named template adapters on the same canonical projection as
    // the merged volatile block. Some integrations render these templates
    // independently, so leaving their wire variables unset would silently
    // reintroduce the old field-by-field path.
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
    const reusableCapabilities = input.reusableCapabilities;
    const reusableCapabilityPrompt = formatReusableCapabilities(reusableCapabilities, {
      estimateTokens: (text) => this.runtime.tokenEstimator.estimate(text).tokenCount,
      contextWindowTokens: this.runtime.modelProviderConfig?.ContextWindowTokens,
    });
    const reusableCapabilityRevision = sha256HexOfCanonicalJson(
      reusableCapabilities.map((entry) => ({
        toolName: entry.toolName,
        contractDigest: entry.contractDigest ?? null,
        catalogRevision: entry.catalogRevision,
        arguments: entry.arguments ?? null,
      })),
    );
    const delegatedRole = projectAgentDelegatedRolePromptContext(input.systemPromptLayer);
    const delegatedRoleRevision =
      delegatedRole.enabled && delegatedRole.mode === "replace"
        ? sha256HexOfCanonicalJson(delegatedRole.content)
        : "append";
    const stableCacheKey = `${profile.stableTemplateName}:${baseContext.ContextRevisions.stable}:${delegatedRoleRevision}`;
    const frozenPrompt = joinPromptSections(
      await this.runtime.promptRenderer.renderFile(frozenTemplate.path, {}),
      renderAgentWorkbenchContractIndex(),
    );
    const stablePrompt = await this.runtime.promptTierRenderCache.getOrRender(stableCacheKey, () =>
      this.runtime.promptRenderer.renderFile(stableTemplate.path, { ...baseContext, DelegatedRole: delegatedRole }),
    );
    const renderedVolatilePrompt = await this.runtime.promptRenderer.renderFile(volatileTemplate.path, {
      ...baseContext,
      DelegatedRole: delegatedRole,
      RoleCheck: this.runtime.promptConfig.RoleCheck,
      VolatileWire: contextWires.volatile.text,
      SceneWire: contextWires.scene.text,
      ContinuityWire: contextWires.continuity.text,
      ContinuityFactsWire: contextWires.continuityFacts.text,
      ResidentProfileWire: contextWires.residentProfile.text,
      WorkflowWire: contextWires.workflow.text,
    });
    const sessionSpacePrompt = formatSessionSpaceIdentity({
      sessionId: input.sessionId,
      workspaceRoot: this.runtime.workspaceRoot,
    });
    const turnIdentityPrompt = formatTurnIdentity({
      turnNumber: input.turnNumber,
      interaction: input.interaction,
      requestId: input.requestId,
      effectiveModel: input.effectiveModel,
    });
    const stablePromptWithSpace = stablePrompt;
    const volatilePrompt = joinPromptSections(
      renderedVolatilePrompt,
      sessionSpacePrompt,
      turnIdentityPrompt,
      reusableCapabilityPrompt,
    );
    const turnIdentityRevision = sha256HexOfCanonicalJson({
      requestId: input.requestId ?? null,
      turnNumber: input.turnNumber ?? null,
      interaction: input.interaction ?? null,
      effectiveModel: input.effectiveModel ?? null,
    });
    const harness = composeAgentPromptHarness(
      {
        frozen: { text: frozenPrompt, revision: sha256HexOfCanonicalJson(frozenPrompt) },
        stable: {
          text: stablePromptWithSpace,
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
            reusableCapabilityRevision,
            turnIdentityRevision,
            volatileWire: {
              sourceRevision: contextWires.volatile.sourceRevision,
              blocks: contextWires.volatile.blocks.map((block) => ({ id: block.id, encoding: block.encoding })),
            },
          }),
        },
      },
      { estimateTokens: (text) => this.runtime.tokenEstimator.estimate(text).tokenCount },
    );
    const text = harness.text;
    return {
      text,
      systemPrompt: joinPromptSections(frozenPrompt, stablePromptWithSpace),
      turnContext: volatilePrompt.trim(),
      tokenCount: this.runtime.tokenEstimator.estimate(text).tokenCount,
      roleplayPreset,
      continuityMemory,
      workflow,
      harness,
    };
  }
}

function formatSessionSpaceIdentity(input: { readonly sessionId?: string; readonly workspaceRoot: string }): string {
  if (!input.sessionId) return "";
  return renderAgentPromptWireBlocks(
    {
      preamble: [
        "senera.conversation_space=v1",
        "provenance=host;scope=active-conversation",
        "rule=keep-this-space-distinct-from-global-defaults",
      ],
      blocks: [
        {
          id: "identity",
          value: { session: input.sessionId, workspace: input.workspaceRoot },
          allowedEncodings: [AgentPromptWireEncodings.CompactJson],
        },
      ],
    },
    { estimateTokens: (text) => text.length },
  ).text;
}

function formatTurnIdentity(input: {
  readonly requestId?: string;
  readonly turnNumber?: number;
  readonly interaction?: AgentInteractionContext;
  readonly effectiveModel?: AgentEffectiveModelReceipt;
}): string {
  if (!input.requestId && !input.effectiveModel) return "";
  const value = {
    request: input.requestId ?? input.effectiveModel?.requestId,
    ...(input.turnNumber === undefined ? {} : { turn: input.turnNumber }),
    surface: input.interaction?.surface ?? "console",
    ...(input.interaction?.platform ? { platform: input.interaction.platform } : {}),
    ...(input.interaction?.chatType ? { chatType: input.interaction.chatType } : {}),
    ...(input.interaction?.spaceId ? { spaceId: input.interaction.spaceId } : {}),
    ...(input.interaction?.profileId ? { profileId: input.interaction.profileId } : {}),
    ...(input.effectiveModel
      ? {
          effectiveModel: {
            providerId: input.effectiveModel.providerId,
            model: input.effectiveModel.model,
            endpoint: input.effectiveModel.endpoint,
            source: input.effectiveModel.source,
          },
        }
      : {}),
  };
  return renderAgentPromptWireBlocks(
    {
      preamble: [
        "senera.turn=v1",
        "provenance=host;authoritative-current-turn",
        "rule=do-not-infer-model-from-global-defaults",
      ],
      blocks: [
        {
          id: "identity",
          value,
          allowedEncodings: [AgentPromptWireEncodings.CompactJson],
        },
      ],
    },
    { estimateTokens: (text) => text.length },
  ).text;
}

function formatReusableCapabilities(
  entries: readonly AgentToolCapabilityCacheEntry[],
  options: { readonly estimateTokens: (text: string) => number; readonly contextWindowTokens?: number },
): string {
  if (entries.length === 0) return "";
  const selected: Array<{
    tool: string;
    contractDigest?: string;
    catalogRevision: string;
    arguments: Readonly<Record<string, unknown>>;
  }> = [];
  const tokenBudget =
    options.contextWindowTokens === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(256, Math.floor(options.contextWindowTokens * 0.02));
  for (const entry of entries) {
    if (!entry.arguments) continue;
    const candidate = {
      tool: entry.toolName,
      ...(entry.contractDigest ? { contractDigest: entry.contractDigest } : {}),
      catalogRevision: entry.catalogRevision,
      arguments: entry.arguments,
    };
    const next = renderReusableCapabilities([...selected, candidate]);
    if (options.estimateTokens(next) > tokenBudget) continue;
    selected.push(candidate);
  }
  if (selected.length === 0) return "";
  return renderReusableCapabilities(selected);
}

function renderReusableCapabilities(
  capabilities: readonly {
    readonly tool: string;
    readonly contractDigest?: string;
    readonly catalogRevision: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  }[],
): string {
  return renderAgentPromptWireBlocks(
    {
      preamble: [
        "senera.reusable_capabilities=v1",
        "provenance=host-confirmed",
        "rule=reuse-when-task-matches;search-again-only-after-contract-or-catalog-change",
      ],
      blocks: [
        {
          id: "capabilities",
          value: { capabilities },
          allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
        },
      ],
    },
    { estimateTokens: (text) => text.length },
  ).text;
}

function joinPromptSections(...sections: readonly string[]): string {
  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n");
}
