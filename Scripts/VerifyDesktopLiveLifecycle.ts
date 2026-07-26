import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireDesktopLiveLock,
  createDesktopLiveCleanup,
  repairNodeNativeDependencies,
} from "../Apps/Desktop/DesktopLiveLifecycle.js";

const healthyCalls: string[] = [];
assert.deepEqual(
  repairNodeNativeDependencies(
    () => {
      healthyCalls.push("probe");
      return 0;
    },
    () => {
      healthyCalls.push("rebuild");
      return 0;
    },
  ),
  { exitCode: 0, repaired: false },
);
assert.deepEqual(healthyCalls, ["probe"]);

const repairCalls: string[] = [];
assert.deepEqual(
  repairNodeNativeDependencies(
    () => {
      repairCalls.push("probe");
      return 1;
    },
    () => {
      repairCalls.push("rebuild");
      return 0;
    },
  ),
  { exitCode: 0, repaired: true },
);
assert.deepEqual(repairCalls, ["probe", "rebuild"]);
assert.deepEqual(
  repairNodeNativeDependencies(
    () => 1,
    () => 9,
  ),
  { exitCode: 9, repaired: true },
);

let cleanupCalls = 0;
const cleanup = createDesktopLiveCleanup(async () => {
  cleanupCalls += 1;
  await Promise.resolve();
  return 7;
});
assert.deepEqual(await Promise.all([cleanup(), cleanup(), cleanup()]), [7, 7, 7]);
assert.equal(cleanupCalls, 1);

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-desktop-live-"));
try {
  const firstLock = acquireDesktopLiveLock(workspaceRoot, {
    processId: 101,
    token: "first",
    isProcessRunning: (processId) => processId === 101,
  });
  assert.throws(
    () =>
      acquireDesktopLiveLock(workspaceRoot, {
        processId: 202,
        token: "blocked",
        isProcessRunning: (processId) => processId === 101,
      }),
    /already running \(PID 101\)/,
  );

  const replacementLock = acquireDesktopLiveLock(workspaceRoot, {
    processId: 202,
    token: "replacement",
    isProcessRunning: () => false,
  });
  firstLock.release();
  assert.equal(fs.existsSync(replacementLock.path), true, "A stale owner must not release the replacement lock.");
  replacementLock.release();
  assert.equal(fs.existsSync(replacementLock.path), false);
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

console.log("Desktop live lifecycle verification passed.");
