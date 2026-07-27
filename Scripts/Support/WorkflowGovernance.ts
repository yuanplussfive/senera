export function inspectTextIncludes(source: string, label: string, expectedTerms: readonly string[]): string[] {
  return expectedTerms.filter((term) => !source.includes(term)).map((term) => `${label} must include ${term}.`);
}

export function inspectWorkflowNamedStep(
  jobSource: string,
  workflowLabel: string,
  stepName: string,
  expectedTerms: readonly string[],
): string[] {
  const block = workflowNamedStepBlock(jobSource, stepName);
  if (!block) return [`${workflowLabel} must define step ${stepName}.`];
  return inspectTextIncludes(block, `${workflowLabel} step ${stepName}`, expectedTerms);
}

export function workflowJobBlock(source: string, jobName: string): string | undefined {
  const marker = `\n  ${jobName}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) return undefined;
  const nextJob = /^ {2}[a-z0-9-]+:\s*$/gm;
  nextJob.lastIndex = start + marker.length;
  const next = nextJob.exec(source);
  return source.slice(start, next?.index ?? source.length);
}

function workflowNamedStepBlock(jobSource: string, stepName: string): string | undefined {
  const marker = `\n      - name: ${stepName}\n`;
  const start = jobSource.indexOf(marker);
  if (start < 0) return undefined;
  const nextStep = /^ {6}- (?:name|uses|run):/gm;
  nextStep.lastIndex = start + marker.length;
  const next = nextStep.exec(jobSource);
  return jobSource.slice(start, next?.index ?? jobSource.length);
}
