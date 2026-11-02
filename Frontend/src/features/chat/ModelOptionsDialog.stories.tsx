import { useState } from "react";
import { Button } from "../../shared/ui";
import { ModelOptionsDialog } from "./ModelOptionsDialog";
import type { ModelProviderDraft } from "./modelConfigTypes";

export const Configuration = () => {
  const [open, setOpen] = useState(true);
  const [model, setModel] = useState<ModelProviderDraft>({
    Id: "openai:gpt-4.1",
    ProviderId: "openai",
    Model: "gpt-4.1",
    Endpoint: "Responses",
    ToolPlanningMode: "native",
    ContextWindowTokens: 200_000,
    Capabilities: { Chat: true, Vision: true, ToolCalling: true, Reasoning: true },
    Pricing: { output: 7 },
  });
  return (
    <div className="p-6">
      <p className="mb-3 text-sm text-content-muted">模型配置复用公共选择控件；价格留空跟随参考值，支持逐项覆盖。</p>
      <Button onClick={() => setOpen(true)}>编辑模型</Button>
      <ModelOptionsDialog
        model={open ? model : null}
        modelIndex={0}
        modelTemplate={{ Stream: true }}
        endpointOptions={[
          { value: "Responses", label: "Responses" },
          { value: "ChatCompletions", label: "Chat Completions" },
        ]}
        disabled={false}
        onOpenChange={setOpen}
        onChange={(patch) => setModel((model) => ({ ...model, ...patch }))}
        onCommit={() => setOpen(false)}
        onRemove={() => setOpen(false)}
        catalogMetadata={{
          id: "gpt-4.1",
          sourceModelId: "gpt-4.1",
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          contextLimit: 1_000_000,
          pricing: { input: 2, output: 8, cacheRead: 0.5 },
        }}
      />
    </div>
  );
};
