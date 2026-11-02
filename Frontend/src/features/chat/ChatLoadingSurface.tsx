import { ChatLoadingHeader, ChatLoadingComposer, ChatLoadingRows } from "../../shared/chat/ChatLoadingChrome";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

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
      <ChatLoadingRows />
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
      <ChatLoadingHeader data-chat-panel-loading-header />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-hidden" aria-hidden="true" data-chat-panel-loading-content>
          <ChatLoadingRows />
        </div>
        <ChatLoadingComposer data-chat-panel-loading-composer />
      </div>
    </main>
  );
}
