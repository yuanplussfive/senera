import {
  ChevronDown,
  ChevronUp,
  CircleStop,
  Ellipsis,
  Info,
  RefreshCw,
  Search,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import type { ExecutionResourceSnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "../../shared/ui";
import {
  isTerminalState,
  supportsTerminalCapability,
  terminalStatusIndicatorClass,
  terminalStatusLabel,
  terminalTabLabel,
  TerminalSurfaceStyle,
} from "./terminalPresentation";

type TerminalSignal = "interrupt" | "terminate" | "kill";

export interface TerminalTitlebarProps {
  resources: readonly ExecutionResourceSnapshotData[];
  selected?: ExecutionResourceSnapshotData;
  searchOpen: boolean;
  onSelect: (resourceId: string) => void;
  onSearchOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onSignal: (resourceId: string, signal: TerminalSignal) => void;
  onStopAll: () => void;
}

export function TerminalTitlebar(props: TerminalTitlebarProps): JSX.Element {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIsActive = Boolean(props.selected && !isTerminalState(props.selected.state));
  const canSignal = Boolean(props.selected && supportsTerminalCapability(props.selected, "signals"));

  const focusTab = (index: number): void => {
    const resource = props.resources.at(index);
    if (!resource) return;
    props.onSelect(resource.resourceId);
    tabRefs.current.at(index)?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const lastIndex = props.resources.length - 1;
    const destination = resolveTabDestination(event.key, index, lastIndex);
    if (destination === undefined) return;
    event.preventDefault();
    focusTab(destination);
  };

  return (
    <div className="flex h-full min-w-0 items-stretch gap-1">
      <div className="flex min-w-0 flex-1 items-stretch">
        <div
          className="grid w-8 shrink-0 place-items-center text-[var(--terminal-muted)]"
          aria-label={frontendMessage("terminal.panel.title")}
        >
          <SquareTerminal className="h-4 w-4" aria-hidden="true" />
        </div>
        {props.resources.length > 0 ? (
          <div
            role="tablist"
            aria-label={frontendMessage("terminal.resource.select")}
            className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {props.resources.map((resource, index) => {
              const selected = resource.resourceId === props.selected?.resourceId;
              const label = terminalTabLabel(resource);
              return (
                <button
                  key={resource.resourceId}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={label}
                  tabIndex={selected ? 0 : -1}
                  title={resource.command}
                  onClick={() => props.onSelect(resource.resourceId)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={cn(
                    "group relative flex h-full min-w-[92px] max-w-[180px] items-center gap-2 px-2.5 text-left outline-none",
                    "font-mono text-[11px] text-[var(--terminal-muted)] transition-colors",
                    "hover:bg-white/[0.045] hover:text-[var(--terminal-foreground)]",
                    "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--terminal-accent)]",
                    selected &&
                      "bg-[var(--terminal-canvas)] text-[var(--terminal-foreground)] after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-[var(--terminal-accent)]",
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", terminalStatusIndicatorClass(resource.state))}
                    aria-hidden="true"
                  />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span className="flex min-w-0 flex-1 items-center truncate px-1 text-[12px] font-medium text-[var(--terminal-foreground)]">
            {frontendMessage("terminal.panel.title")}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5" data-workbench-interactive>
        <IconButton
          label={frontendMessage("terminal.search.open")}
          tooltip={frontendMessage("terminal.search.open")}
          tooltipShortcut="Ctrl F"
          size="sm"
          onClick={() => props.onSearchOpenChange(!props.searchOpen)}
          disabled={!props.selected}
          className={terminalToolbarButtonClassName(props.searchOpen)}
        >
          <Search className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          label={frontendMessage("terminal.resource.interrupt")}
          tooltip={frontendMessage("terminal.resource.interrupt")}
          size="sm"
          onClick={() => props.selected && props.onSignal(props.selected.resourceId, "interrupt")}
          disabled={!props.selected || !selectedIsActive || !canSignal}
          className={cn(terminalToolbarButtonClassName(false), "hidden sm:grid")}
        >
          <Square className="h-3 w-3" />
        </IconButton>
        <TerminalActionsMenu {...props} selectedIsActive={selectedIsActive} canSignal={canSignal} />
      </div>
    </div>
  );
}

function TerminalActionsMenu(
  props: TerminalTitlebarProps & { selectedIsActive: boolean; canSignal: boolean },
): JSX.Element {
  const runningResources = props.resources.filter((resource) => !isTerminalState(resource.state));
  const selected = props.selected;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={frontendMessage("terminal.actions.open")}
          tooltip={frontendMessage("terminal.actions.open")}
          size="sm"
          className={terminalToolbarButtonClassName(false)}
        >
          <Ellipsis className="h-4 w-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        style={TerminalSurfaceStyle}
        className="w-64 border-[var(--terminal-border)] bg-[var(--terminal-elevated)] text-[var(--terminal-foreground)] shadow-2xl"
      >
        <DropdownMenuItem
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onSelect={props.onRefresh}
          className={terminalMenuItemClassName}
        >
          {frontendMessage("terminal.resource.refresh")}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Search className="h-3.5 w-3.5" />}
          onSelect={() => props.onSearchOpenChange(true)}
          disabled={!selected}
          shortcut="Ctrl F"
          className={terminalMenuItemClassName}
        >
          {frontendMessage("terminal.search.open")}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[var(--terminal-separator)]" />
        <DropdownMenuItem
          icon={<Square className="h-3 w-3" />}
          onSelect={() => selected && props.onSignal(selected.resourceId, "interrupt")}
          disabled={!selected || !props.selectedIsActive || !props.canSignal}
          className={terminalMenuItemClassName}
        >
          {frontendMessage("terminal.resource.interrupt")}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<CircleStop className="h-3.5 w-3.5" />}
          onSelect={() => selected && props.onSignal(selected.resourceId, "terminate")}
          disabled={!selected || !props.selectedIsActive || !props.canSignal}
          destructive
          className={terminalDestructiveMenuItemClassName}
        >
          {frontendMessage("terminal.resource.stop")}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<CircleStop className="h-3.5 w-3.5" />}
          onSelect={props.onStopAll}
          disabled={runningResources.length === 0}
          destructive
          className={terminalDestructiveMenuItemClassName}
        >
          {frontendMessage("terminal.resource.stopAll")}
        </DropdownMenuItem>
        {selected ? (
          <>
            <DropdownMenuSeparator className="bg-[var(--terminal-separator)]" />
            <DropdownMenuLabel className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 text-[10px] text-[var(--terminal-muted)]">
              <Info className="h-3 w-3" aria-hidden="true" />
              {frontendMessage("terminal.info.title")}
            </DropdownMenuLabel>
            <TerminalDetails resource={selected} />
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TerminalDetails({ resource }: { resource: ExecutionResourceSnapshotData }): JSX.Element {
  const details = resource.terminal
    ? [
        [frontendMessage("terminal.info.shell"), resource.terminal.shellDialect],
        [frontendMessage("terminal.info.backend"), resource.terminal.backend],
        [frontendMessage("terminal.info.boundary"), resource.terminal.effectiveBoundary],
        [frontendMessage("terminal.info.dimensions"), `${resource.terminal.columns}x${resource.terminal.rows}`],
      ]
    : [[frontendMessage("terminal.info.kind"), frontendMessage("terminal.kind.process")]];

  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-2.5 pb-2 font-mono text-[10px]">
      {details.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[var(--terminal-subtle)]">{label}</dt>
          <dd className="truncate text-right text-[var(--terminal-muted)]" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function TerminalSearchOverlay(props: {
  query: string;
  onQueryChange: (query: string) => void;
  onRunSearch: (direction: "next" | "previous") => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      role="search"
      className="absolute right-2 top-2 z-20 flex h-9 w-[min(320px,calc(100%-16px))] items-center gap-1 rounded border border-[var(--terminal-border)] bg-[var(--terminal-elevated)] px-2 shadow-xl"
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-[var(--terminal-subtle)]" aria-hidden="true" />
      <input
        value={props.query}
        onChange={(event) => props.onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
            return;
          }
          if (event.key === "Enter") props.onRunSearch(event.shiftKey ? "previous" : "next");
        }}
        placeholder={frontendMessage("terminal.search.placeholder")}
        aria-label={frontendMessage("terminal.search.placeholder")}
        autoFocus
        className="h-full min-w-0 flex-1 border-0 bg-transparent font-mono text-[11px] text-[var(--terminal-foreground)] outline-none placeholder:text-[var(--terminal-subtle)]"
      />
      <IconButton
        label={frontendMessage("terminal.search.previous")}
        tooltip={frontendMessage("terminal.search.previous")}
        size="sm"
        onClick={() => props.onRunSearch("previous")}
        disabled={!props.query.trim()}
        className={terminalToolbarButtonClassName(false)}
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        label={frontendMessage("terminal.search.next")}
        tooltip={frontendMessage("terminal.search.next")}
        size="sm"
        onClick={() => props.onRunSearch("next")}
        disabled={!props.query.trim()}
        className={terminalToolbarButtonClassName(false)}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        label={frontendMessage("terminal.search.close")}
        tooltip={frontendMessage("terminal.search.close")}
        size="sm"
        onClick={props.onClose}
        className={terminalToolbarButtonClassName(false)}
      >
        <X className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

export function TerminalStatusBar({ resource }: { resource: ExecutionResourceSnapshotData }): JSX.Element {
  return (
    <div className="flex h-6 shrink-0 items-center gap-2 border-t border-[var(--terminal-separator)] bg-[var(--terminal-chrome)] px-2.5 font-mono text-[10px]">
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", terminalStatusIndicatorClass(resource.state))}
        aria-hidden="true"
      />
      <span className="shrink-0 text-[var(--terminal-muted)]">{terminalStatusLabel(resource.state)}</span>
      <span className="min-w-0 flex-1 truncate text-[var(--terminal-subtle)]" title={resource.cwd}>
        {resource.cwd}
      </span>
      {resource.terminal ? (
        <span className="shrink-0 text-[var(--terminal-subtle)]">
          <span className="hidden sm:inline">{resource.terminal.shellDialect} · </span>
          {resource.terminal.columns}x{resource.terminal.rows}
        </span>
      ) : (
        <span className="shrink-0 text-[var(--terminal-subtle)]">{frontendMessage("terminal.kind.process")}</span>
      )}
    </div>
  );
}

function resolveTabDestination(key: string, currentIndex: number, lastIndex: number): number | undefined {
  if (lastIndex < 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return lastIndex;
  if (key === "ArrowRight") return currentIndex === lastIndex ? 0 : currentIndex + 1;
  if (key === "ArrowLeft") return currentIndex === 0 ? lastIndex : currentIndex - 1;
  return undefined;
}

function terminalToolbarButtonClassName(active: boolean): string {
  return cn(
    "h-7 w-7 text-[var(--terminal-muted)] hover:bg-white/[0.07] hover:text-[var(--terminal-foreground)]",
    active && "bg-white/[0.08] text-[var(--terminal-foreground)]",
  );
}

const terminalMenuItemClassName =
  "text-[var(--terminal-muted)] data-[highlighted]:bg-white/[0.07] data-[highlighted]:text-[var(--terminal-foreground)]";

const terminalDestructiveMenuItemClassName =
  "text-brick-300 data-[highlighted]:bg-brick-400/15 data-[highlighted]:text-brick-200";
