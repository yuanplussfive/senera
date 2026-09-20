import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { ConversationFrame, Skeleton } from "../../shared/ui";

const LOADING_ROWS = ["assistant", "user", "assistant", "user"] as const;

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
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden pb-5 pt-6">
        {LOADING_ROWS.map((role, index) => (
          <LoadingRow key={`${role}-${index}`} role={role} index={index} />
        ))}
      </div>
    </div>
  );
}

function LoadingRow({ role, index }: { role: (typeof LOADING_ROWS)[number]; index: number }): JSX.Element {
  if (role === "user") {
    return (
      <ConversationFrame mode="user" className="items-start justify-end gap-2.5" aria-hidden="true">
        <div
          className={
            index % 3 === 0 ? "flex w-[46%] min-w-0 flex-col items-end" : "flex w-[58%] min-w-0 flex-col items-end"
          }
        >
          <Skeleton className="h-2.5 w-16 self-end" />
          <Skeleton className="mt-1 h-11 w-full rounded-2xl rounded-tr-[5px]" />
        </div>
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      </ConversationFrame>
    );
  }

  return (
    <ConversationFrame mode="wide" aria-hidden="true">
      <div className="flex min-w-0 items-start gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className={index % 3 === 0 ? "min-w-0 max-w-[72%] flex-1" : "min-w-0 max-w-[82%] flex-1"}>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-[88%]" />
          <Skeleton className="mt-2 h-3 w-[62%]" />
        </div>
      </div>
    </ConversationFrame>
  );
}
