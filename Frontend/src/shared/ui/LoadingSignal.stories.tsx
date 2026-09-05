import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import { LoadingSignal } from "./LoadingSignal";

const StoryFrame = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="min-h-[260px] bg-paper-50 p-8 text-ink-900">
    <div className="mx-auto max-w-xl">{children}</div>
  </div>
);

export const Sizes: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">共振轨迹尺寸</h3>
    <div className="mt-5 flex flex-wrap items-end gap-8 border-y border-ink-200 py-6">
      {(["sm", "md", "lg"] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <LoadingSignal size={size} />
          <span className="text-[11px] text-ink-500">{size}</span>
        </div>
      ))}
    </div>
    <p className="mt-4 text-[13px] leading-6 text-ink-500">
      双色共振轨迹用于表达进行中的工作，不占据独立的全屏区域，也不重复展示品牌 Logo。
    </p>
  </StoryFrame>
);

export const WithLabel: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">带文字状态</h3>
    <div className="mt-5 border-y border-ink-200 py-6 text-content-secondary">
      <LoadingSignal size="md" label="正在准备工作区" />
    </div>
    <p className="mt-4 text-[13px] leading-6 text-ink-500">
      提供 label 时会暴露 status 语义，适合连接或初始化等可感知等待。
    </p>
  </StoryFrame>
);
