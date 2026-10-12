import type { Story } from "@ladle/react";
import { AppIcon } from "./AppIcon";
import { StatusGlyph } from "./StatusGlyph";

export const States: Story = () => (
  <main className="min-h-[220px] bg-surface-canvas p-8 text-content-primary">
    <div className="mx-auto max-w-xl">
      <h1 className="text-[18px] font-semibold">活动状态标记</h1>
      <p className="mt-2 text-[13px] leading-5 text-content-muted">
        工具图标保持身份，状态由颜色和对应的活动动效表达。
      </p>
      <div className="mt-6 flex items-center gap-8 border-y border-line-subtle py-6 text-content-secondary">
        <span className="flex items-center gap-2">
          <StatusGlyph status="pending" live>
            <AppIcon icon="search" size={14} />
          </StatusGlyph>
          活动环
        </span>
        <span className="flex items-center gap-2">
          <StatusGlyph status="running" live liveMotion="quiet">
            <AppIcon icon="search" size={14} />
          </StatusGlyph>
          Quiet
        </span>
        <span className="flex items-center gap-2">
          <StatusGlyph status="completed">
            <AppIcon icon="check" size={14} />
          </StatusGlyph>
          已完成
        </span>
      </div>
    </div>
  </main>
);
