import { inspectTextIncludes, workflowJobBlock } from "./Support/WorkflowGovernance.js";

const VerifyWorkflowPath = ".github/workflows/verify.yml";
const SetupNodeActionPath = ".github/actions/setup-node/action.yml";

export function inspectVerifyPipeline(workflow: string, setupNodeAction: string): string[] {
  return [...inspectSetupNodeAction(setupNodeAction), ...inspectVerifyWorkflow(workflow)];
}

function inspectSetupNodeAction(action: string): string[] {
  return inspectTextIncludes(action, SetupNodeActionPath, [
    "install-electron:",
    "runner.os == 'Windows' && inputs.install-electron == 'true'",
    "~/AppData/Local/electron/Cache",
    "npm ci --no-audit --no-fund --prefer-offline",
    'ELECTRON_SKIP_BINARY_DOWNLOAD: "1"',
  ]);
}

function inspectVerifyWorkflow(workflow: string): string[] {
  const violations = [
    ...inspectTextIncludes(workflow, VerifyWorkflowPath, [
      "name: Fast Gate",
      "name: Windows Platform Smoke",
      "name: Coverage Gate",
      "./.github/actions/setup-node",
      "fetch-depth: 0",
      "types:\n      - opened\n      - synchronize\n      - reopened\n      - edited",
      "id: range",
      'from="$(git merge-base "$PR_BASE_SHA" "$PR_HEAD_SHA")"',
      "GITHUB_PR_TITLE: ${{ github.event.pull_request.title }}",
      "node --import tsx Scripts/VerifyPullRequestTitle.ts",
      "Restore ESLint cache",
      "npm run quality.format -- ${{ steps.range.outputs.arguments }}",
      "npm run test.frontend.static",
      "npm run test.integration",
      "npm run test.e2e.web",
      "npm run verify.suite -- workspace core integration e2e release",
      "npm run verify.suite -- platform",
      "github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'",
      "npm run test.coverage.frontend",
      "npm run test.coverage.backend",
      "inputs.full_suite",
    ]),
    ...inspectPullRequestJobGate(workflow, "coverage"),
  ];
  const fastJob = workflowJobBlock(workflow, "fast");
  const browserJob = workflowJobBlock(workflow, "browser-e2e");
  const windowsJob = workflowJobBlock(workflow, "platform-windows");
  const coverageJob = workflowJobBlock(workflow, "coverage");

  if (fastJob) {
    for (const duplicate of ["npm run check.types", "npm run test.backend", "npm run test.frontend"]) {
      if (fastJob.includes(`- run: ${duplicate}\n`)) {
        violations.push(`${VerifyWorkflowPath} Fast Gate must not duplicate ${duplicate}.`);
      }
    }
  }
  for (const [jobName, job] of [
    ["browser-e2e", browserJob],
    ["coverage", coverageJob],
  ] as const) {
    if (job?.includes("\n    needs:")) {
      violations.push(`${VerifyWorkflowPath} ${jobName} must run independently of the Fast Gate.`);
    }
  }
  if (browserJob?.includes('install-electron: "true"')) {
    violations.push(`${VerifyWorkflowPath} Chromium Browser E2E must not download Electron.`);
  }
  if (windowsJob && !windowsJob.includes('install-electron: "true"')) {
    violations.push(`${VerifyWorkflowPath} Windows Platform Smoke must install the Electron runtime.`);
  }
  return violations;
}

function inspectPullRequestJobGate(workflow: string, jobName: string): string[] {
  const block = workflowJobBlock(workflow, jobName);
  if (!block) return [`${VerifyWorkflowPath} must define the ${jobName} job.`];
  return block.includes("if: github.event_name != 'pull_request'")
    ? [`${VerifyWorkflowPath} ${jobName} must run for pull_request events.`]
    : [];
}
