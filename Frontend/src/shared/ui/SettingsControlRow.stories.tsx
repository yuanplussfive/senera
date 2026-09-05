import type { Story } from "@ladle/react";
import { useState } from "react";
import { MenuSelect } from "./MenuSelect";
import { SettingsControlRow } from "./SettingsControlRow";

export const Default: Story = () => {
  const [value, setValue] = useState("standard");
  return (
    <main className="min-h-[320px] bg-surface-canvas p-8 text-content-primary">
      <div className="mx-auto max-w-[720px] border-y border-line-subtle">
        <SettingsControlRow
          label="工作区字号"
          description="控制设置和工作台中的界面文字比例。"
          control={
            <MenuSelect
              value={value}
              placeholder="选择字号"
              options={[
                { value: "compact", label: "紧凑" },
                { value: "standard", label: "标准" },
                { value: "comfortable", label: "舒展" },
              ]}
              ariaLabel="工作区字号"
              onChange={setValue}
            />
          }
        />
      </div>
    </main>
  );
};
