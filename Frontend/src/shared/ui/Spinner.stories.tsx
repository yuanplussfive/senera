import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

const StoryFrame = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="min-h-[320px] bg-paper-50 p-8 text-ink-900">
    <div className="mx-auto max-w-xl">{children}</div>
  </div>
);

export const Sizes: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">尺寸</h3>
    <div className="mt-5 flex items-end gap-10 border-y border-ink-200 py-6">
      {(
        [
          ["xs", "12px"],
          ["sm", "14px（默认）"],
          ["md", "16px"],
        ] as const
      ).map(([size, label]) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <Spinner size={size} />
          <span className="text-[11px] tabular-nums text-ink-500">{label}</span>
        </div>
      ))}
    </div>
    <p className="mt-4 text-[13px] leading-6 text-ink-500">
      全站唯一的旋转加载图标，统一使用 Loader2。动画遵循全局减动效设置，使用处无需单独处理。
    </p>
  </StoryFrame>
);

export const ColorInheritance: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">颜色继承</h3>
    <p className="mt-4 text-[13px] leading-6 text-ink-500">
      Spinner 不带自己的颜色，跟随所在处的文字颜色（currentColor）。
    </p>
    <div className="mt-5 grid gap-4 border-y border-ink-200 py-6">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Spinner size="sm" />
        次要信息中的加载状态
      </div>
      <div className="flex items-center gap-2 text-sm text-accent-content">
        <Spinner size="sm" />
        强调色场景中的加载状态
      </div>
      <div className="flex items-center gap-2 text-sm text-brick-600">
        <Spinner size="sm" />
        错误恢复过程中的重试状态
      </div>
    </div>
  </StoryFrame>
);

export const InContext: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">常见位置</h3>
    <div className="mt-5 grid gap-5 border-y border-ink-200 py-6">
      <div>
        <div className="text-[13px] text-ink-500">提交中的按钮，图标位替换为 Spinner：</div>
        <Button disabled className="mt-2 gap-2">
          <Spinner size="sm" />
          正在保存
        </Button>
      </div>
      <div>
        <div className="text-[13px] text-ink-500">行内等待提示，与文字同色同行：</div>
        <span className="mt-2 flex items-center gap-2 text-sm text-ink-500">
          <Spinner size="xs" />
          正在拉取模型列表…
        </span>
      </div>
    </div>
  </StoryFrame>
);
