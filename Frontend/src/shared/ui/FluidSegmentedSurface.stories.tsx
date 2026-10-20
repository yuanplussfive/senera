import type { Story } from "@ladle/react";
import { useState } from "react";
import { FluidSegmentedLayers, useFluidSegmentedSurface } from "./FluidSegmentedSurface";

const options = [
  { value: "summary", label: "概览" },
  { value: "activity", label: "活动" },
  { value: "files", label: "文件" },
] as const;

export const States: Story = () => {
  const [value, setValue] = useState<(typeof options)[number]["value"]>("summary");
  const surface = useFluidSegmentedSurface(value);

  return (
    <div className="min-h-[360px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[640px] space-y-6">
        <div>
          <h1 className="text-[20px] font-semibold text-content-strong">流动分段表面</h1>
          <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
            选中层和悬浮层由同一几何状态驱动，供标签页与紧凑分段选择器复用。
          </p>
        </div>
        <div
          ref={surface.containerRef}
          className="relative inline-grid min-h-9 grid-flow-col auto-cols-fr items-center gap-0.5 rounded-lg bg-surface-subtle p-1 ring-1 ring-inset ring-line-subtle"
          onPointerLeave={surface.onItemPointerLeave}
        >
          <FluidSegmentedLayers surface={surface} />
          {options.map((option) => (
            <button
              key={option.value}
              ref={(node) => surface.registerItem(option.value, node)}
              type="button"
              aria-pressed={value === option.value}
              className="relative z-10 h-7 rounded-md px-3 text-[12px] text-content-secondary outline-none transition-colors hover:text-content-primary focus-visible:ring-2 focus-visible:ring-accent-focus"
              onPointerEnter={(event) => surface.onItemPointerEnter(option.value, event)}
              onClick={() => setValue(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
