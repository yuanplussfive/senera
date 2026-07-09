import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentEventContext } from "../Events/AgentEventBase.js";
import type { AgentSandboxRuntimeSnapshot } from "./AgentSandboxRuntimeTypes.js";

export type AgentSandboxDomainEvent = {
  kind: typeof AgentEventKinds.SandboxStatusSnapshot;
  context: AgentEventContext;
  data: AgentSandboxRuntimeSnapshot;
};
