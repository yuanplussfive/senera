import { IntegrationTestPolicy } from "./TestCoveragePolicy.js";
import { resolveWorkspaceRoot, verifyTestGovernance } from "./TestGovernance.js";

const workspaceRoot = resolveWorkspaceRoot();
const testCount = verifyTestGovernance({
  workspaceRoot,
  policy: IntegrationTestPolicy,
});

console.log(`Integration test governance verified (${testCount} Vitest files).`);
