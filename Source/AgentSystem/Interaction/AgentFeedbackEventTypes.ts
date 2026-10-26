import type { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentFeedbackRecord } from "./AgentFeedbackTypes.js";

export type AgentFeedbackDomainEvent = {
  kind: typeof AgentEventKinds.FeedbackRecorded;
  context: Required<Pick<AgentEventContext, "sessionId" | "requestId">>;
  data: AgentFeedbackRecord;
};
