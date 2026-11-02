export function formatConfigIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => {
      const pathText = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${pathText}: ${issue.message}`;
    })
    .join("; ");
}
