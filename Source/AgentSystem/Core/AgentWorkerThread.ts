/**
 * Resolves a worker entry in both development (TypeScript through tsx) and
 * compiled production runtimes. Keeping this boundary central prevents each
 * worker owner from inventing a subtly different development bootstrap.
 */
export function resolveAgentWorkerThreadEntry(workerUrl: URL): URL {
  if (workerUrl.pathname.endsWith(".ts")) return new URL("./AgentWorkerThreadBootstrap.mts", import.meta.url);
  return workerUrl;
}

export function resolveAgentWorkerThreadData(workerUrl: URL): { readonly target: string } | undefined {
  return workerUrl.pathname.endsWith(".ts") ? { target: workerUrl.href } : undefined;
}

/** Node rejects --input-type for file-backed workers, while all other parent
 * execution arguments remain relevant to diagnostics and loaders. */
export function resolveAgentWorkerThreadExecArgv(argumentsToFilter = process.execArgv): string[] {
  return argumentsToFilter.filter((argument) => !argument.startsWith("--input-type"));
}
