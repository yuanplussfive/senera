import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

/**
 * 面板级重试按钮：安静的 outline 形态，不带图标不带阴影。
 * 错误恢复动作不该比错误本身更响。
 */
export function RetryButton({
  onRetry,
  disabled,
  label,
  className,
}: {
  onRetry: () => void;
  disabled?: boolean;
  label?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onRetry}
      disabled={disabled}
      className={cn("h-8 rounded-md px-3 text-[12.5px] shadow-none", className)}
    >
      {label ?? frontendMessage("ui.retry")}
    </Button>
  );
}

export type StateViewStatus = "loading" | "error" | "empty";

/**
 * 面板/列表的三态视图：loading（spinner + 文案）、error（图标 + 文案 + 重试）、
 * empty（文案，可选图标与 CTA）。容器默认在可用空间内垂直居中；
 * 调用处应保证外层有确定高度（h-full / min-h），以避免加载完成后的高度跳变。
 */
export function StateView({
  status,
  title,
  description,
  icon,
  action,
  onRetry,
  retryDisabled,
  retryLabel,
  className,
}: {
  status: StateViewStatus;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  onRetry?: () => void;
  retryDisabled?: boolean;
  retryLabel?: ReactNode;
  className?: string;
}): JSX.Element {
  const isLoading = status === "loading";
  const isError = status === "error";
  const resolvedDescription = description ?? (isLoading ? frontendMessage("ui.loading") : null);
  return (
    <div
      role={isError ? "alert" : isLoading ? "status" : undefined}
      aria-busy={isLoading || undefined}
      className={cn("grid h-full min-h-[160px] place-items-center px-6 py-8 text-center", className)}
    >
      <div className="flex max-w-sm flex-col items-center">
        {isLoading ? (
          <Spinner size="md" className="text-content-muted" />
        ) : isError ? (
          <AlertCircle aria-hidden="true" className="h-4 w-4 text-brick-600" />
        ) : (
          icon
        )}
        {title ? (
          <div
            className={cn("text-[13px] font-medium text-content-primary", (isLoading || isError || icon) && "mt-2.5")}
          >
            {title}
          </div>
        ) : null}
        {resolvedDescription ? (
          <div
            className={cn(
              "text-[12.5px] leading-5 text-content-secondary",
              title ? "mt-1" : (isLoading || isError || icon) && "mt-2.5",
            )}
          >
            {resolvedDescription}
          </div>
        ) : null}
        {isError && onRetry ? (
          <RetryButton onRetry={onRetry} disabled={retryDisabled} label={retryLabel} className="mt-3" />
        ) : null}
        {!isError && action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * 表单/行内错误：一行红字 + 小图标，长错误串自动折行；
 * 恢复动作是同色的文字链接，不升级为按钮。
 */
export function InlineError({
  children,
  onRetry,
  retryDisabled,
  className,
}: {
  children: ReactNode;
  onRetry?: () => void;
  retryDisabled?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div
      role="alert"
      className={cn("flex min-w-0 items-start gap-1.5 text-[12px] leading-5 text-brick-600", className)}
    >
      <AlertCircle aria-hidden="true" className="mt-[3px] h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 whitespace-pre-wrap break-words">{children}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="shrink-0 font-medium underline underline-offset-2 hover:text-brick-700 disabled:pointer-events-none disabled:opacity-50"
        >
          {frontendMessage("ui.retry")}
        </button>
      ) : null}
    </div>
  );
}
