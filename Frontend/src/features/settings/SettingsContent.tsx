import { lazy, Suspense, type ReactNode } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { JsonConfigSettingsView } from "../../shared/config/JsonConfigForm";
import { motionTimings, MotionIconSwap, useMotionLevel } from "../../shared/motion";
import { Button, ResonanceTrace, ScrollArea, StateView, Tooltip } from "../../shared/ui";
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

const ChannelsSection = lazy(() =>
  import("./sections/ChannelsSection").then((module) => ({ default: module.ChannelsSection })),
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
    <div className="min-h-0 flex-1 overflow-hidden bg-surface-subtle" data-settings-content-frame>
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
  return <StateView status="loading" className="min-h-[180px]" />;
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
          hidden: { opacity: 0, y: 4 },
          show: { opacity: 1, y: 0, transition: motionTimings.section },
          exit: { opacity: 0, y: -2, transition: motionTimings.fast },
        };
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={sectionId}
        className={cn("relative", className)}
        data-settings-section={sectionId}
        variants={variants}
        initial="hidden"
        animate="show"
        exit="exit"
        transition={motionTimings.section}
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
    case "channels":
      return <ChannelsSection draftState={configDraftState} systemConfig={systemConfig} />;
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
        className="min-h-[220px] bg-surface-subtle"
        description={frontendMessage("settings.state.loadingConfig")}
      />
    );
  return (
    <DraftBackedSection draftState={draftState} ready>
      <div className="mx-auto w-full max-w-[900px] px-5 py-5 sm:px-6 sm:py-6">
        <JsonConfigSettingsView
          layoutMode="embedded"
          sections={sections}
          showSectionHeading={sections.length > 1}
          value={draftState.draft}
          emptyText={frontendMessage("settings.state.emptySection")}
          onChange={draftState.updateDraft}
          onCommit={draftState.flushSave}
        />
      </div>
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
        data-state={saveStatus || draftState.dirty ? "visible" : "idle"}
        data-save-phase={
          draftState.saving ? "saving" : draftState.savedRecently ? "saved" : draftState.dirty ? "pending" : "idle"
        }
        className="senera-save-status flex h-7 items-center justify-end overflow-hidden px-4 pt-1 text-[11px] opacity-0"
        aria-live="polite"
        aria-hidden={!saveStatus || undefined}
      >
        <motion.span
          key={saveStatus || "idle"}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: saveStatus ? 1 : 0, y: saveStatus ? 0 : 3 }}
          transition={motionTimings.feedback}
          className={cn(
            "inline-flex items-center gap-1.5",
            draftState.savedRecently ? "text-accent-content" : "text-ink-500",
          )}
        >
          <MotionIconSwap stateKey={draftState.saving ? "saving" : "saved"}>
            <ResonanceTrace size="sm" state={draftState.saving ? "running" : "settled"} />
          </MotionIconSwap>
          <span>{saveStatus}</span>
        </motion.span>
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
      <div>{children}</div>
    </SettingsWorkspaceFrame>
  );
}

function isFullHeightWorkspace(sectionId: SettingsSectionId): boolean {
  return (
    sectionId === "model-service" ||
    sectionId === "system-tools" ||
    sectionId === "mcp-servers" ||
    sectionId === "channels"
  );
}

function sectionWidthClassName(sectionId: SettingsSectionId): string {
  if (sectionId === "appearance") return "mx-auto w-full max-w-[1120px]";
  if (sectionId === "general") return "mx-auto w-full max-w-[1120px]";
  if (sectionId === "about") return "mx-auto w-full max-w-[980px]";
  if (sectionId === "default-model") return "mx-auto w-full max-w-[960px]";
  if (sectionId === "runtime" || sectionId === "planning" || sectionId === "retrieval" || sectionId === "storage") {
    return "mx-auto w-full max-w-[980px]";
  }
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
  return "bg-surface-canvas px-5 py-5 sm:px-8 sm:py-6";
}
