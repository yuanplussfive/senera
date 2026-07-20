import type { Story } from "@ladle/react";
import { ChevronDown, Copy, FileText, Info, LogOut, Settings, Trash2, User, UserRoundPen, Wifi } from "lucide-react";
import { Button } from "./Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuMeta,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";

export const BasicMenu: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          操作
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>查看</DropdownMenuItem>
        <DropdownMenuItem>编辑</DropdownMenuItem>
        <DropdownMenuItem>创建副本</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>删除</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const WithIcons: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          账户
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<User className="h-4 w-4" />}>个人资料</DropdownMenuItem>
        <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>设置</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<LogOut className="h-4 w-4" />} destructive>
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const WithShortcuts: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          文件
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<FileText className="h-4 w-4" />} shortcut="⌘N">
          新建文件
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Copy className="h-4 w-4" />} shortcut="⌘D">
          创建副本
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Trash2 className="h-4 w-4" />} shortcut="⌫" destructive>
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const WithLabel: Story = () => (
  <div className="flex min-h-[400px] items-center justify-center p-8">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          菜单
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>我的账户</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<User className="h-4 w-4" />}>个人资料</DropdownMenuItem>
        <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>设置</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const ProfileReference: Story = () => (
  <div className="flex min-h-[400px] items-end justify-center bg-paper-200 p-8">
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-12 w-[220px] items-center gap-2 rounded-md border border-ink-200 bg-paper-50 px-3 text-left text-[13px] text-ink-800"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink-900 text-[12px] font-semibold text-paper-50">
            用
          </span>
          <span className="flex-1">用户</span>
          <Settings className="h-3.5 w-3.5 text-ink-350" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-[220px]">
        <DropdownMenuItem icon={<UserRoundPen className="h-3.5 w-3.5" />}>编辑资料</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Settings className="h-3.5 w-3.5" />}>设置</DropdownMenuItem>
        <DropdownMenuItem icon={<Info className="h-3.5 w-3.5" />}>关于</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuMeta icon={<Wifi className="h-3.5 w-3.5 text-moss-600" />} value="已连接">
          连接状态
        </DropdownMenuMeta>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
