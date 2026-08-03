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
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";

export interface AgentPiCodingAgentSessionFrame {
  sessionId?: string;
  requestId?: string;
  step?: number;
  onEvent?: AgentEventSink;
  diagnostics?: AgentPiDiagnosticSink;
  systemPrompt?: string;
  piTurnContextId?: string;
  activeSkills?: readonly AgentActivatedSkill[];
  skillCatalogFingerprint: string;
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

  constructor(value: AgentPiCodingAgentSessionFrame) {
    this.value = { ...value };
  }

  update(value: AgentPiCodingAgentSessionFrame, skills: readonly Skill[]): void {
    this.value = { ...value };
    this.skills = [...skills];
  }

  snapshot(): AgentPiCodingAgentSessionFrame {
    return { ...this.value };
  }

  skillSnapshot(): readonly Skill[] {
    return this.skills;
  }
}

export function projectAgentPiToolContext(frame: AgentPiCodingAgentSessionFrame): AgentPiToolProjectionContext {
  return {
    sessionId: frame.sessionId,
    requestId: frame.requestId,
    step: frame.step,
    onEvent: frame.onEvent,
    piTurnContextId: frame.piTurnContextId,
    activeSkills: frame.activeSkills,
    rootCommand: frame.rootCommand,
    toolAccessGrant: frame.toolAccessGrant,
    toolExposure: frame.toolExposure,
    visibleToolNames: frame.toolExposure.snapshot().exposedToolNames,
    tokenBudget: frame.tokenBudget,
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
