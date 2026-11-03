import type { HTMLAttributes } from "react";
import { Skeleton } from "../ui/Skeleton";

/**
 * Keep the application and chat loading surfaces aligned while their modules load.
 * The bar draws no separator because the real chat header draws none either.
 */
export function ChatLoadingHeader(props: HTMLAttributes<HTMLElement>): JSX.Element {
  return (
    <header
      {...props}
      className="flex h-[var(--senera-top-chrome-height)] shrink-0 items-center gap-3 px-4 sm:px-6"
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

