import type { Story } from "@ladle/react";
import { useState } from "react";
import { MenuMultiSelect } from "./MenuMultiSelect";

const regionOptions = [
  { value: "us", label: "美国" },
  { value: "eu", label: "欧洲" },
  { value: "apac", label: "亚太" },
  { value: "legacy", label: "旧区域（不可用）", disabled: true },
] as const;

export const ValueSelection: Story = () => {
  const [regions, setRegions] = useState<readonly string[]>(["us"]);

  return (
    <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[560px]">
        <h1 className="text-[18px] font-semibold text-content-strong">多值选择</h1>
        <div className="mt-6 grid gap-2">
          <label className="text-[13px] font-medium text-content-primary">服务区域</label>
          <MenuMultiSelect
            values={regions}
            placeholder="选择服务区域"
            options={regionOptions}
            ariaLabel="服务区域"
            onChange={setRegions}
          />
        </div>
      </div>
    </main>
  );
};

export const States: Story = () => (
  <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto grid max-w-[560px] gap-6">
      <div className="grid gap-2">
        <span className="text-[13px] font-medium text-content-primary">未选择</span>
        <MenuMultiSelect
          values={[]}
          placeholder="选择服务区域"
          options={regionOptions}
          ariaLabel="空的服务区域选择"
          onChange={() => undefined}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-[13px] font-medium text-content-primary">禁用</span>
        <MenuMultiSelect
          values={["us", "eu"]}
          placeholder="选择服务区域"
          options={regionOptions}
          disabled
          ariaLabel="禁用的服务区域选择"
          onChange={() => undefined}
        />
      </div>
    </div>
  </main>
);
