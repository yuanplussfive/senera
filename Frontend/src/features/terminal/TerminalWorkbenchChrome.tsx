import { useRef, useState, type ReactNode } from "react";
import type { ISearchResultChangeEvent } from "@xterm/addon-search";
import type { ExecutionResourceSnapshotData, ExecutionResourceState } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { frontendFeatureMessage } from "../../i18n/frontendFeatureMessageCatalog";
import { cn } from "../../lib/util";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  AppIcon,
  IconButton,
  Input,
  Tooltip,
} from "../../shared/ui";
import {
  isTerminalState,
  supportsTerminalCapability,
  terminalConnectionPresentation,
  terminalStatusLabel,
  terminalPurposeLabel,
  terminalSelectionOptions,
} from "./terminalPresentation";
import { TerminalOverlayStyle } from "./terminalTheme";
import type { TerminalRendererState } from "./TerminalRenderer";

type TerminalSignal = "interrupt" | "terminate" | "kill";

export interface TerminalToolbarProps {
  resources: readonly ExecutionResourceSnapshotData[];
  selected?: ExecutionResourceSnapshotData;
  onStartTerminal: () => void;
  onSearchOpen: () => void;
  onSplit?: () => void;
  onRefresh: () => void;
  onSignal: (resourceId: string, signal: TerminalSignal) => void;
  onStopAll: () => void;
  onClose: (resourceId: string) => void;
  renderer?: TerminalRendererState;
  panelActions?: ReactNode;
}

export function TerminalToolbar(props: TerminalToolbarProps): JSX.Element {
  const selectedIsActive = Boolean(props.selected && !isTerminalState(props.selected.state));
  const canSignal = Boolean(
    props.selected && (props.selected.kind === "process" || supportsTerminalCapability(props.selected, "signals")),
  );
  return (
    <div className="flex h-full shrink-0 items-center gap-0.5 px-1" data-workbench-interactive>
      <IconButton
        label={frontendFeatureMessage("terminal.resource.create")}
        tooltip={frontendFeatureMessage("terminal.resource.create")}
        size="sm"
        onClick={props.onStartTerminal}
        className={terminalToolbarButtonClassName(false)}
      >
        <AppIcon icon="plus" size={14} />
      </IconButton>
      <IconButton
        label={frontendMessage("terminal.search.open")}
        tooltip={frontendMessage("terminal.search.open")}
        tooltipShortcut="Ctrl F"
        size="sm"
        onClick={props.onSearchOpen}
        disabled={!props.selected}
        className={terminalToolbarButtonClassName(false)}
      >
        <AppIcon icon="search" size={14} />
      </IconButton>
      <TerminalActionsMenu {...props} selectedIsActive={selectedIsActive} canSignal={canSignal} />
      {props.panelActions}
    </div>
  );
}

function TerminalActionsMenu(
  props: TerminalToolbarProps & { selectedIsActive: boolean; canSignal: boolean },
): JSX.Element {
  const [infoOpen, setInfoOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const requestedInfo = useRef(false);
  const selected = props.selected;
  const hasRunningResources = props.resources.some((resource) => !isTerminalState(resource.state));
  const label = terminalSelectionOptions(props.resources).find(
    (option) => option.value === selected?.resourceId,
  )?.label;
  return (
    <Popover open={infoOpen && Boolean(selected)} onOpenChange={setInfoOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <IconButton
              ref={trigger}
              label={frontendMessage("terminal.actions.open")}
              tooltip={frontendMessage("terminal.actions.open")}
              size="sm"
              className={terminalToolbarButtonClassName(false)}
            >
              <AppIcon icon="more" size={16} />
            </IconButton>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          style={TerminalOverlayStyle}
          className="w-56 border-[var(--terminal-border)] text-[var(--terminal-foreground)]"
          onCloseAutoFocus={(event) => {
            if (requestedInfo.current) {
              event.preventDefault();
              requestedInfo.current = false;
              setInfoOpen(true);
            }
          }}
        >
          <DropdownMenuItem
            icon={<AppIcon icon="refresh" size={14} />}
            onSelect={props.onRefresh}
            className={terminalMenuItemClassName}
          >
            {frontendMessage("terminal.resource.refresh")}
          </DropdownMenuItem>
          {props.onSplit ? (
            <DropdownMenuItem onSelect={props.onSplit} className={terminalMenuItemClassName}>
              {frontendFeatureMessage("terminal.layout.split")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            icon={<AppIcon icon="info" size={14} />}
            onSelect={() => {
              requestedInfo.current = true;
            }}
            disabled={!selected}
            className={terminalMenuItemClassName}
          >
            {frontendMessage("terminal.info.title")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[var(--terminal-separator)]" />
          <DropdownMenuItem
            icon={<AppIcon icon="square" size={12} />}
            onSelect={() => selected && props.onSignal(selected.resourceId, "interrupt")}
            disabled={!selected || !props.selectedIsActive || !props.canSignal}
            className={terminalMenuItemClassName}
          >
            {frontendMessage("terminal.resource.interrupt")}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<AppIcon icon="stop-circle" size={14} />}
            onSelect={() => selected && props.onSignal(selected.resourceId, "terminate")}
            disabled={!selected || !props.selectedIsActive || !props.canSignal}
            destructive
            className={terminalDestructiveMenuItemClassName}
          >
            {frontendMessage("terminal.resource.stop")}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<AppIcon icon="close" size={14} />}
            onSelect={() => selected && props.onClose(selected.resourceId)}
            disabled={!selected}
            className={terminalMenuItemClassName}
          >
            {frontendFeatureMessage("terminal.resource.close")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-[var(--terminal-separator)]" />
          <DropdownMenuItem
            icon={<AppIcon icon="stop-circle" size={14} />}
            onSelect={props.onStopAll}
            disabled={!hasRunningResources}
            destructive
            className={terminalDestructiveMenuItemClassName}
          >
            {frontendMessage("terminal.resource.stopAll")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {selected ? (
        <PopoverContent
          align="end"
          sideOffset={6}
          style={TerminalOverlayStyle}
          aria-label={frontendMessage("terminal.info.title")}
          className="w-[min(320px,calc(100vw-24px))] border-[var(--terminal-border)] bg-[var(--terminal-elevated)] p-4 text-[var(--terminal-foreground)]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <TerminalDetails
            resource={selected}
            label={label}
            renderer={props.renderer}
            onClose={() => setInfoOpen(false)}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

function TerminalDetails({
  resource,
  label,
  renderer,
  onClose,
}: {
  resource: ExecutionResourceSnapshotData;
  label?: string;
  renderer?: TerminalRendererState;
  onClose: () => void;
}): JSX.Element {
  const terminal = resource.terminal;
  const details = [
    ...(terminal
      ? [
          [frontendMessage("terminal.info.shell"), terminal.shellDialect],
          [frontendMessage("terminal.info.backend"), terminal.backend],
          [frontendMessage("terminal.info.boundary"), terminal.effectiveBoundary],
        ]
      : []),
    [frontendFeatureMessage("terminal.info.command"), resource.command],
  ];
  return (
    <div className="select-text">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-[13px] font-semibold">{label}</h2>
          <p className="mt-1 text-[11px] text-[var(--terminal-muted)]">
            {terminalPurposeLabel(resource)} · {terminalStatusLabel(resource.state)}
          </p>
        </div>
        <IconButton
          label={frontendMessage("ui.close")}
          size="sm"
          onClick={onClose}
          className="-mr-1 -mt-1 h-6 w-6 text-[var(--terminal-muted)]"
        >
          <AppIcon icon="close" size={13} />
        </IconButton>
      </div>
      <dl className="mt-4 space-y-3 text-[12px]">
        <div>
          <dt className="text-[10px] text-[var(--terminal-subtle)]">
            {frontendFeatureMessage("terminal.info.directory")}
          </dt>
          <dd className="mt-1 break-all font-mono leading-5">{resource.cwd}</dd>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {terminal ? (
            <div>
              <dt className="text-[10px] text-[var(--terminal-subtle)]">
                {frontendMessage("terminal.info.dimensions")}
              </dt>
              <dd className="mt-1 tabular-nums">
                {terminal.columns} × {terminal.rows}
              </dd>
            </div>
          ) : null}
          {renderer ? (
            <div>
              <dt className="text-[10px] text-[var(--terminal-subtle)]">
                {frontendFeatureMessage("terminal.renderer.info")}
              </dt>
              <dd className="mt-1 break-words">{terminalRendererDescription(renderer)}</dd>
            </div>
          ) : null}
        </div>
      </dl>
      <details className="group mt-4 border-t border-[var(--terminal-separator)] pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between text-[11px] text-[var(--terminal-muted)] outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
          {frontendFeatureMessage("terminal.info.runtime")}
          <AppIcon icon="chevron-down" size={12} className="transition-transform group-open:rotate-180" />
        </summary>
        <dl className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[11px] leading-5">
          {details.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-[var(--terminal-subtle)]">{name}</dt>
              <dd className="break-all font-mono text-[var(--terminal-muted)]">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export function TerminalSearchOverlay(props: {
  query: string;
  result?: ISearchResultChangeEvent;
  onQueryChange: (query: string) => void;
  onRunSearch: (direction: "next" | "previous") => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      role="search"
      className="absolute right-2 top-2 z-20 flex h-9 w-[min(320px,calc(100%-16px))] items-center gap-1 rounded border border-[var(--terminal-border)] bg-[var(--terminal-elevated)] px-2 shadow-soft"
    >
      <AppIcon icon="search" size={14} className="shrink-0 text-[var(--terminal-subtle)]" aria-hidden="true" />
      <Input
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
        className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0 font-mono text-[11px] text-[var(--terminal-foreground)] shadow-none outline-none focus-visible:ring-0 placeholder:text-[var(--terminal-subtle)]"
      />
      {props.query && props.result ? (
        <span role="status" className="shrink-0 text-[10px] tabular-nums text-[var(--terminal-muted)]">
          {props.result.resultCount === 0
            ? frontendFeatureMessage("terminal.search.noMatches")
            : frontendFeatureMessage("terminal.search.count", {
                index: Math.max(0, props.result.resultIndex + 1),
                count: props.result.resultCount,
              })}
        </span>
      ) : null}
      <IconButton
        label={frontendMessage("terminal.search.previous")}
        tooltip={frontendMessage("terminal.search.previous")}
        size="sm"
        onClick={() => props.onRunSearch("previous")}
        disabled={!props.query.trim()}
        className={terminalToolbarButtonClassName(false)}
      >
        <AppIcon icon="chevron-up" size={14} />
      </IconButton>
      <IconButton
        label={frontendMessage("terminal.search.next")}
        tooltip={frontendMessage("terminal.search.next")}
        size="sm"
        onClick={() => props.onRunSearch("next")}
        disabled={!props.query.trim()}
        className={terminalToolbarButtonClassName(false)}
      >
        <AppIcon icon="chevron-down" size={14} />
      </IconButton>
      <IconButton
        label={frontendMessage("terminal.search.close")}
        tooltip={frontendMessage("terminal.search.close")}
        size="sm"
        onClick={props.onClose}
        className={terminalToolbarButtonClassName(false)}
      >
        <AppIcon icon="close" size={14} />
      </IconButton>
    </div>
  );
}

export function TerminalConnectionIcon({ state }: { state: ExecutionResourceState }): JSX.Element {
  const { icon, className } = terminalConnectionPresentation(state);
  const label = terminalStatusLabel(state);
  return (
    <Tooltip content={label}>
      <span role="img" aria-label={label} className={cn("inline-flex shrink-0 items-center", className)}>
        <AppIcon icon={icon} size={14} />
      </span>
    </Tooltip>
  );
}

function terminalRendererDescription(renderer: TerminalRendererState): string {
  if (renderer.kind === "webgl") return frontendFeatureMessage("terminal.renderer.webgl");
  const descriptions = {
    inactive: "terminal.renderer.inactive",
    unavailable: "terminal.renderer.unavailable",
    "context-lost": "terminal.renderer.contextLost",
  } as const;
  const description = frontendFeatureMessage(descriptions[renderer.reason]);
  return renderer.detail ? `${description}: ${renderer.detail}` : description;
}

function terminalToolbarButtonClassName(active: boolean): string {
  return cn(
    "h-7 w-7 text-[var(--terminal-muted)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-foreground)]",
    active && "bg-[var(--terminal-hover)] text-[var(--terminal-foreground)]",
  );
}

const terminalMenuItemClassName =
  "text-[var(--terminal-muted)] data-[highlighted]:bg-[var(--terminal-hover)] data-[highlighted]:text-[var(--terminal-foreground)]";

const terminalDestructiveMenuItemClassName =
  "text-brick-600 data-[highlighted]:bg-brick-500/10 data-[highlighted]:text-brick-700";
