import type { AgentMessage, AgentState } from "@earendil-works/pi-agent-core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentPiModelProjection, AgentPiToolDefinition, AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentPiDiagnosticSink } from "../PiShared/AgentPiDiagnosticsTypes.js";
import type { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";
import type {
  AgentPiSessionCompactionResult,
  AgentPiSessionExportFormat,
  AgentPiSessionExportResult,
  AgentPiSessionRuntimeStatus,
} from "./AgentPiSessionManagement.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export type AgentPiSessionEventListener = (event: AgentSessionEvent) => void | Promise<void>;

export interface AgentPiSessionOptions extends Omit<AgentPiToolProjectionContext, "tokenBudget"> {
  input?: string;
  systemPrompt?: string;
  turnState?: AgentPiTurnState;
  activeSkills?: readonly AgentActivatedSkill[];
  rootCommand?: AgentRootCommand;
  diagnostics?: AgentPiDiagnosticSink;
  tokenBudget?: AgentTurnTokenBudget;
  thinkingLevel?: ModelThinkingLevel;
  inheritProjectContext?: boolean;
}

export interface AgentPiSession {
  readonly state: AgentState;
  readonly model: AgentState["model"];
  setHistory(messages: readonly AgentMessage[]): Promise<void> | void;
  prompt(text: string, options?: { expandPromptTemplates?: boolean; source?: string }): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  requestFinalAnswer(instruction: string): Promise<boolean>;
  markTurnBoundary(requestId: string): Promise<string>;
  subscribe(listener: AgentPiSessionEventListener): () => void;
  abort(): Promise<void>;
  dispose(): void;
  getLastAssistantText(): string | undefined;
  getActiveToolNames(): string[];
}

export interface AgentPiSessionResult {
  session: AgentPiSession;
  piSessionId?: string;
  historyMigrationRequired?: boolean;
}

export interface AgentPiRuntimeService {
  model(): AgentPiModelProjection;
  toolDefinitions(context?: AgentPiToolProjectionContext): AgentPiToolDefinition[];
  activeToolNames(context?: AgentPiToolProjectionContext): string[];
  leaseTurn(options: AgentPiSessionOptions): Promise<AgentPiSessionResult>;
  rewindSession(sessionId: string, entryId: string): Promise<boolean>;
  forkSession(sourceSessionId: string, targetSessionId: string, entryId: string): Promise<boolean>;
  resetSession(sessionId: string): Promise<boolean>;
  compactSession(sessionId: string, customInstructions?: string): Promise<AgentPiSessionCompactionResult | undefined>;
  sessionStatus(sessionId: string): Promise<AgentPiSessionRuntimeStatus | undefined>;
  exportSession(sessionId: string, format: AgentPiSessionExportFormat): Promise<AgentPiSessionExportResult | undefined>;
}
