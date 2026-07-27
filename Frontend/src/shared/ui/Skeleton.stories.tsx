import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

const StoryFrame = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="min-h-[320px] bg-paper-50 p-8 text-ink-900">
    <div className="mx-auto max-w-xl">{children}</div>
  </div>
);

export const Shapes: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">基础形状</h3>
    <div className="mt-5 grid gap-5 border-y border-ink-200 py-6">
      <div>
        <div className="text-[13px] text-ink-500">文本行：高度与行高对齐，宽度错落模拟真实段落</div>
        <div className="mt-3 space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[88%]" />
          <Skeleton className="h-3 w-[62%]" />
        </div>
      </div>
      <div>
        <div className="text-[13px] text-ink-500">头像：圆形占位</div>
        <Skeleton className="mt-3 h-8 w-8 rounded-full" />
      </div>
      <div>
        <div className="text-[13px] text-ink-500">块级区域：圆角与真实卡片一致</div>
        <Skeleton className="mt-3 h-11 w-2/3 rounded-2xl" />
      </div>
    </div>
    <p className="mt-4 text-[13px] leading-6 text-ink-500">
      尺寸与圆角完全由调用处的 className 决定，应与真实内容一致，避免加载完成后的布局跳变。 流光效果统一走 index.css 的
      .shimmer 类（--theme-skeleton-* 令牌），随主题变化并遵循全局减动效规则。
    </p>
  </StoryFrame>
);

export const MessageList: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">消息列表占位</h3>
    <p className="mt-4 text-[13px] leading-6 text-ink-500">恢复会话历史时的占位布局，与真实消息行结构一致。</p>
    <div className="mt-5 space-y-6 border-y border-ink-200 py-6">
      <div className="flex justify-end gap-3">
        <Skeleton className="h-11 w-3/5 rounded-2xl rounded-tr-[5px]" />
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-[88%]" />
          <Skeleton className="mt-2 h-3 w-[62%]" />
        </div>
      </div>
    </div>
  </StoryFrame>
);
