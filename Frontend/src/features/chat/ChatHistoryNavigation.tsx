import { useEffect, useState } from "react";
import { frontendChatMessage as frontendMessage } from "../../i18n/frontendChatMessageCatalog";
import { cn } from "../../lib/util";
import { useMotionLevel } from "../../shared/motion";
import { AppIcon, Spinner } from "../../shared/ui";
import type { AgentSessionHistoryWindow } from "../../../../Source/AgentSystem/Session/AgentSessionHistoryWindow";
import type { ChatNavigationActions } from "./ChatPanelContracts";

type HistoryNavigationState = "loading" | "failed" | "prepend" | "earlier";

export function ChatHistoryNavigation({
  sessionId,
  window,
  atTop,
  loading,
  failed,
  disabled,
  onLoad,
}: {
  sessionId: string;
  window: AgentSessionHistoryWindow;
  atTop: boolean;
  loading: boolean;
  failed: boolean;
  disabled: boolean;
  onLoad: NonNullable<ChatNavigationActions["onLoadHistory"]>;
}): JSX.Element | null {
  const { reduceMotion } = useMotionLevel();
  const canLoadEarlier = Boolean(window.before);
  const prepend = window.mode === "prepend";
  const visible = loading || failed || prepend || (atTop && canLoadEarlier);
  const [entered, setEntered] = useState(reduceMotion);

  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    if (reduceMotion) {
      setEntered(true);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, visible]);

  if (!visible) return null;

  const state: HistoryNavigationState = loading ? "loading" : failed ? "failed" : prepend ? "prepend" : "earlier";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-3 pt-2">
      <div
        aria-busy={loading || undefined}
        aria-live="polite"
        data-history-navigation={state}
        className={cn(
          "pointer-events-auto inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg px-2.5 text-[11px] leading-none",
          "bg-[linear-gradient(180deg,rgb(var(--color-paper-50)/0.84),rgb(var(--color-paper-100)/0.6))]",
          "backdrop-blur-[8px] backdrop-saturate-[1.08]",
          "shadow-[0_0_0_1px_rgb(var(--color-ink-950)/0.07),0_1px_2px_rgb(var(--color-ink-950)/0.05),inset_0_1px_0_rgb(var(--color-paper-50)/0.9)]",
          "transition-[opacity,transform] duration-200 ease-out",
          entered ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
          failed
            ? "text-brick-600 shadow-[0_0_0_1px_rgb(var(--color-brick-500)/0.26),0_1px_2px_rgb(var(--color-ink-950)/0.05),inset_0_1px_0_rgb(var(--color-paper-50)/0.9)]"
            : "text-content-secondary",
        )}
      >
        {state === "loading" ? (
          <>
            <Spinner size="xs" />
            <span>{frontendMessage("chat.history.loading")}</span>
          </>
        ) : state === "failed" ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onLoad(sessionId, canLoadEarlier ? { refresh: true, before: window.before } : { refresh: true })
            }
            className="inline-flex items-center rounded-[5px] px-0.5 py-1 outline-none transition-colors hover:text-brick-700 focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-55"
          >
            {frontendMessage("chat.history.retry")}
          </button>
        ) : state === "prepend" ? (
          <>
            <span>{frontendMessage("chat.history.viewingEarlier")}</span>
            <span aria-hidden="true" className="h-2.5 w-px bg-ink-900/15" />
            <button
              type="button"
              disabled={disabled || loading}
              onClick={() => onLoad(sessionId, { refresh: true })}
              className="inline-flex items-center rounded-[5px] px-0.5 py-1 text-ink-700 underline decoration-ink-950/20 decoration-1 underline-offset-2 outline-none transition-colors hover:text-ink-950 focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-55"
            >
              {frontendMessage("chat.history.returnCurrent")}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onLoad(sessionId, { refresh: true, before: window.before })}
            className="inline-flex items-center gap-1 rounded-[5px] px-0.5 py-1 outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-accent-focus disabled:pointer-events-none disabled:opacity-55"
          >
            <AppIcon icon="chevron-up" size={12} className="text-content-muted" />
            <span>{frontendMessage("chat.history.loadEarlier")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
