import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import type { AgentWebSocketRequest, AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";

export const AgentWebSocketRequestLanes = {
  Concurrent: "concurrent",
  Serial: "serial",
} as const;

export type AgentWebSocketRequestLane = (typeof AgentWebSocketRequestLanes)[keyof typeof AgentWebSocketRequestLanes];

type RequestType = AgentWebSocketRequest["type"];

type RequestSchedulingPolicy<TRequest extends AgentWebSocketRequest> =
  | { readonly lane: typeof AgentWebSocketRequestLanes.Concurrent }
  | {
      readonly lane: typeof AgentWebSocketRequestLanes.Serial;
      readonly key: (request: TRequest) => string;
    };

type ConditionalSchedulingPolicy<TRequest extends AgentWebSocketRequest> = {
  readonly kind: "conditional";
  readonly concurrentWhen: (request: TRequest) => boolean;
  readonly key: (request: TRequest) => string;
};

type RequestSchedulingCatalog = {
  readonly [TType in RequestType]:
    | RequestSchedulingPolicy<AgentWebSocketRequestOf<TType>>
    | ConditionalSchedulingPolicy<AgentWebSocketRequestOf<TType>>;
};

const concurrent = { lane: AgentWebSocketRequestLanes.Concurrent } as const;
const serial = <TRequest extends AgentWebSocketRequest>(
  key: (request: TRequest) => string,
): RequestSchedulingPolicy<TRequest> => ({ lane: AgentWebSocketRequestLanes.Serial, key });
const conditional = <TRequest extends AgentWebSocketRequest>(
  concurrentWhen: (request: TRequest) => boolean,
  key: (request: TRequest) => string,
): ConditionalSchedulingPolicy<TRequest> => ({ kind: "conditional", concurrentWhen, key });

const sessionKey = (sessionId: string): string => `session:${sessionId}`;
const resourceKey = (resourceId: string): string => `execution-resource:${resourceId}`;

const RequestSchedulingCatalog = {
  "session.create": serial((request) => sessionKey(request.sessionId ?? createOpaqueId("automatic_session"))),
  "session.message": conditional(
    (request) => Boolean(request.queueMode),
    (request) => sessionKey(request.sessionId),
  ),
  "session.close": serial((request) => sessionKey(request.sessionId)),
  "session.cancel": concurrent,
  "session.truncate_from": serial((request) => sessionKey(request.sessionId)),
  "session.regenerate": concurrent,
  "session.fork": serial((request) => sessionKey(request.sourceSessionId)),
  "session.list": concurrent,
  "session.history": serial((request) => sessionKey(request.sessionId)),
  "session.rename": serial((request) => sessionKey(request.sessionId)),
  "model.list": concurrent,
  "provider.models.fetch": concurrent,
  "config.get": concurrent,
  "config.update": serial(() => "config"),
  "provider.endpoint.upsert": serial(() => "config"),
  "provider.endpoint.delete": serial(() => "config"),
  "provider.endpoint.rename": serial(() => "config"),
  "provider.model.upsert": serial(() => "config"),
  "provider.model.delete": serial(() => "config"),
  "provider.model.bulkImport": serial(() => "config"),
  "provider.defaultModel.set": serial(() => "config"),
  "plugin.config.list": concurrent,
  "plugin.config.update": serial(() => "plugin-config"),
  "plugin.config.set_enabled": serial(() => "plugin-config"),
  "preset.list": concurrent,
  "preset.save": serial(() => "presets"),
  "preset.delete": serial(() => "presets"),
  "preset.set_active": serial(() => "presets"),
  "profile.get": concurrent,
  "profile.update": serial(() => "profile"),
  "approval.resolve": concurrent,
  "interaction.input.resolve": concurrent,
  "sandbox.status": concurrent,
  "execution.resource.list": concurrent,
  "execution.resource.inspect": concurrent,
  "execution.resource.write": serial((request) => resourceKey(request.resourceId)),
  "execution.resource.resize": serial((request) => resourceKey(request.resourceId)),
  "execution.resource.signal": serial((request) => resourceKey(request.resourceId)),
  "execution.resource.stop_all": serial((request) => sessionKey(request.sessionId)),
} satisfies RequestSchedulingCatalog;

export interface AgentWebSocketRequestSchedulingInspection {
  readonly lane: AgentWebSocketRequestLane;
  readonly key?: string;
}

export class AgentWebSocketRequestScheduler {
  private readonly serial = new AgentKeyedLeaseQueue<string>();

  run<TValue>(request: AgentWebSocketRequest, operation: () => Promise<TValue>): Promise<TValue> {
    const scheduling = inspectAgentWebSocketRequestScheduling(request);
    return scheduling.lane === AgentWebSocketRequestLanes.Concurrent
      ? operation()
      : this.serial.run(scheduling.key!, operation);
  }
}

export function inspectAgentWebSocketRequestScheduling(
  request: AgentWebSocketRequest,
): AgentWebSocketRequestSchedulingInspection {
  const policy = RequestSchedulingCatalog[request.type] as
    RequestSchedulingPolicy<AgentWebSocketRequest> | ConditionalSchedulingPolicy<AgentWebSocketRequest>;
  if ("kind" in policy) {
    return policy.concurrentWhen(request)
      ? { lane: AgentWebSocketRequestLanes.Concurrent }
      : { lane: AgentWebSocketRequestLanes.Serial, key: policy.key(request) };
  }
  return policy.lane === AgentWebSocketRequestLanes.Concurrent
    ? { lane: policy.lane }
    : { lane: policy.lane, key: policy.key(request) };
}
