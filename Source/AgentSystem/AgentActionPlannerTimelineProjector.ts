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
  readRecord,
  readString,
  stringifyPreview,
} from "./AgentActionPlannerProjectionUtils.js";

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
    const messageTurns = options.messages.map((message, index) => ({
      index,
      ...this.projectMessage(message),
    }));
    return this.appendMissingLedgerObservations(messageTurns, options.ledger);
  }

  private projectMessage(message: AgentLanguageModelMessage): Omit<PlannerTimelineTurn, "index"> {
    const parsed = this.tryParseXml(message.content);
    const projected = parsed ? this.projectXmlRoot(parsed.rootName, parsed.value, message.content) : undefined;
    if (projected) {
      return projected;
    }

    return {
      role: message.role,
      kind: message.role === "assistant" ? "assistant_message" : "user_message",
      content: message.content,
      evidenceRefs: [],
      artifactUris: [],
    };
  }

  private projectXmlRoot(rootName: string, value: unknown, source: string): {
    role: string;
    kind: string;
    step?: number | null;
    content: string;
    evidenceRefs: string[];
    artifactUris: string[];
  } | undefined {
    if (rootName === "read_only_evidence") {
      return this.projectReadOnlyEvidence(value);
    }

    if (rootName === "user_message") {
      return {
        role: "user",
        kind: "user_message",
        content: this.projectUserMessagePayload(value),
        evidenceRefs: [],
        artifactUris: [],
      };
    }

    if (rootName === this.protocol.roots.toolCalls) {
      return {
        role: "assistant",
        kind: "tool_call",
        content: stringifyPreview(this.toolObservationProjector.projectToolCalls(value)),
        evidenceRefs: [],
        artifactUris: [],
      };
    }

    if (rootName === this.protocol.roots.toolResults) {
      const observation = this.toolObservationProjector.projectToolResults(value);
      return {
        role: "user",
        kind: "tool_observation",
        content: observation.content,
        evidenceRefs: observation.evidenceRefs,
        artifactUris: observation.artifactUris,
      };
    }

    return source.trimStart().startsWith(`<${rootName}`)
      ? {
          role: "user",
          kind: "xml_observation",
          content: stringifyPreview(value),
          evidenceRefs: [],
          artifactUris: [],
        }
      : undefined;
  }

  private projectReadOnlyEvidence(value: unknown): {
    role: string;
    kind: string;
    step?: number | null;
    content: string;
    evidenceRefs: string[];
    artifactUris: string[];
  } | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const kind = readString(record.kind) ?? "read_only_evidence";
    const payload = record.payload;
    if (kind === "user_message") {
      return {
        role: "user",
        kind,
        content: this.projectUserMessagePayload(payload),
        evidenceRefs: [],
        artifactUris: [],
      };
    }

    if (kind === "tool_results") {
      const observation = this.toolObservationProjector.projectReadOnlyToolResults(payload);
      return {
        role: "user",
        kind: "tool_observation",
        content: observation.content,
        evidenceRefs: observation.evidenceRefs,
        artifactUris: observation.artifactUris,
      };
    }

    return {
      role: "user",
      kind,
      content: stringifyPreview(payload),
      evidenceRefs: [],
      artifactUris: [],
    };
  }

  private projectUserMessagePayload(value: unknown): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return stringifyPreview(value);
    }

    const record = value as Record<string, unknown>;
    const content = readString(record.content);
    const attachments = readRecord(record.attachments);
    return attachments
      ? stringifyPreview(compactObject({
          content,
          attachments,
        }))
      : content ?? stringifyPreview(value);
  }

  private appendMissingLedgerObservations(
    turns: PlannerTimelineTurn[],
    ledger: AgentActionPlannerLedger,
  ): PlannerTimelineTurn[] {
    const seenEvidenceRefs = new Set(turns.flatMap((turn) => turn.evidenceRefs));
    const seenArtifactUris = new Set(turns.flatMap((turn) => turn.artifactUris));
    const evidenceByRef = new Map(ledger.evidence.map((entry) => [entry.evidenceRef, entry]));
    const result = [...turns];

    for (const call of ledger.calls) {
      const missingRefs = call.evidenceRefs.filter((ref) => !seenEvidenceRefs.has(ref));
      const artifactSeen = call.artifactUri.length > 0 && seenArtifactUris.has(call.artifactUri);
      if (missingRefs.length === 0 && artifactSeen) {
        continue;
      }

      const evidence = call.evidenceRefs
        .map((ref) => evidenceByRef.get(ref))
        .filter((entry): entry is PlannerEvidenceRecord => Boolean(entry));
      const artifactUris = call.artifactUri ? [call.artifactUri] : [];
      result.push({
        index: result.length,
        role: "user",
        kind: "tool_observation",
        step: call.step,
        content: renderToolObservationContent([
          compactObject({
            name: call.toolName,
            status: call.status,
            artifactUri: call.artifactUri,
            error: call.error,
            evidence: evidence.map(projectLedgerEvidenceForTimeline),
          }),
        ]),
        evidenceRefs: call.evidenceRefs,
        artifactUris,
      });
      for (const ref of call.evidenceRefs) {
        seenEvidenceRefs.add(ref);
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
}
