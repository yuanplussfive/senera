import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { JsonConfigSettingsView } from "../../shared/config/JsonConfigForm";
import { Button, ScrollArea, StateView } from "../../shared/ui";
import type { SettingsSystemConfigHandle } from "./SettingsContracts";
import type { SettingsContentProps } from "./SettingsWorkbenchContracts";
import { readSettingsDraftInteraction } from "./settingsInteractionModel";
import { SettingsWorkspaceFrame } from "./SettingsWorkspaceSurface";
import type { SettingsSectionDefinition, SettingsSectionId } from "./types";
import { AboutSettings } from "./sections/AboutSettings";
import { AppearanceSettings } from "./sections/AppearanceSettings";
import type { ConfigSettingsDraftState } from "./sections/configSettingsDraftState";
import { DefaultModelSection } from "./sections/DefaultModelSection";
import { GeneralSettings } from "./sections/GeneralSettings";
import { ModelServiceSection } from "./sections/ModelServiceSection";
import { McpServersSection } from "./sections/McpServersSection";
import { projectSectionConfigFields } from "./sections/runtimeModelAssignments";
import { SystemToolsSection } from "./sections/SystemToolsSection";

export function SettingsContent({
  activeSection,
  configDraftState,
  environment,
  motionLevel,
  onEntityDraftChange,
  onMotionLevelChange,
  onValueChange,
  systemConfig,
  values,
}: SettingsContentProps & {
  activeSection: SettingsSectionDefinition;
  configDraftState: ConfigSettingsDraftState;
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
  systemConfig,
  values,
}: SettingsContentProps & {
  activeSection: SettingsSectionDefinition;
  configDraftState: ConfigSettingsDraftState;
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
      return (
        <DraftBackedSection draftState={configDraftState} ready={Boolean(systemConfig?.configSnapshot)}>
          <DefaultModelSection draftState={configDraftState} systemConfig={systemConfig} />
        </DraftBackedSection>
      );
    case "model-service":
      return <ModelServiceSection systemConfig={systemConfig} onDirtyChange={onEntityDraftChange} />;
    case "system-tools":
      return <SystemToolsSection systemConfig={systemConfig} onDirtyChange={onEntityDraftChange} />;
    case "mcp-servers":
      return <McpServersSection systemConfig={systemConfig} onDirtyChange={onEntityDraftChange} />;
    case "about":
      return <AboutSettings environment={environment} />;
  }
}

function ConfigFormSectionSettings({
  draftState,
  sectionId,
  systemConfig,
}: {
  draftState: ConfigSettingsDraftState;
  sectionId: Extract<SettingsSectionId, "runtime" | "planning" | "retrieval" | "storage">;
  systemConfig?: SettingsSystemConfigHandle;
}): JSX.Element {
  const allSections = systemConfig?.configSnapshot?.form.sections ?? [];
  const sections = allSections
    .filter((section) => section.name === sectionId)
    .map((section) => projectSectionConfigFields(section, allSections))
    .filter((section) => section.fields.length > 0);
  if (!systemConfig?.configSnapshot)
    return (
      <StateView
        status="loading"
        className="min-h-[360px] bg-paper-50"
        description={frontendMessage("settings.state.loadingConfig")}
      />
    );
  return (
    <DraftBackedSection draftState={draftState} ready>
      <JsonConfigSettingsView
        layoutMode="embedded"
        sections={sections}
        showSectionHeading={sections.length > 1}
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
  draftState: ConfigSettingsDraftState;
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
  const showStatusBar = interaction.status === "invalid" || interaction.status === "conflict";
  const saveStatus = draftState.saving
    ? frontendMessage("settings.draft.savingStatus")
    : draftState.savedRecently
      ? frontendMessage("settings.draft.savedStatus")
      : "";
  const recoveryLabel =
    interaction.status === "conflict"
      ? frontendMessage("settings.draft.loadRemote")
      : draftState.dirty
        ? frontendMessage("settings.draft.discard")
        : frontendMessage("settings.draft.reload");
  const recoveryTitle =
    interaction.status === "conflict"
      ? frontendMessage("settings.draft.loadRemoteTitle")
      : draftState.dirty
        ? frontendMessage("settings.draft.discardTitle")
        : frontendMessage("settings.draft.reloadTitle");

  return (
    <SettingsWorkspaceFrame className="overflow-visible">
      <div
        data-settings-save-status
        className={cn(
          "flex h-7 items-center justify-end px-4 pt-2 text-[11px] transition-opacity duration-150",
          draftState.savedRecently ? "text-accent-content" : "text-ink-500",
          saveStatus ? "opacity-100" : "opacity-0",
        )}
        aria-live="polite"
        aria-hidden={!saveStatus}
      >
        {saveStatus || "\u00a0"}
      </div>
      {showStatusBar ? (
        <div className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 bg-paper-50 px-4 py-2.5">
          <div className="min-w-0 text-[11.5px] leading-5 text-ink-500">{interaction.detail}</div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={interaction.refreshDisabled}
              onClick={draftState.refreshOrRestore}
              title={recoveryTitle}
            >
              {recoveryLabel}
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
      ) : null}
      <div className="pt-2">{children}</div>
    </SettingsWorkspaceFrame>
  );
}

function isFullHeightWorkspace(sectionId: SettingsSectionId): boolean {
  return sectionId === "model-service" || sectionId === "system-tools" || sectionId === "mcp-servers";
}

function sectionWidthClassName(sectionId: SettingsSectionId): string {
  if (sectionId === "appearance" || sectionId === "general") return "mx-auto w-full max-w-[1160px]";
  if (sectionId === "about") return "mx-auto w-full max-w-[1000px]";
  if (sectionId === "default-model") return "mx-auto w-full max-w-[960px]";
  return "mx-auto w-full max-w-[1280px]";
}
