import { useEffect, useMemo, useRef, useState } from "react";
import { useFrontendLocale } from "../../i18n/useFrontendLocale";
import { classifySettingsShellLayout, useObservedLayout } from "../../shared/responsive";
import {
  createSettingsSearchEntries,
  groupSettingsSectionResults,
  searchSettingsSectionResults,
} from "./settingsPresentation";
import { SettingsContent } from "./SettingsContent";
import { DiscardSectionDraftDialog, SettingsNavigation, SettingsWorkbenchLayout } from "./SettingsWorkbenchLayout";
import type { SettingsWorkbenchProps } from "./SettingsWorkbenchContracts";
import { useConfigSettingsDraftState } from "./sections/configSettingsDraftState";
import { readSettingsSection, settingsSections, type SettingsSectionId } from "./types";

export type { SettingsEnvironment, SettingsWorkbenchProps } from "./SettingsWorkbenchContracts";

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
  systemConfig,
}: SettingsWorkbenchProps): JSX.Element {
  useFrontendLocale();
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
  const settingsSearchEntries = useMemo(
    () => createSettingsSearchEntries(systemConfig?.configSnapshot?.form.sections),
    [systemConfig?.configSnapshot?.form.sections],
  );
  const groupedResults = useMemo(
    () =>
      groupSettingsSectionResults(searchSettingsSectionResults(settingsSections, sectionSearch, settingsSearchEntries)),
    [sectionSearch, settingsSearchEntries],
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
    <SettingsWorkbenchLayout
      activeSection={activeSection}
      layout={shellLayout}
      navigation={navigation}
      navigationOpen={navigationOpen}
      onNavigationOpenChange={setNavigationOpen}
      overlay={
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
      }
      shellActions={shellActions}
      shellRef={shellRef}
      showSectionHeader={showSectionHeader}
    >
      <SettingsContent
        activeSection={activeSection}
        configDraftState={configDraftState}
        environment={environment}
        motionLevel={motionLevel}
        onEntityDraftChange={setEntityDraftDirty}
        onMotionLevelChange={onMotionLevelChange}
        onValueChange={onValueChange}
        systemConfig={systemConfig}
        values={values}
      />
    </SettingsWorkbenchLayout>
  );
}

function usesOwnSectionHeader(sectionId: SettingsSectionId): boolean {
  return sectionId === "model-service" || sectionId === "default-model";
}

function noop(): void {}
function noopSave(): string | null {
  return null;
}
