import { FrontendTestCoveragePolicy } from "./TestCoveragePolicy.js";
import { resolveWorkspaceRoot, verifyTestGovernance } from "./TestGovernance.js";

const workspaceRoot = resolveWorkspaceRoot();
const testCount = verifyTestGovernance({
  workspaceRoot,
  policy: FrontendTestCoveragePolicy,
});

console.log(`Frontend test governance verified (${testCount} Vitest files).`);
