import type { PlannerTimelineTurn } from "../BamlClient/baml_client/types.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import { AgentXmlParser } from "../Xml/AgentXmlParser.js";
import {
  createXmlProtocolSpec,
  listXmlArrayElementNames,
} from "../Xml/AgentXmlPolicy.js";
import type { AgentActionPlannerLedger } from "./AgentActionPlannerLedger.js";
import { stringifyPreview } from "./AgentActionPlannerProjectionUtils.js";
import {
  AgentPlannerTimelinePayloadKeys,
  encodePlannerTimelinePayload,
} from "./AgentPlannerTimelinePayload.js";
import { AgentPlannerTimelineXmlProjector } from "./AgentPlannerTimelineXmlProjector.js";
import { appendMissingLedgerObservations } from "./AgentPlannerTimelineLedgerProjector.js";

export class AgentActionPlannerTimelineProjector {
  private readonly protocol = createXmlProtocolSpec();
  private readonly parser = new AgentXmlParser({
    arrayElementNames: listXmlArrayElementNames(this.protocol),
    arrayElementNameSuffix: this.protocol.arrayElementNameSuffix,
  });
  private readonly xmlProjector = new AgentPlannerTimelineXmlProjector(this.protocol);

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
    return appendMissingLedgerObservations(messageTurns, options.ledger);
  }

  private projectMessage(message: AgentLanguageModelMessage): Array<Omit<PlannerTimelineTurn, "index">> {
    const parsed = this.tryParseXml(message.content);
    const projected = parsed
      ? this.xmlProjector.projectRoot(parsed.rootName, parsed.value, message.content)
      : [];
    if (projected.length > 0) {
      return projected;
    }

    return [{
      role: message.role,
      kind: message.role === "assistant" ? "assistant_message" : "user_message",
      content: message.content,
      payloadJson: encodePlannerTimelinePayload({
        [AgentPlannerTimelinePayloadKeys.Message]: {
          content: message.content,
        },
      }),
      evidenceUris: [],
      artifactUris: [],
    }];
  }

  private tryParseXml(value: string) {
    try {
      return this.parser.parse(value);
    } catch {
      return undefined;
    }
  }
}
