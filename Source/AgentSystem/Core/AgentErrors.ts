/** 把 unknown 错误压成一行消息。需要结构化细节时用 Diagnostics/AgentErrorSerializer。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 保证拿到 Error 实例；非 Error 值包装为 Error 以保留可 throw 的栈。 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
