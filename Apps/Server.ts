import { startSeneraServer } from "./ServerRuntime.js";

function main(): void {
  const handle = startSeneraServer();
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): void => {
    shutdownPromise ??= handle.stop().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
