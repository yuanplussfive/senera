export interface AgentSleepOptions {
  /** 后台等待应 unref，避免仅因 sleep 挂起进程退出。 */
  unref?: boolean;
}

export function sleep(ms: number, options: AgentSleepOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (options.unref) timer.unref();
  });
}

/**
 * 给已启动的操作加超时。定时器始终 unref 且在结算后清理，
 * 不会因为超时分支未触发而挂住进程或泄漏定时器。
 */
export async function withDeadline<T>(operation: Promise<T>, timeoutMs: number, timeoutError: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
