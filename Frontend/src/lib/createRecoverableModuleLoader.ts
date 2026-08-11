export function createRecoverableModuleLoader<T>(load: (retryAttempt: number) => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  let retryAttempt = 0;

  return () => {
    pending ??= load(retryAttempt).catch((error: unknown) => {
      pending = undefined;
      retryAttempt += 1;
      throw error;
    });
    return pending;
  };
}
