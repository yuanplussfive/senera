import { inspectTextIncludes, inspectWorkflowNamedStep, workflowJobBlock } from "./Support/WorkflowGovernance.js";

const SecurityScanWorkflowLabel = ".github/workflows/security-scan.yml";
const TrivyAction = "aquasecurity/trivy-action@0.35.0";
const PullRequestSecurityJobs = ["dependency-audit", "codeql", "trivy-filesystem"] as const;
const TrivyStepPolicies = [
  {
    name: "Generate Trivy SARIF report",
    terms: [TrivyAction, 'exit-code: "0"', "format: sarif", "output: trivy-results.sarif"],
  },
  {
    name: "Enforce Trivy severity gate",
    terms: [TrivyAction, "severity: HIGH,CRITICAL", "ignore-unfixed: true", 'exit-code: "1"', "format: table"],
  },
] as const;

export function inspectSecurityScanWorkflow(workflow: string): string[] {
  const violations = inspectTextIncludes(workflow, SecurityScanWorkflowLabel, [
    "name: Security Scan",
    "pull_request:",
    "github/codeql-action/init@v3",
    "queries: security-extended,security-and-quality",
    "actions/dependency-review-action@v4",
    TrivyAction,
    "github/codeql-action/upload-sarif@v3",
    "npm run quality.security",
  ]);
  const trivyJob = workflowJobBlock(workflow, "trivy-filesystem");
  if (trivyJob) {
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
