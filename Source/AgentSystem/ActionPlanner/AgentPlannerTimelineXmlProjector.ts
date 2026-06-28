import type { PlannerTimelineTurn } from "../BamlClient/baml_client/types.js";
import {
  AgentToolObservationProjector,
} from "../ToolRuntime/AgentToolObservationProjection.js";
import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import {
  compactObject,
  readArray,
  readArrayItems,
  readRecord,
  readString,
  stringifyPreview,
} from "./AgentActionPlannerProjectionUtils.js";
import {
  AgentPlannerTimelinePayloadKeys,
  encodePlannerTimelinePayload,
} from "../AgentPlannerTimelinePayload.js";

export class AgentPlannerTimelineXmlProjector {
  private readonly toolObservationProjector: AgentToolObservationProjector;

  constructor(private readonly protocol: AgentXmlProtocolSpec) {
    this.toolObservationProjector = new AgentToolObservationProjector(protocol);
  }

  projectRoot(
    rootName: string,
    value: unknown,
    source: string,
  ): Array<Omit<PlannerTimelineTurn, "index">> {
    if (rootName === this.protocol.roots.readOnlyEvidence) {
      const projected = this.projectReadOnlyEvidence(value);
      return projected ? [projected] : [];
    }

    if (rootName === this.protocol.roots.currentUserMessage) {
      const payload = this.projectCurrentUserMessage(value);
      return [{
        role: "user",
        kind: "user_message",
        content: this.readUserMessageContent(payload),
        payloadJson: this.payloadJson({
          [AgentPlannerTimelinePayloadKeys.UserMessage]: payload,
        }),
        evidenceUris: [],
        artifactUris: [],
      }];
    }

    if (rootName === this.protocol.roots.historicalUserTurn) {
      const turn = this.projectHistoricalUserTurn(value);
      return [
        {
          role: "user",
          kind: "user_message",
          content: turn.content,
          payloadJson: this.payloadJson({
            [AgentPlannerTimelinePayloadKeys.UserMessage]: turn.payload,
          }),
          evidenceUris: turn.evidenceUris,
          artifactUris: turn.artifactUris,
        },
        ...turn.observations,
      ];
    }

    if (rootName === this.protocol.roots.toolCalls) {
      const calls = this.toolObservationProjector.projectToolCalls(value);
      return [{
        role: "assistant",
        kind: "tool_call",
        content: stringifyPreview(calls),
        payloadJson: this.payloadJson({
          [AgentPlannerTimelinePayloadKeys.Calls]: calls,
        }),
        evidenceUris: [],
        artifactUris: [],
      }];
    }

    if (rootName === this.protocol.roots.toolResults) {
      const observation = this.toolObservationProjector.projectToolResults(value);
      return [{
        role: "user",
        kind: "tool_observation",
        content: observation.content,
        payloadJson: this.payloadJson(observation.payload),
        evidenceUris: observation.evidenceUris,
        artifactUris: observation.artifactUris,
      }];
    }

    return source.trimStart().startsWith(`<${rootName}`)
      ? [{
          role: "user",
          kind: "xml_observation",
          content: stringifyPreview(value),
          payloadJson: this.payloadJson({
            [AgentPlannerTimelinePayloadKeys.XmlRoot]: rootName,
            [AgentPlannerTimelinePayloadKeys.Value]: value,
          }),
          evidenceUris: [],
          artifactUris: [],
        }]
      : [];
  }

  private projectReadOnlyEvidence(value: unknown): Omit<PlannerTimelineTurn, "index"> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const kind = readString(record.kind) ?? "read_only_evidence";
    const payload = record.payload;
    if (kind === "user_message") {
      const userMessage = this.projectUserMessagePayload(payload);
      return {
        role: "user",
        kind,
        content: this.readUserMessageContent(userMessage),
        payloadJson: this.payloadJson({
          [AgentPlannerTimelinePayloadKeys.UserMessage]: userMessage,
        }),
        evidenceUris: [],
        artifactUris: [],
      };
    }

    if (kind === "tool_results") {
      const observation = this.toolObservationProjector.projectReadOnlyToolResults(payload);
      return {
        role: "user",
        kind: "tool_observation",
        content: observation.content,
        payloadJson: this.payloadJson(observation.payload),
        evidenceUris: observation.evidenceUris,
        artifactUris: observation.artifactUris,
      };
    }

    return {
      role: "user",
      kind,
      content: stringifyPreview(payload),
      payloadJson: this.payloadJson({
        [AgentPlannerTimelinePayloadKeys.Value]: payload,
      }),
      evidenceUris: [],
      artifactUris: [],
    };
  }

  private projectUserMessagePayload(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        content: stringifyPreview(value),
      };
    }

    const record = value as Record<string, unknown>;
    const content = readString(record.content);
    return compactObject({
      content: content ?? stringifyPreview(value),
      attachments: this.projectAttachments(record.attachments),
    });
  }

  private projectCurrentUserMessage(value: unknown): Record<string, unknown> {
    const record = readRecord(value);
    return record
      ? this.projectUserMessagePayload(record[this.protocol.context.userMessage] ?? value)
      : this.projectUserMessagePayload(value);
  }

  private projectHistoricalUserTurn(value: unknown): {
    content: string;
    payload: Record<string, unknown>;
    evidenceUris: string[];
    artifactUris: string[];
    observations: Array<Omit<PlannerTimelineTurn, "index">>;
  } {
    const record = readRecord(value);
    if (!record) {
      return {
        content: stringifyPreview(value),
        payload: {
          content: stringifyPreview(value),
        },
        evidenceUris: [],
        artifactUris: [],
        observations: [],
      };
    }

    const userMessage = record[this.protocol.context.userMessage];
    const evidenceMemory = readRecord(record[this.protocol.context.toolEvidenceMemory]);
    const payload = this.projectUserMessagePayload(userMessage);
    return {
      content: this.readUserMessageContent(payload),
      payload,
      evidenceUris: this.collectEvidenceMemoryUris(evidenceMemory),
      artifactUris: this.collectEvidenceMemoryArtifactUris(evidenceMemory),
      observations: this.projectHistoricalToolResults(record[this.protocol.context.toolResults]),
    };
  }

  private projectHistoricalToolResults(value: unknown): Array<Omit<PlannerTimelineTurn, "index">> {
    const toolResults = readRecord(value);
    if (!toolResults) {
      return [];
    }

    const observation = this.toolObservationProjector.projectToolResults(toolResults);
    if (observation.evidenceUris.length === 0 && observation.artifactUris.length === 0) {
      return [];
    }

    return [{
      role: "user",
      kind: "tool_observation",
      content: observation.content,
      payloadJson: this.payloadJson(observation.payload),
      evidenceUris: observation.evidenceUris,
      artifactUris: observation.artifactUris,
    }];
  }

  private projectAttachments(value: unknown): Record<string, unknown>[] {
    const record = readRecord(value);
    if (!record) {
      return [];
    }

    return readArrayItems(record, this.protocol.items.arrayItem)
      .map((entry) => readRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => compactObject({
        evidenceUri: entry.evidenceUri,
        uploadUri: entry.uploadUri,
        name: entry.name,
        mime: entry.mime,
        size: entry.size,
        status: entry.status,
      }));
  }

  private readUserMessageContent(payload: Record<string, unknown>): string {
    return readString(payload.content) ?? stringifyPreview(payload);
  }

  private collectEvidenceMemoryUris(value: Record<string, unknown> | undefined): string[] {
    return this.readEvidenceMemoryItems(value)
      .map((item) => readString(readRecord(item)?.evidenceUri))
      .filter((uri): uri is string => Boolean(uri));
  }

  private collectEvidenceMemoryArtifactUris(value: Record<string, unknown> | undefined): string[] {
    return this.readEvidenceMemoryItems(value)
      .map((item) => readString(readRecord(item)?.artifactUri))
      .filter((uri): uri is string => Boolean(uri));
  }

  private readEvidenceMemoryItems(value: Record<string, unknown> | undefined): unknown[] {
    return readArray(value?.[this.protocol.items.arrayItem]);
  }

  private payloadJson(value: unknown): string {
    return encodePlannerTimelinePayload(value);
  }
}
