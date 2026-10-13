import { cn } from "../../lib/util";
import { AppIcon } from "../../shared/ui";

export interface ConfigDiagnosticItem {
  severity: "error" | "warning";
  message: string;
}

/**
 * 配置校验诊断列表：逐行小图标 + 着色文字（不做整块渍染），
 * 超过约五行后内部滚动，批量错误不会无界撑高布局。
 */
export function ConfigDiagnosticsList({
  items,
  className,
}: {
  items: readonly ConfigDiagnosticItem[];
  className?: string;
}): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul role="alert" className={cn("scrollbar-thin max-h-40 space-y-1 overflow-y-auto", className)}>
      {items.map((item, index) => (
        <li
          key={`${item.severity}-${index}`}
          className={cn(
            "flex min-w-0 items-start gap-1.5 text-[12px] leading-5",
            item.severity === "error" ? "text-brick-600" : "text-umber-600",
          )}
        >
          <AppIcon
            icon={item.severity === "error" ? "alert" : "warning"}
            size={14}
            aria-hidden="true"
            className="mt-[3px]"
          />
          <span className="min-w-0 whitespace-pre-wrap break-words">{item.message}</span>
        </li>
      ))}
    </ul>
  );
}
