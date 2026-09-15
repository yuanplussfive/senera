export function createRecoverableModuleLoader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;

  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
