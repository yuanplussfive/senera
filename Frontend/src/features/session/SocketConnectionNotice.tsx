import { useEffect, useRef, useState } from "react";
import type { SocketStatus } from "../../api/useAgentSocket";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { AppIcon, Button, IconButton, Tooltip } from "../../shared/ui";
import {
  readSocketConnectionPresentation,
  SocketConnectionToneStyles,
  type SocketConnectionPresentation,
} from "./socketConnectionPresentation";

/** How long a recovered socket keeps confirming itself before going quiet. */
const RECOVERY_CONFIRMATION_MS = 2000;

/**
 * Sidebar connection surface.
 *
 * A healthy socket renders nothing, so the footer never grows a permanent
 * status row; a degraded socket stays visible until it recovers, and a
 * recovery confirms itself briefly. Clicking retries immediately.
 */
export function SocketConnectionNotice({
  status,
  onReconnect,
  collapsed = false,
}: {
  status: SocketStatus;
  onReconnect?: () => void;
  collapsed?: boolean;
}): JSX.Element | null {
  const presentation = readSocketConnectionPresentation(status);
  const openedOnceRef = useRef(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);

  useEffect(() => {
    if (status !== "open") {
      setConfirmationVisible(false);
      return undefined;
    }
    const recovered = openedOnceRef.current;
    openedOnceRef.current = true;
    if (!recovered) return undefined;
    setConfirmationVisible(true);
    const timer = window.setTimeout(() => setConfirmationVisible(false), RECOVERY_CONFIRMATION_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (!presentation) return null;
  if (presentation.transient && !confirmationVisible) return null;

  return collapsed ? (
    <CollapsedNotice presentation={presentation} onReconnect={onReconnect} />
  ) : (
    <ExpandedNotice presentation={presentation} onReconnect={onReconnect} />
  );
}

function ExpandedNotice({
  presentation,
  onReconnect,
}: {
  presentation: SocketConnectionPresentation;
  onReconnect?: () => void;
}): JSX.Element {
  const tone = SocketConnectionToneStyles[presentation.tone];
  const label = frontendMessage(presentation.messageKey);
  const retryable = presentation.retryable && !!onReconnect;

  return (
    <div className="flex items-center gap-2 px-3 pb-2" data-socket-connection-notice={presentation.tone}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
      <span aria-live="polite" className={cn("min-w-0 flex-1 truncate text-[11.5px] font-medium", tone.text)}>
        {label}
      </span>
      {retryable ? (
        <Button variant="ghost" size="sm" onClick={onReconnect} className="shrink-0 px-1.5 text-[11px]">
          {frontendMessage("connection.reconnect")}
        </Button>
      ) : null}
    </div>
  );
}

function CollapsedNotice({
  presentation,
  onReconnect,
}: {
  presentation: SocketConnectionPresentation;
  onReconnect?: () => void;
}): JSX.Element {
  const tone = SocketConnectionToneStyles[presentation.tone];
  const label = frontendMessage(presentation.messageKey);
  const dot = <span className={cn("h-2 w-2 rounded-full", tone.dot)} aria-hidden="true" />;

  if (!presentation.retryable || !onReconnect) {
    return (
      <Tooltip content={label} side="right">
        <div
          className="grid h-8 place-items-center"
          aria-label={label}
          role="status"
          tabIndex={0}
          data-socket-connection-notice={presentation.tone}
        >
          {dot}
        </div>
      </Tooltip>
    );
  }

  return (
    <IconButton
      onClick={onReconnect}
      label={`${label} · ${frontendMessage("connection.reconnect")}`}
      tooltip={`${label} · ${frontendMessage("connection.reconnect")}`}
      tooltipSide="right"
      tone="muted"
      className="mx-auto flex"
      data-socket-connection-notice={presentation.tone}
    >
      <AppIcon icon="refresh" size={14} className={tone.text} />
    </IconButton>
  );
}
