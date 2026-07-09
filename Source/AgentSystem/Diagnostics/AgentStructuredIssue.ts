export type AgentStructuredIssuePathSegment = string | number;

export interface AgentStructuredIssue {
  readonly message: string;
  readonly path?: readonly AgentStructuredIssuePathSegment[];
  readonly pointer?: string;
}

export function createAgentStructuredIssue(
  message: string,
  path: readonly AgentStructuredIssuePathSegment[] = [],
): AgentStructuredIssue {
  return {
    message,
    path,
  };
}

export function createAgentStructuredIssueList(
  issues: readonly (string | AgentStructuredIssue)[],
): AgentStructuredIssue[] {
  return issues.map((issue) =>
    typeof issue === "string"
      ? createAgentStructuredIssue(issue)
      : normalizeAgentStructuredIssue(issue));
}

export function formatAgentStructuredIssue(issue: AgentStructuredIssue): string {
  const target = issue.path && issue.path.length > 0
    ? formatAgentStructuredIssuePath(issue.path)
    : issue.pointer ?? "/";
  return `${target}: ${issue.message}`;
}

export function formatAgentStructuredIssues(issues: readonly AgentStructuredIssue[]): string[] {
  return issues.map(formatAgentStructuredIssue);
}

export function agentStructuredIssueToPointer(issue: AgentStructuredIssue): string {
  return issue.pointer ?? agentStructuredIssuePathToPointer(issue.path ?? []);
}

export function agentStructuredIssuePathToPointer(
  path: readonly AgentStructuredIssuePathSegment[],
): string {
  return path.length === 0
    ? ""
    : `/${path.map(escapeJsonPointerSegment).join("/")}`;
}

export function formatAgentStructuredIssuePath(
  path: readonly AgentStructuredIssuePathSegment[],
): string {
  if (path.length === 0) {
    return "/";
  }

  return path.reduce<string>((output, part) => {
    if (typeof part === "number") {
      return `${output}[${part}]`;
    }
    return output ? `${output}.${part}` : part;
  }, "");
}

export function zodIssueToAgentStructuredIssue(issue: {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}): AgentStructuredIssue {
  return createAgentStructuredIssue(
    issue.message,
    issue.path.flatMap((part) =>
      typeof part === "string" || typeof part === "number" ? [part] : []),
  );
}

export function zodIssuesToAgentStructuredIssues(
  issues: readonly {
    readonly message: string;
    readonly path: readonly PropertyKey[];
  }[],
): AgentStructuredIssue[] {
  return issues.map(zodIssueToAgentStructuredIssue);
}

function normalizeAgentStructuredIssue(issue: AgentStructuredIssue): AgentStructuredIssue {
  return {
    message: issue.message,
    ...(issue.path ? { path: [...issue.path] } : {}),
    ...(issue.pointer ? { pointer: issue.pointer } : {}),
  };
}

function escapeJsonPointerSegment(segment: AgentStructuredIssuePathSegment): string {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}
