import { ChatLoadingComposer, ChatLoadingRows } from "../../shared/chat/ChatLoadingChrome";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Skeleton } from "../../shared/ui";
import { ConversationSkeleton } from "./ConversationSkeleton";

/** 对话内容尚未就绪时保留真实消息轨道的宽度、头像和行高。 */
export function ChatLoadingSurface({ label = frontendMessage("app.loading") }: { label?: string }): JSX.Element {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      role="status"
      aria-busy="true"
      aria-label={label}
      data-chat-loading-surface
    >
      <span className="sr-only">{label}</span>
      <ConversationSkeleton />
    </div>
  );
}

/** 首屏聊天模块尚未完成代码加载时，保留标题栏、消息轨道和输入区的几何。 */
export function ChatPanelLoadingSurface({ label = frontendMessage("app.loading") }: { label?: string }): JSX.Element {
  return (
    <main
      className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-transparent"
      role="status"
      aria-busy="true"
      aria-label={label}
      data-chat-panel-loading
    >
      <span className="sr-only">{label}</span>
      {/* 真实 ChatHeader 没有分隔线，骨架也不画，加载完成时顶栏不会“掉一条线”。 */}
      <header
        className="flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-3 px-4 sm:px-6"
        aria-hidden="true"
        data-chat-panel-loading-header
      >
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-20" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-hidden="true" data-chat-panel-loading-content>
          <ConversationSkeleton />
        </div>
        <ChatLoadingComposer data-chat-panel-loading-composer />
      </div>
    </main>
  );
}
