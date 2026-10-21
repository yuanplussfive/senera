import type { AgentState } from "@earendil-works/pi-agent-core";
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
import type { ImageContent, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentWorkspaceChangeObserverPort } from "../Artifacts/AgentWorkspaceChangeObserver.js";

export type AgentPiSessionEventListener = (event: AgentSessionEvent) => void | Promise<void>;

export interface AgentPiSessionOptions extends Omit<AgentPiToolProjectionContext, "tokenBudget"> {
  /** Stable cache affinity that survives physical session rotation. */
  logicalCacheScope?: string;
  input?: string;
  systemPrompt?: string;
  /** Frozen host context persisted with the user message for this turn. */
  turnContext?: string;
  interaction?: AgentInteractionContext;
  turnState?: AgentPiTurnState;
  activeSkills?: readonly AgentActivatedSkill[];
  personaActive?: boolean;
  prefaceRewriteEnabled?: boolean;
  /** Explicit UI-controlled final-answer rewrite; independent from persona text. */
  finalResponseRewriteEnabled?: boolean;
  rootCommand?: AgentRootCommand;
  diagnostics?: AgentPiDiagnosticSink;
  tokenBudget?: AgentTurnTokenBudget;
  thinkingLevel?: ModelThinkingLevel;
  inheritProjectContext?: boolean;
}

export interface AgentPiSession {
  readonly state: AgentState;
  readonly model: AgentState["model"];
  prompt(
    text: string,
    options?: { expandPromptTemplates?: boolean; source?: string; images?: readonly ImageContent[] },
  ): Promise<void>;
  /** Aligns the native continuation with the latest persisted Pi branch. */
  prepareContinuation(sourceRequestId?: string): void;
  /** Continues the prepared Pi transcript without appending a new user message. */
  continue(): Promise<void>;
  steer(text: string, images?: readonly ImageContent[]): Promise<void>;
  followUp(text: string, images?: readonly ImageContent[]): Promise<void>;
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
}

export interface AgentPiRuntimeService {
  readonly workspaceChangeObserver?: AgentWorkspaceChangeObserverPort;
  /** Resolves a registered tool's declarative workspace write capability. */
  toolWorkspaceWritableLookup?(toolName: string): boolean;
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
