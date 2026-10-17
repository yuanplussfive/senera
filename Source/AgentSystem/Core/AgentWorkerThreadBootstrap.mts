import { workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";
const target = readTarget(workerData);
if (!target) throw new Error("Agent worker bootstrap requires a target URL.");

const unregister = register();
try {
  await import(target);
} finally {
  await unregister();
}

function readTarget(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("target" in value)) return undefined;
  const target = (value as { target?: unknown }).target;
  return typeof target === "string" && target.length > 0 ? target : undefined;
}
