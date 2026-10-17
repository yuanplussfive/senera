import type { Story } from "@ladle/react";
import { AppIcon, type AppIconName } from "./AppIcon";
import { Spinner } from "./Spinner";

/**
 * Render sizes production actually uses, derived from the catalog audit.
 *
 * The trailing count is how many `<AppIcon>` elements pass that size. Do not
 * edit these by hand — re-derive them and paste the printed table:
 *
 *   npx tsx --tsconfig Frontend/tsconfig.json Scripts/AuditAppIconStrokePhase.mjs --usage
 *
 * The counts matter because they are the argument for showing small sizes at
 * all: 14px alone carries more elements than every size above it combined.
 */
const productionSizes: readonly { size: number; count: number }[] = [
  { size: 10, count: 2 },
  { size: 11, count: 2 },
  { size: 12, count: 33 },
  { size: 13, count: 8 },
  { size: 14, count: 142 },
  { size: 15, count: 28 },
  { size: 16, count: 71 },
  { size: 17, count: 3 },
  { size: 18, count: 2 },
  { size: 20, count: 4 },
  { size: 24, count: 2 },
  { size: 28, count: 2 },
];

/**
 * One icon per stroke shape that has an axis-aligned straight run, because
 * straight runs are what expose pixel phase: a bar, a box, an X, a corner, and
 * a diagonal-plus-integer mix. `circle` is all curve and is kept as the control
 * that does not show the effect.
 */
const phaseSamples: readonly { icon: AppIconName; label: string }[] = [
  { icon: "minus", label: "横线" },
  { icon: "square", label: "方框" },
  { icon: "circle", label: "圆形" },
  { icon: "check", label: "对勾" },
  { icon: "arrow-left", label: "箭头" },
  { icon: "terminal", label: "终端" },
  { icon: "file-text", label: "文档" },
  { icon: "menu", label: "菜单" },
  { icon: "grip", label: "拖拽" },
  { icon: "search", label: "搜索" },
  { icon: "sliders", label: "筛选" },
];

const activityIcons: readonly { icon: AppIconName; label: string }[] = [
  { icon: "brain", label: "推理" },
  { icon: "search", label: "搜索" },
  { icon: "file-text", label: "读取" },
  { icon: "terminal", label: "命令" },
  { icon: "delegation", label: "委派" },
  { icon: "globe", label: "网页" },
  { icon: "sparkles", label: "连续性" },
  { icon: "flag", label: "目标" },
  { icon: "map-pin", label: "位置" },
  { icon: "play-circle", label: "执行" },
  { icon: "sliders", label: "筛选" },
];

const controlIcons: readonly { icon: AppIconName; label: string }[] = [
  { icon: "arrow-left", label: "上级目录" },
  { icon: "menu", label: "菜单" },
  { icon: "panel-left-open", label: "展开面板" },
  { icon: "panel-left-close", label: "收起面板" },
  { icon: "new-session", label: "新建会话" },
  { icon: "account-menu", label: "账户菜单" },
  { icon: "list-checks", label: "批量选择" },
  { icon: "language", label: "语言" },
  { icon: "grip", label: "拖拽排序" },
  { icon: "file-json", label: "JSON 导出" },
  { icon: "file-code", label: "HTML 导出" },
  { icon: "maximize", label: "打开查看器" },
];

/** The two sizes that carry almost all icon usage. */
const dominantSizes = [14, 16] as const;

export const ProductionSizes: Story = () => (
  <main className="min-h-[360px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[860px]">
      <h1 className="text-[18px] font-semibold">生产渲染尺寸</h1>
      <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
        同一组图标在每个真实渲染尺寸下并排对照。默认是 <code>size=16</code>、<code>strokeWidth=1.75</code>； 目录里全部
        112 个图标默认都走这套组合。
      </p>
      <p className="mt-3 text-[12.5px] leading-5 text-content-muted">
        看笔画灰度而不是看形状：图标在 24 单位画布上绘制，缩放到非 24
        尺寸时，落在整数像素上的笔画会被拆到两行、各画一半透明度，
        看起来比落在像素边界上的邻居更细更灰。同一行里的横线与方框若深浅不一致，就是相位差，不是描边宽度差。
      </p>

      <div className="mt-7 divide-y divide-line-subtle border-y border-line-subtle">
        {productionSizes.map(({ size, count }) => (
          <div key={size} className="flex items-center gap-4 py-2.5">
            <div className="w-[104px] shrink-0 text-[12px] text-content-muted">
              {size}px
              <span className="ml-1.5 text-content-muted/70">{count} 处</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-content-secondary">
              {phaseSamples.map(({ icon, label }) => (
                <span key={icon} className="inline-flex items-center gap-1.5" title={label}>
                  <AppIcon icon={icon} size={size} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[12.5px] leading-5 text-content-muted">
        相位差只在笔画不到 2 个设备像素时出现：<code>strokeWidth=1.75</code> 在 24 单位画布上， 13–16px 这一档在 1
        倍屏下只画到 0.95–1.17 个设备像素，正好落在最敏感区间。 同一个尺寸在 2 倍屏下等效设备像素翻倍，笔画超过 2
        像素，相位差随之消失—— 所以复查时要在目标缩放比例下看，高分屏上看不出来不代表 1 倍屏上没问题。
        推导过程和逐尺寸数据见 <code>Scripts/AuditAppIconStrokePhase.mjs</code>。
      </p>
    </div>
  </main>
);

export const AgentActivity: Story = () => (
  <main className="min-h-[360px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[680px]">
      <h1 className="text-[18px] font-semibold">执行活动图标</h1>
      <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
        执行界面使用固定的语义图标集；颜色继承当前主题和上下文，不为每种工具指定独立色彩。 这里按生产实际使用的 14px 与
        16px 两档并排显示。
      </p>

      <div className="mt-7 border-y border-line-subtle py-5">
        {dominantSizes.map((size) => (
          <div key={size} className="grid grid-cols-2 gap-x-8 gap-y-4 py-2 sm:grid-cols-3">
            {activityIcons.map(({ icon, label }) => (
              <div key={icon} className="flex items-center gap-2.5 text-[13px] text-content-secondary">
                <AppIcon icon={icon} size={size} />
                <span>{label}</span>
                <span className="text-[11px] text-content-muted">{size}px</span>
              </div>
            ))}
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
          <Spinner size="sm" /> 正在执行
        </span>
        <span className="inline-flex items-center gap-2 text-content-muted">
          <AppIcon icon="check" size={14} /> 已完成
        </span>
        <span className="inline-flex items-center gap-2 text-content-muted">
          <AppIcon icon="check" size={16} /> 已完成
        </span>
        <span className="inline-flex items-center gap-2 text-brick-600">
          <AppIcon icon="cancel" size={14} /> 需要处理
        </span>
      </div>
    </div>
  </main>
);

export const ProductControls: Story = () => (
  <main className="min-h-[240px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[680px]">
      <h1 className="text-[18px] font-semibold">产品控制图标</h1>
      <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
        壳层、会话和窗口控制使用同一套语义目录。窗口栏的最小化、最大化/还原、关闭使用专用{" "}
        <code>WindowControlGlyph</code>，因为它们需要在 16px 下三个控件笔画完全一致，见该组件的 Story。
      </p>
      <div className="mt-7 grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line-subtle py-5 sm:grid-cols-3">
        {controlIcons.map(({ icon, label }) => (
          <div key={icon} className="flex items-center gap-2.5 text-[13px] text-content-secondary">
            <AppIcon icon={icon} size={14} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  </main>
);
