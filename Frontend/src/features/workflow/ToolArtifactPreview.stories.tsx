import type { Story } from "@ladle/react";
import { ToolArtifactPreview } from "./ToolArtifactPreview";
import { WorkspaceResourceProvider } from "../../shared/workspace/WorkspaceResourceProvider";
import type { ToolWorkspaceChange } from "./toolResourceProjection";

const changes: readonly ToolWorkspaceChange[] = [
  ["src/features/chat/ChatPanel.tsx", 59, 0],
  ["src/shared/ui/ScrollArea.tsx", 1, 1],
  ["src/i18n/messages/zh-CN.json", 2, 2],
  ["src/i18n/messages/en-US.json", 2, 2],
].map(([key, addedLines, removedLines]) => ({
  kind: "workspace",
  key: String(key),
  summary: String(key),
  status: "changed",
  workspaceStatus: "modified",
  addedLines: Number(addedLines),
  removedLines: Number(removedLines),
}));

export const TurnChanges: Story = () => (
  <WorkspaceResourceProvider httpBaseUrl="http://localhost:4310">
    <div className="mx-auto max-w-3xl space-y-5 bg-surface-canvas p-4 text-content-primary">
      <p className="text-xs text-content-muted">
        紧凑展示本轮改动与多媒体产物。点击文件或“查看变更”进入审阅；撤销前需要确认。
      </p>
      <ToolArtifactPreview
        mode="summary"
        changes={changes}
        checkpoints={[{ artifactUri: "senera://artifact/a7k2m9", checkpointId: "workspace:preview" }]}
        resources={[
          { uri: "senera://resource/p8f3n2", name: "操作说明.md", mime: "text/markdown", origin: "artifact" },
          {
            uri: "senera://resource/b2c8n4",
            name: "界面预览.webp",
            mime: "image/webp",
            size: 218000,
            origin: "artifact",
          },
          {
            uri: "senera://resource/j7p5m2",
            name: "演示视频.mp4",
            mime: "video/mp4",
            size: 2100000,
            origin: "artifact",
          },
        ]}
      />
      <p className="text-xs text-content-muted">没有完整检查点时保留禁用的撤销入口，并解释原因。</p>
      <ToolArtifactPreview mode="summary" changes={changes.slice(0, 1)} />
    </div>
  </WorkspaceResourceProvider>
);
