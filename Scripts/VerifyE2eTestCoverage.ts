import { E2eTestPolicy } from "./TestCoveragePolicy.js";
import { resolveWorkspaceRoot, verifyTestGovernance } from "./TestGovernance.js";

const workspaceRoot = resolveWorkspaceRoot();
const testCount = verifyTestGovernance({
  workspaceRoot,
  policy: E2eTestPolicy,
});

console.log(`E2E test governance verified (${testCount} Vitest files).`);
