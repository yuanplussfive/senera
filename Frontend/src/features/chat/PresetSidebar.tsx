import { cva } from "class-variance-authority";
import { AlertTriangle, BookUser, Check, FileUp, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import type { PresetItem } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Button, IconButton, ScrollArea } from "../../shared/ui";
import { PresetFormatOptions, formatPresetTime, readPresetDisplayName } from "./presetPanelUtils";

const presetListItemClass = cva(
  "flex min-w-[220px] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition lg:w-full lg:min-w-0",
  {
    variants: {
      active: {
        true: "border-terra-200/80 bg-paper-50 text-ink-900 shadow-panel",
        false: "border-transparent text-ink-600 hover:border-ink-200/70 hover:bg-paper-50/70 hover:text-ink-900",
      },
    },
  },
);

export function PresetSidebar({
  activePreset,
  busy,
  enabled,
  filterText,
  importing,
  presets,
  rootDir,
  selectedName,
  totalPresets,
  onCreate,
  onFilterTextChange,
  onImport,
  onRefresh,
  onSelect,
}: {
  activePreset: PresetItem | null;
  busy: boolean;
  enabled: boolean;
  filterText: string;
  importing: boolean;
  presets: PresetItem[];
  rootDir: string;
  selectedName: string | null;
  totalPresets: number;
  onCreate: () => void;
  onFilterTextChange: (value: string) => void;
  onImport: () => void;
  onRefresh: () => void;
  onSelect: (name: string) => void;
}): JSX.Element {
  return (
    <aside className="flex min-h-0 w-full min-w-0 flex-col border-b border-ink-200/70 bg-[#f2ece2] lg:h-full lg:border-b-0 lg:border-r">
      <div className="shrink-0 border-b border-ink-200/60 px-3.5 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink-900">{frontendMessage("preset.ui.localPresets")}</span>
            <span
              className={cn(
                "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10.5px]",
                enabled ? "bg-terra-50 text-terra-700" : "bg-ink-900/[0.045] text-ink-400",
              )}
            >
              {frontendMessage(enabled ? "preset.ui.enabled" : "preset.ui.disabled")}
            </span>
          </div>
          <div className="mt-1.5 min-w-0 truncate text-[11px] text-ink-500">
            {activePreset
              ? readPresetDisplayName(activePreset.title || activePreset.name)
              : frontendMessage("preset.ui.fileCount", { count: totalPresets })}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onImport}
            className="h-8 justify-start bg-paper-50 px-2.5"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
            {frontendMessage("preset.ui.import")}
          </Button>
          <IconButton
            label={frontendMessage("preset.ui.create")}
            tooltip={frontendMessage("preset.ui.create")}
            size="md"
            tone="muted"
            className="bg-paper-50"
            disabled={busy}
            onClick={onCreate}
          >
            <Plus className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label={frontendMessage("preset.ui.refresh")}
            tooltip={frontendMessage("preset.ui.refresh")}
            size="md"
            tone="muted"
            className="bg-paper-50"
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            value={filterText}
            onChange={(event) => onFilterTextChange(event.currentTarget.value)}
            placeholder={frontendMessage("preset.ui.searchPlaceholder")}
            spellCheck={false}
            className="h-8 w-full rounded-lg border border-ink-200 bg-paper-50 pl-8 pr-2.5 text-[12px] text-ink-800 shadow-sm outline-none transition placeholder:text-ink-400 focus:border-terra-300 focus:ring-2 focus:ring-terra-100"
          />
        </div>
      </div>

      <ScrollArea className="h-[132px] shrink-0 overflow-x-auto lg:h-auto lg:min-h-0 lg:flex-1 lg:overflow-x-hidden">
        <div className="flex gap-1.5 px-2.5 py-2.5 lg:block lg:space-y-1.5">
          {presets.map((preset) => (
            <PresetListItem
              key={preset.name}
              preset={preset}
              active={selectedName === preset.name}
              onClick={() => onSelect(preset.name)}
            />
          ))}
          {presets.length === 0 ? <EmptyPresetList filtered={filterText.trim().length > 0} /> : null}
        </div>
      </ScrollArea>

      {rootDir ? (
        <div className="hidden shrink-0 border-t border-ink-200/60 px-3.5 py-2.5 font-mono text-[10.5px] text-ink-400 lg:block">
          <div className="truncate">{rootDir}</div>
        </div>
      ) : null}
    </aside>
  );
}

function PresetListItem({
  preset,
  active,
  onClick,
}: {
  preset: PresetItem;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const displayName = readPresetDisplayName(preset.title || preset.name);
  const formatLabel = PresetFormatOptions.find((option) => option.value === preset.format)?.label ?? preset.format;
  return (
    <button type="button" className={presetListItemClass({ active })} onClick={onClick}>
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-md",
          preset.active ? "bg-terra-100 text-terra-700" : "bg-ink-900/[0.045] text-ink-400",
        )}
      >
        <BookUser className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">
          {displayName || frontendMessage("preset.ui.unnamed")}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-400">
          {formatLabel} · {formatPresetTime(preset.updatedAt)}
        </span>
      </span>
      {preset.active ? <Check className="h-3.5 w-3.5 shrink-0 text-terra-500" /> : null}
      {preset.diagnostics.length > 0 ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : null}
    </button>
  );
}

function EmptyPresetList({ filtered }: { filtered: boolean }): JSX.Element {
  return (
    <div className="flex min-h-20 min-w-[220px] items-center justify-center rounded-lg border border-dashed border-ink-200 bg-paper-50/60 px-3 text-[12px] text-ink-400 lg:min-w-0">
      {frontendMessage(filtered ? "preset.ui.noMatches" : "preset.ui.empty")}
    </div>
  );
}
