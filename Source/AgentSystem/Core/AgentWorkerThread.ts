/**
 * Resolves a worker entry in both development (TypeScript through tsx) and
 * compiled production runtimes. Keeping this boundary central prevents each
 * worker owner from inventing a subtly different development bootstrap.
 */
export function resolveAgentWorkerThreadEntry(workerUrl: URL): URL {
  if (!workerUrl.pathname.endsWith(".ts")) return workerUrl;
  const tsxApiUrl = import.meta.resolve("tsx/esm/api");
  const source = [
    `import { tsImport } from ${JSON.stringify(tsxApiUrl)};`,
    `await tsImport(${JSON.stringify(workerUrl.href)}, import.meta.url);`,
  ].join("\n");
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

/** Node rejects --input-type for file-backed workers, while all other parent
 * execution arguments remain relevant to diagnostics and loaders. */
export function resolveAgentWorkerThreadExecArgv(argumentsToFilter = process.execArgv): string[] {
  return argumentsToFilter.filter((argument) => !argument.startsWith("--input-type"));
}
