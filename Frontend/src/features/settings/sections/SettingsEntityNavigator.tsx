import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../../lib/util";
import { FluidHoverHighlight, useFluidHover, useMotionLevel } from "../../../shared/motion";
import { AppIcon, IconButton, Input, MenuSelect, ScrollArea } from "../../../shared/ui";

export interface SettingsEntityNavigatorGroup<T> {
  readonly id: string;
  readonly label: string;
  readonly items: readonly T[];
}

export interface SettingsEntityNavigatorFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface SettingsEntityNavigatorItemRenderContext {
  readonly fluidHoverEnabled: boolean;
}

interface SettingsEntityNavigatorProps<T> {
  readonly title: string;
  readonly summary: string;
  readonly groups: readonly SettingsEntityNavigatorGroup<T>[];
  readonly search: string;
  readonly searchPlaceholder: string;
  readonly clearSearchLabel: string;
  readonly filterLabel: string;
  readonly filterValue: string;
  readonly filterOptions: readonly SettingsEntityNavigatorFilterOption[];
  readonly emptyMessage: string;
  readonly refreshAction?: ReactNode;
  readonly getItemKey: (item: T) => string;
  readonly selectedItemKey?: string | null;
  readonly renderItem: (item: T, context: SettingsEntityNavigatorItemRenderContext) => ReactNode;
  readonly onSearchChange: (value: string) => void;
  readonly onFilterChange: (value: string) => void;
}

/**
 * A data-agnostic master pane for settings surfaces with real, published
 * entities. Selection and mutation intentionally remain owned by each feature.
 */
export function SettingsEntityNavigator<T>({
  title,
  summary,
  groups,
  search,
  searchPlaceholder,
  clearSearchLabel,
  filterLabel,
  filterValue,
  filterOptions,
  emptyMessage,
  refreshAction,
  getItemKey,
  selectedItemKey,
  renderItem,
  onSearchChange,
  onFilterChange,
}: SettingsEntityNavigatorProps<T>): JSX.Element {
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const navigatorListRef = useRef<HTMLDivElement>(null);
  const navigatorHover = useFluidHover(navigatorListRef, { axis: "y", gapClick: false });
  const { disableMotion } = useMotionLevel();
  const visibleGroups = groups.filter((group) => group.items.length > 0);
  const displayedGroups = visibleGroups.map((group) => ({
    group,
    collapsed: collapsedGroups.has(group.id),
  }));
  const displayedItems = displayedGroups.flatMap(({ group, collapsed }) => (collapsed ? [] : group.items));
  const selectedIndex = selectedItemKey ? displayedItems.findIndex((item) => getItemKey(item) === selectedItemKey) : -1;
  const itemRenderContext: SettingsEntityNavigatorItemRenderContext = {
    fluidHoverEnabled: !disableMotion,
  };
  const selectionAwareHover = {
    ...navigatorHover,
    activeIndex: navigatorHover.activeIndex ?? selectedIndex,
  };

  useEffect(() => {
    const visibleIds = new Set(visibleGroups.map((group) => group.id));
    setCollapsedGroups((current) => {
      const next = new Set([...current].filter((groupId) => visibleIds.has(groupId)));
      return next.size === current.size ? current : next;
    });
  }, [visibleGroups]);

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-line-subtle/70 bg-surface-subtle"
      data-settings-entity-navigator
    >
      <div className="shrink-0 border-b border-line-subtle/70 px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-content-primary">{title}</h2>
            <p className="mt-1 text-[11px] text-content-muted">{summary}</p>
          </div>
          {refreshAction}
        </div>
        <div className="relative mt-3">
          <AppIcon
            icon="search"
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            size="sm"
            className="h-8 pl-8 pr-8 text-[12px]"
          />
          {search ? (
            <IconButton
              label={clearSearchLabel}
              size="sm"
              tone="muted"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => onSearchChange("")}
            >
              <AppIcon icon="close" size={13} aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        <div className="mt-2">
          <MenuSelect
            value={filterValue}
            placeholder={filterLabel}
            ariaLabel={filterLabel}
            leading={<AppIcon icon="sliders" size={14} aria-hidden="true" />}
            options={filterOptions}
            triggerClassName="h-8 bg-surface-canvas text-[12px]"
            onChange={onFilterChange}
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
        {visibleGroups.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-content-muted">{emptyMessage}</p>
        ) : (
          <div
            ref={navigatorListRef}
            className="relative py-2"
            {...navigatorHover.handlers}
            data-settings-entity-navigator-list
          >
            <FluidHoverHighlight hover={selectionAwareHover} hidden={false} className="rounded-md" />
            {(() => {
              let itemIndex = 0;
              return displayedGroups.map(({ group, collapsed }) => {
                return (
                  <section key={group.id} data-settings-entity-group={group.id}>
                    <button
                      type="button"
                      className="flex h-8 w-full items-center gap-1.5 px-4 text-left text-[10.5px] font-medium text-content-muted transition-colors hover:text-content-secondary"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setCollapsedGroups((current) => {
                          const next = new Set(current);
                          if (next.has(group.id)) next.delete(group.id);
                          else next.add(group.id);
                          return next;
                        })
                      }
                    >
                      <AppIcon
                        icon="chevron-right"
                        size={13}
                        className={cn("transition-transform", !collapsed && "rotate-90")}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <span className="tabular-nums text-content-muted">{group.items.length}</span>
                    </button>
                    {!collapsed ? (
                      <div className="px-2">
                        {group.items.map((item) => {
                          const index = itemIndex;
                          itemIndex += 1;
                          return (
                            <div
                              ref={navigatorHover.getItemRef(index)}
                              key={getItemKey(item)}
                              className="relative z-10"
                            >
                              <div className="relative z-[1]">{renderItem(item, itemRenderContext)}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              });
            })()}
          </div>
        )}
      </ScrollArea>
    </aside>
  );
}
