import type { Story } from "@ladle/react";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "./Button";
import { FormField, FormLabel, FormHint, Input } from "./Form";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "./Sheet";

export const LeftSheet: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button>
            <Menu className="h-4 w-4" />
            打开左侧面板
          </Button>
        </SheetTrigger>
        <SheetContent side="left" title="左侧面板" description="从屏幕左侧进入的辅助工作区。">
          <div className="mt-6 space-y-4">
            <p className="text-sm text-ink-700">适合放置导航、筛选条件或当前对象的补充信息。</p>
            <p className="text-sm text-ink-700">面板关闭后，主工作区仍保持原来的位置。</p>
          </div>
          <div className="mt-6">
            <SheetClose asChild>
              <Button className="w-full">关闭面板</Button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const RightSheet: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline">
            <Menu className="h-4 w-4" />
            打开右侧面板
          </Button>
        </SheetTrigger>
        <SheetContent side="right" title="右侧面板" description="从屏幕右侧进入的辅助工作区。">
          <div className="mt-6 space-y-4">
            <h4 className="font-medium text-ink-900">示例内容</h4>
            <p className="text-sm text-ink-600">面板内部可以组合表单、列表、设置和对象详情。</p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const WithForm: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-[460px] items-center justify-center p-8">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button>打开设置</Button>
        </SheetTrigger>
        <SheetContent side="right" title="工作区设置" description="修改当前工作区的显示信息。">
          <form className="mt-6 space-y-5" onSubmit={(event) => event.preventDefault()}>
            <FormField>
              <FormLabel>名称</FormLabel>
              <Input name="name" autoComplete="name" placeholder="输入工作区名称" />
            </FormField>
            <FormField>
              <FormLabel>通知邮箱</FormLabel>
              <Input name="email" type="email" autoComplete="email" placeholder="name@example.com" />
              <FormHint>只用于发送必要的工作区通知。</FormHint>
            </FormField>
            <div className="flex gap-2 pt-2">
              <SheetClose asChild>
                <Button variant="ghost" className="flex-1">
                  取消
                </Button>
              </SheetClose>
              <Button className="flex-1">保存</Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
};
