import { lazy, Suspense, type ReactNode } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { JsonConfigSettingsView } from "../../shared/config/JsonConfigForm";
import { motionTimings, useMotionLevel } from "../../shared/motion";
import { Button, ScrollArea, StateView, Tooltip } from "../../shared/ui";
import type { SettingsSystemConfigHandle } from "./SettingsContracts";
import type { SettingsContentProps } from "./SettingsWorkbenchContracts";
import { readSettingsDraftInteraction } from "./settingsInteractionModel";
import { SettingsWorkspaceFrame } from "./SettingsWorkspaceSurface";
import type { SettingsSectionDefinition, SettingsSectionId } from "./types";
import { AboutSettings } from "./sections/AboutSettings";
import { AppearanceSettings } from "./sections/AppearanceSettings";
import type { ConfigSettingsDraftState } from "./sections/configSettingsDraftState";
import { GeneralSettings } from "./sections/GeneralSettings";
import { projectSectionConfigFields } from "./sections/runtimeModelAssignments";

const SettingsExtensionSection = lazy(() =>
  import("./sections/SettingsExtensionSection").then((module) => ({ default: module.SettingsExtensionSection })),
);

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

  return (
    <div className="min-h-0 flex-1 overflow-hidden" data-settings-content-frame>
      {isFullHeightWorkspace(activeSection.id) ? (
        <SettingsSectionTransition sectionId={activeSection.id} className="h-full min-h-0">
          <Suspense fallback={<SettingsSectionLoading />}>{content}</Suspense>
        </SettingsSectionTransition>
      ) : (
        <ScrollArea className="h-full min-h-0" viewportClassName={settingsViewportClassName(activeSection.id)}>
          <SettingsSectionTransition sectionId={activeSection.id} className={sectionWidthClassName(activeSection.id)}>
            <Suspense fallback={<SettingsSectionLoading />}>{content}</Suspense>
          </SettingsSectionTransition>
        </ScrollArea>
      )}
    </div>
  );
}

function SettingsSectionLoading(): JSX.Element {
  return <StateView status="loading" className="min-h-[260px]" />;
}

function SettingsSectionTransition({
  sectionId,
  className,
  children,
}: {
  sectionId: SettingsSectionId;
  className: string;
  children: ReactNode;
}): JSX.Element {
  const { level, reduceMotion, disableMotion } = useMotionLevel();
  const variants: Variants = disableMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 }, exit: { opacity: 1 } }
    : reduceMotion || level === "reduced"
      ? { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } }
      : {
          hidden: { opacity: 0, y: 10 },
          show: { opacity: 1, y: 0, transition: motionTimings.slow },
          exit: { opacity: 0, y: -6, transition: motionTimings.fast },
        };
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={sectionId}
        className={className}
        data-settings-section={sectionId}
        variants={variants}
        initial="hidden"
        animate="show"
        exit="exit"
        transition={motionTimings.slow}
      >
        {children}
      </motion.div>
    </AnimatePresence>
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
          <SettingsExtensionSection
            sectionId={activeSection.id}
            draftState={configDraftState}
            systemConfig={systemConfig}
            onEntityDraftChange={onEntityDraftChange}
          />
        </DraftBackedSection>
      );
    case "model-service":
    case "system-tools":
    case "mcp-servers":
      return (
        <SettingsExtensionSection
          sectionId={activeSection.id}
          draftState={configDraftState}
          systemConfig={systemConfig}
          onEntityDraftChange={onEntityDraftChange}
        />
      );
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
            <Tooltip content={recoveryTitle} side="top">
              <span className="inline-flex">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={interaction.refreshDisabled}
                  onClick={draftState.refreshOrRestore}
                >
                  {recoveryLabel}
                </Button>
              </span>
            </Tooltip>
            {interaction.status === "conflict" || (interaction.status === "invalid" && !interaction.saveDisabled) ? (
              <Tooltip content={interaction.saveTitle} side="top">
                <span className="inline-flex">
                  <Button size="sm" disabled={interaction.saveDisabled} onClick={draftState.save}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {frontendMessage("settings.action.retry")}
                  </Button>
                </span>
              </Tooltip>
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
  if (sectionId === "appearance") return "mx-auto w-full max-w-[1080px]";
  if (sectionId === "general" || sectionId === "about") return "mx-auto w-full max-w-[880px]";
  if (sectionId === "default-model") return "mx-auto w-full max-w-[960px]";
  return "mx-auto w-full max-w-[1120px]";
}

function settingsViewportClassName(sectionId: SettingsSectionId): string {
  if (
    sectionId === "default-model" ||
    sectionId === "runtime" ||
    sectionId === "planning" ||
    sectionId === "retrieval" ||
    sectionId === "storage"
  ) {
    return "";
  }
  return "px-4 py-5 sm:px-6 sm:py-7";
}
