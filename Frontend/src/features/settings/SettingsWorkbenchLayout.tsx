import type { MutableRefObject, ReactNode, Ref } from "react";
import { motion } from "framer-motion";
import { Menu, Search, X } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { motionTimings, useMotionLevel } from "../../shared/motion";
import { IconButton, LogoLockup, LogoMark, ScrollArea, Sheet, SheetContent } from "../../shared/ui";
import { DiscardDraftDialog } from "./DiscardDraftDialog";
import type { groupSettingsSectionResults } from "./settingsPresentation";
import type { SettingsSectionDefinition, SettingsSectionId } from "./types";

export interface SettingsWorkbenchLayoutProps {
  activeSection: SettingsSectionDefinition;
  children: ReactNode;
  layout: "compact" | "persistent";
  navigation: ReactNode;
  navigationOpen: boolean;
  onNavigationOpenChange: (open: boolean) => void;
  overlay?: ReactNode;
  shellActions?: ReactNode;
  shellRef: Ref<HTMLDivElement>;
  showSectionHeader: boolean;
}

export function SettingsWorkbenchLayout({
  activeSection,
  children,
  layout,
  navigation,
  navigationOpen,
  onNavigationOpenChange,
  overlay,
  shellActions,
  shellRef,
  showSectionHeader,
}: SettingsWorkbenchLayoutProps): JSX.Element {
  return (
    <div
      ref={shellRef}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-canvas text-content-primary outline-none"
      data-settings-workbench
      data-settings-layout={layout}
      tabIndex={-1}
    >
      {layout === "compact" ? (
        <header
          className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line-subtle bg-surface-panel px-3"
          data-window-drag-region
          data-window-controls-inset
        >
          <IconButton
            label={frontendMessage("settings.nav.open")}
            tooltip={frontendMessage("settings.nav.open")}
            size="sm"
            tone="muted"
            onClick={() => onNavigationOpenChange(true)}
          >
            <Menu className="h-4 w-4" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-content-strong">{activeSection.label}</div>
          </div>
          {shellActions}
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {layout === "persistent" ? (
          <aside className="flex w-[224px] shrink-0 flex-col border-r border-line-subtle bg-surface-sidebar">
            <div
              className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-subtle px-4"
              data-window-drag-region
            >
              <div className="min-w-0 flex-1">
                <LogoLockup className="max-w-full" />
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-accent-solid" aria-hidden="true" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-content-muted">
                    {frontendMessage("settings.header.title")}
                  </span>
                </div>
              </div>
              {shellActions}
            </div>
            {navigation}
          </aside>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col bg-surface-subtle">
          {showSectionHeader ? <SettingsSectionHeader section={activeSection} /> : null}
          {children}
        </main>
      </div>

      <Sheet open={navigationOpen} onOpenChange={onNavigationOpenChange}>
        <SheetContent
          side="left"
          title={frontendMessage("settings.nav.title")}
          className="w-[min(320px,calc(100vw-24px))] p-0"
          showHeader={false}
          focusContentOnOpen
        >
          <div className="flex h-full min-h-0 flex-col bg-surface-canvas">
            <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line-subtle px-4">
              <LogoMark size={18} />
              <div className="min-w-0 flex-1 text-[14px] font-semibold text-content-strong">
                {frontendMessage("settings.header.title")}
              </div>
              <IconButton
                label={frontendMessage("settings.nav.close")}
                tooltip={frontendMessage("settings.nav.close")}
                size="sm"
                tone="muted"
                onClick={() => onNavigationOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            {navigation}
          </div>
        </SheetContent>
      </Sheet>
      {overlay}
    </div>
  );
}

export function SettingsNavigation({
  activeSectionId,
  activeNavItemRef,
  groupedResults,
  search,
  onSearchChange,
  onSelect,
}: {
  activeSectionId: SettingsSectionId;
  activeNavItemRef: MutableRefObject<HTMLButtonElement | null>;
  groupedResults: ReturnType<typeof groupSettingsSectionResults>;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (section: SettingsSectionId) => void;
}): JSX.Element {
  const { reduceMotion, disableMotion } = useMotionLevel();
  const animateSelection = !reduceMotion && !disableMotion;
  return (
    <>
      <div className="shrink-0 px-3 pb-2.5 pt-3">
        <label className="flex h-8 items-center gap-2 rounded-md border border-transparent bg-surface-hover px-2.5 text-content-muted transition-[background-color,border-color,box-shadow] focus-within:border-accent-border focus-within:bg-surface-panel focus-within:ring-2 focus-within:ring-accent-focus">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label={frontendMessage("settings.nav.searchLabel")}
            placeholder={frontendMessage("settings.nav.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-content-primary outline-none placeholder:text-content-muted"
          />
          {search ? (
            <button
              type="button"
              aria-label={frontendMessage("settings.nav.clearSearch")}
              onClick={() => onSearchChange("")}
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-content-muted transition hover:bg-surface-hover hover:text-content-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-2 pb-4 pt-1">
        <nav className="space-y-4" aria-label={frontendMessage("settings.nav.sectionsLabel")}>
          {groupedResults.map(({ group, results }) => (
            <div key={group.id}>
              <div className="px-2.5 pb-1.5 text-[10px] font-medium tracking-[0.06em] text-content-muted">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {results.map(({ section, details }) => (
                  <SettingsNavItem
                    key={section.id}
                    section={section}
                    active={section.id === activeSectionId}
                    searchDetails={details}
                    buttonRef={section.id === activeSectionId ? activeNavItemRef : undefined}
                    animateSelection={animateSelection}
                    onSelect={() => onSelect(section.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          {groupedResults.length === 0 ? (
            <div className="px-2 py-5 text-center text-[12px] leading-5 text-ink-500">
              {frontendMessage("settings.nav.empty")}
            </div>
          ) : null}
        </nav>
      </ScrollArea>
    </>
  );
}

function SettingsNavItem({
  section,
  active,
  searchDetails,
  buttonRef,
  animateSelection,
  onSelect,
}: {
  section: SettingsSectionDefinition;
  active: boolean;
  searchDetails: readonly { label: string; value: string }[];
  buttonRef?: Ref<HTMLButtonElement>;
  animateSelection: boolean;
  onSelect: () => void;
}): JSX.Element {
  const Icon = section.icon;
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "relative grid min-h-9 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors",
        active ? "text-content-primary" : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
      )}
    >
      {active ? (
        <motion.span
          layoutId={animateSelection ? "settings-navigation-selection" : undefined}
          className="absolute inset-0 rounded-md bg-surface-hover"
          transition={animateSelection ? motionTimings.selection : { duration: 0 }}
          aria-hidden="true"
          data-settings-navigation-indicator
        />
      ) : null}
      <Icon className={cn("relative z-[1] h-4 w-4 shrink-0", active ? "text-accent-content" : "text-content-muted")} />
      <span className="relative z-[1] min-w-0">
        <span className="block truncate leading-5">{section.label}</span>
        {searchDetails.map((detail) => (
          <span
            key={`${detail.label}:${detail.value}`}
            className="mt-0.5 block truncate text-[10.5px] leading-4 text-content-muted"
          >
            {detail.label}: {detail.value}
          </span>
        ))}
      </span>
    </button>
  );
}

function SettingsSectionHeader({ section }: { section: SettingsSectionDefinition }): JSX.Element {
  const Icon = section.icon;
  return (
    <header
      className="shrink-0 border-b border-line-subtle bg-surface-canvas px-5 py-4 sm:px-8 sm:py-5"
      data-window-drag-region
      data-window-controls-inset
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-accent-content" />
            <h2 className="truncate text-[18px] font-semibold leading-6 tracking-[-0.01em] text-content-strong">
              {section.label}
            </h2>
          </div>
          <p className="mt-1 max-w-[760px] text-[12px] leading-5 text-content-secondary">{section.description}</p>
        </div>
      </div>
    </header>
  );
}

export function DiscardSectionDraftDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}): JSX.Element {
  return (
    <DiscardDraftDialog
      open={open}
      title={frontendMessage("settings.discard.title")}
      description={frontendMessage("settings.discard.switchDescription")}
      consequence={frontendMessage("settings.discard.savedUnaffected")}
      continueLabel={frontendMessage("settings.discard.continue")}
      confirmLabel={frontendMessage("settings.discard.sectionConfirm")}
      onOpenChange={onOpenChange}
      onDiscard={onDiscard}
    />
  );
}
