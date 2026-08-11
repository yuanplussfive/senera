import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { StepTrace } from "../Core/AgentStepTrace.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export interface AgentPiTurnRequest {
  sessionId?: string;
  requestId: string;
  step: number;
  input: string;
  prompt: string;
  conversationEntries: AgentConversationEntry[];
  rootCommand: AgentRootCommand;
  approvalMode: AgentExecutionApprovalMode;
  toolAccessGrant: AgentToolAccessGrant;
  loadedToolNames: string[];
  activeSkills: AgentActivatedSkill[];
  onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
  onFinalResponseAvailable?: (content: string) => void | Promise<void>;
  thinkingLevel?: ModelThinkingLevel;
  inheritProjectContext?: boolean;
}

export interface AgentPiTurnResult {
  requestId: string;
  step: number;
  responseText: string;
  modelProvider: AgentModelProviderMetadata;
  usage: AgentModelUsage;
  conversationEntries: AgentConversationEntry[];
  stepTraces: StepTrace[];
  executedTools: ExecutedToolCallResult[];
}
