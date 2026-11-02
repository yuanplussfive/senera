import type { Story } from "@ladle/react";
import { SettingsSectionLoading } from "./SettingsLoading";

export const Form: Story = () => (
  <section>
    <h2 className="px-5 py-3 text-sm text-content-secondary">表单加载</h2>
    <SettingsSectionLoading />
  </section>
);
export const Split: Story = () => (
  <section>
    <h2 className="px-5 py-3 text-sm text-content-secondary">双栏加载</h2>
    <SettingsSectionLoading variant="split" />
  </section>
);
export const Directory: Story = () => (
  <section>
    <h2 className="px-5 py-3 text-sm text-content-secondary">目录加载</h2>
    <SettingsSectionLoading variant="directory" />
  </section>
);
