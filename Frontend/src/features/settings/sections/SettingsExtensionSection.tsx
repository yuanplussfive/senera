import { DefaultModelSection } from "./DefaultModelSection";
import { McpServersSection } from "./McpServersSection";
import { ModelServiceSection } from "./ModelServiceSection";
import { SystemToolsSection } from "./SystemToolsSection";
import type { SettingsSystemConfigHandle } from "../SettingsContracts";
import type { SettingsSectionId } from "../types";
import type { ConfigSettingsDraftState } from "./configSettingsDraftState";

type SettingsExtensionSectionId = Extract<
  SettingsSectionId,
  "default-model" | "model-service" | "system-tools" | "mcp-servers"
>;

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
    case "default-model":
      return <DefaultModelSection draftState={draftState} systemConfig={systemConfig} />;
    case "model-service":
      return <ModelServiceSection systemConfig={systemConfig} onDirtyChange={onEntityDraftChange} />;
    case "system-tools":
      return <SystemToolsSection draftState={draftState} systemConfig={systemConfig} />;
    case "mcp-servers":
      return <McpServersSection systemConfig={systemConfig} onDirtyChange={onEntityDraftChange} />;
  }
}
