import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Check, ChevronRight, Copy, RotateCcw, Search, X } from "lucide-react";
import { JsonConfigSettingsView } from "../../shared/config/JsonConfigForm";
import {
  AppearancePreferenceControl,
  createAppearanceSummary,
  defaultAppearancePreference,
  isDefaultAppearancePreference,
  readAccentSwatch,
  readAppearanceTokenRows,
  readSchemeSwatch,
  useAppearance,
  useSetAppearancePreference,
  type AppearancePreference,
  type AppearanceSummaryItem,
  type AppearanceTokenRow,
  type ResolvedTheme,
} from "../../shared/theme";
import { Button, IconButton, MetaLabel, ScrollArea, useClipboardCopy } from "../../shared/ui";
import { readDesktopBridge } from "../../app/desktopBridge";
import type { SettingsSystemConfigHandle } from "./SettingsContracts";
import type { PluginSettingsCommandsHandle } from "../../app/usePluginSettingsCommands";
import type { MotionLevel } from "../../shared/motion";
import { cn } from "../../lib/util";
import { motionLevelOptions, preferenceSections, type LayoutPreferenceId } from "../session/types";
import {
  createSettingsDiagnostics,
  readSettingsSectionPlan,
  readSettingsSectionStatus,
  readSettingsWorkbenchSectionSummary,
  searchSettingsSectionResults,
  type SettingsSectionSearchDetail,
} from "./settingsPresentation";
import {
  readConfigSectionRuntimeStatus,
  readPluginSectionRuntimeStatus,
  readSettingsDraftInteraction,
  type SettingsSectionRuntimeStatus,
} from "./settingsInteractionModel";
import { WorkbenchControlDeckHeader } from "./SettingsWorkbenchControlDeck";
import { SettingsWorkspaceFrame, SettingsWorkspaceState } from "./SettingsWorkspaceSurface";
import { useConfigSettingsDraftState } from "./sections/configSettingsDraftState";
import { ModelServiceSection } from "./sections/ModelServiceSection";
import { DefaultModelSection } from "./sections/DefaultModelSection";
import { SkillSettingsSection } from "./sections/SkillSettingsSection";
import {
  defaultSettingsSectionId,
  settingsSections,
  settingsShellIcon,
  type SettingsSectionDefinition,
  type SettingsSectionId,
} from "./types";

export interface SettingsWorkbenchProps {
  initialSection?: SettingsSectionId;
  values: Record<LayoutPreferenceId, boolean>;
  motionLevel: MotionLevel;
  onValueChange: (id: LayoutPreferenceId, value: boolean) => void;
  onMotionLevelChange: (level: MotionLevel) => void;
  pluginSettings?: PluginSettingsCommandsHandle;
  systemConfig?: SettingsSystemConfigHandle;
}

export function SettingsWorkbench({
  initialSection = defaultSettingsSectionId,
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
  pluginSettings,
  systemConfig,
}: SettingsWorkbenchProps): JSX.Element {
  const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>(initialSection);
  const [sectionSearch, setSectionSearch] = useState("");
  const activeNavItemRef = useRef<HTMLButtonElement | null>(null);
  const configDraftState = useConfigSettingsDraftState({
    active: Boolean(systemConfig),
    operation: systemConfig?.configOperation ?? null,
    snapshot: systemConfig?.configSnapshot ?? null,
    onRefresh: systemConfig?.refreshConfig ?? noop,
    onSave: systemConfig?.saveConfig ?? noopSave,
  });
  const activeSection = useMemo(
    () => settingsSections.find((section) => section.id === activeSectionId) ?? settingsSections[0],
    [activeSectionId],
  );
  const runtimeStatuses = useMemo(
    () =>
      readWorkbenchRuntimeStatuses({
        configDraftState,
        pluginSettings,
        systemConfigReady: Boolean(systemConfig?.configSnapshot),
      }),
    [configDraftState, pluginSettings, systemConfig?.configSnapshot],
  );
  const activeRuntimeStatus = runtimeStatuses[activeSection.id];
  const activeSectionSummary = useMemo(
    () => readSettingsWorkbenchSectionSummary(activeSection, activeRuntimeStatus),
    [activeRuntimeStatus, activeSection],
  );
  const configInteraction = useMemo(
    () =>
      readSettingsDraftInteraction({
        dirty: configDraftState.dirty,
        localError: configDraftState.localError,
        ready: Boolean(systemConfig?.configSnapshot),
        saving: configDraftState.saving,
        validationErrors: configDraftState.validationErrors,
      }),
    [
      configDraftState.dirty,
      configDraftState.localError,
      configDraftState.saving,
      configDraftState.validationErrors,
      systemConfig?.configSnapshot,
    ],
  );
  const visibleSectionResults = useMemo(
    () => searchSettingsSectionResults(settingsSections, sectionSearch),
    [sectionSearch],
  );
  const hasSectionSearch = sectionSearch.trim().length > 0;
  const ShellIcon = settingsShellIcon;
  const hidesGenericHeader = activeSection.id === "model-service" || activeSection.id === "default-model";

  useEffect(() => {
    activeNavItemRef.current?.scrollIntoView({
      block: "nearest",
      inline: "center",
    });
  }, [activeSectionId, visibleSectionResults]);

  return (
    <div className="flex h-screen min-h-0 flex-col bg-paper-100 text-ink-900 md:flex-row">
      <aside className="flex max-h-[164px] shrink-0 flex-col border-b border-ink-200/70 bg-paper-50 md:max-h-none md:w-[228px] md:border-b-0 md:border-r">
        <header className="flex h-[58px] shrink-0 items-center gap-2 border-b border-ink-200/70 px-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-ink-200 bg-paper-100 text-ink-500">
            <ShellIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[14px] font-semibold text-ink-900">设置</h1>
            <p className="truncate text-[11.5px] text-ink-450">Senera 工作台</p>
          </div>
        </header>
        <div className="shrink-0 border-b border-ink-200/70 px-3 py-2.5">
          <label className="flex h-8 items-center gap-2 rounded-md border border-ink-200 bg-paper-100 px-2.5 text-ink-450 shadow-sm transition focus-within:border-terra-300 focus-within:ring-2 focus-within:ring-terra-100">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={sectionSearch}
              onChange={(event) => setSectionSearch(event.target.value)}
              aria-label="搜索设置"
              placeholder="搜索设置"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-800 outline-none placeholder:text-ink-350"
            />
            {sectionSearch ? (
              <button
                type="button"
                aria-label="清除搜索"
                title="清除搜索"
                onClick={() => setSectionSearch("")}
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-350 transition hover:bg-ink-900/[0.06] hover:text-ink-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        </div>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3 py-1.5 md:p-3">
          <nav className="flex w-full min-w-0 gap-1 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
            {visibleSectionResults.map(({ section, details }) => (
              <SettingsNavItem
                key={section.id}
                section={section}
                active={section.id === activeSection.id}
                searchDetails={hasSectionSearch ? details : []}
                runtimeStatus={runtimeStatuses[section.id]}
                buttonRef={section.id === activeSection.id ? activeNavItemRef : undefined}
                onSelect={() => {
                  if (section.enabled) {
                    setActiveSectionId(section.id);
                  }
                }}
              />
            ))}
            {visibleSectionResults.length === 0 ? (
              <div className="rounded-md border border-dashed border-ink-200 bg-paper-100/55 px-3 py-3 text-[12px] leading-5 text-ink-450">
                没有匹配的设置
              </div>
            ) : null}
          </nav>
        </ScrollArea>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {hidesGenericHeader ? null : (
          <WorkbenchControlDeckHeader
            configInteraction={configInteraction}
            section={activeSection}
            summary={activeSectionSummary}
          />
        )}
        {activeSection.id === "model-service" ? (
          <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-4">
            <SettingsWorkspaceFrame className="h-full min-h-0">
              {renderSettingsContent({
                activeSection,
                configDraftState,
                motionLevel,
                onMotionLevelChange,
                onValueChange,
                pluginSettings,
                systemConfig,
                values,
              })}
            </SettingsWorkspaceFrame>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1" viewportClassName="p-2 sm:p-4">
            {isWorkspaceSection(activeSection.id) ? (
              <SettingsWorkspaceFrame>
                {renderSettingsContent({
                  activeSection,
                  configDraftState,
                  motionLevel,
                  onMotionLevelChange,
                  onValueChange,
                  pluginSettings,
                  systemConfig,
                  values,
                })}
              </SettingsWorkspaceFrame>
            ) : (
              renderSettingsContent({
                activeSection,
                configDraftState,
                motionLevel,
                onMotionLevelChange,
                onValueChange,
                pluginSettings,
                systemConfig,
                values,
              })
            )}
          </ScrollArea>
        )}
      </main>
    </div>
  );
}

function renderSettingsContent({
  activeSection,
  configDraftState,
  motionLevel,
  onMotionLevelChange,
  onValueChange,
  pluginSettings,
  systemConfig,
  values,
}: SettingsWorkbenchProps & {
  activeSection: SettingsSectionDefinition;
  configDraftState: ReturnType<typeof useConfigSettingsDraftState>;
}): JSX.Element {
  if (activeSection.id === "appearance") {
    return <AppearanceSettings />;
  }
  if (activeSection.id === "general") {
    return (
      <GeneralSettings
        values={values}
        motionLevel={motionLevel}
        onValueChange={onValueChange}
        onMotionLevelChange={onMotionLevelChange}
      />
    );
  }
  if (activeSection.id === "system") {
    return <SystemSettings draftState={configDraftState} systemConfig={systemConfig} />;
  }
  if (activeSection.id === "default-model") {
    return <DefaultModelSection systemConfig={systemConfig} />;
  }
  if (
    activeSection.id === "runtime" ||
    activeSection.id === "planning" ||
    activeSection.id === "retrieval" ||
    activeSection.id === "storage"
  ) {
    return (
      <ConfigFormSectionSettings
        draftState={configDraftState}
        sectionId={activeSection.id}
        systemConfig={systemConfig}
      />
    );
  }
  if (activeSection.id === "model-service") {
    return <ModelServiceSection systemConfig={systemConfig} />;
  }
  if (activeSection.id === "skills") {
    return <SkillSettingsSection pluginSettings={pluginSettings} />;
  }
  if (activeSection.id === "about") {
    return <AboutSettings activeSectionId={activeSection.id} />;
  }
  return <SettingsPlaceholder section={activeSection} />;
}

function SystemSettings({
  draftState,
  systemConfig,
}: {
  draftState: ReturnType<typeof useConfigSettingsDraftState>;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  if (!systemConfig) {
    return <SettingsWorkspaceState>正在连接主配置服务</SettingsWorkspaceState>;
  }

  return (
    <DraftBackedSection
      interaction={readSettingsDraftInteraction({
        dirty: draftState.dirty,
        localError: draftState.localError,
        ready: Boolean(systemConfig.configSnapshot),
        saving: draftState.saving,
        validationErrors: draftState.validationErrors,
      })}
      onCancel={draftState.refreshOrRestore}
      onSave={draftState.save}
    >
      <JsonConfigSettingsView
        layoutMode="embedded"
        sections={readMainConfigurationSections(systemConfig.configSnapshot?.form.sections ?? [])}
        value={draftState.draft}
        disabled={draftState.saving}
        emptyText="主配置暂时没有独立字段；运行、规划、检索、存储和模型服务请从左侧进入。"
        onChange={draftState.updateDraft}
      />
    </DraftBackedSection>
  );
}

function DraftBackedSection({
  children,
  interaction,
  onCancel,
  onSave,
}: {
  children: ReactNode;
  interaction: ReturnType<typeof readSettingsDraftInteraction>;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element {
  return (
    <div className="bg-paper-50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 bg-paper-50 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">{interaction.statusLabel}</div>
          <div className="mt-0.5 text-[11.5px] leading-5 text-ink-500">{interaction.detail}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={interaction.refreshDisabled}
            onClick={onCancel}
            title={interaction.refreshTitle}
          >
            取消
          </Button>
          <Button size="sm" disabled={interaction.saveDisabled} onClick={onSave} title={interaction.saveTitle}>
            保存
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

function readMainConfigurationSections(
  sections: NonNullable<SettingsSystemConfigHandle["configSnapshot"]>["form"]["sections"],
) {
  // The backend form has no public `system` section. Keep this allow-list
  // narrow so future form sections do not silently duplicate outer settings.
  return sections.filter((section) => section.name === "system");
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
  if (!systemConfig?.configSnapshot) {
    return <SettingsWorkspaceState>正在连接配置服务</SettingsWorkspaceState>;
  }

  return (
    <DraftBackedSection
      interaction={readSettingsDraftInteraction({
        dirty: draftState.dirty,
        localError: draftState.localError,
        ready: Boolean(systemConfig.configSnapshot),
        saving: draftState.saving,
        validationErrors: draftState.validationErrors,
      })}
      onCancel={draftState.refreshOrRestore}
      onSave={draftState.save}
    >
      <JsonConfigSettingsView
        layoutMode="embedded"
        sections={sections}
        value={draftState.draft}
        disabled={draftState.saving}
        emptyText="这个配置分区还没有可显示的字段"
        onChange={draftState.updateDraft}
      />
    </DraftBackedSection>
  );
}

function SettingsNavItem({
  section,
  active,
  searchDetails,
  runtimeStatus,
  buttonRef,
  onSelect,
}: {
  section: SettingsSectionDefinition;
  active: boolean;
  searchDetails: readonly SettingsSectionSearchDetail[];
  runtimeStatus?: SettingsSectionRuntimeStatus;
  buttonRef?: Ref<HTMLButtonElement>;
  onSelect: () => void;
}): JSX.Element {
  const Icon = section.icon;
  const status = readSettingsSectionStatus(section.id);
  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={!section.enabled}
      aria-disabled={!section.enabled}
      onClick={section.enabled ? onSelect : undefined}
      className={cn(
        "grid min-h-9 w-[118px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 rounded-md px-2.5 py-2 text-left text-[13px] transition md:w-full",
        active ? "bg-terra-100 text-terra-700" : "text-ink-650 hover:bg-ink-900/[0.04] hover:text-ink-900",
        !section.enabled && "cursor-not-allowed opacity-55 hover:bg-transparent hover:text-ink-650",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate leading-5">{section.label}</span>
        {searchDetails.length > 0 ? (
          <span className="mt-0.5 block space-y-0.5">
            {searchDetails.map((detail) => (
              <span
                key={`${detail.label}:${detail.value}`}
                className={cn("block truncate text-[11px] leading-4", active ? "text-terra-600/80" : "text-ink-450")}
              >
                {detail.label}：{detail.value}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      {runtimeStatus ? (
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px]",
            runtimeStatusClassName[runtimeStatus.state],
          )}
        >
          {runtimeStatus.label}
        </span>
      ) : status === "planned" ? (
        <span className="mt-1 text-[10.5px] text-ink-400">迁移中</span>
      ) : null}
    </button>
  );
}

function AppearanceSettings(): JSX.Element {
  const { preference, resolvedTheme } = useAppearance();
  const setAppearancePreference = useSetAppearancePreference();
  const summary = useMemo(() => createAppearanceSummary(preference), [preference]);
  const tokenRows = useMemo(() => readAppearanceTokenRows(preference), [preference]);
  const usesDefault = isDefaultAppearancePreference(preference);

  return (
    <div className="max-w-[980px] space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
        <SettingsPanel title="外观" description="这些选择会立即应用到所有已打开的 Senera 窗口。">
          <AppearancePreferenceControl />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink-200/60 pt-3">
            <p className="text-[12px] leading-5 text-ink-500">
              {usesDefault ? "正在使用默认外观 contract。" : "当前外观已偏离默认 contract，可随时恢复。"}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={usesDefault}
              onClick={() => setAppearancePreference(defaultAppearancePreference)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复默认
            </Button>
          </div>
        </SettingsPanel>
        <SettingsPanel title="当前外观" description="设置窗口与主窗口共享同一套偏好和 DOM token。">
          <AppearancePreview preference={preference} resolvedTheme={resolvedTheme} summary={summary} />
        </SettingsPanel>
      </div>
      <SettingsPanel title="外观状态" description="这些状态会保持主窗口、设置窗口和后续扩展界面显示一致。">
        <AppearanceTokenContract rows={tokenRows} />
      </SettingsPanel>
    </div>
  );
}

function GeneralSettings({
  values,
  motionLevel,
  onValueChange,
  onMotionLevelChange,
}: SettingsWorkbenchProps): JSX.Element {
  return (
    <div className="max-w-[760px] space-y-4">
      {preferenceSections.map((section) => (
        <SettingsPanel
          key={section.id}
          title={section.title}
          description="设置窗口布局的默认状态，并在进入持久侧栏布局时同步应用。"
        >
          <div className="overflow-hidden rounded-lg border border-ink-200/70 bg-paper-50">
            {section.items.map((item, index) => (
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
      <SettingsPanel title="动画" description="动画策略会影响消息列表、面板和弹层的过渡。">
        <div className="grid grid-cols-3 gap-2">
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
    <section className="rounded-lg border border-ink-200/70 bg-paper-50 shadow-sm">
      <div className="border-b border-ink-200/70 px-4 py-3">
        <MetaLabel as="h3" size="sm">
          {title}
        </MetaLabel>
        <p className="mt-1 text-[12px] leading-5 text-ink-500">{description}</p>
      </div>
      <div className="p-4">{children}</div>
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
            <dt className="text-[11px] text-ink-400">{item.label}</dt>
            <dd className="mt-0.5 truncate text-[13px] font-medium text-ink-900">{item.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-ink-200/60 pt-4">
        <div className="flex items-center justify-between gap-3">
          <MetaLabel size="sm">Preview</MetaLabel>
          <span className="rounded-full bg-ink-900/[0.04] px-2 py-0.5 text-[11px] text-ink-500">
            {resolvedTheme === "dark" ? "Dark" : "Light"}
          </span>
        </div>
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3">
            <span
              className="h-8 w-8 shrink-0 rounded-lg border border-ink-200"
              style={{ background: readSchemeSwatch(preference.colorScheme) }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="h-2.5 w-32 rounded-full bg-ink-900/20" />
              <div className="mt-2 h-2 w-48 max-w-full rounded-full bg-ink-900/10" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-10 rounded-full"
              style={{ background: readAccentSwatch(preference.accentColor) }}
              aria-hidden="true"
            />
            <span className="h-2.5 w-16 rounded-full bg-ink-900/10" aria-hidden="true" />
            <span className="h-2.5 w-12 rounded-full bg-ink-900/10" aria-hidden="true" />
          </div>
          <p className="text-[12px] leading-5 text-ink-500">
            预览使用当前全局 token 渲染，用来检查颜色、字体和字号是否在桌面设置窗口里同步生效。
          </p>
        </div>
      </div>
    </div>
  );
}

function AppearanceTokenContract({ rows }: { rows: AppearanceTokenRow[] }): JSX.Element {
  return (
    <div className="overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] border-b border-ink-200/70 pb-2 text-[11px] font-medium text-ink-400">
        <span>DOM attribute</span>
        <span>Current value</span>
      </div>
      <div className="divide-y divide-ink-200/60">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-3 py-2.5 text-[12px]">
            <code className="min-w-0 truncate font-mono text-ink-700">{row.label}</code>
            <code className="min-w-0 truncate font-mono text-terra-600">{row.value}</code>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] leading-5 text-ink-500">
        外观变更会写入本地偏好，并通过窗口间同步让已打开的 Senera 窗口一起更新。
      </p>
    </div>
  );
}

function SettingsPlaceholder({ section }: { section: SettingsSectionDefinition }): JSX.Element {
  const Icon = section.icon;
  const plan = readSettingsSectionPlan(section.id);
  return (
    <div className="max-w-[760px] space-y-4">
      <SettingsPanel title={section.label} description={section.description}>
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-ink-200 bg-paper-100 text-ink-450">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-ink-900">{plan.title}</h3>
            <p className="mt-1 text-[12px] leading-5 text-ink-500">
              这个分区仍处于 legacy compatibility 阶段，现有完整功能暂时保留在原配置入口中。
            </p>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-ink-200/70 bg-paper-100/55">
          {plan.items.map((item, index) => (
            <div
              key={item}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-ink-650",
                index > 0 && "border-t border-ink-200/60",
              )}
            >
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-350" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </SettingsPanel>
    </div>
  );
}

function AboutSettings({ activeSectionId }: { activeSectionId: SettingsSectionId }): JSX.Element {
  const bridge = readDesktopBridge();
  const diagnostics = createSettingsDiagnostics({
    appVersion: __SENERA_APP_VERSION__,
    frontendVersion: __SENERA_FRONTEND_VERSION__,
    mode: import.meta.env.MODE,
    isDesktop: bridge?.isDesktop === true,
    section: activeSectionId,
  });

  return (
    <div className="max-w-[760px] space-y-4">
      <SettingsPanel title="关于 Senera" description="用于确认当前运行表面、版本和桌面验证入口。">
        <div className="overflow-hidden rounded-lg border border-ink-200/70 bg-paper-100/55">
          {diagnostics.map((row, index) => (
            <div
              key={row.label}
              className={cn(
                "grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-[12.5px]",
                index > 0 && "border-t border-ink-200/60",
              )}
            >
              <span className="text-ink-450">{row.label}</span>
              <span className="min-w-0 truncate font-mono text-ink-800">{row.value}</span>
            </div>
          ))}
        </div>
      </SettingsPanel>
      <SettingsPanel title="本地验证" description="这些命令用于验证桌面端实际窗口和前端构建，不依赖 npm run server。">
        <div className="grid gap-2">
          <CommandRow command="npm run frontend" label="启动前端 HMR 服务" />
          <CommandRow command="npm run desktoplive" label="启动桌面端 live 验证" />
          <CommandRow command="npm run desktopverify" label="构建主进程和前端" />
          <CommandRow command="npm run desktoppack" label="打包安装程序" />
        </div>
      </SettingsPanel>
    </div>
  );
}

function CommandRow({ label, command }: { label: string; command: string }): JSX.Element {
  const { copied, copyText } = useClipboardCopy({
    successMessage: "已复制验证命令",
  });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-ink-200/70 bg-paper-100/55 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-ink-850">{label}</div>
        <code className="mt-0.5 block truncate font-mono text-[11.5px] text-ink-500">{command}</code>
      </div>
      <IconButton
        label="复制命令"
        tooltip={copied ? "已复制" : "复制命令"}
        size="sm"
        tone="muted"
        onClick={() => void copyText(command)}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-terra-500" /> : <Copy className="h-3.5 w-3.5" />}
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
        "flex min-h-[96px] min-w-0 flex-col rounded-lg border p-3 text-left transition",
        "hover:border-ink-300 hover:bg-ink-900/[0.025]",
        selected ? "border-terra-300 bg-terra-100/70" : "border-ink-200/70 bg-paper-50",
      )}
      aria-pressed={selected}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-900">
        {title}
        {selected ? <Check className="h-3.5 w-3.5 text-terra-500" /> : null}
      </span>
      <span className="mt-1.5 text-[11.5px] leading-4 text-ink-500">{description}</span>
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
  separated?: boolean;
  onCheckedChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-ink-900/[0.035]",
        separated && "border-t border-ink-200/60",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink-900">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-5 text-ink-500">{description}</span>
      </span>
      <span
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition", checked ? "bg-terra-500" : "bg-ink-200")}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-paper-50 shadow-sm transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

function noop(): void {}

function noopSave(): string | null {
  return null;
}

function isWorkspaceSection(sectionId: SettingsSectionId): boolean {
  return workspaceSectionIds.has(sectionId);
}

const workspaceSectionIds = new Set<SettingsSectionId>([
  "model-service",
  "default-model",
  "runtime",
  "planning",
  "retrieval",
  "storage",
  "skills",
]);

function readWorkbenchRuntimeStatuses({
  configDraftState,
  pluginSettings,
  systemConfigReady,
}: {
  configDraftState: ReturnType<typeof useConfigSettingsDraftState>;
  pluginSettings?: PluginSettingsCommandsHandle;
  systemConfigReady: boolean;
}): Partial<Record<SettingsSectionId, SettingsSectionRuntimeStatus>> {
  const configStatus = readConfigSectionRuntimeStatus({
    dirty: configDraftState.dirty,
    localError: configDraftState.localError,
    ready: systemConfigReady,
    saving: configDraftState.saving,
    validationErrors: configDraftState.validationErrors,
  });
  const pluginConfigs = pluginSettings?.pluginConfigs ?? [];
  const pluginStatus = pluginSettings
    ? readPluginSectionRuntimeStatus({
        operationStatuses: Object.values(pluginSettings.pluginConfigOperations).map((operation) => operation.status),
        pluginErrors: pluginConfigs.filter((plugin) =>
          plugin.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
        ).length,
        pluginsLoaded: pluginConfigs.length > 0,
        pluginsNeedingConfig: pluginConfigs.filter((plugin) => plugin.needsUserConfig).length,
      })
    : undefined;

  return {
    ...(configStatus
      ? {
          system: configStatus,
          runtime: configStatus,
          planning: configStatus,
          retrieval: configStatus,
          storage: configStatus,
        }
      : {}),
    ...(pluginStatus ? { skills: pluginStatus } : {}),
  };
}

const runtimeStatusClassName = {
  dirty: "bg-amber-50 text-amber-700",
  error: "bg-brick-50 text-brick-700",
  idle: "bg-ink-900/[0.045] text-ink-500",
  needs_attention: "bg-amber-50 text-amber-700",
  saving: "bg-sky-50 text-sky-700",
  synced: "bg-moss-50 text-moss-700",
} as const;
