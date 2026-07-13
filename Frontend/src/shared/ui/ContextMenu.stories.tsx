import type { Story } from "@ladle/react";
import { Copy, Trash2, Edit, Download, Share } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from "./ContextMenu";

export const BasicContextMenu: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-[200px] w-[300px] items-center justify-center rounded-lg border-2 border-dashed border-ink-300 bg-paper-100">
          <div className="text-center">
            <div className="text-ink-900 font-medium">Right-click here</div>
            <div className="text-ink-500 text-sm mt-1">Try the context menu</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>View</ContextMenuItem>
        <ContextMenuItem>Edit</ContextMenuItem>
        <ContextMenuItem>Duplicate</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
);

export const WithIcons: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-[200px] w-[350px] items-center justify-center rounded-lg border border-ink-200 bg-paper-50 p-6">
          <div className="text-center">
            <div className="text-ink-900 font-medium mb-2">Document.pdf</div>
            <div className="text-ink-500 text-sm">Right-click for actions</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<Edit className="h-4 w-4" />}>Edit</ContextMenuItem>
        <ContextMenuItem icon={<Copy className="h-4 w-4" />}>Copy</ContextMenuItem>
        <ContextMenuItem icon={<Download className="h-4 w-4" />}>Download</ContextMenuItem>
        <ContextMenuItem icon={<Share className="h-4 w-4" />}>Share</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Trash2 className="h-4 w-4" />} destructive>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
);

export const WithShortcuts: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex h-[200px] w-[400px] items-center justify-center rounded-lg border border-ink-200 bg-paper-50">
          <div className="text-center">
            <div className="text-ink-900 font-medium">Text Editor Area</div>
            <div className="text-ink-500 text-sm mt-1">Right-click to see keyboard shortcuts</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<Copy className="h-4 w-4" />} shortcut="⌘C">
          Copy
        </ContextMenuItem>
        <ContextMenuItem icon={<Edit className="h-4 w-4" />} shortcut="⌘E">
          Edit
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Download className="h-4 w-4" />} shortcut="⌘S">
          Save
        </ContextMenuItem>
        <ContextMenuItem icon={<Trash2 className="h-4 w-4" />} shortcut="⌫" destructive>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  </div>
);

export const DocumentPreview: Story = () => (
  <div className="flex items-center justify-center min-h-[400px] p-8">
    <div className="w-[500px] space-y-4">
      <h3 className="text-ink-900 font-medium">Document Preview Context Menu</h3>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="rounded-2xl bg-paper-200 px-4 py-3 border border-ink-200">
            <div className="text-ink-500 text-xs mb-1">Draft.txt</div>
            <div className="text-ink-900 text-sm">
              This is a document preview. Right-click to access common file actions.
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>File Actions</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<Copy className="h-4 w-4" />} shortcut="⌘C">
            Copy content
          </ContextMenuItem>
          <ContextMenuItem icon={<Edit className="h-4 w-4" />}>Edit document</ContextMenuItem>
          <ContextMenuItem icon={<Share className="h-4 w-4" />}>Share document</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<Trash2 className="h-4 w-4" />} destructive>
            Delete document
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  </div>
);
