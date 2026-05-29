import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "../../lib/util";
import { Button } from "../ui-shadcn/button";

export function HistoryRecoveryState({
  failed,
  messageCount,
  onRetry,
  retryDisabled = false,
}: {
  failed: boolean;
  messageCount: number;
  onRetry?: () => void;
  retryDisabled?: boolean;
}): JSX.Element {
  if (failed) {
    return (
      <div className="flex flex-1 flex-col justify-end px-4 pb-8 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-start gap-3 rounded-md border border-brick-200/70 bg-brick-50/45 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brick-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink-900">历史同步失败</div>
              <p className="mt-0.5 text-[12.5px] leading-5 text-ink-500">
                这段会话还在后端，重新同步后会恢复消息。
              </p>
            </div>
            {onRetry ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={retryDisabled}
                className="h-7 gap-1 rounded-md px-2 text-[12px]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const rows = Math.min(4, Math.max(2, Math.ceil(messageCount / 3)));
  return (
    <div className="flex flex-1 flex-col justify-end px-4 pb-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {Array.from({ length: rows }).map((_, index) => (
          <HistorySkeletonRow
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            align={index % 2 === 0 ? "right" : "left"}
            width={index % 2 === 0 ? "w-[54%]" : "w-[68%]"}
          />
        ))}
        <div className="mt-1 text-center text-[12px] text-ink-400" role="status">
          正在恢复 {messageCount} 条历史消息
        </div>
      </div>
    </div>
  );
}

function HistorySkeletonRow({
  align,
  width,
}: {
  align: "left" | "right";
  width: string;
}): JSX.Element {
  const isRight = align === "right";
  return (
    <div className={isRight ? "flex justify-end" : "flex justify-start"}>
      <div className={`${width} min-w-[180px] max-w-[520px]`}>
        <div
          className={cn(
            "animate-pulse rounded-2xl",
            isRight
              ? "ml-auto h-10 rounded-br-md bg-ink-900/[0.055]"
              : "h-16 rounded-bl-md bg-paper-200/70",
          )}
        />
        <div
          className={cn(
            "mt-1 h-2 rounded bg-ink-900/[0.04]",
            isRight ? "ml-auto w-16" : "w-20",
          )}
        />
      </div>
    </div>
  );
}
