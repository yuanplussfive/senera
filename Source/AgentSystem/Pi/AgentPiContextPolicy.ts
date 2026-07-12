import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import {
  readArray,
  readRecord,
  readString,
  stableStringify,
  uniqueStrings,
} from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { type AgentConversationEntry } from "../Conversation/AgentConversation.js";
import { AgentPlannerMemoryProjector } from "../Memory/AgentPlannerMemory.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { PlannerEvidenceMemoryItem } from "../BamlClient/baml_client/types.js";
import type { AgentPiToolProjectionContext } from "./AgentPiTypes.js";

export const AgentPiContextPolicyEnvelopeType = "senera.pi_context_policy.v1";
export const AgentPiContextPolicyCustomType = "senera.pi_context_policy";

export interface AgentPiContextPolicyFrame {
  requestId?: string;
  model: string;
  createdAt: string;
  historicalEvidence: AgentPiContextEvidenceItem[];
  retrievalTools: AgentPiContextRetrievalTool[];
}

export interface AgentPiContextPolicyFrameInput {
  requestId?: string;
  model: string;
  conversationEntries: readonly AgentConversationEntry[];
  registeredTools: readonly RegisteredTool[];
  visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"];
  createdAt?: string;
}

export interface AgentPiContextEvidenceItem {
  evidenceUri: string;
  kind: string;
  label?: string;
  display?: string;
  locator?: string;
  toolName?: string;
  artifactUri?: string;
  facts: AgentPiContextFactItem[];
  artifactRefs: string[];
  source: "history" | "current_tool_result";
}

export interface AgentPiContextFactItem {
  name: string;
  value: string;
}

export interface AgentPiContextRetrievalTool {
  toolName: string;
  capability: string;
  summary?: string;
  capabilityIds: string[];
  inputs: string[];
  outputs: string[];
  evidenceKinds: string[];
}

interface AgentPiContextPolicyEnvelope {
  type: typeof AgentPiContextPolicyEnvelopeType;
  authority: "runtime_context";
  requestId?: string;
  instruction: string;
  evidence: AgentPiContextEvidenceItem[];
  artifacts: AgentPiContextArtifactItem[];
  retrievalTools: AgentPiContextRetrievalTool[];
  policy: {
    evidence: string;
    artifact: string;
    memory: string;
  };
  stats: {
    historicalEvidence: number;
    currentToolEvidence: number;
    totalEvidence: number;
    omittedEvidence: number;
    artifacts: number;
    retrievalTools: number;
  };
}

interface AgentPiContextArtifactItem {
  artifactUri: string;
  evidenceUris: string[];
  refs: string[];
}

const ContextPolicyLimits = {
  maxEvidenceItems: 24,
  maxFactsPerEvidence: 8,
  maxArtifactRefs: 12,
  maxRetrievalTools: 8,
  maxStringTokens: 200,
  maxEnvelopeTokens: 6_000,
} as const;

const RetrievalCapabilities = new Set<string>([
  AgentHostCapabilityNames.ArtifactMemoryRead,
  AgentHostCapabilityNames.MemoryRecall,
]);

const RuntimeInstruction = [
  "This message is Senera runtime context, not a user request.",
  "Use the indexed evidence only as compact facts.",
  "When exact artifact content, full evidence, or durable memory is required, call an available retrieval tool instead of guessing.",
  "The latest ordinary user message remains the task to answer.",
].join(" ");

export class AgentPiContextPolicy {
  private readonly memoryProjector = new AgentPlannerMemoryProjector();
  private readonly tokenProjector: AgentTokenProjector;

  constructor(private readonly model: string) {
    this.tokenProjector = new AgentTokenProjector(model);
  }

  createFrame(input: AgentPiContextPolicyFrameInput): AgentPiContextPolicyFrame {
    return {
      requestId: input.requestId,
      model: input.model,
      createdAt: input.createdAt ?? new Date().toISOString(),
      historicalEvidence: this.projectHistoricalEvidence(input),
      retrievalTools: this.projectRetrievalTools(input),
    };
  }

  apply(messages: readonly AgentMessage[], frame: AgentPiContextPolicyFrame): AgentMessage[] {
    try {
      const baseMessages = messages.filter((message) => !isContextPolicyMessage(message));
      const currentEvidence = projectCurrentToolEvidence(baseMessages, this.tokenProjector);
      const envelope = buildContextEnvelope(frame, currentEvidence);
      if (!shouldInjectContextEnvelope(envelope)) {
        return [...baseMessages];
      }

      return [createContextPolicyMessage(envelope, frame.createdAt, this.tokenProjector), ...baseMessages];
    } catch {
      return [...messages];
    }
  }

  private projectHistoricalEvidence(input: AgentPiContextPolicyFrameInput): AgentPiContextEvidenceItem[] {
    return this.memoryProjector
      .projectEvidenceMemory(input.conversationEntries, {
        excludeEvidenceRequestId: input.requestId,
      })
      .map((evidence) => projectPlannerEvidence(evidence, "history", this.tokenProjector))
      .slice(-ContextPolicyLimits.maxEvidenceItems);
  }

  private projectRetrievalTools(input: AgentPiContextPolicyFrameInput): AgentPiContextRetrievalTool[] {
    return input.registeredTools
      .filter((tool) => isVisibleTool(tool, input.visibleToolNames))
      .flatMap((tool) => projectRetrievalTool(tool, this.tokenProjector))
      .slice(0, ContextPolicyLimits.maxRetrievalTools);
  }
}

export function applyAgentPiContextPolicy(
  messages: readonly AgentMessage[],
  frame: AgentPiContextPolicyFrame | undefined,
): AgentMessage[] {
  return frame ? new AgentPiContextPolicy(frame.model).apply(messages, frame) : [...messages];
}

function buildContextEnvelope(
  frame: AgentPiContextPolicyFrame,
  currentEvidence: readonly AgentPiContextEvidenceItem[],
): AgentPiContextPolicyEnvelope {
  const evidence = mergeEvidence([...frame.historicalEvidence, ...currentEvidence]).slice(
    -ContextPolicyLimits.maxEvidenceItems,
  );
  const artifacts = projectArtifacts(evidence);
  return {
    type: AgentPiContextPolicyEnvelopeType,
    authority: "runtime_context",
    requestId: frame.requestId,
    instruction: RuntimeInstruction,
    evidence,
    artifacts,
    retrievalTools: frame.retrievalTools,
    policy: {
      evidence: "Evidence entries are compact projections; do not treat them as complete raw tool output.",
      artifact: "Use an artifact retrieval tool when artifactUri/ref details are needed beyond the indexed facts.",
      memory:
        "Use a memory retrieval tool when durable user preferences, profile, knowledge, or older conversation state are needed.",
    },
    stats: {
      historicalEvidence: frame.historicalEvidence.length,
      currentToolEvidence: currentEvidence.length,
      totalEvidence: evidence.length,
      omittedEvidence: 0,
      artifacts: artifacts.length,
      retrievalTools: frame.retrievalTools.length,
    },
  };
}

function shouldInjectContextEnvelope(envelope: AgentPiContextPolicyEnvelope): boolean {
  return envelope.evidence.length > 0 || envelope.artifacts.length > 0;
}

function createContextPolicyMessage(
  envelope: AgentPiContextPolicyEnvelope,
  createdAt: string,
  tokenProjector: AgentTokenProjector,
): AgentMessage {
  const content = serializeContextEnvelope(envelope, tokenProjector);
  return {
    role: "custom",
    customType: AgentPiContextPolicyCustomType,
    content,
    display: false,
    details: envelope,
    timestamp: Date.parse(createdAt) || Date.now(),
  } as AgentMessage;
}

function serializeContextEnvelope(envelope: AgentPiContextPolicyEnvelope, tokenProjector: AgentTokenProjector): string {
  let current = envelope;
  let content = JSON.stringify(current, null, 2);
  let omittedEvidence = 0;

  while (
    tokenProjector.previewText(content, ContextPolicyLimits.maxEnvelopeTokens).truncated &&
    current.evidence.length > 1
  ) {
    const keep = Math.max(1, Math.floor(current.evidence.length * 0.75));
    omittedEvidence += current.evidence.length - keep;
    current = withEnvelopeEvidence(current, current.evidence.slice(-keep), omittedEvidence);
    content = JSON.stringify(current, null, 2);
  }

  return content;
}

function withEnvelopeEvidence(
  envelope: AgentPiContextPolicyEnvelope,
  evidence: AgentPiContextEvidenceItem[],
  omittedEvidence: number,
): AgentPiContextPolicyEnvelope {
  const artifacts = projectArtifacts(evidence);
  return {
    ...envelope,
    evidence,
    artifacts,
    stats: {
      ...envelope.stats,
      totalEvidence: evidence.length,
      omittedEvidence,
      artifacts: artifacts.length,
    },
  };
}

function isContextPolicyMessage(message: AgentMessage): boolean {
  const record = readRecord(message);
  return record?.role === "custom" && record.customType === AgentPiContextPolicyCustomType;
}

function projectPlannerEvidence(
  evidence: PlannerEvidenceMemoryItem,
  source: AgentPiContextEvidenceItem["source"],
  tokenProjector: AgentTokenProjector,
): AgentPiContextEvidenceItem {
  return compactEvidence(
    {
      evidenceUri: evidence.evidenceUri,
      kind: evidence.kind,
      label: evidence.label,
      display: evidence.display,
      locator: evidence.locator,
      toolName: evidence.toolName,
      artifactUri: evidence.artifactUri,
      facts: evidence.facts.map((fact) => ({
        name: fact.name,
        value: fact.value,
      })),
      artifactRefs: evidence.artifactRefs,
      source,
    },
    tokenProjector,
  );
}

function projectCurrentToolEvidence(
  messages: readonly AgentMessage[],
  tokenProjector: AgentTokenProjector,
): AgentPiContextEvidenceItem[] {
  return messages.flatMap((message) => {
    const record = readRecord(message);
    if (record?.role !== "toolResult") {
      return [];
    }

    const observation = readToolObservation(readTextContent(record.content));
    if (!observation) {
      return [];
    }

    const toolName = readString(record.toolName);
    const artifactUri = readString(observation.artifact_uri ?? observation.artifactUri);
    return readArray(observation.evidence).flatMap((entry) => {
      const evidence = readRecord(entry);
      const evidenceUri = readString(evidence?.evidence_uri ?? evidence?.evidenceUri);
      if (!evidenceUri) {
        return [];
      }

      return compactEvidence(
        {
          evidenceUri,
          kind: readString(evidence?.kind) ?? "tool_observation",
          label: readString(evidence?.label),
          display: readString(evidence?.display),
          locator: readString(evidence?.locator),
          toolName,
          artifactUri,
          facts: readEvidenceFacts(evidence),
          artifactRefs: [],
          source: "current_tool_result",
        },
        tokenProjector,
      );
    });
  });
}

function readToolObservation(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = readRecord(JSON.parse(content) as unknown);
    return parsed?.type === "senera.tool_observation.v1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return readArray(content)
    .flatMap((entry) => {
      const record = readRecord(entry);
      return record?.type === "text" && typeof record.text === "string" ? [record.text] : [];
    })
    .join("");
}

function readEvidenceFacts(evidence: Record<string, unknown> | undefined): AgentPiContextFactItem[] {
  return readArray(evidence?.facts ?? evidence?.slots).flatMap((entry) => {
    const fact = readRecord(entry);
    const name = readString(fact?.name);
    const value = readString(fact?.value);
    return name && value ? [{ name, value }] : [];
  });
}

function compactEvidence(
  evidence: AgentPiContextEvidenceItem,
  tokenProjector: AgentTokenProjector,
): AgentPiContextEvidenceItem {
  return {
    evidenceUri: clampText(evidence.evidenceUri, tokenProjector),
    kind: clampText(evidence.kind, tokenProjector),
    label: clampOptionalText(evidence.label, tokenProjector),
    display: clampOptionalText(evidence.display, tokenProjector),
    locator: clampOptionalText(evidence.locator, tokenProjector),
    toolName: clampOptionalText(evidence.toolName, tokenProjector),
    artifactUri: clampOptionalText(evidence.artifactUri, tokenProjector),
    facts: evidence.facts
      .filter((fact) => fact.name.trim().length > 0 && fact.value.trim().length > 0)
      .slice(0, ContextPolicyLimits.maxFactsPerEvidence)
      .map((fact) => ({
        name: clampText(fact.name, tokenProjector),
        value: clampText(fact.value, tokenProjector),
      })),
    artifactRefs: uniqueStrings(evidence.artifactRefs)
      .slice(0, ContextPolicyLimits.maxArtifactRefs)
      .map((ref) => clampText(ref, tokenProjector)),
    source: evidence.source,
  };
}

function mergeEvidence(items: readonly AgentPiContextEvidenceItem[]): AgentPiContextEvidenceItem[] {
  const byIdentity = new Map<string, AgentPiContextEvidenceItem>();
  for (const item of items) {
    byIdentity.set(evidenceIdentity(item), item);
  }
  return [...byIdentity.values()];
}

function evidenceIdentity(item: AgentPiContextEvidenceItem): string {
  return stableStringify({
    evidenceUri: item.evidenceUri,
    kind: item.kind,
    artifactUri: item.artifactUri,
    source: item.source,
  });
}

function projectArtifacts(evidence: readonly AgentPiContextEvidenceItem[]): AgentPiContextArtifactItem[] {
  const artifacts = new Map<string, AgentPiContextArtifactItem>();
  for (const item of evidence) {
    if (!item.artifactUri) {
      continue;
    }
    const current = artifacts.get(item.artifactUri) ?? {
      artifactUri: item.artifactUri,
      evidenceUris: [],
      refs: [],
    };
    current.evidenceUris.push(item.evidenceUri);
    current.refs.push(...item.artifactRefs);
    artifacts.set(item.artifactUri, {
      artifactUri: current.artifactUri,
      evidenceUris: uniqueStrings(current.evidenceUris),
      refs: uniqueStrings(current.refs),
    });
  }
  return [...artifacts.values()];
}

function projectRetrievalTool(
  tool: RegisteredTool,
  tokenProjector: AgentTokenProjector,
): AgentPiContextRetrievalTool[] {
  if (tool.handler.kind !== "HostCapability" || !RetrievalCapabilities.has(tool.handler.capability)) {
    return [];
  }

  return [
    {
      toolName: tool.name,
      capability: tool.handler.capability,
      summary: clampOptionalText(tool.search?.Summary ?? tool.plugin.manifest.Plugin.Description, tokenProjector),
      capabilityIds: uniqueStrings((tool.search?.Capabilities ?? []).map((capability) => capability.Id)),
      inputs: uniqueStrings((tool.search?.Capabilities ?? []).flatMap((capability) => capability.Facets?.Inputs ?? [])),
      outputs: uniqueStrings(
        (tool.search?.Capabilities ?? []).flatMap((capability) => capability.Facets?.Outputs ?? []),
      ),
      evidenceKinds: uniqueStrings(tool.evidenceCapabilities.map((capability) => capability.Produces)),
    },
  ];
}

function isVisibleTool(
  tool: RegisteredTool,
  visibleToolNames: AgentPiToolProjectionContext["visibleToolNames"] = "all",
): boolean {
  return visibleToolNames === "all" || visibleToolNames.includes(tool.name);
}

function clampOptionalText(value: string | undefined, tokenProjector: AgentTokenProjector): string | undefined {
  return value ? clampText(value, tokenProjector) : undefined;
}

function clampText(value: string, tokenProjector: AgentTokenProjector): string {
  return tokenProjector.previewText(value, ContextPolicyLimits.maxStringTokens).text;
}
