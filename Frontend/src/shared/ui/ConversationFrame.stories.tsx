import type { Story } from "@ladle/react";
import { ConversationFrame } from "./ConversationFrame";

const modes = [
  {
    mode: "prose",
    label: "正文模式",
    title: "助手正文",
    copy: "适合连续阅读的回答正文，宽度会限制在舒适的阅读范围内。",
  },
  { mode: "user", label: "用户模式", title: "用户消息", copy: "用户内容使用更紧凑的最大宽度，并靠对话区域右侧排列。" },
  { mode: "wide", label: "宽内容模式", title: "宽内容", copy: "表格、代码预览和执行详情可以使用更宽的内容范围。" },
  { mode: "composer", label: "输入模式", title: "输入区域", copy: "输入框与对话内容共享稳定的水平对齐基线。" },
] as const;

export const WidthModes: Story = () => (
  <main className="min-h-[620px] bg-surface-canvas py-8 text-content-primary">
    <div className="mb-8 px-6 sm:px-10">
      <h1 className="text-[18px] font-semibold text-content-strong">对话内容宽度</h1>
      <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
        四种模式只管理对话内容的宽度和对齐，不绘制额外卡片。
      </p>
    </div>

    <div className="grid gap-7">
      {modes.map(({ mode, label, title, copy }) => (
        <section key={mode} className="border-t border-line-subtle pt-4">
          <ConversationFrame mode={mode}>
            <div className="px-4 sm:px-6">
              <div className="text-[11px] font-medium text-content-muted">{label}</div>
              <h2 className="mt-1 text-[14px] font-semibold text-content-strong">{title}</h2>
              <p className="mt-1 text-[13px] leading-6 text-content-secondary">{copy}</p>
            </div>
          </ConversationFrame>
        </section>
      ))}
    </div>
  </main>
);
