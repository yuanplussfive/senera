import { Copy, ListTree, PanelLeft, RefreshCw, SquarePen } from "lucide-react";
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import { toast } from "sonner";
import { frontendMessage } from "../i18n/frontendMessageCatalog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  writeClipboardText,
} from "../shared/ui";

export interface WorkspaceContextMenuProps {
  children: ReactElement;
  onNewSession?: () => void;
  onOpenSessionPanel?: () => void;
  onOpenWorkflowPanel?: () => void;
  onRefreshSession?: () => void;
}

export function WorkspaceContextMenu({
  children,
  onNewSession,
  onOpenSessionPanel,
  onOpenWorkflowPanel,
  onRefreshSession,
}: WorkspaceContextMenuProps): JSX.Element {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [selectionAvailable, setSelectionAvailable] = useState(false);

  const handleOpenChange = useCallback((open: boolean): void => {
    setSelectionAvailable(open && readSelectedText().trim().length > 0);
  }, []);

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (isNativeContextTarget(event.target)) return;
    event.preventDefault();
    triggerRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    );
  }, []);

  const handleCopySelection = useCallback((): void => {
    const selectedText = readSelectedText();
    if (!selectedText.trim()) return;
    void writeClipboardText(selectedText).then(
      () => toast.success(frontendMessage("clipboard.copied")),
      () => toast.error(frontendMessage("clipboard.copyFailed")),
    );
  }, []);

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenuTrigger asChild>
        <span
          ref={triggerRef}
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
          data-senera-context-menu-anchor
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[224px]" data-senera-context-menu>
        <ContextMenuLabel>{frontendMessage("workspace.contextMenu")}</ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<SquarePen className="h-4 w-4" />}
          disabled={!onNewSession}
          onSelect={() => onNewSession?.()}
        >
          {frontendMessage("workspace.context.newSession")}
        </ContextMenuItem>
        <ContextMenuItem
          icon={<PanelLeft className="h-4 w-4" />}
          disabled={!onOpenSessionPanel}
          onSelect={() => onOpenSessionPanel?.()}
        >
          {frontendMessage("workspace.context.openSessions")}
        </ContextMenuItem>
        <ContextMenuItem
          icon={<ListTree className="h-4 w-4" />}
          disabled={!onOpenWorkflowPanel}
          onSelect={() => onOpenWorkflowPanel?.()}
        >
          {frontendMessage("workspace.context.openWorkflow")}
        </ContextMenuItem>
        <ContextMenuItem
          icon={<RefreshCw className="h-4 w-4" />}
          disabled={!onRefreshSession}
          onSelect={() => onRefreshSession?.()}
        >
          {frontendMessage("workspace.context.refreshSession")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<Copy className="h-4 w-4" />}
          disabled={!selectionAvailable}
          shortcut="Ctrl+C"
          onSelect={handleCopySelection}
        >
          {frontendMessage("workspace.context.copySelection")}
        </ContextMenuItem>
      </ContextMenuContent>
      <div className="contents" onContextMenu={handleContextMenu}>
        {children}
      </div>
    </ContextMenu>
  );
}

function readSelectedText(): string {
  if (typeof window === "undefined") return "";
  return window.getSelection()?.toString() ?? "";
}

function isNativeContextTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input,textarea,select,button,a,[contenteditable='true'],[data-native-context-menu],[data-session-row]",
    ),
  );
}
