import type { Story } from "@ladle/react";
import { useState } from "react";
import { Button } from "./Button";
import { Dialog, DialogActionButton, DialogActions, DialogContent, DialogTrigger } from "./Dialog";

export const BasicDialog: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>打开对话框</Button>
        </DialogTrigger>
        <DialogContent motionPreset="modal" title="保存工作区设置" description="确认后，新的设置会应用到当前工作区。">
          <div className="space-y-4">
            <p className="text-sm text-ink-700">这里可以放置当前任务需要集中处理的内容。</p>
            <DialogActions>
              <DialogActionButton close variant="secondary">
                取消
              </DialogActionButton>
              <DialogActionButton close variant="primary">
                确认
              </DialogActionButton>
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const DestructiveDialog: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="destructive">删除项目</Button>
        </DialogTrigger>
        <DialogContent
          motionPreset="modal"
          title="确定删除这个项目吗？"
          description="该操作无法撤销，项目及其本地记录将被永久删除。"
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-700">请确认当前项目不再需要保留。</p>
            <DialogActions>
              <DialogActionButton close variant="secondary">
                取消
              </DialogActionButton>
              <DialogActionButton close variant="danger">
                删除
              </DialogActionButton>
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const WithoutDescription: Story = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-[400px] items-center justify-center p-8">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>打开简单对话框</Button>
        </DialogTrigger>
        <DialogContent motionPreset="modal" title="操作完成">
          <div className="space-y-4">
            <p className="text-sm text-ink-700">内容较简单时可以只保留标题。</p>
            <DialogActions>
              <DialogActionButton close variant="primary">
                关闭
              </DialogActionButton>
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
