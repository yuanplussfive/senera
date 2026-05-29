import { AgentXmlCodec } from "./AgentXmlCodec.js";
import type { AgentExecutionResult } from "./AgentDecisionExecutor.js";
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
          [this.protocol.toolResult.result]: entry.result,
        },
      })),
    });
  }
}
