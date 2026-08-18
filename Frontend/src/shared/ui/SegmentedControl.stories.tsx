import type { Story } from "@ladle/react";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";

const accessOptions = [
  { value: "auto", label: "自动" },
  { value: "required", label: "必须登录" },
  { value: "disabled", label: "关闭" },
] as const;

export const Controlled: Story = () => {
  const [value, setValue] = useState<(typeof accessOptions)[number]["value"]>("auto");

  return (
    <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[560px]">
        <h1 className="text-[18px] font-semibold text-content-strong">紧凑分段选择</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">用于少量互斥选项；方向键可以在选项间移动。</p>

        <div className="mt-6 flex items-center justify-between gap-6 border-y border-line-subtle py-4">
          <span className="text-[13px] font-medium text-content-primary">访问控制模式</span>
          <SegmentedControl ariaLabel="访问控制模式" options={accessOptions} value={value} onChange={setValue} />
        </div>
      </div>
    </main>
  );
};

export const States: Story = () => (
  <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[560px] space-y-7">
      <div>
        <h1 className="text-[18px] font-semibold text-content-strong">分段选择状态</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">覆盖窄宽度和整体禁用状态。</p>
      </div>

      <SegmentedControl
        ariaLabel="对话宽度"
        options={[
          { value: "narrow", label: "窄" },
          { value: "medium", label: "中" },
          { value: "wide", label: "宽" },
        ]}
        value="medium"
        className="w-[240px]"
        onChange={() => undefined}
      />

      <SegmentedControl
        ariaLabel="禁用的访问控制"
        options={accessOptions}
        value="required"
        disabled
        onChange={() => undefined}
      />
    </div>
  </main>
);
