import type { AgentXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import {
  compactObject,
  readArrayItems,
  readRecord,
  readString,
  stringifyPreview,
  uniqueStrings,
} from "../ActionPlanner/AgentActionPlannerProjectionUtils.js";
import { renderToolObservationContent } from "./AgentToolObservationRenderer.js";
import { normalizeAgentArtifactUri } from "../Artifacts/AgentArtifactLocator.js";
import { AgentPlannerTimelinePayloadKeys } from "../ActionPlanner/AgentPlannerTimelinePayload.js";

export interface ToolObservationProjection {
  content: string;
  payload: Record<string, unknown>;
  evidenceUris: string[];
  artifactUris: string[];
}

interface ProjectedToolResultItem {
  value: Record<string, unknown>;
  evidenceUris: string[];
  artifactUris: string[];
}

export class AgentToolObservationProjector {
  constructor(private readonly protocol: AgentXmlProtocolSpec) {}

  projectToolCalls(value: unknown): unknown {
    return readArrayItems(value, this.protocol.items.toolCall).map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return entry;
      }
      const record = entry as Record<string, unknown>;
      return {
        name: readString(record[this.protocol.toolCall.name]) ?? "",
        arguments: record[this.protocol.toolCall.arguments] ?? {},
      };
    });
  }

  projectToolResults(value: unknown): ToolObservationProjection {
    return this.renderToolResultItems(readArrayItems(value, this.protocol.items.toolResult));
  }

  projectReadOnlyToolResults(value: unknown): ToolObservationProjection {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        content: stringifyPreview(value),
        payload: {
          [AgentPlannerTimelinePayloadKeys.Value]: value,
        },
        evidenceUris: [],
        artifactUris: [],
      };
    }

    const result = (value as Record<string, unknown>).result;
    const items = Array.isArray(result) ? result : readArrayItems(result, this.protocol.items.toolResult);
    return items.length > 0
      ? this.renderToolResultItems(items)
      : {
          content: stringifyPreview(result),
          payload: {
            [AgentPlannerTimelinePayloadKeys.Value]: result,
          },
          evidenceUris: [],
          artifactUris: [],
        };
  }

  private renderToolResultItems(values: readonly unknown[]): ToolObservationProjection {
    const items = values.map((entry) => this.projectToolResultItem(entry));
    const observations = items.map((item) => item.value);
    return {
      content: renderToolObservationContent(observations),
      payload: {
        [AgentPlannerTimelinePayloadKeys.Observations]: observations,
      },
      evidenceUris: uniqueStrings(items.flatMap((item) => item.evidenceUris)),
      artifactUris: uniqueStrings(items.flatMap((item) => item.artifactUris)),
    };
  }

  private projectToolResultItem(value: unknown): ProjectedToolResultItem {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        value: value === undefined ? {} : { value },
        evidenceUris: [],
        artifactUris: [],
      };
    }

    const record = value as Record<string, unknown>;
    const runtime = readRecord(record[this.protocol.toolResult.runtime]);
    const request = readRecord(record[this.protocol.toolResult.request]);
    const response = readRecord(record[this.protocol.toolResult.response]);
    const artifact = readRecord(response?.artifact);
    const evidence = this.projectArtifactEvidence(artifact?.evidence);
    const artifactUri = readArtifactUri(readString(artifact?.artifactUri));
    const projected = compactObject({
      callId: runtime?.[this.protocol.toolResult.callId],
      name: record[this.protocol.toolResult.name],
      arguments: request?.[this.protocol.toolResult.arguments],
      response: this.projectToolResponse(record[this.protocol.toolResult.response]),
      artifact: artifact
        ? compactObject({
            artifactId: artifact.artifactId,
            artifactUri,
            summary: artifact.summary,
            evidence,
            delta: this.projectArtifactDelta(artifact.delta),
            workspace: this.projectArtifactWorkspace(artifact.workspace),
          })
        : undefined,
      result: artifact ? undefined : response?.[this.protocol.toolResult.result],
    });

    return {
      value: projected,
      evidenceUris: evidence
        .map((entry) => readString(entry.evidenceUri))
        .filter((entry): entry is string => Boolean(entry)),
      artifactUris: artifactUri ? [artifactUri] : [],
    };
  }

  private projectToolResponse(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    return compactObject({
      ok: record.ok,
      error: record.error,
    });
  }

  private projectArtifactEvidence(value: unknown): Array<Record<string, unknown>> {
    return readArrayItems(value, this.protocol.items.arrayItem).map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return compactObject({
          value: entry,
        });
      }

      const record = entry as Record<string, unknown>;
      const plannerMemory = readRecord(record.plannerMemory);
      return compactObject({
        evidenceUri: record.evidenceUri,
        kind: record.kind,
        locator: record.locator,
        display: record.display,
        label: record.label,
        source: record.source,
        confidence: record.confidence,
        artifactUri: plannerMemory?.artifactUri,
        artifactRefs: readFlexibleArrayItems(plannerMemory?.artifactRefs, this.protocol.items.arrayItem),
        slots: this.projectEvidenceSlots(record.slots),
      });
    });
  }

  private projectEvidenceSlots(value: unknown): Array<Record<string, unknown>> {
    return readArrayItems(value, this.protocol.items.arrayItem).map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return compactObject({
          value: entry,
        });
      }

      const record = entry as Record<string, unknown>;
      return compactObject({
        name: record.name,
        value: record.value,
      });
    });
  }

  private projectArtifactDelta(value: unknown): Array<Record<string, unknown>> {
    return readArrayItems(value, this.protocol.items.arrayItem).map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return compactObject({
          value: entry,
        });
      }

      const record = entry as Record<string, unknown>;
      return compactObject({
        kind: record.kind,
        status: record.status,
        summary: record.summary,
      });
    });
  }

  private projectArtifactWorkspace(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const patch = readRecord(record.patch);
    return compactObject({
      patch: patch
        ? compactObject({
            generated: patch.generated,
            changeCount: patch.changeCount,
          })
        : undefined,
      changes: readArrayItems(readRecord(record.changes), this.protocol.items.arrayItem).map((entry) =>
        this.projectWorkspaceChange(entry),
      ),
    });
  }

  private projectWorkspaceChange(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    const patch = readRecord(record.patch);
    return compactObject({
      path: record.path,
      status: record.status,
      beforeHash: record.beforeHash,
      afterHash: record.afterHash,
      patch: patch
        ? compactObject({
            status: patch.status,
            reason: patch.reason,
          })
        : undefined,
    });
  }
}

function readArtifactUri(value: string | undefined): string | undefined {
  return value ? (normalizeAgentArtifactUri(value) ?? value) : undefined;
}

function readFlexibleArrayItems(value: unknown, itemKey: string): unknown[] {
  return Array.isArray(value) ? value : readArrayItems(value, itemKey);
}
