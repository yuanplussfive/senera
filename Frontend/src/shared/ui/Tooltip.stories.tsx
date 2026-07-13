import type { Story } from "@ladle/react";
import { Button } from "./Button";
import { Tooltip, TooltipProvider } from "./Tooltip";
import { IconButton } from "./IconButton";
import { Settings, Heart, Trash2 } from "lucide-react";

export const BasicTooltip: Story = () => (
  <TooltipProvider>
    <div className="flex items-center justify-center min-h-[300px] p-8">
      <Tooltip content="This is a tooltip">
        <Button>Hover me</Button>
      </Tooltip>
    </div>
  </TooltipProvider>
);

export const WithShortcut: Story = () => (
  <TooltipProvider>
    <div className="flex items-center justify-center min-h-[300px] p-8">
      <div className="flex gap-4">
        <Tooltip content="Save document" shortcut="⌘S">
          <Button>Save</Button>
        </Tooltip>
        <Tooltip content="Open settings" shortcut="⌘,">
          <Button variant="ghost">Settings</Button>
        </Tooltip>
      </div>
    </div>
  </TooltipProvider>
);

export const Sides: Story = () => (
  <TooltipProvider>
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="grid grid-cols-2 gap-12">
        <Tooltip content="Top tooltip" side="top">
          <Button>Top</Button>
        </Tooltip>
        <Tooltip content="Right tooltip" side="right">
          <Button>Right</Button>
        </Tooltip>
        <Tooltip content="Bottom tooltip" side="bottom">
          <Button>Bottom</Button>
        </Tooltip>
        <Tooltip content="Left tooltip" side="left">
          <Button>Left</Button>
        </Tooltip>
      </div>
    </div>
  </TooltipProvider>
);

export const WithIconButtons: Story = () => (
  <TooltipProvider>
    <div className="flex items-center justify-center min-h-[300px] p-8">
      <div className="flex gap-2">
        <IconButton label="Settings" tooltip="Open settings" tooltipShortcut="⌘,">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="Like" tooltip="Add to favorites" tone="primary">
          <Heart className="h-4 w-4" />
        </IconButton>
        <IconButton label="Delete" tooltip="Delete item" tooltipShortcut="⌫" tone="danger">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </TooltipProvider>
);
