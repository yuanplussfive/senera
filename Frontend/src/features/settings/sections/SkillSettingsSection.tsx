import type { PluginSettingsCommandsHandle } from "../../../app/usePluginSettingsCommands";
import { PluginConfigContent } from "../../chat/PluginConfigPanel";
import { StateView } from "../../../shared/ui";
import { frontendMessage } from "../../../i18n/frontendMessageCatalog";

export function SkillSettingsSection({
  pluginSettings,
  onDirtyChange,
}: {
  pluginSettings?: PluginSettingsCommandsHandle;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  if (!pluginSettings) {
    return (
      <StateView
        status="loading"
        className="min-h-[360px] bg-paper-50"
        description={frontendMessage("settings.state.loadingSkills")}
      />
    );
  }

  return (
    <PluginConfigContent
      layoutMode="workspace"
      plugins={pluginSettings.pluginConfigs}
      operations={pluginSettings.pluginConfigOperations}
      socketStatus={pluginSettings.socketStatus}
      onRefresh={pluginSettings.refreshPluginConfigs}
      onSave={pluginSettings.savePluginConfig}
      onSetEnabled={pluginSettings.setPluginEnabled}
      onDirtyChange={onDirtyChange}
    />
  );
}
