import { cva } from "class-variance-authority";
import { AlertTriangle, BookOpenText, Check, Plus, RefreshCw, Search } from "lucide-react";
import type { PresetItem } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { Button, IconButton, RefreshOrbit, ScrollArea, StateView } from "../../shared/ui";
import { useStore } from "../../store/sessionStore";

const presetListItemClass = cva(
  "group flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150",
  {
    variants: {
      active: {
        true: "bg-accent-surface text-accent-content",
        false: "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
      },
    },
  },
);

export function PresetSidebar({
  activePreset,
  busy,
  enabled,
  filterText,
  presets,
  selectedName,
  onCreate,
  onFilterTextChange,
  onRefresh,
  onSelect,
}: {
  activePreset: PresetItem | null;
  busy: boolean;
  enabled: boolean;
  filterText: string;
  presets: PresetItem[];
  selectedName: string | null;
  onCreate: () => void;
  onFilterTextChange: (value: string) => void;
  onRefresh: () => void;
  onSelect: (name: string) => void;
}): JSX.Element {
  return (
    <aside className="flex h-[210px] min-h-0 w-full min-w-0 shrink-0 flex-col border-b border-line bg-surface-subtle sm:h-full sm:w-[244px] sm:border-b-0 sm:border-r">
      <div className="flex items-start justify-between gap-2 border-b border-line-subtle px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-content-primary">{frontendMessage("preset.ui.title")}</span>
            <span
              className={cn(
                "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10.5px]",
                enabled ? "bg-accent-surface text-accent-content" : "bg-ink-900/[0.045] text-content-muted",
              )}
            >
              {enabled ? frontendMessage("preset.ui.enabled") : frontendMessage("preset.ui.disabled")}
            </span>
          </div>
          <div className="mt-0.5 min-w-0 truncate text-[11px] text-content-secondary">
            {activePreset?.title || frontendMessage("preset.ui.summary")}
          </div>
        </div>
        <IconButton
          label={frontendMessage("preset.ui.refresh")}
          tooltip={frontendMessage("preset.ui.refresh")}
          size="md"
          tone="muted"
          disabled={busy}
          onClick={onRefresh}
        >
          {busy ? <RefreshOrbit size="sm" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </IconButton>
      </div>

      <div className="border-b border-line-subtle px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" />
          <input
            value={filterText}
            onChange={(event) => onFilterTextChange(event.currentTarget.value)}
            placeholder={frontendMessage("preset.ui.searchPlaceholder")}
            spellCheck={false}
            className="h-8 w-full rounded-lg border border-line bg-surface-panel pl-8 pr-2.5 text-[12px] text-content-primary shadow-sm outline-none transition placeholder:text-content-muted focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={onCreate}
          className="mt-2 h-8 w-full justify-start"
        >
          <Plus className="h-3.5 w-3.5" />
          {frontendMessage("preset.ui.create")}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-0.5 p-2">
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
  return (
    <button type="button" className={presetListItemClass({ active })} onClick={onClick}>
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-md",
          preset.active ? "bg-accent-surface-hover text-accent-content" : "bg-ink-900/[0.045] text-content-muted",
        )}
      >
        <BookOpenText className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">
          {preset.title || frontendMessage("preset.ui.unnamed")}
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] text-content-muted">
          {preset.card
            ? frontendMessage("preset.ui.cardSummary", {
                examples: preset.card.examples.length,
                lore: preset.card.lore.length,
              })
            : frontendMessage("preset.ui.needsRebuild")}
        </span>
      </span>
      {preset.active ? <Check className="h-3.5 w-3.5 shrink-0 text-accent-content" /> : null}
      {preset.diagnostics.length > 0 ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-umber-500" /> : null}
    </button>
  );
}

function EmptyPresetList({ filtered }: { filtered: boolean }): JSX.Element {
  const synced = useStore((state) => state.catalogSynced.presets);
  if (!filtered && !synced) return <StateView status="loading" className="min-h-20 px-3 py-3" />;
  return (
    <StateView
      status="empty"
      className="min-h-20 px-3 py-3"
      description={filtered ? frontendMessage("preset.ui.noMatches") : frontendMessage("preset.ui.empty")}
    />
  );
}
