import { useState } from "react";
import { SearchSelect } from "./SearchSelect";
import { MenuSelect } from "./MenuSelect";

export const Models = () => {
  const [model, setModel] = useState("model-1");
  const [custom, setCustom] = useState("gpt-image-2");
  const [level, setLevel] = useState("medium");
  const options = Array.from({ length: 30 }, (_, index) => ({
    value: `model-${index}`,
    label: `模型 ${index + 1}`,
    description: index % 2 ? "本地供应商" : "云端供应商",
  }));
  return (
    <main className="min-h-screen bg-surface-canvas p-6 text-content-primary">
      <div className="max-w-lg space-y-5">
        <h1>搜索并选择模型</h1>
        <SearchSelect
          value={model}
          options={options}
          placeholder="选择已配置的模型"
          onChange={setModel}
          footer={() => (
            <div className="flex items-center justify-between gap-3 border-t border-line-subtle p-2">
              <span className="text-xs">推理等级</span>
              <MenuSelect
                value={level}
                options={[
                  { value: "medium", label: "均衡" },
                  { value: "high", label: "深入" },
                ]}
                placeholder="推理等级"
                triggerClassName="w-auto"
                onChange={setLevel}
              />
            </div>
          )}
        />
        <p>模型名称可自行编辑，也可搜索已有候选。</p>
        <SearchSelect allowCustom value={custom} options={options} placeholder="输入模型名称" onChange={setCustom} />
        <SearchSelect disabled value={model} options={options} placeholder="暂不可用" onChange={setModel} />
      </div>
    </main>
  );
};
