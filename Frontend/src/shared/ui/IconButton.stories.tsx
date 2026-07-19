import type { Story } from "@ladle/react";
import { Heart, Search, Settings, Star, Trash2, X } from "lucide-react";
import { IconButton } from "./IconButton";

export const Sizes: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">尺寸</h3>
      <div className="flex items-center gap-3">
        <IconButton label="小尺寸设置" size="sm">
          <Settings className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="中尺寸设置" size="md">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="大尺寸设置" size="lg">
          <Settings className="h-5 w-5" />
        </IconButton>
      </div>
    </div>
  </div>
);

export const Tones: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">语气</h3>
      <div className="flex items-center gap-3">
        <IconButton label="普通设置" tone="neutral">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="弱化设置" tone="muted">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="主要收藏" tone="primary">
          <Heart className="h-4 w-4" />
        </IconButton>
        <IconButton label="危险删除" tone="danger">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </div>
);

export const WithTooltips: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">配合提示</h3>
      <div className="flex items-center gap-3">
        <IconButton label="关闭对话框" tooltip="关闭对话框">
          <X className="h-4 w-4" />
        </IconButton>
        <IconButton label="打开设置" tooltip="打开设置" tooltipShortcut="⌘,">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="搜索内容" tooltip="搜索内容" tooltipShortcut="⌘K">
          <Search className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </div>
);

export const AllVariants: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">小尺寸</h3>
      <div className="flex items-center gap-2">
        <IconButton label="关闭" size="sm" tone="neutral">
          <X className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="设置" size="sm" tone="muted">
          <Settings className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="收藏" size="sm" tone="primary">
          <Heart className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton label="删除" size="sm" tone="danger">
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">中尺寸（默认）</h3>
      <div className="flex items-center gap-2">
        <IconButton label="关闭" tone="neutral">
          <X className="h-4 w-4" />
        </IconButton>
        <IconButton label="设置" tone="muted">
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="标记重点" tone="primary">
          <Star className="h-4 w-4" />
        </IconButton>
        <IconButton label="删除" tone="danger">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">大尺寸</h3>
      <div className="flex items-center gap-2">
        <IconButton label="关闭" size="lg" tone="neutral">
          <X className="h-5 w-5" />
        </IconButton>
        <IconButton label="设置" size="lg" tone="muted">
          <Settings className="h-5 w-5" />
        </IconButton>
        <IconButton label="搜索" size="lg" tone="primary">
          <Search className="h-5 w-5" />
        </IconButton>
        <IconButton label="删除" size="lg" tone="danger">
          <Trash2 className="h-5 w-5" />
        </IconButton>
      </div>
    </div>

    <div className="space-y-3">
      <h3 className="font-medium text-ink-900">禁用状态</h3>
      <div className="flex items-center gap-2">
        <IconButton label="关闭" disabled>
          <X className="h-4 w-4" />
        </IconButton>
        <IconButton label="设置" tone="muted" disabled>
          <Settings className="h-4 w-4" />
        </IconButton>
        <IconButton label="标记重点" tone="primary" disabled>
          <Star className="h-4 w-4" />
        </IconButton>
        <IconButton label="删除" tone="danger" disabled>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  </div>
);
