import type { Story } from "@ladle/react";
import { ActivityStatusIcon, type ActivityStatus } from "./ActivityStatusIcon";

const statuses: readonly { status: ActivityStatus; label: string }[] = [
  { status: "pending", label: "等待" },
  { status: "running", label: "进行中" },
  { status: "cancelling", label: "正在停止" },
  { status: "completed", label: "已完成" },
  { status: "failed", label: "失败" },
  { status: "cancelled", label: "已取消" },
  { status: "neutral", label: "未分类" },
];

export const States: Story = () => (
  <main className="min-h-[260px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[680px]">
      <h1 className="text-[18px] font-semibold">执行状态图标</h1>
      <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
        图标只表达执行状态，颜色和动效遵循当前主题；进行中的状态使用径向 Loader。
      </p>
      <div className="mt-7 grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line-subtle py-5 sm:grid-cols-3">
        {statuses.map(({ status, label }) => (
          <div key={status} className="flex items-center gap-2.5 text-[13px] text-content-secondary">
            <ActivityStatusIcon status={status} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  </main>
);
