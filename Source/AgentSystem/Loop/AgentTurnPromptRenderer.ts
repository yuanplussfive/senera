import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { resolveAgentTurnPromptProfile } from "./AgentTurnPromptProfile.js";
import type { AgentSystemPromptLayer } from "../Orchestration/AgentRunDispatchPort.js";
import type { AgentPersonaContext } from "../Prompt/AgentPersonaContext.js";
import type { AgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import { normalizeAgentWorkflowTemplateContext } from "../Prompt/AgentPromptTemplateContextNormalizer.js";
import type { AgentWorkflowPromptContext } from "../Prompt/AgentWorkflowPromptContext.js";
import { composeAgentPromptHarness, type AgentPromptHarnessComposition } from "../Prompt/AgentPromptHarness.js";
import {
  AgentPromptWireEncodings,
  renderAgentPromptWireBlocks,
  renderAgentLiveStateWire,
} from "../Prompt/AgentPromptContextWireRenderer.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";
import type { AgentEffectiveModelReceipt } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import { AgentStateCardSchemaVersion, type AgentStateCard } from "../StateCard/AgentStateCardTypes.js";
import { renderAgentWorkbenchContractIndex } from "../SelfService/AgentWorkbenchContract.js";
import { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import { resolveAgentPiCompactionWindow } from "../Pi/AgentPiCompactionSettings.js";

export interface AgentRenderedTurnPrompt {
  text: string;
  systemPrompt: string;
  /** Host context frozen into the durable Pi user message for this turn. */
  turnContext: string;
  tokenCount: number;
  persona: AgentPersonaContext;
  continuityMemory: AgentContinuityMemoryPromptContext;
  stateCard?: AgentStateCard;
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
    stateCard?: AgentStateCard;
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
    const persona = this.runtime.services.promptContext.promptPersona();
    const workflow = normalizeAgentWorkflowTemplateContext(
      this.runtime.services.promptContext.promptWorkflow(input.sessionId),
    );
    const wireRenderOptions = {
      estimateTokens: (text: string) => this.runtime.tokenEstimator.estimate(text).tokenCount,
    };
    const loadContinuityMemory = async (historicalTokenBudget: number) =>
      this.runtime.services.promptContext.liveContinuityMemory({
        sessionId: input.sessionId,
        userInput: input.stateCard?.standaloneRequest ?? input.userInput,
        requestId: input.requestId,
        historicalTokenBudget: {
          maxTokens: historicalTokenBudget,
          estimateTokens: wireRenderOptions.estimateTokens,
        },
      });
    let continuityMemory = await loadContinuityMemory(0);
    const stateCardWire = input.stateCard ? renderStateCardWire(input.stateCard, wireRenderOptions) : "";
    const frozenPrompt = joinPromptSections(
      await this.runtime.promptRenderer.renderFile(frozenTemplate.path, {}),
      renderAgentWorkbenchContractIndex(),
    );
    const delegatedRole = projectAgentDelegatedRolePromptContext(input.systemPromptLayer);
    const delegatedRoleRevision =
      delegatedRole.enabled && delegatedRole.mode === "replace"
        ? sha256HexOfCanonicalJson(delegatedRole.content)
        : "append";

    const projectContinuity = async (memory: AgentContinuityMemoryPromptContext) => {
      const liveStateWire = renderAgentLiveStateWire({ continuity: memory, workflow }, wireRenderOptions);
      const baseContext = this.runtime.services.promptContext.buildBaseContext({
        loadedToolNames: input.loadedToolNames,
        rootCommand: input.rootCommand,
        persona,
        continuityMemory: memory,
        workflow,
        toolSections: {
          summary: toolDescription?.SummarySection,
          trigger: toolDescription?.TriggerSection,
          avoid: toolDescription?.AvoidSection,
        },
      });
      const renderedVolatilePrompt = await this.runtime.promptRenderer.renderFile(volatileTemplate.path, {
        ...baseContext,
        DelegatedRole: delegatedRole,
        LiveStateWire: liveStateWire.text,
      });
      return { liveStateWire, baseContext, renderedVolatilePrompt };
    };
    let continuityProjection = await projectContinuity(continuityMemory);
    let { baseContext, liveStateWire } = continuityProjection;
    const reusableCapabilities = input.reusableCapabilities;
    const reusableCapabilityRevision = sha256HexOfCanonicalJson(
      reusableCapabilities.map((entry) => ({
        toolName: entry.toolName,
        contractDigest: entry.contractDigest ?? null,
        catalogRevision: entry.catalogRevision,
        arguments: entry.arguments ?? null,
      })),
    );
    const stableCacheKey = `${profile.stableTemplateName}:${baseContext.ContextRevisions.stable}:${delegatedRoleRevision}`;
    const stablePrompt = await this.runtime.promptTierRenderCache.getOrRender(stableCacheKey, () =>
      this.runtime.promptRenderer.renderFile(stableTemplate.path, {
        ...baseContext,
        DelegatedRole: delegatedRole,
      }),
    );
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
    let baseVolatilePrompt = joinPromptSections(
      continuityProjection.renderedVolatilePrompt,
      sessionSpacePrompt,
      turnIdentityPrompt,
      stateCardWire,
    );
    const providerConfig = this.runtime.modelProviderConfig;
    const contextWindowTokens = providerConfig?.ContextWindowTokens ?? Number.MAX_SAFE_INTEGER;
    const model = providerConfig?.Model ?? "unknown";
    const compactionWindow = resolveAgentPiCompactionWindow(contextWindowTokens);
    const renderCapabilities = (turnContext: string): string =>
      reusableCapabilities.length === 0
        ? ""
        : formatReusableCapabilities(reusableCapabilities, {
            estimateTokens: wireRenderOptions.estimateTokens,
            tokenBudget: resolveReusableCapabilityBudget({
              model,
              contextWindowTokens,
              inputCapacityTokens: compactionWindow.inputCapacityTokens,
              windowHeadroomTokens: compactionWindow.reserveTokens,
              systemPrompt: joinPromptSections(frozenPrompt, stablePrompt),
              turnContext,
              userInput: input.userInput,
            }),
          });
    let reusableCapabilityPrompt = renderCapabilities(baseVolatilePrompt);
    let volatilePrompt = joinPromptSections(baseVolatilePrompt, reusableCapabilityPrompt);
    let historicalTokenBudget = inspectTurnInput({
      budget: new AgentTurnTokenBudget({
        model,
        contextWindowTokens,
        inputCapacityTokens: compactionWindow.inputCapacityTokens,
        windowHeadroomTokens: compactionWindow.reserveTokens,
      }),
      systemPrompt: joinPromptSections(frozenPrompt, stablePrompt),
      turnContext: volatilePrompt,
      userInput: input.userInput,
    }).availableTokens;

    while (historicalTokenBudget > 0) {
      continuityMemory = await loadContinuityMemory(historicalTokenBudget);
      continuityProjection = await projectContinuity(continuityMemory);
      ({ baseContext, liveStateWire } = continuityProjection);
      baseVolatilePrompt = joinPromptSections(
        continuityProjection.renderedVolatilePrompt,
        sessionSpacePrompt,
        turnIdentityPrompt,
        stateCardWire,
      );
      reusableCapabilityPrompt = renderCapabilities(baseVolatilePrompt);
      volatilePrompt = joinPromptSections(baseVolatilePrompt, reusableCapabilityPrompt);
      const inspection = inspectTurnInput({
        budget: new AgentTurnTokenBudget({
          model,
          contextWindowTokens,
          inputCapacityTokens: compactionWindow.inputCapacityTokens,
          windowHeadroomTokens: compactionWindow.reserveTokens,
        }),
        systemPrompt: joinPromptSections(frozenPrompt, stablePrompt),
        turnContext: volatilePrompt,
        userInput: input.userInput,
      });
      if (inspection.fits) break;
      const nextBudget = Math.max(0, historicalTokenBudget - inspection.excessTokens);
      if (nextBudget === historicalTokenBudget) break;
      historicalTokenBudget = nextBudget;
    }
    if (
      historicalTokenBudget === 0 &&
      (continuityMemory.periodDigests.length > 0 || continuityMemory.eventCandidates.length > 0)
    ) {
      continuityMemory = await loadContinuityMemory(0);
      continuityProjection = await projectContinuity(continuityMemory);
      ({ baseContext, liveStateWire } = continuityProjection);
      baseVolatilePrompt = joinPromptSections(
        continuityProjection.renderedVolatilePrompt,
        sessionSpacePrompt,
        turnIdentityPrompt,
        stateCardWire,
      );
      reusableCapabilityPrompt = renderCapabilities(baseVolatilePrompt);
      volatilePrompt = joinPromptSections(baseVolatilePrompt, reusableCapabilityPrompt);
    }
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
            reusableCapabilityRevision,
            turnIdentityRevision,
            liveState: {
              sourceRevision: liveStateWire.sourceRevision,
              blocks: liveStateWire.blocks.map((block) => ({ id: block.id, encoding: block.encoding })),
              stateCard: input.stateCard
                ? {
                    topicRelation: input.stateCard.topicRelation,
                    standaloneRequest: input.stateCard.standaloneRequest,
                  }
                : null,
            },
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
      persona,
      continuityMemory,
      ...(input.stateCard ? { stateCard: input.stateCard } : {}),
      workflow,
      harness,
    };
  }
}

function renderStateCardWire(
  card: AgentStateCard,
  options: { readonly estimateTokens: (text: string) => number },
): string {
  return renderAgentPromptWireBlocks(
    {
      preamble: [
        AgentStateCardSchemaVersion,
        "provenance=host;scope=current-turn",
        "rule=use-topic-relation-before-retrieval",
      ],
      blocks: [
        {
          id: "state",
          value: {
            topicRelation: card.topicRelation,
            standaloneRequest: card.standaloneRequest,
            prevRequests: card.prevRequests,
            lastTools: card.lastTools,
            failedTools: card.failedTools,
            artifacts: card.artifacts,
            activeSkills: card.activeSkills,
          },
          allowedEncodings: [AgentPromptWireEncodings.Toon, AgentPromptWireEncodings.CompactJson],
        },
      ],
    },
    options,
  ).text;
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
  options: { readonly estimateTokens: (text: string) => number; readonly tokenBudget: number },
): string {
  if (entries.length === 0) return "";
  const selected: Array<{
    tool: string;
    contractDigest?: string;
    catalogRevision: string;
    arguments: Readonly<Record<string, unknown>>;
  }> = [];
  const tokenBudget = Math.max(0, Math.floor(options.tokenBudget));
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

function resolveReusableCapabilityBudget(input: {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly inputCapacityTokens: number;
  readonly windowHeadroomTokens: number;
  readonly systemPrompt: string;
  readonly turnContext: string;
  readonly userInput: string;
}): number {
  const budget = new AgentTurnTokenBudget({
    model: input.model,
    contextWindowTokens: input.contextWindowTokens,
    inputCapacityTokens: input.inputCapacityTokens,
    windowHeadroomTokens: input.windowHeadroomTokens,
  });
  const fixedInput = budget.inspectModelInput({
    systemPrompt: input.systemPrompt,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: joinPromptSections(input.turnContext, input.userInput) }],
        timestamp: 0,
      },
    ],
  });
  return fixedInput.availableTokens;
}

function inspectTurnInput(input: {
  readonly budget: AgentTurnTokenBudget;
  readonly systemPrompt: string;
  readonly turnContext: string;
  readonly userInput: string;
}) {
  return input.budget.inspectModelInput({
    systemPrompt: input.systemPrompt,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: joinPromptSections(input.turnContext, input.userInput) }],
        timestamp: 0,
      },
    ],
  });
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
