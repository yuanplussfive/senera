import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../lib/util";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { Spinner } from "./Spinner";

/**
 * 面板级恢复按钮：浅灰胶囊，中性色阶随主题反转（暗色下自动变浅灰底深灰字）。
 * 恢复动作是唯一可点击的元素，但它不该比错误本身更响。
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
    <button
      type="button"
      onClick={onRetry}
      disabled={disabled}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink-900/[0.05] px-3.5",
        "text-[12.5px] font-medium text-content-primary",
        "transition-colors duration-150 ease-out hover:bg-ink-900/[0.09] active:bg-ink-900/[0.12]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {label ?? frontendMessage("ui.retry")}
    </button>
  );
}

export type StateViewStatus = "loading" | "error" | "empty";

const stateEnterStyle = { "--state-enter-delay": "40ms" } as CSSProperties;

/**
 * 面板/列表的三态视图。设计原则是「融入而非宣告」：
 * 没有图标、没有语义色、没有边框——一行中性文字说明现状，
 * 需要时跟一颗浅灰恢复按钮。加载态只保留安静的圆形指示器。
 * 内容以一次短淡入入场，尊重 prefers-reduced-motion 与应用级 motion-level。
 * 容器默认在可用空间内垂直居中；调用处应保证外层有确定高度（h-full / min-h），
 * 以避免加载完成后的高度跳变。
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
  /** 空态可选的辅助图标，渲染为中性色小图标；错误态不显示图标。 */
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
  const showIcon = !isLoading && !isError && Boolean(icon);
  const hasVisual = isLoading || showIcon;
  return (
    <div
      role={isError ? "alert" : isLoading ? "status" : undefined}
      aria-busy={isLoading || undefined}
      className={cn("grid h-full min-h-[160px] place-items-center px-6 py-8 text-center", className)}
      data-state-view={status}
    >
      <div className="senera-state-enter flex max-w-sm flex-col items-center" style={stateEnterStyle}>
        {isLoading ? (
          <Spinner size="md" className="text-content-muted" />
        ) : showIcon ? (
          <span className="text-content-muted">{icon}</span>
        ) : null}
        {title ? <div className={cn("text-[13px] text-content-secondary", hasVisual && "mt-3")}>{title}</div> : null}
        {resolvedDescription ? (
          <div
            className={cn(
              "text-[12.5px] leading-5",
              title ? "mt-1 text-content-muted" : cn(hasVisual && "mt-3", "text-content-secondary"),
            )}
          >
            {resolvedDescription}
          </div>
        ) : null}
        {action ? (
          <div className="mt-4">{action}</div>
        ) : isError && onRetry ? (
          <RetryButton onRetry={onRetry} disabled={retryDisabled} label={retryLabel} className="mt-4" />
        ) : null}
      </div>
    </div>
  );
}

/**
 * 内容区内的可恢复错误：一行扁平文字——标题 + 描述在左，
 * 恢复动作收在右侧。没有底色、边框和图标，靠留白与正文区分。
 * 用于「内容还在，但这一小块没加载出来」的场景——比如历史同步失败、
 * 资源读取失败——它应该像一行安静的批注，而不是一张告警卡片。
 */
export function ErrorBanner({
  title,
  description,
  action,
  onRetry,
  retryDisabled,
  retryLabel,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  onRetry?: () => void;
  retryDisabled?: boolean;
  retryLabel?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      role="alert"
      className={cn("senera-state-enter flex items-baseline gap-3 px-1 py-3", className)}
      data-error-banner
    >
      <div className="min-w-0 flex-1">
        <span className="text-[13px] text-content-secondary">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-[12.5px] leading-5 text-content-muted">{description}</span>
        ) : null}
      </div>
      {action ? (
        <div className="shrink-0 self-center">{action}</div>
      ) : onRetry ? (
        <RetryButton onRetry={onRetry} disabled={retryDisabled} label={retryLabel} className="shrink-0 self-center" />
      ) : null}
    </div>
  );
}

/**
 * 表单/行内错误：一行中性色小字，长错误串自动折行；
 * 恢复动作是同色系的文字链接，不升级为按钮。
 * 行内场景紧跟出错的内容，文字本身已足够定位，不需要图标。
 */
export function InlineError({
  children,
  onRetry,
  retryDisabled,
  retryLabel,
  announce = false,
  id,
  className,
}: {
  children: ReactNode;
  onRetry?: () => void;
  retryDisabled?: boolean;
  retryLabel?: ReactNode;
  announce?: "polite" | "assertive" | false;
  id?: string;
  className?: string;
}): JSX.Element {
  return (
    <div
      id={id}
      role={announce === "assertive" ? "alert" : announce === "polite" ? "status" : undefined}
      className={cn("flex min-w-0 items-baseline gap-2 text-[12px] leading-5 text-brick-600", className)}
    >
      <span className="min-w-0 whitespace-pre-wrap break-words">{children}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="shrink-0 font-medium underline underline-offset-2 hover:text-brick-700 disabled:pointer-events-none disabled:opacity-50"
        >
          {retryLabel ?? frontendMessage("ui.retry")}
        </button>
      ) : null}
    </div>
  );
}
