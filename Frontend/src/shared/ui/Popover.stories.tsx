import type { Story } from "@ladle/react";
import { ChevronDown } from "lucide-react";
import { Button } from "./Button";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

export const ToolDetails: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <Popover defaultOpen>
      <PopoverTrigger asChild>
        <Button variant="outline">
          查看工具详情
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="text-[13px] font-medium text-content-primary">工作区搜索</div>
        <div className="mt-2 font-mono text-[12px] leading-5 text-content-secondary">
          rg -n &quot;projectAssistantTurnStages&quot; Frontend/src
        </div>
      </PopoverContent>
    </Popover>
  </div>
);
