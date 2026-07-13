import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  FolderCog,
  Loader2,
  RefreshCw,
  Route,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import type {
  ConfigMutationState,
  ConfigSnapshotData,
  ProviderModelEndpointInput,
  ProviderModelsFailedData,
  ProviderModelsSnapshotData,
} from "../../api/eventTypes";
import { cn } from "../../lib/util";
import {
  Button,
  ScrollArea,
} from "../../shared/ui";
import {
  JsonConfigSettingsView,
} from "../../shared/config/JsonConfigForm";
import { ModelConfigView } from "./ModelConfigView";
import { PlanningConfigView } from "./PlanningConfigView";
import { VectorModelConfigView } from "./VectorModelConfigView";
import {
  useConfigSettingsDraftState,
  type ConfigSettingsDraftState,
} from "../settings/sections/configSettingsDraftState";
import { readSettingsDraftInteraction } from "../settings/settingsInteractionModel";

export interface SystemConfigContentProps {
  active?: boolean;
  className?: string;
  contentReady?: boolean;
  layoutMode?: "panel" | "embedded";
  operation: ConfigMutationState | null;
  snapshot: ConfigSnapshotData | null;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  providerModelLoadingIds: Record<string, boolean>;
  onRefresh: () => void;
  onSave: (config: Record<string, unknown>) => string | null;
  onFetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
  draftState?: ConfigSettingsDraftState;
}

export function SystemConfigContent({
  layoutMode = "panel",
  operation,
  snapshot,
  providerModelCatalogs,
  providerModelErrors,
  providerModelLoadingIds,
  onRefresh,
  onSave,
  onFetchProviderModels,
  draftState: externalDraftState,
  active = true,
  className,
  contentReady = true,
}: SystemConfigContentProps): JSX.Element {
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const currentSnapshotVersion = snapshot?.version;
  const sectionList = snapshot?.form.sections ?? [];
  const visibleSections = useMemo(
    () => selectedSection
      ? sectionList.filter((section) => section.name === selectedSection)
      : sectionList.slice(0, 1),
    [sectionList, selectedSection],
  );
  const internalDraftState = useConfigSettingsDraftState({
    active,
    operation,
    snapshot,
    onRefresh,
    onSave,
  });
  const draftState = externalDraftState ?? internalDraftState;
  const interaction = readSettingsDraftInteraction({
    dirty: draftState.dirty,
    localError: draftState.localError,
    ready: Boolean(snapshot),
    saving: draftState.saving,
    validationErrors: draftState.validationErrors,
  });
  const embedded = layoutMode === "embedded";

  useEffect(() => {
    if (!active || !snapshot) return;
    setSelectedSection((current) =>
      current && snapshot.form.sections.some((section) => section.name === current)
        ? current
        : snapshot.form.sections[0]?.name ?? null);
  }, [active, currentSnapshotVersion, snapshot]);

  if (embedded) {
    return (
      <div className={cn("bg-[var(--theme-config-stage-bg)]", className)}>
        <EmbeddedConfigSectionNav
          sections={sectionList}
          selectedSection={selectedSection}
          onSelect={setSelectedSection}
        />
        <ConfigToolbar
          interaction={interaction}
          onRefresh={draftState.refreshOrRestore}
          onSave={draftState.save}
        />
        <Diagnostics
          diagnostics={draftState.diagnostics}
          localError={draftState.localError}
          validationErrors={draftState.validationErrors}
        />
        {!contentReady ? (
          <ConfigPanelSkeleton />
        ) : snapshot ? (
          <SystemConfigSectionContent
            layoutMode={layoutMode}
            selectedSection={selectedSection}
            visibleSections={visibleSections}
            draftState={draftState}
            providerModelCatalogs={providerModelCatalogs}
            providerModelErrors={providerModelErrors}
            providerModelLoadingIds={providerModelLoadingIds}
            onFetchProviderModels={onFetchProviderModels}
          />
        ) : (
          <div className="grid min-h-[360px] place-items-center text-[13px] text-ink-400">
            {frontendMessage("runtime.migrated.features.chat.SystemConfigPanel.141.13")}</div>
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      "grid h-full min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--theme-config-stage-bg)] lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]",
      className,
    )}>
      <ConfigSectionNav
        sections={sectionList}
        selectedSection={selectedSection}
        onSelect={setSelectedSection}
      />
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-ink-200/70 bg-paper-50 lg:border-b-0">
        <MobileSectionNav
          sections={sectionList}
          selectedSection={selectedSection}
          onSelect={setSelectedSection}
        />
        <ConfigToolbar
          interaction={interaction}
          onRefresh={draftState.refreshOrRestore}
          onSave={draftState.save}
        />
        <Diagnostics
          diagnostics={draftState.diagnostics}
          localError={draftState.localError}
          validationErrors={draftState.validationErrors}
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!contentReady ? (
            <ConfigPanelSkeleton />
          ) : snapshot ? (
            <SystemConfigSectionContent
              layoutMode={layoutMode}
              selectedSection={selectedSection}
              visibleSections={visibleSections}
              draftState={draftState}
              providerModelCatalogs={providerModelCatalogs}
              providerModelErrors={providerModelErrors}
              providerModelLoadingIds={providerModelLoadingIds}
              onFetchProviderModels={onFetchProviderModels}
            />
          ) : (
            <div className="grid h-full place-items-center text-[13px] text-ink-400">
              {frontendMessage("runtime.migrated.features.chat.SystemConfigPanel.190.15")}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function SystemConfigSectionContent({
  layoutMode,
  selectedSection,
  visibleSections,
  draftState,
  providerModelCatalogs,
  providerModelErrors,
  providerModelLoadingIds,
  onFetchProviderModels,
}: {
  layoutMode: "panel" | "embedded";
  selectedSection: string | null;
  visibleSections: ConfigSnapshotData["form"]["sections"];
  draftState: ConfigSettingsDraftState;
  providerModelCatalogs: Record<string, ProviderModelsSnapshotData>;
  providerModelErrors: Record<string, ProviderModelsFailedData & { updatedAt: string }>;
  providerModelLoadingIds: Record<string, boolean>;
  onFetchProviderModels: (providerId: string, force?: boolean, endpoint?: ProviderModelEndpointInput) => void;
}): JSX.Element {
  if (selectedSection === "models") {
    return (
      <ModelConfigView
        layoutMode={layoutMode}
        value={draftState.draft}
        section={visibleSections[0]}
        disabled={draftState.saving}
        catalogs={providerModelCatalogs}
        errors={providerModelErrors}
        loadingProviderIds={providerModelLoadingIds}
        onFetchProviderModels={onFetchProviderModels}
        onChange={draftState.updateDraft}
      />
    );
  }
  if (selectedSection === "retrieval") {
    return (
      <VectorModelConfigView
        layoutMode={layoutMode}
        value={draftState.draft}
        section={visibleSections[0]}
        disabled={draftState.saving}
        onChange={draftState.updateDraft}
      />
    );
  }
  if (selectedSection === "planning") {
    return (
      <PlanningConfigView
        layoutMode={layoutMode}
        value={draftState.draft}
        section={visibleSections[0]}
        disabled={draftState.saving}
        onChange={draftState.updateDraft}
      />
    );
  }
  return (
    <JsonConfigSettingsView
      layoutMode={layoutMode}
      sections={visibleSections}
      value={draftState.draft}
      disabled={draftState.saving}
      onChange={draftState.updateDraft}
    />
  );
}

function ConfigPanelSkeleton(): JSX.Element {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-paper-50 text-[12.5px] text-ink-400">
      <div className="grid gap-2 text-center">
        <span className="mx-auto h-8 w-8 rounded-full border border-ink-200 bg-paper-100" />
        <span>{frontendMessage("runtime.migrated.features.chat.SystemConfigPanel.271.15")}</span>
      </div>
    </div>
  );
}

function ConfigToolbar({
  interaction,
  onRefresh,
  onSave,
}: {
  interaction: ReturnType<typeof readSettingsDraftInteraction>;
  onRefresh: () => void;
  onSave: () => void;
}): JSX.Element {
  const invalid = interaction.status === "invalid";

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-200/70 bg-[var(--theme-config-toolbar-bg)] px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn(
          "grid h-8 w-8 place-items-center border",
          invalid
            ? "border-brick-200 bg-brick-50 text-brick-600"
            : interaction.status === "dirty" || interaction.status === "saving"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-terra-200 bg-terra-50 text-terra-700",
        )}>
          {invalid ? (
            <AlertTriangle className="h-4 w-4" />
          ) : interaction.status === "saving" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : interaction.status === "dirty" ? (
            <Settings className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">{interaction.statusLabel}</div>
          <div className="mt-0.5 text-[11px] text-ink-500">{interaction.detail}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={interaction.refreshDisabled}
          onClick={onRefresh}
          className="h-8"
          title={interaction.refreshTitle}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", interaction.status === "saving" && "animate-spin")} />
          {interaction.refreshLabel}
        </Button>
        <Button
          size="sm"
          disabled={interaction.saveDisabled}
          onClick={onSave}
          className="h-8"
          title={interaction.saveTitle}
        >
          {interaction.status === "saving"
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Save className="h-3.5 w-3.5" />}
          {frontendMessage("runtime.migrated.features.chat.SystemConfigPanel.337.11")}</Button>
      </div>
    </div>
  );
}

function ConfigSectionNav({
  sections,
  selectedSection,
  onSelect,
}: {
  sections: ConfigSnapshotData["form"]["sections"];
  selectedSection: string | null;
  onSelect: (section: string) => void;
}): JSX.Element {
  return (
    <aside className="hidden min-h-0 border-r border-ink-200/70 bg-[var(--theme-config-nav-bg)] lg:flex lg:flex-col">
      <div className="shrink-0 border-b border-ink-200/70 px-3.5 py-3.5">
        <div className="text-[12px] font-semibold text-ink-900">{frontendMessage("runtime.migrated.features.chat.SystemConfigPanel.356.65")}</div>
        <div className="mt-1 text-[11px] text-ink-500">{frontendMessage("runtime.migrated.features.chat.SystemConfigPanel.357.56")}</div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {sections.map((section) => {
            const active = section.name === selectedSection;
            const Icon = sectionIcon(section.icon);
            return (
              <button
                key={section.name}
                type="button"
                className={cn(
                  "w-full rounded-md px-2.5 py-2 text-left transition",
                  active
                    ? "bg-paper-50 text-ink-900 shadow-panel"
                    : "text-ink-600 hover:bg-paper-50/70 hover:text-ink-900",
                )}
                onClick={() => onSelect(section.name)}
              >
                <span className="flex min-w-0 items-start gap-2">
                  <span className={cn(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border",
                    active ? "border-terra-200 bg-terra-50 text-terra-700" : "border-ink-200 bg-paper-100 text-ink-450",
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{section.label}</span>
                    {section.description ? (
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-ink-500">
                        {section.description}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}

function EmbeddedConfigSectionNav({
  sections,
  selectedSection,
  onSelect,
}: {
  sections: ConfigSnapshotData["form"]["sections"];
  selectedSection: string | null;
  onSelect: (section: string) => void;
}): JSX.Element {
  return (
    <div className="border-b border-ink-200/70 bg-[var(--theme-config-nav-bg)] px-3 py-3">
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {sections.map((section) => {
          const active = section.name === selectedSection;
          const Icon = sectionIcon(section.icon);
          return (
            <button
              key={section.name}
              type="button"
              title={section.description ?? section.label}
              className={cn(
                "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition",
                active
                  ? "bg-paper-50 text-ink-900 shadow-panel"
                  : "text-ink-500 hover:bg-paper-50/70 hover:text-ink-900",
              )}
              onClick={() => onSelect(section.name)}
            >
              <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-terra-600" : "text-ink-400")} />
              <span className="truncate">{section.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MobileSectionNav({
  sections,
  selectedSection,
  onSelect,
}: {
  sections: ConfigSnapshotData["form"]["sections"];
  selectedSection: string | null;
  onSelect: (section: string) => void;
}): JSX.Element {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200/70 bg-[var(--theme-config-nav-bg)] px-2 py-2 lg:hidden">
      {sections.map((section) => {
        const Icon = sectionIcon(section.icon);
        return (
          <button
            key={section.name}
            type="button"
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition",
              section.name === selectedSection
                ? "bg-paper-50 text-ink-900 shadow-panel"
                : "text-ink-500 hover:bg-paper-50/70 hover:text-ink-900",
            )}
            onClick={() => onSelect(section.name)}
          >
            <Icon className="h-3.5 w-3.5" />
            {section.label}
          </button>
        );
      })}
    </div>
  );
}

function sectionIcon(icon: string | undefined): typeof Settings {
  switch (icon) {
    case "brain-circuit":
      return BrainCircuit;
    case "sliders-horizontal":
      return SlidersHorizontal;
    case "route":
      return Route;
    case "search":
      return Search;
    case "folder-cog":
      return FolderCog;
    default:
      return Settings;
  }
}

function Diagnostics({
  diagnostics,
  localError,
  validationErrors,
}: {
  diagnostics: ConfigSnapshotData["diagnostics"];
  localError: string | null;
  validationErrors: string[];
}): JSX.Element | null {
  const items = [
    ...diagnostics,
    ...validationErrors.map((message) => ({ severity: "error" as const, message })),
    ...(localError ? [{ severity: "error" as const, message: localError }] : []),
  ];
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="shrink-0 space-y-1 border-b border-ink-200/60 bg-paper-50 px-3 py-2 sm:px-5">
      {items.slice(0, 4).map((item, index) => (
        <div
          key={`${item.severity}-${index}`}
          className={cn(
            "whitespace-pre-wrap border px-2 py-1.5 text-[12px]",
            item.severity === "error"
              ? "border-brick-200 bg-brick-50 text-brick-700"
              : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          {item.message}
        </div>
      ))}
      {items.length > 4 ? (
        <div className="px-1 text-[11px] text-ink-400">{frontendMessage("runtime.migrated.features.chat.SystemConfigPanel.524.56")}{items.length - 4} {frontendMessage("runtime.migrated.features.chat.SystemConfigPanel.524.78")}</div>
      ) : null}
    </div>
  );
}
