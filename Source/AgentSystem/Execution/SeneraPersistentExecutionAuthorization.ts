import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";

export function assertSeneraExecutionNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SeneraExecutionError(SeneraExecutionErrorCodes.Aborted, "aborted");
  }
}
