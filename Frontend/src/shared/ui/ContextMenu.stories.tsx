import type { Story } from "@ladle/react";
import { Copy, Download, Edit, Share, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ContextMenu";

export const BasicContextMenu: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-[200px] w-[300px] items-center justify-center rounded-lg border-2 border-dashed border-ink-300 bg-paper-100">
          <div className="text-center">
            <div className="font-medium text-ink-900">在此处单击右键</div>
            <div className="mt-1 text-sm text-ink-500">查看对象的上下文操作</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>查看</ContextMenuItem>
        <ContextMenuItem>编辑</ContextMenuItem>
        <ContextMenuItem>创建副本</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive>删除</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
);

export const WithIcons: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-[200px] w-[350px] items-center justify-center rounded-lg border border-ink-200 bg-paper-50 p-6">
          <div className="text-center">
            <div className="mb-2 font-medium text-ink-900">项目说明.pdf</div>
            <div className="text-sm text-ink-500">单击右键查看文件操作</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<Edit className="h-4 w-4" />}>编辑</ContextMenuItem>
        <ContextMenuItem icon={<Copy className="h-4 w-4" />}>复制</ContextMenuItem>
        <ContextMenuItem icon={<Download className="h-4 w-4" />}>下载</ContextMenuItem>
        <ContextMenuItem icon={<Share className="h-4 w-4" />}>分享</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Trash2 className="h-4 w-4" />} destructive>
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
);

export const WithShortcuts: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-[200px] w-[400px] items-center justify-center rounded-lg border border-ink-200 bg-paper-50">
          <div className="text-center">
            <div className="font-medium text-ink-900">文本编辑区域</div>
            <div className="mt-1 text-sm text-ink-500">菜单右侧显示可用快捷键</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<Copy className="h-4 w-4" />} shortcut="⌘C">
          复制
        </ContextMenuItem>
        <ContextMenuItem icon={<Edit className="h-4 w-4" />} shortcut="⌘E">
          编辑
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Download className="h-4 w-4" />} shortcut="⌘S">
          保存
        </ContextMenuItem>
        <ContextMenuItem icon={<Trash2 className="h-4 w-4" />} shortcut="⌫" destructive>
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
);

export const DocumentPreview: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <div className="w-[500px] max-w-full space-y-4">
      <h3 className="font-medium text-ink-900">文档预览菜单</h3>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="rounded-lg border border-ink-200 bg-paper-200 px-4 py-3">
            <div className="mb-1 text-xs text-ink-500">草稿.txt</div>
            <div className="text-sm text-ink-900">这是一段文档预览。右键菜单只提供与当前文件相关的操作。</div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>文件操作</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<Copy className="h-4 w-4" />} shortcut="⌘C">
            复制内容
          </ContextMenuItem>
          <ContextMenuItem icon={<Edit className="h-4 w-4" />}>编辑文档</ContextMenuItem>
          <ContextMenuItem icon={<Share className="h-4 w-4" />}>分享文档</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<Trash2 className="h-4 w-4" />} destructive>
            删除文档
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  </div>
);
