import { startSeneraServer } from "./ServerRuntime.js";

function main(): void {
  const handle = startSeneraServer();
  const shutdown = (): void => {
    handle.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
