import { BackendTestCoveragePolicy } from "./TestCoveragePolicy.js";
import { resolveWorkspaceRoot, verifyTestGovernance } from "./TestGovernance.js";

const workspaceRoot = resolveWorkspaceRoot();
const testCount = verifyTestGovernance({
  workspaceRoot,
  policy: BackendTestCoveragePolicy,
});

console.log(`Backend test governance verified (${testCount} Vitest files).`);
