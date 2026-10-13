import { useState } from "react";
import type { Story } from "@ladle/react";
import {
  ThinkingStep,
  ThinkingStepDetails,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
  ThinkingStepSource,
  ThinkingStepSources,
} from "./ThinkingSteps";

export const Streaming: Story = () => {
  const [open, setOpen] = useState(true);

  return (
    <main className="min-h-[320px] max-w-[560px] bg-surface-canvas p-8 text-content-primary">
      <ThinkingSteps open={open} onOpenChange={setOpen}>
        <ThinkingStepsHeader className="rounded-sm px-2 py-1.5 hover:bg-surface-hover" aria-label="展开或收起思考过程">
          <span className="min-w-0 flex-1 text-[13px] font-medium">正在处理 · 2 个工具调用</span>
          <span className="text-[11px] tabular-nums text-content-muted">1.4s</span>
        </ThinkingStepsHeader>
        <ThinkingStepsContent className="mt-1">
          <ThinkingStep icon="brain" label="正在整理任务" status="active" />
          <ThinkingStep icon="search" label="搜寻相关资料" description="已找到 4 个候选工具" status="complete">
            <ThinkingStepDetails summary="查看候选工具">
              <div className="rounded-sm bg-surface-muted px-2 py-1">WebSearch · WebFetch</div>
            </ThinkingStepDetails>
          </ThinkingStep>
          <ThinkingStep icon="check" label="准备生成回复" status="complete" isLast>
            <ThinkingStepSources>
              <ThinkingStepSource>weather.com.cn</ThinkingStepSource>
              <ThinkingStepSource>nmc.cn</ThinkingStepSource>
            </ThinkingStepSources>
          </ThinkingStep>
        </ThinkingStepsContent>
      </ThinkingSteps>
    </main>
  );
};

export const Collapsed: Story = () => (
  <main className="min-h-[180px] max-w-[560px] bg-surface-panel p-8 text-content-primary">
    <ThinkingSteps defaultOpen={false}>
      <ThinkingStepsHeader className="rounded-sm px-2 py-1.5 hover:bg-surface-hover" aria-label="展开思考过程">
        <span className="min-w-0 flex-1 text-[13px] font-medium">已完成 · 3 个步骤</span>
        <span className="text-[11px] tabular-nums text-content-muted">2.8s</span>
      </ThinkingStepsHeader>
      <ThinkingStepsContent>
        <ThinkingStep icon="check" label="已完成" isLast />
      </ThinkingStepsContent>
    </ThinkingSteps>
  </main>
);
