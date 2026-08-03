import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentActivatedSkill } from "../Skills/AgentSkillActivation.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";

export interface AgentPiTurnRequest {
  sessionId?: string;
  requestId: string;
  step: number;
  input: string;
  prompt: string;
  conversationEntries: AgentConversationEntry[];
  rootCommand: AgentRootCommand;
  toolAccessGrant: AgentToolAccessGrant;
  loadedToolNames: string[];
  activeSkills: AgentActivatedSkill[];
  onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
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
