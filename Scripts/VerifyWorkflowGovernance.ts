import { inspectTextIncludes, workflowJobBlock } from "./Support/WorkflowGovernance.js";

const VerifyWorkflowPath = ".github/workflows/verify.yml";
const SetupNodeActionPath = ".github/actions/setup-node/action.yml";

export function inspectVerifyPipeline(workflow: string, setupNodeAction: string): string[] {
  return [...inspectSetupNodeAction(setupNodeAction), ...inspectVerifyWorkflow(workflow)];
}

function inspectSetupNodeAction(action: string): string[] {
  return inspectTextIncludes(action, SetupNodeActionPath, [
    "install-electron:",
    "windows-python-version:",
    "actions/setup-python@v6",
    "npm_config_python: ${{ steps.windows-python.outputs.python-path }}",
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
      "name: Build Verification Artifacts",
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
      "key: ${{ runner.os }}-eslint-${{ hashFiles('package-lock.json') }}-${{ inputs.source_ref || github.sha }}",
      "restore-keys: |\n            ${{ runner.os }}-eslint-${{ hashFiles('package-lock.json') }}-",
      "actions/upload-artifact@v6",
      "actions/download-artifact@v7",
      "verification-build",
      "npm run test.e2e.web.run",
      "npm run quality.format -- ${{ steps.range.outputs.arguments }}",
      "npm run test.frontend.governance",
      "npm run quality.docs",
      "npm run test.integration",
      "npm run verify.suite -- workspace core integration e2e release",
      "npm run verify.suite -- platform",
      "github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'",
      "npm run test.coverage.frontend",
      "npm run test.coverage.backend",
      "inputs.full_suite",
      "workflow_call:",
      "source_ref:",
      "run: npm run quality.format.full",
      "if: inputs.full_suite || steps.range.outputs.arguments == ''",
      "if: ${{ !inputs.full_suite && steps.range.outputs.arguments != '' }}",
    ]),
    ...inspectPullRequestJobGate(workflow, "coverage"),
  ];
  const fastJob = workflowJobBlock(workflow, "fast");
  const buildJob = workflowJobBlock(workflow, "build-artifacts");
  const browserJob = workflowJobBlock(workflow, "browser-e2e");
  const windowsJob = workflowJobBlock(workflow, "platform-windows");
  const coverageJob = workflowJobBlock(workflow, "coverage");

  for (const jobName of [
    "commit-messages",
    "build-artifacts",
    "android",
    "fast",
    "browser-e2e",
    "platform-windows",
    "coverage",
  ]) {
    const job = workflowJobBlock(workflow, jobName);
    if (!job?.includes("ref: ${{ inputs.source_ref || github.sha }}")) {
      violations.push(`${VerifyWorkflowPath} ${jobName} must check out the requested verification source.`);
    }
  }

  if (!buildJob) {
    violations.push(`${VerifyWorkflowPath} must define the build-artifacts job.`);
  }
  for (const [jobName, job] of [
    ["android", workflowJobBlock(workflow, "android")],
    ["fast", fastJob],
    ["browser-e2e", browserJob],
    ["platform-windows", windowsJob],
  ] as const) {
    if (job && !job.includes("needs: build-artifacts")) {
      violations.push(`${VerifyWorkflowPath} ${jobName} must consume build-artifacts.`);
    }
    for (const command of ["npm run build", "npm --workspace senera-frontend run build", "npm run test.e2e.web"]) {
      if (job?.includes(`run: ${command}\n`)) {
        violations.push(`${VerifyWorkflowPath} ${jobName} must reuse the verification build instead of ${command}.`);
      }
    }
  }

  if (fastJob) {
    for (const duplicate of [
      "npm run check.types",
      "npm run test.backend",
      "npm run test.frontend",
      "npm run test.frontend.static",
    ]) {
      if (fastJob.includes(`- run: ${duplicate}\n`)) {
        violations.push(`${VerifyWorkflowPath} Fast Gate must not duplicate ${duplicate}.`);
      }
    }
  }
  if (workflow.includes("npm run verify.all")) {
    violations.push(`${VerifyWorkflowPath} must not rerun the local suites after the CI gates.`);
  }
  for (const [jobName, job] of [["coverage", coverageJob]] as const) {
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
