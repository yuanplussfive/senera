import type { Story } from "@ladle/react";
import { ActivityLoader } from "./ActivityLoader";

export const States: Story = () => (
  <section className="min-h-[240px] bg-surface-panel p-6 text-content-primary">
    <h3 className="text-sm font-medium">活动状态</h3>
    <div className="mt-5 flex flex-wrap gap-8 text-sm text-content-secondary">
      <span className="flex items-center gap-2">
        <ActivityLoader aria-label="正在等待" />
        正在等待
      </span>
      <span className="flex items-center gap-2">
        <ActivityLoader active={false} aria-label="已结束" />
        已结束
      </span>
    </div>
  </section>
);

export const Sizes: Story = () => (
  <section className="min-h-[240px] bg-surface-panel p-6 text-content-primary">
    <h3 className="text-sm font-medium">尺寸与颜色继承</h3>
    <div className="mt-5 flex flex-wrap items-center gap-8 text-accent-content">
      {[12, 16, 20].map((size) => (
        <span key={size} className="flex items-center gap-2 text-xs">
          <ActivityLoader size={size} aria-label="正在加载" />
          {size}px
        </span>
      ))}
    </div>
  </section>
);
