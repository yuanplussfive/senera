import type { Story } from "@ladle/react";
import { ChevronDown, Settings, User, UserRoundPen, Info, Wifi, LogOut, Copy, Trash2, FileText } from "lucide-react";
import { Button } from "./Button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuMeta,
} from "./DropdownMenu";

export const BasicMenu: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          Options
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>View</DropdownMenuItem>
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const WithIcons: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          Account
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<User className="h-4 w-4" />}>Profile</DropdownMenuItem>
        <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>Settings</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<LogOut className="h-4 w-4" />} destructive>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const WithShortcuts: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          File
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<FileText className="h-4 w-4" />} shortcut="⌘N">
          New File
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Copy className="h-4 w-4" />} shortcut="⌘D">
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<Trash2 className="h-4 w-4" />} shortcut="⌫" destructive>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export const WithLabel: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          Menu
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<User className="h-4 w-4" />}>Profile</DropdownMenuItem>
        <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>Settings</DropdownMenuItem>
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
