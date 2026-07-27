import {
  createAgentStructuredIssueList,
  formatAgentStructuredIssues,
  type AgentStructuredIssue,
} from "./AgentStructuredIssue.js";

export class AgentStructuredOutputValidationError extends Error {
  readonly issueDetails: AgentStructuredIssue[];
  readonly issues: string[];

  constructor(
    issues: readonly (string | AgentStructuredIssue)[],
    readonly invalidOutput: unknown,
  ) {
    const issueDetails = createAgentStructuredIssueList(issues);
    const messages = formatAgentStructuredIssues(issueDetails);
    super(messages.join("\n"));
    this.name = "AgentStructuredOutputValidationError";
    this.issueDetails = issueDetails;
    this.issues = messages;
  }
}
