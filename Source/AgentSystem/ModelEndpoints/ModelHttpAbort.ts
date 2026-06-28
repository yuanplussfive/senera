import type { ModelProviderConfig } from "./ModelEndpointTypes.js";
import { ModelRequestTimeoutError } from "./ModelHttpErrors.js";

export interface ModelRequestLifetime {
  signal: AbortSignal;
  dispose: () => void;
}

export function createModelRequestLifetime(
  config: ModelProviderConfig,
  parent?: AbortSignal,
): ModelRequestLifetime {
  if (config.MaxRequestMs === -1) {
    return parent
      ? {
          signal: parent,
          dispose: () => undefined,
        }
      : {
          signal: new AbortController().signal,
          dispose: () => undefined,
        };
  }

  const timeout = new AbortController();
  const signal = combineAbortSignals(parent, timeout.signal);
  const timer = setTimeout(
    () => timeout.abort(new ModelRequestTimeoutError("max_request")),
    config.MaxRequestMs,
  );
  return {
    signal,
    dispose: () => clearTimeout(timer),
  };
}

export function combineAbortSignals(
  first: AbortSignal | null | undefined,
  second: AbortSignal,
): AbortSignal {
  if (!first) return second;

  const controller = new AbortController();
  const abort = (event?: Event): void => {
    const source = event?.target as AbortSignal | undefined;
    controller.abort(source?.reason);
  };
  if (first.aborted || second.aborted) {
    controller.abort(first.reason ?? second.reason);
    return controller.signal;
  }

  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export function readAbortFailure(
  ...signals: Array<AbortSignal | null | undefined>
): { reason: unknown } | undefined {
  const signal = signals.find((item) => item?.aborted);
  return signal
    ? { reason: signal.reason ?? new Error("请求已取消。") }
    : undefined;
}
