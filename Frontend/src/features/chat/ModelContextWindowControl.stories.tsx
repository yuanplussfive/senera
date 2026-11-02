import { useState } from "react";
import { ModelContextWindowControl } from "./ModelContextWindowControl";

export const Capacities = () => {
  const [value, setValue] = useState<number | undefined>(200_000);
  return (
    <main className="mx-auto max-w-3xl space-y-6 bg-surface-panel p-6 text-content-primary">
      <h1 className="text-lg font-semibold">上下文容量</h1>
      <p className="text-sm text-content-muted">容量尺与精确输入联动，目录容量只作参考，允许填写供应商实际支持的值。</p>
      <ModelContextWindowControl value={value} reference={1_000_000} disabled={false} onChange={setValue} />
      <ModelContextWindowControl value={128_000} disabled onChange={() => undefined} />
      <ModelContextWindowControl disabled onChange={() => undefined} />
    </main>
  );
};
