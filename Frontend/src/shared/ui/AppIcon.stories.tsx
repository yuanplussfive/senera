import type { Story } from "@ladle/react";
import { AppIcon, type AppIconName } from "./AppIcon";

const activityIcons: readonly { icon: AppIconName; label: string }[] = [
  { icon: "brain", label: "推理" },
  { icon: "search", label: "搜索" },
  { icon: "file-text", label: "读取" },
  { icon: "terminal", label: "命令" },
  { icon: "delegation", label: "委派" },
  { icon: "globe", label: "网页" },
];

export const AgentActivity: Story = () => (
  <main className="min-h-[360px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[680px]">
      <h1 className="text-[18px] font-semibold">执行活动图标</h1>
      <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
        执行界面使用固定的语义图标集；颜色继承当前主题和上下文，不为每种工具指定独立色彩。
      </p>

      <div className="mt-7 grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line-subtle py-5 sm:grid-cols-3">
        {activityIcons.map(({ icon, label }) => (
          <div key={icon} className="flex items-center gap-2.5 text-[13px] text-content-secondary">
            <AppIcon icon={icon} size={17} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  </main>
);

export const Status: Story = () => (
  <main className="min-h-[360px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[680px]">
      <h1 className="text-[18px] font-semibold">状态图标</h1>
      <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-4 border-y border-line-subtle py-5 text-[13px]">
        <span className="inline-flex items-center gap-2 text-content-muted">
          <AppIcon icon="loading" size={17} className="motion-safe:animate-spin" /> 正在执行
        </span>
        <span className="inline-flex items-center gap-2 text-content-muted">
          <AppIcon icon="check" size={17} /> 已完成
        </span>
        <span className="inline-flex items-center gap-2 text-brick-600">
          <AppIcon icon="cancel" size={17} /> 需要处理
        </span>
      </div>
    </div>
  </main>
);
