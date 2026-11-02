import type { Story } from "@ladle/react";
import { PluginSettingsPreview } from "../../../dev/PluginSettingsPreview";

export const Directory: Story = () => (
  <div className="h-[min(760px,100dvh)] bg-surface-canvas text-content-primary" aria-label="插件目录与详情">
    <PluginSettingsPreview />
  </div>
);
