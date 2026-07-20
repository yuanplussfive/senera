import type { Story } from "@ladle/react";

const fontScales = {
  compact: { value: "0.96", label: "Compact (96%)" },
  standard: { value: "1", label: "Standard (100%)" },
  comfortable: { value: "1.04", label: "Comfortable (104%)" },
  large: { value: "1.08", label: "Large (108%)" },
};

export const TypeScale: Story = () => (
  <div className="p-8 space-y-8">
    <div>
      <h2 className="text-ink-900 text-xl font-medium mb-2">字号比例</h2>
      <p className="text-ink-600 text-sm">Senera 的文字系统，提供 4 档缩放比例</p>
    </div>

    <div className="space-y-6">
      <div>
        <h3 className="text-ink-900 font-medium mb-4">字体族</h3>
        <div className="space-y-3">
          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">界面字体（无衬线）</div>
            <div
              className="text-ink-900 text-lg font-medium"
              style={{ fontFamily: '"Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif' }}
            >
              Segoe UI Variable — 清晰的界面文字帮助用户快速理解当前状态
            </div>
            <div className="text-ink-600 text-sm mt-2 font-mono">
              font-family: "Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">展示字体（衬线）</div>
            <div
              className="text-ink-900 text-lg font-medium"
              style={{ fontFamily: "Fraunces, ui-serif, Georgia, serif" }}
            >
              Fraunces — 清晰的界面文字帮助用户快速理解当前状态
            </div>
            <div className="text-ink-600 text-sm mt-2 font-mono">font-family: "Fraunces", ui-serif, Georgia, serif</div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">等宽字体</div>
            <div className="text-ink-900 text-lg font-medium font-mono">
              JetBrains Mono — 清晰的界面文字帮助用户快速理解当前状态
            </div>
            <div className="text-ink-600 text-sm mt-2 font-mono">
              font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">字号缩放</h3>
        <div className="space-y-4">
          {Object.entries(fontScales).map(([key, { value, label }]) => (
            <div key={key} className="rounded-lg border border-ink-200 p-4">
              <div className="text-ink-500 text-xs mb-3">{label}</div>
              <div style={{ fontSize: `calc(16px * ${value})` }}>
                <div className="text-ink-900 text-base font-medium mb-2">基础文字，当前比例：{label}</div>
                <div className="text-ink-700 text-sm mb-2">次要文字随基础字号按比例缩放</div>
                <div className="text-ink-600 text-xs">小号文字仍保持可读性</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">文字层级</h3>
        <div className="rounded-lg border border-ink-200 p-6 space-y-3">
          <div className="text-ink-900 text-2xl font-medium">一级标题（24px）</div>
          <div className="text-ink-900 text-xl font-medium">二级标题（20px）</div>
          <div className="text-ink-900 text-lg font-medium">三级标题（18px）</div>
          <div className="text-ink-900 text-base font-medium">四级标题（16px）</div>
          <div className="text-ink-700 text-base">正文（16px）</div>
          <div className="text-ink-600 text-sm">次要文字（14px）</div>
          <div className="text-ink-500 text-xs">说明文字（12px）</div>
        </div>
      </div>

      <div>
        <h3 className="text-ink-900 font-medium mb-4">行高</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">紧凑（1.2）— 界面元素</div>
            <div className="text-ink-900 text-sm" style={{ lineHeight: 1.2 }}>
              紧凑行高适合按钮、标签和垂直空间有限的紧凑界面元素。
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">正常（1.5）— 默认</div>
            <div className="text-ink-900 text-sm" style={{ lineHeight: 1.5 }}>
              正常行高适合大多数界面文字和短段落。
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">舒展（1.75）— 长文本</div>
            <div className="text-ink-900 text-sm" style={{ lineHeight: 1.75 }}>
              舒展行高可以提升长段落和内容密集区域的阅读体验。
            </div>
          </div>

          <div className="rounded-lg border border-ink-200 p-4">
            <div className="text-ink-500 text-xs mb-2">宽松（2.0）— 代码</div>
            <div className="text-ink-900 text-sm font-mono" style={{ lineHeight: 2.0 }}>
              const example = true;
              <br />
              // 代码使用宽松行高
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const ChatTypography: Story = () => (
  <div className="p-8 space-y-8">
    <div>
      <h2 className="text-ink-900 text-xl font-medium mb-2">对话文字</h2>
      <p className="text-ink-600 text-sm">对话消息使用的专用文字设置</p>
    </div>

    <div className="space-y-6">
      <div className="rounded-lg border border-ink-200 p-6 space-y-4">
        <div>
          <div className="text-ink-500 text-xs mb-2">用户消息</div>
          <div
            className="text-ink-900 rounded-2xl bg-paper-200 px-4 py-3 inline-block"
            style={{
              fontSize: "var(--theme-chat-user-font-size)",
              lineHeight: "var(--theme-chat-user-line-height)",
            }}
          >
            这是一条经过可读性优化的用户消息。
            <br />
            字号：14.5px，行高：1.55
          </div>
        </div>

        <div>
          <div className="text-ink-500 text-xs mb-2">助手消息</div>
          <div
            className="text-ink-900"
            style={{
              fontSize: "var(--theme-chat-assistant-font-size)",
              lineHeight: "var(--theme-chat-assistant-line-height)",
            }}
          >
            助手消息使用稍大的文字，方便快速浏览。
            <br />
            字号：15px，行高：1.75
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-ink-200 bg-paper-100 p-6">
        <h4 className="text-ink-900 font-medium mb-3">文字使用规则</h4>
        <ul className="text-ink-700 text-sm space-y-2">
          <li>• 用户消息使用紧凑行高（1.55），保持信息密度</li>
          <li>• 助手消息使用舒展行高（1.75），提升阅读性</li>
          <li>
            • 全局字号缩放通过 <span className="font-mono text-xs">--theme-font-scale</span>
          </li>
          <li>
            • 所有文字都遵守 <span className="font-mono text-xs">prefers-reduced-motion</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
);
