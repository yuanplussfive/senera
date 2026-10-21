import {
  normalizeContext,
  type Api,
  type ApiStreamOptions,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

/**
 * Pi 0.87 providers receive normalized transcripts internally. Senera's host
 * tests and extension-facing callers still pass the public Context shape, so
 * this adapter makes that boundary explicit without changing provider wire
 * behavior or maintaining a second request path.
 */
export type AgentPiContextProvider<TApi extends Api> = Provider<TApi> & {
  stream<T extends TApi>(model: Model<T>, context: Context, options?: ApiStreamOptions<T>): AssistantMessageEventStream;
  streamSimple(model: Model<TApi>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
};

export function exposeAgentPiContextProvider<TApi extends Api>(provider: Provider<TApi>): AgentPiContextProvider<TApi> {
  return {
    ...provider,
    stream: (model, context, options) => provider.stream(model, normalizeContext(context), options),
    streamSimple: (model, context, options) => provider.streamSimple(model, normalizeContext(context), options),
  } as AgentPiContextProvider<TApi>;
}
