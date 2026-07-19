import type { Story } from "@ladle/react";
import { Heart, Settings, Trash2 } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Tooltip, TooltipProvider } from "./Tooltip";

export const BasicTooltip: Story = () => (
  <TooltipProvider>
    <div className="flex min-h-[300px] items-center justify-center p-8">
      <Tooltip content="这里是简短说明">
        <Button>悬停查看说明</Button>
      </Tooltip>
    </div>
  </TooltipProvider>
);

export const WithShortcut: Story = () => (
  <TooltipProvider>
    <div className="flex min-h-[300px] items-center justify-center p-8">
      <div className="flex gap-4">
        <Tooltip content="保存当前文档" shortcut="⌘S">
          <Button>保存</Button>
        </Tooltip>
        <Tooltip content="打开设置" shortcut="⌘,">
          <Button variant="ghost">设置</Button>
        </Tooltip>
      </div>
    </div>
  </TooltipProvider>
);

export const Sides: Story = () => (
  <TooltipProvider>
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <div className="grid grid-cols-2 gap-12">
        <Tooltip content="显示在上方" side="top">
          <Button>上方</Button>
        </Tooltip>
        <Tooltip content="显示在右侧" side="right">
          <Button>右侧</Button>
        </Tooltip>
        <Tooltip content="显示在下方" side="bottom">
          <Button>下方</Button>
        </Tooltip>
        <Tooltip content="显示在左侧" side="left">
          <Button>左侧</Button>
        </Tooltip>
      </div>
    </div>
  </TooltipProvider>
);

export const WithIconButtons: Story = () => (
  <TooltipProvider>
    <div className="flex min-h-[300px] items-center justify-center p-8">
      <div className="flex gap-2">
        <IconButton label="打开设置" tooltip="打开设置" tooltipShortcut="⌘,">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="加入收藏" tooltip="加入收藏" tone="primary">
          <Heart className="h-4 w-4" />
        </IconButton>
        <IconButton label="删除项目" tooltip="删除项目" tooltipShortcut="⌫" tone="danger">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </TooltipProvider>
);
