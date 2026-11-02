import { useState } from "react";
import { Button } from "../shared/ui/Button";
import { Dialog, DialogContent, DialogTrigger } from "../shared/ui/Dialog";
import { Sheet, SheetContent, SheetTrigger } from "../shared/ui/Sheet";
import { MenuSelect } from "../shared/ui/MenuSelect";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../shared/ui/ContextMenu";

const options = Array.from({ length: 80 }, (_, index) => ({ value: String(index), label: `模型选项 ${index + 1}` }));

/** Shared stories exercise real portalled controls in a real modal scroll boundary. */
export function OverlayScrollFixture({ surface = "dialog" }: { surface?: "dialog" | "sheet" }): JSX.Element {
  const [value, setValue] = useState("0");
  const controls = (
    <div className="flex flex-col gap-5 p-5">
      <p className="text-sm text-content-secondary">使用鼠标滚轮、触摸或键盘滚动菜单；底下的页面应保持锁定。</p>
      <MenuSelect value={value} options={options} placeholder="选择模型" ariaLabel="滚动模型选择" onChange={setValue} />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">展开长结果</Button>
        </PopoverTrigger>
        <PopoverContent className="max-h-48 overflow-y-auto" data-scroll-fixture="popover">
          {options.map((option) => (
            <p className="py-2" key={option.value}>
              {option.label}
            </p>
          ))}
        </PopoverContent>
      </Popover>
      <ContextMenu>
        <ContextMenuTrigger className="rounded-md border border-line p-5 text-sm">右键打开长菜单</ContextMenuTrigger>
        <ContextMenuContent className="max-h-48 overflow-y-auto">
          {options.map((option) => (
            <ContextMenuItem key={option.value}>{option.label}</ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
  return surface === "dialog" ? (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>打开滚动示例</Button>
      </DialogTrigger>
      <DialogContent title="弹层内滚动" description="模型菜单和工具详情共享同一个模态边界。">
        {controls}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet defaultOpen>
      <SheetTrigger asChild>
        <Button>打开侧栏示例</Button>
      </SheetTrigger>
      <SheetContent title="侧栏内滚动" description="侧栏中的菜单也支持鼠标滚轮。">
        {controls}
      </SheetContent>
    </Sheet>
  );
}
