import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { FrontendLocales, frontendMessage } from "../../i18n/frontendMessageCatalog";
import { useFrontendLocale, useSetFrontendLocale } from "../../i18n/useFrontendLocale";
import { Check, Copy, Menu, MonitorCog, RotateCcw, Search, X } from "lucide-react";
import { JsonConfigSettingsView } from "../../shared/config/JsonConfigForm";
import {
  AppearancePreferenceControl,
  createAppearanceSummary,
  defaultAppearancePreference,
  isDefaultAppearancePreference,
  readAccentSwatch,
  readSchemeSwatch,
  useAppearance,
  useSetAppearancePreference,
  type AppearancePreference,
  type AppearanceSummaryItem,
  type ResolvedTheme,
} from "../../shared/theme";
import {
  Button,
  Dialog,
  DialogActionButton,
  DialogActions,
  DialogContent,
  IconButton,
  MetaLabel,
  ScrollArea,
  Sheet,
  SheetContent,
  useClipboardCopy,
} from "../../shared/ui";
import type { SettingsSystemConfigHandle } from "./SettingsContracts";
import type { PluginSettingsCommandsHandle } from "../../app/usePluginSettingsCommands";
import type { MotionLevel } from "../../shared/motion";
import { cn } from "../../lib/util";
import { motionLevelOptions, preferenceSections, type LayoutPreferenceId } from "../session/types";
import { groupSettingsSectionResults, searchSettingsSectionResults } from "./settingsPresentation";
import { readSettingsDraftInteraction } from "./settingsInteractionModel";
import { SettingsWorkspaceFrame, SettingsWorkspaceState } from "./SettingsWorkspaceSurface";
import { useConfigSettingsDraftState } from "./sections/configSettingsDraftState";
import { ModelServiceSection } from "./sections/ModelServiceSection";
import { DefaultModelSection } from "./sections/DefaultModelSection";
import { SkillSettingsSection } from "./sections/SkillSettingsSection";
import { classifySettingsShellLayout, useObservedLayout } from "../../shared/responsive";
import { readSettingsSection, settingsSections, type SettingsSectionDefinition, type SettingsSectionId } from "./types";

export interface SettingsEnvironment {
  appVersion: string;
  frontendVersion: string;
  mode: string;
  surface: "desktop" | "web";
}

export interface SettingsWorkbenchProps {
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  onPendingChangesChange?: (pending: boolean) => void;
  shellActions?: ReactNode;
  environment: SettingsEnvironment;
  values: Record<LayoutPreferenceId, boolean>;
  motionLevel: MotionLevel;
  onValueChange: (id: LayoutPreferenceId, value: boolean) => void;
  onMotionLevelChange: (level: MotionLevel) => void;
  pluginSettings?: PluginSettingsCommandsHandle;
  systemConfig?: SettingsSystemConfigHandle;
}

export function SettingsWorkbench({
  section,
  onSectionChange,
  onPendingChangesChange,
  shellActions,
  environment,
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
  pluginSettings,
  systemConfig,
}: SettingsWorkbenchProps): JSX.Element {
  const [sectionSearch, setSectionSearch] = useState("");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [entityDraftDirty, setEntityDraftDirty] = useState(false);
  const [pendingSection, setPendingSection] = useState<SettingsSectionId | null>(null);
  const activeNavItemRef = useRef<HTMLButtonElement | null>(null);
  const { ref: shellRef, layout: shellLayout } = useObservedLayout<HTMLDivElement, "compact" | "persistent">(
    classifySettingsShellLayout,
    "persistent",
  );
  const configDraftState = useConfigSettingsDraftState({
    active: Boolean(systemConfig),
    operation: systemConfig?.configOperation ?? null,
    snapshot: systemConfig?.configSnapshot ?? null,
    socketStatus: systemConfig?.socketStatus,
    onRefresh: systemConfig?.refreshConfig ?? noop,
    onSave: systemConfig?.saveConfig ?? noopSave,
  });
  const activeSection = readSettingsSection(section);
  const groupedResults = useMemo(
    () => groupSettingsSectionResults(searchSettingsSectionResults(settingsSections, sectionSearch)),
    [sectionSearch],
  );
  const pendingChanges = configDraftState.dirty || entityDraftDirty;
  const showSectionHeader = !usesOwnSectionHeader(section) || environment.surface === "desktop";

  useEffect(() => {
    onPendingChangesChange?.(pendingChanges);
  }, [onPendingChangesChange, pendingChanges]);

  useEffect(() => {
    setEntityDraftDirty(false);
    setNavigationOpen(false);
  }, [section]);

  useEffect(() => {
    activeNavItemRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section, groupedResults]);

  const requestSectionChange = (nextSection: SettingsSectionId): void => {
    if (nextSection === section) {
      setNavigationOpen(false);
      return;
    }
    if (entityDraftDirty) {
      setPendingSection(nextSection);
      return;
    }
    onSectionChange(nextSection);
  };

  const navigation = (
    <SettingsNavigation
      activeSectionId={section}
      activeNavItemRef={activeNavItemRef}
      groupedResults={groupedResults}
      search={sectionSearch}
      onSearchChange={setSectionSearch}
      onSelect={requestSectionChange}
    />
  );

  return (
    <div
      ref={shellRef}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-paper-100 text-ink-900"
      data-settings-workbench
      data-settings-layout={shellLayout}
    >
      {shellLayout === "compact" ? (
        <header
          className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-200/70 bg-paper-50 px-3"
          data-window-drag-region
          data-window-controls-inset
        >
          <IconButton
            label={frontendMessage("settings.nav.open")}
            tooltip={frontendMessage("settings.nav.open")}
            size="sm"
            tone="muted"
            onClick={() => setNavigationOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold text-ink-900">{activeSection.label}</div>
            <div className="truncate text-[11px] text-ink-450">{frontendMessage("settings.header.title")}</div>
          </div>
          {shellActions}
        </header>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {shellLayout === "persistent" ? (
          <aside className="flex w-[220px] shrink-0 flex-col border-r border-ink-200/70 bg-paper-50">
            <div
              className="flex h-[58px] shrink-0 items-center gap-2 border-b border-ink-200/70 px-4"
              data-window-drag-region
            >
              <MonitorCog className="h-5 w-5 shrink-0 text-ink-500" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[14px] font-semibold text-ink-900">
                  {frontendMessage("settings.header.title")}
                </h1>
                <p className="truncate text-[11.5px] text-ink-450">{frontendMessage("settings.header.subtitle")}</p>
              </div>
              {shellActions}
            </div>
            {navigation}
          </aside>
        ) : null}

        <main className="flex min-w-0 flex-1 flex-col bg-paper-100">
          {showSectionHeader ? <SettingsSectionHeader section={activeSection} /> : null}
          <SettingsContent
            activeSection={activeSection}
            configDraftState={configDraftState}
            environment={environment}
            motionLevel={motionLevel}
            onEntityDraftChange={setEntityDraftDirty}
            onMotionLevelChange={onMotionLevelChange}
            onValueChange={onValueChange}
            pluginSettings={pluginSettings}
            systemConfig={systemConfig}
            values={values}
          />
        </main>
      </div>

      <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
        <SheetContent
          side="left"
          title={frontendMessage("settings.nav.title")}
          className="w-[min(320px,calc(100vw-24px))] p-0"
          showHeader={false}
          focusContentOnOpen
        >
          <div className="flex h-full min-h-0 flex-col bg-paper-50">
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-200/70 px-4">
              <MonitorCog className="h-4 w-4 text-ink-500" />
              <div className="min-w-0 flex-1 text-[14px] font-semibold text-ink-900">
                {frontendMessage("settings.header.title")}
              </div>
              <IconButton
                label={frontendMessage("settings.nav.close")}
                tooltip={frontendMessage("settings.nav.close")}
                size="sm"
                tone="muted"
                onClick={() => setNavigationOpen(false)}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            {navigation}
          </div>
        </SheetContent>
      </Sheet>

      <DiscardSectionDraftDialog
        open={pendingSection !== null}
        onOpenChange={(open) => !open && setPendingSection(null)}
        onDiscard={() => {
          const target = pendingSection;
          setPendingSection(null);
          setEntityDraftDirty(false);
          if (target) onSectionChange(target);
        }}
      />
    </div>
  );
}

function SettingsNavigation({
  activeSectionId,
  activeNavItemRef,
  groupedResults,
  search,
  onSearchChange,
  onSelect,
}: {
  activeSectionId: SettingsSectionId;
  activeNavItemRef: React.MutableRefObject<HTMLButtonElement | null>;
  groupedResults: ReturnType<typeof groupSettingsSectionResults>;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (section: SettingsSectionId) => void;
}): JSX.Element {
  return (
    <>
      <div className="shrink-0 border-b border-ink-200/70 px-3 py-2.5">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-paper-50 px-2.5 text-content-muted transition focus-within:border-accent-border focus-within:ring-2 focus-within:ring-accent-focus">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label={frontendMessage("settings.nav.searchLabel")}
            placeholder={frontendMessage("settings.nav.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-800 outline-none placeholder:text-ink-350"
          />
          {search ? (
            <button
              type="button"
              aria-label={frontendMessage("settings.nav.clearSearch")}
              onClick={() => onSearchChange("")}
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-350 transition hover:bg-ink-900/[0.06] hover:text-ink-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-2 py-2">
        <nav className="space-y-3" aria-label={frontendMessage("settings.nav.sectionsLabel")}>
          {groupedResults.map(({ group, results }) => (
            <div key={group.id}>
              <div className="px-2 pb-1 text-[11px] font-medium text-ink-350">{group.label}</div>
              <div className="space-y-0.5">
                {results.map(({ section, details }) => (
                  <SettingsNavItem
                    key={section.id}
                    section={section}
                    active={section.id === activeSectionId}
                    searchDetails={details}
                    buttonRef={section.id === activeSectionId ? activeNavItemRef : undefined}
                    onSelect={() => onSelect(section.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          {groupedResults.length === 0 ? (
            <div className="px-2 py-5 text-center text-[12px] leading-5 text-ink-450">
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
  onSelect,
}: {
  section: SettingsSectionDefinition;
  active: boolean;
  searchDetails: readonly { label: string; value: string }[];
  buttonRef?: Ref<HTMLButtonElement>;
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
        "grid min-h-9 w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 rounded-md px-2.5 py-2 text-left text-[13px] transition",
        active
          ? "bg-accent-surface text-accent-content"
          : "text-content-secondary hover:bg-surface-hover hover:text-content-primary",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate leading-5">{section.label}</span>
        {searchDetails.map((detail) => (
          <span
            key={`${detail.label}:${detail.value}`}
            className="mt-0.5 block truncate text-[10.5px] leading-4 text-ink-450"
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
      className="shrink-0 border-b border-ink-200/70 bg-paper-50/95 px-4 py-3 sm:px-5"
      data-window-drag-region
      data-window-controls-inset
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="h-5 w-5 shrink-0 text-ink-500" />
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold leading-6 text-ink-950">{section.label}</h2>
          <p className="mt-0.5 max-w-[760px] text-[12px] leading-5 text-ink-500">{section.description}</p>
        </div>
      </div>
    </header>
  );
}

function SettingsContent({
  activeSection,
  configDraftState,
  environment,
  motionLevel,
  onEntityDraftChange,
  onMotionLevelChange,
  onValueChange,
  pluginSettings,
  systemConfig,
  values,
}: Omit<SettingsWorkbenchProps, "section" | "onSectionChange" | "onPendingChangesChange" | "shellActions"> & {
  activeSection: SettingsSectionDefinition;
  configDraftState: ReturnType<typeof useConfigSettingsDraftState>;
  onEntityDraftChange: (dirty: boolean) => void;
}): JSX.Element {
  const content = renderSettingsContent({
    activeSection,
    configDraftState,
    environment,
    motionLevel,
    onEntityDraftChange,
    onMotionLevelChange,
    onValueChange,
    pluginSettings,
    systemConfig,
    values,
  });

  if (isFullHeightWorkspace(activeSection.id)) {
    return <div className="min-h-0 flex-1 overflow-hidden">{content}</div>;
  }

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="p-3 sm:p-4">
      <div className={sectionWidthClassName(activeSection.id)}>{content}</div>
    </ScrollArea>
  );
}

function renderSettingsContent({
  activeSection,
  configDraftState,
  environment,
  motionLevel,
  onEntityDraftChange,
  onMotionLevelChange,
  onValueChange,
  pluginSettings,
  systemConfig,
  values,
}: Omit<SettingsWorkbenchProps, "section" | "onSectionChange" | "onPendingChangesChange" | "shellActions"> & {
  activeSection: SettingsSectionDefinition;
  configDraftState: ReturnType<typeof useConfigSettingsDraftState>;
  onEntityDraftChange: (dirty: boolean) => void;
}): JSX.Element {
  switch (activeSection.id) {
    case "appearance":
      return <AppearanceSettings />;
    case "general":
      return (
        <GeneralSettings
          values={values}
          motionLevel={motionLevel}
          onValueChange={onValueChange}
          onMotionLevelChange={onMotionLevelChange}
        />
      );
    case "system":
      return <SystemSettings draftState={configDraftState} systemConfig={systemConfig} />;
    case "runtime":
    case "planning":
    case "retrieval":
    case "storage":
      return (
        <ConfigFormSectionSettings
          draftState={configDraftState}
          sectionId={activeSection.id}
          systemConfig={systemConfig}
        />
      );
    case "default-model":
      return <DefaultModelSection systemConfig={systemConfig} />;
    case "model-service":
      return <ModelServiceSection systemConfig={systemConfig} onDirtyChange={onEntityDraftChange} />;
    case "skills":
      return <SkillSettingsSection pluginSettings={pluginSettings} onDirtyChange={onEntityDraftChange} />;
    case "about":
      return <AboutSettings environment={environment} />;
  }
}

function SystemSettings({
  draftState,
  systemConfig,
}: {
  draftState: ReturnType<typeof useConfigSettingsDraftState>;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  if (!systemConfig)
    return <SettingsWorkspaceState>{frontendMessage("settings.state.loadingMain")}</SettingsWorkspaceState>;
  return (
    <DraftBackedSection draftState={draftState} ready={Boolean(systemConfig.configSnapshot)}>
      <JsonConfigSettingsView
        layoutMode="embedded"
        sections={readMainConfigurationSections(systemConfig.configSnapshot?.form.sections ?? [])}
        value={draftState.draft}
        emptyText={frontendMessage("settings.state.emptyMain")}
        onChange={draftState.updateDraft}
        onCommit={draftState.flushSave}
      />
    </DraftBackedSection>
  );
}

function ConfigFormSectionSettings({
  draftState,
  sectionId,
  systemConfig,
}: {
  draftState: ReturnType<typeof useConfigSettingsDraftState>;
  sectionId: Extract<SettingsSectionId, "runtime" | "planning" | "retrieval" | "storage">;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  const sections = systemConfig?.configSnapshot?.form.sections.filter((section) => section.name === sectionId) ?? [];
  if (!systemConfig?.configSnapshot)
    return <SettingsWorkspaceState>{frontendMessage("settings.state.loadingConfig")}</SettingsWorkspaceState>;
  return (
    <DraftBackedSection draftState={draftState} ready>
      <JsonConfigSettingsView
        layoutMode="embedded"
        sections={sections}
        value={draftState.draft}
        emptyText={frontendMessage("settings.state.emptySection")}
        onChange={draftState.updateDraft}
        onCommit={draftState.flushSave}
      />
    </DraftBackedSection>
  );
}

function DraftBackedSection({
  children,
  draftState,
  ready,
}: {
  children: ReactNode;
  draftState: ReturnType<typeof useConfigSettingsDraftState>;
  ready: boolean;
}): JSX.Element {
  const interaction = readSettingsDraftInteraction({
    dirty: draftState.dirty,
    conflict: draftState.conflict,
    localError: draftState.localError,
    ready,
    saving: draftState.saving,
    validationErrors: draftState.validationErrors,
  });
  return (
    <SettingsWorkspaceFrame className="overflow-visible">
      <div className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 bg-paper-50/95 px-4 py-2.5 backdrop-blur-sm">
        <div className="min-w-0 text-[11.5px] leading-5 text-ink-500">
          {interaction.status === "synced" ? null : interaction.detail}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={interaction.refreshDisabled}
            onClick={draftState.refreshOrRestore}
            title={interaction.refreshTitle}
          >
            {interaction.refreshLabel}
          </Button>
          {interaction.status === "conflict" || (interaction.status === "invalid" && !interaction.saveDisabled) ? (
            <Button
              size="sm"
              disabled={interaction.saveDisabled}
              onClick={draftState.save}
              title={interaction.saveTitle}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {frontendMessage("settings.action.retry")}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="pt-2">{children}</div>
    </SettingsWorkspaceFrame>
  );
}

function readMainConfigurationSections(
  sections: NonNullable<SettingsSystemConfigHandle["configSnapshot"]>["form"]["sections"],
) {
  return sections.filter((section) => section.name === "system");
}

function AppearanceSettings(): JSX.Element {
  const { preference, resolvedTheme } = useAppearance();
  const setAppearancePreference = useSetAppearancePreference();
  const summary = useMemo(() => createAppearanceSummary(preference), [preference]);
  const usesDefault = isDefaultAppearancePreference(preference);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
        <SettingsPanel
          title={frontendMessage("settings.appearance.title")}
          description={frontendMessage("settings.appearance.description")}
        >
          <AppearancePreferenceControl />
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-ink-200/60 pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={usesDefault}
              onClick={() => setAppearancePreference(defaultAppearancePreference)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {frontendMessage("settings.appearance.reset")}
            </Button>
          </div>
        </SettingsPanel>
        <SettingsPanel
          title={frontendMessage("settings.appearance.previewTitle")}
          description={frontendMessage("settings.appearance.previewDescription")}
        >
          <AppearancePreview preference={preference} resolvedTheme={resolvedTheme} summary={summary} />
        </SettingsPanel>
      </div>
    </div>
  );
}

function GeneralSettings({
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
}: Pick<SettingsWorkbenchProps, "values" | "motionLevel" | "onValueChange" | "onMotionLevelChange">): JSX.Element {
  const locale = useFrontendLocale();
  const setLocale = useSetFrontendLocale();
  const changeLocale = (nextLocale: typeof locale): void => {
    setLocale(nextLocale);
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      {preferenceSections.map((preferenceSection) => (
        <SettingsPanel
          key={preferenceSection.id}
          title={preferenceSection.title}
          description={frontendMessage("settings.general.layoutDescription")}
        >
          <div className="overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
            {preferenceSection.items.map((item, index) => (
              <PreferenceToggle
                key={item.id}
                title={item.title}
                description={item.description}
                checked={values[item.id]}
                separated={index > 0}
                onCheckedChange={(checked) => onValueChange(item.id, checked)}
              />
            ))}
          </div>
        </SettingsPanel>
      ))}
      <SettingsPanel
        title={frontendMessage("settings.general.languageLabel")}
        description={frontendMessage("settings.general.languageDescription")}
      >
        <label className="flex items-center justify-between gap-3 rounded-lg border border-ink-200/70 bg-paper-50 px-3 py-3">
          <span className="text-[12.5px] font-medium text-ink-850">
            {frontendMessage("settings.general.languageLabel")}
          </span>
          <select
            aria-label={frontendMessage("settings.general.languageLabel")}
            value={locale}
            onChange={(event) => changeLocale(event.target.value as typeof locale)}
            className="h-8 rounded-md border border-line bg-paper-50 px-2 text-[12px] text-ink-800 outline-none focus:border-accent-border focus:ring-2 focus:ring-accent-focus"
          >
            <option value={FrontendLocales.ZhCn}>{frontendMessage("settings.general.languageZhCn")}</option>
            <option value={FrontendLocales.EnUs}>{frontendMessage("settings.general.languageEnUs")}</option>
          </select>
        </label>
      </SettingsPanel>{" "}
      <SettingsPanel
        title={frontendMessage("settings.general.animationTitle")}
        description={frontendMessage("settings.general.animationDescription")}
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {motionLevelOptions.map((option) => (
            <MotionLevelOption
              key={option.id}
              title={option.title}
              description={option.description}
              selected={motionLevel === option.id}
              onSelect={() => onMotionLevelChange(option.id)}
            />
          ))}
        </div>
      </SettingsPanel>
    </div>
  );
}

function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="border-b border-ink-200/70 pb-4 last:border-b-0">
      <div className="pb-2">
        <MetaLabel as="h3" size="sm">
          {title}
        </MetaLabel>
        <p className="mt-1 text-[12px] leading-5 text-ink-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function AppearancePreview({
  preference,
  resolvedTheme,
  summary,
}: {
  preference: AppearancePreference;
  resolvedTheme: ResolvedTheme;
  summary: AppearanceSummaryItem[];
}): JSX.Element {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {summary.map((item) => (
          <div key={item.id} className="min-w-0">
            <dt className="text-[11px] text-content-secondary">{item.label}</dt>
            <dd className="mt-0.5 truncate text-[13px] font-medium text-ink-900">{item.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-ink-200/60 pt-4">
        <div className="flex items-center justify-between gap-3">
          <MetaLabel size="sm">{frontendMessage("settings.appearance.previewLabel")}</MetaLabel>
          <span className="rounded-full bg-ink-900/[0.04] px-2 py-0.5 text-[11px] text-ink-500">
            {resolvedTheme === "dark"
              ? frontendMessage("settings.appearance.dark")
              : frontendMessage("settings.appearance.light")}
          </span>
        </div>
        <div
          className="mt-3 overflow-hidden rounded-xl border border-line-subtle bg-[var(--theme-bg)] p-2"
          aria-label={frontendMessage("settings.appearance.previewAria")}
        >
          <div className="grid min-h-[220px] grid-cols-[104px_minmax(0,1fr)] gap-2">
            <div className="flex flex-col rounded-lg border border-line-subtle bg-[var(--theme-sidebar-bg)] p-2 shadow-panel">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-content-primary">
                <span
                  className="h-4 w-4 rounded-[5px] border border-line-subtle"
                  style={{ background: readSchemeSwatch(preference.colorScheme) }}
                />
                Senera
              </div>
              <div className="mt-2 h-5 rounded-md border border-line-subtle bg-surface-raised" />
              <div className="mt-2 space-y-1">
                <div className="rounded-md bg-accent-surface px-2 py-1.5 text-[9px] font-medium text-accent-content">
                  {frontendMessage("settings.appearance.sampleTitle")}
                </div>
                <div className="px-2 py-1.5 text-[9px] text-content-secondary">
                  {frontendMessage("settings.appearance.sampleNewChat")}
                </div>
                <div className="px-2 py-1.5 text-[9px] text-content-secondary">
                  {frontendMessage("settings.appearance.sampleDiscussion")}
                </div>
              </div>
              <div className="mt-auto flex items-center gap-1.5 border-t border-line-subtle pt-2">
                <span className="h-4 w-4 rounded-full bg-surface-muted" />
                <span className="text-[9px] text-content-secondary">Hira</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line-subtle bg-[var(--theme-bg)]">
              <div className="flex h-8 items-center border-b border-line-subtle bg-surface-raised px-2.5 text-[10px] font-semibold text-content-primary">
                {frontendMessage("settings.appearance.sampleTitle")}
              </div>
              <div className="flex flex-1 flex-col gap-2.5 p-3">
                <div className="ml-auto max-w-[80%] rounded-lg rounded-tr-sm bg-[var(--theme-chat-user-bg)] px-2.5 py-1.5 text-[9.5px] leading-4 text-[var(--theme-chat-user-fg)]">
                  {frontendMessage("settings.appearance.samplePrompt")}
                </div>
                <div>
                  <div className="text-[9px] font-semibold text-content-primary">Senera</div>
                  <div className="mt-1 text-[9.5px] leading-4 text-content-secondary">
                    {frontendMessage("settings.appearance.sampleResponse")}
                  </div>
                  <div className="mt-2 overflow-hidden rounded-md border border-line-subtle bg-[var(--theme-code-editor-bg)]">
                    <div className="border-b border-line-subtle bg-[var(--theme-code-editor-gutter-bg)] px-2 py-1 font-mono text-[8px] text-[var(--theme-code-editor-gutter-fg)]">
                      theme.ts
                    </div>
                    <div className="px-2 py-1.5 font-mono text-[8px] text-[var(--theme-code-editor-fg)]">
                      const theme = &quot;ready&quot;;
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-2.5 pt-0">
                <div className="flex items-center gap-2 rounded-xl border border-line bg-[var(--theme-chat-composer-bg)] px-2.5 py-2 shadow-[var(--shadow-soft)]">
                  <span className="min-w-0 flex-1 text-[9px] text-content-secondary">
                    {frontendMessage("settings.appearance.sampleComposer")}
                  </span>
                  <span
                    className="h-5 w-5 rounded-full"
                    style={{ background: readAccentSwatch(preference.accentColor) }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AboutSettings({ environment }: { environment: SettingsEnvironment }): JSX.Element {
  return (
    <div className="space-y-4">
      <SettingsPanel
        title={frontendMessage("settings.about.title")}
        description={frontendMessage("settings.about.description")}
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <AboutValue label={frontendMessage("settings.about.appVersion")} value={environment.appVersion} />
          <AboutValue label={frontendMessage("settings.about.frontendVersion")} value={environment.frontendVersion} />
          <AboutValue
            label={frontendMessage("settings.about.runMode")}
            value={frontendMessage(environment.surface === "desktop" ? "settings.about.desktop" : "settings.about.web")}
          />
          <AboutValue label={frontendMessage("settings.about.buildMode")} value={environment.mode} />
        </dl>
      </SettingsPanel>
      {import.meta.env.DEV ? (
        <details className="border-b border-ink-200/70 pb-3">
          <summary className="cursor-pointer text-[12.5px] font-medium text-ink-700">
            {frontendMessage("settings.about.devDiagnostics")}
          </summary>
          <div className="mt-3 space-y-2">
            <CommandRow command="npm run dev.frontend" label={frontendMessage("settings.about.command.frontend")} />
            <CommandRow command="npm run desktop.live" label={frontendMessage("settings.about.command.desktopLive")} />
            <CommandRow
              command="npm run desktop.verify"
              label={frontendMessage("settings.about.command.desktopVerify")}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function AboutValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-ink-200/70 bg-paper-100/55 px-3 py-2.5">
      <dt className="text-[11px] text-ink-450">{label}</dt>
      <dd className="mt-1 truncate text-[12.5px] font-medium text-ink-850">{value}</dd>
    </div>
  );
}

function CommandRow({ label, command }: { label: string; command: string }): JSX.Element {
  const { copied, copyText } = useClipboardCopy({ successMessage: frontendMessage("settings.action.copied") });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-ink-200/70 bg-paper-100/55 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-ink-850">{label}</div>
        <code className="mt-0.5 block truncate font-mono text-[11.5px] text-ink-500">{command}</code>
      </div>
      <IconButton
        label={frontendMessage("settings.action.copyCommand")}
        tooltip={copied ? frontendMessage("settings.action.copied") : frontendMessage("settings.action.copyCommand")}
        size="sm"
        tone="muted"
        onClick={() => void copyText(command)}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent-content" /> : <Copy className="h-3.5 w-3.5" />}
      </IconButton>
    </div>
  );
}

function MotionLevelOption({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-lg border px-3 py-3 text-left transition",
        selected
          ? "border-accent-border bg-accent-surface text-accent-content"
          : "border-line bg-surface-panel text-content-secondary hover:bg-surface-subtle",
      )}
    >
      <div className="text-[12.5px] font-semibold">{title}</div>
      <div className="mt-1 text-[11.5px] leading-5 text-ink-500">{description}</div>
    </button>
  );
}

function PreferenceToggle({
  title,
  description,
  checked,
  separated,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  separated: boolean;
  onCheckedChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label
      className={cn("flex cursor-pointer items-center gap-4 px-4 py-3", separated && "border-t border-ink-200/70")}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink-850">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-500">{description}</span>
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-accent-solid" : "bg-ink-300")}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            checked && "translate-x-4",
          )}
        />
      </span>
    </label>
  );
}

function DiscardSectionDraftDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={frontendMessage("settings.discard.title")}
        description={frontendMessage("settings.discard.switchDescription")}
      >
        <DialogActions>
          <DialogActionButton close>{frontendMessage("settings.discard.continue")}</DialogActionButton>
          <DialogActionButton variant="danger" onClick={onDiscard}>
            {frontendMessage("settings.discard.confirm")}
          </DialogActionButton>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function usesOwnSectionHeader(sectionId: SettingsSectionId): boolean {
  return sectionId === "model-service" || sectionId === "default-model" || sectionId === "skills";
}

function isFullHeightWorkspace(sectionId: SettingsSectionId): boolean {
  return sectionId === "model-service" || sectionId === "skills";
}

function sectionWidthClassName(sectionId: SettingsSectionId): string {
  if (sectionId === "appearance" || sectionId === "general") return "mx-auto w-full max-w-[1160px]";
  if (sectionId === "about") return "mx-auto w-full max-w-[1000px]";
  if (sectionId === "default-model") return "mx-auto w-full max-w-[960px]";
  return "mx-auto w-full max-w-[1280px]";
}

function noop(): void {}
function noopSave(): string | null {
  return null;
}
