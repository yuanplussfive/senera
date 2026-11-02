import type { HTMLAttributes } from "react";
import { Skeleton } from "../ui/Skeleton";
import { ConversationFrame } from "../ui/ConversationFrame";

const LOADING_ROWS = ["assistant", "user", "assistant", "user"] as const;

/** Keep the application and chat loading surfaces aligned while their modules load. */
export function ChatLoadingHeader(props: HTMLAttributes<HTMLElement>): JSX.Element {
  return (
    <header
      {...props}
      className="flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-3 border-b border-line-subtle px-4 sm:px-6"
      aria-hidden="true"
    >
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-4 w-20" />
      <div className="ml-auto flex items-center gap-2">
        <Skeleton className="h-7 w-7 rounded-lg" />
        <Skeleton className="h-7 w-7 rounded-lg" />
      </div>
    </header>
  );
}

export function ChatLoadingComposer(props: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className="shrink-0 bg-transparent pb-6 pt-4" aria-hidden="true">
      <div {...props} className="conversation-frame conversation-frame--composer">
        <div className="flex min-h-[110px] min-w-0 flex-col justify-between gap-2 rounded-2xl border border-line-subtle bg-surface-raised px-4 pb-3 pt-3.5 shadow-soft">
          <Skeleton className="h-10 w-[72%] max-w-[520px]" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-7 w-24 rounded-lg" />
            </div>
            <Skeleton className="h-9 w-9 rounded-full max-[1023px]:h-11 max-[1023px]:w-11" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatLoadingRows(): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden pb-5 pt-4">
      {LOADING_ROWS.map((role, index) => (
        <LoadingRow key={`${role}-${index}`} role={role} index={index} />
      ))}
    </div>
  );
}

function LoadingRow({ role, index }: { role: (typeof LOADING_ROWS)[number]; index: number }): JSX.Element {
  if (role === "user") {
    return (
      <ConversationFrame mode="user" className="items-start justify-end gap-3" aria-hidden="true">
        <div
          className={
            index % 3 === 0 ? "flex w-[46%] min-w-0 flex-col items-end" : "flex w-[58%] min-w-0 flex-col items-end"
          }
        >
          <Skeleton className="h-12 w-full rounded-2xl rounded-tr-[6px]" />
          <Skeleton className="mt-3 h-2.5 w-24 self-end" />
        </div>
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
      </ConversationFrame>
    );
  }

  return (
    <ConversationFrame mode="wide" aria-hidden="true">
      <div className="flex min-w-0 items-start gap-4">
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
