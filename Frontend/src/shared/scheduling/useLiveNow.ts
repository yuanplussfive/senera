import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function synchronizeClock(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  tick();
  if (listeners.size && !document.hidden) timer = setInterval(tick, 1000);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", synchronizeClock);
    synchronizeClock();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", synchronizeClock);
    }
  };
}

const readNow = (): number => now;
const subscribeIdle = (): (() => void) => () => undefined;

/** All visible execution timers share one clock; hidden documents stop ticking. */
export function useLiveNow(live: boolean): number {
  return useSyncExternalStore(live ? subscribe : subscribeIdle, readNow, readNow);
}
