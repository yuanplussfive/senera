import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import { resolveAgentPiCompactionWindow } from "../Pi/AgentPiCompactionSettings.js";
import {
  AgentModelInputBudgetError,
  type AgentModelInputInspection,
  AgentTurnTokenBudget,
} from "../Text/AgentTurnTokenBudget.js";
import {
  projectAgentResidentSpeechBamlInput,
  projectAgentResidentSpeechNativeContinuation,
  replaceAgentResidentSpeechDraft,
} from "./AgentResidentSpeechPromptProjector.js";
import { AgentResidentSpeechSessionLedger } from "./AgentResidentSpeechSessionLedger.js";
import { AgentResidentSpeechBamlClient } from "./AgentResidentSpeechBamlClient.js";
import { AgentResidentSpeechNativeClient } from "./AgentResidentSpeechNativeClient.js";
import {
  assertAgentResidentSpeechContract,
  parseAgentResidentSpeechNativeResult,
  parseAgentResidentSpeechResult,
} from "./AgentResidentSpeechResult.js";
import {
  AgentResidentActionSpeechCapability,
  AgentResidentFinalSpeechCapability,
  type AgentResidentSpeechFocus,
  type AgentResidentSpeechMode,
  type AgentResidentSpeechProjectionInput,
  type AgentResidentSpeechSessionRuntime,
} from "./AgentResidentSpeechTypes.js";
import { AgentPiNativeToolBridgeName } from "../Pi/AgentPiNativeToolBridge.js";

export interface AgentResidentSpeechRuntimeOptions {
  readonly registry: AgentExtensionRegistry;
  readonly modelProvider: ResolvedAgentModelProviderConfig;
  readonly nativeClient?: Pick<AgentResidentSpeechNativeClient, "project">;
  readonly bamlClient?: Pick<AgentResidentSpeechBamlClient, "project">;
}

export class AgentResidentSpeechRuntime implements AgentResidentSpeechSessionRuntime {
  private readonly contracts;
  private readonly nativeClient;
  private readonly bamlClient;
  private readonly inputBudget: AgentTurnTokenBudget;
  private readonly bamlSessions: Readonly<Record<AgentResidentSpeechMode, AgentResidentSpeechSessionLedger>> = {
    action_preface: new AgentResidentSpeechSessionLedger(),
    final_response: new AgentResidentSpeechSessionLedger(),
  };

  constructor(private readonly options: AgentResidentSpeechRuntimeOptions) {
    const action = requireResidentSpeechContract(options.registry, AgentResidentActionSpeechCapability);
    const final = requireResidentSpeechContract(options.registry, AgentResidentFinalSpeechCapability);
    this.contracts = { action_preface: action, final_response: final };
    const compactionWindow = resolveAgentPiCompactionWindow(options.modelProvider.ContextWindowTokens);
    this.inputBudget = new AgentTurnTokenBudget({
      model: options.modelProvider.Model,
      contextWindowTokens: compactionWindow.contextWindowTokens,
      inputCapacityTokens: compactionWindow.inputCapacityTokens,
      windowHeadroomTokens: compactionWindow.reserveTokens,
    });
    this.nativeClient = options.nativeClient ?? new AgentResidentSpeechNativeClient(options.modelProvider);
    this.bamlClient = options.bamlClient ?? new AgentResidentSpeechBamlClient(options.modelProvider);
  }

  async project(input: AgentResidentSpeechProjectionInput) {
    if (!input.enabled) return input.message;
    const focus = input.focus;
    const contract = this.contracts[focus.mode];

    if (this.options.modelProvider.ToolPlanningMode !== "baml") {
      return this.projectNative(input, focus, contract);
    }

    return this.bamlSessions[focus.mode].transact(
      {
        sessionId: input.sessionId,
        context: input.context,
        message: input.message,
        contract,
        model: this.options.modelProvider.Model,
        inspect: (context) => this.inputBudget.inspectModelInput(projectAgentResidentSpeechBamlInput(context)),
        focus,
        spokenUtterances: input.spokenUtterances,
        projectionTier: input.projectionTier,
        signal: input.signal,
      },
      async (context) => {
        const prompt = projectAgentResidentSpeechBamlInput(context);
        assertResidentSpeechInputFits(this.inputBudget.inspectModelInput(prompt));
        const raw = await this.bamlClient.project({
          prompt,
          sessionId: input.sessionId,
          logicalCacheScope: input.logicalCacheScope,
          mode: focus.mode,
          signal: input.signal,
          usageSink: input.usageSink,
          timingSink: input.timingSink,
        });
        const result = parseAgentResidentSpeechResult(raw, contract.name);
        return {
          value: replaceAgentResidentSpeechDraft(input.message, result.utterance),
          utterance: result.utterance,
        };
      },
    );
  }

  resetSession(sessionId: string): void {
    for (const ledger of Object.values(this.bamlSessions)) ledger.resetSession(sessionId);
  }

  close(): void {
    for (const ledger of Object.values(this.bamlSessions)) ledger.close();
  }

  private async projectNative(
    input: AgentResidentSpeechProjectionInput,
    focus: AgentResidentSpeechFocus,
    contract: ReturnType<typeof requireResidentSpeechContract>,
  ) {
    if (!input.nativeContinuation) {
      throw new Error("Resident speech native projection requires the owning native request continuation.");
    }
    const continuationInput = {
      context: input.context,
      contract,
      focus,
      spokenUtterances: input.spokenUtterances,
      projectionTier: input.projectionTier,
      bridgeName: AgentPiNativeToolBridgeName,
      timestamp: input.message.timestamp,
    } as const;
    const context = fitResidentSpeechNativeContinuation(
      continuationInput,
      this.inputBudget,
      this.options.modelProvider.Model,
    );
    assertResidentSpeechInputFits(this.inputBudget.inspectModelInput(context));
    const raw = await this.nativeClient.project({
      context,
      continuation: input.nativeContinuation,
      signal: input.signal,
      sessionId: input.sessionId,
      validate: (value) => {
        parseAgentResidentSpeechNativeResult(value, contract);
      },
      usageSink: input.usageSink,
      timingSink: input.timingSink,
    });
    const result = parseAgentResidentSpeechNativeResult(raw, contract);
    return replaceAgentResidentSpeechDraft(input.message, result.utterance);
  }
}

function requireResidentSpeechContract(registry: AgentExtensionRegistry, capability: string) {
  const contract = registry.getSidecarTool(capability);
  if (!contract) throw new Error(`Required sidecar capability is not registered: ${capability}.`);
  assertAgentResidentSpeechContract(contract);
  return contract;
}

function assertResidentSpeechInputFits(inspection: AgentModelInputInspection): void {
  if (inspection.fits) return;
  throw new AgentModelInputBudgetError(inspection);
}

function fitResidentSpeechNativeContinuation(
  input: Parameters<typeof projectAgentResidentSpeechNativeContinuation>[0],
  budget: AgentTurnTokenBudget,
  model: string,
): ReturnType<typeof projectAgentResidentSpeechNativeContinuation> {
  const full = projectAgentResidentSpeechNativeContinuation(input);
  const fullInspection = budget.inspectModelInput(full);
  if (fullInspection.fits) return full;

  const base = {
    ...full,
    messages: [...input.context.messages],
  } satisfies ReturnType<typeof projectAgentResidentSpeechNativeContinuation>;
  const baseInspection = budget.inspectModelInput(base);
  if (!baseInspection.fits) throw new AgentModelInputBudgetError(baseInspection);

  const minimumCandidate = projectAgentResidentSpeechNativeContinuation({
    ...input,
    sceneProjection: { model, tokenLimit: 1 },
  });
  const minimumInspection = budget.inspectModelInput(minimumCandidate);
  if (!minimumInspection.fits) throw new AgentModelInputBudgetError(minimumInspection);

  let lower = 2;
  let upper = Math.max(1, fullInspection.capacityTokens - baseInspection.tokenCount);
  let best = minimumCandidate;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const candidate = projectAgentResidentSpeechNativeContinuation({
      ...input,
      sceneProjection: { model, tokenLimit: middle },
    });
    const candidateInspection = budget.inspectModelInput(candidate);
    if (candidateInspection.fits) {
      best = candidate;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return best;
}
