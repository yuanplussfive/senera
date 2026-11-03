import type { Story } from "@ladle/react";
import { useState } from "react";
import type { ModelProviderListItem, ModelThinkingLevel } from "../../api/eventTypes";
import { useResponsiveMode } from "../../shared/responsive";
import { ChatModelSelector } from "./ChatModelSelector";

const models: ModelProviderListItem[] = [
  {
    id: "openai:reasoning",
    providerId: "openai",
    icon: "openai",
    model: "GPT Reasoning",
    kind: "openai",
    endpoint: "openai",
    baseUrl: "",
    capabilities: { Chat: true, Reasoning: true, ToolCalling: true },
    toolPlanningMode: "native",
    stream: true,
    isDefault: true,
    thinkingLevels: ["off", "low", "medium", "high"],
    defaultThinkingLevel: "medium",
    thinkingProfiles: [{ id: "deep", level: "high", label: "深度思考" }],
  },
  {
    id: "anthropic:sonnet",
    providerId: "anthropic",
    icon: "anthropic",
    model: "Claude Sonnet",
    kind: "anthropic",
    endpoint: "anthropic",
    baseUrl: "",
    capabilities: { Chat: true, ToolCalling: true },
    toolPlanningMode: "native",
    stream: true,
    isDefault: false,
  },
  ...Array.from({ length: 18 }, (_, index) => ({
    id: `local:model-${index}`,
    providerId: "local",
    model: `本地模型 ${index + 1}`,
    kind: "openai",
    endpoint: "openai",
    baseUrl: "",
    capabilities: { Chat: true, ToolCalling: true },
    toolPlanningMode: "native" as const,
    stream: true,
    isDefault: false,
  })),
];

function ModelSelectorExample({
  availableModels = models,
  initialModelId = availableModels[0].id,
  description = "底部只显示模型名，展开后显示配置图标。输入搜索、方向键选择；推理菜单保持在模型面板上方。",
}: {
  availableModels?: ModelProviderListItem[];
  initialModelId?: string;
  description?: string;
}) {
  const [selectedId, setSelectedId] = useState(initialModelId);
  const [level, setLevel] = useState<ModelThinkingLevel>("medium");
  const { prefersCompactControls } = useResponsiveMode();
  return (
    <div className="flex min-h-[720px] flex-col items-center justify-end gap-4 bg-surface-canvas p-5 text-content-primary">
      <p className="text-xs text-content-muted">{description}</p>
      <ChatModelSelector
        models={availableModels}
        selectedId={selectedId}
        defaultModelId={availableModels[0].id}
        selectedThinkingLevel={level}
        onSelect={setSelectedId}
        onSelectThinkingLevel={setLevel}
        disabled={false}
        prefersCompactControls={prefersCompactControls}
      />
    </div>
  );
}

export const SearchAndReasoning: Story = () => <ModelSelectorExample />;

export const IncompatibleSelection: Story = () => (
  <ModelSelectorExample
    availableModels={[
      ...models,
      {
        ...models[0],
        id: "local:changed-capabilities",
        model: "能力已变更的模型",
        capabilities: { Chat: true, ToolCalling: false },
        isDefault: false,
      },
    ]}
    initialModelId="local:changed-capabilities"
    description="保留已选模型并展示不兼容原因。展开菜单后可以选择兼容模型，不会自动替换当前选择。"
  />
);
