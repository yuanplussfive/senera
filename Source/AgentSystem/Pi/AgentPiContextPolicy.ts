import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentPiArtifactReference } from "./AgentPiArtifactIndex.js";
import { projectAgentPiArtifactReferences } from "./AgentPiArtifactIndex.js";
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import {
  AgentPiContextPolicyProtocol,
  AgentPiContextPolicyCustomType,
} from "../PiShared/AgentPiContextPolicyProtocol.js";

export {
  AgentPiContextPolicyProtocol,
  AgentPiContextPolicyCustomType,
} from "../PiShared/AgentPiContextPolicyProtocol.js";

export interface AgentPiContextPolicyBudget {
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
}

export interface AgentPiContextPolicyFrame {
  requestId?: string;
  model: string;
  createdAt: string;
  retrievalTools: AgentPiContextRetrievalTool[];
}

export interface AgentPiContextPolicyFrameInput {
  requestId?: string;
  model: string;
  registeredTools: readonly RegisteredTool[];
  visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"];
  createdAt?: string;
}

export interface AgentPiContextRetrievalTool {
  toolName: string;
  capability: string;
}

interface AgentPiContextPolicyEnvelope {
  type: typeof AgentPiContextPolicyProtocol.type;
  authority: "runtime_context";
  requestId?: string;
  instruction: string;
  evidence: [];
  artifacts: AgentPiContextArtifactItem[];
  retrievalTools: AgentPiContextRetrievalTool[];
  stats: {
    archivedArtifacts: number;
    alreadyVisibleArtifacts: number;
    includedArtifacts: number;
    omittedArtifacts: number;
    retrievalTools: number;
  };
}

interface AgentPiContextArtifactItem {
  artifactUri: string;
  toolNames: string[];
  refs: string[];
}

const RetrievalCapabilities = new Set<string>([
  AgentHostCapabilityNames.ArtifactMemoryRead,
  AgentHostCapabilityNames.MemoryRecall,
]);

const RuntimeInstruction = [
  "This message is a compact index of artifacts removed from the active Pi message history.",
  "Use an artifact retrieval tool with an exact artifactUri when archived content is required.",
  "Use memory retrieval to locate older omitted artifacts.",
  "Current tool results remain authoritative and are not duplicated here.",
].join(" ");

export class AgentPiContextPolicy {
  private readonly tokenProjector: AgentTokenProjector;

  constructor(private readonly model: string) {
    this.tokenProjector = new AgentTokenProjector(model);
  }

  createFrame(input: AgentPiContextPolicyFrameInput): AgentPiContextPolicyFrame {
    return {
      requestId: input.requestId,
      model: input.model,
      createdAt: input.createdAt ?? new Date().toISOString(),
      retrievalTools: projectRetrievalTools(input),
    };
  }

  apply(
    messages: readonly AgentMessage[],
    frame: AgentPiContextPolicyFrame,
    archivedArtifacts: readonly AgentPiArtifactReference[],
    budget: AgentPiContextPolicyBudget,
  ): AgentMessage[] {
    const baseMessages = messages.filter((message) => !isContextPolicyMessage(message));
    const activeArtifactUris = new Set(
      projectAgentPiArtifactReferences(baseMessages).map((reference) => reference.artifactUri),
    );
    const candidates = archivedArtifacts
      .filter((reference) => !activeArtifactUris.has(reference.artifactUri))
      .map(projectArchivedArtifact)
      .reverse();
    if (candidates.length === 0) return baseMessages;

    const tokenLimit = availableContextTokens(baseMessages, budget, this.tokenProjector);
    const message = selectContextPolicyMessage({
      frame,
      candidates,
      archivedArtifactCount: archivedArtifacts.length,
      alreadyVisibleArtifactCount: archivedArtifacts.length - candidates.length,
      tokenLimit,
      tokenProjector: this.tokenProjector,
    });
    return message ? [message, ...baseMessages] : baseMessages;
  }
}

export function applyAgentPiContextPolicy(
  messages: readonly AgentMessage[],
  frame: AgentPiContextPolicyFrame | undefined,
  archivedArtifacts: readonly AgentPiArtifactReference[],
  budget: AgentPiContextPolicyBudget,
): AgentMessage[] {
  return frame
    ? new AgentPiContextPolicy(frame.model).apply(messages, frame, archivedArtifacts, budget)
    : [...messages];
}

function selectContextPolicyMessage(input: {
  frame: AgentPiContextPolicyFrame;
  candidates: readonly AgentPiContextArtifactItem[];
  archivedArtifactCount: number;
  alreadyVisibleArtifactCount: number;
  tokenLimit: number;
  tokenProjector: AgentTokenProjector;
}): AgentMessage | undefined {
  let lower = 0;
  let upper = input.candidates.length;
  let selected: AgentMessage | undefined;

  while (lower <= upper) {
    const count = Math.floor((lower + upper) / 2);
    const message = createContextPolicyMessage(
      buildContextEnvelope({
        frame: input.frame,
        artifacts: input.candidates.slice(0, count),
        archivedArtifactCount: input.archivedArtifactCount,
        alreadyVisibleArtifactCount: input.alreadyVisibleArtifactCount,
        omittedArtifactCount: input.candidates.length - count,
      }),
      input.frame.createdAt,
    );
    if (input.tokenProjector.countJson(message) <= input.tokenLimit) {
      if (count > 0) selected = message;
      lower = count + 1;
    } else {
      upper = count - 1;
    }
  }

  return selected;
}

function buildContextEnvelope(input: {
  frame: AgentPiContextPolicyFrame;
  artifacts: readonly AgentPiContextArtifactItem[];
  archivedArtifactCount: number;
  alreadyVisibleArtifactCount: number;
  omittedArtifactCount: number;
}): AgentPiContextPolicyEnvelope {
  return {
    type: AgentPiContextPolicyProtocol.type,
    authority: "runtime_context",
    requestId: input.frame.requestId,
    instruction: RuntimeInstruction,
    evidence: [],
    artifacts: [...input.artifacts],
    retrievalTools: input.frame.retrievalTools,
    stats: {
      archivedArtifacts: input.archivedArtifactCount,
      alreadyVisibleArtifacts: input.alreadyVisibleArtifactCount,
      includedArtifacts: input.artifacts.length,
      omittedArtifacts: input.omittedArtifactCount,
      retrievalTools: input.frame.retrievalTools.length,
    },
  };
}

function createContextPolicyMessage(
  envelope: AgentPiContextPolicyEnvelope,
  createdAt: string,
): Extract<AgentMessage, { role: "custom" }> {
  return {
    role: "custom",
    customType: AgentPiContextPolicyCustomType,
    content: JSON.stringify(envelope),
    display: false,
    timestamp: Date.parse(createdAt) || Date.now(),
  };
}

function availableContextTokens(
  messages: readonly AgentMessage[],
  budget: AgentPiContextPolicyBudget,
  tokenProjector: AgentTokenProjector,
): number {
  const messageTokens = messages.reduce((total, message) => total + tokenProjector.countJson(message), 0);
  return Math.max(0, Math.floor(budget.contextWindowTokens) - Math.floor(budget.outputReserveTokens) - messageTokens);
}

function projectArchivedArtifact(reference: AgentPiArtifactReference): AgentPiContextArtifactItem {
  return {
    artifactUri: reference.artifactUri,
    toolNames: [...reference.toolNames],
    refs: [...reference.refs],
  };
}

function projectRetrievalTools(input: AgentPiContextPolicyFrameInput): AgentPiContextRetrievalTool[] {
  return input.registeredTools.flatMap((tool) => {
    if (!isVisibleTool(tool, input.visibleToolNames)) return [];
    if (tool.handler.kind !== "HostCapability" || !RetrievalCapabilities.has(tool.handler.capability)) return [];
    return [{ toolName: tool.name, capability: tool.handler.capability }];
  });
}

function isVisibleTool(
  tool: RegisteredTool,
  visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"],
): boolean {
  return !visibleToolNames || visibleToolNames.includes(tool.name);
}

function isContextPolicyMessage(message: AgentMessage): boolean {
  const record = readAgentUnknownRecord(message);
  return record?.role === "custom" && record.customType === AgentPiContextPolicyCustomType;
}
