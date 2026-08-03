import {
  createAgentStructuredIssueList,
  formatAgentStructuredIssues,
  type AgentStructuredIssue,
} from "./AgentStructuredIssue.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export class AgentStructuredOutputValidationError extends AgentBaseError {
  readonly issueDetails: AgentStructuredIssue[];
  readonly issues: string[];

  constructor(
    issues: readonly (string | AgentStructuredIssue)[],
    readonly invalidOutput: unknown,
  ) {
    const issueDetails = createAgentStructuredIssueList(issues);
    const messages = formatAgentStructuredIssues(issueDetails);
    super(messages.join("\n"));
    this.issueDetails = issueDetails;
    this.issues = messages;
  }
}
