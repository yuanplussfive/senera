import type { Story } from "@ladle/react";
import { ScrollArea } from "./ScrollArea";

export const VerticalScroll: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <ScrollArea className="h-[300px] w-[350px] rounded-lg border border-ink-200 bg-paper-50 p-4">
      <div className="space-y-4">
        <h3 className="font-medium text-ink-900">纵向滚动</h3>
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="rounded-md border border-ink-200 bg-paper-100 p-3">
            <div className="text-sm font-medium text-ink-900">列表项 {i + 1}</div>
            <div className="mt-1 text-xs text-ink-600">这是可滚动列表中的第 {i + 1} 项内容。</div>
          </div>
        ))}
      </div>
    </ScrollArea>
  </div>
);

export const HorizontalScroll: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <ScrollArea className="w-full max-w-[600px] whitespace-nowrap rounded-lg border border-ink-200 bg-paper-50 p-4">
      <div className="flex gap-4">
        {Array.from({ length: 15 }).map((_, i) => (
          <div
            key={i}
            className="inline-flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-lg border border-ink-200 bg-paper-100"
          >
            <div className="text-center">
              <div className="font-medium text-ink-900">{i + 1}</div>
              <div className="text-xs text-ink-500">项目</div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  </div>
);

export const LongContent: Story = () => (
  <div className="flex min-h-[500px] items-center justify-center p-8">
    <div className="w-[500px] max-w-full space-y-4">
      <h3 className="font-medium text-ink-900">长内容</h3>
      <ScrollArea className="h-[400px] rounded-lg border border-ink-200 bg-paper-50 p-4">
        <div className="space-y-4">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="rounded-md border border-ink-200 bg-paper-100 p-3">
              <div className="text-sm font-medium text-ink-900">内容区块 {index + 1}</div>
              <div className="mt-1 text-sm text-ink-600">视口滚动时，这段示例文字仍应保持清晰可读。</div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  </div>
);

export const WithTags: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <ScrollArea className="h-[200px] w-[300px] rounded-lg border border-ink-200 bg-paper-50 p-4">
      <div className="flex flex-wrap gap-2">
        {["模型", "对话", "规划", "工具", "记忆", "工作流", "设置", "主题", "权限", "连接", "执行", "日志"].map(
          (tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-md border border-ink-200 bg-paper-200 px-2.5 py-0.5 text-xs font-medium text-ink-800"
            >
              {tag}
            </span>
          ),
        )}
      </div>
    </ScrollArea>
  </div>
);
