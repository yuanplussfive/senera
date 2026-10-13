import type { Story } from "@ladle/react";
import { ChatHeader } from "./ChatHeader";
import { ChatLoadingSurface } from "./ChatLoadingSurface";

export const CatalogLoading: Story = () => (
  <div className="flex h-[720px] min-h-0 w-full flex-col bg-surface-canvas text-content-primary">
    <ChatHeader title="正在打开会话" />
    <ChatLoadingSurface label="正在加载对话" />
  </div>
);
