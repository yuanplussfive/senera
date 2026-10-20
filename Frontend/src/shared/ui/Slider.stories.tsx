import type { Story } from "@ladle/react";
import { useState } from "react";
import { Slider } from "./Slider";

const fontScaleMarks = [
  { value: 0.96, label: "紧凑" },
  { value: 1, label: "标准" },
  { value: 1.04, label: "舒展" },
  { value: 1.08, label: "大字" },
];

export const States: Story = () => {
  const [fontScale, setFontScale] = useState(1);
  const [cropScale, setCropScale] = useState(1.35);

  return (
    <div className="min-h-[520px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[680px] space-y-8">
        <div>
          <h1 className="text-[20px] font-semibold text-content-strong">滑杆</h1>
          <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
            保留原生键盘操作与辅助技术语义；刻度、轨道和拇指由共享组件统一呈现。
          </p>
        </div>

        <section className="border-t border-line-subtle pt-5">
          <h2 className="text-[14px] font-semibold text-content-strong">带刻度的字号</h2>
          <div className="mt-4 max-w-[420px]">
            <Slider
              ariaLabel="界面字号"
              value={fontScale}
              min={0.9}
              max={1.12}
              step={0.001}
              marks={fontScaleMarks}
              label="界面字号"
              showValue
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onValueChange={setFontScale}
            />
          </div>
        </section>

        <section className="border-t border-line-subtle pt-5">
          <h2 className="text-[14px] font-semibold text-content-strong">紧凑连续值</h2>
          <div className="mt-4 max-w-[420px]">
            <Slider
              ariaLabel="头像裁剪缩放"
              value={cropScale}
              min={1}
              max={3}
              step={0.01}
              size="compact"
              variant="scrubber"
              label="裁剪缩放"
              showValue
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onValueChange={setCropScale}
            />
          </div>
        </section>

        <section className="border-t border-line-subtle pt-5">
          <h2 className="text-[14px] font-semibold text-content-strong">禁用状态</h2>
          <div className="mt-4 max-w-[420px]">
            <Slider
              ariaLabel="禁用的阈值"
              value={60}
              min={0}
              max={100}
              step={5}
              steps={[0, 20, 40, 60, 80, 100]}
              showValue
              formatValue={(value) => `${value}%`}
              disabled
              onValueChange={() => undefined}
            />
          </div>
        </section>
      </div>
    </div>
  );
};
