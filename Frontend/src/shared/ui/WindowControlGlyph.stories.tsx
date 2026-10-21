import type { Story } from "@ladle/react";
import { WindowControlGlyph, type WindowControlGlyphName } from "./WindowControlGlyph";

const rows: { glyph: WindowControlGlyphName; label: string; note: string }[] = [
  { glyph: "minimize", label: "最小化", note: "单像素横线，1.0px" },
  { glyph: "maximize", label: "最大化", note: "近方角方框" },
  { glyph: "restore", label: "向下还原", note: "双框叠加" },
  { glyph: "close", label: "关闭", note: "对角叉线" },
];

export const Family: Story = () => (
  <main className="min-h-[280px] bg-surface-canvas p-8 text-content-primary">
    <div className="mx-auto max-w-xl">
      <h1 className="text-[18px] font-semibold">桌面窗口栏图标</h1>
      <p className="mt-2 text-[13px] leading-5 text-content-muted">
        四个字形共用一个笔画粗细：笔画中心落在 0.75 单位网格上，16px
        渲染时恰好覆盖一个像素行，因此横线、方框、叉线的视觉重量一致。
      </p>
      <div className="mt-6 divide-y divide-line-subtle border-y border-line-subtle">
        {rows.map((row) => (
          <div key={row.glyph} className="flex items-center gap-4 py-3">
            <div className="grid h-[52px] w-[46px] place-items-center text-content-muted">
              <WindowControlGlyph glyph={row.glyph} className="h-4 w-4" />
            </div>
            <span className="text-[13px] text-content-primary">{row.label}</span>
            <span className="text-[13px] text-content-muted">{row.note}</span>
          </div>
        ))}
      </div>
    </div>
  </main>
);

export const WindowBarStates: Story = () => (
  <main className="min-h-[200px] bg-surface-sidebar text-content-primary">
    <div className="flex items-center justify-between border-b border-line-subtle">
      <span className="px-4 text-[13px] font-medium">Senera</span>
      <div className="flex items-stretch text-content-muted" role="group" aria-label="Senera 窗口控件">
        <span className="grid h-[52px] w-[46px] place-items-center">
          <WindowControlGlyph glyph="minimize" className="h-4 w-4" />
        </span>
        <span className="grid h-[52px] w-[46px] place-items-center">
          <WindowControlGlyph glyph="maximize" className="h-4 w-4" />
        </span>
        <span className="grid h-[52px] w-[46px] place-items-center">
          <WindowControlGlyph glyph="close" className="h-4 w-4" />
        </span>
      </div>
    </div>
    <p className="px-4 py-3 text-[13px] text-content-muted">窗口为普通状态时显示最大化。</p>
  </main>
);
