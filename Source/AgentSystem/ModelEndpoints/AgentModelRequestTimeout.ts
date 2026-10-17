import { ModelRequestTimeoutError } from "./ModelHttpErrors.js";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

const MinimumStreamIdleTimeoutMs = 60_000;

export function resolveAgentStreamIdleTimeoutMs(maxRequestMs: number, firstTokenTimeoutMs: number): number {
  const requestBudgetMs = Number.isFinite(maxRequestMs) && maxRequestMs > 0 ? maxRequestMs : 0;
  const firstTokenBudgetMs = Number.isFinite(firstTokenTimeoutMs) && firstTokenTimeoutMs > 0 ? firstTokenTimeoutMs : 0;
  return Math.max(MinimumStreamIdleTimeoutMs, requestBudgetMs - firstTokenBudgetMs);
}

export function createAgentStreamIdleWatchdog(
  controller: AbortController,
  maxRequestMs: number,
  firstTokenTimeoutMs: number,
): { reset(): void; clear(): void } {
  const timeoutMs = resolveAgentStreamIdleTimeoutMs(maxRequestMs, firstTokenTimeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  return {
    reset: (): void => {
      if (controller.signal.aborted) return;
      clear();
      timer = setTimeout(() => {
        timer = undefined;
        controller.abort(new ModelRequestTimeoutError("stream_idle"));
      }, timeoutMs);
    },
    clear,
  };
}

export function isAgentStreamActivityEvent(event: AssistantMessageEvent): boolean {
  return event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta";
}
