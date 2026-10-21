import { ModelServiceSection } from "./ModelServiceSection";
import { PluginsSection } from "./PluginsSection";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import type { SettingsSectionId } from "../types";
import type { ConfigSettingsDraftState } from "./configSettingsDraftState";

type SettingsExtensionSectionId = Extract<SettingsSectionId, "model-service" | "system-tools" | "mcp-servers">;

export function SettingsExtensionSection({
  sectionId,
  draftState,
  systemConfig,
  onEntityDraftChange,
}: {
  sectionId: SettingsExtensionSectionId;
  draftState: ConfigSettingsDraftState;
  systemConfig?: SettingsSystemConfigHandle;
  onEntityDraftChange: (dirty: boolean) => void;
}): JSX.Element {
  switch (sectionId) {
    case "model-service":
      return <ModelServiceSection systemConfig={systemConfig} onDirtyChange={onEntityDraftChange} />;
    case "system-tools":
    case "mcp-servers":
      return <PluginsSection draftState={draftState} systemConfig={systemConfig} />;
  }
}
