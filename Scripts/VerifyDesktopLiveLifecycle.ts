import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireDesktopLiveLock, createDesktopLiveCleanup } from "../Apps/Desktop/DesktopLiveLifecycle.js";

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
