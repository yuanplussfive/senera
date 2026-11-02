import { PluginSettingsPreview } from "../../../dev/PluginSettingsPreview";

export const Dependencies = () => (
  <div className="h-[min(760px,100dvh)]" aria-label="运行时依赖">
    <PluginSettingsPreview surface="dependencies" />
  </div>
);
