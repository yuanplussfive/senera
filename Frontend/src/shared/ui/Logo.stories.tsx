import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import { LogoLockup, LogoMark, LogoWordmark } from "./Logo";

const StoryFrame = ({ children }: { children: ReactNode }): JSX.Element => (
  <div className="min-h-[320px] bg-paper-50 p-8 text-ink-900">
    <div className="mx-auto max-w-xl">{children}</div>
  </div>
);

export const Mark: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">图形标记</h3>
    <div className="mt-5 flex items-end gap-8 border-y border-ink-200 py-5">
      {[16, 20, 24, 32].map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <LogoMark size={size} />
          <span className="text-[11px] tabular-nums text-ink-450">{size}px</span>
        </div>
      ))}
    </div>
  </StoryFrame>
);

export const Wordmark: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">文字标记</h3>
    <div className="mt-5 border-y border-ink-200 py-6">
      <LogoWordmark />
    </div>
    <p className="mt-4 text-[13px] leading-6 text-ink-500">文字使用当前主题的中性色，不额外引入固定品牌色。</p>
  </StoryFrame>
);

export const Lockup: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">图文组合</h3>
    <div className="mt-5 border-y border-ink-200 py-6">
      <LogoLockup />
    </div>
  </StoryFrame>
);

export const BrandColors: Story = () => (
  <StoryFrame>
    <h3 className="text-[15px] font-semibold">主题适配</h3>
    <p className="mt-4 max-w-lg text-[13px] leading-6 text-ink-500">
      图形标记和文字标记使用语义化 ink token，不引入固定装饰色，因此在用户选择的主题中都保持清晰。
    </p>
  </StoryFrame>
);
