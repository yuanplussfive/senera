import { useState } from "react";
import { DurationInput } from "./DurationInput";

export const Durations = () => {
  const [timeout, setTimeoutValue] = useState<number | undefined>(1500);
  const [retention, setRetention] = useState<number | undefined>(168);
  return (
    <main className="min-h-screen space-y-5 bg-surface-canvas p-6 text-content-primary">
      <div className="max-w-md space-y-5">
        <h1>时长设置</h1>
        <p>界面选择合适的单位，保存时保留配置协议的单位与精度。</p>
        <DurationInput
          value={timeout}
          storageUnit="milliseconds"
          ariaLabel="请求超时"
          min={1}
          onChange={setTimeoutValue}
        />
        <DurationInput value={retention} storageUnit="hours" ariaLabel="文件保留时间" min={1} onChange={setRetention} />
        <DurationInput disabled value={0} storageUnit="seconds" ariaLabel="禁用状态" onChange={() => {}} />
      </div>
    </main>
  );
};
