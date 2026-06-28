import fs from "node:fs/promises";
import path from "node:path";
import { throwIfAborted } from "../AgentCancellation.js";
import type { WritePlan } from "./AgentPatchApplyTypes.js";

export async function commitWritePlan(plan: WritePlan[], signal?: AbortSignal): Promise<void> {
  for (const entry of plan) {
    throwIfAborted(signal);
    if (entry.status === "deleted") {
      await fs.rm(entry.absolutePath, { force: false });
      continue;
    }

    await fs.mkdir(path.dirname(entry.absolutePath), { recursive: true });
    await fs.writeFile(entry.absolutePath, entry.nextContent ?? "", "utf8");
  }
}
