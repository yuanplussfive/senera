import { useId, useState } from "react";
import type { Story } from "@ladle/react";
import type { AgentActivationCatalogEntry } from "../../api/eventTypes";
import { ActivationPalette, rankActivationCandidates, stepActivationIndex } from "./ChatActivationPalette";
import { Input } from "../../shared/ui";

const entries: readonly AgentActivationCatalogEntry[] = [
  {
    kind: "skill",
    id: "browser-automation",
    revision: "1",
    title: "浏览器操作",
    description:
      "在真实浏览器中导航、填写表单、下载文件和核对页面。这里保留很长的说明，用于检查靠近列表右侧时是否正确显示省略号，并可悬停查看完整描述。",
    icon: "globe",
    enabled: true,
    selectable: true,
  },
  {
    kind: "skill",
    id: "senera-workbench",
    revision: "1",
    title: "Senera 工作台",
    description: "管理配置、预设、技能与当前会话模型；修改前先读取宿主状态。",
    icon: "tools",
    enabled: true,
    selectable: true,
  },
  {
    kind: "system",
    id: "agent-browser",
    revision: "1",
    title: "浏览器",
    description: "提供页面访问、元素交互、截图与下载工具。",
    icon: "globe",
    enabled: true,
    selectable: true,
  },
  {
    kind: "plugin",
    id: "workspace-tools",
    revision: "1",
    title: "工作区文件",
    description: "读取、编辑文件并查看本轮改动。",
    icon: "folder",
    enabled: true,
    selectable: true,
  },
  {
    kind: "mcp",
    id: "image-generation",
    revision: "1",
    title: "图片生成",
    description: "选择已配置的图像输出模型后即可生成和编辑图片。",
    icon: "image",
    enabled: true,
    selectable: false,
  },
];

export const Capabilities: Story = () => {
  const id = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<AgentActivationCatalogEntry[]>([]);
  const candidates = rankActivationCandidates(entries, query, "zh-CN");
  const select = (index: number): void => {
    const entry = candidates[index];
    if (entry?.selectable) setSelected((current) => [...current.filter((item) => item.id !== entry.id), entry]);
  };
  return (
    <div className="flex min-h-[720px] items-end bg-surface-canvas p-4 text-content-primary">
      <div className="relative w-full max-w-xl">
        <ActivationPalette
          id={id}
          catalog={{ revision: "1", entries }}
          candidates={candidates}
          query={query}
          activeIndex={activeIndex}
          selected={selected}
          locale="zh-CN"
          onSelect={select}
        />
        <Input
          aria-label="搜索本轮能力"
          placeholder="搜索技能或工具"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => stepActivationIndex(candidates, current, event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Enter") select(activeIndex);
          }}
        />
      </div>
    </div>
  );
};

export const Empty: Story = () => {
  const id = useId();
  return (
    <div className="flex h-[300px] items-end bg-surface-canvas p-4">
      <div className="relative w-full max-w-xl">
        <ActivationPalette
          id={id}
          catalog={{ revision: "1", entries: [] }}
          candidates={[]}
          query=""
          activeIndex={0}
          selected={[]}
          locale="zh-CN"
          onSelect={() => undefined}
        />
        <p className="text-xs text-content-muted">暂无可用能力时保留明确状态</p>
      </div>
    </div>
  );
};
