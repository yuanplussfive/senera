import type { Story } from "@ladle/react";
import { Bot, Database } from "lucide-react";
import { useState } from "react";
import { MenuSelect } from "./MenuSelect";

const modelOptions = [
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { value: "local-model", label: "本地模型（连接不可用）", disabled: true },
] as const;

export const ValueSelection: Story = () => {
  const [model, setModel] = useState("gpt-5.4");

  return (
    <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
      <div className="mx-auto max-w-[560px]">
        <h1 className="text-[18px] font-semibold text-content-strong">值选择菜单</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">
          用于从已有选项中选择一个值；删除、复制等操作应使用动作菜单。
        </p>

        <div className="mt-6 grid gap-2">
          <label className="text-[13px] font-medium text-content-primary">对话模型</label>
          <MenuSelect
            value={model}
            placeholder="选择模型"
            options={modelOptions}
            leading={<Bot className="h-4 w-4" />}
            ariaLabel="对话模型"
            onChange={setModel}
          />
          <p className="text-[12px] text-content-muted">禁用选项会保留上下文，但不能被选择。</p>
        </div>
      </div>
    </main>
  );
};

export const States: Story = () => (
  <main className="min-h-[420px] bg-surface-canvas p-6 text-content-primary sm:p-10">
    <div className="mx-auto grid max-w-[560px] gap-6">
      <div>
        <h1 className="text-[18px] font-semibold text-content-strong">菜单状态</h1>
        <p className="mt-1 text-[12.5px] leading-5 text-content-muted">只展示组件真实支持的占位、禁用和空状态。</p>
      </div>

      <div className="grid gap-2">
        <span className="text-[13px] font-medium text-content-primary">未选择</span>
        <MenuSelect
          value=""
          placeholder="选择数据源"
          options={modelOptions}
          leading={<Database className="h-4 w-4" />}
          ariaLabel="数据源"
          onChange={() => undefined}
        />
      </div>

      <div className="grid gap-2">
        <span className="text-[13px] font-medium text-content-primary">禁用</span>
        <MenuSelect
          value="gpt-5.4"
          placeholder="选择模型"
          options={modelOptions}
          disabled
          ariaLabel="禁用的模型选择"
          onChange={() => undefined}
        />
      </div>

      <div className="grid gap-2">
        <span className="text-[13px] font-medium text-content-primary">没有可选项</span>
        <MenuSelect
          value=""
          placeholder="选择模型"
          options={[]}
          emptyState="当前没有可用模型"
          ariaLabel="空模型选择"
          onChange={() => undefined}
        />
      </div>
    </div>
  </main>
);
