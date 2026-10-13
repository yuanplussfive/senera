import type { Skill } from "@earendil-works/pi-agent-core";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentToolEventOrigin } from "../ToolRuntime/AgentToolEventOrigin.js";
import type { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentPiContextPolicyFrame } from "./AgentPiContextPolicy.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import type { AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import type { AgentSkillLibraryCatalog } from "../Skills/AgentSkillLibraryCatalog.js";
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";
import type { AgentPiSkillCatalog } from "./AgentPiSkillCatalog.js";
import type { Context } from "@earendil-works/pi-ai";

export type AgentPiModelInputPreparer = (context: Context) => Promise<Context>;

export interface AgentPiCodingAgentSessionFrame {
  sessionId?: string;
  /** Stable logical cache affinity; independent from the physical Pi file. */
  logicalCacheScope?: string;
  requestId?: string;
  interaction?: AgentInteractionContext;
  step?: number;
  onEvent?: AgentEventSink;
  diagnostics?: AgentPiDiagnosticSink;
  systemPrompt?: string;
  /** Frozen host context persisted with the user message for this turn. */
  turnContext?: string;
  turnState?: AgentPiTurnState;
  activeSkills?: readonly AgentActivatedSkill[];
  personaActive?: boolean;
  /** Explicit UI-controlled preface rewrite; independent from persona text. */
  prefaceRewriteEnabled?: boolean;
  /** Explicit UI-controlled final-answer rewrite; independent from persona text. */
  finalResponseRewriteEnabled?: boolean;
  skillCatalog: AgentPiSkillCatalog;
  /** Stable model-facing Skill directory; package bodies remain on demand. */
  skillLibraryCatalog?: AgentSkillLibraryCatalog;
  nativeProviderToolNames: readonly string[];
  /** Resolves registered package provenance without frontend name mappings. */
  toolOriginLookup?: (toolName: string) => AgentToolEventOrigin | undefined;
  /** Resolves the registered tool's declarative workspace write capability. */
  toolWorkspaceWritableLookup?: (toolName: string) => boolean;
  rootCommand?: AgentRootCommand;
  toolAccessGrant: AgentToolAccessGrant;
  toolExposure: AgentToolExposureState;
  selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
  contextPolicy?: AgentPiContextPolicyFrame;
  tokenBudget?: AgentTurnTokenBudget;
  signal?: AbortSignal;
  /**
   * Gives the runtime one last chance to apply a ready Pi compaction
   * projection before a provider request is validated and sent.
   */
  prepareModelInput?: AgentPiModelInputPreparer;
  preflight(event: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }): Promise<{ block?: boolean; reason?: string } | undefined>;
}

export class AgentPiMutableSessionFrame {
  private value: AgentPiCodingAgentSessionFrame;
  private skills: readonly Skill[] = [];
  private modelInputPreparer: AgentPiModelInputPreparer | undefined;
  private updateRevision = 0;

  constructor(value: AgentPiCodingAgentSessionFrame) {
    this.value = { ...value };
    this.modelInputPreparer = value.prepareModelInput;
  }

  update(value: AgentPiCodingAgentSessionFrame, skills: readonly Skill[]): void {
    this.value = { ...value };
    if (value.prepareModelInput !== undefined) this.modelInputPreparer = value.prepareModelInput;
    this.skills = [...skills];
    this.updateRevision += 1;
  }

  snapshot(): AgentPiCodingAgentSessionFrame {
    return {
      ...this.value,
      ...(this.modelInputPreparer ? { prepareModelInput: this.modelInputPreparer } : {}),
    };
  }

  setModelInputPreparer(preparer: AgentPiModelInputPreparer | undefined): void {
    this.modelInputPreparer = preparer;
  }

  skillSnapshot(): readonly Skill[] {
    return this.skills;
  }

  /** Changes only when a leased turn replaces the current host frame. */
  revision(): number {
    return this.updateRevision;
  }
}

export function projectAgentPiToolContext(frame: AgentPiCodingAgentSessionFrame): AgentPiToolProjectionContext {
  return {
    sessionId: frame.sessionId,
    requestId: frame.requestId,
    interaction: frame.interaction,
    step: frame.step,
    onEvent: frame.onEvent,
    turnState: frame.turnState,
    activeSkills: frame.activeSkills,
    rootCommand: frame.rootCommand,
    approvalMode: frame.turnState?.context.approvalMode,
    toolAccessGrant: frame.toolAccessGrant,
    toolExposure: frame.toolExposure,
    visibleToolNames: frame.toolExposure.snapshot().exposedToolNames,
    tokenBudget: frame.tokenBudget,
    thinkingLevel: frame.turnState?.context.thinkingLevel,
    reusableCapabilities: frame.turnState?.context.reusableCapabilities,
    reusableCapabilityLookup: frame.turnState?.context.reusableCapabilityLookup,
    signal: frame.signal,
  };
}

export function agentPiDiagnosticContext(frame: AgentPiCodingAgentSessionFrame) {
  return {
    sessionId: frame.sessionId,
    requestId: frame.requestId ?? "pi-coding-agent",
    step: frame.step ?? 0,
  };
}
