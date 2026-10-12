import type { Story } from "@ladle/react";
import { ExecutionStatusTones, type ActivityStatus } from "./executionStatusTone";

const statuses: readonly ActivityStatus[] = ["pending", "running", "cancelling", "completed", "failed", "cancelled"];

export const Palette: Story = () => (
  <main className="min-h-[260px] bg-surface-canvas p-8 text-content-primary">
    <div className="mx-auto max-w-xl">
      <h1 className="text-[18px] font-semibold">执行状态色</h1>
      <p className="mt-2 text-[13px] leading-5 text-content-muted">所有执行表面共用同一组状态色。</p>
      <div className="mt-6 grid grid-cols-2 gap-3 border-y border-line-subtle py-5 sm:grid-cols-3">
        {statuses.map((status) => (
          <span key={status} className={`rounded px-3 py-2 text-[13px] ${ExecutionStatusTones[status].wash}`}>
            {status}
          </span>
        ))}
      </div>
    </div>
  </main>
);
