import type { PluginSettingsCommandsHandle } from "../../../app/usePluginSettingsCommands";
import { PluginConfigContent } from "../../chat/PluginConfigPanel";
import { SettingsWorkspaceState } from "../SettingsWorkspaceSurface";

export function SkillSettingsSection({
  pluginSettings,
  onDirtyChange,
}: {
  pluginSettings?: PluginSettingsCommandsHandle;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  if (!pluginSettings) {
    return <SettingsWorkspaceState>正在连接技能配置服务</SettingsWorkspaceState>;
  }

  return (
    <PluginConfigContent
      layoutMode="workspace"
      plugins={pluginSettings.pluginConfigs}
      operations={pluginSettings.pluginConfigOperations}
      onRefresh={pluginSettings.refreshPluginConfigs}
      onSave={pluginSettings.savePluginConfig}
      onSetEnabled={pluginSettings.setPluginEnabled}
      onDirtyChange={onDirtyChange}
    />
  );
}
