import type { Story } from "@ladle/react";
import { Plus } from "lucide-react";
import { Button, type ButtonProps } from "./Button";

const AddIcon = () => <Plus aria-hidden="true" className="h-4 w-4" />;

export const Default: Story<ButtonProps> = () => (
  <div className="flex flex-col gap-4 p-8">
    <div className="flex flex-wrap gap-3">
      <Button>主要操作</Button>
      <Button variant="ghost">轻量操作</Button>
      <Button variant="outline">次要操作</Button>
      <Button variant="destructive">危险操作</Button>
    </div>
  </div>
);

export const Sizes: Story<ButtonProps> = () => (
  <div className="flex flex-col gap-4 p-8">
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">小尺寸</Button>
      <Button size="default">默认尺寸</Button>
      <Button size="icon" aria-label="新建">
        <AddIcon />
      </Button>
    </div>
  </div>
);

export const States: Story<ButtonProps> = () => (
  <div className="flex flex-col gap-4 p-8">
    <div className="flex flex-wrap gap-3">
      <Button>可用按钮</Button>
      <Button disabled>禁用按钮</Button>
    </div>
  </div>
);

export const AllVariants: Story<ButtonProps> = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">主要按钮</h3>
      <div className="flex flex-wrap gap-3">
        <Button size="sm">小尺寸</Button>
        <Button>默认尺寸</Button>
        <Button size="icon" aria-label="新建">
          <AddIcon />
        </Button>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">轻量按钮</h3>
      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" size="sm">
          小尺寸
        </Button>
        <Button variant="ghost">默认尺寸</Button>
        <Button variant="ghost" size="icon" aria-label="新建">
          <AddIcon />
        </Button>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">次要按钮</h3>
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" size="sm">
          小尺寸
        </Button>
        <Button variant="outline">默认尺寸</Button>
        <Button variant="outline" size="icon" aria-label="新建">
          <AddIcon />
        </Button>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">危险按钮</h3>
      <div className="flex flex-wrap gap-3">
        <Button variant="destructive" size="sm">
          小尺寸
        </Button>
        <Button variant="destructive">默认尺寸</Button>
        <Button variant="destructive" size="icon" aria-label="新建">
          <AddIcon />
        </Button>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">禁用状态</h3>
      <div className="flex flex-wrap gap-3">
        <Button disabled>主要按钮</Button>
        <Button variant="ghost" disabled>
          轻量按钮
        </Button>
        <Button variant="outline" disabled>
          次要按钮
        </Button>
        <Button variant="destructive" disabled>
          危险按钮
        </Button>
      </div>
    </div>
  </div>
);
