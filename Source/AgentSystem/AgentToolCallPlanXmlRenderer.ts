import { AgentXmlCodec } from "./AgentXmlCodec.js";
import {
  createXmlProtocolSpec,
  type AgentXmlProtocolSpec,
} from "./AgentXmlPolicy.js";
import type { AgentPlannedToolCall } from "./AgentToolCallPlannerSchema.js";

export class AgentToolCallPlanXmlRenderer {
  private readonly codec: AgentXmlCodec;

  constructor(private readonly protocol: AgentXmlProtocolSpec = createXmlProtocolSpec()) {
    this.codec = new AgentXmlCodec(protocol);
  }

  render(calls: readonly AgentPlannedToolCall[]): string {
    return this.codec.objectToXml(this.protocol.roots.toolCalls, {
      [this.protocol.items.toolCall]: calls.map((call) => ({
        [this.protocol.toolCall.name]: call.name,
        [this.protocol.toolCall.arguments]: call.arguments,
      })),
    });
  }
}
