import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentChannelStatus } from "./AgentChannelService.js";

export type AgentChannelDomainEvent = {
  kind: typeof AgentEventKinds.ChannelStatusSnapshot;
  context: AgentEventContext;
  data: {
    statuses: readonly AgentChannelStatus[];
  };
};
