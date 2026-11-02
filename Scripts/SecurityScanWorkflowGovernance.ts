import { inspectTextIncludes, inspectWorkflowNamedStep, workflowJobBlock } from "./Support/WorkflowGovernance.js";

const SecurityScanWorkflowLabel = ".github/workflows/security-scan.yml";
const TrivyAction = "aquasecurity/trivy-action@0.35.0";
const PullRequestSecurityJobs = ["dependency-audit", "codeql", "trivy-filesystem"] as const;
const TrivyStepPolicies = [
  {
    name: "Scan filesystem once with Trivy",
    terms: [
      TrivyAction,
      "scan-type: fs",
      "ignore-unfixed: true",
      'exit-code: "0"',
      "format: json",
      "output: trivy-results.json",
    ],
  },
  {
    name: "Generate Trivy SARIF and enforce severity gate from scan results",
    terms: [
      "trivy convert --format sarif --exit-code 0 --output trivy-results.sarif trivy-results.json",
      "trivy convert --format table --severity HIGH,CRITICAL --exit-code 1 trivy-results.json",
    ],
  },
] as const;

export function inspectSecurityScanWorkflow(workflow: string): string[] {
  const violations = inspectTextIncludes(workflow, SecurityScanWorkflowLabel, [
    "name: Security Scan",
    "pull_request:",
    "group: security-scan-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref }}",
    "cancel-in-progress: true",
    "github/codeql-action/init@v4",
    "queries: security-extended,security-and-quality",
    "actions/dependency-review-action@v5",
    TrivyAction,
    "github/codeql-action/upload-sarif@v4",
    "actions/setup-node@v5",
    "npm run quality.security",
    "always() && hashFiles('trivy-results.sarif') != ''",
  ]);
  const auditJob = workflowJobBlock(workflow, "dependency-audit");
  if (auditJob?.includes("./.github/actions/setup-node")) {
    violations.push(`${SecurityScanWorkflowLabel} dependency audit must not install the workspace dependency tree.`);
  }
  const trivyJob = workflowJobBlock(workflow, "trivy-filesystem");
  if (trivyJob) {
    if (trivyJob.split(`uses: ${TrivyAction}`).length !== 2) {
      violations.push(`${SecurityScanWorkflowLabel} must produce the Trivy report and gate in one scan.`);
    }
    for (const policy of TrivyStepPolicies) {
      violations.push(...inspectWorkflowNamedStep(trivyJob, SecurityScanWorkflowLabel, policy.name, policy.terms));
    }
  }
  for (const jobName of PullRequestSecurityJobs) {
    const block = workflowJobBlock(workflow, jobName);
    if (!block) {
      violations.push(`${SecurityScanWorkflowLabel} must define ${jobName}.`);
    } else if (block.includes("\n    if: github.event_name != 'pull_request'")) {
      violations.push(`${SecurityScanWorkflowLabel} job ${jobName} must run for pull requests.`);
    }
  }
  return violations;
}
