import { useState } from "react";
import { ModelSelect, type ModelSelectOption } from "./ModelSelect";

const options: ModelSelectOption[] = [
  { value: "studio:reasoning", label: "GPT Reasoning", description: "我的供应商", icon: "deepseek" },
  { value: "cloud:sonnet", label: "Claude Sonnet", description: "云端供应商", icon: "anthropic" },
  ...Array.from({ length: 24 }, (_, index) => ({
    value: `local:${index}`,
    label: `本地模型 ${index + 1}`,
    description: "本地供应商",
    icon: "ollama",
  })),
];

export const ConfiguredModels = () => {
  const [value, setValue] = useState(options[0].value);
  const [custom, setCustom] = useState("gpt-image-2");
  return (
    <main className="min-h-screen bg-surface-canvas p-5 text-content-primary">
      <div className="mx-auto max-w-lg space-y-5">
        <h1>统一模型选择</h1>
        <p className="text-xs text-content-muted">
          配置图标随模型展示，可按模型、供应商或标识搜索；手填只用于允许自定义模型的字段。
        </p>
        <ModelSelect value={value} options={options} placeholder="搜索模型" onChange={setValue} />
        <ModelSelect allowCustom value={custom} options={options} placeholder="输入模型名称" onChange={setCustom} />
        <ModelSelect disabled value={value} options={options} placeholder="搜索模型" onChange={setValue} />
      </div>
    </main>
  );
};
