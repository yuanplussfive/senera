import type { Story } from "@ladle/react";
import { Inbox } from "lucide-react";
import { InlineError, RetryButton, StateView } from "./StateView";
import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";

export const Loading: Story = () => (
  <div className="h-64 border border-line-subtle">
    <StateView status="loading" description="正在获取模型列表" />
  </div>
);

export const ErrorWithRetry: Story = () => (
  <div className="h-64 border border-line-subtle">
    <StateView status="error" title="模型列表获取失败" description="请检查网络连接后重试" onRetry={() => undefined} />
  </div>
);

export const Empty: Story = () => (
  <div className="h-64 border border-line-subtle">
    <StateView
      status="empty"
      icon={<Inbox aria-hidden="true" className="h-5 w-5 text-content-muted" />}
      description="添加供应商后填写连接信息"
    />
  </div>
);

export const InlineErrorRow: Story = () => (
  <div className="flex max-w-sm flex-col gap-4 p-8">
    <InlineError>供应商密钥无效</InlineError>
    <InlineError onRetry={() => undefined}>
      模型列表获取失败，连接可能已断开，这里演示一条较长的错误信息的折行表现
    </InlineError>
  </div>
);

export const Primitives: Story = () => (
  <div className="flex flex-col gap-6 p-8">
    <div className="flex items-center gap-4 text-content-secondary">
      <Spinner size="xs" />
      <Spinner size="sm" />
      <Spinner size="md" />
      <RetryButton onRetry={() => undefined} />
    </div>
    <div className="flex max-w-xs flex-col gap-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-[62%]" />
    </div>
  </div>
);
