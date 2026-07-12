import { AgentXmlCodec } from "./AgentXmlCodec.js";
import type { AgentExecutionResult } from "../ToolRuntime/AgentToolCallExecutionTypes.js";
import { createXmlProtocolSpec, type AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";

export class AgentToolResultXmlRenderer {
  private readonly codec: AgentXmlCodec;

  constructor(private readonly protocol: AgentXmlProtocolSpec = createXmlProtocolSpec()) {
    this.codec = new AgentXmlCodec(protocol);
  }

  render(result: Extract<AgentExecutionResult, { kind: "ToolResults" }>): string {
    return this.codec.objectToXml(this.protocol.roots.toolResults, {
      [this.protocol.items.toolResult]: result.value.map((entry) => ({
        [this.protocol.toolResult.runtime]: {
          [this.protocol.toolResult.callId]: entry.callId,
        },
        [this.protocol.toolResult.name]: entry.name,
        [this.protocol.toolResult.request]: {
          [this.protocol.toolResult.arguments]: entry.arguments,
        },
        [this.protocol.toolResult.response]: {
          [this.protocol.toolResult.result]: entry.artifact ? undefined : entry.result,
          artifact: entry.artifact
            ? {
                artifactId: entry.artifact.artifactId,
                artifactUri: entry.artifact.artifactUri,
                summary: entry.artifact.summary,
                evidence: {
                  item: entry.artifact.evidence.map((evidence) => ({
                    evidenceUri: evidence.evidenceUri,
                    kind: evidence.kind,
                    locator: evidence.locator,
                    display: evidence.display,
                    label: evidence.label,
                    source: evidence.source,
                    confidence: evidence.confidence,
                    slots: {
                      item: evidence.modelSlots.map((slot) => ({
                        name: slot.name,
                        value: slot.value,
                      })),
                    },
                  })),
                },
                delta: {
                  item: entry.artifact.delta.map((delta) => ({
                    kind: delta.kind,
                    status: delta.status,
                    summary: delta.summary,
                  })),
                },
                workspace: entry.artifact.workspace
                  ? {
                      patch: {
                        generated: entry.artifact.workspace.changes.some(
                          (change) => change.patch?.status === "generated",
                        ),
                        changeCount: entry.artifact.workspace.changes.filter(
                          (change) => change.patch?.status === "generated",
                        ).length,
                      },
                      changes: {
                        item: entry.artifact.workspace.changes.map((change) => ({
                          path: change.path,
                          status: change.status,
                          beforeHash: change.beforeHash,
                          afterHash: change.afterHash,
                          patch: change.patch
                            ? {
                                status: change.patch.status,
                                reason: change.patch.reason,
                              }
                            : undefined,
                        })),
                      },
                    }
                  : undefined,
              }
            : undefined,
        },
      })),
    });
  }
}
