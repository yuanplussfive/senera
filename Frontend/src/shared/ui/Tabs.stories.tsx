import type { Story } from "@ladle/react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

export const Controlled: Story = () => {
  const [section, setSection] = useState("execution");

  return (
    <main className="min-h-[440px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[620px]">
        <h1 className="text-[18px] font-semibold text-content-strong">工作区分段控件</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">用于在同一工作区内切换关联内容。</p>

        <Tabs value={section} onValueChange={setSection} className="mt-6">
          <TabsList aria-label="工作区视图" className="w-full max-w-[360px]">
            <TabsTrigger value="execution">执行</TabsTrigger>
            <TabsTrigger value="terminal">终端</TabsTrigger>
            <TabsTrigger value="history">历史记录</TabsTrigger>
          </TabsList>
          <TabsContent value="execution" className="mt-4 border-t border-line-subtle pt-4 text-[13px]">
            当前显示执行时间线。
          </TabsContent>
          <TabsContent value="terminal" className="mt-4 border-t border-line-subtle pt-4 text-[13px]">
            当前显示终端输出。
          </TabsContent>
          <TabsContent value="history" className="mt-4 border-t border-line-subtle pt-4 text-[13px]">
            当前显示历史记录。
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
};

export const UncontrolledStates: Story = () => (
  <main className="min-h-[440px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto max-w-[620px] space-y-8">
      <div>
        <h1 className="text-[18px] font-semibold text-content-strong">标签状态</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">覆盖默认选择、禁用项和窄宽度长标签。</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList aria-label="设置区域" className="w-full max-w-[420px]">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="restricted" disabled>
            暂不可用
          </TabsTrigger>
          <TabsTrigger value="details">详细设置</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-3 text-[13px] text-content-secondary">
          默认选择的内容区域。
        </TabsContent>
        <TabsContent value="details" className="mt-3 text-[13px] text-content-secondary">
          可通过方向键跳过禁用项。
        </TabsContent>
      </Tabs>

      <Tabs defaultValue="current" className="max-w-[260px]">
        <TabsList aria-label="窄宽度示例" className="w-full">
          <TabsTrigger value="current">当前会话</TabsTrigger>
          <TabsTrigger value="long">名称很长的历史会话视图</TabsTrigger>
        </TabsList>
        <TabsContent value="current" className="mt-3 text-[13px] text-content-secondary">
          长标签不会改变控件尺寸。
        </TabsContent>
        <TabsContent value="long" className="mt-3 text-[13px] text-content-secondary">
          长标签对应的内容区域。
        </TabsContent>
      </Tabs>
    </div>
  </main>
);
