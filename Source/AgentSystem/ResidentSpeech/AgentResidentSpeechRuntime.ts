import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
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
  private readonly bamlSessions: Readonly<Record<AgentResidentSpeechMode, AgentResidentSpeechSessionLedger>> = {
    action_preface: new AgentResidentSpeechSessionLedger(),
    final_response: new AgentResidentSpeechSessionLedger(),
  };

  constructor(private readonly options: AgentResidentSpeechRuntimeOptions) {
    const action = requireResidentSpeechContract(options.registry, AgentResidentActionSpeechCapability);
    const final = requireResidentSpeechContract(options.registry, AgentResidentFinalSpeechCapability);
    this.contracts = { action_preface: action, final_response: final };
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
        focus,
        spokenUtterances: input.spokenUtterances,
        signal: input.signal,
      },
      async (context) => {
        const prompt = projectAgentResidentSpeechBamlInput(context);
        assertResidentSpeechInputFits(input.inputBudget?.inspectModelInput(prompt));
        const raw = await this.bamlClient.project({
          prompt,
          sessionId: input.sessionId,
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
    const context = projectAgentResidentSpeechNativeContinuation({
      context: input.context,
      contract,
      focus,
      spokenUtterances: input.spokenUtterances,
      bridgeName: AgentPiNativeToolBridgeName,
      timestamp: input.message.timestamp,
    });
    assertResidentSpeechInputFits(input.inputBudget?.inspectModelInput(context));
    const raw = await this.nativeClient.project({
      context,
      continuation: input.nativeContinuation,
      signal: input.signal,
      sessionId: input.sessionId,
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

function assertResidentSpeechInputFits(
  inspection:
    ReturnType<NonNullable<AgentResidentSpeechProjectionInput["inputBudget"]>["inspectModelInput"]> | undefined,
): void {
  if (!inspection || inspection.fits) return;
  throw new Error(
    `Resident speech input requires ${inspection.tokenCount} tokens but the model input capacity is ${inspection.capacityTokens}.`,
  );
}
