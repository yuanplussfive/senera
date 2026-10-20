import type { Story } from "@ladle/react";
import { StatusToken } from "./StatusToken";

export const States: Story = () => (
  <div className="min-h-[320px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[640px] space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold text-content-strong">状态标签</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
          固定高度让短中文和英文状态在密集行中保持视觉居中。
        </p>
      </div>
      <section className="border-t border-line-subtle pt-5">
        <h2 className="text-[14px] font-semibold text-content-strong">常规尺寸</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusToken className="border border-emerald-500/50 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300">
            已连接
          </StatusToken>
          <StatusToken className="border border-umber-500/50 bg-umber-500/5 text-umber-700 dark:text-umber-300">
            等待输入
          </StatusToken>
          <StatusToken className="border border-brick-500/50 bg-brick-500/5 text-brick-700 dark:text-brick-300">
            不可用
          </StatusToken>
        </div>
      </section>
      <section className="border-t border-line-subtle pt-5">
        <h2 className="text-[14px] font-semibold text-content-strong">紧凑尺寸</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusToken size="compact" className="border border-line bg-surface-panel text-content-secondary">
            2 项配置
          </StatusToken>
          <StatusToken size="compact" className="border border-line bg-surface-panel text-content-secondary">
            无需配置
          </StatusToken>
        </div>
      </section>
    </div>
  </div>
);
