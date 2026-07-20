import type { Story } from "@ladle/react";
import { useState } from "react";
import { Switch } from "./Switch";

export const States: Story = () => {
  const [enabled, setEnabled] = useState(true);
  const [autoSave, setAutoSave] = useState(false);

  return (
    <div className="min-h-[520px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[760px] space-y-6">
        <div>
          <h1 className="text-[20px] font-semibold text-content-strong">主题强调色开关</h1>
          <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
            公共开关只负责轨道、状态和焦点；页面文字放在外层普通布局中。
          </p>
        </div>

        <section className="space-y-4 border border-line-subtle bg-surface-panel p-4">
          <h2 className="text-[14px] font-semibold text-content-strong">纯开关</h2>
          <div className="flex flex-wrap items-center gap-5">
            <Switch checked={enabled} ariaLabel="示例开关" onCheckedChange={setEnabled} />
            <Switch checked={false} disabled ariaLabel="禁用示例开关" onCheckedChange={() => undefined} />
          </div>
        </section>

        <section className="border-t border-line-subtle pt-5">
          <h2 className="text-[14px] font-semibold text-content-strong">需要说明时</h2>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[12.5px] text-content-secondary">自动保存</span>
            <Switch checked={autoSave} ariaLabel="自动保存" onCheckedChange={setAutoSave} />
          </div>
        </section>

        <section className="border-t border-line-subtle pt-5">
          <h2 className="text-[14px] font-semibold text-content-strong">键盘焦点</h2>
          <p className="mt-1 text-[12px] text-content-muted">使用 Tab 可以看到细边界。</p>
          <div className="mt-3">
            <Switch checked ariaLabel="键盘焦点示例" onCheckedChange={() => undefined} />
          </div>
        </section>
      </div>
    </div>
  );
};
