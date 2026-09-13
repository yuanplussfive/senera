import type { Skill } from "@earendil-works/pi-agent-core";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentPiContextPolicyFrame } from "./AgentPiContextPolicy.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import type { AgentPiSelectedPromptTemplateFrame } from "./AgentPiPromptFrameProjector.js";
import type { AgentSkillLibraryCatalog } from "../Skills/AgentSkillLibraryCatalog.js";
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";
import {
  AgentPiPromptDisclosureLedger,
  type AgentPiPromptDisclosurePlan,
  type AgentPiPromptDisclosureState,
} from "./AgentPiPromptDisclosure.js";

export interface AgentPiCodingAgentSessionFrame {
  sessionId?: string;
  /** Stable logical cache affinity; independent from the physical Pi file. */
  logicalCacheScope?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  diagnostics?: AgentPiDiagnosticSink;
  systemPrompt?: string;
  turnContext?: string;
  turnState?: AgentPiTurnState;
  activeSkills?: readonly AgentActivatedSkill[];
  roleplayPresetActive?: boolean;
  /** Explicit UI-controlled preface rewrite; independent from roleplay presets. */
  prefaceRewriteEnabled?: boolean;
  skillCatalogFingerprint: string;
  /** Stable model-facing Skill directory; package bodies remain on demand. */
  skillLibraryCatalog?: AgentSkillLibraryCatalog;
  nativeProviderToolNames: readonly string[];
  rootCommand?: AgentRootCommand;
  toolAccessGrant: AgentToolAccessGrant;
  toolExposure: AgentToolExposureState;
  selectedPromptTemplates: readonly AgentPiSelectedPromptTemplateFrame[];
  contextPolicy?: AgentPiContextPolicyFrame;
  tokenBudget?: AgentTurnTokenBudget;
  signal?: AbortSignal;
  preflight(event: {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }): Promise<{ block?: boolean; reason?: string } | undefined>;
}

export class AgentPiMutableSessionFrame {
  private value: AgentPiCodingAgentSessionFrame;
  private skills: readonly Skill[] = [];
  private readonly promptDisclosure = new AgentPiPromptDisclosureLedger();

  constructor(value: AgentPiCodingAgentSessionFrame) {
    this.value = { ...value };
  }

  update(value: AgentPiCodingAgentSessionFrame, skills: readonly Skill[]): void {
    if (this.value.sessionId !== value.sessionId) this.promptDisclosure.reset();
    this.value = { ...value };
    this.skills = [...skills];
  }

  snapshot(): AgentPiCodingAgentSessionFrame {
    return { ...this.value };
  }

  skillSnapshot(): readonly Skill[] {
    return this.skills;
  }

  promptDisclosurePlan(): AgentPiPromptDisclosurePlan {
    const snapshot = this.snapshot();
    return this.promptDisclosure.plan({
      skills: this.skills,
      selectedPromptTemplates: snapshot.selectedPromptTemplates,
    });
  }

  commitPromptDisclosure(plan: AgentPiPromptDisclosurePlan): void {
    this.promptDisclosure.commit(plan);
  }

  restorePromptDisclosure(state: AgentPiPromptDisclosureState): void {
    this.promptDisclosure.restore(state);
  }

  promptDisclosureState(): AgentPiPromptDisclosureState {
    return this.promptDisclosure.state();
  }

  resetPromptDisclosure(): void {
    this.promptDisclosure.reset();
  }
}

export function projectAgentPiToolContext(frame: AgentPiCodingAgentSessionFrame): AgentPiToolProjectionContext {
  return {
    sessionId: frame.sessionId,
    requestId: frame.requestId,
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
