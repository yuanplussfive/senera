import type { Story } from "@ladle/react";
import { ChevronDown, Settings, User, LogOut, Copy, Trash2, FileText } from "lucide-react";
import { Button } from "./Button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
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
        <DropdownMenuItem icon={<User className="h-4 w-4" />}>
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>
          Settings
        </DropdownMenuItem>
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
        <DropdownMenuItem icon={<User className="h-4 w-4" />}>
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Settings className="h-4 w-4" />}>
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
