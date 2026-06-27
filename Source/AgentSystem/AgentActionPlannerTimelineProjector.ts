import type { PlannerTimelineTurn } from "./BamlClient/baml_client/types.js";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import { AgentXmlParser } from "./AgentXmlParser.js";
import {
  createXmlProtocolSpec,
  listXmlArrayElementNames,
} from "./AgentXmlPolicy.js";
import type {
  AgentActionPlannerLedger,
  PlannerEvidenceRecord,
} from "./AgentActionPlannerLedger.js";
import {
  AgentToolObservationProjector,
} from "./AgentToolObservationProjection.js";
import {
  projectLedgerEvidenceForTimeline,
  renderToolObservationContent,
} from "./AgentToolObservationRenderer.js";
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
} from "./AgentPlannerTimelinePayload.js";

export class AgentActionPlannerTimelineProjector {
  private readonly protocol = createXmlProtocolSpec();
  private readonly parser = new AgentXmlParser({
    arrayElementNames: listXmlArrayElementNames(this.protocol),
    arrayElementNameSuffix: this.protocol.arrayElementNameSuffix,
  });
  private readonly toolObservationProjector = new AgentToolObservationProjector(this.protocol);

  project(options: {
    messages: readonly AgentLanguageModelMessage[];
    ledger: AgentActionPlannerLedger;
  }): PlannerTimelineTurn[] {
    const messageTurns = options.messages
      .flatMap((message) => this.projectMessage(message))
      .map((turn, index) => ({
        index,
        ...turn,
      }));
    return this.appendMissingLedgerObservations(messageTurns, options.ledger);
  }

  private projectMessage(message: AgentLanguageModelMessage): Array<Omit<PlannerTimelineTurn, "index">> {
    const parsed = this.tryParseXml(message.content);
    const projected = parsed ? this.projectXmlRoot(parsed.rootName, parsed.value, message.content) : [];
    if (projected.length > 0) {
      return projected;
    }

    return [{
      role: message.role,
      kind: message.role === "assistant" ? "assistant_message" : "user_message",
      content: message.content,
      payloadJson: this.payloadJson({
        [AgentPlannerTimelinePayloadKeys.Message]: {
          content: message.content,
        },
      }),
      evidenceUris: [],
      artifactUris: [],
    }];
  }

  private projectXmlRoot(
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

  private projectReadOnlyEvidence(value: unknown): {
    role: string;
    kind: string;
    step?: number | null;
    content: string;
    payloadJson?: string | null;
    evidenceUris: string[];
    artifactUris: string[];
  } | undefined {
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

  private appendMissingLedgerObservations(
    turns: PlannerTimelineTurn[],
    ledger: AgentActionPlannerLedger,
  ): PlannerTimelineTurn[] {
    const seenEvidenceUris = new Set(turns.flatMap((turn) => turn.evidenceUris));
    const seenArtifactUris = new Set(turns.flatMap((turn) => turn.artifactUris));
    const evidenceByUri = new Map(ledger.evidence.map((entry) => [entry.evidenceUri, entry]));
    const result = [...turns];

    for (const call of ledger.calls) {
      const missingUris = call.evidenceUris.filter((uri) => !seenEvidenceUris.has(uri));
      const artifactSeen = call.artifactUri.length > 0 && seenArtifactUris.has(call.artifactUri);
      if (missingUris.length === 0 && artifactSeen) {
        continue;
      }

      const evidence = call.evidenceUris
        .map((uri) => evidenceByUri.get(uri))
        .filter((entry): entry is PlannerEvidenceRecord => Boolean(entry));
      const artifactUris = call.artifactUri ? [call.artifactUri] : [];
      const observation = compactObject({
        name: call.toolName,
        status: call.status,
        artifactUri: call.artifactUri,
        error: call.error,
        evidence: evidence.map(projectLedgerEvidenceForTimeline),
      });
      result.push({
        index: result.length,
        role: "user",
        kind: "tool_observation",
        step: call.step,
        content: renderToolObservationContent([
          observation,
        ]),
        payloadJson: this.payloadJson({
          [AgentPlannerTimelinePayloadKeys.Observations]: [observation],
        }),
        evidenceUris: call.evidenceUris,
        artifactUris,
      });
      for (const ref of call.evidenceUris) {
        seenEvidenceUris.add(ref);
      }
      for (const uri of artifactUris) {
        seenArtifactUris.add(uri);
      }
    }

    return result;
  }

  private tryParseXml(value: string) {
    try {
      return this.parser.parse(value);
    } catch {
      return undefined;
    }
  }

  private payloadJson(value: unknown): string {
    return encodePlannerTimelinePayload(value);
  }
}
